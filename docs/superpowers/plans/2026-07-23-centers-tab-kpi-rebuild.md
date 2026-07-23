# Centers Tab KPI & Watchlist Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Centers tab's KPI grid (drop Active placements + Cities, add an MTBF
tile) and merge the Reliability watchlist + Center health score tables into one sortable
watchlist, with zero change to the underlying uptime/health/MTBF formulas.

**Architecture:** Almost everything is a client-side (`App.html`/`Index.html`) recomposition
of data the server already computes. The one backend change is dropping `LIMIT 12` from the
`reliability`/`assetHealth` BigQuery specs in `EditionCD.js` so the client can merge + sort-
toggle across every scored center — which in turn requires two follow-on fixes discovered
while tracing the data path: (1) `maxRows` must be raised for those two specs or Apps
Script's default 1000-row cap silently truncates the ~28k-center universe (the exact bug
already fixed once for Center-360); (2) the dashboard payload cache must move from
`withCache` (100KB/key limit) to the existing `cachePutLarge`/`cacheGetLarge` gzip+chunked
helper, since these two arrays alone can now exceed that limit.

**Tech Stack:** Google Apps Script (V8), BigQuery REST API (`jobs.query`), `clasp` for push,
plain HTML/CSS/JS client (no framework).

## Global Constraints

- No unit-test framework exists in this codebase (plain Apps Script). "Testing" here follows
  the pattern already used in this repo: `node --check` for JS syntax, and a manual
  click-through of the `@HEAD` test deployment for behavior/UI correctness.
- Production stays on its pinned deployment (`AKfycbzpoIJm9lpvZs7uHniCuBnDTVONl0ASWhraz5WvXSfBYNUtx7jihLGzzTLQMF8fZwh4`)
  until a separate, explicit redeploy step the user performs — nothing in this plan touches
  that binding. All verification happens on the `@HEAD` test deployment:
  `https://script.google.com/a/macros/tricog.com/s/AKfycbyUlvvXqJo0f6z5LdqeSfarj9JnbvmnrcJf70Ciw0o/exec`.
- No changes to `centerUptimeSqlCD_` (the uptime/health/MTBF formulas) — this plan only
  changes what's displayed and how many rows are fetched, never the math.
- No changes to the 4 Centers-tab charts, Center 360, the segment filter, or the executive
  summary — explicitly out of scope per the approved design.
- Spec: `docs/superpowers/specs/2026-07-23-centers-tab-kpi-rebuild-design.md`.

---

### Task 1: Sync the git branch with live-only fixes that predate this plan

**Why this is its own task:** a live `clasp pull` (scriptId
`1AH4QA5XQf4bw0mQCOVL8KXXgBzfd_LXR8EhT5Bzt1KtRqf6ufUrwwOeG`) diffed against this git repo
shows 4 real content differences beyond line-ending noise — small label/stat-removal fixes
the user made directly in the Apps Script editor on 2026-07-22 that were never pushed to
git. Two of them (`App.html`'s `centersKpiGrid` and its KPI-update function) are inside the
exact block Task 2 needs to edit next. Skipping this sync would make Task 2's "before" code
wrong and — worse — silently revert those live fixes back onto production the next time
`clasp push` runs. (`appsscript.json`'s only difference is a trailing-newline byte; that one
is cosmetic-only and intentionally left alone.)

**Files:**
- Modify: `src/client/App.html` (6 spots: lines ~172, ~224, ~305, ~456, ~576, ~1538, ~2096-2097 — see steps)
- Modify: `src/server/JiraDump.js:9-20`
- Modify: `src/server/Numbers.js:54-127`
- Modify: `src/server/Setup.js:106-109`

**Interfaces:** none — this task only removes already-dead fields (`with_center`,
`jira_centers`, `in_cd`) and a stale label; nothing downstream reads them after this sync
(confirmed via grep: no remaining references anywhere in `src/`).

- [ ] **Step 1: `src/client/App.html` — demo/offline payload devices blocks**

Current (~line 172, inside the offline demo-data fallback):
```js
        devices: { total: 43794, with_center: 9888, jira_centers: 4621, in_cd: 9888, source: 'dump-snapshot', center_source: 'cloud_devices',
```
New:
```js
        devices: { total: 43794, source: 'dump-snapshot', center_source: 'cloud_devices',
```

Current (~line 224):
```js
        fleet: { total: 28444, with_center: 17323, jira_centers: 12028, in_cd: 12028,
```
New:
```js
        fleet: { total: 28444,
```

Current (~line 305, second occurrence in the same demo-data block):
```js
      fleet: { total: 28444, with_center: 17323, jira_centers: 12028, in_cd: 12028,
```
New:
```js
      fleet: { total: 28444,
```

- [ ] **Step 2: `src/client/App.html` — KPI tile definitions + wiring**

Current (~line 456, inside `buildKpiSkeletons()`'s `centersKpiGrid` block):
```js
      kpiTile('kpiCenters', 'building', 'var(--secondary)', 'Centers', 'active · paid') +
```
New:
```js
      kpiTile('kpiCenters', 'building', 'var(--secondary)', 'Centers', 'all centers') +
```

Current (~line 576, inside `renderDashboard()`, the Asset "Total devices" tile):
```js
    setKpi('kpiTotal', fleet.total != null ? fleet.total : kpi.total_devices,
      FMT.format(fleet.with_center || 0) + ' mapped to a center');
```
New:
```js
    setKpi('kpiTotal', fleet.total != null ? fleet.total : kpi.total_devices);
```

Current (~line 589, inside `renderDashboard()`, the Centers KPI tile):
```js
    setKpi('kpiCenters', ck.centers, 'active · paid');
```
New:
```js
    setKpi('kpiCenters', ck.centers, 'all centers');
```

- [ ] **Step 3: `src/client/App.html` — Overview tab's device KPI**

Current (~line 1538):
```js
    setKpi('exActive', fleet.total != null ? fleet.total : k.total_devices,
      FMT.format(fleet.with_center || 0) + ' mapped to a center');
```
New:
```js
    setKpi('exActive', fleet.total != null ? fleet.total : k.total_devices);
```

- [ ] **Step 4: `src/client/App.html` — Numbers page device reconciliation + METRIC_INFO**

Current (~line 1953):
```js
    $('numDevicesKpi').innerHTML = numCompare([
      { label: 'Devices', value: d.devices.total, hi: true },
      { label: 'Devices mapped', value: d.devices.with_center },
      { label: 'Centers mapped', value: d.devices.jira_centers },
      { label: 'In center_details', value: d.devices.in_cd }
    ]) + (devSrc ? '<div class="num-src">source: ' + escapeHtml(devSrc) + ' · mapped by ' + escapeHtml(mapSrc) + ' (Jira Customer ID ignored)</div>' : '');
```
New:
```js
    $('numDevicesKpi').innerHTML = numCompare([
      { label: 'Devices', value: d.devices.total, hi: true }
    ]) + (devSrc ? '<div class="num-src">source: ' + escapeHtml(devSrc) + ' · mapped by ' + escapeHtml(mapSrc) + ' (Jira Customer ID ignored)</div>' : '');
```

Current (~line 2096-2098):
```js
    devicesCount: { name: 'Devices',
      formula: 'Count of Jira-sheet devices (deduped by Key), restricted to Connector + ECG Machine. “Mapped” = those whose serial resolves to a center.',
      source: 'Jira devices Google Sheet; serial (from Summary) → center via cloud_devices then center_details.' },
    devicesMapped: { name: 'Devices mapped', formula: 'Devices whose serial resolves to a CenterID.', source: 'Jira-sheet serial ⋈ cloud_devices.DeviceID → CenterID.' },
```
New:
```js
    devicesCount: { name: 'Devices',
      formula: 'Count of Jira-sheet devices (deduped by Key), restricted to Connector + ECG Machine.',
      source: 'Jira devices Google Sheet.' },
```

- [ ] **Step 5: `src/server/JiraDump.js` — drop the dead-code fields from the offline snapshot**

Current (lines 9-20):
```js
 * Pre-aggregated (dedup by Key). The device→center link IGNORES the Jira
 * "Customer ID" column; instead the device serial (parsed from Summary) is
 * matched to cloud_devices.DeviceID → CenterID (center_details has no serial
 * column in the sandbox, so cloud_devices is the serial↔center bridge). Hence
 * with_center/in_cd only cover devices present in cloud_devices (~9.9k of 43.8k).
 * To refresh from a newer dump, re-run the aggregation and replace the object.
 */
var JIRA_DUMP = {
  total: 43794,
  with_center: 9888,
  jira_centers: 4621,
  in_cd: 9888,
  by_status: [
```
New:
```js
 * Pre-aggregated (dedup by Key). To refresh from a newer dump, re-run the
 * aggregation and replace the object.
 */
var JIRA_DUMP = {
  total: 43794,
  by_status: [
```

- [ ] **Step 6: `src/server/Numbers.js` — stop computing the dead `with_center`/`jira_centers`/`in_cd` stats**

Current (lines 54-127, full function):
```js
/**
 * Fleet/device stats shared by the Numbers page, Asset "Total fleet" and
 * Overview "Devices" KPI. Devices = Jira issues (dedup by Key). A device is
 * "mapped" when its serial resolves to a center via deviceCenterMap_. Cached.
 * @return {{total,with_center,jira_centers,in_cd,by_status,source,center_source}}
 */
function jiraDeviceStats_(segment) {
  segment = segClean_(segment);
  return withCache('jiradev_v5_' + segSlug_(segment), function () {
    var jiraRows = readJiraSheet();
    if (jiraRows) {
      jiraRows = jiraRows.filter(function (row) { return isTrackedJiraDeviceType_(row.issuetype_name); });
      var cdIds = {};
      getCenter360RowsCD_().forEach(function (c) { cdIds[c.center_id] = true; });
      // The Jira "Customer ID" column is IGNORED — a device's center comes from
      // its serial (parsed from Summary) via deviceCenterMap_.
      var dcm = deviceCenterMap_();
      var dev2ctr = dcm.map;
      var SERIAL_RE = /([A-Za-z0-9]{2}-[A-Za-z0-9]{6,})/;
      var byIssue = {};
      jiraRows.forEach(function (row) {
        var ik = String(row.issue_key || row.summary || '');
        if (!ik) return;
        if (!byIssue[ik]) {
          var m = SERIAL_RE.exec(String(row.summary || '').toUpperCase());
          var cid = m ? dev2ctr[m[1]] : undefined;
          // Device age = today − Created (assetAgeDays_ in Api.js).
          byIssue[ik] = { status: String(row.status_name || '').trim(),
            cid: (cid == null ? NaN : cid), age: assetAgeDays_(row.ticket_created) };
        }
      });
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
      var dTotal = 0, dWith = 0, dCenters = {}, dInCd = {}, dStatus = {};
      var ageSum = 0, ageN = 0;
      // Age bands (days): <1y / 1-2y / 2-3y / 3-5y / 5y+ (5-yr expected device life).
      var ageBands = { '<1y': 0, '1-2y': 0, '2-3y': 0, '3-5y': 0, '5y+': 0 };
      Object.keys(byIssue).forEach(function (ik) {
        var o = byIssue[ik]; dTotal++;
        if (isFinite(o.cid)) { dWith++; dCenters[o.cid] = true; if (cdIds[o.cid]) dInCd[o.cid] = true; }
        var st = o.status || '(blank)';
        dStatus[st] = (dStatus[st] || 0) + 1;
        if (o.age != null) {
          ageSum += o.age; ageN++;
          var y = o.age / 365;
          if (y < 1) ageBands['<1y']++; else if (y < 2) ageBands['1-2y']++;
          else if (y < 3) ageBands['2-3y']++; else if (y < 5) ageBands['3-5y']++;
          else ageBands['5y+']++;
        }
      });
      return {
        total: dTotal, with_center: dWith,
        jira_centers: Object.keys(dCenters).length, in_cd: Object.keys(dInCd).length,
        by_status: Object.keys(dStatus).map(function (k) { return { k: k, n: dStatus[k] }; })
          .sort(function (a, b) { return b.n - a.n; }),
        avg_age_days: ageN ? Math.round(ageSum / ageN) : null,
        aged_devices: ageN,
        past_life: ageBands['5y+'],          // devices older than the 5-yr expected life
        age_bands: Object.keys(ageBands).map(function (k) { return { k: k, n: ageBands[k] }; }),
        source: 'google-sheet', center_source: dcm.source
      };
    }
    return {
      total: JIRA_DUMP.total, with_center: JIRA_DUMP.with_center,
      jira_centers: JIRA_DUMP.jira_centers, in_cd: JIRA_DUMP.in_cd,
      by_status: JIRA_DUMP.by_status, source: 'dump-snapshot', center_source: 'cloud_devices'
    };
  });
}
```
New:
```js
/**
 * Fleet/device stats shared by the Numbers page, Asset "Total fleet" and
 * Overview "Devices" KPI. Devices = Jira issues (dedup by Key). A device's
 * serial resolves to a center via deviceCenterMap_ for segment filtering only
 * (see below) — device→center coverage itself is not surfaced as a stat. Cached.
 * @return {{total,by_status,source,center_source}}
 */
function jiraDeviceStats_(segment) {
  segment = segClean_(segment);
  return withCache('jiradev_v5_' + segSlug_(segment), function () {
    var jiraRows = readJiraSheet();
    if (jiraRows) {
      jiraRows = jiraRows.filter(function (row) { return isTrackedJiraDeviceType_(row.issuetype_name); });
      // The Jira "Customer ID" column is IGNORED — a device's center comes from
      // its serial (parsed from Summary) via deviceCenterMap_.
      var dcm = deviceCenterMap_();
      var dev2ctr = dcm.map;
      var SERIAL_RE = /([A-Za-z0-9]{2}-[A-Za-z0-9]{6,})/;
      var byIssue = {};
      jiraRows.forEach(function (row) {
        var ik = String(row.issue_key || row.summary || '');
        if (!ik) return;
        if (!byIssue[ik]) {
          var m = SERIAL_RE.exec(String(row.summary || '').toUpperCase());
          var cid = m ? dev2ctr[m[1]] : undefined;
          // Device age = today − Created (assetAgeDays_ in Api.js).
          byIssue[ik] = { status: String(row.status_name || '').trim(),
            cid: (cid == null ? NaN : cid), age: assetAgeDays_(row.ticket_created) };
        }
      });
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
      var dTotal = 0, dStatus = {};
      var ageSum = 0, ageN = 0;
      // Age bands (days): <1y / 1-2y / 2-3y / 3-5y / 5y+ (5-yr expected device life).
      var ageBands = { '<1y': 0, '1-2y': 0, '2-3y': 0, '3-5y': 0, '5y+': 0 };
      Object.keys(byIssue).forEach(function (ik) {
        var o = byIssue[ik]; dTotal++;
        var st = o.status || '(blank)';
        dStatus[st] = (dStatus[st] || 0) + 1;
        if (o.age != null) {
          ageSum += o.age; ageN++;
          var y = o.age / 365;
          if (y < 1) ageBands['<1y']++; else if (y < 2) ageBands['1-2y']++;
          else if (y < 3) ageBands['2-3y']++; else if (y < 5) ageBands['3-5y']++;
          else ageBands['5y+']++;
        }
      });
      return {
        total: dTotal,
        by_status: Object.keys(dStatus).map(function (k) { return { k: k, n: dStatus[k] }; })
          .sort(function (a, b) { return b.n - a.n; }),
        avg_age_days: ageN ? Math.round(ageSum / ageN) : null,
        aged_devices: ageN,
        past_life: ageBands['5y+'],          // devices older than the 5-yr expected life
        age_bands: Object.keys(ageBands).map(function (k) { return { k: k, n: ageBands[k] }; }),
        source: 'google-sheet', center_source: dcm.source
      };
    }
    return {
      total: JIRA_DUMP.total,
      by_status: JIRA_DUMP.by_status, source: 'dump-snapshot', center_source: 'cloud_devices'
    };
  });
}
```

- [ ] **Step 7: `src/server/Setup.js` — simplify the diagnostics log line**

Current (lines 106-109):
```js
  var jiraStats = jiraDeviceStats_();
  Logger.log('Jira devices (Connector + ECG Machine only): ' + jiraStats.total + ' total, ' +
    jiraStats.with_center + ' mapped to a center, source=' + jiraStats.source);
  Logger.log('Jira devices by status: ' + JSON.stringify(jiraStats.by_status));
```
New:
```js
  var jiraStats = jiraDeviceStats_();
  Logger.log('Jira devices (Connector + ECG Machine only): ' + jiraStats.total +
    ' total, source=' + jiraStats.source);
  Logger.log('Jira devices by status: ' + JSON.stringify(jiraStats.by_status));
```

- [ ] **Step 8: Syntax-check the two modified `.js` files**

Run: `node --check src/server/JiraDump.js && node --check src/server/Numbers.js && node --check src/server/Setup.js`
Expected: no output, exit code 0.

- [ ] **Step 9: Confirm the branch now matches live byte-for-byte (ignoring line endings)**

Run (from the repo root, comparing against a fresh `clasp pull` into a scratch dir — or, if
you already have the live clone from this session, point at it directly):
```bash
diff -u --strip-trailing-cr src/client/App.html <path-to-live-clone>/src/client/App.html
diff -u --strip-trailing-cr src/server/JiraDump.js <path-to-live-clone>/src/server/JiraDump.js
diff -u --strip-trailing-cr src/server/Numbers.js <path-to-live-clone>/src/server/Numbers.js
diff -u --strip-trailing-cr src/server/Setup.js <path-to-live-clone>/src/server/Setup.js
```
Expected: no output (empty diff) for all four.

- [ ] **Step 10: Commit**

```bash
git add src/client/App.html src/server/JiraDump.js src/server/Numbers.js src/server/Setup.js
git commit -m "Sync git with live-only label/stat-removal fixes (2026-07-22 cleanup never pushed)"
```

---

### Task 2: KPI grid — drop Active placements + Cities, add MTBF tile

**Files:**
- Modify: `src/client/App.html` (post-Task-1 line numbers: `buildKpiSkeletons()` ~455-461,
  `renderDashboard()` ~592-596, `KPI_METRIC` ~2134-2135)

**Interfaces:**
- Consumes: `data.uptimeFleet[0].avg_mtbf_days` — already computed server-side by
  `centerUptimeSqlCD_`'s `uptimeFleet` spec (`EditionCD.js:144-151`), unchanged by this plan.
  Already read once for the Center-health tile's subtitle (`App.html` `renderDashboard()`),
  so no new query.
- Produces: a `kpiMtbf` DOM element (via `kpiTile`/`setKpi`) that Task 3/4 do not depend on.

- [ ] **Step 1: Remove the two tiles and add the MTBF tile in `buildKpiSkeletons()`**

Current:
```js
    $('centersKpiGrid').innerHTML =
      kpiTile('kpiCenters', 'building', 'var(--secondary)', 'Centers', 'all centers') +
      kpiTile('kpiUptime', 'online', 'var(--ok)', 'Center uptime', 'avg per-center uptime') +
      kpiTile('kpiHealth', 'health', 'var(--primary)', 'Center health', 'avg score / 100') +
      kpiTile('kpiActiveDep', 'layers', 'var(--ok)', 'Active placements', 'deployment open') +
      kpiTile('kpiStates', 'map', 'var(--accent)', 'States', 'geographic reach') +
      kpiTile('kpiCities', 'map', 'var(--violet)', 'Cities', 'geographic reach');
```
New:
```js
    $('centersKpiGrid').innerHTML =
      kpiTile('kpiCenters', 'building', 'var(--secondary)', 'Centers', 'all centers') +
      kpiTile('kpiUptime', 'online', 'var(--ok)', 'Center uptime', 'avg per-center uptime') +
      kpiTile('kpiHealth', 'health', 'var(--primary)', 'Center health', 'avg score / 100') +
      kpiTile('kpiStates', 'map', 'var(--accent)', 'States', 'geographic reach') +
      kpiTile('kpiMtbf', 'clock', 'var(--violet)', 'MTBF', 'avg days between failures');
```

- [ ] **Step 2: Update the KPI-value wiring in `renderDashboard()`**

Current:
```js
    setKpi('kpiActiveDep', ck.active_deployments, pct(ck.active_deployments, ck.centers) + ' of centers');
    setKpi('kpiStates', ck.states, 'geographic reach');
    setKpi('kpiCities', ck.cities, 'geographic reach');
```
New:
```js
    setKpi('kpiStates', ck.states, 'geographic reach');
    setKpi('kpiMtbf', up && up.avg_mtbf_days != null ? up.avg_mtbf_days : null, 'avg days between failures');
```

(`up` is already defined two lines above this block — `var up = (data.uptimeFleet && data.uptimeFleet[0]) || null;` — no new variable needed.)

- [ ] **Step 3: Update `KPI_METRIC` — drop the two orphaned mappings, add the MTBF one**

Current:
```js
    kpiAvgAge: 'assetAge', kpiPastLife: 'assetAge', kpiActiveDep: 'activePlacements',
    kpiStates: 'statesReach', kpiCities: 'citiesReach',
```
New:
```js
    kpiAvgAge: 'assetAge', kpiPastLife: 'assetAge',
    kpiStates: 'statesReach', kpiMtbf: 'mtbf',
```

(`mtbf` is an existing `METRIC_INFO` entry — code `M-A2`, already fully defined at
`App.html` ~line 2028-2030 — no new tooltip content to write.)

- [ ] **Step 4: Remove the now-orphaned `activePlacements`/`citiesReach` `METRIC_INFO` entries**

Current (one of these lines, in the `METRIC_INFO` object):
```js
    activePlacements: { name: 'Active placements', formula: 'Device-center deployments currently open (no end date).', source: 'center_details (deactivationdate IS NULL).' },
```
Delete this line entirely.

Current (in the `// ── Centers ──` section of `METRIC_INFO`):
```js
    citiesReach: { name: 'Cities', formula: 'Distinct cities with at least one center.', source: 'center_details.city.' },
```
Delete this line entirely.

- [ ] **Step 5: Syntax-check**

Run: `node --check src/client/App.html`
Expected: this will actually fail — `App.html` is HTML with an embedded `<script>`, not pure
JS. Skip `node --check` for this file; instead do a quick balanced-braces sanity read of the
edited regions (all four edits above are single-line/single-block replacements with matching
punctuation to the original — visually confirm each diff applied cleanly with no stray comma
or missing semicolon before moving on).

- [ ] **Step 6: Commit**

```bash
git add src/client/App.html
git commit -m "Centers KPI grid: drop Active placements + Cities, add MTBF tile"
```

---

### Task 3: Merged watchlist — markup (Index.html + Styles.html)

**Files:**
- Modify: `src/client/Index.html:392-434` (replace two `<article>` cards with one)
- Modify: `src/client/Styles.html` (add one small CSS rule after line 1036)

**Interfaces:**
- Produces: DOM ids `centerWatchlistTable` (replacing `reliabilityTable` + `assetHealthTable`)
  and `watchlistSort` (a `<select>`), which Task 4's render/wiring code consumes by exact id.

- [ ] **Step 1: Replace the two watchlist cards in `Index.html`**

Current (lines 392-434 — both full `<article>` blocks):
```html
      <article class="card span-12">
        <header class="card-head">
          <h2 class="card-title">Reliability watchlist</h2>
          <p class="card-sub">Machine Uptime % (M-A1) · lowest-uptime centers first · click a row</p>
        </header>
        <div class="table-scroll">
          <table class="data-table" id="reliabilityTable">
            <caption class="sr-only">Centers with the lowest machine uptime</caption>
            <thead>
              <tr>
                <th scope="col">Center</th>
                <th scope="col" class="num">Devices</th>
                <th scope="col" class="num">Uptime %</th>
                <th scope="col" class="num">Downtime %</th>
                <th scope="col" class="num">Failures</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </article>

      <article class="card span-12">
        <header class="card-head">
          <h2 class="card-title">Center health score</h2>
          <p class="card-sub">Composite 0–100 (M-A6): 50% uptime + MTBF tier + failure tier · lowest first · click a row</p>
        </header>
        <div class="table-scroll">
          <table class="data-table" id="assetHealthTable">
            <caption class="sr-only">Centers with the lowest composite health score</caption>
            <thead>
              <tr>
                <th scope="col">Center</th>
                <th scope="col" class="num">Health</th>
                <th scope="col" class="num">Uptime %</th>
                <th scope="col" class="num">MTBF (days)</th>
                <th scope="col" class="num">Failures</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </article>
```
New:
```html
      <article class="card span-12">
        <header class="card-head">
          <h2 class="card-title">Reliability &amp; health</h2>
          <p class="card-sub">Uptime % (M-A1) and composite health score (M-A6) · worst centers first · click a row</p>
          <label class="watchlist-sort">Sort by
            <select id="watchlistSort" class="select">
              <option value="uptime_pct">Uptime % (worst first)</option>
              <option value="health_score">Health score (worst first)</option>
            </select>
          </label>
        </header>
        <div class="table-scroll">
          <table class="data-table" id="centerWatchlistTable">
            <caption class="sr-only">Centers ranked by uptime and health score, worst first</caption>
            <thead>
              <tr>
                <th scope="col">Center</th>
                <th scope="col" class="num">Devices</th>
                <th scope="col" class="num">Health</th>
                <th scope="col" class="num">Uptime %</th>
                <th scope="col" class="num">Downtime %</th>
                <th scope="col" class="num">MTBF (days)</th>
                <th scope="col" class="num">Failures</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </article>
```

- [ ] **Step 2: Add the sort-toggle style, right after the existing `.raw-pagesize` rules**

Current (`Styles.html` lines 1034-1036):
```css
.raw-actions { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.raw-pagesize { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-3); }
.raw-pagesize .select { padding: 6px 10px; font-size: 13px; }
```
New (adds one rule after the existing three, same pattern as `.raw-pagesize`):
```css
.raw-actions { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.raw-pagesize { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-3); }
.raw-pagesize .select { padding: 6px 10px; font-size: 13px; }
.watchlist-sort { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-3); margin-top: 8px; }
.watchlist-sort .select { padding: 6px 10px; font-size: 13px; }
```

- [ ] **Step 3: Commit**

```bash
git add src/client/Index.html src/client/Styles.html
git commit -m "Merge Reliability watchlist + Center health score cards into one with a sort toggle (markup)"
```

---

### Task 4: Merged watchlist — render logic (App.html)

**Files:**
- Modify: `src/client/App.html`: `state` object (~line 25), `renderDashboard()` call site
  (~line 619-620), `renderReliability`/`renderAssetHealth` functions (~line 740-777, replaced
  by one `renderCenterWatchlist`), `init()` (add one listener), `TITLE_METRIC` (~line 2144,
  2147), `METRIC_INFO.reliability` (~line 2071-2073).

**Interfaces:**
- Consumes: `data.reliability` (`{centerid, center, devices, uptime_pct, downtime_pct,
  failures}[]`) and `data.assetHealth` (`{centerid, uptime_pct, mtbf_hrs, failures,
  health_score}[]`) — both still produced by `EditionCD.js` (Task 5 makes them return every
  scored center instead of 12; this task's logic works correctly either way, since it always
  sorts + slices to 12 itself).
- Produces: `renderCenterWatchlist(reliabilityRows, assetHealthRows, sortBy)` — called from
  `renderDashboard()` and from the new `watchlistSort` change handler. `sortBy` is
  `'uptime_pct' | 'health_score'`.
- Consumes: `wireCenterRowClicks(tableEl)` (existing helper, unchanged) for row-click
  navigation to the center drawer.

- [ ] **Step 1: Add sort-preference state**

Current (`state` object, line 25):
```js
    centers: { sortBy: 'devices', sortDir: 'desc', page: 0, pageSize: 15 },
```
New (add a new top-level key right after `centers`, same object):
```js
    centers: { sortBy: 'devices', sortDir: 'desc', page: 0, pageSize: 15 },
    centersWatchlistSort: 'uptime_pct',
```

- [ ] **Step 2: Replace the two render functions with one merged-table renderer**

Current (lines 740-777, both full functions):
```js
  function renderReliability(rows) {
    var body = $('reliabilityTable').querySelector('tbody');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5" class="chart-empty">No reliability metrics yet</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (r) {
      var sev = r.uptime_pct >= 95 ? 'ok' : (r.uptime_pct >= 90 ? 'warn' : 'danger');
      return '<tr class="is-clickable" data-cid="' + escapeHtml(r.centerid) + '" tabindex="0" role="button" aria-label="Open ' + escapeHtml(r.center || ('center ' + r.centerid)) + '">' +
        '<td><strong>' + escapeHtml(r.center || ('Center #' + r.centerid)) + '</strong></td>' +
        '<td class="num">' + FMT.format(r.devices || 0) + '</td>' +
        '<td class="num"><span class="badge badge-' + sev + '">' + escapeHtml(r.uptime_pct) + '%</span></td>' +
        '<td class="num">' + escapeHtml(r.downtime_pct) + '%</td>' +
        '<td class="num">' + FMT.format(r.failures || 0) + '</td>' +
        '</tr>';
    }).join('');
    wireCenterRowClicks($('reliabilityTable'));
  }

  function renderAssetHealth(rows) {
    var body = $('assetHealthTable').querySelector('tbody');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5" class="chart-empty">No health data yet</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (r) {
      var band = r.health_score >= 80 ? 'ok' : (r.health_score >= 60 ? 'warn' : 'danger');
      var mtbf = r.mtbf_hrs == null ? '—' : FMT.format(Math.round(r.mtbf_hrs / 24)) + 'd';
      return '<tr class="is-clickable" data-cid="' + escapeHtml(r.centerid) + '" tabindex="0" role="button" aria-label="Open ' + escapeHtml(r.center || ('center ' + r.centerid)) + '">' +
        '<td><strong>' + escapeHtml(r.center || ('Center #' + r.centerid)) + '</strong></td>' +
        '<td class="num"><span class="badge badge-' + band + '">' + escapeHtml(r.health_score) + '</span></td>' +
        '<td class="num">' + escapeHtml(r.uptime_pct) + '%</td>' +
        '<td class="num">' + mtbf + '</td>' +
        '<td class="num">' + FMT.format(r.failures || 0) + '</td>' +
        '</tr>';
    }).join('');
    wireCenterRowClicks($('assetHealthTable'));
  }
```
New:
```js
  /**
   * Merges reliability + assetHealth by centerid (both arrays cover the exact
   * same "scored" center set — see centerUptimeSqlCD_ — so every reliability
   * row has a matching assetHealth row), sorts by sortBy ascending (worst
   * first — both uptime_pct and health_score are "higher is better"), and
   * renders the worst 12.
   */
  function renderCenterWatchlist(reliabilityRows, assetHealthRows, sortBy) {
    var body = $('centerWatchlistTable').querySelector('tbody');
    var healthByCid = {};
    (assetHealthRows || []).forEach(function (r) { healthByCid[r.centerid] = r; });
    var merged = (reliabilityRows || []).map(function (r) {
      var h = healthByCid[r.centerid] || {};
      return {
        centerid: r.centerid, center: r.center, devices: r.devices,
        uptime_pct: r.uptime_pct, downtime_pct: r.downtime_pct, failures: r.failures,
        health_score: h.health_score, mtbf_hrs: h.mtbf_hrs
      };
    });
    merged.sort(function (a, b) { return a[sortBy] - b[sortBy]; });
    var rows = merged.slice(0, 12);
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="chart-empty">No reliability/health metrics yet</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (r) {
      var uptimeSev = r.uptime_pct >= 95 ? 'ok' : (r.uptime_pct >= 90 ? 'warn' : 'danger');
      var healthBand = r.health_score >= 80 ? 'ok' : (r.health_score >= 60 ? 'warn' : 'danger');
      var mtbf = r.mtbf_hrs == null ? '—' : FMT.format(Math.round(r.mtbf_hrs / 24)) + 'd';
      return '<tr class="is-clickable" data-cid="' + escapeHtml(r.centerid) + '" tabindex="0" role="button" aria-label="Open ' + escapeHtml(r.center || ('center ' + r.centerid)) + '">' +
        '<td><strong>' + escapeHtml(r.center || ('Center #' + r.centerid)) + '</strong></td>' +
        '<td class="num">' + FMT.format(r.devices || 0) + '</td>' +
        '<td class="num"><span class="badge badge-' + healthBand + '">' + escapeHtml(r.health_score) + '</span></td>' +
        '<td class="num"><span class="badge badge-' + uptimeSev + '">' + escapeHtml(r.uptime_pct) + '%</span></td>' +
        '<td class="num">' + escapeHtml(r.downtime_pct) + '%</td>' +
        '<td class="num">' + mtbf + '</td>' +
        '<td class="num">' + FMT.format(r.failures || 0) + '</td>' +
        '</tr>';
    }).join('');
    wireCenterRowClicks($('centerWatchlistTable'));
  }
```

- [ ] **Step 3: Update the call site in `renderDashboard()`**

Current:
```js
    renderReliability(data.reliability || []);
    renderAssetHealth(data.assetHealth || []);
```
New:
```js
    renderCenterWatchlist(data.reliability || [], data.assetHealth || [], state.centersWatchlistSort);
```

- [ ] **Step 4: Wire the sort-toggle change handler in `init()`**

Current (one of the per-page segment listeners, for exact insertion point — add the new
listener immediately after this block):
```js
    // Per-page Segment dropdowns — each drives every KPI/chart/table on its page.
    ['assetSegment', 'centersSegment', 'supportSegment'].forEach(function (id) {
      var sel = $(id);
      if (!sel) return;
      sel.addEventListener('change', function (event) {
        var page = sel.getAttribute('data-page');
        state.pageSegment[page] = event.target.value;
        if (page === 'centers') { state.centers.page = 0; loadCenters(); }
        if (page === 'asset') { state.devices.page = 0; loadDevices(); }
        loadDashboard(false); // shared payload refetches with the active page's segment
      });
    });
```
New (add immediately after, as its own block — data is already in memory, no refetch):
```js
    // Per-page Segment dropdowns — each drives every KPI/chart/table on its page.
    ['assetSegment', 'centersSegment', 'supportSegment'].forEach(function (id) {
      var sel = $(id);
      if (!sel) return;
      sel.addEventListener('change', function (event) {
        var page = sel.getAttribute('data-page');
        state.pageSegment[page] = event.target.value;
        if (page === 'centers') { state.centers.page = 0; loadCenters(); }
        if (page === 'asset') { state.devices.page = 0; loadDevices(); }
        loadDashboard(false); // shared payload refetches with the active page's segment
      });
    });

    // Reliability/health watchlist sort toggle — re-renders from the already-
    // fetched dashboard payload, no refetch needed.
    $('watchlistSort').addEventListener('change', function (event) {
      state.centersWatchlistSort = event.target.value;
      if (state.lastDashboard) {
        renderCenterWatchlist(state.lastDashboard.reliability || [], state.lastDashboard.assetHealth || [], state.centersWatchlistSort);
      }
    });
```

- [ ] **Step 5: Update `TITLE_METRIC` — repoint the merged card title, drop the dead entry**

Current:
```js
    'centers needing attention': 'attention', 'reliability watchlist': 'reliability',
```
New:
```js
    'centers needing attention': 'attention', 'reliability & health': 'reliability',
```

Current (drop this line entirely — the card title it referenced, "Asset health score", was
already renamed to "Center health score" in an earlier rebuild pass and is now removed
altogether by Task 3, so this entry has been dead in both states):
```js
    'asset health score': 'health', 'first-time-failure by production batch': 'ftf',
```
New:
```js
    'first-time-failure by production batch': 'ftf',
```

- [ ] **Step 6: Update the `METRIC_INFO.reliability` tooltip content to describe the merged table**

Current:
```js
    reliability: { name: 'Reliability watchlist',
      formula: 'Centers with the lowest Machine Uptime % (M-A1), lowest first.',
      source: 'The uptime engine (see M-A1).' },
```
New:
```js
    reliability: { name: 'Reliability & health watchlist',
      formula: 'Centers ranked by Machine Uptime % (M-A1) or composite Health Score (M-A6), whichever the sort toggle selects — worst first either way.',
      source: 'The uptime engine (see M-A1/M-A6).' },
```

- [ ] **Step 7: Sanity-check the edits**

Same as Task 2 Step 5 — `App.html` is not pure JS, so skip `node --check`; visually confirm
each block above applied with matching braces/commas.

- [ ] **Step 8: Commit**

```bash
git add src/client/App.html
git commit -m "Merge Reliability watchlist + Center health score cards into one with a sort toggle (render logic)"
```

---

### Task 5: Backend — return every scored center, and cache the larger payload safely

**Why this is its own task:** three changes that all stem from the same root cause (the
`reliability`/`assetHealth` arrays are about to get much bigger) and must land together —
splitting `LIMIT 12` removal from the `maxRows`/caching fix would ship a silent 1000-row
truncation bug (already happened once before, in `getCenter360RowsCD_`) for however long the
two commits are separate.

**Files:**
- Modify: `src/server/EditionCD.js:141-154` (drop `LIMIT 12` ×2), `:159-162` (add `maxRows`
  override), `:387-419` (`apiGetDashboardCD` — swap cache mechanism)
- Modify: `src/server/Setup.js:127-153` (`clearDashboardCache` — move `dashcd_v5_*` to the
  large-cache clearing path)

**Interfaces:**
- Consumes: `cachePutLarge(key, value, ttlSeconds)` / `cacheGetLarge(key)` — existing helpers
  in `BigQuery.js` (gzip + base64 + gets chunked around CacheService's 100KB/key limit),
  already used by `getCenter360RowsCD_`'s `ctr360cd_v5` cache. Unmodified by this task.
- Produces: `results.reliability` / `results.assetHealth` now contain every scored center
  (previously 12 each) — consumed by Task 4's `renderCenterWatchlist`.

- [ ] **Step 1: Drop `LIMIT 12` from both specs (keep `ORDER BY` — harmless, and matches the
  "no other SQL change" scope agreed in the design)**

Current (`buildDashboardQuerySpecsCD`, lines 141-143):
```js
    reliability: centerUptimeSqlCD_(
      "SELECT center_id AS centerid, uptime_pct, ROUND(100 - uptime_pct, 1) AS downtime_pct, " +
      " failures, ROUND(life_hrs / 24.0, 0) AS life_days FROM scored ORDER BY uptime_pct ASC LIMIT 12", segment),
```
New:
```js
    reliability: centerUptimeSqlCD_(
      "SELECT center_id AS centerid, uptime_pct, ROUND(100 - uptime_pct, 1) AS downtime_pct, " +
      " failures, ROUND(life_hrs / 24.0, 0) AS life_days FROM scored ORDER BY uptime_pct ASC", segment),
```

Current (lines 152-154):
```js
    assetHealth: centerUptimeSqlCD_(
      "SELECT center_id AS centerid, uptime_pct, mtbf_hrs, failures, health_score " +
      "FROM scored ORDER BY health_score ASC LIMIT 12", segment)
```
New:
```js
    assetHealth: centerUptimeSqlCD_(
      "SELECT center_id AS centerid, uptime_pct, mtbf_hrs, failures, health_score " +
      "FROM scored ORDER BY health_score ASC", segment)
```

- [ ] **Step 2: Raise `maxRows` for exactly these two specs**

Current (lines 159-162):
```js
  var specs = buildDashboardQuerySpecs(hub, segment).map(function (s) {
    return cd[s.key] ? { key: s.key, params: s.params, sql: cd[s.key], maxRows: s.maxRows } : s;
  });
```
New (add the override right after — the mapped spec inherits `maxRows` from the *original*,
non-CD spec, which has none, so without this override both queries would default to
`CONFIG.MAX_ROWS` = 1000 and silently truncate the ~28k-center universe):
```js
  var specs = buildDashboardQuerySpecs(hub, segment).map(function (s) {
    return cd[s.key] ? { key: s.key, params: s.params, sql: cd[s.key], maxRows: s.maxRows } : s;
  });
  // reliability/assetHealth now return EVERY scored center (LIMIT removed above) so the
  // client can merge + sort-toggle between uptime% and health score — the default
  // MAX_ROWS (1000) would silently truncate the ~28k-center universe, repeating the
  // exact bug already fixed once in getCenter360RowsCD_ (see its own maxRows comment).
  specs.forEach(function (s) {
    if (s.key === 'reliability' || s.key === 'assetHealth') s.maxRows = 60000;
  });
```

- [ ] **Step 3: Switch `apiGetDashboardCD`'s cache from `withCache` to `cachePutLarge`/`cacheGetLarge`**

Current (lines 387-419, full function):
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
New:
```js
function apiGetDashboardCD(options) {
  options = options || {};
  var hub = String(options.hub || '').slice(0, 120);
  var segment = segClean_(options.segment);
  return respond_(function () {
    // reliability/assetHealth now carry every scored center (2026-07-23 watchlist
    // merge), not just 12, so this payload can exceed withCache's 100KB-per-key
    // limit. cachePutLarge/cacheGetLarge (gzip + chunked, already used for
    // Center-360) replace withCache here — same TTL, no size ceiling.
    var cacheKey = 'dashcd_v5_' + segSlug_(segment) + '_' + shortHash(hub);
    if (options.bypassCache !== true) {
      var cached = cacheGetLarge(cacheKey);
      if (cached) return cached;
    }
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
    cachePutLarge(cacheKey, results, CONFIG.CACHE_TTL_SECONDS);
    return results;
  });
}
```

- [ ] **Step 4: Move `dashcd_v5_*` from the small-cache clear list to the large-cache clear loop**

Current (`Setup.js`, lines 127-153, full function):
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
New:
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
  // Large (gzip-chunked) caches: remove #meta + each chunk.
  var largeBases = ['ctr360_v3', 'ctr360cd_v5', 'map_v3', 'mapcd_v5', 'assets_v3',
    'rawsheet_v1_' + CONFIG.JIRA_SHEET_ID, 'rawsheet_v1_' + CONFIG.CS_SHEET_ID];
  slugs.forEach(function (sg) {
    small.push('jiradev_v5_' + sg);
    // dashcd_v5_* moved to the large (gzip-chunked) cache 2026-07-23 — its
    // reliability/assetHealth arrays now carry every scored center, not 12,
    // and can exceed withCache's 100KB-per-key limit (see EditionCD.js
    // apiGetDashboardCD).
    largeBases.push('dashcd_v5_' + sg + '_' + h);
  });
  cache.removeAll(small);
  largeBases.forEach(function (base) {
    var meta = cache.get(base + '#meta');
    var n = meta ? parseInt(meta, 10) : 40;
    var keys = [base + '#meta'];
    for (var i = 0; i < n; i++) keys.push(base + '#' + i);
    cache.removeAll(keys);
  });
  Logger.log('Caches cleared (' + slugs.length + ' segment slices) — next load recomputes.');
}
```

- [ ] **Step 5: Syntax-check**

Run: `node --check src/server/EditionCD.js && node --check src/server/Setup.js`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/server/EditionCD.js src/server/Setup.js
git commit -m "Return every scored center for the watchlist merge; move its cache to the large-object store"
```

---

### Task 6: Push and verify on the `@HEAD` test deployment

**Files:** none (operational + manual verification).

- [ ] **Step 1: Record today's "before" values from the live site, for comparison**

Open the current production URL (or `@HEAD`) and note down: the Centers KPI grid's 6 values
(Centers, Center uptime, Center health, Active placements, States, Cities), and the first 12
rows (center name + values) of both the Reliability watchlist and Center health score
tables. These become the pass/fail baseline for Steps 4-5 below.

- [ ] **Step 2: Point clasp at the real project and push**

Create a local (gitignored) `.clasp.json` in the repo root:
```json
{
  "scriptId": "1AH4QA5XQf4bw0mQCOVL8KXXgBzfd_LXR8EhT5Bzt1KtRqf6ufUrwwOeG",
  "rootDir": "src"
}
```
Run: `clasp push -f`
Expected: file list printed, no error.

- [ ] **Step 3: Clear caches**

In the Apps Script editor, select `clearDashboardCache` in the function dropdown → Run.
Expected: completes without error; Execution Log shows `Caches cleared (N segment slices)`.

- [ ] **Step 4: Click through the Centers tab on `@HEAD`**

Navigate to:
```
https://script.google.com/a/macros/tricog.com/s/AKfycbyUlvvXqJo0f6z5LdqeSfarj9JnbvmnrcJf70Ciw0o/exec
```
Open the Centers / Customers tab. Expected: 0 browser console errors; KPI grid shows 5 tiles
(Centers, Center uptime, Center health, States, MTBF); Centers/Center uptime/Center
health/States values match the Step 1 baseline exactly (unchanged formulas); MTBF shows a
sane value (roughly matching what used to be in the Center-health tile's subtitle).

- [ ] **Step 5: Verify the merged watchlist**

With the sort toggle on its default ("Uptime % (worst first)"), confirm the 12 rows shown
match the Step 1 Reliability-watchlist baseline row-for-row (same centers, same order).
Switch the toggle to "Health score (worst first)" and confirm the 12 rows now match the
Step 1 Center-health-score baseline row-for-row. Click one row in each mode and confirm the
center drawer opens (via `wireCenterRowClicks`, unchanged).

- [ ] **Step 6: If any check fails, stop and debug before considering this plan done**

A KPI-value mismatch means Task 1's sync or Task 2's edit has a mistake; a watchlist
row-set mismatch most likely means Task 5's `maxRows` override didn't take effect (check the
Execution Log for a BigQuery row-count warning) or Task 4's merge-by-`centerid` has a bug.

---

## Self-review (completed by the plan author before handoff)

1. **Spec coverage:** Every section of the design doc has a task — §3 (KPI grid) → Task 2,
   §4 (merged watchlist, both markup and data/backend) → Tasks 3-5, §5 (explicitly
   unchanged items) → verified untouched by grepping this plan's diffs against those file
   regions, §7 (testing) → Task 6. Task 1 wasn't in the design doc because it was discovered
   during implementation planning (git/live divergence) — it's a prerequisite the design's
   "no other SQL/behavior change" intent implicitly requires, not scope creep.
2. **Placeholder scan:** no TBD/TODO; every step shows exact before/after code or exact
   commands with expected output.
3. **Type/name consistency:** `renderCenterWatchlist(reliabilityRows, assetHealthRows,
   sortBy)` (Task 4, defined once) is called identically from two places (the `renderDashboard`
   call site and the `watchlistSort` change handler) with the same 3-argument shape both
   times. `state.centersWatchlistSort` (Task 4 Step 1) is read in both call sites and written
   only in the change handler. `kpiMtbf` (Task 2) is referenced consistently across
   `buildKpiSkeletons`, `renderDashboard`'s `setKpi` call, and `KPI_METRIC`. `cachePutLarge`/
   `cacheGetLarge` (Task 5) are pre-existing `BigQuery.js` helpers, signature unchanged.
4. **Scope check:** six tasks, each independently committable and testable; Task ordering
   respects real dependencies (3 before 4, since 4's code references ids Task 3 creates; 1
   before 2, since 2 edits a block Task 1 also touches). This is one cohesive change (one
   tab, one design doc) — not split across independent subsystems.
