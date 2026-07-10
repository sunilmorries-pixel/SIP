# Page-Level Filters + KPI Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the topbar Hub/Segment/Active-only controls with per-page filter bars (fixed "Active · Paid centers" baseline + a Segment dropdown that filters everything on the page server-side), and apply the 13 approved KPI corrections from the 2026-07-10 audit.

**Architecture:** Apps Script web app (server `src/server/*.js`, client `src/client/*.html` partials) over BigQuery `magnaquest-sand-box.abi_team_sip_devtest_poc` + two Google Sheets. The client's `ep()` helper routes every call to the `*CD` endpoints in `EditionCD.js`. The segment filter threads as a sanitized SQL literal through the existing spec-builder chain (same pattern as the old `activeOnly` flag); Jira-sheet metrics filter in JS via the cached Center-360 rows.

**Tech Stack:** Google Apps Script (ES5 syntax — `var`, no arrow functions in `src/`), BigQuery Standard SQL, vanilla JS client, ECharts, clasp 3.3.0 for deploy.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-10-page-filters-and-kpi-corrections-design.md` — read it before starting.
- **ES5 only in `src/`** — Apps Script runtime; match surrounding style (`var`, `function`, string concat SQL).
- **Apps Script executes files alphabetically** — never reference another file's globals in *top-level statements*; runtime function calls are fine.
- **Fixed baseline filter (exact):** `IFNULL(F2P_Customer, 0) = 0 AND Status = 'ACTIVE'` on every `center_details` read (exception: Raw Data page stays raw; `apiGetCenterDetailsRaw` on the Numbers page keeps the baseline).
- **Segment sanitization (exact):** `String(segment || '').slice(0, 80).replace(/['"\\]/g, '')` — segment reaches SQL as a quoted literal, never raw.
- **Cache keys this round:** `dashcd_v5_<slug>`, `ctr360cd_v5`, `mapcd_v5`, `topcustcd_v5`, `execcd_v5`, `numbers_v4`, `jiradev_v5_<slug>`, `assets_v3` (unchanged) — `<slug>` = `segSlug_(segment)`; all `_a` active-suffix variants are deleted.
- **No test framework exists.** Verification per established pattern: (a) server SQL — node script evals `Config.js + SlaCatalog.js + Queries.js + EditionCD.js`, emits SQL, pipes to `bq query` stdin with `$env:CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE = '<repo>\credentials\abi_team_sip_bq_access_service_account.json'`; (b) client — `scripts/build_preview.ps1` via the `sip-preview` launch config (STOP + START the server after client edits; a reused server serves a stale build).
- **BQ from PowerShell:** avoid backticks — always pipe SQL files to `bq query` stdin. Scratch files go under the session scratchpad, NOT `/tmp`.
- **Commit after every task.** Git commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Do not deploy until Task 8.** `clasp push --force` then `clasp deploy -i AKfycbwV6hHzDT1ZjkH49aFxVfoLF9wcFrBtv9FzrYzdd5RA9R3HAVOMcXrOgzwthI49KK7x -d "<desc>"` (stable URL, version bumps).

---

### Task 1: Server — fixed Active+Paid baseline, remove `activeOnly` everywhere

**Files:**
- Modify: `src/server/EditionCD.js` (cdFilter_, centerUptimeSqlCD_, buildDashboardQuerySpecsCD, getCenter360RowsCD_, enrichCenterNamesCD_, all 6 `apiGet*CD` endpoints)
- Modify: `src/server/Numbers.js:117-218` (apiGetNumbers, apiGetCenterDetailsRaw)
- Modify: `src/server/Setup.js:127-142` (clearDashboardCache — mechanical key bump only; final rewrite comes in Task 2)

**Interfaces:**
- Consumes: existing `CD_SEG_FILTER` (`EditionCD.js:34`), `withCache`, `cacheGetLarge`/`cachePutLarge`, `shortHash`.
- Produces (later tasks rely on these exact signatures):
  - `cdFilter_()` — zero args → `"IFNULL(F2P_Customer, 0) = 0 AND Status = 'ACTIVE'"`
  - `centerUptimeSqlCD_(tailSelect)` — one arg (Task 2 adds the second `segment` arg)
  - `buildDashboardQuerySpecsCD(hub)` — one arg (Task 2 adds `segment`)
  - `getCenter360RowsCD_()` — zero args, cache key `ctr360cd_v5`
  - `enrichCenterNamesCD_(rows)` — one arg
  - `apiGetDashboardCD({bypassCache})`, `apiGetCentersCD({search,segment,sortBy,sortDir,page,pageSize})`, `apiGetMapDataCD()`, `apiGetTopCustomersCD()`, `apiGetExecOverviewCD()`, `apiGetNumbers({bypassCache})`, `apiGetCenterDetailsRaw({page,pageSize})` — none accept `activeOnly`.

- [ ] **Step 1: Rewrite `cdFilter_` (EditionCD.js:36-39)**

```js
/** center_details WHERE fragment — the FIXED page baseline (2026-07-10 design):
 *  F2P excluded AND Status = 'ACTIVE', always on, no user toggle.
 *  (F2P half is dormant until DE populates the flag; Status half is live.) */
function cdFilter_() {
  return CD_SEG_FILTER + " AND Status = 'ACTIVE'";
}
```

- [ ] **Step 2: Strip `activeOnly` from every EditionCD.js call site**

Apply exactly these mechanical edits (all in `src/server/EditionCD.js`):
- `centerUptimeSqlCD_(tailSelect, activeOnly)` → `centerUptimeSqlCD_(tailSelect)`; inside, `cdFilter_(activeOnly)` → `cdFilter_()` (line 68).
- `buildDashboardQuerySpecsCD(hub, activeOnly)` → `buildDashboardQuerySpecsCD(hub)`; `var F = cdFilter_(activeOnly)` → `var F = cdFilter_()`; drop the trailing `, activeOnly` argument from the three `centerUptimeSqlCD_(...)` calls (lines 134, 142, 145).
- `getCenter360RowsCD_(activeOnly)` → `getCenter360RowsCD_()`; cache key line 256 → `var ckey = 'ctr360cd_v5';`; `cdFilter_(activeOnly)` → `cdFilter_()` (line 274); `centerUptimeSqlCD_("SELECT center_id, ... FROM scored", activeOnly)` → one-arg call (line 312).
- `enrichCenterNamesCD_(rows, activeOnly)` → `enrichCenterNamesCD_(rows)`; inner `getCenter360RowsCD_(activeOnly)` → `getCenter360RowsCD_()` (line 339).
- `apiGetDashboardCD`: delete `var activeOnly = options.activeOnly === true;` (line 366); cache key line 368 → `'dashcd_v5_' + shortHash(hub)` (Task 2 adds the slug); `buildDashboardQuerySpecsCD(hub, activeOnly)` → `(hub)`; `enrichCenterNamesCD_(results.reliability, activeOnly)` → one-arg (×2); delete `results.activeOnly = activeOnly;` (line 378).
- `apiGetCentersCD`: delete the `activeOnly` var (line 402); `getCenter360RowsCD_(activeOnly)` → `()`.
- `apiGetMapDataCD`: delete `activeOnly` var; both cache key expressions (lines 428, 474) → `'mapcd_v5'`; `getCenter360RowsCD_()` zero-arg.
- `computeTopCustomersCD_(activeOnly)` → `computeTopCustomersCD_()`; inner `getCenter360RowsCD_()`.
- `apiGetTopCustomersCD`: key → `'topcustcd_v5'`; `computeTopCustomersCD_()`.
- `apiGetExecOverviewCD`: key → `'execcd_v5'`; `getCenter360RowsCD_()`, `computeTopCustomersCD_()`, `buildDashboardQuerySpecsCD('')`, `cdFilter_()` in the deviceAge spec (line 562), `enrichCenterNamesCD_(r.reliability)`.

After this step run: `grep -n "activeOnly" src/server/EditionCD.js` → expected **0 hits**.

- [ ] **Step 3: Strip `activeOnly` from Numbers.js**

- `apiGetNumbers`: delete `var activeOnly = ...` (line 119); cache key line 121 → `'numbers_v4'`; `var F = cdFilter_(activeOnly)` → `var F = cdFilter_();` and update the trailing comment to `// fixed baseline: F2P excluded + Status='ACTIVE'`.
- `apiGetCenterDetailsRaw`: delete `var activeOnly = ...` (line 196); `cdFilter_(activeOnly)` → `cdFilter_()` (line 205).

Run: `grep -n "activeOnly" src/server/*.js` → expected **0 hits**.

- [ ] **Step 4: Mechanical key bump in `clearDashboardCache` (Setup.js:127-142)**

Replace the two key arrays (full rewrite lands in Task 2):

```js
  cache.removeAll(['dash_v7_' + h, 'dashcd_v5_' + h, 'exec_v4', 'execcd_v5',
    'topcust_v1', 'topcustcd_v5', 'numbers_v4', 'jiradev_v4']);
  // Large (gzip-chunked) caches: remove #meta + each chunk.
  ['ctr360_v3', 'ctr360cd_v5', 'map_v3', 'mapcd_v5', 'assets_v3',
    'rawsheet_v1_' + CONFIG.JIRA_SHEET_ID, 'rawsheet_v1_' + CONFIG.CS_SHEET_ID].forEach(function (base) {
```

- [ ] **Step 5: Verify the changed SQL on live BQ**

Write `<scratchpad>\gen_task1.js` (reuse the established eval pattern):

```js
const fs = require('fs'), path = require('path');
global.CONFIG = null;
const SRC = 'C:/Users/Sunil Morries J/Desktop/demo-sip/src/server/';
// Minimal stubs so the eval'd files load without the Apps Script runtime:
global.Logger = { log: function(){} };
['Config.js', 'SlaCatalog.js', 'Queries.js', 'EditionCD.js'].forEach(f =>
  eval.call(global, fs.readFileSync(SRC + f, 'utf8')));
const out = process.argv[2];
// 1. centerKpis under the new fixed baseline
const specs = buildDashboardQuerySpecsCD('');
fs.writeFileSync(out + '/q_centerKpis.sql', specs.find(s => s.key === 'centerKpis').sql);
fs.writeFileSync(out + '/q_uptimeFleet.sql', specs.find(s => s.key === 'uptimeFleet').sql);
console.log('SQL written');
```

Run (Bash tool; note the abs scratchpad path, not /tmp):
```bash
export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="C:\\Users\\Sunil Morries J\\Desktop\\demo-sip\\credentials\\abi_team_sip_bq_access_service_account.json"
node "<scratchpad>/gen_task1.js" "<scratchpad>"
bq query --project_id=magnaquest-sand-box --use_legacy_sql=false < "<scratchpad>/q_centerKpis.sql"
bq query --project_id=magnaquest-sand-box --use_legacy_sql=false < "<scratchpad>/q_uptimeFleet.sql"
```

Expected: `centers` drops from ~27,410 to the ACTIVE-only count (~18,400–18,500 band; record the actual); `uptimeFleet.scored` drops similarly and `avg_uptime` stays in the 99.x range. If `centers` does NOT drop, the baseline isn't applied — stop and fix.

- [ ] **Step 6: Commit**

```bash
git add src/server/EditionCD.js src/server/Numbers.js src/server/Setup.js
git commit -m "Server: fixed Active+Paid baseline (cdFilter_ no-arg), activeOnly removed, cache keys v5"
```

---

### Task 2: Server — segment parameter threading + slugged caches

**Files:**
- Modify: `src/server/Queries.js` (new helpers near the top by `HUB_FILTER_SQL` ~line 61; `buildDashboardQuerySpecs` signature + zoho/device specs)
- Modify: `src/server/EditionCD.js` (thread `segment` through builder, uptime engine, dashboard endpoint; JS-filter the Jira metrics)
- Modify: `src/server/Numbers.js` (`jiraDeviceStats_(segment)`)
- Modify: `src/server/Setup.js` (final `clearDashboardCache` rewrite)

**Interfaces:**
- Consumes: Task 1 signatures (`cdFilter_()`, `getCenter360RowsCD_()`).
- Produces (exact — client Task 5 and later steps depend on these):
  - `segClean_(segment)` → sanitized string (Queries.js)
  - `segSlug_(segment)` → `'all'` or lowercased `[a-z0-9-]` slug (Queries.js)
  - `cdSegCond_(segment)` → `''` or `" AND TRIM(IFNULL(hub_master_segment,'')) = '<s>'"` (Queries.js)
  - `devSegCond_(segment)` → `''` or `" AND CenterID IN (SELECT DISTINCT CenterID FROM <center_details> WHERE <baseline><segCond>)"` (Queries.js)
  - `buildDashboardQuerySpecs(hub, segment)` — segment optional, default `''`
  - `buildDashboardQuerySpecsCD(hub, segment)`
  - `centerUptimeSqlCD_(tailSelect, segment)`
  - `jiraDeviceStats_(segment)` — cache `'jiradev_v5_' + segSlug_(segment)`
  - `centerSegmentMap_()` → `{center_id: segment}` built from `getCenter360RowsCD_()` (EditionCD.js)
  - `apiGetDashboardCD({segment, bypassCache})` — cache `'dashcd_v5_' + segSlug_(segment) + '_' + shortHash(hub)`
  - Payload additions: `results.segment` (echo of applied segment)

- [ ] **Step 1: Add the four helpers to Queries.js** (immediately after the `HUB_FILTER_SQL` definition ~line 61)

```js
/* ── Segment filter helpers (page-level Segment dropdown, 2026-07-10) ──
 * The segment value is user input → sanitize before inlining as a SQL literal.
 * hub_master_segment exists on BOTH center_details and zoho_data, so cdSegCond_
 * works for either table; cloud_devices has no segment → devSegCond_ bridges
 * via CenterID against the baseline-filtered center universe. */
function segClean_(segment) {
  return String(segment || '').slice(0, 80).replace(/['"\\]/g, '');
}
function segSlug_(segment) {
  var s = segClean_(segment).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'all';
}
function cdSegCond_(segment) {
  var s = segClean_(segment);
  return s ? " AND TRIM(IFNULL(hub_master_segment,'')) = '" + s + "'" : '';
}
function devSegCond_(segment) {
  var s = segClean_(segment);
  if (!s) return '';
  return " AND CenterID IN (SELECT DISTINCT CenterID FROM " + T('center_details') +
    " WHERE " + cdFilter_() + cdSegCond_(segment) + ")";
}
```

(`cdFilter_` lives in EditionCD.js — runtime call from Queries.js is safe; only top-level cross-file references are forbidden.)

- [ ] **Step 2: Thread segment through `buildDashboardQuerySpecs` (Queries.js:172)**

Change the signature to `function buildDashboardQuerySpecs(hub, segment)` and add `var segZ = cdSegCond_(segment); var segD = devSegCond_(segment);` at the top. Then:
- **Device specs** — append `segD` inside the WHERE of `kpis` (~line 180: `... WHERE " + HUB_FILTER_SQL + segD`), `fleetStatus` (~line 202), `firmware` (~line 210: goes alongside the existing 30-day recency condition).
- **Zoho specs** — append `segZ` to the WHERE of the inner `t` CTE (the one selecting `FROM zoho_data`) in: `zohoKpis` (line 326), `slaKpis` (line 343), `slaByType` (line 367), `zohoTrend` (line 383), `zohoOpenByStatus` (line 397), `zohoCategories` (line 406 — note this spec filters `HUB_FILTER_SQL` in the *outer* select; put `segZ` in the inner `t` CTE by adding `hub_master_segment` awareness: simplest is appending `segZ` to the outer WHERE alongside `HUB_FILTER_SQL` after adding `hub_master_segment` to the inner SELECT — do the same for `zohoPriority`, `zohoChannel`, `zohoSegment`).

Concrete pattern for the four 90-day charts (`zohoCategories` shown; repeat for priority/channel/segment):

```js
sql:
  "WITH t AS (SELECT IssueCategory, HubName, hub_master_segment, " +
  " SAFE.PARSE_DATETIME('" + CONFIG.ZOHO_DT_FORMAT + "', CreatedAt) AS created " +
  " FROM " + T('zoho_data') + ") " +
  "SELECT IFNULL(NULLIF(TRIM(IssueCategory), ''), 'Uncategorised') AS category, COUNT(*) AS cnt " +
  "FROM t WHERE " + HUB_FILTER_SQL + segZ + " AND created >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 90 DAY) " +
  "GROUP BY category ORDER BY cnt DESC LIMIT 10"
```

For `zohoKpis`/`slaKpis`/`slaByType`/`zohoTrend`: their `t` CTE already selects `FROM zoho_data WHERE HUB_FILTER_SQL` — append `+ segZ` right after `HUB_FILTER_SQL` inside that CTE. For `zohoOpenByStatus`: append `+ segZ` after `HUB_FILTER_SQL` in its flat WHERE.

Legacy callers (`execSpecs_` in ExecOverview.js) pass no second arg → `segment` is `undefined` → `segClean_` returns `''` → no-ops. No edits needed there.

- [ ] **Step 3: Thread segment through EditionCD.js**

- `centerUptimeSqlCD_(tailSelect, segment)` — signature gains `segment`; birth CTE (line 68) becomes:
  ```js
  "  FROM " + T('center_details') + " WHERE deploymentdate IS NOT NULL AND " + cdFilter_() + cdSegCond_(segment) + " GROUP BY CenterID), " +
  ```
- `buildDashboardQuerySpecsCD(hub, segment)` — signature gains `segment`; add `var SC = cdSegCond_(segment);` after `var F = cdFilter_();`. Append `+ SC` to the WHERE of `centerKpis`, `geo`, `deploymentAge`, `activeVsEnded`, `hubs`. Pass `segment` as the second arg to the three `centerUptimeSqlCD_` calls (`reliability`, `uptimeFleet`, `assetHealth`). The delegate call becomes `buildDashboardQuerySpecs(hub, segment)`. Leave `segmentOptions` UNSEGMENTED (dropdown must always list all values) — its WHERE keeps plain `F`. Leave `zohoFailByCenter` unsegmented (cohort centers are already segment-matched on the asset side).
- New helper after `enrichCenterNamesCD_`:
  ```js
  /** center_id → segment lookup from the cached Center-360 rows (baseline-filtered). */
  function centerSegmentMap_() {
    var m = {};
    getCenter360RowsCD_().forEach(function (r) { m[r.center_id] = r.segment || ''; });
    return m;
  }
  ```
- `apiGetDashboardCD(options)`:
  ```js
  function apiGetDashboardCD(options) {
    options = options || {};
    var hub = String(options.hub || '').slice(0, 120);
    var segment = segClean_(options.segment);
    return respond_(function () {
      return withCache('dashcd_v5_' + segSlug_(segment) + '_' + shortHash(hub), function () {
        var results = runQueriesParallel(buildDashboardQuerySpecsCD(hub, segment));
        enrichCenterNamesCD_(results.reliability);
        enrichCenterNamesCD_(results.assetHealth);
        // Jira metrics from the Sheet index; when a segment is selected, keep only
        // assets whose center belongs to it (unmapped devices drop out — by design).
        var assetIdx = getAssetIndex_();
        if (segment) {
          var segMap = centerSegmentMap_();
          assetIdx = assetIdx.filter(function (a) {
            return a.center_id != null && segMap[a.center_id] === segment;
          });
        }
        results.assets = assetsDonutFromIndex_(assetIdx);
        results.cohortReliability = cohortFromIndex_(assetIdx, results.zohoFailByCenter);
        delete results.zohoFailByCenter;
        results.csTracker = readCsTracker();
        results.appName = CONFIG.APP_NAME;
        results.appVersion = CONFIG.APP_VERSION;
        results.fleet = jiraDeviceStats_(segment);
        results.segment = segment;
        results.edition = 'center_details';
        results.flags = FLAGS_CD;
        results.hub = hub;
        return results;
      }, options.bypassCache === true);
    });
  }
  ```

- [ ] **Step 4: `jiraDeviceStats_(segment)` in Numbers.js** — three precise edits; every other line of the function stays byte-identical:

Edit A — signature + cache key (lines 56-57):
```js
function jiraDeviceStats_(segment) {
  segment = segClean_(segment);
  return withCache('jiradev_v5_' + segSlug_(segment), function () {
```

Edit B — insert between the `jiraRows.forEach(...)` closing (`});` at line 79) and `var dTotal = 0, ...` (line 80):
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

Edit C — none to callers: `apiGetNumbers` keeps calling `jiraDeviceStats_()` with no argument (Numbers page has no filter bar); `apiGetExecOverviewCD`'s `results.fleet = jiraDeviceStats_()` likewise stays unsegmented; only `apiGetDashboardCD` (Step 3) passes `segment`.

- [ ] **Step 5: Final `clearDashboardCache` rewrite (Setup.js:127-142)**

```js
function clearDashboardCache() {
  var cache = CacheService.getScriptCache();
  var h = shortHash('');
  // Segment-sliced keys: one per real segment value + 'all'.
  var slugs = ['all'];
  try {
    runQuery("SELECT DISTINCT TRIM(hub_master_segment) AS s FROM " + T('center_details') +
      " WHERE NULLIF(TRIM(hub_master_segment), '') IS NOT NULL")
      .forEach(function (r) { slugs.push(segSlug_(r.s)); });
  } catch (e) { /* BQ unavailable → clear the 'all' slice at least */ }
  var small = ['dash_v7_' + h, 'exec_v4', 'execcd_v5', 'topcust_v1', 'topcustcd_v5', 'numbers_v4'];
  slugs.forEach(function (sg) {
    small.push('dashcd_v5_' + sg + '_' + h);
    small.push('jiradev_v5_' + sg);
  });
  cache.removeAll(small);
  // Large (gzip-chunked) caches: remove #meta + each chunk.
  ['ctr360_v3', 'ctr360cd_v5', 'map_v3', 'mapcd_v5', 'assets_v3',
    'rawsheet_v1_' + CONFIG.JIRA_SHEET_ID, 'rawsheet_v1_' + CONFIG.CS_SHEET_ID].forEach(function (base) {
    var meta = cache.get(base + '#meta');
    var n = meta ? parseInt(meta, 10) : 40;
    var keys = [base + '#meta'];
    for (var i = 0; i < n; i++) keys.push(base + '#' + i);
    cache.removeAll(keys);
  });
  Logger.log('Caches cleared (' + slugs.length + ' segment slices) — next load recomputes.');
}
```

- [ ] **Step 6: Verify segment SQL on live BQ**

Extend the Task 1 gen script (`gen_task2.js`): first capture the exact segment strings, then generate segment-filtered SQL with a real value:

```js
// after the evals:
fs.writeFileSync(out + '/q_segvals.sql',
  "SELECT DISTINCT TRIM(hub_master_segment) AS s, COUNT(DISTINCT CenterID) AS n FROM `magnaquest-sand-box.abi_team_sip_devtest_poc.center_details` WHERE IFNULL(F2P_Customer,0)=0 AND Status='ACTIVE' GROUP BY s ORDER BY n DESC");
```

Run that first; pick the top segment value **verbatim** (e.g. `Private - SME` — confirm exact spacing from the output). Then:

```js
const specsSeg = buildDashboardQuerySpecsCD('', '<EXACT SEGMENT>');
fs.writeFileSync(out + '/q_centerKpis_seg.sql', specsSeg.find(s => s.key === 'centerKpis').sql);
fs.writeFileSync(out + '/q_uptimeFleet_seg.sql', specsSeg.find(s => s.key === 'uptimeFleet').sql);
fs.writeFileSync(out + '/q_zohoKpis_seg.sql', specsSeg.find(s => s.key === 'zohoKpis').sql.replace(/@hub/g, "''"));
fs.writeFileSync(out + '/q_kpis_seg.sql', specsSeg.find(s => s.key === 'kpis').sql.replace(/@hub/g, "''"));
```

Checks (record actuals in the commit message):
1. `q_segvals` — segment values + per-segment ACTIVE center counts; their SUM plus blank-segment centers must equal the Task 1 `centers` total.
2. `q_centerKpis_seg.centers` == that segment's count from check 1.
3. `q_uptimeFleet_seg.scored` ≤ segment center count; `avg_uptime` plausible (97–100).
4. `q_zohoKpis_seg.open_tickets` < the unsegmented open count.
5. `q_kpis_seg.total_devices` < the unsegmented cloud_devices count (subquery works).

- [ ] **Step 7: Commit**

```bash
git add src/server/Queries.js src/server/EditionCD.js src/server/Numbers.js src/server/Setup.js
git commit -m "Server: segment filter threading (center/zoho/device/jira grains) + slugged caches"
```

---

### Task 3: Server — corrections (geo dedup, open-age recompute, dead code)

**Files:**
- Modify: `src/server/EditionCD.js:110-112` (geo spec)
- Modify: `src/server/Queries.js` (zohoKpis avg_open_age; delete dead specs/builders)
- Modify: `src/server/Api.js` (delete legacy `apiGetDashboard`)

**Interfaces:**
- Consumes: Task 2 helpers.
- Produces: `geo` spec rows keep the field names `{state, devices}` (client chart untouched by this task — label fix is Task 6); `zohoKpis` keeps field name `avg_open_age_days`.

- [ ] **Step 1: Geo dedup fix (EditionCD.js `geo` spec)**

```js
    geo:
      // Distinct CENTERS per state (the reload duplicated rows; every other
      // Centers metric dedupes — this one was still COUNT(*)). Field name stays
      // `devices` for client-payload compatibility; the card is retitled
      // "Centers by state" client-side.
      "SELECT IFNULL(NULLIF(TRIM(State), ''), 'Unknown') AS state, COUNT(DISTINCT CenterID) AS devices " +
      "FROM " + CD + " WHERE " + F + SC + " GROUP BY state ORDER BY devices DESC LIMIT 12",
```

- [ ] **Step 2: Recompute `avg_open_age_days` from dates (Queries.js zohoKpis, line 332)**

Replace the `avg_open_age_days` expression:

```js
        " ROUND(AVG(IF(status NOT IN " + CONFIG.ZOHO_TERMINAL_STATUSES + " AND created IS NOT NULL, " +
        "   DATETIME_DIFF(CURRENT_DATETIME(), created, HOUR) / 24.0, NULL)), 1) AS avg_open_age_days " +
```

(`created` is already available in the `t` CTE via `zohoParsedDates_()`; `TicketActiveDays` may be removed from the CTE's SELECT once nothing reads it.)

- [ ] **Step 3: Dead-code deletion — verify references FIRST**

Run each grep; delete only what has **zero remaining callers**:
```bash
grep -rn "apiGetDashboard\b" src/ | grep -v CD          # expect: only the definition in Api.js + client mockCall names
grep -rn "cohortReliabilitySql_" src/                   # expect: definition + the buildDashboardQuerySpecs spec entry
grep -rn "buildAssetSourceSpecs" src/                   # expect: definition only
grep -rn "jiraTypeFilterSql_" src/                      # check what still calls it after the above deletions
grep -rn "hubOptions" src/                              # spec + renderHubOptions + datalist (client removal in Tasks 4-5)
```
Then delete from the server:
- `Api.js`: the whole legacy `apiGetDashboard` function (lines ~25-42).
- `Queries.js`: the `assets` spec entry and the `cohortReliability` spec entry inside `buildDashboardQuerySpecs`; the `cohortReliabilitySql_` function (~lines 126-158); `buildAssetSourceSpecs` (if zero refs); `jiraTypeFilterSql_` (only if zero refs remain after the two deletions).
- **Keep** the `hubOptions` spec until Task 5 removes the client reference, then delete it here? No — delete the spec NOW and delete `renderHubOptions(data.hubOptions || [])` in Task 5 (the call is null-safe with `|| []`, so a one-commit gap is harmless).
- **Do not** remove the CD builder's `.filter(s => s.key !== 'assets' && s.key !== 'cohortReliability')` line yet — after the spec deletions it filters nothing; simplify it away in the same edit if both spec entries are gone.

- [ ] **Step 4: Syntax + SQL verify**

```bash
node -e "const fs=require('fs');global.Logger={log:()=>{}};['Config.js','SlaCatalog.js','Queries.js','EditionCD.js'].forEach(f=>eval.call(global,fs.readFileSync('C:/Users/Sunil Morries J/Desktop/demo-sip/src/server/'+f,'utf8')));console.log('parse OK');const s=buildDashboardQuerySpecsCD('','');console.log(s.map(x=>x.key).join(','))"
```
Expected: `parse OK` + a key list WITHOUT `assets`/`cohortReliability`, WITH `segmentOptions`/`zohoFailByCenter`. Then re-run the geo + zohoKpis SQL through bq (same stdin pattern): geo totals must now sum to ≤ the ACTIVE center count; `avg_open_age_days` returns a number (record it; it will differ from the old `TicketActiveDays` figure — that's the point).

- [ ] **Step 5: Commit**

```bash
git add src/server/EditionCD.js src/server/Queries.js src/server/Api.js
git commit -m "Server: geo dedup (COUNT DISTINCT), open-age recomputed from CreatedAt, legacy dashboard path deleted"
```

---

### Task 4: Client markup — slim topbar, page filter bars, moved tables, honest labels

**Files:**
- Modify: `src/client/Index.html` (topbar 30-79; panel-asset 202-385; panel-centers 386-461; panel-support 464-602)
- Modify: `src/client/Styles.html` (add `.page-filters` block; delete `.topbar-hub`/`.topbar-seg` rules)

**Interfaces:**
- Produces (Task 5 wires these): select ids `assetSegment`, `centersSegment`, `supportSegment` (each with `data-page` attr `asset|centers|support`); the two watchlist `<article>` blocks live in panel-centers; element ids `reliabilityTable`, `assetHealthTable`, `kpiGrid`, `centersKpiGrid` unchanged.

- [ ] **Step 1: Slim the topbar (Index.html:40-53)**

Delete: the `hubFilter` input + `hubOptions` datalist (lines 40-42), the `globalSegment` select (43-45), the `activeOnlyBtn` button (47-53). Keep search, refresh, theme toggle.

- [ ] **Step 2: Insert a filter bar at the top of each of the three panels**

Immediately after `<section id="panel-asset" ...>` opening tag (before the page-summary card), insert:

```html
    <div class="page-filters" role="group" aria-label="Asset page filters">
      <span class="filter-chip" title="Fixed scope: center_details Status = ACTIVE and F2P_Customer = 0. Applies to every number on this page.">
        Active · Paid centers
      </span>
      <label class="filter-label" for="assetSegment">Segment</label>
      <select id="assetSegment" class="select page-seg" data-page="asset">
        <option value="">All segments</option>
      </select>
      <span class="filter-note">Segment follows each device’s mapped center — unmapped devices drop out when a segment is selected.</span>
    </div>
```

Same block after `<section id="panel-centers" ...>` with `id="centersSegment" data-page="centers"`, aria-label "Centers page filters", and note text `Applies to every KPI, chart and the Center 360 table.` Same after `<section id="panel-support" ...>` with `id="supportSegment" data-page="support"`, note text `Zoho tickets filter by segment; CS-tracker cards have no segment lineage and always show all segments.`

- [ ] **Step 3: Move the two watchlist tables Asset → Centers**

Cut the entire `<article class="card span-12">` blocks for `#reliabilityTable` (Index.html:256-277) and `#assetHealthTable` (278-298) out of panel-asset. Paste both into panel-centers directly BEFORE the "Center 360" article (line 431). Edit the second card's header in place:

```html
          <h2 class="card-title">Center health score</h2>
          <p class="card-sub">Composite 0–100 (M-A6): 50% uptime + MTBF tier + failure tier · lowest first · click a row</p>
```

- [ ] **Step 4: Label corrections (all in Index.html)**

- Centers geo card (397-401): title → `Centers by state`, sub → `Distinct active centers per state`, aria-label → `Bar chart of centers per state`.
- Top hubs (427-428): aria-label → `Bar chart of spoke counts per hub`.
- Deployment age card sub (407): → `Centers by time since first deployment` (it's center-grain, was "Active deployments").
- Asset lifecycle card sub (241): `12,839 Jira-tracked assets by status` → `Sheet-tracked Connector + ECG devices by status` (stale hardcoded count).
- FTF cohort card sub (303): → `FTF rate (M-A3) &amp; failures/device (M-A5) per birth-year cohort · center-grain proxy`.
- Support page — period labels on card subs: Priority mix → append ` · last 90 days`; Top issue categories → append ` · last 90 days`; Intake channels → append ` · last 90 days`; Tickets by customer segment → append ` · last 90 days`; Active backlog sub → `Current open backlog by status · all-time`; Ticket flow sub → append ` · last 12 months`; Field service TAT sub → append ` · last 12 sheet-months`; Machines in the field sub → append ` · all-time`; Field issue types sub → append ` · all-time`; Case owners sub → append ` · all-time`.

- [ ] **Step 5: Styles (Styles.html)**

Delete the `.topbar-hub` and `.topbar-seg` rules. Add near the other page-level blocks:

```css
/* ── page-level filter bar ──────────────────────────────────────── */
.page-filters {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin: 0 0 14px;
}
.filter-chip {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 600; letter-spacing: .02em;
  color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--ok) 35%, transparent);
  padding: 5px 12px; border-radius: 999px; cursor: help;
}
.filter-label { font-size: 12px; color: var(--text-dim); }
.page-seg { min-width: 190px; }
.filter-note { font-size: 11.5px; color: var(--text-dim); flex-basis: 100%; }
@media (max-width: 820px) {
  .page-filters { gap: 8px; }
  .page-seg { flex: 1; min-width: 0; }
}
```

(If `color-mix` is unwanted for older WebView parity, use the existing pattern in Styles.html for tinted chips — match whatever `.exec-flag.is-good` does.)

- [ ] **Step 6: Commit**

```bash
git add src/client/Index.html src/client/Styles.html
git commit -m "Client markup: per-page filter bars, topbar slimmed, watchlists moved to Centers, honest labels"
```

---

### Task 5: Client logic — App.html state, loaders, KPI strips, tooltips, mocks

**Files:**
- Modify: `src/client/App.html` (state ~14-40; buildKpiSkeletons 427-468; renderDashboard 545-633; loadDashboard 516-538; loadCenters 1063-1066; loadDevices ~981; applyMapFilters ~1213-1214; map/exec/topcust/numbers/cdRaw gsCalls 1171/1502/1599/1764/1773; activateTab 1728; init 2209-2343; METRIC_INFO 1996-2096; KPI_METRIC ~2099; mockCall 71-360)

**Interfaces:**
- Consumes: Task 2 server signatures (`apiGetDashboardCD({segment})`), Task 4 markup ids (`assetSegment`/`centersSegment`/`supportSegment`).
- Produces: `state.pageSegment = {asset:'', centers:'', support:''}`; `state.dashSegment` (segment of the currently rendered dashboard payload); helper `dashSegmentFor(tabId)` → segment string or `null`; KPI tile ids `kpiAvgAge`, `kpiPastLife` (new), `kpiMapped` (deleted).

- [ ] **Step 1: State surgery** (state object, ~lines 14-40)

Delete the `hub`, `segment`, `activeOnly` keys. Add:

```js
    pageSegment: { asset: '', centers: '', support: '' },
    dashSegment: '',      // segment the current dashboard payload was fetched with
```

Then chase every compile-breaking reference:
- `loadDashboard` (524): → `gsCall(ep('apiGetDashboard'), { segment: dashSegmentFor(state.activeTab) || '', bypassCache: !!bypassCache })`
- `loadDevices` query (981): drop `hub: state.hub` (keep `search`).
- `loadCenters` query (1066): → `var query = Object.assign({}, state.centers, { search: state.search, segment: state.pageSegment.centers });`
- Map `gsCall` (1171), exec (1502), topcust (1599), numbers (1764), cdRaw (1773): drop the `activeOnly` key (empty options object or remaining keys only).
- `applyMapFilters` (1213-1214): delete both the `state.hub` and `state.segment` conditions (the map lost its topbar drivers; its own legend/search filters remain).
- Status line (631-632): drop the `state.hub` suffix → `'Updated ' + new Date().toLocaleTimeString() + (state.dashSegment ? ' · segment: ' + state.dashSegment : '')`.
- Run `grep -n "state\.hub\|state\.segment\b\|state\.activeOnly" src/client/App.html` → expected 0 hits (pageSegment/dashSegment don't match these patterns).

- [ ] **Step 2: `dashSegmentFor` helper + tab refetch** (place next to `ep()`, ~line 54)

```js
  /** Which pageSegment drives the shared dashboard payload for this tab.
   *  Returns '' for Overview (always unsegmented), null for tabs that don't
   *  read the dashboard payload (map, top customers, numbers, raw data). */
  function dashSegmentFor(tabId) {
    if (tabId === 'tab-asset') return state.pageSegment.asset;
    if (tabId === 'tab-centers') return state.pageSegment.centers;
    if (tabId === 'tab-support') return state.pageSegment.support;
    if (tabId === 'tab-overview') return '';
    return null;
  }
```

In `activateTab` (1728, after the existing per-tab lazy-load triggers), add:

```js
    // Shared-payload rule: the dashboard payload is always fetched with the
    // ACTIVE page's segment; refetch when switching to a tab whose stored
    // segment differs from what's rendered.
    var dsg = dashSegmentFor(tabId);
    if (dsg !== null && state.lastDashboard && dsg !== state.dashSegment) loadDashboard(false);
```

In `renderDashboard`, first line after `state.lastDashboard = data;` add: `state.dashSegment = data.segment || '';`

- [ ] **Step 3: Segment dropdown wiring in `init()`** — replace the deleted `hubFilter`/`globalSegment`/`activeOnlyBtn` listeners (2236-2263) with:

```js
    // Per-page Segment dropdowns — each drives every KPI/chart/table on its page.
    ['assetSegment', 'centersSegment', 'supportSegment'].forEach(function (id) {
      var sel = $(id);
      if (!sel) return;
      sel.addEventListener('change', function (event) {
        var page = sel.getAttribute('data-page');
        state.pageSegment[page] = event.target.value;
        if (page === 'centers') { state.centers.page = 0; loadCenters(); }
        loadDashboard(false); // shared payload refetches with the active page's segment
      });
    });
```

- [ ] **Step 4: Populate the three selects in `renderDashboard`** — replace the `fillSelect('globalSegment', ...)` block (624-628):

```js
    var segOpts = (data.segmentOptions || []).map(function (s) { return s.segment; })
      .filter(function (x) { return x && x !== 'Unknown'; });
    ['assetSegment', 'centersSegment', 'supportSegment'].forEach(function (id) {
      var sel = $(id);
      if (!sel) return;
      var keep = sel.value;
      fillSelect(id, segOpts, 'All segments');
      sel.value = keep; // preserve the user's selection across refreshes
    });
```

Also delete `renderHubOptions(data.hubOptions || []);` (621) and the `renderHubOptions` function definition.

- [ ] **Step 5: KPI strips (`buildKpiSkeletons`, 437-448)**

```js
    $('kpiGrid').innerHTML =
      kpiTile('kpiTotal', 'fleet', 'var(--secondary)', 'Total devices', 'Connector + ECG') +
      kpiTile('kpiAvgAge', 'clock', 'var(--info)', 'Avg device age', 'today − Created') +
      kpiTile('kpiPastLife', 'clock', 'var(--danger)', 'Past 5-yr life', 'devices 5y+') +
      kpiTile('kpiSignal', 'signal', 'var(--info)', 'Poor signal', 'CSQ < 10') +
      kpiTile('kpiUnsynced', 'sync', 'var(--violet)', 'Unsynced ECGs', 'waiting to upload');
    $('centersKpiGrid').innerHTML =
      kpiTile('kpiCenters', 'building', 'var(--secondary)', 'Centers', 'active · paid') +
      kpiTile('kpiUptime', 'online', 'var(--ok)', 'Center uptime', 'avg per-center uptime') +
      kpiTile('kpiHealth', 'health', 'var(--primary)', 'Center health', 'avg score / 100') +
      kpiTile('kpiActiveDep', 'layers', 'var(--ok)', 'Active placements', 'deployment open') +
      kpiTile('kpiStates', 'map', 'var(--accent)', 'States', 'geographic reach') +
      kpiTile('kpiCities', 'map', 'var(--violet)', 'Cities', 'geographic reach');
```

In Index.html the `centersKpiGrid` div has class `kpi-grid kpi-grid-5` (392) — change to `kpi-grid` (6 tiles auto-fit, same as supportKpiGrid). *(This one-line markup edit belongs to this task even though the file was touched in Task 4 — it depends on the tile count decided here.)*

- [ ] **Step 6: `renderDashboard` KPI mapping (547-565)**

```js
    /* Asset KPIs (device grain) */
    var kpi = (data.kpis && data.kpis[0]) || {};
    var fleet = data.fleet || {};
    setKpi('kpiTotal', fleet.total != null ? fleet.total : kpi.total_devices,
      FMT.format(fleet.with_center || 0) + ' mapped to a center');
    setKpiText('kpiAvgAge',
      fleet.avg_age_days != null ? (fleet.avg_age_days / 365).toFixed(1) + 'y' : '—',
      'across ' + FMT.format(fleet.aged_devices || 0) + ' dated devices');
    setKpi('kpiPastLife', fleet.past_life,
      fleet.total ? Math.round((fleet.past_life || 0) / fleet.total * 100) + '% of devices' : 'devices 5y+');
    setKpi('kpiSignal', kpi.poor_signal, 'avg CSQ ' + (kpi.avg_csq == null ? '—' : kpi.avg_csq));
    setKpi('kpiUnsynced', kpi.unsynced_total, 'records waiting to upload');

    /* Centers KPIs (center grain) */
    var up = (data.uptimeFleet && data.uptimeFleet[0]) || null;
    var ck = (data.centerKpis && data.centerKpis[0]) || {};
    setKpi('kpiCenters', ck.centers, 'active · paid');
    uptimeKpi('kpiUptime', up);
    setKpi('kpiHealth', up ? up.avg_health : null,
      up && up.avg_mtbf_days != null ? 'avg MTBF ' + up.avg_mtbf_days + 'd · ' + (up.pct_healthy || 0) + '% healthy' : 'composite 0–100');
    setKpi('kpiActiveDep', ck.active_deployments, pct(ck.active_deployments, ck.centers) + ' of centers');
    setKpi('kpiStates', ck.states, 'geographic reach');
    setKpi('kpiCities', ck.cities, 'geographic reach');
```

(Deletes the old `kpiMapped` line; `kpiUptime`/`kpiHealth` ids are unchanged so `uptimeKpi`/info-dots keep working.)

- [ ] **Step 7: METRIC_INFO + KPI_METRIC corrections (1996-2110)**

- `assetLifecycle.source` → `'Jira devices Google Sheet (Connector + ECG only, deduped by Key).'`
- `assetAge` → `formula: 'Device age = today − Created (per sheet row), averaged; 5y+ devices are past the expected life.'`, `source: 'Jira devices Google Sheet (Created column).'`
- `ftf.formula` — append: `' Failures/device is a CENTER-grain proxy (a device inherits its whole center’s ticket count) — no per-device failure source exists yet.'`
- `sla.source` — append: `' Uncatalogued types default to 5 days + a keyword-based Tech guess.'`
- `openAge.formula` → `'Average age in days of currently-open tickets — now − CreatedAt, computed in SQL.'`
- `activePlacements.source` → `'center_details (deactivationdate IS NULL).'`
- `centersCount.formula` → `'COUNT(DISTINCT CenterID) under the fixed page baseline: Status = ACTIVE and F2P_Customer = 0.'`
- `backlog.formula` — append `' No date window — the whole current backlog.'`
- Delete the `centersMapped` entry; in `KPI_METRIC` delete the `kpiMapped` mapping and add `kpiAvgAge: 'assetAge', kpiPastLife: 'assetAge'`.

- [ ] **Step 8: Mock updates for the preview (mockCall, 71-360)**

- Remove `activeOnly` sensitivity: line 108 `var tot = (args && args.activeOnly) ? 19034 : 28299;` → `var tot = 18460;` (use the actual Task 1 verified count).
- In the `apiGetDashboard` mock payload: ensure `segment: (args && args.segment) || ''` is echoed, and `centerKpis` mock uses the ACTIVE-baseline center count from Task 1.
- Mock `fleet` must include `avg_age_days`, `aged_devices`, `past_life`, `age_bands` (it already does if present — verify, since the new KPIs read them).

- [ ] **Step 9: Syntax check + commit**

Extract and parse the script block to catch ES errors early:
```bash
node -e "const s=require('fs').readFileSync('C:/Users/Sunil Morries J/Desktop/demo-sip/src/client/App.html','utf8');const m=s.match(/<script>([\s\S]*)<\/script>/);new Function(m[1]);console.log('App.html script parses OK')"
git add src/client/App.html src/client/Index.html
git commit -m "Client: per-page segment state + wiring, KPI strips recomposed, tooltips corrected, mocks updated"
```

---

### Task 6: Client charts — segment palette + geo label

**Files:**
- Modify: `src/client/Charts.html` (`activeVsEnded` ~342-363; `geo` ~237-259)

**Interfaces:**
- Consumes: `data.activeVsEnded` rows `{status: <segment string>, devices}`; `data.geo` rows `{state, devices}` (now distinct centers).

- [ ] **Step 1: Deliberate segment palette in `activeVsEnded`**

Replace the `var colors = { Active: C.ok, Ended: C.muted };` lookup with a stable per-segment map that falls back to the palette:

```js
    // Card was repurposed to a hub_master_segment breakdown — color each known
    // segment deliberately; unknown values take the rotating palette.
    var SEGMENT_COLORS = {
      'private - sme': C.primary, 'government': C.info, 'le - cath lab': C.violet,
      'le - diagnostic chain': C.secondary, 'echo': C.warn, 'le - large hospital': C.ok,
      'project': C.muted
    };
    function segColor(name, i) {
      return SEGMENT_COLORS[String(name || '').trim().toLowerCase()] || STATUS_PALETTE[i % STATUS_PALETTE.length];
    }
```

and use `segColor(r.status, i)` where the old `colors[...] || STATUS_PALETTE[...]` expression was. **First verify the exact runtime key strings** against the Task 2 `q_segvals` output — the keys above must be the lowercased verbatim values (adjust spacing if the data says `Private-SME` instead of `private - sme`).

- [ ] **Step 2: Geo chart label**

In `Charts.geo`, change the series/tooltip label from `'Devices'` to `'Centers'` (and any axis name string that says Devices). Grep the builder for the literal first: `grep -n "Devices" src/client/Charts.html` — change only occurrences inside the `geo` builder.

- [ ] **Step 3: Commit**

```bash
git add src/client/Charts.html
git commit -m "Charts: deliberate segment palette on the segment donut; geo series labelled Centers"
```

---

### Task 7: Preview verification pass

**Files:** none modified (fix-forward loop if issues found)

- [ ] **Step 1: Rebuild + start the preview** — `preview_start` with launch config `sip-preview`. The build runs at server start: if a preview server is already running, STOP it first, then START (a reused server serves the stale build).

- [ ] **Step 2: Console + structure checks** (text tools, not screenshots)
1. `preview_console_logs` level=error → expected 0 errors.
2. `preview_snapshot` → topbar has NO hub input / segment select / Active-centers button; search + refresh + theme remain.
3. Navigate `#asset` (`preview_eval`: `location.hash='#asset'`) → snapshot: filter bar renders ("Active · Paid centers" chip + Segment select); KPI strip = Total devices / Avg device age / Past 5-yr life / Poor signal / Unsynced ECGs; NO Center-uptime/health tiles; NO reliability/health tables on this panel.
4. Navigate `#centers` → snapshot: filter bar; 6 KPI tiles (Centers / Center uptime / Center health / Active placements / States / Cities); "Centers by state" card title; "Center health score" card title; Reliability watchlist present; Center 360 table renders rows.
5. Navigate `#support` → snapshot: filter bar with CS exemption note; card subs carry the period labels (`last 90 days`, `all-time`, `last 12 months`).
6. Segment interaction: `preview_fill` the `#centersSegment` select with any mock option → `preview_snapshot` → no console errors, KPIs re-render (mock data doesn't change values — plumbing check only).
7. Tab-switch refetch: set `#assetSegment` to a value, switch to `#overview`, back to `#asset` → no errors (validates `dashSegmentFor`/`activateTab` logic).
8. `preview_resize` mobile (375×812) → filter bar wraps, no horizontal scroll on the page body.
9. Both themes: toggle light theme → filter chip/bar legible (inspect `.filter-chip` computed color via `preview_inspect`).

- [ ] **Step 3: Fix-forward.** Any failure: read the source, fix, STOP+START the preview, re-check from Step 2. Commit fixes as they land:

```bash
git add -A src/client && git commit -m "Preview fixes from verification pass"
```

---

### Task 8: Deploy, post-deploy verification, docs

**Files:**
- Modify: `HANDOFF.md` (version bump + summary)
- Deploy via clasp (stable deployment id)

- [ ] **Step 1: Push + deploy**

```bash
cd "C:/Users/Sunil Morries J/Desktop/demo-sip"
clasp push --force
clasp deploy -i AKfycbwV6hHzDT1ZjkH49aFxVfoLF9wcFrBtv9FzrYzdd5RA9R3HAVOMcXrOgzwthI49KK7x -d "v5.8: page-level filters (Active+Paid baseline, Segment dropdown) + KPI corrections"
```

Expected: deploy succeeds, version increments (@32 or later), URL unchanged.

- [ ] **Step 2: Post-deploy cache clear + diagnostics**

Run `clearDashboardCache()` then `diagnostics()` in the Apps Script editor (or via `clasp run` if configured). Expected: diagnostics logs the new center count (ACTIVE baseline) and no errors. If `diagnostics()` references removed fields it will throw — fix and redeploy.

- [ ] **Step 3: Live smoke test**

Open the stable web-app URL. Verify: Overview loads; Asset/Centers/Support each show the filter bar; pick a real segment on Centers → KPIs shrink to that segment (first uncached load per segment takes a few seconds; repeat loads are cached). Numbers on screen must match the Task 2 BQ verification records (e.g. Government segment centers count).

- [ ] **Step 4: Update HANDOFF.md + commit + push**

Add a v5.8 section: baseline rule (Active+Paid, no toggle), per-page Segment filter (threading table from the spec §4.2), page ownership moves, the 13 corrections table with DONE marks, new cache keys, deleted dead code, open items (SLA catalog entries, device-grain uptime/health, Overview filter-bar alignment).

```bash
git add HANDOFF.md
git commit -m "docs: HANDOFF v5.8 — page-level filters + KPI corrections shipped"
git push origin main
```

---

## Self-Review Notes

- **Spec coverage:** §4.1 baseline → Task 1; §4.2 segment threading (all five grains incl. CS exemption) → Tasks 2, 4, 5; §4.3 caches → Tasks 1, 2; §3 page map (KPI strips, moved tables) → Tasks 4, 5; §5 ledger #1→T3, #2→T5, #3→T1/T2, #4-5→T5, #6→T4, #7→T6, #8→T4+T5, #9→T3, #10-11→T4, #12→T5 (tooltip only; catalog additions are an open item), #13→T3; §7 verification → per-task BQ steps + Task 7 preview + Task 8 live.
- **Type consistency:** `segment` is a raw string end-to-end; `segClean_` is the single sanitizer, applied server-side at every entry point (`apiGetDashboardCD`, `jiraDeviceStats_`, helpers). `geo` payload keeps field name `devices` on purpose (client compatibility) — the *label* changes, not the key. KPI ids `kpiUptime`/`kpiHealth` intentionally survive the strip move so `uptimeKpi()`/`KPI_METRIC` keep working.
- **Known judgment calls encoded above:** `segmentOptions` spec stays unsegmented; `zohoFailByCenter` stays unsegmented; Exec Overview stays unsegmented (`''`); Map/TopCustomers/Numbers/RawData get no filter bar; `hubOptions` spec deleted server-side in Task 3 while its null-safe client call is deleted in Task 5.
