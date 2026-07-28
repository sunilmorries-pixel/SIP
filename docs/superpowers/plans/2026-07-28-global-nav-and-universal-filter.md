# Global Navigation + Universal Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder Overview to the first tab, and replace the 3 per-page Segment dropdowns with
one global Filters button (Segment/Status/State/Hub/Date-range, all multi-select except date)
that applies everywhere via a shared client filter object, plus a brand tagline fix and an
about-the-product info icon.

**Architecture:** Extends the existing per-dimension SQL-condition-builder pattern (proven in
v5.8) with one new shared multi-value helper, threaded through every grain (center_details,
zoho_data, cloud_devices, Jira-sheet JS). Center-360-derived pages (Map, Top Customers,
Overview's rollup, the Centers table) filter via a shared JS predicate over the already
fetch-once-and-cache array, NOT via SQL-level cache-key proliferation — see Global Constraint
below, a deliberate, justified deviation from the design spec discovered by reading the current
code before writing this plan.

**Tech Stack:** Google Apps Script (ES5 — `var`, no arrow functions, in `src/`), BigQuery
Standard SQL, vanilla JS client (no new UI library), Jest (`test/`, added 2026-07-28) for
reconciliation coverage, clasp for deploy.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-28-global-nav-and-universal-filter-design.md` —
  read it before starting; this plan implements it with one documented mechanism deviation
  below.
- **ES5 only in `src/`.** Test files (`test/`) may use modern JS (Jest runs them in Node
  directly).
- **Deviation from the design spec, discovered while reading current code (justify, don't
  silently follow the spec's literal wording):** `getCenter360RowsCD_()` is zero-arg today —
  it fetches the FULL unfiltered `center_details` universe ONCE (~28k rows, cached 1800s under
  a single fixed key, no segment/filter variant at all) and its four consumers (Centers table
  via `apiGetCentersCD`, Map, Top Customers, Overview's rollup/worstCenters) each filter/derive
  from that SAME cached array per-request in JS — `apiGetCentersCD` already does this for
  Segment today. The spec assumed SQL-level filter threading + per-filter-set cache variants
  for this function. Reading the real code shows the SIMPLER, ALREADY-established path: keep
  `getCenter360RowsCD_()` fetching once, unfiltered, and extend the existing JS-filter pattern
  to all 5 dimensions via one shared predicate (`centerPassesFilters_`, Task 3). This preserves
  the spec's INTENT (all 5 dimensions apply everywhere) at lower cost (no cache-key explosion
  for a ~28k-row fetch) and matches the codebase's own established pattern. `apiGetDashboardCD`'s
  own SQL aggregate specs (COUNT/AVG/GROUP BY — cannot be correctly derived by filtering
  pre-aggregated rows) DO need SQL-level threading + cache-key variants, exactly as the spec
  says — see Task 4.
- **Naming collision to avoid:** the device explorer (`Api.js` `apiGetDevices`,
  `Queries.js` `buildDeviceExplorerQuery`) already has its OWN per-request `hub` (free-text
  HubName equality) and `status` (device heartbeat bucket: Live/Online/Idle/etc.) params —
  DIFFERENT concepts from the new global filter's multi-select Hub and center Status
  dimensions, even though `hub` targets the same `HubName` column. Thread the new global filter
  as a separate `filters` object (`opts.filters`), never merge into the existing `opts.hub`/
  `opts.status` fields.
- **Exact literal values:** default `state.globalFilters.statuses = ['ACTIVE']` (matches the
  literal string existing code already uses, e.g. `deactivationdate IS NULL` semantics —
  `Status` column itself uses `'ACTIVE'`, confirmed in `apiGetCenterDetailsRaw`'s raw dump and
  `Numbers.js`'s `centersStatus` breakdown).
- **Cache key version bump `v5` → `v6`** everywhere a key's shape changes (new `Status` column
  in `centerBase`, new epoch/filterHash segments). `numbers_v4` is UNCHANGED (Numbers stays
  exempt from all of this, per the spec's §4.4).
- **No test framework changes needed beyond extending `test/reconcile/`** — the harness
  (`test/helpers/loadGas.js`, `test/helpers/bq.js`) already exists from 2026-07-28's session;
  reuse it, don't rebuild it.
- **Verification:** every new/changed SQL verified live on BigQuery before commit (established
  pattern: node eval of the relevant `src/server/*.js` files → `bq query` stdin, using
  `GOOGLE_APPLICATION_CREDENTIALS` for the Jest suite and
  `CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE` + `bq` CLI for ad hoc checks — these are the TWO
  DIFFERENT credential mechanisms already documented in
  `docs/superpowers/specs/2026-07-28-testing-harness-design.md`, don't conflate them). Preview
  pass via the `sip-preview` launch config before deploy. Do NOT deploy to production without
  explicit user go-ahead (established convention this session, twice reinforced).

---

### Task 1: Server — shared filter helpers (`multiCond_`, `dateRangeCond_`, `filterHash_`)

**Files:**
- Modify: `src/server/Queries.js` (add helpers near `segClean_`/`segSlug_`/`cdSegCond_`/
  `devSegCond_`, lines 50-71)
- Test: `test/unit/global-filter-helpers.test.js` (new)

**Interfaces:**
- Consumes: `segClean_(value)` (existing, line 55 — reused for per-value sanitization inside
  `multiCond_`).
- Produces (later tasks depend on these EXACT signatures):
  - `multiCond_(column, values)` → `string` (SQL fragment, `''` if `values` empty/falsy)
  - `dateRangeCond_(column, from, to)` → `string` (SQL fragment; `column` must already be a
    `DATE`/`DATETIME`-typed SQL expression at the call site — this function does NOT parse
    strings, callers wrap `SAFE.PARSE_DATETIME(...)` themselves when needed, see Task 4)
  - `filterHash_(filters)` → `string` (stable hash for cache keys; `filters` is the shape
    defined in Task 3)

- [ ] **Step 1: Add `multiCond_` and `dateRangeCond_` to Queries.js**

Insert immediately after `devSegCond_` (after line 71):

```js
/**
 * column IN ('v1','v2',...) for a sanitized, non-empty array; '' otherwise.
 * Segment/Status/State/Hub all reuse this — structurally identical dimensions
 * ("match this column against a list of values").
 * @param {string} column
 * @param {Array<string>=} values
 * @return {string}
 */
function multiCond_(column, values) {
  var clean = (values || []).map(segClean_).filter(Boolean);
  if (!clean.length) return '';
  return ' AND ' + column + ' IN (' + clean.map(function (v) { return "'" + v + "'"; }).join(',') + ')';
}

/**
 * DATE column bounds check against a 'YYYY-MM-DD' from/to pair; '' if both
 * are empty/invalid. `column` must already be a DATE/DATETIME-typed SQL
 * expression at the call site (callers wrap SAFE.PARSE_DATETIME themselves
 * for string-typed columns like zoho_data.CreatedAt — see buildDashboardQuerySpecs).
 * @param {string} column
 * @param {string=} from
 * @param {string=} to
 * @return {string}
 */
function dateRangeCond_(column, from, to) {
  var f = /^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) ? from : '';
  var t = /^\d{4}-\d{2}-\d{2}$/.test(String(to || '')) ? to : '';
  var cond = '';
  if (f) cond += " AND DATE(" + column + ") >= '" + f + "'";
  if (t) cond += " AND DATE(" + column + ") <= '" + t + "'";
  return cond;
}
```

- [ ] **Step 2: Add `filterHash_` (cache-key stability helper)**

Insert directly after `dateRangeCond_`:

```js
/**
 * Stable hash of a filters object for cache keys — sorts each array so
 * ['A','B'] and ['B','A'] hash identically, and fixes key order so the
 * shape of `filters` (Task 3) never produces two different hashes for the
 * same logical filter set.
 * @param {{segments:Array,statuses:Array,states:Array,hubs:Array,dateFrom:string,dateTo:string}} filters
 * @return {string}
 */
function filterHash_(filters) {
  var f = filters || {};
  function sorted(arr) { return (arr || []).map(segClean_).filter(Boolean).sort(); }
  var canonical = JSON.stringify({
    segments: sorted(f.segments), statuses: sorted(f.statuses),
    states: sorted(f.states), hubs: sorted(f.hubs),
    dateFrom: String(f.dateFrom || ''), dateTo: String(f.dateTo || '')
  });
  return shortHash(canonical);
}
```

- [ ] **Step 3: Write the unit test**

Create `test/unit/global-filter-helpers.test.js`:

```js
'use strict';
const { loadGas } = require('../helpers/loadGas');

describe('multiCond_', function () {
  let sandbox;
  beforeAll(function () { sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js']); });

  test('empty/undefined array yields no condition', function () {
    expect(sandbox.multiCond_('Status', [])).toBe('');
    expect(sandbox.multiCond_('Status', undefined)).toBe('');
  });

  test('single value emits an IN-list of one', function () {
    expect(sandbox.multiCond_('Status', ['ACTIVE'])).toBe(" AND Status IN ('ACTIVE')");
  });

  test('multiple values are all included, sanitized', function () {
    var cond = sandbox.multiCond_('State', ["Karnataka", 'Tamil"Nadu']);
    expect(cond).toContain("'Karnataka'");
    expect(cond).toContain("'TamilNadu'"); // quote stripped by segClean_
    expect(cond).not.toMatch(/"/);
  });
});

describe('dateRangeCond_', function () {
  let sandbox;
  beforeAll(function () { sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js']); });

  test('both bounds empty yields no condition', function () {
    expect(sandbox.dateRangeCond_('deploymentdate', '', '')).toBe('');
  });

  test('from-only and to-only bounds', function () {
    expect(sandbox.dateRangeCond_('deploymentdate', '2026-01-01', '')).toBe(" AND DATE(deploymentdate) >= '2026-01-01'");
    expect(sandbox.dateRangeCond_('deploymentdate', '', '2026-03-31')).toBe(" AND DATE(deploymentdate) <= '2026-03-31'");
  });

  test('malformed date strings are rejected, not injected', function () {
    expect(sandbox.dateRangeCond_('deploymentdate', "2026-01-01' OR '1'='1", '')).toBe('');
  });
});

describe('filterHash_', function () {
  let sandbox;
  beforeAll(function () { sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js']); });

  test('same filters in different array order hash identically', function () {
    var a = sandbox.filterHash_({ segments: ['Government', 'ECHO'], statuses: ['ACTIVE'], states: [], hubs: [], dateFrom: '', dateTo: '' });
    var b = sandbox.filterHash_({ segments: ['ECHO', 'Government'], statuses: ['ACTIVE'], states: [], hubs: [], dateFrom: '', dateTo: '' });
    expect(a).toBe(b);
  });

  test('different filters hash differently', function () {
    var a = sandbox.filterHash_({ segments: ['Government'], statuses: [], states: [], hubs: [], dateFrom: '', dateTo: '' });
    var b = sandbox.filterHash_({ segments: ['ECHO'], statuses: [], states: [], hubs: [], dateFrom: '', dateTo: '' });
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: 3 new suites, all passing, alongside the existing 5 suites (41 total).

- [ ] **Step 5: Commit**

```bash
git add src/server/Queries.js test/unit/global-filter-helpers.test.js
git commit -m "Server: multiCond_/dateRangeCond_/filterHash_ — shared multi-select filter helpers"
```

---

### Task 2: Server — cache-epoch mechanism, replacing segment enumeration

**Files:**
- Modify: `src/server/Setup.js:122-158` (`clearDashboardCache`)

**Interfaces:**
- Consumes: `PropertiesService` (Apps Script global, no import needed).
- Produces: `getCacheEpoch_()` → `number` (Setup.js — later tasks' cache keys call this).

- [ ] **Step 1: Add `getCacheEpoch_()` and rewrite `clearDashboardCache()`**

Replace the whole function body (lines 122-158) with:

```js
/**
 * Current cache epoch — bumped by clearDashboardCache(). Every filter-varying
 * cache key folds this in, so bumping it invalidates every existing filtered
 * variant at once without needing to enumerate what combinations were ever
 * cached (the old approach: a live BQ query for every distinct segment value,
 * one cache-key removal per value — doesn't scale past one multi-select
 * dimension, let alone five). Stale entries under the old epoch simply age
 * out via their own TTL (900s / 1800s for large objects) — no explicit
 * deletion needed.
 * @return {number}
 */
function getCacheEpoch_() {
  var props = PropertiesService.getScriptProperties();
  var v = parseInt(props.getProperty('CACHE_EPOCH'), 10);
  return isFinite(v) ? v : 0;
}

/**
 * Clears cached payloads so the next load recomputes. Bumps CACHE_EPOCH
 * (invalidates every filter-varying key at once) and removes the small
 * number of keys that DON'T vary by filter (Numbers, Center-360 base fetch,
 * raw-sheet snapshots) directly, since those never had a combinatorial
 * enumeration problem to begin with.
 */
function clearDashboardCache() {
  var props = PropertiesService.getScriptProperties();
  var next = getCacheEpoch_() + 1;
  props.setProperty('CACHE_EPOCH', String(next));

  var cache = CacheService.getScriptCache();
  cache.removeAll(['exec_v4', 'numbers_v4']);
  // Large (gzip-chunked) caches with NO filter variant: remove #meta + each chunk.
  ['ctr360cd_v6', 'map_v3', 'assets_v3',
    'rawsheet_v1_' + CONFIG.JIRA_SHEET_ID, 'rawsheet_v1_' + CONFIG.CS_SHEET_ID].forEach(function (base) {
    var meta = cache.get(base + '#meta');
    var n = meta ? parseInt(meta, 10) : 40;
    var keys = [base + '#meta'];
    for (var i = 0; i < n; i++) keys.push(base + '#' + i);
    cache.removeAll(keys);
  });
  Logger.log('Cache epoch bumped to ' + next + ' — every filtered dashboard/map/exec/top-customers/jira-devices variant now recomputes on next access.');
}
```

- [ ] **Step 2: Verify by hand in the Apps Script editor context (simulate, since Script
  Properties aren't reachable from Node)**

This function can't be exercised outside Apps Script (`PropertiesService`/`CacheService` are
host globals). Confirm by code review only at this step: re-read the diff, confirm
`getCacheEpoch_()` and `clearDashboardCache()` are syntactically valid ES5 (no `let`/`const`/
arrow functions), and that every string key matches what Tasks 4-7 will actually use (`ctr360cd_v6`
— cross-check against Task 3's cache key once written).

- [ ] **Step 3: Commit**

```bash
git add src/server/Setup.js
git commit -m "Server: cache-epoch invalidation replaces segment enumeration in clearDashboardCache"
```

---

### Task 3: Server — `Status` column + generalized `centerFilterMap_`/`centerPassesFilters_`

**Files:**
- Modify: `src/server/EditionCD.js` (centerBase SELECT inside `getCenter360RowsCD_`, lines
  275-357; rename/generalize `centerSegmentMap_`, lines 372-377; `centerFilterSubqueryCond_`
  replacing `devSegCond_`'s call sites — see Task 4/7 for actual call-site changes, this task
  only adds the new function)

**Interfaces:**
- Consumes: `multiCond_`, `filterHash_` (Task 1).
- Produces (Tasks 4-7 depend on these exact signatures):
  - `getCenter360RowsCD_(bypassCache)` — UNCHANGED signature (still zero-filter-arg — see Global
    Constraint), but its joined rows now carry a `.status` field.
  - `centerFilterMap_()` → `{[center_id]: {segment, status, state, hub}}` (was
    `centerSegmentMap_()` → `{[center_id]: segment}`)
  - `centerPassesFilters_(row, filters)` → `boolean` — `row` must have `.segment`/`.status`/
    `.state`/`.hub`/`.deployment_date` fields (true for every Center-360 row after this task);
    checks Segment/Status/State/Hub (multi-select — empty array means "any") and the date range
    against `.deployment_date`.
  - `centerFilterSubqueryCond_(filters)` → `string` (SQL fragment) — the generalized
    `devSegCond_`, for `cloud_devices`/`zoho_data` specs that need to narrow by CenterID.

- [ ] **Step 1: Add `Status` to `centerBase`'s SELECT (inside `getCenter360RowsCD_`, ~line 291)**

Change:
```js
        "SELECT DISTINCT CenterID AS center_id, Centername AS center, HubID AS hub_id, HubName AS hub, " +
        " City AS city, State AS state, PinCode AS pin, Spoke_Country AS country, " +
        " IFNULL(TRIM(hub_master_segment), '') AS segment, " +   // segment = hub_master_segment (per user)
        " CAST(NULL AS FLOAT64) AS lat, CAST(NULL AS FLOAT64) AS lng, " +
        " CAST(deploymentdate AS STRING) AS deployment_date " +
        "FROM " + T('center_details') + " WHERE " + cdFilter_()
```
to:
```js
        "SELECT DISTINCT CenterID AS center_id, Centername AS center, HubID AS hub_id, HubName AS hub, " +
        " City AS city, State AS state, PinCode AS pin, Spoke_Country AS country, " +
        " IFNULL(TRIM(hub_master_segment), '') AS segment, " +   // segment = hub_master_segment (per user)
        " IFNULL(TRIM(Status), '') AS status, " +                // NEW: needed for the global Status filter
        " CAST(NULL AS FLOAT64) AS lat, CAST(NULL AS FLOAT64) AS lng, " +
        " CAST(deploymentdate AS STRING) AS deployment_date " +
        "FROM " + T('center_details') + " WHERE " + cdFilter_()
```

Then thread `status` through the two `leftJoin` `select` callbacks (~lines 303-313 and
316-325) — add `status: base.status || ''` next to the existing `segment: base.segment || ''`
line in the FIRST `select` callback (the one building `withTelemetry`).

Bump `getCenter360RowsCD_`'s cache key (line 276) from `'ctr360cd_v5'` to `'ctr360cd_v6'` (shape
change — new `status` field on every row) — this key has no filter variant (see Global
Constraint), so it's a straight version bump, matching what Task 2 already assumes in
`clearDashboardCache`.

- [ ] **Step 2: Replace `centerSegmentMap_` with `centerFilterMap_` (~lines 372-377)**

```js
/** center_id → {segment, status, state, hub} from the cached Center-360 rows. */
function centerFilterMap_() {
  var m = {};
  getCenter360RowsCD_().forEach(function (r) {
    m[r.center_id] = { segment: r.segment || '', status: r.status || '', state: r.state || '', hub: r.hub || '' };
  });
  return m;
}
```

- [ ] **Step 3: Add `centerPassesFilters_` and `centerFilterSubqueryCond_` immediately after**

```js
/**
 * Does this Center-360 row (or anything carrying the same 4 fields + a
 * deployment_date) pass the current global filter set? Empty array on any
 * dimension = no restriction on that dimension (existing convention).
 * @param {{segment:string,status:string,state:string,hub:string,deployment_date:string}} row
 * @param {{segments:Array,statuses:Array,states:Array,hubs:Array,dateFrom:string,dateTo:string}} filters
 * @return {boolean}
 */
function centerPassesFilters_(row, filters) {
  var f = filters || {};
  function inList(list, value) { return !list || !list.length || list.indexOf(value) !== -1; }
  if (!inList(f.segments, row.segment)) return false;
  if (!inList(f.statuses, row.status)) return false;
  if (!inList(f.states, row.state)) return false;
  if (!inList(f.hubs, row.hub)) return false;
  var d = row.deployment_date ? row.deployment_date.slice(0, 10) : '';
  if (f.dateFrom && (!d || d < f.dateFrom)) return false;
  if (f.dateTo && (!d || d > f.dateTo)) return false;
  return true;
}

/**
 * Narrows an outer table (zoho_data, cloud_devices) to rows whose CenterID
 * passes the center_details filter set. Generalizes the old devSegCond_
 * (segment-only) to all 4 center-attribute dimensions uniformly — one code
 * path instead of mixing native-column and subquery access per dimension.
 * @param {{segments:Array,statuses:Array,states:Array,hubs:Array}} filters
 * @return {string}
 */
function centerFilterSubqueryCond_(filters) {
  var f = filters || {};
  var cond = multiCond_('hub_master_segment', f.segments) +
             multiCond_('Status', f.statuses) +
             multiCond_('State', f.states) +
             multiCond_('HubName', f.hubs);
  if (!cond) return '';
  return ' AND CenterID IN (SELECT DISTINCT CenterID FROM ' + T('center_details') +
    ' WHERE ' + cdFilter_() + cond + ')';
}
```

- [ ] **Step 4: Delete the old `devSegCond_` calls' now-orphaned references — check, don't
  assume**

Run: `grep -rn "devSegCond_\|centerSegmentMap_" src/server/`
Expected: any remaining hits are in files Tasks 4/7 haven't touched yet (they will replace
them) — note them for those tasks, don't fix here (this task only ADDS the new functions,
doesn't yet rewire every caller — that's Tasks 4-7's job, kept separate so this task's diff
stays reviewable on its own).

- [ ] **Step 5: Verify the Status column + predicate on live BigQuery**

```bash
export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="<path to a valid tricogde-dwh or sandbox key>"
```
Generate and run the updated `centerBase` SQL (extract via a node eval of
`Config.js`+`SlaCatalog.js`+`Queries.js`+`EditionCD.js`, call the inline SQL string directly —
follow the established gen-script pattern from prior sessions) against whichever BigQuery
project you have live credentials for right now. Confirm the query returns a `status` column
with real values (expect `ACTIVE`/non-ACTIVE strings, not all blank).

- [ ] **Step 6: Commit**

```bash
git add src/server/EditionCD.js
git commit -m "Server: Status column on Center-360 rows; centerFilterMap_/centerPassesFilters_/centerFilterSubqueryCond_ generalize segment-only filtering to all 4 center-attribute dimensions"
```

---

### Task 4: Server — thread filters into `buildDashboardQuerySpecsCD` + `apiGetDashboardCD`

**Files:**
- Modify: `src/server/Queries.js` (zoho specs `zohoKpis`/`slaKpis`/`slaByType`/`zohoTrend`/
  `zohoOpenByStatus`/`zohoCategories`/`zohoPriority`/`zohoChannel`/`zohoSegment`, lines 264-388;
  device specs `kpis`/`fleetStatus`/`firmware`, lines 142-180; `buildDashboardQuerySpecs`
  signature, line 132)
- Modify: `src/server/EditionCD.js` (`centerUptimeSqlCD_`, lines 60-93; `buildDashboardQuerySpecsCD`,
  lines 103-191; `apiGetDashboardCD`, lines 394-434)

**Interfaces:**
- Consumes: `multiCond_`, `dateRangeCond_`, `filterHash_` (Task 1), `centerFilterSubqueryCond_`,
  `centerFilterMap_` (Task 3).
- Produces: `buildDashboardQuerySpecs(hub, filters)` (was `(hub, segment)`),
  `buildDashboardQuerySpecsCD(hub, filters)` (was `(hub, segment)`),
  `centerUptimeSqlCD_(tailSelect, filters)` (was `(tailSelect, segment)`),
  `apiGetDashboardCD({filters, hub, bypassCache})` (was `{segment, hub, bypassCache}`) —
  `filters` shape: `{segments:Array<string>, statuses:Array<string>, states:Array<string>,
  hubs:Array<string>, dateFrom:string, dateTo:string}`.

- [ ] **Step 1: `buildDashboardQuerySpecs(hub, filters)` — replace the segment-only threading
  (Queries.js:132-137)**

Change:
```js
function buildDashboardQuerySpecs(hub, segment) {
  var p = { hub: hub || '' };
  var NOW_IST_SQL = nowIstSql_();
  var FLEET_BUCKET_SQL = fleetBucketSql_();
  var segZ = cdSegCond_(segment);
  var segD = devSegCond_(segment);
```
to:
```js
function buildDashboardQuerySpecs(hub, filters) {
  var p = { hub: hub || '' };
  var NOW_IST_SQL = nowIstSql_();
  var FLEET_BUCKET_SQL = fleetBucketSql_();
  var f = filters || {};
  var centerCond = centerFilterSubqueryCond_(f);          // for cloud_devices / zoho_data
  var supportDateCond = dateRangeCond_("SAFE.PARSE_DATETIME('" + CONFIG.ZOHO_DT_FORMAT + "', CreatedAt)", f.dateFrom, f.dateTo);
```

Then replace every `segD` reference (lines 151, 169, 178 — the `kpis`/`fleetStatus`/`firmware`
specs' `WHERE " + HUB_FILTER_SQL + segD + ")"`/`" + HUB_FILTER_SQL + segD + " "` fragments) with
`centerCond`, and every `segZ` reference (lines 270, 288, 312, 328, 342 — `zohoKpis`/`slaKpis`/
`slaByType`/`zohoTrend`/`zohoOpenByStatus`) with `centerCond + supportDateCond`.

For the four 90-day zoho charts that build their OWN inner CTE with `hub_master_segment`
already selected but reference `segZ` in the OUTER where (lines 353, 364, 375, 386 —
`zohoCategories`/`zohoPriority`/`zohoChannel`/`zohoSegment`), replace their `segZ` with
`centerCond + supportDateCond` too (the 90-day window `AND created >= DATETIME_SUB(...)`
already present stays as-is — `supportDateCond` is an ADDITIONAL, user-controlled range on top
of that fixed 90-day window; if the user's date range is narrower than 90 days that's fine,
both conditions AND together).

- [ ] **Step 2: `centerUptimeSqlCD_(tailSelect, filters)` (EditionCD.js:60-93)**

Change the signature and the birth CTE (line 70):
```js
function centerUptimeSqlCD_(tailSelect, filters) {
```
```js
    "birth AS (SELECT CenterID AS center_id, MIN(DATETIME(deploymentdate)) AS b " +
    "  FROM " + T('center_details') + " WHERE deploymentdate IS NOT NULL AND " + cdFilter_() +
    multiCond_('hub_master_segment', (filters || {}).segments) +
    multiCond_('Status', (filters || {}).statuses) +
    multiCond_('State', (filters || {}).states) +
    multiCond_('HubName', (filters || {}).hubs) +
    dateRangeCond_('deploymentdate', (filters || {}).dateFrom, (filters || {}).dateTo) +
    " GROUP BY CenterID), " +
```

- [ ] **Step 3: `buildDashboardQuerySpecsCD(hub, filters)` (EditionCD.js:103-191)**

Change the signature and the `F`/`SC` setup:
```js
function buildDashboardQuerySpecsCD(hub, filters) {
  var CD = T('center_details');
  var F = cdFilter_();
  var filterCond = multiCond_('hub_master_segment', (filters || {}).segments) +
    multiCond_('Status', (filters || {}).statuses) +
    multiCond_('State', (filters || {}).states) +
    multiCond_('HubName', (filters || {}).hubs);
  var dateCond = dateRangeCond_('deploymentdate', (filters || {}).dateFrom, (filters || {}).dateTo);
```

Replace every `SC` reference (lines 114, 121, 126, 133, 139 — `centerKpis`/`geo`/
`deploymentAge`/`activeVsEnded`/`hubs`) with `filterCond` for the segment/status/state/hub
conditions; add `dateCond` alongside it EXCEPT on `activeVsEnded` (the segment-breakdown donut
groups BY segment — filtering by a segment array there would be a self-referential no-op the
user didn't ask for; keep `filterCond` there for status/state/hub narrowing but the segment
component of `filterCond` still legitimately narrows which segments show, so leave it as-is,
just don't ALSO apply `dateCond` to `deploymentAge`'s already-existing age-band computation
input — actually DO apply `dateCond` there too, since narrowing by deployment-date range before
banding is coherent; only skip `dateCond` on `activeVsEnded` since it has no date semantics).

Concretely: `centerKpis`, `geo`, `hubs` get `filterCond + dateCond`. `deploymentAge` gets
`filterCond + dateCond` (its own `WHERE deploymentdate IS NOT NULL AND ...` already exists,
append both). `activeVsEnded` gets `filterCond` only (no `dateCond`).

Update the three `centerUptimeSqlCD_(...)` calls (`reliability`, `uptimeFleet`, `assetHealth`,
lines 141-154) to pass `filters` instead of `segment` as the second argument (no signature
change needed at the call site beyond the variable rename, since Step 2 already updated the
callee).

Update the delegate call (line 159): `buildDashboardQuerySpecs(hub, segment)` → `(hub, filters)`.

`segmentOptions` (line 172-174) and `zohoFailByCenter` (line 179-189) stay UNTHREADED — per the
design spec, the segment dropdown's own option list must always show every real segment value
regardless of what's currently selected, and the per-center Zoho failure aggregate feeding the
JS cohort is keyed by raw CenterID (filtering happens later in JS via `centerFilterMap_`, not
here).

- [ ] **Step 4: `apiGetDashboardCD(options)` (EditionCD.js:394-434)**

```js
function apiGetDashboardCD(options) {
  options = options || {};
  var hub = String(options.hub || '').slice(0, 120);
  var filters = {
    segments: (options.filters && options.filters.segments) || [],
    statuses: (options.filters && options.filters.statuses) || [],
    states: (options.filters && options.filters.states) || [],
    hubs: (options.filters && options.filters.hubs) || [],
    dateFrom: String((options.filters && options.filters.dateFrom) || ''),
    dateTo: String((options.filters && options.filters.dateTo) || '')
  };
  return respond_(function () {
    var cacheKey = 'dashcd_v6_' + getCacheEpoch_() + '_' + filterHash_(filters) + '_' + shortHash(hub);
    if (options.bypassCache !== true) {
      var cached = cacheGetLarge(cacheKey);
      if (cached) return cached;
    }
    var results = runQueriesParallel(buildDashboardQuerySpecsCD(hub, filters));
    enrichCenterNamesCD_(results.reliability);
    enrichCenterNamesCD_(results.assetHealth);
    // Jira metrics from the Sheet index; keep only assets whose center passes
    // the global filter (unmapped devices drop out whenever ANY of
    // Segment/Status/State/Hub is active — matching the existing v5.8
    // behavior for Segment alone). Date range checks the asset's OWN Jira
    // Created date directly, not the center's deployment date.
    var assetIdx = getAssetIndex_();
    var hasCenterFilter = filters.segments.length || filters.statuses.length ||
      filters.states.length || filters.hubs.length;
    if (hasCenterFilter) {
      var cfMap = centerFilterMap_();
      assetIdx = assetIdx.filter(function (a) {
        return a.center_id != null && centerPassesFilters_(cfMap[a.center_id] || {}, {
          segments: filters.segments, statuses: filters.statuses, states: filters.states, hubs: filters.hubs
        });
      });
    }
    if (filters.dateFrom || filters.dateTo) {
      assetIdx = assetIdx.filter(function (a) {
        var d = a.birthday || '';
        if (filters.dateFrom && (!d || d < filters.dateFrom)) return false;
        if (filters.dateTo && (!d || d > filters.dateTo)) return false;
        return true;
      });
    }
    results.assets = assetsDonutFromIndex_(assetIdx);
    results.cohortReliability = cohortFromIndex_(assetIdx, results.zohoFailByCenter);
    delete results.zohoFailByCenter;
    results.csTracker = readCsTracker();
    results.appName = CONFIG.APP_NAME;
    results.appVersion = CONFIG.APP_VERSION;
    results.fleet = jiraDeviceStats_(filters);
    results.filters = filters;
    results.edition = 'center_details';
    results.flags = FLAGS_CD;
    results.hub = hub;
    cachePutLarge(cacheKey, results, CONFIG.CACHE_TTL_SECONDS);
    return results;
  });
}
```

Note: `results.segment = segment;` (old, single-value echo) is replaced by
`results.filters = filters;` (echoes the whole applied set back — the client's chip renderer,
Task 10, reads from this, not a re-derived local guess).

- [ ] **Step 5: Verify the changed specs on live BigQuery**

Generate SQL for `centerKpis`, `zohoKpis`, and `kpis` (device) with a real filter combination
(e.g. `{statuses:['ACTIVE'], segments:['Government']}`) via the established node-eval-then-`bq`
pattern. Confirm: (a) SQL is syntactically valid (no `bq` parse errors), (b) filtered result
counts are `<=` the corresponding unfiltered counts, (c) `zohoKpis` with a `dateFrom`/`dateTo`
narrows `total_tickets` versus no date range.

- [ ] **Step 6: Commit**

```bash
git add src/server/Queries.js src/server/EditionCD.js
git commit -m "Server: thread the 5-dimension global filter into buildDashboardQuerySpecs(CD)/apiGetDashboardCD"
```

---

### Task 5: Server — extend `apiGetCentersCD`'s filter predicate (JS-side, no cache change)

**Files:**
- Modify: `src/server/EditionCD.js` (`apiGetCentersCD`, lines 436-466)

**Interfaces:**
- Consumes: `centerPassesFilters_` (Task 3).
- Produces: `apiGetCentersCD({search, filters, sortBy, sortDir, page, pageSize})` — DROPS the
  old standalone `hub`/`segment` options (folded into `filters.hubs`/`filters.segments`).

- [ ] **Step 1: Rewrite the filter block**

```js
function apiGetCentersCD(options) {
  options = options || {};
  var clean = {
    search: String(options.search || '').toLowerCase().slice(0, 80),
    filters: {
      segments: ((options.filters && options.filters.segments) || []).map(segClean_).filter(Boolean),
      statuses: ((options.filters && options.filters.statuses) || []).map(segClean_).filter(Boolean),
      states: ((options.filters && options.filters.states) || []).map(segClean_).filter(Boolean),
      hubs: ((options.filters && options.filters.hubs) || []).map(segClean_).filter(Boolean),
      dateFrom: String((options.filters && options.filters.dateFrom) || ''),
      dateTo: String((options.filters && options.filters.dateTo) || '')
    },
    sortBy: String(options.sortBy || 'devices'),
    sortDir: options.sortDir === 'asc' ? 'asc' : 'desc',
    page: Math.max(0, parseInt(options.page, 10) || 0),
    pageSize: Math.min(100, Math.max(5, parseInt(options.pageSize, 10) || 15))
  };
  return respond_(function () {
    var joined = getCenter360RowsCD_();
    var filtered = joined.filter(function (row) {
      if (!centerPassesFilters_(row, clean.filters)) return false;
      if (!clean.search) return true;
      return (String(row.center).toLowerCase().indexOf(clean.search) !== -1 ||
              String(row.center_id).indexOf(clean.search) !== -1 ||
              String(row.hub).toLowerCase().indexOf(clean.search) !== -1 ||
              String(row.state).toLowerCase().indexOf(clean.search) !== -1);
    });
    sortRows(filtered, CENTER_SORT_KEYS[clean.sortBy] || 'devices', clean.sortDir);
    var start = clean.page * clean.pageSize;
    return {
      rows: filtered.slice(start, start + clean.pageSize),
      totalRows: filtered.length, page: clean.page, pageSize: clean.pageSize,
      edition: 'center_details', flags: FLAGS_CD
    };
  });
}
```

- [ ] **Step 2: Verify with a reconciliation test (extends the harness from 2026-07-28)**

Add to `test/reconcile/center-grain.test.js` (append, don't create a new file — this belongs
with the existing grain-invariant suite):

```js
test('apiGetCentersCD Status filter narrows results to only that status (structural check via direct SQL, since apiGetCentersCD itself needs the Apps Script runtime)', async function () {
  const specs = sandbox.buildDashboardQuerySpecsCD('', {});
  // Proxy check: COUNT(DISTINCT CenterID) WHERE Status IN ('ACTIVE') must be
  // strictly <= the unfiltered centerKpis.centers count, and > 0 (sandbox/dwh
  // always has some active centers) — a full apiGetCentersCD() call needs the
  // live Apps Script environment (PropertiesService/CacheService), so this
  // test checks the underlying SQL/grain logic apiGetCentersCD's predicate
  // ultimately reads from instead.
  const kpiSpec = specs.find(function (s) { return s.key === 'centerKpis'; });
  const allRows = await runQuery(kpiSpec.sql);
  const activeSpecs = sandbox.buildDashboardQuerySpecsCD('', { statuses: ['ACTIVE'] });
  const activeRows = await runQuery(activeSpecs.find(function (s) { return s.key === 'centerKpis'; }).sql);
  expect(activeRows[0].centers).toBeGreaterThan(0);
  expect(activeRows[0].centers).toBeLessThanOrEqual(allRows[0].centers);
});
```

Run: `npm run test:reconcile` (needs `GOOGLE_APPLICATION_CREDENTIALS` set — see
`docs/superpowers/specs/2026-07-28-testing-harness-design.md` for the two-credential-mechanism
explanation).

- [ ] **Step 3: Commit**

```bash
git add src/server/EditionCD.js test/reconcile/center-grain.test.js
git commit -m "Server: apiGetCentersCD filters via centerPassesFilters_ (all 5 dimensions, JS-side over the cached Center-360 array)"
```

---

### Task 6: Server — Map, Top Customers, Overview filter threading

**Files:**
- Modify: `src/server/EditionCD.js` (`apiGetMapDataCD`, lines 468-522; `computeTopCustomersCD_`,
  lines 525-583; `apiGetTopCustomersCD`, lines 585-591; `apiGetExecOverviewCD`, lines 593-644)

**Interfaces:**
- Consumes: `centerPassesFilters_`, `filterHash_`, `getCacheEpoch_`, `buildDashboardQuerySpecsCD`
  (Tasks 1, 2, 3, 4).
- Produces: `apiGetMapDataCD({filters, bypassCache})`, `computeTopCustomersCD_(filters)` (was
  zero-arg), `apiGetTopCustomersCD({filters, bypassCache})`,
  `apiGetExecOverviewCD({filters, bypassCache})` — all newly filter-aware, reversing v5.8's
  explicit "Exec Overview stays unsegmented" contract per the design spec §4.4/§4.5.

- [ ] **Step 1: `apiGetMapDataCD(options)` — filter centers before building the compact
  array**

```js
function apiGetMapDataCD(options) {
  options = options || {};
  var filters = {
    segments: (options.filters && options.filters.segments) || [],
    statuses: (options.filters && options.filters.statuses) || [],
    states: (options.filters && options.filters.states) || [],
    hubs: (options.filters && options.filters.hubs) || [],
    dateFrom: String((options.filters && options.filters.dateFrom) || ''),
    dateTo: String((options.filters && options.filters.dateTo) || '')
  };
  return respond_(function () {
    var cacheKey = 'mapcd_v6_' + getCacheEpoch_() + '_' + filterHash_(filters);
    if (options.bypassCache !== true) {
      var cached = cacheGetLarge(cacheKey);
      if (cached) return cached;
    }

    var centers = getCenter360RowsCD_().filter(function (row) { return centerPassesFilters_(row, filters); });
    var assets = getAssetIndex_();               // from the Jira SHEET (Connector + ECG only)
    var geoStore = loadGeoStore();
    /* ... rest of the function body UNCHANGED from the current implementation
       (assetCount/located/unlocated/typeDict/catDict/assetRows construction) —
       it already reads `centers` and `assets`, both now pre-filtered above. */
    cachePutLarge(cacheKey, payload, 1800);
    return payload;
  });
}
```

(The `...rest unchanged...` note means: copy the body from `var assetCount = {};` through
`return payload;` verbatim from the current file — only the signature, the two new `filters`/
`cacheKey` lines, and the `centers` filter predicate change.)

- [ ] **Step 2: `computeTopCustomersCD_(filters)` and `apiGetTopCustomersCD(options)`**

```js
function computeTopCustomersCD_(filters) {
  var meta = {};
  TOP_CUSTOMERS.forEach(function (c) { meta[c.hub_id] = c; });

  var centers = getCenter360RowsCD_().filter(function (row) { return centerPassesFilters_(row, filters || {}); });
  /* ... rest of the function body UNCHANGED — it already only reads `centers`
     (now pre-filtered) and `assets`/`geoStore`, plus TOP_CUSTOMERS/topCustomerTicketStats_
     which are out of scope for this filter (curated account list + hub-scoped
     ticket stats, unaffected by center-level filtering by design). */
}

function apiGetTopCustomersCD(options) {
  options = options || {};
  var filters = {
    segments: (options.filters && options.filters.segments) || [],
    statuses: (options.filters && options.filters.statuses) || [],
    states: (options.filters && options.filters.states) || [],
    hubs: (options.filters && options.filters.hubs) || [],
    dateFrom: String((options.filters && options.filters.dateFrom) || ''),
    dateTo: String((options.filters && options.filters.dateTo) || '')
  };
  return respond_(function () {
    return withCache('topcustcd_v6_' + getCacheEpoch_() + '_' + filterHash_(filters),
      function () { return computeTopCustomersCD_(filters); },
      options.bypassCache === true);
  });
}
```

- [ ] **Step 3: `apiGetExecOverviewCD(options)` — both mechanisms (SQL subset + JS-filtered
  rollup)**

```js
function apiGetExecOverviewCD(options) {
  options = options || {};
  var filters = {
    segments: (options.filters && options.filters.segments) || [],
    statuses: (options.filters && options.filters.statuses) || [],
    states: (options.filters && options.filters.states) || [],
    hubs: (options.filters && options.filters.hubs) || [],
    dateFrom: String((options.filters && options.filters.dateFrom) || ''),
    dateTo: String((options.filters && options.filters.dateTo) || '')
  };
  return respond_(function () {
    return withCache('execcd_v6_' + getCacheEpoch_() + '_' + filterHash_(filters), function () {
      var centers = getCenter360RowsCD_().filter(function (row) { return centerPassesFilters_(row, filters); });
      var top = computeTopCustomersCD_(filters);
      var want = { kpis: 1, fleetStatus: 1, zohoKpis: 1, zohoTrend: 1, geo: 1, reliability: 1, uptimeFleet: 1, slaKpis: 1 };
      var specs = buildDashboardQuerySpecsCD('', filters).filter(function (s) { return want[s.key]; });
      specs.push({
        key: 'deviceAge', maxRows: 1,
        sql: "SELECT ROUND(AVG(age_days), 0) AS avg_age_days, MAX(age_days) AS max_age_days FROM (" +
             " SELECT DATE_DIFF(CURRENT_DATE(), DATE(deploymentdate), DAY) AS age_days" +
             " FROM " + T('center_details') + " WHERE deploymentdate IS NOT NULL AND " + cdFilter_() +
             multiCond_('hub_master_segment', filters.segments) + multiCond_('Status', filters.statuses) +
             multiCond_('State', filters.states) + multiCond_('HubName', filters.hubs) + ")"
      });
      var r = runQueriesParallel(specs);
      enrichCenterNamesCD_(r.reliability);
      var age = (r.deviceAge && r.deviceAge[0]) || {};

      var rollup = { centers: centers.length, devices: 0, online: 0, open_tickets: 0, attention_centers: 0 };
      centers.forEach(function (c) {
        rollup.devices += c.devices || 0; rollup.online += c.online || 0;
        rollup.open_tickets += c.open_tickets || 0;
        if ((c.open_tickets || 0) >= 4) rollup.attention_centers += 1;
      });

      var worstCenters = centers
        .filter(function (c) { return (c.open_tickets || 0) > 0; })
        .sort(function (a, b) { return b.open_tickets - a.open_tickets; })
        .slice(0, 8)
        .map(function (c) {
          return { center_id: c.center_id, center: c.center, hub: c.hub, state: c.state,
            devices: c.devices, online: c.online, open_tickets: c.open_tickets };
        });

      var cs = null;
      try { var t = readCsTracker(); cs = t && t.kpis; } catch (e) { cs = null; }

      return {
        kpis: (r.kpis && r.kpis[0]) || {}, zohoKpis: (r.zohoKpis && r.zohoKpis[0]) || {},
        fleetStatus: r.fleetStatus || [], zohoTrend: r.zohoTrend || [], geo: r.geo || [],
        reliability: r.reliability || [], rollup: rollup, worstCenters: worstCenters,
        topCustomers: top.customers.slice(0, 6), topTotals: top.totals,
        avgAgeDays: age.avg_age_days != null ? age.avg_age_days : null,
        uptimeFleet: (r.uptimeFleet && r.uptimeFleet[0]) || null,
        slaKpis: (r.slaKpis && r.slaKpis[0]) || null, cs: cs,
        fleet: jiraDeviceStats_(filters),
        edition: 'center_details', flags: FLAGS_CD
      };
    }, options.bypassCache === true);
  });
}
```

- [ ] **Step 4: Verify on live BigQuery**

Confirm `buildDashboardQuerySpecsCD('', {statuses:['ACTIVE']})`'s `deviceAge` spec (the inline
one added in Step 3) parses and runs; confirm its `avg_age_days` differs (or is at least valid)
versus the unfiltered call.

- [ ] **Step 5: Commit**

```bash
git add src/server/EditionCD.js
git commit -m "Server: Map/Top Customers/Overview thread the global filter (reverses v5.8's unsegmented-Overview contract, per design spec)"
```

---

### Task 7: Server — `jiraDeviceStats_` + device explorer filter threading

**Files:**
- Modify: `src/server/Numbers.js` (`jiraDeviceStats_`, lines 60-125)
- Modify: `src/server/Queries.js` (`buildDeviceExplorerQuery`, lines 412-447)
- Modify: `src/server/Api.js` (`apiGetDevices`, lines 27-49)

**Interfaces:**
- Consumes: `centerFilterMap_`, `centerPassesFilters_` (Task 3), `centerFilterSubqueryCond_`
  (Task 3), `filterHash_` (Task 1).
- Produces: `jiraDeviceStats_(filters)` (was `(segment)`), `buildDeviceExplorerQuery(opts)`
  where `opts.filters` is now a SEPARATE field from the pre-existing `opts.hub`/`opts.status`
  (device-local concepts — see Global Constraint), `apiGetDevices({..., filters})`.

- [ ] **Step 1: `jiraDeviceStats_(filters)` (Numbers.js:60-125)**

Change the signature/cache key (lines 60-62) and the filtering block (lines 83-92):

```js
function jiraDeviceStats_(filters) {
  filters = filters || {};
  return withCache('jiradev_v6_' + getCacheEpoch_() + '_' + filterHash_(filters), function () {
```

Replace the segment-only filter block:
```js
      // Segment filter: keep only devices mapped to a center in the selected
      // segment (center lookup via the cached Center-360 rows). Unmapped
      // devices drop out when a segment is selected — by design.
      if (segment) {
        var segMap = centerSegmentMap_();
        Object.keys(byIssue).forEach(function (ik) {
          var o = byIssue[ik];
          if (!isFinite(o.cid) || segMap[o.cid] !== segment) delete byIssue[ik];
        });
      }
```
with:
```js
      // Global filter: keep only devices mapped to a center passing the
      // filter set (center lookup via the cached Center-360 rows). Unmapped
      // devices drop out whenever ANY of Segment/Status/State/Hub is active —
      // by design, matching the existing v5.8 segment-only behavior.
      var hasCenterFilter = (filters.segments || []).length || (filters.statuses || []).length ||
        (filters.states || []).length || (filters.hubs || []).length;
      if (hasCenterFilter) {
        var cfMap = centerFilterMap_();
        Object.keys(byIssue).forEach(function (ik) {
          var o = byIssue[ik];
          if (!isFinite(o.cid) || !centerPassesFilters_(cfMap[o.cid] || {}, filters)) delete byIssue[ik];
        });
      }
```

(Date-range filtering for `jiraDeviceStats_` is handled by its CALLERS — `apiGetDashboardCD`
already filters `assetIdx` by date before computing `age_bands`/`past_life`/`avg_age_days` from
the SAME underlying `getAssetIndex_()` data; `jiraDeviceStats_`'s own `byIssue` aggregation
doesn't currently expose a per-device date filter hook and this task doesn't add one — the
`fleet.total`/`fleet.by_status` KPI reads a date-unfiltered device count deliberately, since
"how many devices exist" and "which of them were created in this date range" are different
questions and the KPI-strip total should stay date-independent. This is a scope note, not a
gap: flag it to the user if reviewed and they want date-filtering on the Total-devices KPI
specifically — not requested in the design spec.)

Replace the one remaining `centerSegmentMap_` reference check:
```bash
grep -n "centerSegmentMap_\|devSegCond_" src/server/*.js
```
Expected after this task: zero hits anywhere in `src/server/` (Task 3 added the replacements,
this task and Task 4 are the last two callers).

- [ ] **Step 2: `buildDeviceExplorerQuery(opts)` (Queries.js:412-447)**

Change the `segD` line (416) and the WHERE clause:
```js
function buildDeviceExplorerQuery(opts) {
  var FLEET_BUCKET_SQL = fleetBucketSql_();
  var sortCol = DEVICE_SORT_COLUMNS[opts.sortBy] || 'LastTimeStamp';
  var sortDir = opts.sortDir === 'asc' ? 'ASC' : 'DESC';
  var globalCond = centerFilterSubqueryCond_(opts.filters || {});
  var sql =
    "WITH d AS (SELECT DeviceID, Centername, HubName, LastTimeStamp, " +
    " BatteryLevel, CSQ, UnsyncedData, SpaceAvailable, FirmwareName, ServiceProvider, " +
    " " + FLEET_BUCKET_SQL + " AS status_bucket " +
    " FROM " + T('cloud_devices') + " WHERE TRUE" + globalCond + ") " +
```
(the rest of the function — the outer `SELECT ... WHERE (@hub = '' OR HubName = @hub) AND
(@status = '' OR status_bucket = @status) AND (@search = ...) ...` — is UNCHANGED: those are
the device-explorer's OWN local hub-text/status-bucket/search params, a separate, already-
working mechanism from the new global filter, per the Global Constraint above. Do not merge
them.)

- [ ] **Step 3: `apiGetDevices(options)` (Api.js:27-49)**

```js
function apiGetDevices(options) {
  options = options || {};
  var clean = {
    search: String(options.search || '').toLowerCase().slice(0, 80),
    hub: String(options.hub || '').slice(0, 120),
    status: String(options.status || '').slice(0, 40),
    filters: {
      segments: ((options.filters && options.filters.segments) || []).map(segClean_).filter(Boolean),
      statuses: ((options.filters && options.filters.statuses) || []).map(segClean_).filter(Boolean),
      states: ((options.filters && options.filters.states) || []).map(segClean_).filter(Boolean),
      hubs: ((options.filters && options.filters.hubs) || []).map(segClean_).filter(Boolean)
      // no dateFrom/dateTo here — cloud_devices has no "created" field to
      // range against (see the design spec's device-explorer date exemption).
    },
    sortBy: String(options.sortBy || 'last_seen'),
    sortDir: options.sortDir === 'asc' ? 'asc' : 'desc',
    page: Math.max(0, parseInt(options.page, 10) || 0),
    pageSize: Math.min(100, Math.max(5, parseInt(options.pageSize, 10) || 15))
  };
  return respond_(function () {
    var cacheKey = 'dev_v2_' + shortHash(JSON.stringify(clean));
    return withCache(cacheKey, function () {
      var query = buildDeviceExplorerQuery(clean);
      var rows = runQuery(query.sql, query.params);
      var totalRows = rows.length ? rows[0].total_rows : 0;
      rows.forEach(function (row) { delete row.total_rows; });
      return { rows: rows, totalRows: totalRows, page: clean.page, pageSize: clean.pageSize };
    });
  });
}
```

(`dev_v1_` → `dev_v2_`: shape change, `clean.segment` string replaced by `clean.filters` object
— this cache key is ALREADY per-request-parameter-hashed via `JSON.stringify(clean)`, so no
epoch is needed here, unlike the fixed-key caches in Tasks 4/6.)

- [ ] **Step 4: Verify**

```bash
grep -rn "devSegCond_\|centerSegmentMap_" src/server/
```
Expected: 0 hits (confirms every caller across Tasks 3-7 has been migrated).

Generate and run `buildDeviceExplorerQuery({filters:{statuses:['ACTIVE']}, hub:'', status:'',
search:'', sortBy:'last_seen', sortDir:'desc', page:0, pageSize:15})`'s SQL against live
BigQuery; confirm it parses and `total_rows` is `<=` the unfiltered call's.

- [ ] **Step 5: Commit**

```bash
git add src/server/Numbers.js src/server/Queries.js src/server/Api.js
git commit -m "Server: jiraDeviceStats_ + device explorer thread the global filter; devSegCond_/centerSegmentMap_ fully retired"
```

---

### Task 8: Client markup — nav reorder, delete page-filters bars, Filters button + drawer, brand/info-icon

**Files:**
- Modify: `src/client/Index.html` (tab bar, lines 81-91; delete `.page-filters` blocks at
  lines 188-197, 338-347, 456-465; new filter-drawer markup near the existing center-drawer,
  lines 860-877; brand-sub, line 26; footer, line 855)

**Interfaces:**
- Produces (Task 10 depends on these exact ids): `#globalFilterBtn`, `#filterBadge`,
  `#filterChips`, `#filterDrawer`, `#filterScrim`, `#filterDrawerClose`, per-dimension containers
  `#filterSegment` (checkbox list), `#filterStatus` (checkbox list), `#filterState` (searchable
  combobox), `#filterHub` (searchable combobox), `#filterDateFrom`/`#filterDateTo` (native date
  inputs), `#filterApplyBtn`, `#filterClearBtn`, `#appInfoDot`.

- [ ] **Step 1: Reorder the tab bar (lines 81-91)**

```html
<nav class="tabs" role="tablist" aria-label="Dashboard views">
  <!-- Overview is both the landing page AND now the first tab (2026-07-29). -->
  <button class="tab is-active" id="tab-overview" role="tab" aria-selected="true" aria-controls="panel-overview">Overview</button>
  <button class="tab" id="tab-centers" role="tab" aria-selected="false" aria-controls="panel-centers" tabindex="-1">Centers / Customers</button>
  <button class="tab" id="tab-support" role="tab" aria-selected="false" aria-controls="panel-support" tabindex="-1">Support / CS</button>
  <button class="tab" id="tab-asset"   role="tab" aria-selected="false" aria-controls="panel-asset" tabindex="-1">Asset</button>
  <button class="tab" id="tab-map" role="tab" aria-selected="false" aria-controls="panel-map" tabindex="-1">Map</button>
  <button class="tab" id="tab-topcust" role="tab" aria-selected="false" aria-controls="panel-topcust" tabindex="-1">Top Customers</button>
  <button class="tab" id="tab-numbers" role="tab" aria-selected="false" aria-controls="panel-numbers" tabindex="-1">Numbers</button>
  <button class="tab" id="tab-rawdata" role="tab" aria-selected="false" aria-controls="panel-rawdata" tabindex="-1">Raw Data</button>
</nav>
```

- [ ] **Step 2: Delete the 3 `.page-filters` blocks**

Remove lines 188-197 (Asset), 338-347 (Centers), 456-465 (Support) — each is the whole
`<div class="page-filters" role="group" ...> ... </div>` block, leaving the `page-summary`/
`kpiGrid` markup immediately after untouched.

- [ ] **Step 3: Add the global Filters button + chip row to the topbar (after the
  `#refreshBtn` button, before the theme toggle, ~line 46)**

```html
    <div class="filter-control">
      <button id="globalFilterBtn" class="btn btn-ghost" type="button" aria-haspopup="dialog" aria-expanded="false">
        <svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <span>Filters</span>
        <span id="filterBadge" class="filter-badge">1</span>
      </button>
      <div id="filterChips" class="filter-chips" role="group" aria-label="Active filters"></div>
    </div>
```

- [ ] **Step 4: Add the filter drawer, right after the existing `#centerDrawer` markup
  (~line 877)**

```html
<!-- Global filter drawer: Segment/Status/State/Hub/Date range, applies everywhere -->
<div id="filterScrim" class="drawer-scrim" hidden></div>
<aside id="filterDrawer" class="center-drawer" hidden aria-label="Filters" role="dialog" aria-modal="true">
  <header class="center-panel-head">
    <div>
      <h2 class="card-title">Filters</h2>
      <p class="card-sub">Applies across every page except Numbers and Raw Data</p>
    </div>
    <button id="filterDrawerClose" class="btn btn-ghost btn-icon" type="button" aria-label="Close filters">
      <svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </button>
  </header>
  <div class="center-panel-body">
    <section class="filter-section">
      <h3 class="filter-section-title">Segment</h3>
      <div id="filterSegment" class="filter-checklist" role="group" aria-label="Filter by segment"></div>
    </section>
    <section class="filter-section">
      <h3 class="filter-section-title">Status</h3>
      <div id="filterStatus" class="filter-checklist" role="group" aria-label="Filter by status"></div>
    </section>
    <section class="filter-section">
      <h3 class="filter-section-title">State</h3>
      <div id="filterState" class="filter-combo" data-dim="states"></div>
    </section>
    <section class="filter-section">
      <h3 class="filter-section-title">Hub</h3>
      <div id="filterHub" class="filter-combo" data-dim="hubs"></div>
    </section>
    <section class="filter-section">
      <h3 class="filter-section-title">Date range</h3>
      <div class="filter-daterange">
        <label>From <input id="filterDateFrom" class="input" type="date"></label>
        <label>To <input id="filterDateTo" class="input" type="date"></label>
      </div>
      <p class="filter-note">Centers/Map: deployment date · Support: ticket created date · Asset: Jira created date · Top Customers/Overview: Segment/Status/State/Hub only, no date · Numbers/Raw Data: exempt from all filters.</p>
    </section>
  </div>
  <footer class="center-panel-head" style="border-top:1px solid var(--border);border-bottom:none;">
    <button id="filterClearBtn" class="btn btn-ghost" type="button">Clear all</button>
    <button id="filterApplyBtn" class="btn btn-primary" type="button">Apply</button>
  </footer>
</aside>
```

- [ ] **Step 5: Brand tagline (both occurrences)**

Line 26: `<span class="brand-sub"><b>Tricog</b> · Service Insight Platform</span>` →
`<span class="brand-sub"><b>Tricog</b> · Service Insights Platform</span>` — and add an info
dot immediately after:
```html
      <span class="brand-sub"><b>Tricog</b> · Service Insights Platform
        <button id="appInfoDot" class="info-dot" type="button" aria-label="About SIP Insights" tabindex="0">i</button>
      </span>
```

Line 855 (footer): `a Tricog Service Insight Platform` → `a Tricog Service Insights Platform`.

- [ ] **Step 6: Verify markup integrity**

```bash
grep -c "<article\|<section" src/client/Index.html; grep -c "</article>\|</section>" src/client/Index.html
```
Expected: the two counts match (balanced tags) — same check style as the earlier v5.8 markup
task's sanity gate.

```bash
grep -n 'page-filters\|assetSegment\|centersSegment\|supportSegment' src/client/Index.html
```
Expected: 0 hits (fully removed — Task 10 removes the corresponding JS wiring; a transient
compile-time reference from `App.html` to a deleted id is expected and fixed in Task 10, not
here).

- [ ] **Step 7: Commit**

```bash
git add src/client/Index.html
git commit -m "Client markup: Overview first tab, global Filters button + drawer replacing 3 page-filters bars, brand tagline + info icon"
```

---

### Task 9: Client CSS — filter drawer sections, chips, badge

**Files:**
- Modify: `src/client/Styles.html` (delete `.page-filters`/`.filter-chip`/`.filter-label`/
  `.page-seg`/`.filter-note` block, lines 574-592; add new rules near the same location)

**Interfaces:** none (pure presentation; Task 10's JS reads/writes the classes/ids defined
here and in Task 8).

- [ ] **Step 1: Replace the old page-filter-bar block (lines 574-592) with the new rules**

```css
/* ── global filter control (topbar button + chips) ───────────────── */
.filter-control { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.filter-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px; margin-left: 6px;
  border-radius: 999px; font-size: 11px; font-weight: 700;
  background: var(--primary); color: #fff;
}
.filter-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.filter-chip-item {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11.5px; color: var(--text-2);
  background: var(--surface-2); border: 1px solid var(--border-strong);
  padding: 3px 6px 3px 10px; border-radius: 999px;
}
.filter-chip-item button {
  display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; border: none; border-radius: 50%;
  background: transparent; color: var(--text-3); cursor: pointer; padding: 0;
}
.filter-chip-item button:hover { background: var(--surface); color: var(--text-1); }

/* ── filter drawer sections (reuses .center-drawer/.center-panel-* shell) ── */
.filter-section { margin-bottom: 18px; }
.filter-section-title {
  font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
  color: var(--text-3); margin: 0 0 8px;
}
.filter-checklist { display: flex; flex-direction: column; gap: 6px; max-height: 180px; overflow-y: auto; }
.filter-checklist label { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: var(--text-2); }
.filter-daterange { display: flex; gap: 12px; flex-wrap: wrap; }
.filter-daterange label { font-size: 12px; color: var(--text-3); display: flex; flex-direction: column; gap: 4px; }
.filter-note { font-size: 11.5px; color: var(--text-3); margin: 8px 0 0; }

/* ── searchable multi-select combobox (State/Hub) — vanilla, no library ── */
.filter-combo { position: relative; }
.filter-combo-input { width: 100%; }
.filter-combo-list {
  position: absolute; top: 100%; left: 0; right: 0; z-index: 5;
  max-height: 200px; overflow-y: auto; margin-top: 4px;
  background: var(--surface-solid); border: 1px solid var(--border-strong);
  border-radius: 8px; box-shadow: 0 8px 24px rgba(2,10,20,.35);
  display: flex; flex-direction: column; padding: 6px;
}
.filter-combo-list label {
  display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-2);
  padding: 5px 8px; border-radius: 6px;
}
.filter-combo-list label:hover { background: var(--surface-2); }
.filter-combo-selected { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }

@media (max-width: 820px) {
  .filter-control { width: 100%; }
  .filter-chips { width: 100%; }
}
```

- [ ] **Step 2: Verify no dangling references**

```bash
grep -n "\.page-filters\|\.page-seg\b" src/client/Styles.html
```
Expected: 0 hits.

- [ ] **Step 3: Commit**

```bash
git add src/client/Styles.html
git commit -m "Client CSS: filter drawer sections, chips, badge, searchable combobox — replaces page-filters bar styles"
```

---

### Task 10: Client JS — `state.globalFilters`, drawer wiring, chips, Apply/Clear cascade

**Files:**
- Modify: `src/client/App.html` (state object, lines 16-42; delete `dashSegmentFor`, lines
  57-66; `init()`, lines 2232+; new drawer/chip/combobox functions)

**Interfaces:**
- Consumes: Task 8's element ids, Task 3-7's server response shape (`data.filters` echo).
- Produces: `state.globalFilters` (shape matches the spec/Task 4's `filters` object, PLUS a
  `pending` staging copy edited inside the drawer before Apply — see Step 2), `applyGlobalFilters()`,
  `renderFilterChips()`, `filterBadgeCount()` — later tasks (11) call these.

- [ ] **Step 1: Replace the segment-only state (lines 16-42)**

```js
  var state = {
    search: '',
    globalFilters: { segments: [], statuses: ['ACTIVE'], states: [], hubs: [], dateFrom: '', dateTo: '' },
    globalFiltersPending: null, // staged edits inside the open drawer; null when drawer is closed
    dashFilters: null,          // the filter set the CURRENT dashboard payload was fetched with
    ticketBucket: '',
    activeTab: 'tab-overview',
    devices: { status: '', sortBy: 'last_seen', sortDir: 'desc', page: 0, pageSize: 15 },
    deviceRows: [], deviceTotal: 0,
    centers: { sortBy: 'devices', sortDir: 'desc', page: 0, pageSize: 15 },
    centersWatchlistSort: 'uptime_pct',
    centerRows: [], centerTotal: 0,
    autoRefresh: true,
    countdown: REFRESH_SECONDS,
    loading: false,
    mapLoaded: false,
    mapBundle: null,
    topLoaded: false,
    topBundle: null,
    execLoaded: false,
    execData: null,
    numbersLoaded: false,
    cdRaw: { page: 0, pageSize: 25, total: 0 },
    rawData: { source: 'center_details', page: 0, pageSize: 25, total: 0 },
    theme: 'dark',
    lastDashboard: null
  };
```

Delete `dashSegmentFor` (lines 57-66) entirely — with a single global filter shared by every
page that reads the dashboard payload (Asset/Centers/Support/Overview), there's no per-tab
branching left to do; the refetch check in `activateTab` (Task 11) becomes a flat comparison
between `state.dashFilters` and `state.globalFilters`.

- [ ] **Step 2: Filter-value helpers (add near `fillSelect`, ~line 1211)**

```js
  /** Deep-enough equality for two filter objects (arrays + strings only). */
  function filtersEqual_(a, b) {
    if (!a || !b) return a === b;
    function arrEq(x, y) {
      if (x.length !== y.length) return false;
      var sx = x.slice().sort(), sy = y.slice().sort();
      return sx.every(function (v, i) { return v === sy[i]; });
    }
    return arrEq(a.segments, b.segments) && arrEq(a.statuses, b.statuses) &&
      arrEq(a.states, b.states) && arrEq(a.hubs, b.hubs) &&
      a.dateFrom === b.dateFrom && a.dateTo === b.dateTo;
  }

  function filterActiveCount_(f) {
    return f.segments.length + f.statuses.length + f.states.length + f.hubs.length +
      (f.dateFrom ? 1 : 0) + (f.dateTo ? 1 : 0);
  }

  function renderFilterBadge_() {
    var n = filterActiveCount_(state.globalFilters);
    var badge = $('filterBadge');
    badge.textContent = String(n);
    badge.hidden = false; // ALWAYS visible per the design spec — a default Status:Active still counts
  }

  /** Renders one removable chip per active filter VALUE (not per dimension). */
  function renderFilterChips_() {
    var f = state.globalFilters;
    var chips = [];
    f.segments.forEach(function (v) { chips.push({ dim: 'segments', label: 'Segment: ' + v, value: v }); });
    f.statuses.forEach(function (v) { chips.push({ dim: 'statuses', label: 'Status: ' + (v === 'ACTIVE' ? 'Active' : v), value: v }); });
    f.states.forEach(function (v) { chips.push({ dim: 'states', label: 'State: ' + v, value: v }); });
    f.hubs.forEach(function (v) { chips.push({ dim: 'hubs', label: 'Hub: ' + v, value: v }); });
    if (f.dateFrom || f.dateTo) chips.push({ dim: 'date', label: 'Date: ' + (f.dateFrom || '…') + '–' + (f.dateTo || '…'), value: null });

    $('filterChips').innerHTML = chips.map(function (c, i) {
      return '<span class="filter-chip-item" data-i="' + i + '">' + escapeHtml(c.label) +
        '<button type="button" aria-label="Remove ' + escapeHtml(c.label) + '">×</button></span>';
    }).join('');

    Array.prototype.forEach.call($('filterChips').querySelectorAll('.filter-chip-item button'), function (btn, i) {
      btn.addEventListener('click', function () {
        var c = chips[i];
        if (c.dim === 'date') { state.globalFilters.dateFrom = ''; state.globalFilters.dateTo = ''; }
        else state.globalFilters[c.dim] = state.globalFilters[c.dim].filter(function (v) { return v !== c.value; });
        commitGlobalFilters_();
      });
    });
  }
```

- [ ] **Step 3: Drawer open/close + checklist/combobox population + Apply/Clear**

```js
  var FILTER_DIM_LABELS = { segments: 'segment', statuses: 'status', states: 'state', hubs: 'hub' };

  function openFilterDrawer_() {
    state.globalFiltersPending = JSON.parse(JSON.stringify(state.globalFilters));
    renderFilterChecklist_('filterSegment', 'segments', state.lastDashboard ? (state.lastDashboard.segmentOptions || []).map(function (s) { return s.segment; }) : []);
    renderFilterChecklist_('filterStatus', 'statuses', ['ACTIVE', 'DEACTIVATED']);
    renderFilterCombo_('filterState', 'states', $('filterState').getAttribute('data-options') ? JSON.parse($('filterState').getAttribute('data-options')) : []);
    renderFilterCombo_('filterHub', 'hubs', $('filterHub').getAttribute('data-options') ? JSON.parse($('filterHub').getAttribute('data-options')) : []);
    $('filterDateFrom').value = state.globalFiltersPending.dateFrom;
    $('filterDateTo').value = state.globalFiltersPending.dateTo;
    $('filterScrim').hidden = false;
    $('filterDrawer').hidden = false;
    $('globalFilterBtn').setAttribute('aria-expanded', 'true');
  }

  function closeFilterDrawer_() {
    state.globalFiltersPending = null;
    $('filterScrim').hidden = true;
    $('filterDrawer').hidden = true;
    $('globalFilterBtn').setAttribute('aria-expanded', 'false');
  }

  /** Plain checkbox list (Segment/Status — small, known value sets). */
  function renderFilterChecklist_(containerId, dim, options) {
    var el = $(containerId);
    var current = state.globalFiltersPending[dim];
    el.innerHTML = options.map(function (opt) {
      var label = dim === 'statuses' && opt === 'ACTIVE' ? 'Active' : (dim === 'statuses' ? 'Deactivated' : opt);
      var checked = current.indexOf(opt) !== -1 ? ' checked' : '';
      return '<label><input type="checkbox" value="' + escapeHtml(opt) + '"' + checked + '> ' + escapeHtml(label) + '</label>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('input'), function (cb) {
      cb.addEventListener('change', function () {
        var v = cb.value;
        var arr = state.globalFiltersPending[dim];
        if (cb.checked && arr.indexOf(v) === -1) arr.push(v);
        else if (!cb.checked) state.globalFiltersPending[dim] = arr.filter(function (x) { return x !== v; });
      });
    });
  }

  /** Searchable multi-select combobox (State/Hub — large, unbounded value sets). */
  function renderFilterCombo_(containerId, dim, allOptions) {
    var container = $(containerId);
    container.setAttribute('data-options', JSON.stringify(allOptions));
    container.innerHTML =
      '<input type="text" class="input filter-combo-input" placeholder="Search ' + FILTER_DIM_LABELS[dim] + 's…">' +
      '<div class="filter-combo-list" hidden></div>' +
      '<div class="filter-combo-selected"></div>';
    var input = container.querySelector('.filter-combo-input');
    var list = container.querySelector('.filter-combo-list');
    var selectedEl = container.querySelector('.filter-combo-selected');

    function renderSelected() {
      var arr = state.globalFiltersPending[dim];
      selectedEl.innerHTML = arr.map(function (v, i) {
        return '<span class="filter-chip-item" data-v="' + escapeHtml(v) + '">' + escapeHtml(v) +
          '<button type="button" aria-label="Remove ' + escapeHtml(v) + '">×</button></span>';
      }).join('');
      Array.prototype.forEach.call(selectedEl.querySelectorAll('button'), function (btn) {
        btn.addEventListener('click', function () {
          var v = btn.parentElement.getAttribute('data-v');
          state.globalFiltersPending[dim] = state.globalFiltersPending[dim].filter(function (x) { return x !== v; });
          renderSelected();
        });
      });
    }

    function renderList(query) {
      var q = query.toLowerCase();
      var matches = allOptions.filter(function (v) { return v.toLowerCase().indexOf(q) !== -1; }).slice(0, 50);
      list.innerHTML = matches.map(function (v) {
        var checked = state.globalFiltersPending[dim].indexOf(v) !== -1 ? ' checked' : '';
        return '<label><input type="checkbox" value="' + escapeHtml(v) + '"' + checked + '> ' + escapeHtml(v) + '</label>';
      }).join('');
      Array.prototype.forEach.call(list.querySelectorAll('input'), function (cb) {
        cb.addEventListener('change', function () {
          var v = cb.value, arr = state.globalFiltersPending[dim];
          if (cb.checked && arr.indexOf(v) === -1) arr.push(v);
          else if (!cb.checked) state.globalFiltersPending[dim] = arr.filter(function (x) { return x !== v; });
          renderSelected();
        });
      });
    }

    input.addEventListener('focus', function () { list.hidden = false; renderList(input.value); });
    input.addEventListener('input', function () { renderList(input.value); });
    document.addEventListener('click', function (e) {
      if (!container.contains(e.target)) list.hidden = true;
    });
    renderSelected();
  }

  /** Copies the staged (pending) edits into the live filter, closes the drawer, reapplies. */
  function commitGlobalFilters_() {
    renderFilterBadge_();
    renderFilterChips_();
    // Reset every lazy-load flag so every page refetches fresh under the new
    // filter set — mirrors the old v5.7/5.8 Active-only toggle's invalidation
    // (Numbers is intentionally excluded — exempt from all filtering).
    state.execLoaded = false; state.mapLoaded = false; state.topLoaded = false;
    state.lastDashboard = null; state.cdRaw.total = 0;
    if (state.activeTab === 'tab-centers') { state.centers.page = 0; loadCenters(); }
    if (state.activeTab === 'tab-asset') { state.devices.page = 0; loadDevices(); }
    var sharesPayload = ['tab-asset', 'tab-centers', 'tab-support', 'tab-overview'].indexOf(state.activeTab) !== -1;
    if (sharesPayload) loadDashboard(false);
    if (state.activeTab === 'tab-map') { state.mapLoaded = false; loadMapData(); }
    if (state.activeTab === 'tab-topcust') { state.topLoaded = false; loadTopCustomers(); }
  }
```

- [ ] **Step 4: Wire the drawer open/close/apply/clear buttons + escape key (inside `init()`,
  replacing the old per-page-segment listener block at lines 2258-2269)**

```js
    $('globalFilterBtn').addEventListener('click', function () {
      if ($('filterDrawer').hidden) openFilterDrawer_(); else closeFilterDrawer_();
    });
    $('filterDrawerClose').addEventListener('click', closeFilterDrawer_);
    $('filterScrim').addEventListener('click', function () {
      // Clicking the scrim (not the Apply button) discards pending edits.
      if (!$('filterDrawer').hidden) closeFilterDrawer_();
    });
    $('filterApplyBtn').addEventListener('click', function () {
      state.globalFiltersPending.dateFrom = $('filterDateFrom').value || '';
      state.globalFiltersPending.dateTo = $('filterDateTo').value || '';
      var changed = !filtersEqual_(state.globalFilters, state.globalFiltersPending);
      state.globalFilters = state.globalFiltersPending;
      closeFilterDrawer_();
      if (changed) commitGlobalFilters_();
    });
    $('filterClearBtn').addEventListener('click', function () {
      state.globalFiltersPending = { segments: [], statuses: ['ACTIVE'], states: [], hubs: [], dateFrom: '', dateTo: '' };
      openFilterDrawer_(); // re-render the checklists/combos to reflect the cleared state
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !$('filterDrawer').hidden) closeFilterDrawer_();
    });

    // Reliability/health watchlist sort toggle — UNCHANGED from before, keep as-is.
    $('watchlistSort').addEventListener('change', function (event) {
      state.centersWatchlistSort = event.target.value;
      if (state.lastDashboard) {
        renderCenterWatchlist(state.lastDashboard.reliability || [], state.lastDashboard.assetHealth || [], state.centersWatchlistSort);
      }
    });
```

Also call `renderFilterBadge_()` once at the end of `init()` (after `buildKpiSkeletons()`) so
the badge shows "1" (default Status:Active) before the first dashboard load completes.

- [ ] **Step 5: Static parse check**

```bash
node -e "const s=require('fs').readFileSync('src/client/App.html','utf8');const m=s.match(/<script>([\s\S]*)<\/script>/);new Function(m[1]);console.log('parse OK')"
```
Expected: `parse OK`.

- [ ] **Step 6: Commit**

```bash
git add src/client/App.html
git commit -m "Client: state.globalFilters + drawer wiring (checklists, searchable combobox, chips, badge, Apply/Clear cascade) — replaces per-page pageSegment/dashSegmentFor"
```

---

### Task 11: Client JS — thread `globalFilters` into every `gsCall`, populate options, mocks

**Files:**
- Modify: `src/client/App.html` (`loadDashboard`, lines 534-567; `renderDashboard`, lines
  569-660; `loadCenters`, lines 1085-1088; `loadDevices` — locate via grep, same pattern as
  `loadCenters`; `loadMapData`, lines 1191-1208; `loadTopCustomers`, lines 1618-1628; `loadExec`,
  lines 1520-1529; `activateTab`, lines 1748-1787; `mockCall`, lines 84+)

**Interfaces:**
- Consumes: Task 10's `state.globalFilters`/`state.dashFilters`, Task 4-7's server response
  shapes (`data.filters` echo replacing `data.segment`).

- [ ] **Step 1: `loadDashboard` + `renderDashboard` (lines 534-567, 569-660)**

Change the `gsCall` line (548):
```js
    gsCall(ep('apiGetDashboard'), { filters: state.globalFilters, bypassCache: !!bypassCache })
```

In `renderDashboard`, replace `state.dashSegment = data.segment || '';` (line 571) with:
```js
    state.dashFilters = data.filters || null;
```

Replace the segment-select repopulation block (lines 647-655) — the drawer's Segment
checklist is populated on OPEN (Task 10, `openFilterDrawer_`) from `state.lastDashboard.segmentOptions`,
so this block is simply deleted (no `<select>` elements remain to repopulate). Also replace the
status-line segment echo (line 659):
```js
    $('lastUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString();
```
(Dropped the `· segment: X` suffix — the chip row now shows this more completely, for every
dimension, not just segment.)

Also thread `state.globalFilters`'s State/Hub option lists: after fetching `data.segmentOptions`,
ALSO expect `data.stateOptions`/`data.hubOptions` (new fields — add to `apiGetDashboardCD`'s
response in a follow-up if not already present; check Task 4's implementation — if absent,
add `results.stateOptions`/`results.hubOptions` there via a `DISTINCT` query analogous to
`segmentOptions`, since the drawer's State/Hub combobox needs a real option list to search
against, matching the existing `segmentOptions` pattern exactly). Store them for the drawer:
```js
    state.stateOptions = (data.stateOptions || []).map(function (s) { return s.state; }).filter(Boolean);
    state.hubOptions = (data.hubOptions || []).map(function (s) { return s.hub; }).filter(Boolean);
```
And in Task 10's `openFilterDrawer_`, replace the placeholder `data-options` JSON-parsing lines
with `state.stateOptions`/`state.hubOptions` directly (simpler — go back and use
`renderFilterCombo_('filterState', 'states', state.stateOptions || [])` and
`renderFilterCombo_('filterHub', 'hubs', state.hubOptions || [])`).

- [ ] **Step 2: `loadCenters`/`loadDevices` (lines 1085-1088 and its `loadDevices` sibling)**

```js
  function loadCenters() {
    var requestId = ++centersRequestId;
    $('centerTableInfo').textContent = 'Loading…';
    var query = Object.assign({}, state.centers, { search: state.search, filters: state.globalFilters });
    gsCall(ep('apiGetCenters'), query)
```

Locate `loadDevices` (grep `function loadDevices` — it follows the same
`Object.assign({}, state.devices, {...})` pattern seen at the old line 1003) and apply the
identical change: `{ search: state.search, filters: state.globalFilters }` replacing whatever
single `segment: state.pageSegment.asset` field was there.

- [ ] **Step 3: `loadMapData`, `loadTopCustomers`, `loadExec` (lines 1191, 1618, 1520)**

```js
  function loadMapData() {
    $('geoProgress').textContent = 'Loading map data…';
    gsCall(ep('apiGetMapData'), { filters: state.globalFilters })
```
```js
  function loadTopCustomers() {
    gsCall(ep('apiGetTopCustomers'), { filters: state.globalFilters })
```
```js
  function loadExec() {
    if (!state.execLoaded) Charts.setLoading(['execFleet', 'execTrend', 'execTopCust', 'execGeo']);
    gsCall(ep('apiGetExecOverview'), { filters: state.globalFilters })
```

- [ ] **Step 4: `activateTab` — replace the `dashSegmentFor` mismatch check (lines 1780-1784)**

```js
    // Shared-payload rule: Asset/Centers/Support/Overview all read the same
    // dashboard payload. Refetch if the currently-rendered payload's filter
    // set no longer matches the applied global filter (e.g. Apply was
    // clicked while looking at Map, then the user switches to Asset).
    var sharesPayload = ['tab-asset', 'tab-centers', 'tab-support', 'tab-overview'].indexOf(tabId) !== -1;
    if (sharesPayload && state.lastDashboard && !filtersEqual_(state.dashFilters, state.globalFilters)) loadDashboard(false);
```

- [ ] **Step 5: `mockCall` — update the local-preview mock (starting line 84)**

Find every mock branch keying off `args.segment` (there should be at least one, matching the
old dashboard mock's `segment: (args && args.segment) || ''` echo) and change it to echo
`filters` instead:
```js
      filters: (args && args.filters) || { segments: [], statuses: ['ACTIVE'], states: [], hubs: [], dateFrom: '', dateTo: '' },
```
Also add mock `segmentOptions`/`stateOptions`/`hubOptions` arrays (small illustrative lists — 5-8
entries each) to whichever mock object represents the `apiGetDashboard` response, so the drawer
has something to search/check in local preview.

- [ ] **Step 6: Verify**

```bash
node -e "const s=require('fs').readFileSync('src/client/App.html','utf8');const m=s.match(/<script>([\s\S]*)<\/script>/);new Function(m[1]);console.log('parse OK')"
grep -n "pageSegment\|dashSegmentFor\|dashSegment\b" src/client/App.html
```
Expected: parse OK; 0 hits on the grep (fully migrated to `globalFilters`/`dashFilters`).

- [ ] **Step 7: Commit**

```bash
git add src/client/App.html
git commit -m "Client: thread state.globalFilters into every gsCall (dashboard/centers/devices/map/top-customers/exec); activateTab refetch check generalized; mocks updated"
```

---

### Task 12: Preview verification pass

**Files:** none modified (fix-forward loop if issues found)

- [ ] **Step 1: Rebuild + start the preview** (`sip-preview` launch config). STOP any running
  instance first, then START — the build happens at server start, a reused server serves stale
  content.

- [ ] **Step 2: Structural + interaction checks**

1. Console errors: 0, at every step below.
2. Tab bar: Overview renders first; landing page unchanged (still Overview, `is-active`).
3. No `.page-filters` bars remain on Asset/Centers/Support; no `#assetSegment`/
   `#centersSegment`/`#supportSegment` elements exist.
4. Topbar shows the Filters button with badge "1" on first load (default Status:Active) and one
   chip "Status: Active ✕".
5. Open the drawer: Segment checklist populated (from mock `segmentOptions`), Status shows
   Active pre-checked, State/Hub comboboxes accept typed search and let you check/uncheck
   matches, Date-range fields are native date pickers.
6. Check 2 segments + 1 status + a date range, click Apply: badge count updates, chips render
   one per value (not per dimension), drawer closes.
7. Click a chip's ✕: that one value is removed, badge/chips update immediately, without
   reopening the drawer.
8. Clicking Filters again re-opens with the CURRENT applied state reflected in the checklists/
   combos (not stale from a previous open).
9. Switch tabs Asset → Centers → Support → Map → Top Customers → Overview → Numbers → Raw
   Data → back to Asset: no errors; Numbers/Raw Data show no filter UI and their own "no
   filters apply" copy is unchanged.
10. Brand tagline reads "Service Insights Platform" (both header and footer); the new ⓘ next
    to the header tagline shows a popover with the drafted "about SIP Insights" copy on
    hover/click, matching the existing METRIC_INFO popover's visual style.
11. Mobile viewport (375×812): filter control wraps, no horizontal page-body scroll.
12. Both themes (dark/light): filter chips/badge/drawer legible in each.

- [ ] **Step 3: Fix-forward.** Any failure: read the source, fix, STOP+START the preview,
  re-check from Step 2. Commit fixes as they land:

```bash
git add -A src/client && git commit -m "Preview fixes from verification pass"
```

---

### Task 13: Extend the Jest reconciliation suite; live-BQ full pass; deploy

**Files:**
- Modify: `test/reconcile/center-grain.test.js` (add multi-value + date-range invariants)
- Modify: `HANDOFF.md` (version bump + summary)

- [ ] **Step 1: Add multi-value and date-range reconciliation tests**

Append to `test/reconcile/center-grain.test.js`:

```js
test('multi-value segment filter: 2 segments selected sums to each selected individually (no double-counting)', async function () {
  var specs = sandbox.buildDashboardQuerySpecsCD('', {});
  var segOptRows = await runQuery(specs.find(function (s) { return s.key === 'segmentOptions'; }).sql);
  var segs = segOptRows.map(function (r) { return r.segment; }).slice(0, 2);
  if (segs.length < 2) return; // skip gracefully if fewer than 2 real segments exist
  var eachTotal = 0;
  for (var i = 0; i < segs.length; i++) {
    var s1 = sandbox.buildDashboardQuerySpecsCD('', { segments: [segs[i]] });
    var r1 = await runQuery(s1.find(function (s) { return s.key === 'centerKpis'; }).sql);
    eachTotal += r1[0].centers;
  }
  var sBoth = sandbox.buildDashboardQuerySpecsCD('', { segments: segs });
  var rBoth = await runQuery(sBoth.find(function (s) { return s.key === 'centerKpis'; }).sql);
  expect(rBoth[0].centers).toBe(eachTotal); // a center holds exactly one segment value — no overlap possible
});

test('date-range filter narrows deploymentAge band totals versus unfiltered', async function () {
  var unfiltered = sandbox.buildDashboardQuerySpecsCD('', {});
  var uRows = await runQuery(unfiltered.find(function (s) { return s.key === 'deploymentAge'; }).sql);
  var uTotal = uRows.reduce(function (sum, r) { return sum + r.devices; }, 0);
  var filtered = sandbox.buildDashboardQuerySpecsCD('', { dateFrom: '2024-01-01', dateTo: '2024-12-31' });
  var fRows = await runQuery(filtered.find(function (s) { return s.key === 'deploymentAge'; }).sql);
  var fTotal = fRows.reduce(function (sum, r) { return sum + r.devices; }, 0);
  expect(fTotal).toBeLessThanOrEqual(uTotal);
});
```

- [ ] **Step 2: Run the full suite**

```bash
npm test
GOOGLE_APPLICATION_CREDENTIALS="<path>" npm run test:reconcile
```
Expected: all unit tests pass (41+); reconciliation tests pass against whichever BigQuery
project the credential targets (record which — sandbox or tricogde-dwh — in the commit
message, per this session's established practice of never silently assuming).

- [ ] **Step 3: `clasp push` (editor content only — NOT a deploy)**

```bash
clasp push --force
```
Then re-pull and diff against `src/` (established verification pattern from earlier this
session) to confirm the editor content matches git HEAD byte-for-byte (modulo known Google-
editor mojibake in comment lines).

- [ ] **Step 4: Update HANDOFF.md**

Add a dated entry: nav reorder, the universal filter (5 dimensions, multi-select, default
Status:Active), the Center-360 JS-predicate architecture decision (vs. the spec's SQL-threading
assumption) and why, the cache-epoch mechanism replacing segment enumeration, brand tagline +
info icon. State plainly that **production has NOT been redeployed** — this plan only pushes
editor content and commits to git; deploying to the live stable URL requires the same explicit
user go-ahead this session has required twice already.

```bash
git add test/reconcile/center-grain.test.js HANDOFF.md
git commit -m "docs+tests: HANDOFF entry for global nav + universal filter; multi-value/date-range reconciliation coverage"
```

- [ ] **Step 5: STOP — do not run `clasp deploy`.** Report completion to the user and wait for
  explicit authorization before touching the live production deployment, per this session's
  established, twice-reinforced convention.

---

## Self-Review Notes

- **Spec coverage:** §2 (nav) → Task 8 Step 1. §3 (filter data model incl. default Status) →
  Task 10 Step 1. §4.1 (`multiCond_`) → Task 1. §4.2 (column-ownership nuance,
  `centerFilterSubqueryCond_`) → Task 3. §4.3 (date range, page-interpreted) → Tasks 4, 6, 7 (each
  page's own date field). §4.4 (exemptions: Numbers/RawData total, TopCust/Overview date-only) →
  respected throughout (Numbers.js/RawData untouched by any task; TopCust/Overview get
  Segment/Status/State/Hub in Task 6 but no `dateFrom`/`dateTo` threading in
  `computeTopCustomersCD_`/rollup). §5 (cache epoch) → Task 2. §6 (UI: button, panel, chips,
  badge, searchable combo, footer) → Tasks 8-10. §6.1 (refetch cascade) → Task 10 Step 3
  (`commitGlobalFilters_`). §8 (brand + info icon) → Task 8 Step 5. §9 (verification plan) →
  Tasks 1, 3, 4-7's per-step BQ checks + Task 12 (preview) + Task 13 (reconciliation suite +
  live pass).
- **Documented deviation from the spec (not a gap):** Center-360-derived filtering uses a JS
  predicate over one globally-cached fetch, not SQL-threaded per-filter-set caching — see the
  Global Constraints section; this was discovered by reading the ACTUAL current code (which had
  already diverged from what the spec assumed) before writing tasks, exactly the discipline this
  session's earlier QA incident established as necessary.
- **Type consistency check:** `filters` object shape
  (`{segments,statuses,states,hubs,dateFrom,dateTo}`) is identical across every task — Task 1's
  `filterHash_`, Task 3's `centerPassesFilters_`/`centerFilterSubqueryCond_`, Task 4's
  `apiGetDashboardCD`, Task 5's `apiGetCentersCD`, Task 6's three endpoints, Task 7's
  `jiraDeviceStats_`/`buildDeviceExplorerQuery`, and Task 10/11's client `state.globalFilters` —
  same 6 keys, same types, everywhere. `centerFilterMap_()`'s return shape
  (`{segment,status,state,hub}` per center) matches exactly what `centerPassesFilters_` expects
  as its `row` argument.
- **No placeholders:** every SQL/JS change is written in full, not summarized, except the two
  explicitly-marked "rest of function body unchanged — copy verbatim" notes in Task 6 (which
  name the exact unchanged variable names so a diff can be verified precisely) and Task 11's
  "locate `loadDevices` via grep" (which gives the exact pattern to match, since the file wasn't
  re-read at that specific location in this session — mirrors what Task 7 did with `grep`-gated
  deletions in the prior filter project, an established, accepted pattern in this repo's plans).
