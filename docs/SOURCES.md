# Data Sources — SIP Insights

The dashboard is powered by BigQuery tables in
`magnaquest-sand-box.abi_team_sip_devtest_poc` plus **two Google Sheets** (a Jira
devices export and the CS/Service tracker). The `sql/*.lineage.sql` files are the
upstream DWH queries that *produced* the sandbox tables — read them for column semantics.

## BigQuery tables

| Table | Grain | Powers | Watch out |
|---|---|---|---|
| `center_details` | 1 row / center (~55.7k; **28,299** after F2P-exclusion) | **SOLE center source** — all center counts, uptime/MTBF/health, geo, deployment age | `COUNT(DISTINCT CenterID)` always; F2P via `CD_SEG_FILTER`; `Status='ACTIVE'` via the toggle; has `Current_MRR`/`Device_Rental`/`Status`/`Spoke_Center_Segment` but **NO serial/`DeviceID`/`MacSerialID`** |
| `cloud_devices` | 1 row / device (~11.3k) | Fleet-status donut, device explorer, **serial→center bridge** | `LastTimeStamp` is **IST wall-time** (+330 min at load — see `sql/cloud_devices.lineage.sql:9`); `BatteryLevel` can be `"Charging"`; epoch-1970 = never seen |
| `zoho_data` | 1 row / ticket (~84.5k) | Support view: ticket analytics, SLA compliance, uptime downtime proxy | `CreatedAt`/`ClosedAt` are **strings** `02-Jul-2026 04:59:16 PM` → `SAFE.PARSE_DATETIME('%d-%b-%Y %I:%M:%S %p', …)`; priority often empty; **lacks** business-hours SLA fields (blocks FCR/FRT/CHI) |
| `device_metrics` | device rows, duplicated | Reliability watchlist (downtime index) | Dedupe with `GROUP BY deviceid`; AVG/MAX only, never SUM |
| `device_center_mapping` | 1 row / device-center window (~56k) | **Retired as a user-facing source** — retained only for legacy Jira-asset serial linking | Was the old centers/geo source before the center_details migration (v4.4) |
| `jira_data` | issue × changelog rows | **Retired as the devices source** — devices now come from the Jira Google Sheet | Still used by the legacy asset-lifecycle spec; `COUNT(DISTINCT issue_key)` if queried |

## Google Sheet — Jira devices export

- **ID:** `1FgLl1HJIE8kpM8R1_mgAFaUyGcDTzieYQ0i5LdoZekc` (see `CONFIG.JIRA_SHEET_ID`)
- **Grain:** ~1 row / Jira issue (~**43,794** rows; deduped by `Key`)
- **Columns:** `Key`, `Issue Type`, `Summary`, `Status`, `Created`, `Updated`, `Assignee`,
  `Customer ID`, `Customer Name`, `Ticket ID`, `Tricog Device Type`
- **Powers:** the **fleet/devices count** everywhere (`jiraDeviceStats_()` in `Numbers.js`).
  A device's center is resolved by its **serial** parsed from `Summary`
  (regex `[A-Za-z0-9]{2}-[A-Za-z0-9]{6,}`) → bridged via `cloud_devices.DeviceID`→CenterID
  (9,888 of 43,794 map to a center). The Jira **`Customer ID` column is ignored** (per user).
- **Permanent restriction (2026-07-07, in progress):** `jiraDeviceStats_()` only counts rows
  whose `Issue Type` is `Connector` or `ECG Machine` (`CONFIG.JIRA_DEVICE_TYPES`, matched
  case-insensitively via `isTrackedJiraDeviceType_()`) — every other Issue Type is excluded
  from the fleet/devices count and from the Numbers-page devices section. This does **not**
  affect the separate legacy `getAssetIndex_()` path (Map asset markers, the center drawer's
  Jira-devices list, the Asset-lifecycle chart, or the batch-cohort analysis) — those still
  read the `jira_data` BQ table unfiltered.
- **Read via** `SheetSource.readJiraSheet()` (Sheets REST API, tolerant header mapping).
- **Offline fallback:** while the Sheets API is disabled, `JiraDump.js` supplies a static
  pre-aggregated snapshot; the live read auto-resumes once the API is enabled.

## Google Sheet — CS/Service tracker

- **ID:** `16Q2q9R6GPBOBYVmvImRTZRp8g1kW-G6fio26XDJiULo` (see `CONFIG.CS_SHEET_ID`)
- **Grain:** 1 row / resolved service case (manual field-team log)
- **Columns:** `T O M` (ticket owner), `Received Date`, `Closed Date`, `Zoho ID`,
  `Center ID`, `Center Name`, `Location`, `CS team Name & Service Team`,
  `Machine & DeviceType`, `Issue Type`, `Issue`, `Reason`, `Remarks`, `Comments`,
  `Year`, `Month`, `TAT (Days)`, `Source Tab`
- **Powers:** Support/CS view — TAT trend, issues by machine type, workload by owner
- **Access:** read via the **Sheets REST API v4** with the script's OAuth token
  (scope `spreadsheets.readonly`). Not `SpreadsheetApp` — that service demands the
  full read-write scope. The web app executes as the deploying user, who must
  have at least Viewer on the sheet.
- **Join key to BigQuery:** `Zoho ID` ↔ `zoho_data.ticketNumber` (strip the `#`),
  `Center ID` ↔ `CenterID`.

## Raw Data page (2026-07-07, in progress)

A dedicated "Raw Data" tab exposes all **8** sources this app has ever touched — the 6
BigQuery tables above plus both Google Sheets — each as its own paginated, full-column
table with a full-table CSV export. Unlike every other page, **no site filter applies
here** (no F2P exclusion, no Active-centers toggle, no hub/segment/search, and — unlike
the rest of the app — the Jira Issue-Type restriction above does *not* apply to this
page's raw Jira-sheet table either). It exists purely for source reconciliation and data
export, straight from each source. Server layer: `src/server/RawData.js`
(`rawSources_()`, `apiGetRawPage()`, `apiGetRawExport()`); the two Sheets are read via a
new generic `readRawSheetRows_()` in `SheetSource.js` (unlike `readJiraSheet()`/
`readCsTracker()`, it returns every column under the sheet's own header names).

## Machine Uptime % (TRD M-A1 — North-Star)

The canonical North-Star KPI. Canonical source is **ServiceWRK** (not yet in the sandbox),
so it's built here as a **ticket-based proxy** at **center grain** (`centerUptimeSql_` in
`Queries.js`):
- **Downtime** = UNION of *merged* device-failure ticket intervals `[CreatedAt, ClosedAt|NOW]`
  from `zoho_data` (overlaps counted once, not summed — unlike the old cumulative %). Failure
  tickets = `IssueCategory` matching `CONFIG.FAILURE_CATEGORY_REGEX` (machine/device/hardware/
  cable/network/sim/accessory/…), excluding billing/report/recharge/admin.
- **Birth** = earliest deployment per center — `center_details.deploymentdate` in the live
  CD edition (`centerUptimeSqlCD_` in `EditionCD.js`); the legacy `centerUptimeSql_` used
  `device_center_mapping.startdatetime`.
- **Uptime %** = `(life − downtime) / life × 100`, clamped 0–100.
- Fleet KPI = AVG(center uptime) + % of centers ≥ 99%. SLA bands: Critical 99.5 / Standard 95 / Dev 90.
- When ServiceWRK lands, swap the `tix` CTE source; the merged-interval engine stays.
- Powers: the "Fleet uptime" KPI (Overview + Asset) and the Reliability watchlist.
- **Live engine note:** the failure-ticket filter shown above (`FAILURE_CATEGORY_REGEX`) is
  the legacy `centerUptimeSql_`/`Queries.js` description; the live path
  (`centerUptimeSqlCD_` in `EditionCD.js`) uses `techBoolSql_()` (`SlaCatalog.js` — catalog
  `tech` flag first, `CONFIG.TECH_FALLBACK_REGEX` fallback). **2026-07-07 (in progress):**
  `TECH_FALLBACK_REGEX` gained the keyword `swap`, so any swap-worded ticket category not
  already an exact `SLA_CATALOG` match now counts as technical/downtime — same mechanism
  also feeds M-A2 MTBF, M-A6 health, the batch-cohort analysis, and the SLA Tech/Non-Tech split.

## Grain rules (from the SIP master build plan — apply everywhere)

1. Count entities with `COUNT(DISTINCT …)` — deviceid / ticketNumber / issue_key /
   centerid — never raw row counts on fanned sources.
2. Repeated device-level metrics (`device_metrics`) → `AVG`/`MAX`, never `SUM`.
3. Rates are ratio-of-sums (`SUM(x)/SUM(y)`), never an average of percentages.
4. All heartbeat-recency windows must compare against **IST now**
   (`TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 330 MINUTE)`), because
   `LastTimeStamp` was shifted to IST at load time.

## Where joins happen — Apps Script level

**Every BigQuery statement in `Queries.js` is a single-table read.** Multi-source
combining happens in Apps Script via `src/server/Join.js` (hash-join utilities):

1. Each side is **pre-aggregated in its own query** to one row per join key
   (e.g. `centerDevices`, `centerGeo`, `centerTickets` — each ≤ ~5k rows).
2. The sources are fetched in parallel, then `leftJoin()`-ed in JS
   (see `getCenter360Rows_` in `Api.js`); filtering/sorting/paging run over
   the joined rows, and the result is cached (chunked gzip, 10 min).
3. This is also the ONLY way to join **Google Sheet ⋈ BigQuery** data
   (the CS tracker is not in BigQuery), so one pattern covers everything.

Golden rule: **aggregate first, join small.** Never pull raw fact tables into
Apps Script — 84k Zoho rows don't fit the runtime; 5k aggregated center rows do.

> Note for the record: read access IS sufficient to run `JOIN`s inside a
> BigQuery `SELECT` (verified with this project's service account — a join is
> still a read; only `CREATE VIEW`/materialization needs write). App-level
> joins are this project's chosen pattern, not a permission requirement.

## Upstream lineage (reference only — runs in `tricogde-dwh`, not from this app)

- `sql/centers_details.lineage.sql` — the rich centers dimension (DIM_Centers +
  usage stats + billing + configs). **Now materialized in the sandbox as `center_details`
  and wired in as the sole center source (v4.4).** The sandbox copy has 70 columns but is
  missing the derivation's `DeviceID`/`MacSerialID` — `deviceCenterMap_()` is pre-wired to
  use them the moment DE reloads the table with those columns.
- `sql/cloud_devices.lineage.sql` — heartbeat JSON explode + IST shift.
- `sql/zoho_data.lineage.sql` — Zoho tickets enriched with center/hub/segment/manager fields.
- `sql/jira_data.lineage.sql` — jira issues LEFT JOIN changelog (the fan-out source).
