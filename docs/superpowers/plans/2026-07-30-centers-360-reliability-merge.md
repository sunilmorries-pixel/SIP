# Centers 360 / Reliability & Health Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the Centers/Customers page's "Reliability & Health" watchlist table into the "Center 360" explorer table as two new columns (MTBF, Failures), delete the watchlist card, and pin the Center column while scrolling.

**Architecture:** No new BigQuery query is introduced. `getCenter360RowsCD_` (server) already runs a no-`LIMIT` uptime/health query for every center; its tail-`SELECT` gains two fields already computed inside that query's CTE chain. The client's existing paginated/sortable Center 360 table gains two columns and loses two others; the separate watchlist card, its render function, and its dead sort-state are deleted outright. A CSS-only change pins the first column during horizontal scroll.

**Tech Stack:** Google Apps Script (server, `src/server/*.js`), vanilla JS + HTML/CSS (client, `src/client/*.html`), BigQuery, Jest (`npm test`) for the existing unit suite, `scripts/build_preview.ps1` for local mock-data preview.

## Global Constraints

- Final Center 360 column set (14 total, order): Center, ID, Hub, City, State, Devices, Jira devices, Lifecycle, Downtime, Uptime, Tickets, Open tickets, **MTBF (days)**, **Failures**. Online and Last heartbeat are removed; Health is NOT added.
- The MTBF/Failures formula must be byte-for-byte the same as the deleted watchlist's (same CTE chain in `centerUptimeSqlCD_`, `EditionCD.js:90-127`) — this is a projection/display change, never a metric change.
- Default sort on Center 360 stays `devices` descending — no "worst first" default is introduced.
- `reliability` (the per-center uptime/downtime spec) must NOT be removed from `buildDashboardQuerySpecsCD` or from what `apiGetDashboardCD` requests — only `assetHealth` is dropped from that one endpoint. Overview's `apiGetExecOverviewCD` depends on `reliability` staying intact.
- Sticky-column CSS is scoped to `#centerTable` only — no other `.data-table` in the app is touched.
- Cache key version bumps follow the repo's existing convention (suffix `_vN` bumped whenever row/payload shape changes): `ctr360cd_v6`→`v7`, `dashcd_v6_`→`v7_`.
- Do not `clasp push` or `clasp deploy` as part of any task — this repo always treats pushing to the Apps Script editor/production as a separate, explicitly-confirmed action after the plan's tasks are reviewed (see `docs/superpowers/specs/2026-07-30-centers-360-reliability-merge-design.md`, and this project's established pattern of confirming before any deploy).

---

## Task 1: Server — add MTBF/Failures to Center 360, retire `assetHealth` from the dashboard payload

**Files:**
- Modify: `src/server/EditionCD.js:366-436` (`getCenter360RowsCD_`)
- Modify: `src/server/EditionCD.js:512-577` (`apiGetDashboardCD`)
- Modify: `src/server/Api.js:65-70` (`CENTER_SORT_KEYS`)
- Modify: `src/server/Setup.js:141-157` (`clearDashboardCache`)

**Interfaces:**
- Produces: `getCenter360RowsCD_()` rows now carry `mtbf_hrs` (number or `null`) and `failures` (number) alongside the existing `lifecycle_years`/`downtime_days`/`uptime_pct`. `apiGetDashboardCD(...)` results no longer contain an `assetHealth` key. `CENTER_SORT_KEYS` recognizes `mtbf_hrs`/`failures` as sortable and no longer recognizes `online`/`last_seen`.
- Consumes: nothing new — reuses `centerUptimeSqlCD_` (`EditionCD.js:90-127`, unchanged) and `runQuery`/`runQueriesParallel` (existing).

- [x] **Step 1: Extend the per-center uptime query's tail-select in `getCenter360RowsCD_`**

In `src/server/EditionCD.js`, find:

```js
  var uptimeRows = runQuery(centerUptimeSqlCD_(
    "SELECT center_id, " +
    " ROUND(life_hrs / 24 / 365, 2) AS lifecycle_years, " +
    " ROUND(downtime_hrs / 24, 1) AS downtime_days, " +
    " uptime_pct FROM scored"), null, { maxRows: 60000 });
```

Replace with:

```js
  var uptimeRows = runQuery(centerUptimeSqlCD_(
    "SELECT center_id, " +
    " ROUND(life_hrs / 24 / 365, 2) AS lifecycle_years, " +
    " ROUND(downtime_hrs / 24, 1) AS downtime_days, " +
    " uptime_pct, mtbf_hrs, failures FROM scored"), null, { maxRows: 60000 });
```

(`mtbf_hrs` and `failures` already exist on the `scored`/`calc` CTEs inside `centerUptimeSqlCD_` — this only adds them to the outer projection. `health_score` also exists there but is deliberately NOT selected.)

- [x] **Step 2: Merge the two new fields into the joined rows**

Find:

```js
  var joined = withTickets.map(function (row) {
    var u = uptimeByCenter[row.center_id];
    row.lifecycle_years = u ? u.lifecycle_years : null;
    row.downtime_days = u ? u.downtime_days : null;
    row.uptime_pct = u ? u.uptime_pct : null;
    row.jira_devices = jiraCountByCenter[row.center_id] || 0;
    return row;
  });
```

Replace with:

```js
  var joined = withTickets.map(function (row) {
    var u = uptimeByCenter[row.center_id];
    row.lifecycle_years = u ? u.lifecycle_years : null;
    row.downtime_days = u ? u.downtime_days : null;
    row.uptime_pct = u ? u.uptime_pct : null;
    row.mtbf_hrs = u ? u.mtbf_hrs : null;
    row.failures = u ? u.failures : 0;
    row.jira_devices = jiraCountByCenter[row.center_id] || 0;
    return row;
  });
```

- [x] **Step 3: Bump the Center 360 cache key**

Find:

```js
function getCenter360RowsCD_(bypassCache) {
  var ckey = 'ctr360cd_v6';
```

Replace with:

```js
function getCenter360RowsCD_(bypassCache) {
  var ckey = 'ctr360cd_v7'; // v7: added mtbf_hrs/failures columns
```

- [x] **Step 4: Update `clearDashboardCache()` to match the new cache key**

In `src/server/Setup.js`, find:

```js
  ['ctr360cd_v6', 'map_v3', 'assets_v3'].forEach(function (base) {
```

Replace with:

```js
  ['ctr360cd_v7', 'map_v3', 'assets_v3'].forEach(function (base) {
```

- [x] **Step 5: Exclude `assetHealth` from `apiGetDashboardCD`'s query list, bump its cache key**

In `src/server/EditionCD.js`, find:

```js
    // reliability/assetHealth now carry every scored center (2026-07-23 watchlist
    // merge), not just 12, so this payload can exceed withCache's 100KB-per-key
    // limit. cachePutLarge/cacheGetLarge (gzip + chunked, already used for
    // Center-360) replace withCache here — same TTL, no size ceiling.
    var cacheKey = 'dashcd_v6_' + getCacheEpoch_() + '_' + filterHash_(filters) + '_' + shortHash(hub);
    if (options.bypassCache !== true) {
      var cached = cacheGetLarge(cacheKey);
      if (cached) return cached;
    }
    var results = runQueriesParallel(buildDashboardQuerySpecsCD(hub, filters));
    enrichCenterNamesCD_(results.reliability);
    enrichCenterNamesCD_(results.assetHealth);
```

Replace with:

```js
    // reliability carries every scored center (2026-07-23 watchlist merge,
    // narrowed 2026-07-30 to drop the no-longer-needed assetHealth spec from
    // THIS endpoint only — see the .filter() below), not just 12, so this
    // payload can exceed withCache's 100KB-per-key limit. cachePutLarge/
    // cacheGetLarge (gzip + chunked, already used for Center-360) replace
    // withCache here — same TTL, no size ceiling.
    var cacheKey = 'dashcd_v7_' + getCacheEpoch_() + '_' + filterHash_(filters) + '_' + shortHash(hub);
    if (options.bypassCache !== true) {
      var cached = cacheGetLarge(cacheKey);
      if (cached) return cached;
    }
    // assetHealth is excluded here (2026-07-30): Center 360 now carries
    // mtbf_hrs/failures directly, so nothing consumes this endpoint's
    // assetHealth anymore. reliability is NOT excluded — it stays computed
    // (Overview's separate apiGetExecOverviewCD endpoint depends on the same
    // spec definition, and this array is otherwise harmless/unused here).
    var dashSpecs = buildDashboardQuerySpecsCD(hub, filters).filter(function (s) {
      return s.key !== 'assetHealth';
    });
    var results = runQueriesParallel(dashSpecs);
    enrichCenterNamesCD_(results.reliability);
```

- [x] **Step 6: Update `CENTER_SORT_KEYS`**

In `src/server/Api.js`, find:

```js
var CENTER_SORT_KEYS = {
  center: 'center', state: 'state', devices: 'devices',
  online: 'online', open_tickets: 'open_tickets', last_seen: 'last_seen',
  lifecycle_years: 'lifecycle_years', downtime_days: 'downtime_days',
  uptime_pct: 'uptime_pct', tickets_total: 'tickets_total', jira_devices: 'jira_devices'
};
```

Replace with:

```js
var CENTER_SORT_KEYS = {
  center: 'center', state: 'state', devices: 'devices',
  open_tickets: 'open_tickets',
  lifecycle_years: 'lifecycle_years', downtime_days: 'downtime_days',
  uptime_pct: 'uptime_pct', tickets_total: 'tickets_total', jira_devices: 'jira_devices',
  mtbf_hrs: 'mtbf_hrs', failures: 'failures'
};
```

(`online`/`last_seen` are removed — their columns are going away in Task 4, and `apiGetCentersCD`'s `CENTER_SORT_KEYS[clean.sortBy] || 'devices'` already falls back safely to `'devices'` for any now-unrecognized `sortBy` value, so removing these entries cannot throw.)

- [x] **Step 7: Run the existing unit suite to confirm no regressions**

Run: `npm test`
Expected: all existing suites pass (this task adds no new pure-JS logic — `sortRows`, in `src/server/Join.js`, already handles `null` values generically, so the nullable `mtbf_hrs` needs no special-casing).

**Result (2026-08-03): 62/62 pass, no regressions.**

- [ ] **Step 8: Manual server-side spot check in the Apps Script editor** — **NOT DONE.** Requires
  `clasp push` first, which the Global Constraints above explicitly say not to do as part of any
  task, and then running a function inside the Apps Script editor UI, which isn't reachable from
  this environment either way. Needs the user (or a session with editor access) to push and run
  the `_verifyTask1()` snippet below before Task 2 starts touching the client side of this same
  data.

After pushing this task's changes to the Apps Script editor (`clasp push` — NOT deploy), open the editor and run:

```js
function _verifyTask1() {
  var rows = getCenter360RowsCD_(true);
  Logger.log(JSON.stringify(rows.slice(0, 3).map(function (r) {
    return { center: r.center, mtbf_hrs: r.mtbf_hrs, failures: r.failures };
  })));
  var dash = apiGetDashboardCD({ bypassCache: true });
  Logger.log('assetHealth present? ' + (dash.data.assetHealth !== undefined));
}
```

Expected: the logged rows show sane `mtbf_hrs`/`failures` values (not all `null`/`0`), and `assetHealth present?` logs `false`.

- [x] **Step 9: Commit**

```bash
git add src/server/EditionCD.js src/server/Api.js src/server/Setup.js
git commit -m "Server: add MTBF/Failures to Center 360, drop unused assetHealth from dashboard payload"
```

**Committed as `6260e57` (2026-08-03).**

---

## Task 2: Client — add MTBF/Failures columns to Center 360 (watchlist stays, for side-by-side comparison)

**Files:**
- Modify: `src/client/App.html:1035-1050` (`CENTER_COLUMNS`)
- Modify: `src/client/App.html:1093-1128` (`renderCenterTable`)
- Modify: `src/client/App.html:108-126` (`apiGetCenters` mock)

**Interfaces:**
- Consumes: `mtbf_hrs`/`failures` fields on Center 360 rows (Task 1).
- Produces: `CENTER_COLUMNS` array gains 2 entries (`mtbf_hrs`, `failures`) that Task 4's cleanup and Task 5's CSS both assume are present and rendered as ordinary (non-first) columns.

- [x] **Step 1: Add the 2 new columns to `CENTER_COLUMNS`**

Find:

```js
  var CENTER_COLUMNS = [
    { key: 'center', label: 'Center', sortable: true },
    { key: 'center_id', label: 'ID', sortable: false, num: true },
    { key: 'hub', label: 'Hub', sortable: false },
    { key: 'city', label: 'City', sortable: false },
    { key: 'state', label: 'State', sortable: true },
    { key: 'devices', label: 'Devices', sortable: true, num: true },
    { key: 'jira_devices', label: 'Jira devices', sortable: true, num: true },
    { key: 'online', label: 'Online', sortable: true, num: true },
    { key: 'lifecycle_years', label: 'Lifecycle', sortable: true, num: true },
    { key: 'downtime_days', label: 'Downtime', sortable: true, num: true },
    { key: 'uptime_pct', label: 'Uptime', sortable: true, num: true },
    { key: 'tickets_total', label: 'Tickets', sortable: true, num: true },
    { key: 'open_tickets', label: 'Open tickets', sortable: true, num: true },
    { key: 'last_seen', label: 'Last heartbeat', sortable: true, num: true }
  ];
```

Replace with:

```js
  var CENTER_COLUMNS = [
    { key: 'center', label: 'Center', sortable: true },
    { key: 'center_id', label: 'ID', sortable: false, num: true },
    { key: 'hub', label: 'Hub', sortable: false },
    { key: 'city', label: 'City', sortable: false },
    { key: 'state', label: 'State', sortable: true },
    { key: 'devices', label: 'Devices', sortable: true, num: true },
    { key: 'jira_devices', label: 'Jira devices', sortable: true, num: true },
    { key: 'online', label: 'Online', sortable: true, num: true },
    { key: 'lifecycle_years', label: 'Lifecycle', sortable: true, num: true },
    { key: 'downtime_days', label: 'Downtime', sortable: true, num: true },
    { key: 'uptime_pct', label: 'Uptime', sortable: true, num: true },
    { key: 'tickets_total', label: 'Tickets', sortable: true, num: true },
    { key: 'open_tickets', label: 'Open tickets', sortable: true, num: true },
    { key: 'last_seen', label: 'Last heartbeat', sortable: true, num: true },
    { key: 'mtbf_hrs', label: 'MTBF (days)', sortable: true, num: true },
    { key: 'failures', label: 'Failures', sortable: true, num: true }
  ];
```

(`online`/`last_seen` stay in this step — they're only removed in Task 4, once the live cross-check in Task 3 has confirmed the new columns are correct. Keeping them here means this step is a pure addition, independently safe to ship/preview.)

- [x] **Step 2: Render the 2 new cells in `renderCenterTable`**

Find:

```js
          '<td class="num">' + FMT.format(r.tickets_total || 0) + '</td>' +
          '<td class="num"><span class="badge badge-' + ticketBadge + '">' + FMT.format(r.open_tickets || 0) + '</span></td>' +
          '<td class="num" title="' + escapeHtml(r.last_seen || '') + '">' + escapeHtml(relTime(r.last_seen)) + '</td>' +
          '</tr>';
```

Replace with:

```js
          '<td class="num">' + FMT.format(r.tickets_total || 0) + '</td>' +
          '<td class="num"><span class="badge badge-' + ticketBadge + '">' + FMT.format(r.open_tickets || 0) + '</span></td>' +
          '<td class="num" title="' + escapeHtml(r.last_seen || '') + '">' + escapeHtml(relTime(r.last_seen)) + '</td>' +
          '<td class="num">' + (r.mtbf_hrs == null ? '—' : FMT.format(Math.round(r.mtbf_hrs / 24)) + 'd') + '</td>' +
          '<td class="num">' + FMT.format(r.failures || 0) + '</td>' +
          '</tr>';
```

(Same MTBF humanization — hours→days, `—` when null — as the old `renderCenterWatchlist`, `App.html:761`. Failures shown as a plain count, matching the old watchlist's Failures column, which used no badge.)

- [x] **Step 3: Update the `apiGetCenters` mock so the local preview has data for the new columns**

Find:

```js
    if (fn === 'apiGetCenters') {
      var crows = [];
      for (var c = 0; c < 15; c++) {
        var n = rnd(1, 14);
        var up = rnd(88, 100);
        crows.push({
          center_id: rnd(1000, 60000), center: 'Demo Center ' + rnd(1, 4000),
          hub: 'Demo Hub ' + rnd(1, 30),
          city: ['Bengaluru', 'Mumbai', 'Chennai', 'Hisar', 'Delhi'][rnd(0, 5)],
          state: ['Karnataka', 'Maharashtra', 'Tamil Nadu', 'Haryana', 'Delhi'][rnd(0, 5)],
          devices: n, jira_devices: rnd(0, n + 3), online: rnd(0, n + 1),
          lifecycle_years: (rnd(3, 90) / 10), downtime_days: (rnd(0, 200) / 10),
          uptime_pct: up, tickets_total: rnd(0, 40),
          last_seen: new Date(Date.now() - rnd(0, 96) * 36e5).toISOString().replace('T', ' ').slice(0, 19),
          open_tickets: rnd(0, 6)
        });
      }
      return Promise.resolve({ rows: crows, totalRows: 4719, page: (args && args.page) || 0, pageSize: 15 });
    }
```

Replace with:

```js
    if (fn === 'apiGetCenters') {
      var crows = [];
      for (var c = 0; c < 15; c++) {
        var n = rnd(1, 14);
        var up = rnd(88, 100);
        var fails = rnd(0, 6);
        crows.push({
          center_id: rnd(1000, 60000), center: 'Demo Center ' + rnd(1, 4000),
          hub: 'Demo Hub ' + rnd(1, 30),
          city: ['Bengaluru', 'Mumbai', 'Chennai', 'Hisar', 'Delhi'][rnd(0, 5)],
          state: ['Karnataka', 'Maharashtra', 'Tamil Nadu', 'Haryana', 'Delhi'][rnd(0, 5)],
          devices: n, jira_devices: rnd(0, n + 3), online: rnd(0, n + 1),
          lifecycle_years: (rnd(3, 90) / 10), downtime_days: (rnd(0, 200) / 10),
          uptime_pct: up, tickets_total: rnd(0, 40),
          last_seen: new Date(Date.now() - rnd(0, 96) * 36e5).toISOString().replace('T', ' ').slice(0, 19),
          open_tickets: rnd(0, 6),
          mtbf_hrs: fails >= 2 ? rnd(120, 4000) : null, failures: fails
        });
      }
      return Promise.resolve({ rows: crows, totalRows: 4719, page: (args && args.page) || 0, pageSize: 15 });
    }
```

- [x] **Step 4: Build the local preview and check it visually**

Run: `powershell -File scripts/build_preview.ps1` (leave it running, it serves on `http://localhost:8765/preview.html`)

Open `http://localhost:8765/preview.html` in a browser, go to the Centers/Customers tab, and confirm:
- The Center 360 table shows **MTBF (days)** and **Failures** as the last two columns, with plausible values (MTBF either `—` or an `Nd` value, Failures a small integer).
- Clicking those column headers sorts the table (ascending/descending toggle, same as every other column).
- The old "Reliability & Health" card above it still renders unchanged (not touched by this task).

**Result (2026-08-04): all 3 confirmed** — verified live via browser automation, not just visually eyeballed: MTBF/Failures cells render with correct `—`/`Nd` humanization; clicking the MTBF header fires a refetch and `aria-sort` correctly flips to `descending` on the live (re-rendered) header node; the Reliability & Health card is untouched (`#centerWatchlistTable` still present, title unchanged).

- [x] **Step 5: Commit**

```bash
git add src/client/App.html
git commit -m "Client: add MTBF/Failures columns to Center 360 (watchlist untouched for now)"
```

**Committed as `2993d82`** — isolated from unrelated concurrent edits in the same file via a hand-built partial patch (`git apply --cached`), since `App.html` had other in-progress work mixed in at the time.

---

## Task 3: Manual live cross-check (human checkpoint — do not skip)

**Files:** none (verification only, no code changes)

**Interfaces:** none.

This task exists to confirm, against real data, that the new Center 360 MTBF/Failures columns show the exact same numbers as the (still-present) Reliability & Health watchlist — proving the projection change in Task 1 didn't alter any values before the watchlist is deleted in Task 4.

- [ ] **Step 1: Push Tasks 1-2 to the Apps Script editor**

Run: `clasp push` (this syncs the editor only — it does NOT affect the live production URL; do not run `clasp deploy` in this task).

- [ ] **Step 2: Open the pushed web app's test/dev URL (or the live URL if that's the only one available) and go to Centers/Customers**

- [ ] **Step 3: Pick 5 centers visible in the "Reliability & Health" watchlist and note their Health/Uptime/MTBF/Failures values**

- [ ] **Step 4: Find those same 5 centers in the Center 360 table (use the search box) and confirm their Uptime, MTBF (days), and Failures values match exactly what the watchlist showed**

Expected: exact match for every center checked — this is a projection change, not a formula change, so any mismatch means Task 1 was implemented incorrectly and must be fixed before proceeding.

- [ ] **Step 5: Confirm sort still works correctly by clicking the MTBF and Failures column headers and checking a few rows land in the right order relative to their badge/number**

- [ ] **Step 6: Report back (to whoever is driving the plan) that the cross-check passed before Task 4 begins**

---

## Task 4: Client — remove Online/Last-heartbeat, delete the Reliability & Health card entirely

**Files:**
- Modify: `src/client/Index.html` (delete the "Reliability & Health" `<article>` card)
- Modify: `src/client/App.html:1035-1052` (`CENTER_COLUMNS`, remove 2 entries)
- Modify: `src/client/App.html:1093-1128` (`renderCenterTable`, remove 2 `<td>` cells)
- Modify: `src/client/App.html:108-126` (`apiGetCenters` mock — drop `online`/`last_seen` fields)
- Modify: `src/client/App.html:633-657` (`render()` — remove `renderCenterWatchlist` call site)
- Modify: `src/client/App.html:733-773` (delete `renderCenterWatchlist` function entirely)
- Modify: `src/client/App.html:2551-2558` (delete the `watchlistSort` listener)
- Modify: `src/client/App.html:16-40` (remove `state.centersWatchlistSort`)
- Modify: `src/client/App.html:2294-2423` (`METRIC_INFO`/`TITLE_METRIC` — remove `reliability` entry + its title mapping, update `center360` entry)
- Modify: `src/client/App.html` (main dashboard mock — delete the `assetHealth` mock array)
- Modify: `src/client/Styles.html:459` (delete `#centerWatchlistTable` rule)

**Interfaces:**
- Produces: `CENTER_COLUMNS` now has exactly the 14 final columns listed in Global Constraints; `#centerWatchlistTable`, `renderCenterWatchlist`, `state.centersWatchlistSort`, and `#watchlistSort` no longer exist anywhere in the codebase.

- [ ] **Step 1: Delete the "Reliability & Health" card from `Index.html`**

Find (the entire `<article>` block, verbatim):

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

Delete it entirely (including the trailing blank line before the next `<article class="card span-12">` for Center 360).

- [ ] **Step 2: Remove Online/Last-heartbeat from `CENTER_COLUMNS`**

Find:

```js
    { key: 'devices', label: 'Devices', sortable: true, num: true },
    { key: 'jira_devices', label: 'Jira devices', sortable: true, num: true },
    { key: 'online', label: 'Online', sortable: true, num: true },
    { key: 'lifecycle_years', label: 'Lifecycle', sortable: true, num: true },
    { key: 'downtime_days', label: 'Downtime', sortable: true, num: true },
    { key: 'uptime_pct', label: 'Uptime', sortable: true, num: true },
    { key: 'tickets_total', label: 'Tickets', sortable: true, num: true },
    { key: 'open_tickets', label: 'Open tickets', sortable: true, num: true },
    { key: 'last_seen', label: 'Last heartbeat', sortable: true, num: true },
    { key: 'mtbf_hrs', label: 'MTBF (days)', sortable: true, num: true },
    { key: 'failures', label: 'Failures', sortable: true, num: true }
  ];
```

Replace with:

```js
    { key: 'devices', label: 'Devices', sortable: true, num: true },
    { key: 'jira_devices', label: 'Jira devices', sortable: true, num: true },
    { key: 'lifecycle_years', label: 'Lifecycle', sortable: true, num: true },
    { key: 'downtime_days', label: 'Downtime', sortable: true, num: true },
    { key: 'uptime_pct', label: 'Uptime', sortable: true, num: true },
    { key: 'tickets_total', label: 'Tickets', sortable: true, num: true },
    { key: 'open_tickets', label: 'Open tickets', sortable: true, num: true },
    { key: 'mtbf_hrs', label: 'MTBF (days)', sortable: true, num: true },
    { key: 'failures', label: 'Failures', sortable: true, num: true }
  ];
```

- [ ] **Step 3: Remove the Online/Last-heartbeat cells from `renderCenterTable`**

Find:

```js
          '<td class="num">' + FMT.format(r.devices || 0) + '</td>' +
          '<td class="num">' + FMT.format(r.jira_devices || 0) + '</td>' +
          '<td class="num">' + FMT.format(r.online || 0) + '</td>' +
          '<td class="num">' + (r.lifecycle_years != null ? r.lifecycle_years + 'y' : '—') + '</td>' +
          '<td class="num">' + (r.downtime_days != null ? r.downtime_days + 'd' : '—') + '</td>' +
          '<td class="num"><span class="badge badge-' + upBadge + '">' + (r.uptime_pct != null ? r.uptime_pct + '%' : '—') + '</span></td>' +
          '<td class="num">' + FMT.format(r.tickets_total || 0) + '</td>' +
          '<td class="num"><span class="badge badge-' + ticketBadge + '">' + FMT.format(r.open_tickets || 0) + '</span></td>' +
          '<td class="num" title="' + escapeHtml(r.last_seen || '') + '">' + escapeHtml(relTime(r.last_seen)) + '</td>' +
          '<td class="num">' + (r.mtbf_hrs == null ? '—' : FMT.format(Math.round(r.mtbf_hrs / 24)) + 'd') + '</td>' +
          '<td class="num">' + FMT.format(r.failures || 0) + '</td>' +
          '</tr>';
```

Replace with:

```js
          '<td class="num">' + FMT.format(r.devices || 0) + '</td>' +
          '<td class="num">' + FMT.format(r.jira_devices || 0) + '</td>' +
          '<td class="num">' + (r.lifecycle_years != null ? r.lifecycle_years + 'y' : '—') + '</td>' +
          '<td class="num">' + (r.downtime_days != null ? r.downtime_days + 'd' : '—') + '</td>' +
          '<td class="num"><span class="badge badge-' + upBadge + '">' + (r.uptime_pct != null ? r.uptime_pct + '%' : '—') + '</span></td>' +
          '<td class="num">' + FMT.format(r.tickets_total || 0) + '</td>' +
          '<td class="num"><span class="badge badge-' + ticketBadge + '">' + FMT.format(r.open_tickets || 0) + '</span></td>' +
          '<td class="num">' + (r.mtbf_hrs == null ? '—' : FMT.format(Math.round(r.mtbf_hrs / 24)) + 'd') + '</td>' +
          '<td class="num">' + FMT.format(r.failures || 0) + '</td>' +
          '</tr>';
```

- [ ] **Step 4: Drop `online`/`last_seen` from the `apiGetCenters` mock**

Find:

```js
        crows.push({
          center_id: rnd(1000, 60000), center: 'Demo Center ' + rnd(1, 4000),
          hub: 'Demo Hub ' + rnd(1, 30),
          city: ['Bengaluru', 'Mumbai', 'Chennai', 'Hisar', 'Delhi'][rnd(0, 5)],
          state: ['Karnataka', 'Maharashtra', 'Tamil Nadu', 'Haryana', 'Delhi'][rnd(0, 5)],
          devices: n, jira_devices: rnd(0, n + 3), online: rnd(0, n + 1),
          lifecycle_years: (rnd(3, 90) / 10), downtime_days: (rnd(0, 200) / 10),
          uptime_pct: up, tickets_total: rnd(0, 40),
          last_seen: new Date(Date.now() - rnd(0, 96) * 36e5).toISOString().replace('T', ' ').slice(0, 19),
          open_tickets: rnd(0, 6),
          mtbf_hrs: fails >= 2 ? rnd(120, 4000) : null, failures: fails
        });
```

Replace with:

```js
        crows.push({
          center_id: rnd(1000, 60000), center: 'Demo Center ' + rnd(1, 4000),
          hub: 'Demo Hub ' + rnd(1, 30),
          city: ['Bengaluru', 'Mumbai', 'Chennai', 'Hisar', 'Delhi'][rnd(0, 5)],
          state: ['Karnataka', 'Maharashtra', 'Tamil Nadu', 'Haryana', 'Delhi'][rnd(0, 5)],
          devices: n, jira_devices: rnd(0, n + 3),
          lifecycle_years: (rnd(3, 90) / 10), downtime_days: (rnd(0, 200) / 10),
          uptime_pct: up, tickets_total: rnd(0, 40),
          open_tickets: rnd(0, 6),
          mtbf_hrs: fails >= 2 ? rnd(120, 4000) : null, failures: fails
        });
```

- [ ] **Step 5: Remove the `renderCenterWatchlist` call site from `render()`**

Find:

```js
    var assets = data.assets || [];
    Charts.assetStatus(assets.filter(function (r) { return r.dim === 'status'; }).slice(0, 8));
    Charts.assetTypes(assets.filter(function (r) { return r.dim === 'type'; }).slice(0, 8));
    renderCenterWatchlist(data.reliability || [], data.assetHealth || [], state.centersWatchlistSort);
    renderCohort(data.cohortReliability || []);
```

Replace with:

```js
    var assets = data.assets || [];
    Charts.assetStatus(assets.filter(function (r) { return r.dim === 'status'; }).slice(0, 8));
    Charts.assetTypes(assets.filter(function (r) { return r.dim === 'type'; }).slice(0, 8));
    renderCohort(data.cohortReliability || []);
```

- [ ] **Step 6: Delete the `renderCenterWatchlist` function entirely**

Find and delete this whole block (including its docblock comment):

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

- [ ] **Step 7: Delete the `watchlistSort` change listener**

Find and delete:

```js
    // Reliability/health watchlist sort toggle — re-renders from the already-
    // fetched dashboard payload, no refetch needed.
    $('watchlistSort').addEventListener('change', function (event) {
      state.centersWatchlistSort = event.target.value;
      if (state.lastDashboard) {
        renderCenterWatchlist(state.lastDashboard.reliability || [], state.lastDashboard.assetHealth || [], state.centersWatchlistSort);
      }
    });

```

- [ ] **Step 8: Remove `state.centersWatchlistSort`**

Find:

```js
    centers: { sortBy: 'devices', sortDir: 'desc', page: 0, pageSize: 15 },
    centersWatchlistSort: 'uptime_pct',
    centerRows: [], centerTotal: 0,
```

Replace with:

```js
    centers: { sortBy: 'devices', sortDir: 'desc', page: 0, pageSize: 15 },
    centerRows: [], centerTotal: 0,
```

- [ ] **Step 9: Delete the main-dashboard mock's `assetHealth` array**

Find:

```js
      assetHealth: Array.from({ length: 12 }, function (_, i) {
        var h = rnd(28, 78), up = rnd(20, 90);
        return { centerid: rnd(1000, 50000), center: 'Demo Center ' + rnd(1, 400), uptime_pct: up, mtbf_hrs: rnd(120, 4000), failures: rnd(1, 9), health_score: h };
      }),
```

Delete it entirely (this is in the default/fallback mock branch, the one feeding `apiGetDashboardCD`'s local-preview data — distinct from the `apiGetExecOverview` mock earlier in the file, which keeps its own separate `reliability` array untouched).

- [ ] **Step 10: Remove the `reliability` METRIC_INFO entry and its title mapping; update `center360`'s formula text**

Find:

```js
    reliability: { name: 'Reliability & health watchlist',
      formula: 'Centers ranked by Machine Uptime % (M-A1) or composite Health Score (M-A6), whichever the sort toggle selects — worst first either way.',
      source: 'The uptime engine (see M-A1/M-A6).' },
```

Delete it entirely.

Find:

```js
    center360: { name: 'Center 360', formula: 'One row per center: devices (cloud_devices + jira_data), online, lifecycle (today − deploymentdate), downtime (merged technical-ticket hours), uptime %, tickets (total + open) — joined in Apps Script.', source: 'center_details ⋈ cloud_devices ⋈ zoho_data ⋈ jira_data asset index (hash-joined).' },
```

Replace with:

```js
    center360: { name: 'Center 360', formula: 'One row per center: devices (cloud_devices + jira_data), lifecycle (today − deploymentdate), downtime (merged technical-ticket hours), uptime %, MTBF (uptime hours ÷ failures, days), failure count, tickets (total + open) — joined in Apps Script.', source: 'center_details ⋈ cloud_devices ⋈ zoho_data ⋈ jira_data asset index (hash-joined).' },
```

Find:

```js
    'centers needing attention': 'attention', 'reliability & health': 'reliability',
```

Replace with:

```js
    'centers needing attention': 'attention',
```

- [ ] **Step 11: Delete the dead `#centerWatchlistTable` CSS rule**

In `src/client/Styles.html`, find:

```css
#centerWatchlistTable { min-width: 0; } /* narrow cards: no forced overflow */
```

Delete this line entirely.

- [ ] **Step 12: Build the local preview and confirm**

Run: `powershell -File scripts/build_preview.ps1`

Open `http://localhost:8765/preview.html`, go to Centers/Customers, and confirm:
- The "Reliability & Health" card is completely gone, with no layout gap or leftover empty space.
- Center 360 now shows exactly 14 columns ending in MTBF (days)/Failures, with no Online/Last heartbeat columns.
- Open the browser console — no JS errors on page load or tab switch.
- Click a Center 360 row — the center-detail drawer still opens and still shows its own "Online 24h" stat (confirms Online data wasn't lost, only the table column).

- [ ] **Step 13: Run the unit suite**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 14: Commit**

```bash
git add src/client/App.html src/client/Index.html src/client/Styles.html
git commit -m "Client: delete Reliability & Health card, remove Online/Last-heartbeat from Center 360"
```

---

## Task 5: Client — sticky Center column

**Files:**
- Modify: `src/client/Styles.html` (add sticky-column rules near the existing `.data-table`/`.table-scroll` block, `Styles.html:456-476`)

**Interfaces:**
- Consumes: `#centerTable`'s existing markup (Task 4 left it structurally unchanged — same `<table class="data-table" id="centerTable">` inside `.table-scroll`).
- Produces: nothing consumed by later tasks — this is the final visual layer.

- [ ] **Step 1: Add the sticky-column CSS**

Find (the existing table CSS block, so the new rules land right after the last existing rule in it):

```css
.data-table td.num, .data-table th.num { text-align: right; font-variant-numeric: tabular-nums; }
.data-table td.num { font-family: var(--font-head); font-size: 13px; }
.data-table tbody tr { transition: background var(--dur-fast); }
.data-table tbody tr:hover { background: rgba(46, 155, 214, 0.05); }
.data-table tbody tr.is-clickable { cursor: pointer; }
.data-table tbody tr.is-clickable:hover { background: var(--primary-soft); }
```

Replace with:

```css
.data-table td.num, .data-table th.num { text-align: right; font-variant-numeric: tabular-nums; }
.data-table td.num { font-family: var(--font-head); font-size: 13px; }
.data-table tbody tr { transition: background var(--dur-fast); }
.data-table tbody tr:hover { background: rgba(46, 155, 214, 0.05); }
.data-table tbody tr.is-clickable { cursor: pointer; }
.data-table tbody tr.is-clickable:hover { background: var(--primary-soft); }

/* Center 360: pin the Center column while the rest of the row scrolls
   horizontally. Scoped to #centerTable only (not every .data-table). The
   sticky cell needs an opaque background so scrolled-past columns don't
   show through underneath it; the hover/click tint is re-applied as a
   background-image layer on top of that opaque color so it still reads as
   highlighted, not just the rest of the row. */
#centerTable td:first-child {
  position: sticky;
  left: 0;
  z-index: 1;
  background-color: var(--surface-solid);
  box-shadow: 2px 0 6px rgba(0, 0, 0, 0.15);
}
#centerTable th:first-child {
  left: 0;
  z-index: 2;
  box-shadow: 2px 0 6px rgba(0, 0, 0, 0.15);
}
#centerTable tbody tr:hover td:first-child {
  background-image: linear-gradient(rgba(46, 155, 214, 0.05), rgba(46, 155, 214, 0.05));
}
#centerTable tbody tr.is-clickable:hover td:first-child {
  background-image: linear-gradient(var(--primary-soft), var(--primary-soft));
}
```

(`#centerTable th:first-child` doesn't need `position: sticky` or `background` redeclared — it inherits `position: sticky; top: 0; background: var(--surface-solid)` from the existing `.data-table th` rule; this block only adds the horizontal-stick behavior on top.)

- [ ] **Step 2: Build the local preview and check both themes**

Run: `powershell -File scripts/build_preview.ps1`

Open `http://localhost:8765/preview.html`, go to Centers/Customers, narrow the browser window (or zoom in) until the Center 360 table needs to scroll horizontally, then:
- Scroll right and confirm the **Center** column stays visible/pinned while every other column scrolls underneath it, with no visual gap and no scrolled content bleeding through under the pinned cell.
- Hover a row and confirm the pinned cell picks up the same subtle highlight as the rest of the row (not left looking "flat"/unhighlighted).
- Toggle the theme switcher (light/dark) and repeat — confirm the pinned column's background matches the surrounding table in both themes (uses `var(--surface-solid)`, which is already theme-aware).
- Click a row and confirm the whole row (including the pinned cell) still opens the center-detail drawer.

- [ ] **Step 3: Commit**

```bash
git add src/client/Styles.html
git commit -m "Client: sticky Center column on the Center 360 table"
```

---

## Task 6: Final regression pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit suite one more time**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 2: Rebuild the local preview and walk the full testing checklist from the design spec**

Run: `powershell -File scripts/build_preview.ps1`, then in the browser on the Centers/Customers tab confirm, end to end:
1. Center 360 has exactly 14 columns (Center, ID, Hub, City, State, Devices, Jira devices, Lifecycle, Downtime, Uptime, Tickets, Open tickets, MTBF (days), Failures) — no Online, no Last heartbeat, no Health.
2. No Reliability & Health card anywhere on the page.
3. Pagination, search, and every column's sort toggle still work.
4. The sticky Center column behaves correctly while scrolling, in both themes.
5. No console errors anywhere on the page.

- [ ] **Step 3: Confirm the earlier live cross-check (Task 3) result is still valid**

Since Tasks 4-5 only changed columns/CSS (not the MTBF/Failures calculation itself), no new live-BQ check is needed — just note in the commit message that Task 3's cross-check covers the shipped formula.

- [ ] **Step 4: Final commit (if anything is still uncommitted)**

```bash
git status
```

If clean, this task needs no commit — Tasks 1, 2, 4, and 5 already committed everything. If anything is uncommitted, stage and commit it with a message describing what was missed.

**Do not `clasp push`/`clasp deploy` or `git push` as part of this task** — confirm with the user before either of those, per this project's established pattern (see Global Constraints).
