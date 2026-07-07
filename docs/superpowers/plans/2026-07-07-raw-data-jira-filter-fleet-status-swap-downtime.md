# Raw Data Page, Jira Device-Type Filter, Fleet-Status-by-Jira Chart, Swap-Downtime Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Raw Data" tab exposing every underlying data source as a paginated, exportable table; permanently restrict Jira-sheet-derived device counts to Issue Type = Connector/ECG Machine; replace the Overview's duplicate heartbeat donut with a Jira lifecycle-status donut; and fix downtime/uptime math so swap-related tickets are always classified as technical.

**Architecture:** Google Apps Script (server `.js` → `.gs`) + BigQuery REST API + two Google Sheets, HtmlService client (no framework, no build step). All four changes slot into the existing conventions documented in `HANDOFF.md`: single-table BQ reads in dedicated files, JS-side aggregation, `respond_()` envelopes, `gsCall()`/mock-fallback on the client, lazy functions for any top-level `CONFIG` reference (Apps Script loads files alphabetically).

**Tech Stack:** Google Apps Script (ES5-style JS), BigQuery REST API v2, Google Sheets REST API v4, vanilla JS + ECharts 5 client, no test framework (verification uses the project's existing `bq query` scratch-script pattern and small standalone Node assertion scripts).

## Global Constraints

- No new BigQuery tables or columns — every change uses data already in the sandbox or the two Sheets.
- Deploy path (unchanged): `clasp push --force` → hard-refresh the Apps Script editor tab → Deploy → Manage deployments → edit → New version → Deploy.
- Raw Data page: **no site filters apply anywhere on it** — no F2P exclusion, no Active-centers toggle, no hub/segment/search.
- The Jira Issue-Type restriction (Connector/ECG Machine) is **permanent**, not a toggle — no new UI control for it.
- Raw Data full-table export is capped at 100,000 rows per source; if a source is ever truncated, the response must say so (`truncated: true`) so the UI can show "first N of M" — never truncate silently.
- Do not touch the Asset-page numeric "Fleet health" KPI (M-A6 health score) or the legacy `getAssetIndex_()` / `jira_data`-BQ-backed views (Map markers, drawer's "Jira devices" list, Asset-lifecycle chart, batch-cohort analysis) — those are explicitly out of scope.
- **This directory is not a git repository** (verified: `git status` → "fatal: not a git repository"). Every task below ends with a "mark step complete" note instead of a `git commit` — there is nothing to commit to. If the user later puts this under git, that's a separate decision, not part of this plan.
- Follow the existing Apps Script load-order rule: never reference another file's globals (e.g. `CONFIG.X`) in a top-level statement — wrap in a lazy function (the codebase's own examples: `bqEndpoint_()`, `nowIstSql_()`).

---

## File Structure

| File | Change |
|---|---|
| `src/server/Config.js` | Modify — add `swap` to `TECH_FALLBACK_REGEX`; add `JIRA_DEVICE_TYPES` |
| `src/server/Numbers.js` | Modify — add `isTrackedJiraDeviceType_()`; filter `jiraDeviceStats_()`; bump cache key |
| `src/server/SheetSource.js` | Modify — add `readRawSheetRows_()` generic full-fidelity sheet reader |
| `src/server/RawData.js` | **Create** — `rawSources_()` registry, `apiGetRawPage()`, `apiGetRawExport()` |
| `src/server/Setup.js` | Modify — extend `diagnostics()`; fix `clearDashboardCache()` cache-key list |
| `src/client/Charts.html` | Modify — add `jiraStatus()` donut builder |
| `src/client/Index.html` | Modify — rename Overview "Fleet health" card copy; add Raw Data tab + panel markup |
| `src/client/Styles.html` | Modify — add `.raw-*` CSS for the source-pill selector and actions row |
| `src/client/App.html` | Modify — `TAB_IDS`, `state.rawData`, `renderExec()` chart call, `METRIC_INFO`/`TITLE_METRIC`, mock data, raw-table load/render/export functions, `init()` wiring |
| `scratch/verify_swap_regex.js` | **Create** (throwaway, not deployed — `rootDir` is `src` so clasp never sees it) — Node assertion script for Task 1 |
| `scratch/verify_jira_device_type_filter.js` | **Create** (throwaway) — Node assertion script for Task 2 |

---

### Task 1: Downtime — classify "swap" tickets as technical

**Files:**
- Modify: `src/server/Config.js:72`
- Test: `scratch/verify_swap_regex.js` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces: `CONFIG.TECH_FALLBACK_REGEX` (string) — consumed by `techBoolSql_()` and `slaFor()` in `src/server/SlaCatalog.js` (unchanged call sites; behavior only).

- [ ] **Step 1: Write the failing verification script**

Create `scratch/verify_swap_regex.js`:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const configSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'server', 'Config.js'), 'utf8');
eval(configSrc); // defines CONFIG in this scope — same trick the project's own gen_sql.js scratch pattern uses

const regex = new RegExp(CONFIG.TECH_FALLBACK_REGEX);

assert.strictEqual(regex.test('device swap request'), true,
  'a "device swap" category should match (already matched via the word "device")');
assert.strictEqual(regex.test('swap'), true,
  'a bare "swap" category should match after the fix');
assert.strictEqual(regex.test('battery swap - field'), true,
  'a worded swap variant should match after the fix (already matched via "battery" too, but must stay true)');
assert.strictEqual(regex.test('billing query'), false,
  'an unrelated admin category must still NOT match');

console.log('OK: TECH_FALLBACK_REGEX classifies swap-related categories as technical.');
```

- [ ] **Step 2: Run it to confirm it currently fails**

Run: `node scratch/verify_swap_regex.js`
Expected: `AssertionError` on the `regex.test('swap')` line (current regex has no bare "swap" keyword, so `'swap'` alone doesn't match any existing term).

- [ ] **Step 3: Apply the fix**

In `src/server/Config.js`, find:
```js
  TECH_FALLBACK_REGEX: 'machine|device|hardware|cable|network|sim|accessor|acquisition|battery|printer|connector|adapter|display|keypad|antenna|board|tablet|charg|serial|ups|trilink',
```
Replace with:
```js
  TECH_FALLBACK_REGEX: 'machine|device|hardware|cable|network|sim|accessor|acquisition|battery|printer|connector|adapter|display|keypad|antenna|board|tablet|charg|serial|ups|trilink|swap',
```

- [ ] **Step 4: Run the verification script again to confirm it passes**

Run: `node scratch/verify_swap_regex.js`
Expected: `OK: TECH_FALLBACK_REGEX classifies swap-related categories as technical.` printed, exit code 0.

- [ ] **Step 5: Verify the live SQL effect on BigQuery**

Run (Bash):
```bash
export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="$(pwd)/credentials/abi_team_sip_bq_access_service_account.json"
bq query --project_id=magnaquest-sand-box --use_legacy_sql=false <<'SQL'
SELECT
  REGEXP_CONTAINS(LOWER(TRIM('some new swap category')), r'machine|device|hardware|cable|network|sim|accessor|acquisition|battery|printer|connector|adapter|display|keypad|antenna|board|tablet|charg|serial|ups|trilink|swap') AS matches_after_fix
SQL
```
Expected: one row, `matches_after_fix = true` — confirms the same regex string works identically in BigQuery's `REGEXP_CONTAINS` (the JS `RegExp` test above and BigQuery's RE2 engine agree on this pattern; both are alternation-of-literals with no JS-only syntax).

- [ ] **Step 6: Mark step complete**

No git in this project — note in your task tracker that Task 1 is done and move on. (Nothing to commit.)

---

### Task 2: Permanently restrict Jira device counts to Connector + ECG Machine

**Files:**
- Modify: `src/server/Config.js` (add a constant near `JIRA_SHEET_ID`)
- Modify: `src/server/Numbers.js:19-84` (`jiraDeviceStats_`)
- Modify: `src/server/Setup.js:113-127` (`clearDashboardCache`)
- Test: `scratch/verify_jira_device_type_filter.js` (create)

**Interfaces:**
- Consumes: `row.issuetype_name` field already returned by `readJiraSheet()` (`src/server/SheetSource.js:143-149`, unchanged).
- Produces: `isTrackedJiraDeviceType_(issueTypeName): boolean` (new, in `Numbers.js`) — pure function, no other task depends on it directly, but `jiraDeviceStats_()`'s filtered output shape is unchanged (`{total, with_center, jira_centers, in_cd, by_status, source, center_source}`), so every existing consumer (`apiGetNumbers`, `apiGetDashboardCD`, `apiGetExecOverviewCD`, and Task 4's chart) keeps working without changes to their own code.

- [ ] **Step 1: Write the failing verification script**

Create `scratch/verify_jira_device_type_filter.js`:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const configSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'server', 'Config.js'), 'utf8');
eval(configSrc); // defines CONFIG

// isTrackedJiraDeviceType_ lives in Numbers.js, which also references Apps
// Script globals (withCache, runQuery, readJiraSheet, getCenter360RowsCD_)
// that don't exist under plain Node — so pull out only the pure predicate
// function's source instead of eval-ing the whole file.
const numbersSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'server', 'Numbers.js'), 'utf8');
const match = numbersSrc.match(/function isTrackedJiraDeviceType_\([\s\S]*?\n}/);
assert.ok(match, 'isTrackedJiraDeviceType_ not found in Numbers.js yet');
eval(match[0]);

assert.strictEqual(isTrackedJiraDeviceType_('Connector'), true, 'exact-case Connector must be tracked');
assert.strictEqual(isTrackedJiraDeviceType_('ecg machine'), true, 'lowercase ECG Machine must be tracked');
assert.strictEqual(isTrackedJiraDeviceType_('  ECG Machine  '), true, 'whitespace must be trimmed');
assert.strictEqual(isTrackedJiraDeviceType_('SIM Card'), false, 'SIM Card must NOT be tracked');
assert.strictEqual(isTrackedJiraDeviceType_(''), false, 'blank Issue Type must NOT be tracked');
assert.strictEqual(isTrackedJiraDeviceType_(undefined), false, 'missing Issue Type must NOT be tracked');

console.log('OK: isTrackedJiraDeviceType_ matches only Connector / ECG Machine.');
```

- [ ] **Step 2: Run it to confirm it currently fails**

Run: `node scratch/verify_jira_device_type_filter.js`
Expected: `AssertionError [ERR_ASSERTION]: isTrackedJiraDeviceType_ not found in Numbers.js yet` (the function doesn't exist).

- [ ] **Step 3: Add the config constant**

In `src/server/Config.js`, find:
```js
  JIRA_SHEET_ID: '1FgLl1HJIE8kpM8R1_mgAFaUyGcDTzieYQ0i5LdoZekc',
```
Add immediately after it:
```js
  JIRA_SHEET_ID: '1FgLl1HJIE8kpM8R1_mgAFaUyGcDTzieYQ0i5LdoZekc',

  /**
   * Permanent restriction (per user request, 2026-07-07): only these Jira
   * "Issue Type" values count as a tracked device everywhere in the app
   * (Numbers page, Fleet/Devices KPIs, the Overview Jira-status donut).
   * Lowercase, trimmed — matched in isTrackedJiraDeviceType_ (Numbers.js).
   */
  JIRA_DEVICE_TYPES: ['connector', 'ecg machine'],
```

- [ ] **Step 4: Add the predicate + apply the filter in `jiraDeviceStats_()`**

In `src/server/Numbers.js`, find (the end of `deviceCenterMap_` and the start of the doc comment above `jiraDeviceStats_`):
```js
  return { map: map, source: 'cloud_devices' };
}

/**
 * Fleet/device stats shared by the Numbers page, Asset "Total fleet" and
```
Replace with:
```js
  return { map: map, source: 'cloud_devices' };
}

/**
 * Is this Jira "Issue Type" one of the device categories the app tracks?
 * Permanent restriction (2026-07-07): only Connector and ECG Machine count
 * as fleet devices — everywhere jiraDeviceStats_() is consumed.
 * @param {string} issueTypeName raw Issue Type cell from the Jira sheet
 * @return {boolean}
 */
function isTrackedJiraDeviceType_(issueTypeName) {
  var key = String(issueTypeName || '').trim().toLowerCase();
  return CONFIG.JIRA_DEVICE_TYPES.indexOf(key) !== -1;
}

/**
 * Fleet/device stats shared by the Numbers page, Asset "Total fleet" and
```

Then, inside `jiraDeviceStats_()`, find:
```js
      var jiraRows = readJiraSheet();
      if (jiraRows) {
```
Replace with:
```js
      var jiraRows = readJiraSheet();
      if (jiraRows) {
        jiraRows = jiraRows.filter(function (row) { return isTrackedJiraDeviceType_(row.issuetype_name); });
```

(The rest of the function — `cdIds`, `dcm`, `SERIAL_RE`, the `byIssue` loop, the returned object — is unchanged; it now just iterates the pre-filtered array.)

Finally, bump the cache key so old unfiltered results don't linger. Find:
```js
function jiraDeviceStats_() {
  return withCache('jiradev_v1', function () {
```
Replace with:
```js
function jiraDeviceStats_() {
  return withCache('jiradev_v2', function () {
```

- [ ] **Step 5: Run the verification script again to confirm it passes**

Run: `node scratch/verify_jira_device_type_filter.js`
Expected: `OK: isTrackedJiraDeviceType_ matches only Connector / ECG Machine.` printed, exit code 0.

- [ ] **Step 6: Fix cache invalidation so the filter takes effect immediately post-deploy**

`clearDashboardCache()` (`src/server/Setup.js:113-127`) doesn't currently clear `jiradev_v1` (or the `numbers_v2_a` active-only variant) at all — a pre-existing gap. Since we're renaming the key anyway, fix both in the same edit. Find:
```js
function clearDashboardCache() {
  var cache = CacheService.getScriptCache();
  var h = shortHash('');
  cache.removeAll(['dash_v6_' + h, 'dashcd_v1_' + h, 'exec_v4', 'execcd_v1',
    'topcust_v1', 'topcustcd_v1', 'numbers_v2']);
  // Large (gzip-chunked) caches: remove #meta + each chunk.
  ['ctr360_v3', 'ctr360cd_v1', 'map_v3', 'mapcd_v1', 'assets_v1'].forEach(function (base) {
```
Replace with:
```js
function clearDashboardCache() {
  var cache = CacheService.getScriptCache();
  var h = shortHash('');
  cache.removeAll(['dash_v6_' + h, 'dashcd_v1_' + h, 'exec_v4', 'execcd_v1',
    'topcust_v1', 'topcustcd_v1', 'numbers_v2', 'numbers_v2_a', 'jiradev_v2']);
  // Large (gzip-chunked) caches: remove #meta + each chunk.
  ['ctr360_v3', 'ctr360cd_v1', 'map_v3', 'mapcd_v1', 'assets_v1'].forEach(function (base) {
```

(The `rawsheet_v1_*` large caches from Task 5 aren't added here yet — that happens in Task 5, which touches this same array again.)

- [ ] **Step 7: Mark step complete**

No git in this project — note Task 2 done, move on.

---

### Task 3: Add the `Charts.jiraStatus()` donut builder

**Files:**
- Modify: `src/client/Charts.html`

**Interfaces:**
- Consumes: `C` palette object, `base()`, `render()`, `showEmpty()`, `FMT` — all already defined earlier in the same IIFE (`src/client/Charts.html:8-120`).
- Produces: `Charts.jiraStatus(rows, id)` where `rows` is `[{k: string, n: number}, ...]` (the exact shape `jiraDeviceStats_().by_status` already returns) and `id` is the target DOM element id. Consumed by Task 4's `renderExec()`.

- [ ] **Step 1: Add the palette + function**

In `src/client/Charts.html`, find (this is right after the `fleetStatus` function, before the blank-line-separated `hubs` function):
```js
    if (onSlice) onClick(id, function (p) { onSlice(p.name); });
  }


  function hubs(rows) {
```
Replace with:
```js
    if (onSlice) onClick(id, function (p) { onSlice(p.name); });
  }

  // Jira lifecycle-status categories are open-ended (Deployed/Store/Hardware/
  // Decommissioned/Field/Exported/…), unlike the fixed 6-bucket FLEET_ORDER —
  // so colors cycle through this palette by rank instead of a name lookup.
  var STATUS_PALETTE = [C.primary, C.ok, C.warn, C.violet, C.teal, C.orange, C.info, C.danger, C.muted];

  function jiraStatus(rows, id) {
    id = id || 'execFleet';
    if (!rows || !rows.length) return showEmpty(id);
    var sorted = rows.slice().sort(function (a, b) { return (b.n || 0) - (a.n || 0); });
    var data = sorted.map(function (r, i) {
      return { name: r.k, value: r.n, itemStyle: { color: STATUS_PALETTE[i % STATUS_PALETTE.length] } };
    });
    render(id, base({
      legend: {
        bottom: 0, icon: 'circle',
        textStyle: { color: C.text, fontSize: 12 },
        itemWidth: 9, itemHeight: 9
      },
      series: [{
        type: 'pie', radius: ['58%', '80%'], center: ['50%', '44%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: C.sliceBorder, borderWidth: 2 },
        label: { show: false },
        emphasis: {
          label: {
            show: true, fontSize: 14, fontWeight: 700, color: C.tooltipText,
            formatter: function (p) { return p.name + '\n' + FMT.format(p.value); }
          },
          scaleSize: 4
        },
        data: data
      }]
    }));
  }


  function hubs(rows) {
```

- [ ] **Step 2: Export it from the module**

In `src/client/Charts.html`, find:
```js
    fleetStatus: fleetStatus,
    hubs: hubs,
```
Replace with:
```js
    fleetStatus: fleetStatus,
    jiraStatus: jiraStatus,
    hubs: hubs,
```

- [ ] **Step 3: Syntax-check the file**

Run (Bash):
```bash
node -e "
const fs = require('fs');
const src = fs.readFileSync('src/client/Charts.html', 'utf8');
const js = src.replace(/^<script>/, '').replace(/<\/script>\s*$/, '');
fs.writeFileSync('scratch/_charts_check.js', js);
"
node --check scratch/_charts_check.js
```
Expected: no output, exit code 0 (a syntax error would print `SyntaxError: ...` and exit non-zero).

- [ ] **Step 4: Mark step complete**

No git in this project — note Task 3 done, move on.

---

### Task 4: Wire the Overview "Fleet status (Jira)" card to the new donut

**Files:**
- Modify: `src/client/Index.html` (Overview panel card, lines ~130-136)
- Modify: `src/client/App.html` (`renderExec`, `METRIC_INFO`, `TITLE_METRIC`, mock data)

**Interfaces:**
- Consumes: `Charts.jiraStatus(rows, id)` from Task 3; `d.fleet.by_status` from `apiGetExecOverviewCD` (already returned today, unchanged shape, now filtered per Task 2).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Update the card copy in `Index.html`**

Find:
```html
      <article class="card span-4">
        <header class="card-head">
          <h2 class="card-title">Fleet health</h2>
          <p class="card-sub">Devices by last heartbeat</p>
        </header>
        <div id="execFleet" class="chart chart-tall" role="img" aria-label="Donut of fleet health"></div>
      </article>
```
Replace with:
```html
      <article class="card span-4">
        <header class="card-head">
          <h2 class="card-title">Fleet status (Jira)</h2>
          <p class="card-sub">Jira devices by lifecycle status</p>
        </header>
        <div id="execFleet" class="chart chart-tall" role="img" aria-label="Donut of Jira devices by lifecycle status"></div>
      </article>
```

- [ ] **Step 2: Swap the chart call in `renderExec()`**

In `src/client/App.html`, find:
```js
    /* Charts */
    Charts.fleetStatus(d.fleetStatus, null, 'execFleet');
```
Replace with:
```js
    /* Charts */
    Charts.jiraStatus((d.fleet && d.fleet.by_status) || [], 'execFleet');
```

- [ ] **Step 3: Split the metric-tooltip entry**

In `src/client/App.html`, find:
```js
    // ── Fleet / device ──
    fleetStatus: { name: 'Fleet status (heartbeat)',
      formula: 'Devices bucketed by last heartbeat vs IST-now: Live <1h, Online <24h, … Never seen (epoch-1970).',
      source: 'cloud_devices.LastTimeStamp (stored as IST wall-time).' },
```
Replace with:
```js
    // ── Fleet / device ──
    fleetStatus: { name: 'Fleet status (heartbeat)',
      formula: 'Devices bucketed by last heartbeat vs IST-now: Live <1h, Online <24h, … Never seen (epoch-1970).',
      source: 'cloud_devices.LastTimeStamp (stored as IST wall-time).' },
    jiraFleetStatus: { name: 'Fleet status (Jira)',
      formula: 'Jira devices grouped by lifecycle status (Deployed, Store, Hardware, Decommissioned, …). Restricted to Issue Type = Connector or ECG Machine.',
      source: 'Jira devices Google Sheet (issuetype_name filtered to CONFIG.JIRA_DEVICE_TYPES).' },
```

Then find:
```js
    'fleet health': 'fleetStatus', 'fleet status': 'fleetStatus',
```
Replace with:
```js
    'fleet health': 'jiraFleetStatus', 'fleet status': 'fleetStatus',
```

(Note: the Asset tab's card is titled "Fleet status" — singular, no "(Jira)" suffix — so `'fleet status': 'fleetStatus'` still matches it unchanged and keeps showing the heartbeat tooltip. Only `'fleet health'` — the old Overview title — is retargeted.)

- [ ] **Step 4: Update the mock data**

`fleet: { total: 43794, with_center: 9888, jira_centers: 4621, in_cd: 9888 },` appears **twice** in `App.html` — once in the `apiGetExecOverview` mock (the one that feeds `execFleet`), once in the generic dashboard mock further down (unrelated to this chart). Only the first needs `by_status`. To target it unambiguously, match on the 3-line block around it — the exec-overview mock's `uptimeFleet` is a plain object followed by `cs:`, while the generic mock's `uptimeFleet` is an array (`[{...}]`) followed by `assetHealth:`, so this snippet is unique. Find:
```js
        uptimeFleet: { scored: 11344, avg_uptime: 98.9, pct99: 80.6, avg_mtbf_days: 572.9, avg_health: 95.0, pct_healthy: 98.6 },
        fleet: { total: 43794, with_center: 9888, jira_centers: 4621, in_cd: 9888 },
        cs: { total_cases: 1284, avg_tat_days: 3.4 }
```
Replace with:
```js
        uptimeFleet: { scored: 11344, avg_uptime: 98.9, pct99: 80.6, avg_mtbf_days: 572.9, avg_health: 95.0, pct_healthy: 98.6 },
        fleet: { total: 43794, with_center: 9888, jira_centers: 4621, in_cd: 9888,
          by_status: [{ k: 'Deployed', n: 5210 }, { k: 'Store', n: 1180 }, { k: 'Hardware', n: 640 },
            { k: 'Decommissioned', n: 410 }, { k: 'Field', n: 260 }, { k: 'Exported', n: 90 }] },
        cs: { total_cases: 1284, avg_tat_days: 3.4 }
```

(Do not touch the other, generic `fleet: { total: 43794, ... }` further down in the file — it feeds the plain dashboard mock, not `execFleet`, and doesn't need `by_status`.)

- [ ] **Step 5: Syntax-check `App.html`**

Run (Bash):
```bash
node -e "
const fs = require('fs');
const src = fs.readFileSync('src/client/App.html', 'utf8');
const js = src.replace(/^<script>/, '').replace(/<\/script>\s*$/, '');
fs.writeFileSync('scratch/_app_check.js', js);
"
node --check scratch/_app_check.js
```
Expected: no output, exit code 0.

- [ ] **Step 6: Visually verify in the local preview**

Run (PowerShell), in the background since it serves forever:
```powershell
powershell -File scripts/build_preview.ps1
```
Wait ~3 seconds for the file to be written, then check:
```powershell
Select-String -Path dist\preview.html -Pattern 'Fleet status \(Jira\)'
```
Expected: 1 match. Then open `http://localhost:8765/preview.html` in a browser, go to the Overview tab, and confirm the card (top-left of the card grid) now shows a donut with slices labeled Deployed/Store/Hardware/Decommissioned/Field/Exported instead of heartbeat buckets, with no errors in the browser console. Stop the background preview server once confirmed.

- [ ] **Step 7: Mark step complete**

No git in this project — note Task 4 done, move on.

---

### Task 5: Add a generic full-fidelity Google Sheet reader

**Files:**
- Modify: `src/server/SheetSource.js`

**Interfaces:**
- Consumes: `CacheService`, `UrlFetchApp`, `ScriptApp.getOAuthToken()` (Apps Script built-ins), `cacheGetLarge`/`cachePutLarge` (`src/server/BigQuery.js`, already loaded — `B` < `S` alphabetically).
- Produces: `readRawSheetRows_(sheetId): {columns: Array<string>, rows: Array<Object>}` — consumed by Task 6's `apiGetRawPage`/`apiGetRawExport` for the two Sheet sources.

- [ ] **Step 1: Add the function**

In `src/server/SheetSource.js`, find the last lines of the file:
```js
/** @return {Array<{label:string, cnt:number}>} top-N of a counter map */
function topEntries_(map, n) {
  return Object.keys(map)
    .map(function (key) { return { label: key, cnt: map[key] }; })
    .sort(function (a, b) { return b.cnt - a.cnt; })
    .slice(0, n);
}
```
Replace with (i.e. append the new function after `topEntries_`):
```js
/** @return {Array<{label:string, cnt:number}>} top-N of a counter map */
function topEntries_(map, n) {
  return Object.keys(map)
    .map(function (key) { return { label: key, cnt: map[key] }; })
    .sort(function (a, b) { return b.cnt - a.cnt; })
    .slice(0, n);
}

/**
 * Generic full-fidelity sheet reader for the Raw Data page. Unlike
 * readJiraSheet() / readCsTracker() (which tolerant-map a handful of named
 * fields), this returns EVERY column using the sheet's own header row as
 * keys — used only by RawData.js's raw/export endpoints.
 * @param {string} sheetId
 * @return {{columns:Array<string>, rows:Array<Object>}}
 */
function readRawSheetRows_(sheetId) {
  var cacheKey = 'rawsheet_v1_' + sheetId;
  var cached = cacheGetLarge(cacheKey);
  if (cached) return cached;

  var url = 'https://sheets.googleapis.com/v4/spreadsheets/' +
    sheetId + '/values/A:ZZ?majorDimension=ROWS';
  var response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  var data = JSON.parse(response.getContentText());
  if (response.getResponseCode() >= 400) {
    throw new Error('Sheet ' + sheetId + ' unreadable: ' +
      ((data.error && data.error.message) || 'HTTP ' + response.getResponseCode()));
  }
  var values = data.values;
  if (!values || values.length < 1) {
    return { columns: [], rows: [] };
  }
  var columns = values[0].map(function (h, i) { return String(h || '').trim() || ('Column ' + (i + 1)); });
  var rows = values.slice(1).map(function (r) {
    var obj = {};
    columns.forEach(function (c, i) { obj[c] = r[i] != null ? r[i] : ''; });
    return obj;
  });
  var result = { columns: columns, rows: rows };
  cachePutLarge(cacheKey, result, 600);
  return result;
}
```

- [ ] **Step 2: Write a standalone verification script for the pure row-mapping logic**

The `UrlFetchApp`/`ScriptApp` calls can't run outside Apps Script, but the row→object mapping is pure once you have a `values` 2D array. Create `scratch/verify_raw_sheet_mapping.js`:

```js
const assert = require('assert');

// Mirrors the mapping block inside readRawSheetRows_ (the part after the
// UrlFetchApp response is parsed) — kept in sync manually since Apps Script
// files aren't Node modules.
function mapSheetValues(values) {
  if (!values || values.length < 1) return { columns: [], rows: [] };
  var columns = values[0].map(function (h, i) { return String(h || '').trim() || ('Column ' + (i + 1)); });
  var rows = values.slice(1).map(function (r) {
    var obj = {};
    columns.forEach(function (c, i) { obj[c] = r[i] != null ? r[i] : ''; });
    return obj;
  });
  return { columns: columns, rows: rows };
}

const result = mapSheetValues([
  ['Key', 'Issue Type', ''],           // header row, with a blank trailing header
  ['TA-1', 'Connector', 'extra'],
  ['TA-2', '']                          // REST API omits trailing empty cells
]);

assert.deepStrictEqual(result.columns, ['Key', 'Issue Type', 'Column 3'],
  'blank header must fall back to a positional name');
assert.strictEqual(result.rows.length, 2, 'two data rows expected');
assert.deepStrictEqual(result.rows[0], { Key: 'TA-1', 'Issue Type': 'Connector', 'Column 3': 'extra' });
assert.strictEqual(result.rows[1]['Issue Type'], '', 'missing trailing cell must become empty string, not undefined');

console.log('OK: raw sheet row mapping handles blank headers and short rows.');
```

- [ ] **Step 3: Run it**

Run: `node scratch/verify_raw_sheet_mapping.js`
Expected: `OK: raw sheet row mapping handles blank headers and short rows.` printed, exit code 0. (This validates the logic now; Task 9's live `diagnostics()` run is what validates the real `UrlFetchApp` call end-to-end after deploy.)

- [ ] **Step 4: Mark step complete**

No git in this project — note Task 5 done, move on.

---

### Task 6: Add the Raw Data server layer (`RawData.js`)

**Files:**
- Create: `src/server/RawData.js`
- Modify: `src/server/Setup.js` (`clearDashboardCache`, to add the two new large-cache keys)

**Interfaces:**
- Consumes: `T()`, `runQuery()` (`src/server/Queries.js`, `src/server/BigQuery.js` — both load before `R`), `respond_()` (`src/server/Api.js`, loads before `R`), `readRawSheetRows_()` (Task 5).
- Produces: `apiGetRawPage(options)`, `apiGetRawExport(options)` — Apps Script entry points called via `google.script.run` from Task 8's client code. Both return the `respond_()` envelope `{ok, data|error}` where `data` is `{rows, columns, totalRows, page?, pageSize?, truncated?}`.

- [ ] **Step 1: Create `src/server/RawData.js`**

```js
/**
 * RawData.js — raw, unfiltered per-source tables for the "Raw Data" page.
 * By design, NO site filters apply here (no F2P exclusion, no Active-centers
 * toggle, no hub/segment/search) — this page exists purely for source
 * reconciliation and full-table export, straight from each source.
 */

var RAW_EXPORT_MAX_ROWS = 100000;

/**
 * Registry of every raw source the page exposes. A function (not a
 * top-level const) because it reads CONFIG — Apps Script loads files
 * alphabetically and this keeps the reference lazy regardless of order.
 * @return {Object<string, {label:string, kind:string, table?:string, orderBy?:string, sheetId?:string}>}
 */
function rawSources_() {
  return {
    center_details: { label: 'Center Details', kind: 'bq', table: 'center_details', orderBy: 'CenterID' },
    cloud_devices: { label: 'Cloud Devices', kind: 'bq', table: 'cloud_devices', orderBy: 'DeviceID' },
    zoho_data: { label: 'Zoho Tickets', kind: 'bq', table: 'zoho_data', orderBy: 'ticketNumber' },
    device_metrics: { label: 'Device Metrics', kind: 'bq', table: 'device_metrics', orderBy: 'deviceid' },
    device_center_mapping: { label: 'Device-Center Mapping (legacy)', kind: 'bq', table: 'device_center_mapping', orderBy: 'deviceid, startdatetime' },
    jira_data: { label: 'Jira Issues (legacy BQ)', kind: 'bq', table: 'jira_data', orderBy: 'issue_key' },
    jira_sheet: { label: 'Jira Devices (Sheet)', kind: 'sheet', sheetId: CONFIG.JIRA_SHEET_ID },
    cs_tracker: { label: 'CS Tracker (Sheet)', kind: 'sheet', sheetId: CONFIG.CS_SHEET_ID }
  };
}

/**
 * One page of raw rows for a single source, no filters applied.
 * @param {{source:string, page:number, pageSize:number}} options
 * @return {{ok:boolean, data?:Object, error?:Object}}
 */
function apiGetRawPage(options) {
  options = options || {};
  var key = String(options.source || '');
  var page = Math.max(0, parseInt(options.page, 10) || 0);
  var pageSize = Math.min(500, Math.max(5, parseInt(options.pageSize, 10) || 25));
  return respond_(function () {
    var def = rawSources_()[key];
    if (!def) throw new Error('Unknown raw source: ' + key);

    if (def.kind === 'bq') {
      var sql = 'SELECT *, COUNT(*) OVER() AS total_rows FROM ' + T(def.table) +
        ' ORDER BY ' + def.orderBy + ' LIMIT ' + pageSize + ' OFFSET ' + (page * pageSize);
      var rows = runQuery(sql);
      var total = rows.length ? rows[0].total_rows : 0;
      var columns = rows.length ? Object.keys(rows[0]).filter(function (c) { return c !== 'total_rows'; }) : [];
      rows.forEach(function (r) { delete r.total_rows; });
      return { rows: rows, columns: columns, totalRows: total, page: page, pageSize: pageSize };
    }

    var sheet = readRawSheetRows_(def.sheetId);
    var slice = sheet.rows.slice(page * pageSize, page * pageSize + pageSize);
    return { rows: slice, columns: sheet.columns, totalRows: sheet.rows.length, page: page, pageSize: pageSize };
  });
}

/**
 * Every row for a single source (up to RAW_EXPORT_MAX_ROWS), for CSV export.
 * @param {{source:string}} options
 * @return {{ok:boolean, data?:Object, error?:Object}}
 */
function apiGetRawExport(options) {
  options = options || {};
  var key = String(options.source || '');
  return respond_(function () {
    var def = rawSources_()[key];
    if (!def) throw new Error('Unknown raw source: ' + key);

    if (def.kind === 'bq') {
      var totalRows = (runQuery('SELECT COUNT(*) AS n FROM ' + T(def.table))[0] || {}).n || 0;
      var sql = 'SELECT * FROM ' + T(def.table) + ' ORDER BY ' + def.orderBy +
        ' LIMIT ' + RAW_EXPORT_MAX_ROWS;
      var rows = runQuery(sql, null, { maxRows: RAW_EXPORT_MAX_ROWS });
      var columns = rows.length ? Object.keys(rows[0]) : [];
      return { rows: rows, columns: columns, totalRows: totalRows, truncated: totalRows > rows.length };
    }

    var sheet = readRawSheetRows_(def.sheetId);
    return { rows: sheet.rows, columns: sheet.columns, totalRows: sheet.rows.length, truncated: false };
  });
}
```

- [ ] **Step 2: Add the new large-cache keys to `clearDashboardCache()`**

In `src/server/Setup.js`, find (this is the version left by Task 2, Step 6):
```js
  ['ctr360_v3', 'ctr360cd_v1', 'map_v3', 'mapcd_v1', 'assets_v1'].forEach(function (base) {
```
Replace with:
```js
  ['ctr360_v3', 'ctr360cd_v1', 'map_v3', 'mapcd_v1', 'assets_v1',
    'rawsheet_v1_' + CONFIG.JIRA_SHEET_ID, 'rawsheet_v1_' + CONFIG.CS_SHEET_ID].forEach(function (base) {
```

- [ ] **Step 3: Verify each BigQuery source's SQL against live BigQuery**

Create `scratch/gen_rawdata_sql.js`:

```js
const fs = require('fs');
const path = require('path');

// Inlined rather than eval-ing the real Queries.js (500+ lines, most of it
// irrelevant here) — this mirrors T()'s one-line body exactly:
//   function T(table) { return '`' + CONFIG.BQ_DATASET + '.' + table + '`'; }
const BQ_DATASET = 'magnaquest-sand-box.abi_team_sip_devtest_poc';
function T(table) { return '`' + BQ_DATASET + '.' + table + '`'; }

const sources = [
  { table: 'center_details', orderBy: 'CenterID' },
  { table: 'cloud_devices', orderBy: 'DeviceID' },
  { table: 'zoho_data', orderBy: 'ticketNumber' },
  { table: 'device_metrics', orderBy: 'deviceid' },
  { table: 'device_center_mapping', orderBy: 'deviceid, startdatetime' },
  { table: 'jira_data', orderBy: 'issue_key' }
];

const out = sources.map(s =>
  `SELECT *, COUNT(*) OVER() AS total_rows FROM ${T(s.table)} ORDER BY ${s.orderBy} LIMIT 5 OFFSET 0;`
).join('\n');

fs.writeFileSync(path.join(__dirname, 'rawdata_check.sql'), out);
console.log('Wrote scratch/rawdata_check.sql');
```

Run:
```bash
node scratch/gen_rawdata_sql.js
export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="$(pwd)/credentials/abi_team_sip_bq_access_service_account.json"
bq query --project_id=magnaquest-sand-box --use_legacy_sql=false --multi_statement=true < scratch/rawdata_check.sql
```
Expected: 6 result sets print, each with 5 rows and a `total_rows` column matching the source's known approximate row count from `docs/SOURCES.md` (center_details ~55.7k, cloud_devices ~11.3k, zoho_data ~84.5k, device_center_mapping ~56k, jira_data ~12.8k; `device_metrics` row count isn't documented — any non-error result confirms the query shape is valid). No `Error in query string` output for any of the 6 statements.

(Note: `bq query` may not support `--multi_statement` for a plain `;`-separated script depending on the installed CLI version — if it errors, run each of the 6 `SELECT` lines from `scratch/rawdata_check.sql` as a separate `bq query ... <<< "..."` call instead. Either way, the goal is the same: confirm all 6 generated statements execute without error.)

- [ ] **Step 4: Mark step complete**

No git in this project — note Task 6 done, move on.

---

### Task 7: Add the Raw Data page markup

**Files:**
- Modify: `src/client/Index.html` (new tab button + panel)
- Modify: `src/client/Styles.html` (new `.raw-*` CSS)

**Interfaces:**
- Consumes: nothing (pure markup/CSS).
- Produces: DOM element ids consumed by Task 8's client logic: `tab-rawdata`, `panel-rawdata`, `rawSourcePills` (with `.raw-pill[data-source]` children), `rawTableTitle`, `rawPageSize`, `rawExportBtn`, `rawTable`, `rawTableInfo`, `rawPrev`, `rawPage`, `rawNext`.

- [ ] **Step 1: Add the tab button**

In `src/client/Index.html`, find:
```html
  <button class="tab" id="tab-numbers" role="tab" aria-selected="false" aria-controls="panel-numbers" tabindex="-1">Numbers</button>
</nav>
```
Replace with:
```html
  <button class="tab" id="tab-numbers" role="tab" aria-selected="false" aria-controls="panel-numbers" tabindex="-1">Numbers</button>
  <button class="tab" id="tab-rawdata" role="tab" aria-selected="false" aria-controls="panel-rawdata" tabindex="-1">Raw Data</button>
</nav>
```

- [ ] **Step 2: Add the panel**

In `src/client/Index.html`, find (the closing tag of the Numbers panel, immediately before the footer):
```html
  </section>

  <footer class="page-footer">
```
Replace with:
```html
  </section>

  <!-- ══════════════ VIEW 7 · RAW DATA (source export/reconciliation) ══════════════ -->
  <section id="panel-rawdata" class="panel" role="tabpanel" aria-labelledby="tab-rawdata" hidden>
    <p class="num-lead">Every column, straight from the source — <strong>no site filters apply on this page</strong>
      (no F2P exclusion, no Active-centers toggle, no hub/segment/search).</p>

    <div class="raw-pills" id="rawSourcePills" role="tablist" aria-label="Raw data source">
      <button class="raw-pill is-active" type="button" data-source="center_details">Center Details</button>
      <button class="raw-pill" type="button" data-source="cloud_devices">Cloud Devices</button>
      <button class="raw-pill" type="button" data-source="zoho_data">Zoho Tickets</button>
      <button class="raw-pill" type="button" data-source="device_metrics">Device Metrics</button>
      <button class="raw-pill" type="button" data-source="device_center_mapping">Device-Center Mapping (legacy)</button>
      <button class="raw-pill" type="button" data-source="jira_data">Jira Issues (legacy BQ)</button>
      <button class="raw-pill" type="button" data-source="jira_sheet">Jira Devices (Sheet)</button>
      <button class="raw-pill" type="button" data-source="cs_tracker">CS Tracker (Sheet)</button>
    </div>

    <article class="card span-12">
      <header class="card-head">
        <h2 class="card-title" id="rawTableTitle">Center Details · raw data</h2>
        <div class="raw-actions">
          <label class="raw-pagesize">Rows per page
            <select id="rawPageSize" class="select">
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
          <button id="rawExportBtn" class="btn btn-primary" type="button">Export full CSV</button>
        </div>
      </header>
      <div class="table-scroll">
        <table class="data-table" id="rawTable">
          <caption class="sr-only">Raw source rows</caption>
          <thead><tr></tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="table-footer">
        <span id="rawTableInfo" class="table-info" aria-live="polite">Loading…</span>
        <div class="pager">
          <button id="rawPrev" class="btn btn-ghost btn-icon" type="button" aria-label="Previous page" disabled>
            <svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m15 18-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <span id="rawPage" class="page-indicator">–</span>
          <button id="rawNext" class="btn btn-ghost btn-icon" type="button" aria-label="Next page" disabled>
            <svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m9 18 6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    </article>
  </section>

  <footer class="page-footer">
```

- [ ] **Step 3: Add CSS for the pill selector and actions row**

In `src/client/Styles.html`, find:
```css
.num-src { grid-column: 1 / -1; font-size: 11px; color: var(--text-3); letter-spacing: 0.02em; }

/* ── responsive: reflow to laptop / tablet / phone on browser resize ── */
```
Replace with:
```css
.num-src { grid-column: 1 / -1; font-size: 11px; color: var(--text-3); letter-spacing: 0.02em; }

/* ── raw data page ──────────────────────────────────────────────── */
.raw-pills { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: var(--gap); }
.raw-pill {
  padding: 8px 16px; font-size: 13px; font-weight: 600;
  color: var(--text-2); background: var(--surface-2);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  cursor: pointer; transition: color var(--dur-fast), border-color var(--dur-fast), background var(--dur-fast);
}
.raw-pill:hover { color: var(--text-1); border-color: var(--border-strong); }
.raw-pill.is-active { color: var(--primary); border-color: var(--primary); background: var(--primary-soft); }
.raw-actions { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.raw-pagesize { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-3); }
.raw-pagesize .select { padding: 6px 10px; font-size: 13px; }

/* ── responsive: reflow to laptop / tablet / phone on browser resize ── */
```

- [ ] **Step 4: Rebuild the preview and confirm the new markup is present**

Run (PowerShell), in the background:
```powershell
powershell -File scripts/build_preview.ps1
```
Wait ~3 seconds, then check:
```powershell
Select-String -Path dist\preview.html -Pattern 'id="tab-rawdata"','id="panel-rawdata"','id="rawSourcePills"','class="raw-pill'
```
Expected: at least one match for each pattern. Stop the background preview server once confirmed. (The panel will render with an empty table until Task 8 adds the client logic and mock data — that's expected at this point.)

- [ ] **Step 5: Mark step complete**

No git in this project — note Task 7 done, move on.

---

### Task 8: Add the Raw Data page client logic

**Files:**
- Modify: `src/client/App.html`

**Interfaces:**
- Consumes: `apiGetRawPage`/`apiGetRawExport` (Task 6, via `gsCall`), the DOM ids from Task 7, `escapeHtml()`, `FMT`, `toast()`, `$()` (all already defined earlier in the same file).
- Produces: nothing consumed by other tasks — this is the last client task for the Raw Data feature.

- [ ] **Step 1: Add `state.rawData`**

Find:
```js
    numbersLoaded: false,
    cdRaw: { page: 0, pageSize: 25, total: 0 },
    theme: 'dark',
```
Replace with:
```js
    numbersLoaded: false,
    cdRaw: { page: 0, pageSize: 25, total: 0 },
    rawData: { source: 'center_details', page: 0, pageSize: 25, total: 0 },
    theme: 'dark',
```

- [ ] **Step 2: Add `tab-rawdata` to `TAB_IDS`**

Find:
```js
  var TAB_IDS = ['tab-overview', 'tab-asset', 'tab-centers', 'tab-support', 'tab-map', 'tab-topcust', 'tab-numbers'];
```
Replace with:
```js
  var TAB_IDS = ['tab-overview', 'tab-asset', 'tab-centers', 'tab-support', 'tab-map', 'tab-topcust', 'tab-numbers', 'tab-rawdata'];
```

- [ ] **Step 3: Lazy-load on first visit to the tab**

Find:
```js
    if (tabId === 'tab-numbers') {
      if (!state.numbersLoaded) loadNumbers();
      if (!state.cdRaw.total) loadCdRaw();
    }
    updateHash();
```
Replace with:
```js
    if (tabId === 'tab-numbers') {
      if (!state.numbersLoaded) loadNumbers();
      if (!state.cdRaw.total) loadCdRaw();
    }
    if (tabId === 'tab-rawdata' && !state.rawData.total) loadRawTable();
    updateHash();
```

- [ ] **Step 4: Add `loadRawTable` / `renderRawTable` / `exportRawFull` / `csvCell`**

Find:
```js
  function numCompare(items) {
```
Insert immediately before it:
```js
  /* ── Raw Data page (all 8 sources, no site filters) ────────────── */
  function loadRawTable() {
    $('rawTableInfo').textContent = 'Loading…';
    gsCall('apiGetRawPage', { source: state.rawData.source, page: state.rawData.page, pageSize: state.rawData.pageSize })
      .then(renderRawTable)
      .catch(function (err) {
        $('rawTableInfo').textContent = 'Failed: ' + err.message;
      });
  }

  function renderRawTable(payload) {
    var rows = payload.rows || [];
    var columns = payload.columns || [];
    state.rawData.total = payload.totalRows || 0;

    var table = $('rawTable');
    table.querySelector('thead tr').innerHTML = columns.map(function (c) {
      return '<th scope="col">' + escapeHtml(c) + '</th>';
    }).join('');

    var body = table.querySelector('tbody');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="' + Math.max(1, columns.length) + '" class="chart-empty">No rows</td></tr>';
    } else {
      body.innerHTML = rows.map(function (r) {
        return '<tr>' + columns.map(function (c) {
          return '<td>' + escapeHtml(r[c]) + '</td>';
        }).join('') + '</tr>';
      }).join('');
    }

    var start = state.rawData.page * state.rawData.pageSize;
    var end = Math.min(start + state.rawData.pageSize, state.rawData.total);
    $('rawTableInfo').textContent = state.rawData.total
      ? (FMT.format(start + 1) + '–' + FMT.format(end) + ' of ' + FMT.format(state.rawData.total) + ' rows')
      : '0 rows';
    var maxPage = Math.max(0, Math.ceil(state.rawData.total / state.rawData.pageSize) - 1);
    $('rawPage').textContent = (state.rawData.page + 1) + ' / ' + (maxPage + 1);
    $('rawPrev').disabled = state.rawData.page <= 0;
    $('rawNext').disabled = state.rawData.page >= maxPage;
  }

  function csvCell(value) {
    var cell = String(value == null ? '' : value);
    return /[",\n]/.test(cell) ? '"' + cell.replace(/"/g, '""') + '"' : cell;
  }

  function exportRawFull() {
    var btn = $('rawExportBtn');
    var originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Exporting…';
    gsCall('apiGetRawExport', { source: state.rawData.source })
      .then(function (payload) {
        var columns = payload.columns || [];
        var rows = payload.rows || [];
        if (!rows.length) { toast('Nothing to export', 'error'); return; }
        var lines = [columns.map(csvCell).join(',')].concat(rows.map(function (row) {
          return columns.map(function (c) { return csvCell(row[c]); }).join(',');
        }));
        var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'sip-raw-' + state.rawData.source + '.csv';
        link.click();
        URL.revokeObjectURL(link.href);
        toast(payload.truncated
          ? 'Exported first ' + FMT.format(rows.length) + ' of ' + FMT.format(payload.totalRows) + ' rows'
          : FMT.format(rows.length) + ' rows exported', 'ok');
      })
      .catch(function (err) { toast('Export failed: ' + err.message, 'error'); })
      .then(function () { btn.disabled = false; btn.textContent = originalText; });
  }

  function numCompare(items) {
```

- [ ] **Step 5: Wire the pills, page-size select, pager and export button**

Find:
```js
    // center_details raw-data table pager.
    $('cdRawPrev').addEventListener('click', function () {
      if (state.cdRaw.page > 0) { state.cdRaw.page -= 1; loadCdRaw(); }
    });
    $('cdRawNext').addEventListener('click', function () {
      var maxPage = Math.max(0, Math.ceil(state.cdRaw.total / state.cdRaw.pageSize) - 1);
      if (state.cdRaw.page < maxPage) { state.cdRaw.page += 1; loadCdRaw(); }
    });

    updateSearchPlaceholder();
```
Replace with:
```js
    // center_details raw-data table pager.
    $('cdRawPrev').addEventListener('click', function () {
      if (state.cdRaw.page > 0) { state.cdRaw.page -= 1; loadCdRaw(); }
    });
    $('cdRawNext').addEventListener('click', function () {
      var maxPage = Math.max(0, Math.ceil(state.cdRaw.total / state.cdRaw.pageSize) - 1);
      if (state.cdRaw.page < maxPage) { state.cdRaw.page += 1; loadCdRaw(); }
    });

    // Raw Data page: source pills, page size, pager, export.
    Array.prototype.forEach.call($('rawSourcePills').querySelectorAll('.raw-pill'), function (pill) {
      pill.addEventListener('click', function () {
        if (pill.classList.contains('is-active')) return;
        Array.prototype.forEach.call($('rawSourcePills').querySelectorAll('.raw-pill'), function (p) {
          p.classList.remove('is-active');
        });
        pill.classList.add('is-active');
        state.rawData.source = pill.getAttribute('data-source');
        state.rawData.page = 0;
        state.rawData.total = 0;
        $('rawTableTitle').textContent = pill.textContent + ' · raw data';
        loadRawTable();
      });
    });
    $('rawPageSize').addEventListener('change', function () {
      state.rawData.pageSize = parseInt($('rawPageSize').value, 10) || 25;
      state.rawData.page = 0;
      loadRawTable();
    });
    $('rawPrev').addEventListener('click', function () {
      if (state.rawData.page > 0) { state.rawData.page -= 1; loadRawTable(); }
    });
    $('rawNext').addEventListener('click', function () {
      var maxPage = Math.max(0, Math.ceil(state.rawData.total / state.rawData.pageSize) - 1);
      if (state.rawData.page < maxPage) { state.rawData.page += 1; loadRawTable(); }
    });
    $('rawExportBtn').addEventListener('click', exportRawFull);

    updateSearchPlaceholder();
```

- [ ] **Step 6: Add mock data for all 8 sources**

Find:
```js
    if (fn === 'apiGetNumbers') {
```
Insert immediately before it:
```js
    if (fn === 'apiGetRawPage' || fn === 'apiGetRawExport') {
      var mockRaw = {
        center_details: { columns: ['CenterID', 'Centername', 'Status', 'Spoke_Center_Segment', 'City', 'State'],
          gen: function (i) { return [10000 + i, 'Demo Center ' + i, 'ACTIVE', 'Diagnostic centre', 'Bengaluru', 'Karnataka']; } },
        cloud_devices: { columns: ['DeviceID', 'CenterID', 'HubName', 'IMSI', 'BatteryLevel', 'LastTimeStamp'],
          gen: function (i) { return ['H4-DEMO' + i, 10000 + i, 'Demo Hub 1', '404550000' + i, String(rnd(20, 95)), new Date().toISOString()]; } },
        zoho_data: { columns: ['ticketNumber', 'CenterID', 'status', 'CreatedAt', 'ClosedAt', 'IssueCategory'],
          gen: function (i) { return [149000 + i, 10000 + i, 'Closed', '02-Jul-2026 04:59:16 PM', '03-Jul-2026 10:12:00 AM', 'Lead cable']; } },
        device_metrics: { columns: ['deviceid', 'centerid', 'down_time_percentage', 'total_no_of_tickets', 'mean_time_between_failures_hrs'],
          gen: function (i) { return ['H4-DEMO' + i, 10000 + i, rnd(0, 140), rnd(0, 12), rnd(100, 900)]; } },
        device_center_mapping: { columns: ['deviceid', 'centerid', 'startdatetime', 'enddatetime'],
          gen: function (i) { return ['H4-DEMO' + i, 10000 + i, '2023-04-12', '']; } },
        jira_data: { columns: ['issue_key', 'summary', 'customerid', 'status_name', 'issuetype_name', 'ticket_created'],
          gen: function (i) { return ['TA-' + (45000 + i), 'H4-DEMO' + i + ' ECG issue', 10000 + i, 'Deployed', 'ECG Machine', '2024-01-01']; } },
        jira_sheet: { columns: ['Key', 'Issue Type', 'Summary', 'Status', 'Created', 'Customer ID'],
          gen: function (i) { return ['TA-' + (45000 + i), 'ECG Machine', 'H4-DEMO' + i + ' swap request', 'Deployed', '2024-01-01', 10000 + i]; } },
        cs_tracker: { columns: ['T O M', 'Received Date', 'Closed Date', 'Zoho ID', 'Center ID', 'Machine & DeviceType', 'Issue Type', 'TAT (Days)'],
          gen: function (i) { return ['Demo Owner', '2024-01-01', '2024-01-05', '#' + (149000 + i), 10000 + i, 'MAC600', 'Lead cable', rnd(1, 10)]; } }
      };
      var srcKey = (args && args.source) || 'center_details';
      var srcDef = mockRaw[srcKey] || mockRaw.center_details;
      var totalMock = 237;
      function rowAt(idx) {
        var row = {};
        srcDef.columns.forEach(function (c, ci) { row[c] = srcDef.gen(idx)[ci]; });
        return row;
      }
      if (fn === 'apiGetRawExport') {
        var allRows = [];
        for (var ei = 0; ei < totalMock; ei++) allRows.push(rowAt(ei));
        return Promise.resolve({ rows: allRows, columns: srcDef.columns, totalRows: totalMock, truncated: false });
      }
      var pg2 = (args && args.page) || 0, ps2 = (args && args.pageSize) || 25;
      var pageRows = [];
      for (var pi = 0; pi < ps2 && (pg2 * ps2 + pi) < totalMock; pi++) pageRows.push(rowAt(pg2 * ps2 + pi));
      return Promise.resolve({ rows: pageRows, columns: srcDef.columns, totalRows: totalMock, page: pg2, pageSize: ps2 });
    }
    if (fn === 'apiGetNumbers') {
```

- [ ] **Step 7: Syntax-check `App.html`**

Run (Bash):
```bash
node -e "
const fs = require('fs');
const src = fs.readFileSync('src/client/App.html', 'utf8');
const js = src.replace(/^<script>/, '').replace(/<\/script>\s*$/, '');
fs.writeFileSync('scratch/_app_check.js', js);
"
node --check scratch/_app_check.js
```
Expected: no output, exit code 0.

- [ ] **Step 8: Full manual click-through in the local preview**

Run (PowerShell), in the background:
```powershell
powershell -File scripts/build_preview.ps1
```
Open `http://localhost:8765/preview.html` in a browser and:
1. Click the **Raw Data** tab. Confirm the Center Details pill is active and a table with 6 columns × 25 rows renders, footer reads "1–25 of 237 rows".
2. Click through all 7 other pills (Cloud Devices, Zoho Tickets, Device Metrics, Device-Center Mapping, Jira Issues, Jira Devices, CS Tracker). Confirm each swaps to its own column set and the card title updates.
3. Change "Rows per page" to 100. Confirm the table re-renders with up to 100 rows and the pager updates.
4. Click Next/Prev. Confirm the page indicator and row range update, buttons disable at the boundaries.
5. Click "Export full CSV". Confirm a `sip-raw-<source>.csv` file downloads and a toast reads "237 rows exported".
6. Open the browser DevTools console. Confirm zero errors across all of the above.

Stop the background preview server once confirmed.

- [ ] **Step 9: Mark step complete**

No git in this project — note Task 8 done, move on.

---

### Task 9: Extend `diagnostics()` to cover all four changes

**Files:**
- Modify: `src/server/Setup.js`

**Interfaces:**
- Consumes: `jiraDeviceStats_()` (Task 2), `rawSources_()` / `apiGetRawPage()` (Task 6) — all already defined by this point.
- Produces: nothing (this is the terminal verification function, run manually in the Apps Script editor after deploy in Task 10).

- [ ] **Step 1: Add the new log lines**

In `src/server/Setup.js`, find:
```js
  var nums = apiGetNumbers();
  Logger.log(nums.ok
    ? 'Numbers: centers ' + nums.data.centers.total + ', hubs ' + nums.data.hubs.total +
      ', devices ' + nums.data.devices.total + ' (' + nums.data.devices.source + ')'
    : 'Numbers FAILED: ' + JSON.stringify(nums.error));
}
```
Replace with:
```js
  var nums = apiGetNumbers();
  Logger.log(nums.ok
    ? 'Numbers: centers ' + nums.data.centers.total + ', hubs ' + nums.data.hubs.total +
      ', devices ' + nums.data.devices.total + ' (' + nums.data.devices.source + ')'
    : 'Numbers FAILED: ' + JSON.stringify(nums.error));

  // Jira device-type filter (Connector + ECG Machine only, permanent).
  var jiraStats = jiraDeviceStats_();
  Logger.log('Jira devices (Connector + ECG Machine only): ' + jiraStats.total + ' total, ' +
    jiraStats.with_center + ' mapped to a center, source=' + jiraStats.source);
  Logger.log('Jira devices by status: ' + JSON.stringify(jiraStats.by_status));

  // Raw Data page — one row-count check per source.
  Object.keys(rawSources_()).forEach(function (key) {
    var raw = apiGetRawPage({ source: key, page: 0, pageSize: 1 });
    Logger.log(raw.ok
      ? 'Raw data [' + key + ']: ' + raw.data.totalRows + ' rows'
      : 'Raw data [' + key + '] FAILED: ' + JSON.stringify(raw.error));
  });
}
```

- [ ] **Step 2: Syntax-check `Setup.js`**

Run (Bash):
```bash
node --check src/server/Setup.js
```
Expected: no output, exit code 0. (`Setup.js` is plain JS with no HTML wrapper, so it can be checked directly — unlike the `.html` client files.)

- [ ] **Step 3: Mark step complete**

No git in this project — note Task 9 done. This is the last code-writing task; Task 10 is deploy + live verification.

---

### Task 10: Deploy and verify live

**Files:** none (deployment + manual verification only)

**Interfaces:** none — terminal task.

- [ ] **Step 1: Push to Apps Script**

Run:
```bash
clasp push --force
```
Expected: a file listing ending in success (exit code 255 from clasp itself is a known harmless quirk per `HANDOFF.md` — check the printed file list includes `server/Config`, `server/Numbers`, `server/SheetSource`, `server/RawData`, `server/Setup`, `client/Charts`, `client/Index`, `client/Styles`, `client/App`).

- [ ] **Step 2: Refresh the editor and deploy a new version**

In the Apps Script editor: hard-refresh the tab (`Ctrl+Shift+R`) first — per `HANDOFF.md`, a stale tab can delete files it doesn't know about on its next save. Then: **Deploy → Manage deployments → ✏️ edit → Version: New version → Deploy**.

- [ ] **Step 3: Run `diagnostics()` in the editor**

Select `diagnostics` from the function dropdown, click Run, open **Execution log**. Confirm:
- `Health check: {"ok":true...}`
- No `FAILED` lines anywhere in the log.
- A `Jira devices (Connector + ECG Machine only): N total, ...` line, where `N` is visibly smaller than the previously-known ~43,794 all-issue-types figure.
- A `Jira devices by status: [...]` line listing lifecycle statuses.
- 8 `Raw data [<source>]: N rows` lines, one per source key (`center_details`, `cloud_devices`, `zoho_data`, `device_metrics`, `device_center_mapping`, `jira_data`, `jira_sheet`, `cs_tracker`), each with `N > 0`.

If the Jira sheet or CS tracker lines show `FAILED` with a Sheets-API-disabled error, that's the pre-existing, documented condition in `HANDOFF.md` §6 item 1 (Sheets API not yet enabled on the GCP project) — not a regression from this work; re-run after that's enabled.

- [ ] **Step 4: Run `clearDashboardCache()` once**

Select `clearDashboardCache` from the function dropdown, click Run. Confirm the log reads "Caches cleared — next load recomputes...". This forces the swap-downtime fix and the Jira-filter fix to show immediately instead of waiting out the 5-minute cache TTL.

- [ ] **Step 5: Open the live web app and spot-check each change**

Open the deployment URL and confirm:
1. **Raw Data tab** exists (9th... actually 8th tab, after Numbers) and behaves as verified in Task 8, Step 8 — but now against real BigQuery/Sheets data instead of mocks.
2. **Overview tab**: the top-left card now reads "Fleet status (Jira)" with a donut of lifecycle statuses (Deployed/Store/Hardware/etc.), not heartbeat buckets.
3. **Asset tab**: the numeric "Fleet health" KPI tile is present and unchanged in behavior (still the M-A6 score).
4. **Numbers tab**: the "Devices" KPI total is visibly smaller than before this change (Connector + ECG Machine only).
5. Browser console shows zero errors on every tab.

- [ ] **Step 6: Mark the plan complete**

No git in this project — all 10 tasks done. If desired, delete the throwaway `scratch/*.js` verification scripts and `scratch/*.sql` files (they were never deployed — `rootDir: src` in `.clasp.json` means clasp never touched them — but they're also not needed going forward).
