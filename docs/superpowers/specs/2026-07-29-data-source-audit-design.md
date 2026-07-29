# Data-source audit — design spec

**Date:** 2026-07-29
**Status:** Phase 1 of a larger rework (KPIs and the Executive Summary narrative are Phase 2/3,
to be brainstormed separately once this foundation is confirmed).

## 1. Problem

The user is not satisfied with the current output and wants to rebuild toward "a fully
functional product." The UI/frontend is explicitly fine and stays as-is. The concrete starting
point requested: **verify exactly which BigQuery tables and Google Sheets the app is really
using, and confirm no old (pre-migration) connections are still lingering** — before touching
KPIs or the Executive Summary copy. This document is that verification, plus the one doc
inaccuracy it turned up.

## 2. Method

Every SQL statement and Sheet read in `src/server/*.js` was traced by hand: which function
builds it, which table/Sheet it reads, and — critically — whether the client can actually reach
it. The app carries two generations of the same endpoints (`Api.js`'s original
`device_center_mapping`-based builders, and `EditionCD.js`'s `center_details`-based
replacements); `App.html`'s `ep(name)` helper appends `CD` to every endpoint name the client
calls, so anything only reachable through the non-`CD` name is dead code, present in the repo but
never executed. No live BigQuery access was available from this machine (the local credential in
`credentials/` is scoped to the retired sandbox project only; the production key `SA_KEY_DWH`
lives solely in Apps Script Script Properties) — so this audit is a **code-level** trace, and
Section 7 below is the live confirmation step for the user to run.

## 3. Connection

`Config.js:15,18` — BigQuery project `tricogde-dwh`, dataset `tricogde-dwh.abi_tables`.
Authenticated via `Auth.js`'s `getBigQueryService()`, reading the service-account key from
Script Property `SA_KEY_DWH` (`Config.js:21`), through an OAuth2 service deliberately named
`BigQuery-DWH-SA` (`Auth.js:20-23`) — renamed from `BigQuery-SA` during the 2026-07-22 migration
specifically so no cached token for the old sandbox service account could be silently reused.

A repo-wide search for `magnaquest-sand-box` / `sandbox` / stale `SA_KEY` references in
`src/` found **no live connection to the old sandbox project anywhere** — every remaining
mention is a historical code comment (e.g. "measured on the sandbox," referring to where a
number was last verified, not a live read) or the migration note in `Config.js`'s own docblock.
The rollback path (revert `Config.js`/`Auth.js`) is still intact and untouched, as designed.

## 4. Table-by-table: what's live, what's dead

| Table | Live call sites (client actually reaches these) | Dead/legacy (present, never executed) |
|---|---|---|
| **`center_details`** | `EditionCD.js`: `centerBaseSpecCD_()` (center dimension for Center-360/Map/Top Customers/Overview); the `cd` override map inside `buildDashboardQuerySpecsCD` — `centerKpis`/`geo`/`hubs`/`deploymentAge`/`activeVsEnded`/`reliability`/`uptimeFleet`/`assetHealth` (the last three via `centerUptimeSqlCD_`); `apiGetCenterDetailCD`'s `info` override; `apiGetExecOverviewCD`'s `deviceAge` spec; `apiSearchHubsCD`. `Geo.js:88-96` `distinctLocations_()` (map geocoding source). | — |
| **`cloud_devices`** | `Queries.js`'s `kpis`/`fleetStatus`/`firmware` specs (device-grain, not center-table-dependent, so never CD-overridden); `buildDeviceExplorerQuery` (Asset page device table); `centerTelemetry` spec (Center-360 device counts, reused as-is in the CD path); `Numbers.js:25-28` `deviceCenterMap_()`'s primary serial→center lookup. | — |
| **`zoho_data`** | `Queries.js`'s `zohoKpis`/`slaKpis`/`slaByType`/`zohoTrend`/`zohoOpenByStatus`/`zohoCategories`/`zohoPriority`/`zohoSegment` (Support/CS view, reused as-is in the CD path since Zoho isn't center-table-dependent); `centerTickets` (Center-360 ticket counts); `tickets`/`openTickets`/`allTickets` (center drawer); `EditionCD.js`'s `centerUptimeSqlCD_` (device-failure downtime intervals); `TopCustomers.js:151` `topCustomerTicketStats_()` (shared by both live and legacy Top Customers). | — |
| **`device_center_mapping`** | *(nothing — see next column)* | `Queries.js`: `buildDashboardQuerySpecs`'s `centerKpis`/`geo`/`deploymentAge`/`activeVsEnded`, `centerUptimeSql_`'s birth CTE, `buildCenterSourceSpecs`'s `centerBase`, `buildCenterDetailSpecs`'s `info`. Reachable only through `Api.js`'s legacy `apiGetDashboard`/`getCenter360Rows_`/`apiGetCenterDetail` and `ExecOverview.js`'s `apiGetExecOverview` — none of which the client calls. Still exists as a BQ table; `Geo.js`'s current `distinctLocations_()` reads `center_details` exclusively (see above) — an older version of that function read `device_center_mapping` for geocoding, but that path is gone, not just superseded-and-still-there. |
| **`device_metrics`** | *(nothing)* | No code references it beyond a doc-comment in `Queries.js`. Table still exists in BigQuery; dropped as a Raw Data source in an earlier release (v5.5) and never used for analytics. |
| **`jira_data`** | *(nothing)* | Explicitly commented out (`Numbers.js:138`: `// var JIRA = T('jira_data'); // commented out per request`). Fully replaced app-wide by the Jira Google Sheet (below). |

**Google Sheets:**

| Sheet | ID (`Config.js`) | Live usage |
|---|---|---|
| Jira devices | `JIRA_SHEET_ID` (`Config.js:56`) | `SheetSource.js:127` `readJiraSheet()` → `Api.js:220` `getAssetIndex_()` (dedupe by Key, restricted to Connector + ECG Machine via `isTrackedJiraDeviceType_`) → feeds the devices/fleet count everywhere, the map/drawer asset lists, Asset-lifecycle + batch-cohort analysis. Falls back to the frozen `JiraDump.js` snapshot only while the Sheets API is disabled on the GCP project. |
| CS/Service tracker | `CS_SHEET_ID` (`Config.js:48`) | `SheetSource.js:55` `readCsTracker()` → Support/CS page TAT/machine/issue-type/owner panels, and the `cs` block on the Overview page. |

Both are read via the Sheets REST API (`fetchSheetValues_` in `SheetSource.js`), not
`SpreadsheetApp` — this needs only the least-privilege `spreadsheets.readonly` scope. Both have
10-minute negative caching on failure so a disabled/unshared sheet doesn't cost a fresh
guaranteed-403 round trip on every cold load.

## 5. A real finding: a Raw Data source-count error in the docs

`README.md` and `docs/SOURCES.md` both claimed Raw Data exposes "8 sources (6 BQ tables + 2
Sheets)." The actual registry (`RawData.js:16-28`, `rawSources_()`) lists exactly **5**:
`center_details`, `cloud_devices`, `zoho_data` + the 2 Sheets — matching Section 4 above exactly.
`device_metrics` and `jira_data` were deliberately dropped as *user-facing* raw sources in
earlier releases; the doc count was never corrected afterward. **Fixed as part of this spec**
(both files updated to say 5/3+2, with a note on why the other two BQ tables are excluded).

## 6. What this audit did NOT find

- No leftover pointer to the old `magnaquest-sand-box` project in any live code path.
- No table the app queries that isn't one of the 3 live BQ tables + 2 Sheets above.
- No mismatch between `Config.js`'s declared project/dataset and what every query actually
  targets (`T()` in `Queries.js` qualifies every table name from the same `CONFIG.BQ_DATASET`
  constant — there is no second, hardcoded dataset string anywhere in `src/`).

## 7. What this audit could NOT do (and the follow-up step)

This was a **code-level** trace, not a live one — no BigQuery credential for `tricogde-dwh` is
available on this machine. To close the loop with a live confirmation:

1. Open the Apps Script editor for the `sip` project.
2. Run `diagnostics()` (`Setup.js`).
3. Paste the log output back — it reports row counts for every panel plus the Jira
   device-type-filter stats and raw-source row counts, which should line up with the "live"
   column in Section 4 (and confirm none of it is silently reading 0 rows / erroring).

## 8. Out of scope (deliberately)

Per the user's stated priority, this spec stops at confirming *what's connected and how* — it
does not evaluate whether these are the *best possible* tables, does not propose new
connections (the already-known asks like Zoho SLA-quality fields or the Jira changelog stay
tracked in `docs/DATA_LOADING.md`, unchanged by this pass), and does not touch KPI formulas or
the Executive Summary copy. Those are explicitly the next phases, each to get its own
brainstorm → spec → plan cycle once this foundation is confirmed live.
