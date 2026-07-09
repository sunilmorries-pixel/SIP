# SIP Insights — Session Handoff / Start-Here Context

**Last updated:** 2026-07-08 · **Version:** 5.7 · **Status:** LIVE (deployment @31, same URL).

**v5.7 (2026-07-08, deployed @31):** dropped "Fleet" terminology app-wide; rebuilt the
Asset and Centers pages **page by page, metric by metric** with the user (each formula
confirmed before coding, each change verified live on BigQuery + in preview before commit).

- **Terminology**: "Fleet uptime/health" was always center-grain — relabeled **Center
  uptime / Center health** everywhere (KPI tiles, tooltips, card titles). "Total fleet" →
  **Total devices**. No new metric was introduced by the rename.
- **Tab order**: Overview moved after Top Customers (still lands first); Asset moved
  after Support/CS. Full order: Centers · Support · Asset · Map · Top Customers ·
  Overview · Numbers · Raw Data.
- **Asset page redefined** — Center uptime/health MOVED to Centers (see below); Asset's
  own executive summary is now **average device age**: today − Jira `Created`, Connector +
  ECG only. Live: avg **3.9 years**, **8,105 of 28,444 (28%)** past the 5-year expected
  life. New **"Device age" bar chart** (age bands, 5y+ bar highlighted red). Poor
  signal / Unsynced ECG KPI tiles removed (deferred, not required). **Device
  uptime/health is explicitly DEFERRED** — no per-device downtime source exists yet;
  do not build it without a fresh formula confirmation.
- **Centers page rebuilt**:
  - New executive summary: center uptime + **lifecycle** (today − `deploymentdate`) +
    **downtime** (merged technical-ticket hours, days) + % healthy. Live: **27,370**
    scored centers, avg lifecycle **3.74y**, avg downtime **7.37d**, avg uptime **99.68%**.
  - **Segment source = `hub_master_segment`** everywhere (topbar dropdown, Numbers page,
    Center-360, "Deployment status" donut → repurposed to a segment breakdown). Replaces
    `Spoke_Center_Segment`'s 3-spelling mess.
  - **Deployment-age fixed**: was active-only rows (18,460) vs total centers (27,410) —
    didn't add up. Now counts ALL centers with a `deploymentdate` (27,370, matches).
  - **Top hubs** re-ranked by **spoke count** (`COUNT DISTINCT CenterID`) — the old spec
    read `cloud_devices` online/offline, unrelated to a hub ranking.
  - **Center-360 table**: +5 sortable columns — Jira devices, Lifecycle, Downtime,
    Uptime, Tickets (total) — computed from the same `centerUptimeSqlCD_` "scored" engine
    as the North-Star KPI (verified live, no LIMIT so every scored center gets a row).
  - **Drawer**: ticket list now has an **Open/All toggle** (defaults to Open) — new
    `allTickets` query (up to 50, any status, newest first) + `ticketRowsHtml_` helper.
- Cache keys bumped: `jiradev_v4`, `ctr360cd_v4`, `ctrdetcd_v2_*`/`ctrdet_v2_*` (drawer).
  `clearDashboardCache()` synced.
- All new SQL verified live on BigQuery before commit; client verified in local preview
  (0 console errors across Asset, Centers, drawer toggle).

**v5.6 (2026-07-08, deployed @25):** Jira is now sourced **solely from the Google Sheet**;
the `jira_data` BQ table is **ignored app-wide** (still exists, just unused). Everything Jira
stays restricted to **Connector + ECG Machine** at page level. Changes:
- **`deviceCenterMap_` precedence flipped** (per user): match a device's Summary-serial to
  **cloud_devices.DeviceID first**, then **center_details DeviceID/MacSerialID** as fallback
  for devices not in cloud_devices. Old code early-returned on center_details alone and never
  unioned cloud_devices → serial coverage **11,330 → 27,373**, mapped devices **~9,888 →
  ~17,323** across **12,028** centers (validated vs live BQ + the real Sheet).
- **`getAssetIndex_` rewritten to read the Sheet** (`readJiraSheet`), Connector+ECG only,
  dedupe by Key. Field map per user: Summary = Device ID/serial, Issue Type = device type,
  Status = device status, age = today − Created, center via `deviceCenterMap_`. Same output
  shape (+`status`) → map overlay / drawer / top-customers / exec unchanged.
- **Asset status/type donut + batch cohort (M-A3/M-A5) now computed in JS** from the Sheet
  asset index (`assetsDonutFromIndex_`, `cohortFromIndex_`) + a Zoho-by-center failure
  aggregate. The two `jira_data` BQ specs are dropped from `buildDashboardQuerySpecsCD`.
  Cohort batch = YEAR of Created (approx — flat Sheet has no changelog; user accepted).
- **Raw Data page**: removed the "Jira Issues (legacy BQ)" pill → 5 sources
  (center_details, cloud_devices, zoho_data, jira_sheet, cs_tracker).
- Cache bumped: `assets_v3`, `dashcd_v4`/`mapcd_v4`/`topcustcd_v4`/`execcd_v4`.
- **Devices/Fleet count** is now confirmed = count of ALL Jira-Sheet devices filtered to
  Connector + ECG Machine (~28,444: 18,030 ECG + 10,414 Connector).

**v5.5 (2026-07-08, deployed @24):** removed **device_metrics** as a user-facing Raw
Data source (dropped from `rawSources_` in RawData.js, the source pill in Index.html,
and the preview mock in App.html). `device_metrics` had no other usage in the app — only
a doc-comment mention in Queries.js. The BQ table still exists. Raw Data page now exposes
6 sources: Center Details, Cloud Devices, Zoho Tickets, Jira Issues (legacy BQ), Jira
Devices (Sheet), CS Tracker (Sheet). Same treatment as device_center_mapping in v5.3.
NOTE: device_metrics was reloaded down to 191 rows on 2026-07-07 (was near-empty), which
is why it was pulled from the raw viewer.

**v5.4 (2026-07-08, deployed @23):** geocoding + F2P + segment-filter fixes.
- **Geocoding fixed + active-first**: `distinctLocations_()` (Geo.js) was still
  reading `device_center_mapping` — the WRONG source, since the map plots
  `center_details` centers. Now reads `center_details` (`PinCode`/`City`/`State`/
  `Spoke_Country`), and orders **ACTIVE centers first** (`MAX(IF(Status='ACTIVE',1,0))
  DESC`) so the geocode quota (resets ~every 14h) is spent on active centers before
  deactivated ones. 10,665 distinct locations, 7,879 serve an active center. Centers
  awaiting a geocode simply don't plot until located (`coordsForCD_` → null).
  ⚠️ **Run `runGeocodeBatch()` in the editor** (repeat each ~14h until
  `geoStats().pending = 0`), then `clearDashboardCache()`.
- **F2P filter simplified** to `IFNULL(F2P_Customer,0)=0` only (dropped the dead
  legacy `'F2P_CENTER'` segment guard — that value is 0 rows). All rows are
  `F2P_Customer=0` today → nothing excluded yet; activates when DE sets the flag.
- **Segment filter fixed + dynamic**: a center's `segment` now comes from its own
  `center_details.Spoke_Center_Segment` (was the Zoho-ticket segment, so centers
  with no tickets were wrongly dropped by any segment selection). Topbar dropdown
  is populated from a new `segmentOptions` spec (distinct real segment values).
  All centers kept as-is (no normalization / no blank-segment exclusion).
  **Superseded in v5.7**: segment source switched again, from `Spoke_Center_Segment`
  to `hub_master_segment` (cleaner values, no spelling variants) — see the v5.7 note.
- Cache keys bumped for the changed CD payload shape: `dashcd_v3` / `ctr360cd_v3` /
  `mapcd_v3` / `topcustcd_v3` / `execcd_v3` (clearDashboardCache synced).
- **Deliberately NOT changed**: `Age_In_Months` — verified it matches neither
  `deploymentdate` (0%) nor `AcquiredDate` (6%); semantics unclear, so the
  deployment-age chart stays on `deploymentdate`.
- **Duplicate-row precision** (corrects the v5.3 "exact duplicates" note): 35,804
  rows → 27,778 distinct full rows → 27,410 distinct centers. So 8,026 are exact
  full-row dupes AND 368 centers have genuinely-different multiple rows. `SELECT
  DISTINCT` + `COUNT(DISTINCT centerid)` handle both. Ask DE why any dupes exist.

**v5.3 hotfix (2026-07-08, deployed @22):** the DE team reloaded `center_details`
on 2026-07-07 (35,804 rows / 27,410 distinct centers, 114-col schema) which REMOVED
`pin`/`Country`/`latitude`/`longitude`/`HubStatus`/`HubSegment` and broke the
`centerBase` query → centers vanished from Centers/Map/Top Customers/Overview. Fixed:
- `centerBase` + drawer: `PinCode AS pin`, `Spoke_Country AS country`, `NULL` coords
  (pin-geocode store is now the ONLY coordinate source), `SELECT DISTINCT` (reload
  introduced exact duplicate rows).
- Numbers hubs: `Status` / `hub_master_segment` replace the removed hub columns.
- `CD_SEG_FILTER`: excludes on the new `F2P_Customer` flag ('F2P_CENTER' segment
  value no longer exists; flag is all-0 today so nothing is excluded).
- **Jira type filter extended to legacy BQ paths** (assets lifecycle spec, jiraAssets
  index → map overlay/drawer, cohort) via `jiraTypeFilterSql_()` — assets everywhere
  are now Connector + ECG Machine only (10,231 = 5,728 ECG + 4,503 Connector).
- **Raw Data page: device_center_mapping source removed** (7 sources now; the BQ
  table still exists and Geo.js still reads it internally for geocoding).
- Cache keys bumped: dashcd_v2 / ctr360cd_v2 / mapcd_v2 / topcustcd_v2 / execcd_v2 /
  numbers_v3 / assets_v2 / dash_v7.
- NEW: reload added `DeviceID`/`MacSerialID`/`MachineType` to center_details →
  `deviceCenterMap_()` auto-activates its center_details path (better serial→center
  coverage; `center_source: 'center_details'` in Numbers).

**v5.2 (2026-07-08, deployed @21):** Raw Data tab (all-source raw tables + CSV export) ·
permanent Jira device-type filter (Sheet path) · Overview "Fleet status (Jira)" donut ·
`swap` keyword in TECH_FALLBACK_REGEX · extended `diagnostics()`.

Read this first when resuming. It captures what the project is, where it's deployed,
how to change/deploy it, the non-obvious data facts, the current feature set, and the
open items. Deeper detail lives in `docs/` and `design-system/`. The full version-by-version
changelog lives in the project memory (`~/.claude/projects/.../memory/demo-sip-project.md`),
kept in sync with this file.

---

## 1. What this is

**SIP Insights** — a Tricog-branded, interactive analytics **web app built on Google
Apps Script + BigQuery** (HtmlService frontend, `google.script.run` bridge). It surfaces
insights from the `magnaquest-sand-box.abi_team_sip_devtest_poc` BigQuery dataset, a
**Jira devices Google Sheet**, and a **CS-tracker Google Sheet**, for Tricog's device
fleet / service operations.

**Eight views (tabs), Overview is the landing page:**
1. **Overview** — executive rollup: narrative hero band, avg-device-age ring, KPI strip, **Device status (Jira)** lifecycle donut, ticket-flow, "centers needing attention" + "reliability watchlist" tables, top-customer + geo charts. (Tab order note: Overview sits after Top Customers in the bar, but is still the landing page.)
2. **Asset** (device-focused; tab sits after Support/CS) — device-age executive summary + **"Device age" chart**, device-status donut, firmware, Jira asset lifecycle/types, **asset health-score table (M-A6)**, **failure-analysis cohort (M-A3/M-A5)**, device explorer (search/sort/paginate/CSV). Center uptime/health moved to Centers (below); Device uptime/health is a deferred redefinition — no per-device downtime source yet.
3. **Centers / Customers** (center-focused) — executive summary (center uptime/lifecycle/downtime/health), geo, deployment age (fixed to count all centers), segment breakdown (`hub_master_segment`), top hubs (by spoke count), **Center 360** table (+Jira devices/Lifecycle/Downtime/Uptime/Tickets columns, clickable rows → drawer with Open/All ticket toggle).
4. **Support / CS** — Zoho KPIs, ticket flow, **SLA-compliance suite (within% + Tech/Non-Tech + breach-by-type)**, backlog, categories, priority, channel, segment; CS-sheet TAT/machines/issue-types/owners.
5. **Map** — Leaflet map of all located centers, clustered, colored by open tickets, clickable legend ticket-bucket filter, click a marker → center drawer.
6. **Top Customers** — curated 27 "Top LE" hubs: KPIs, map, ranked bars, leaderboard (clickable → customer drawer).
7. **Numbers** — source-reconciliation / raw counts: KPI cards + **raw `center_details` table** (paginated, Devices + Mapped columns), devices from the Jira sheet.
8. **Raw Data** — every underlying data source (6 BQ tables + 2 Sheets) as a paginated, unfiltered table with pill-selector and full-table CSV export. **No site filters apply** (no F2P exclusion, no Active toggle, no hub/segment/search).

**Cross-cutting UI:** global top-bar search + hub + segment filters (apply to every page);
**"Active centers" toggle** (top bar → `Status='ACTIVE'` on all center_details queries);
light/dark theme toggle (persisted); one shared **center-detail drawer** opened by map markers,
Center-360 rows, reliability rows, exec attention rows, and customer rows — showing center KPIs,
open-ticket links to Zoho Desk, and a **Jira-devices table** (serial-mapped, KEY → Jira browse link);
**metric-explanation tooltips** — a ⓘ next to every KPI tile and card title opens a popover with the
metric's code, formula and data source (catalog `METRIC_INFO` + `setupMetricInfo()` in `App.html`);
flowing entrance/hover animations (motion tokens, reduced-motion guarded); auto-refresh every 5 min.

---

## 2. Where it's deployed + how to change it

- **Source Code Repository:** Hosted on GitHub at [sunilmorries-pixel/SIP](https://github.com/sunilmorries-pixel/SIP).
- **Apps Script project:** name **`sip`**, scriptId **`1AH4QA5XQf4bw0mQCOVL8KXXgBzfd_LXR8EhT5Bzt1KtRqf6ufUrwwOeG`**
  (the other project "demo-sip" is an old mock — ignore it). `.clasp.json` points here, `rootDir: src`.
- **clasp is installed and logged in.** Deploy flow:
  1. Edit files under `src/`.
  2. `cd` to repo, run **`clasp push --force`** (exit code 255 is a harmless clasp stderr quirk — check it lists the pushed files).
  3. In the Apps Script editor: **hard-refresh the tab first** (`Ctrl+Shift+R`), then **Deploy → Manage deployments → ✏️ edit → Version: New version → Deploy**. Web-app URL stays stable.
- ⚠️ **Stale-editor-tab gotcha:** an open editor tab caches its file list; if it saves after a push it can DELETE files it didn't know about. Always hard-refresh the editor tab after `clasp push`. (This bit us once — Geo.js + MapView.html vanished.)
- **Apps Script runs files ALPHABETICALLY** → never reference another file's globals in a top-level statement; wrap in lazy functions (e.g. `bqEndpoint_()`, `nowIstSql_()`).
- **HTML partials must keep their own `<script>…</script>` wrapper** — a missing closing tag makes the next include parse as JS (bit us once with MapView.html).

### Local preview (mock data, no Apps Script)
`powershell -File scripts/build_preview.ps1` → assembles `src/client/*` into one HTML with
mock data (mock kicks in when `google.script` is undefined) and serves on http://localhost:8765/preview.html.
The client mocks live in `App.html` mockCall(). Use a `?v=N` cache-buster when reloading a rebuilt
preview. Read client files with `-Encoding UTF8` in PS 5.1 or you get mojibake.

### Local BigQuery verification (SQL before wiring)
Scratchpad pattern: a node script `eval`s `SlaCatalog.js` + `Queries.js` + `EditionCD.js`, emits the
generated SQL to a `.sql` file, then `bq query --use_legacy_sql=false < file.sql` (stdin avoids the
PowerShell backtick-escaping collision). Auth via
`export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE=<repo>/credentials/abi_team_sip_bq_access_service_account.json`.

---

## 3. File map

**Server (`src/server/*.js` → deploy as `.gs`):**
- `Config.js` — env constants (project, dataset, cache TTL, IST offset=330, `JIRA_SHEET_ID`, `CS_SHEET_ID`, `SLA_DEFAULT_DAYS=5`, `TECH_FALLBACK_REGEX` (includes `swap`), `JIRA_DEVICE_TYPES`, terminal Zoho statuses, Zoho date format).
- `Auth.js` — service-account OAuth for BigQuery (OAuth2 lib, key in Script Properties `SA_KEY`).
- `BigQuery.js` — parallel query runner (`runQueriesParallel`, `runQuery`), pagination, `withCache` + chunked-gzip `cachePutLarge/cacheGetLarge`, `shortHash`.
- `Queries.js` — base SQL statements (single-table reads); `buildDashboardQuerySpecs`, device/center explorer, `centerUptimeSql_` (M-A1/A2/A6, uses `techBoolSql_`), `cohortReliabilitySql_` (M-A3/A5), SLA specs. Lazy `nowIstSql_`/`fleetBucketSql_`.
- **`EditionCD.js`** — **the center_details data layer (SOLE edition).** `CD_SEG_FILTER` (F2P exclusion), `cdFilter_(activeOnly)`, `centerUptimeSqlCD_` (also feeds the Center-360 lifecycle/downtime/uptime columns, no LIMIT), `buildDashboardQuerySpecsCD`, `getCenter360RowsCD_` (+`jira_devices` from `getAssetIndex_`), `assetsDonutFromIndex_`/`cohortFromIndex_` (Jira-sheet-based, replaced the old jira_data BQ specs), and all client endpoints `apiGet{Dashboard,Centers,MapData,TopCustomers,ExecOverview,CenterDetail}CD`. These are what the client actually calls.
- **`SlaCatalog.js`** — `SLA_CATALOG` (117 issue types → {days, tech}), `slaFor`, `techBoolSql_(col)`, `slaDaysCaseSql_(col)`, CD-safe emitters. Tech/Non-Tech classification + per-ticket SLA days.
- **`Numbers.js`** — `apiGetNumbers(options)` (center_details-only counts, F2P/active filtered, segment = `hub_master_segment`), `jiraDeviceStats_()` (cached device totals + `avg_age_days`/`age_bands`/`past_life` from the Jira sheet/dump, **filtered to Connector + ECG Machine only** via `isTrackedJiraDeviceType_()`), `deviceCenterMap_()` (serial→center bridge, **cloud_devices FIRST, center_details fallback**), `apiGetCenterDetailsRaw(options)` (paginated raw center_details + per-center device count + Mapped flag).
- **`SheetSource.js`** — reads BOTH Google Sheets via the **Sheets REST API**: `readJiraSheet()` (devices; tolerant header map Key/Issue Type/Summary/Status/Created/Customer ID), `readCsTracker()` (CS field cases), and `readRawSheetRows_(sheetId, sheetName)` (generic full-fidelity reader for Raw Data page).
- **`RawData.js`** — `rawSources_()` registry (6 BQ tables + 2 Sheets), `apiGetRawPage(options)` (paginated), `apiGetRawExport(options)` (full-table CSV, capped at 100k rows). No site filters.
- **`JiraDump.js`** — `JIRA_DUMP` offline snapshot (43,794 devices, pre-aggregated) used when the Sheets API is disabled; auto-swaps to live once enabled.
- `Join.js` — Apps Script-level hash-join utils (`indexRows`, `leftJoin`, `sortRows`).
- `Api.js` — legacy device_center_mapping endpoints (`apiGetDashboard` etc.) — **retained but unused** (client calls the CD versions); still hosts `getCenter360Rows_`, `getAssetIndex_`, `enrichCenterNames_`.
- `TopCustomers.js` — 27 "Top LE" hub constant + `apiGetTopCustomers` / `computeTopCustomers_` + `topCustomerTicketStats_`.
- `ExecOverview.js` — legacy exec endpoint (CD version in EditionCD.js is the live one).
- `Geo.js` — progressive geocoder (`runGeocodeBatch`, `geoStats`) → chunked Script-Properties store. Sources locations from `center_details` (PinCode/City/State/Spoke_Country), **ACTIVE centers first**.
- `WebApp.js` — `doGet` + `include()` templating.
- `Setup.js` — `setupServiceAccountKey()` (one-time), `diagnostics()` (points at CD endpoints + Jira device-type stats + raw-data row counts for all 8 sources), `clearDashboardCache()`.

**Client (`src/client/*.html`):**
- `Index.html` — page shell (topbar, **8 tabs** incl. **Raw Data**, all panels, shared drawer, script includes). `#activeOnlyBtn` toggle. Uses `<?!= include('...') ?>`.
- `Styles.html` — Tricog design tokens (dark + light), component CSS, motion tokens + entrance/hover animations, `.info-dot`/`.info-pop` (metric tooltips), `.sla-*`, `.num-*`, `.raw-*` (pill selector + actions), `.batch-signal`, responsive breakpoints (320px+).
- `Charts.html` — all ECharts configs (`Charts` module), theme-aware palette, `fleetStatus`/`zohoTrend`/`geo`/`cohort`/`rankBar`/**`jiraStatus`**, lazy render/flush.
- `MapView.html` — **factory** `MapView(containerId)` → Leaflet instance (CARTO tiles, markercluster).
- `App.html` — state (`activeOnly`, `cdRaw`, `rawData`, …), `ep(name)`→`name+'CD'`, data loading, `countUp/countUpText`, `setKpi/setKpiText`, `renderExec`, `renderDashboard`, `renderAssetSummary`/`renderCentersSummary` (per-page executive summaries, built metric-by-metric with the user), `renderNumbers/renderCdRaw`, **`loadRawTable/renderRawTable/exportRawFull`**, center drawer (`makeCenterDetail`, `ticketRowsHtml_` — Open/All ticket toggle), global filters, theme, tabs, **metric-explanation tooltips** (`METRIC_INFO`, `KPI_METRIC`, `TITLE_METRIC`, `setupMetricInfo`), mocks (incl. all 6 raw-data sources post device_metrics/jira_data-BQ removal).

**Docs / data:** `docs/SOURCES.md`, `docs/DATA_LOADING.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`,
`docs/AppsScript_BigQuery_Setup.md`, `sql/*.lineage.sql` (upstream DWH queries — reference only),
`design-system/sip-insights/MASTER.md`.

**Secrets:** `credentials/abi_team_sip_bq_access_service_account.json` (gitignored). Read-only BQ scope.
Private key lives only in Script Properties `SA_KEY`, never in source.

---

## 4. Data model facts (non-obvious — verified against live BQ)

- **Sandbox is a PARTIAL copy of production** with exactly **6 tables** (no `DIM_Centers`). **`center_details` was RELOADED 2026-07-07 12:28 UTC** with a **114-column schema**: now HAS `DeviceID`/`MacSerialID`/`MachineType` (serial→center mapping auto-activated) + `F2P_Customer` flag; REMOVED `pin`→`PinCode`, `Country`→`Spoke_Country`, `latitude`/`longitude` (gone — geocode store is the only coord source), `HubStatus`/`HubSegment` (gone). **Row duplication**: 35,804 rows → 27,778 distinct full rows → **27,410 distinct centers** (8,026 exact full-row dupes + 368 centers with genuinely-different rows) → queries dedupe (`SELECT DISTINCT` / `COUNT(DISTINCT …)`). ⚠️ `Age_In_Months` exists but is UNTRUSTWORTHY — matches neither `deploymentdate` (0%) nor `AcquiredDate` (6%); age charts use `deploymentdate`.
- **`center_details` is the SOLE center source** (the device_center_mapping "edition" was removed; dcm is also no longer a Raw Data source **and no longer used by Geo.js** — geocoding now reads `center_details`). Everywhere: centers = `COUNT(DISTINCT CenterID)`. **F2P exclusion** keys on `IFNULL(F2P_Customer,0)=0` only (old `'F2P_CENTER'` segment value = 0 rows; flag is all-0 today so nothing is excluded — activates when DE sets it). Counts: **27,410** centers (→ fewer with `Status='ACTIVE'` toggle). Segment (`Spoke_Center_Segment`) is free-text hospital/GP/diagnostic categories with 3+ spellings, 23,247 blank — kept as-is (no normalization); topbar segment filter + dropdown both read this field.
- **ALL Jira data comes from the Jira Google Sheet** (`JIRA_SHEET_ID`); the `jira_data` BQ table is **ignored app-wide** (v5.6). **Devices/fleet = count of Sheet rows filtered to Connector + ECG Machine** (~28,444: 18,030 ECG + 10,414 Connector), deduped by Key. Field map: Key = ticket id, Summary = Device ID/serial, Issue Type = device type, Status = device status, age = today − Created. A device's center is resolved by the **serial parsed from Summary** (regex `[A-Za-z0-9]{2}-[A-Za-z0-9]{6,}`) via `deviceCenterMap_()`: **cloud_devices.DeviceID first, then center_details DeviceID/MacSerialID fallback** (union — cloud wins conflicts). Coverage ~**17,323 mapped / 12,028 centers** (serial map = 27,373). Jira "Customer ID" column is **ignored** (per user). `getAssetIndex_` (Api.js) reads the Sheet; the status/type donut + cohort are computed in JS (EditionCD `assetsDonutFromIndex_`/`cohortFromIndex_`).
- `cloud_devices` — 1 row/device (~11.3k). `LastTimeStamp` is **IST wall-time** (+330 min at load) → recency SQL uses `nowIstSql_()`. `BatteryLevel` can be `"Charging"`. Epoch-1970 = never seen.
- `zoho_data` — 1 row/ticket (~84.5k). `CreatedAt`/`ClosedAt` are **strings** `"02-Jul-2026 04:59:16 PM"` → `SAFE.PARSE_DATETIME('%d-%b-%Y %I:%M:%S %p', …)`. Has `TicketLink` (drawer links), `priority` often empty. **Does NOT hold** the SLA-quality fields (Resolution/First-Response in Business Hours, thread counts) → blocks FCR/FRT/CHI.
- `device_metrics` — device rows, **duplicated** → dedupe `GROUP BY deviceid`. `down_time_percentage` is cumulative ticket-time ÷ deployment days (**can exceed 100%** — a service-burden index); `mean_time_between_failures_hrs` is actually in DAYS.
- `device_center_mapping` — still exists as a BQ table; **removed as a user-facing source** but retained internally only for Jira-asset serial linking in the legacy path.
- **CS tracker Google Sheet** `16Q2q9R6GPBOBYVmvImRTZRp8g1kW-G6fio26XDJiULo` — 1 row/field case; TAT/machine/issue/owner. Join `Zoho ID` ↔ `ticketNumber`.
- **Joins are done in Apps Script (Join.js)** on pre-aggregated single-table reads (also the only way to join Sheet ⋈ BigQuery).

---

## 5. Metric catalogue (PRD/TRD status)

TRD: `Downloads\SIP_TRD_v3_0_Metric_Definitions.docx` · PRD: `Documents\Projects\SIP\req\Sip – Service Insight Platform (prd).docx`

**Pillar 1 · Asset** — M-A1 Uptime (North-Star ≥99%) ✅ · M-A2 MTBF ✅ · M-A3 First-Time-Failure ✅ ·
M-A5 Batch Failure ✅ · M-A6 Health Score ✅ · **M-A4 Lifecycle Dwell ⛔** (needs Jira changelog).

**Pillar 2 · Customer** — M-C3 Top-20 ✅ (could gain per-account MRR) · **M-C2 Health Index ⛔** (needs Zoho
quality fields). *M-C1 MRR-at-Risk was built then removed at user request; center_details holds real MRR
(Current_MRR + Device_Rental) so it's re-buildable — see the v5.1 note in project memory.*

**Pillar 3 · Service** — M-S2 TAT ✅ · SLA-compliance suite ✅ (within% + Tech/Non-Tech + breach-by-type) ·
**M-S1 FCR ⛔ · M-S3 FRT ⛔** (need Zoho business-hours fields) · **M-S4 IVR ⛔** (blocked upstream).

Every metric on the dashboard has an in-UI ⓘ tooltip explaining its formula + source (see `METRIC_INFO`
in `App.html`). The blocked metrics auto-unlock when DE loads the missing Zoho quality fields + Jira changelog.

---

## 6. Open items / next steps

1. **Enable the Sheets API** on GCP project **218180702013**:
   https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=218180702013 → Enable → wait ~2 min. Until then **devices fall back to the offline `JiraDump.js` snapshot** and the CS-tracker panels show empty states (both non-blocking). Also share both sheets (Viewer) with the deploying user.
2. **DE reload: PARTIALLY DONE (2026-07-07)** — `center_details` arrived with `DeviceID`/`MacSerialID` ✅ (serial→center auto-activated). Still missing: **Zoho quality fields** (first-response & resolution in business hours, thread/reopen counts → unlock M-C2 Health Index, M-S1 FCR, M-S3 FRT) + **Jira changelog** (status-transition history → M-A4 Lifecycle Dwell). Ask DE to also **dedupe rows** (8,026 exact dupes + 368 centers with genuinely-different rows) and confirm whether `F2P_Customer` all-0 is correct or the flag just isn't populated yet.
3. **Geocoding — REQUIRED for the Map, run it now** — the reload removed lat/long, so pins come only from the pin-geocode store. `runGeocodeBatch()` (server/Geo.js) now sources `center_details` and does **ACTIVE centers first**; the quota resets ~every 14h, so re-run each day until `geoStats().pending` = 0, then `clearDashboardCache()`.
4. **Verify the Jira browse domain** — drawer KEY links use `https://tricog.atlassian.net/browse/` (const `JIRA_BROWSE` in App.html) — confirm this is correct.
5. **Buildable-today enhancement (deferred by user 2026-07-07):** add per-account MRR to the Top-20 leaderboard (M-C3).
6. **Downtime display** — cumulative (>100% possible). Open offer: cap at 100% / relabel "Service burden %", or keep with tooltip.
7. **Device uptime / Device health (deferred, 2026-07-08)** — Asset page currently has no device-grain uptime metric (moved Center uptime/health to Centers page instead). Needs a fresh formula from the user before building — do not guess; the sandbox has no per-device downtime source today (candidate proxy: cloud_devices heartbeat recency, but that's a different definition and would only cover the ~11k devices with telemetry).
8. **Asset KPI tiles still show the OLD tiles** (device-status donut, firmware, asset lifecycle/types, health-score table, cohort) — only the executive summary + a new "Device age" chart were added/changed on this page so far; the KPI strip itself (Poor signal / Unsynced ECG removal was applied, but no full KPI redesign) is not yet revisited metric-by-metric with the user.
9. **Remaining pages not yet worked**: Support/CS, Map, Top Customers, Numbers, Raw Data, Overview — the page-by-page/metric-by-metric pass (started 2026-07-08 with Asset then Centers) has not reached these yet.

---

## 7. How to verify after changes
- `diagnostics()` in the editor logs row counts for every panel + center360/map/top-customers/exec/SLA/devices lines + **Jira device-type filter stats** + **raw-data row counts for all 8 sources**. Use it as the health check.
- Local: rebuild + browser-preview (section 2), check console for errors, screenshot each tab + both themes.
- SQL: verify new queries on live BQ via the scratchpad node → `bq query < file.sql` pattern (section 2) before wiring.
- Deliver: hard-refresh editor tab → `clasp push --force` → New version deploy.

Project memory (full changelog v2.0→v5.0) is auto-loaded from
`~/.claude/projects/.../memory/demo-sip-project.md` (kept in sync with this file).
