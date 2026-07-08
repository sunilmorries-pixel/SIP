# SIP Insights — Session Handoff / Start-Here Context

**Last updated:** 2026-07-07 · **Version:** 5.0 · **Status:** live, deployed via clasp.

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

**Seven views (tabs), Overview is the landing page:**
1. **Overview** — executive rollup: narrative hero band, avg-device-age ring, KPI strip, fleet donut, ticket-flow, "centers needing attention" + "reliability watchlist" tables, top-customer + geo charts.
2. **Asset** — fleet health KPIs (uptime/MTBF/health), fleet-status donut, firmware, Jira asset lifecycle/types, **asset health-score table (M-A6)**, **failure-analysis cohort (M-A3/M-A5)**, center-level reliability watchlist, device explorer (search/sort/paginate/CSV).
3. **Centers / Customers** — geo, deployment age, active-vs-ended, top hubs, **Center 360** table (clickable rows).
4. **Support / CS** — Zoho KPIs, ticket flow, **SLA-compliance suite (within% + Tech/Non-Tech + breach-by-type)**, backlog, categories, priority, channel, segment; CS-sheet TAT/machines/issue-types/owners.
5. **Map** — Leaflet map of all located centers, clustered, colored by open tickets, clickable legend ticket-bucket filter, click a marker → center drawer.
6. **Top Customers** — curated 27 "Top LE" hubs: KPIs, map, ranked bars, leaderboard (clickable → customer drawer).
7. **Numbers** — source-reconciliation / raw counts: KPI cards + **raw `center_details` table** (paginated, Devices + Mapped columns), devices from the Jira sheet.

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
- `Config.js` — env constants (project, dataset, cache TTL, IST offset=330, `JIRA_SHEET_ID`, `CS_SHEET_ID`, `SLA_DEFAULT_DAYS=5`, `TECH_FALLBACK_REGEX`, terminal Zoho statuses, Zoho date format).
- `Auth.js` — service-account OAuth for BigQuery (OAuth2 lib, key in Script Properties `SA_KEY`).
- `BigQuery.js` — parallel query runner (`runQueriesParallel`, `runQuery`), pagination, `withCache` + chunked-gzip `cachePutLarge/cacheGetLarge`, `shortHash`.
- `Queries.js` — base SQL statements (single-table reads); `buildDashboardQuerySpecs`, device/center explorer, `centerUptimeSql_` (M-A1/A2/A6, uses `techBoolSql_`), `cohortReliabilitySql_` (M-A3/A5), SLA specs. Lazy `nowIstSql_`/`fleetBucketSql_`.
- **`EditionCD.js`** — **the center_details data layer (SOLE edition).** `CD_SEG_FILTER` (F2P exclusion), `cdFilter_(activeOnly)`, `centerUptimeSqlCD_`, `buildDashboardQuerySpecsCD`, `getCenter360RowsCD_`, and all client endpoints `apiGet{Dashboard,Centers,MapData,TopCustomers,ExecOverview,CenterDetail}CD`. These are what the client actually calls.
- **`SlaCatalog.js`** — `SLA_CATALOG` (117 issue types → {days, tech}), `slaFor`, `techBoolSql_(col)`, `slaDaysCaseSql_(col)`, CD-safe emitters. Tech/Non-Tech classification + per-ticket SLA days.
- **`Numbers.js`** — `apiGetNumbers(options)` (center_details-only counts, F2P/active filtered), `jiraDeviceStats_()` (cached fleet totals from the Jira sheet/dump), `deviceCenterMap_()` (serial→center bridge), `apiGetCenterDetailsRaw(options)` (paginated raw center_details + per-center device count + Mapped flag).
- **`SheetSource.js`** — reads BOTH Google Sheets via the **Sheets REST API**: `readJiraSheet()` (devices; tolerant header map Key/Issue Type/Summary/Status/Created/Customer ID) and `readCsTracker()` (CS field cases).
- **`JiraDump.js`** — `JIRA_DUMP` offline snapshot (43,794 devices, pre-aggregated) used when the Sheets API is disabled; auto-swaps to live once enabled.
- `Join.js` — Apps Script-level hash-join utils (`indexRows`, `leftJoin`, `sortRows`).
- `Api.js` — legacy device_center_mapping endpoints (`apiGetDashboard` etc.) — **retained but unused** (client calls the CD versions); still hosts `getCenter360Rows_`, `getAssetIndex_`, `enrichCenterNames_`.
- `TopCustomers.js` — 27 "Top LE" hub constant + `apiGetTopCustomers` / `computeTopCustomers_` + `topCustomerTicketStats_`.
- `ExecOverview.js` — legacy exec endpoint (CD version in EditionCD.js is the live one).
- `Geo.js` — progressive geocoder (`runGeocodeBatch`, `geoStats`) → chunked Script-Properties store.
- `WebApp.js` — `doGet` + `include()` templating.
- `Setup.js` — `setupServiceAccountKey()` (one-time), `diagnostics()` (points at CD endpoints), `clearDashboardCache()`.

**Client (`src/client/*.html`):**
- `Index.html` — page shell (topbar, 7 tabs, all panels incl. **Numbers**, shared drawer, script includes). `#activeOnlyBtn` toggle. Uses `<?!= include('...') ?>`.
- `Styles.html` — Tricog design tokens (dark + light), component CSS, motion tokens + entrance/hover animations, `.info-dot`/`.info-pop` (metric tooltips), `.sla-*`, `.num-*`, `.batch-signal`, responsive breakpoints (320px+).
- `Charts.html` — all ECharts configs (`Charts` module), theme-aware palette, `fleetStatus`/`zohoTrend`/`geo`/`cohort`/`rankBar`, lazy render/flush.
- `MapView.html` — **factory** `MapView(containerId)` → Leaflet instance (CARTO tiles, markercluster).
- `App.html` — state (`activeOnly`, `cdRaw`, …), `ep(name)`→`name+'CD'`, data loading, `countUp/countUpText`, `setKpi/setKpiText`, `renderExec`, `renderDashboard`, `renderNumbers/renderCdRaw`, center drawer, global filters, theme, tabs, **metric-explanation tooltips** (`METRIC_INFO`, `KPI_METRIC`, `TITLE_METRIC`, `setupMetricInfo`), mocks.

**Docs / data:** `docs/SOURCES.md`, `docs/DATA_LOADING.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`,
`docs/AppsScript_BigQuery_Setup.md`, `sql/*.lineage.sql` (upstream DWH queries — reference only),
`design-system/sip-insights/MASTER.md`.

**Secrets:** `credentials/abi_team_sip_bq_access_service_account.json` (gitignored). Read-only BQ scope.
Private key lives only in Script Properties `SA_KEY`, never in source.

---

## 4. Data model facts (non-obvious — verified against live BQ)

- **Sandbox is a PARTIAL copy of production** with exactly **6 tables** (no `DIM_Centers`). `center_details` has **70 columns** — includes `Current_MRR`, `Device_Rental`, `Status`, `Spoke_Center_Segment` but **NO `DeviceID`/`MacSerialID`/serial column** (those live only in `tricogde-dwh`, which this SA **cannot read** — Access Denied). DE team will load fuller tables INTO the sandbox; row caps already 50–80k.
- **`center_details` is the SOLE center source** (the device_center_mapping "edition" was removed). Everywhere: centers = `COUNT(DISTINCT CenterID)` from center_details. **F2P_CENTER segment is excluded** via `CD_SEG_FILTER`. Counts: 55,682 → **28,299** (F2P-excluded) → **19,034** (+ `Status='ACTIVE'` when the toggle is on).
- **Devices come from the Jira Google Sheet** (`JIRA_SHEET_ID`), ~**43,794** rows (≈1 row/issue, deduped by Key). A device's center is resolved by its **serial** (parsed from Summary, regex `[A-Za-z0-9]{2}-[A-Za-z0-9]{6,}`) bridged via **`cloud_devices.DeviceID`→CenterID** (the only serial↔center source in the sandbox). Coverage: 9,888 of 43,794 map to a center (4,621 distinct centers). `deviceCenterMap_()` is **pre-wired** to prefer `center_details.MacSerialID`/`DeviceID` and auto-activate the moment DE loads those columns. Jira "Customer ID" column is **ignored** (per user).
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
2. **DE: load fuller data into the sandbox** — hand `docs/DATA_LOADING.md` to the DE team. Priority: reload `center_details` **with `DeviceID`/`MacSerialID`** (auto-activates exact serial→center mapping) + the Zoho quality fields (unlocks M-C2/M-S1/M-S3) + Jira changelog (M-A4). Dashboard auto-scales; then re-run `runGeocodeBatch()` + `clearDashboardCache()`.
3. **Geocoding** — Map plots only geocoded centers; only 3,428/28,299 center_details rows have lat/long. Run `runGeocodeBatch()` (server/Geo.js) until `geoStats().pending` = 0, then `clearDashboardCache()`.
4. **Verify the Jira browse domain** — drawer KEY links use `https://tricog.atlassian.net/browse/` (const `JIRA_BROWSE` in App.html) — confirm this is correct.
5. **Buildable-today enhancement (deferred by user 2026-07-07):** add per-account MRR to the Top-20 leaderboard (M-C3).
6. **Downtime display** — cumulative (>100% possible). Open offer: cap at 100% / relabel "Service burden %", or keep with tooltip.

---

## 7. How to verify after changes
- `diagnostics()` in the editor logs row counts for every panel + center360/map/top-customers/exec/SLA/devices lines. Use it as the health check.
- Local: rebuild + browser-preview (section 2), check console for errors, screenshot each tab + both themes.
- SQL: verify new queries on live BQ via the scratchpad node → `bq query < file.sql` pattern (section 2) before wiring.
- Deliver: hard-refresh editor tab → `clasp push --force` → New version deploy.

Project memory (full changelog v2.0→v5.0) is auto-loaded from
`~/.claude/projects/.../memory/demo-sip-project.md` (kept in sync with this file).
