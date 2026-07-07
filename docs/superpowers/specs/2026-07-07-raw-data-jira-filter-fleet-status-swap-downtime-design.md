# Design: Raw Data page, Jira device-type filter, Fleet Status chart, swap-downtime fix

**Date:** 2026-07-07 · **Status:** Approved by user, pending implementation plan.

Four related but independently-shippable changes to SIP Insights (v5.1 baseline, see
`HANDOFF.md` / project memory `demo-sip-project.md`). Each section below can be built and
verified on its own.

---

## A. Raw Data page (new 8th tab)

### Goal
A source-reconciliation / export page: one raw table per underlying data source, every
column, fully paginated, with a full-table CSV export — independent of every other filter
in the app.

### Sources (8 total, confirmed — "all sources including retired ones")
| Key | Label | Kind | Backing | Stable order key |
|---|---|---|---|---|
| `center_details` | Center Details | BQ | `center_details` | `CenterID` |
| `cloud_devices` | Cloud Devices | BQ | `cloud_devices` | `DeviceID` |
| `zoho_data` | Zoho Tickets | BQ | `zoho_data` | `ticketNumber` |
| `device_metrics` | Device Metrics | BQ | `device_metrics` | `deviceid` |
| `device_center_mapping` | Device-Center Mapping (legacy) | BQ | `device_center_mapping` | `deviceid, startdatetime` |
| `jira_data` | Jira Issues (legacy BQ) | BQ | `jira_data` | `issue_key` |
| `jira_sheet` | Jira Devices (Sheet) | Sheet | `CONFIG.JIRA_SHEET_ID` | sheet row order |
| `cs_tracker` | CS Tracker (Sheet) | Sheet | `CONFIG.CS_SHEET_ID` | sheet row order |

### Layout
- New tab `tab-rawdata` / panel `panel-rawdata`, positioned after Numbers, in `Index.html`.
- A pill/segmented **source selector** (8 buttons) — one active table + pager shown at a
  time (confirmed: not all 8 stacked).
- Table shows **every column** exactly as returned by the source (confirmed: 1:1 raw, no
  curation). Column headers derived from the query's/sheet's own field names.
- Pager UI matches the existing `cdRaw` pattern in `App.html` (prev/next, "X–Y of Z rows",
  page-size control 5–100 same as the existing raw center_details table).
- **No site-level filters apply on this page** — no F2P exclusion, no Active-centers toggle,
  no hub/segment/search (confirmed). Plain `LIMIT/OFFSET` (BQ) or array-slice (Sheets).

### Server: new `src/server/RawData.js`
- `RAW_SOURCES` registry: `{ key: { label, kind: 'bq'|'sheet', table|sheetId, orderBy,
  select } }`. For BQ sources `select` defaults to `SELECT *`; for legacy tables with wide
  schemas this is fine since caps bound the result size.
- `apiGetRawPage({ source, page, pageSize })`:
  - BQ: `SELECT *, COUNT(*) OVER() AS total_rows FROM <table> ORDER BY <orderBy> LIMIT
    <pageSize> OFFSET <page*pageSize>`, strip `total_rows` into a separate field like
    `apiGetCenterDetailsRaw` already does.
  - Sheet: read once via a new raw reader (see below), cache the full array
    (`cachePutLarge`, sheets don't change every request), then slice
    `[page*pageSize, page*pageSize+pageSize]` in JS.
  - Returns `{ rows, columns, totalRows, page, pageSize }`. `columns` is the ordered header
    list so the client can render a generic table without per-source markup.
- `apiGetRawExport({ source })`:
  - BQ: one `runQuery(sql, params, { maxRows: 100000 })` (no `ORDER BY`/`LIMIT/OFFSET`
    needed — full read). BigQuery.js's `collectRows_` already follows `pageToken`
    internally past the 1000-row per-page cap, so this is a single call, not a client-side
    loop. Cap at 100,000 rows; if a source is ever truncated, the response includes
    `truncated: true` + `totalRows` so the client can show "showing first 100,000 of N" —
    no silent truncation.
  - Sheet: return the already-fully-read array (Sheets are read whole in one call anyway;
    the CS tracker is ~small, the Jira sheet is ~43.8k rows — both comfortably under limits).
  - Returns `{ rows, columns, totalRows, truncated }`.
- **New generic raw sheet reader** in `SheetSource.js`: `readRawSheetRows_(sheetId)` —
  unlike `readJiraSheet()`/`readCsTracker()` (which tolerant-map a handful of named fields),
  this returns every column using the sheet's own header row as keys, for both the Jira
  sheet and CS tracker raw views. Cached (`cachePutLarge`, ~10 min) since it's a full-sheet
  read.

### Client: `App.html` / `Index.html` / `Styles.html`
- `state.rawData = { source: 'center_details', page: 0, pageSize: 25, total: 0, columns: [] }`.
- `loadRawTable()` / `renderRawTable(payload)` — generic (renders `<thead>` from
  `payload.columns`, `<tbody>` from `payload.rows`), reused across all 8 sources instead of
  one function per source.
- `exportRawFull()` — calls `apiGetRawExport`, builds CSV via the same Blob/`download`
  pattern already used by the device-explorer CSV export, shows a toast noting row count
  (and truncation, if any).
- Source pill click → `state.rawData = {source: key, page: 0, ...}` → `loadRawTable()`.
- New `.raw-*` CSS (pill row + reuse existing `.data-table`/`.table-scroll` styles).
- Mock data (`mockCall`) gets an entry per source for local preview.

---

## B. Website-level Jira Issue-Type filter (permanent restriction)

### Goal
Every Jira-sheet-derived device count in the app should only include devices whose Jira
`Issue Type` is **Connector** or **ECG Machine** — a permanent restriction, not a toggle
(confirmed).

### Implementation
- `Config.js`: add `JIRA_DEVICE_TYPES: ['connector', 'ecg machine']` (lowercase; matched
  case-insensitively/trimmed — easy to extend if more types are added later).
- `Numbers.js` → `jiraDeviceStats_()`: filter `jiraRows` by
  `JIRA_DEVICE_TYPES.indexOf(String(row.issuetype_name||'').trim().toLowerCase()) !== -1`
  **before** building the `byIssue` aggregation (total / with_center / jira_centers / in_cd
  / by_status). This is the single choke point — everything downstream inherits the filter:
  - Numbers page "Devices" section
  - Overview "Fleet devices" KPI, Asset "Total fleet" KPI (`apiGetDashboardCD` /
    `apiGetExecOverviewCD` both call `jiraDeviceStats_()` for `fleet`)
  - The new Jira Status donut (Section C), since it reads `fleet.by_status`
- Bump cache key `jiradev_v1` → `jiradev_v2` (aggregation output changes).
- `JIRA_DUMP` offline fallback (`JiraDump.js`, used only while the Sheets API is disabled)
  is a static pre-aggregated snapshot with no per-row issue-type field — **out of scope**:
  the filter only applies once the live Sheet path is active. Document this in the code
  comment where `JIRA_DUMP` is used as a fallback.

### Explicit scope boundary (confirmed with user)
This does **not** touch the separate legacy path (`getAssetIndex_()` in `Api.js`, backed by
the old `jira_data` BQ table + `device_center_mapping` serial join), which powers:
- Map page asset markers / per-center asset counts
- Center-detail drawer's "Jira devices" table
- Asset-page "Asset lifecycle" chart (`chartAssetStatus`)
- Batch-cohort failure analysis (M-A3/M-A5, `cohortReliabilitySql_`)

These keep showing all device/issue types unfiltered — different underlying source/schema,
and folding them in would be a materially larger change than requested.

Also does not affect the Raw Data page's raw Jira-sheet table (Section A — that page is
intentionally unfiltered).

### Known effect
"Fleet devices" / "Total fleet" totals will drop from ~43,794 (all Jira issue types) to
whatever the Connector + ECG Machine subset is. This is intended per the request, but is a
visible change to a headline number — flagged, confirmed acceptable.

---

## C. Fleet health chart → Jira Status donut

### Current state
`Index.html` Overview panel: card titled "Fleet health" (sub: "Devices by last heartbeat"),
chart id `execFleet`, rendered via `Charts.fleetStatus(d.fleetStatus, null, 'execFleet')` in
`App.html`'s `renderExec()`. This duplicates the Asset tab's "Fleet status" heartbeat donut
(`chartFleetStatus`) — same bucket data, different page.

The Asset tab's separate numeric **"Fleet health" KPI tile** (`kpiHealth`, M-A6 health
score, e.g. "95") is untouched by this change (confirmed).

### New behavior
- Replace the donut's data source with `jiraDeviceStats_().by_status` (already computed,
  now respecting the Section B filter) instead of the heartbeat `fleetStatus` buckets.
- `apiGetExecOverviewCD` already returns `fleet: jiraDeviceStats_()` in its payload (same
  shared helper as the KPI), so `d.fleet.by_status` is available in `renderExec()` with no
  new server work.
- New `Charts.jiraStatus(rows, id)` donut builder in `Charts.html` — unlike `fleetStatus`
  (hardcoded `FLEET_ORDER` + fixed heartbeat colors), this takes a dynamic category list
  (`[{k, n}]`, sorted desc by count as already produced by `jiraDeviceStats_`) and assigns
  colors from the existing categorical palette used elsewhere in `Charts.html`.
- `renderExec()`: swap `Charts.fleetStatus(d.fleetStatus, null, 'execFleet')` →
  `Charts.jiraStatus(d.fleet.by_status, 'execFleet')`.
- `Index.html`: update card copy — sub-text "Devices by last heartbeat" →
  "Jira devices by lifecycle status"; **title also changes** from "Fleet health" to
  something accurate, e.g. **"Fleet status (Jira)"** (confirmed acceptable — avoids a
  misleading title now that the chart isn't a health metric). Update the `aria-label` too.
- `METRIC_INFO` / `TITLE_METRIC` catalog (`App.html`): update/retarget the tooltip entry
  keyed by the old "fleet health" title to describe the new metric (Jira lifecycle status
  breakdown, source = Jira devices sheet, same filter as Section B) instead of the heartbeat
  description. The Asset-page numeric health-score KPI keeps its own separate, unmodified
  `METRIC_INFO` entry.
- Mock data (`mockCall`) updated to include a plausible `fleet.by_status` shape (e.g.
  Deployed/Store/Hardware/Decommissioned/Field/Exported) for local preview.

---

## D. Downtime — count "swap" tickets as technical

### Current state
Downtime (M-A1 uptime proxy), MTBF (M-A2), Health Score (M-A6 — the Asset KPI, untouched by
Section C), the batch-cohort analysis (M-A3/M-A5), and the SLA Tech/Non-Tech split are all
already restricted to **Tech-classified tickets only** via `techBoolSql_()`
(`SlaCatalog.js`), which is authoritative-catalog-first, regex-fallback-second
(`CONFIG.TECH_FALLBACK_REGEX`). Three exact swap categories ("Temporary swapping",
"International Demo Swapping", "Mac 600 To V-Cardia(Swapping)") are already tagged
`tech: true` in `SLA_CATALOG`. The gap: the **fallback regex** (used for any ticket category
that isn't an exact catalog match) does not contain "swap", so a differently-worded or new
swap-related category would be misclassified Non-Tech and excluded from downtime.

### Fix (confirmed, one line)
`Config.js` → add `swap` as a keyword to `TECH_FALLBACK_REGEX`:
```
TECH_FALLBACK_REGEX: '...|serial|ups|trilink|swap'
```
This single change flows into every consumer of `techBoolSql_()` / `slaFor()` automatically
— no other file needs to change:
- `EditionCD.js` → `centerUptimeSqlCD_` (live M-A1 uptime / M-A2 MTBF / M-A6 health)
- `Queries.js` → `cohortReliabilitySql_` (M-A3/M-A5 batch analysis)
- `Numbers.js` / `EditionCD.js` → ticket Tech/Non-Tech split, SLA compliance suite

### Post-deploy step
Run `clearDashboardCache()` (existing runbook, `docs/DEPLOYMENT.md` §Troubleshooting /
`HANDOFF.md` §7) so the corrected numbers show immediately instead of waiting out the 5-min
cache TTL.

### Out of scope
`CONFIG.FAILURE_CATEGORY_REGEX` is vestigial (superseded by `techBoolSql_` per the v3.9
changelog) and not referenced by any live SQL path — left untouched.

---

## Cross-cutting notes

- No new BigQuery tables/columns needed for any of the four changes — all data already
  exists in the sandbox or the Google Sheets.
- Deploy path unchanged: `clasp push --force` → hard-refresh Apps Script editor tab → New
  version deploy (per `HANDOFF.md` §2).
- Verification: extend `diagnostics()` (`Setup.js`) to log the Raw Data source row counts,
  the filtered Jira device total, and the new Fleet-Status-by-Jira breakdown, so a single
  run confirms all four changes post-deploy.
- Local preview (`scripts/build_preview.ps1`) must be exercised for the new tab + chart
  (mock-mode) before deploying, per this project's existing verification habit.

## Explicit non-goals

- No new toggle/UI control for the Jira Issue-Type filter (permanent per Section B).
- No change to the Asset-page numeric "Fleet health" (M-A6) KPI tile.
- No change to the legacy `getAssetIndex_()` / `jira_data`-BQ-backed views (Map markers,
  drawer Jira-devices list, Asset-lifecycle chart, batch-cohort analysis).
- No full-table export beyond a 100,000-row cap per source (flagged in the UI, not silent,
  if ever hit).
