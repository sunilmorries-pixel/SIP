# Data Sources — SIP Insights

The dashboard is powered **entirely by BigQuery tables** in `tricogde-dwh.abi_tables`. The
original six tables (migrated 2026-07-22 from the `magnaquest-sand-box.abi_team_sip_devtest_poc`
dev/test dataset — same names, byte-identical schema, live-verified) were joined by two more as
of 2026-08-14: `tom_tickets` (TOM page) and `servicewrk_Tickets` (Service page). **No Google
Sheets remain as data sources** — the CS/Service tracker Sheet was removed 2026-07-29, and the
Jira devices Sheet was removed 2026-07-30 (see below for both). The `sql/*.lineage.sql` files
describe the upstream DWH queries that produced the original six tables — read them for column
semantics (no equivalent lineage file exists yet for `tom_tickets`/`servicewrk_Tickets`).

## BigQuery tables

| Table | Grain | Powers | Watch out |
|---|---|---|---|
| `center_details` | dup rows per center (~35.8k rows; **27,410** distinct centers) | **SOLE center source** — all center counts, uptime/MTBF/health, geo, deployment age | `COUNT(DISTINCT CenterID)` always; no F2P baseline (`cdFilter_()` unconditionally returns `1=1`, removed 2026-07-22); `Status` is one of the global-filter dimensions (multi-select, defaults to `ACTIVE` as a removable chip), not a toggle; has `Current_MRR`/`Device_Rental`/`Status`/`Spoke_Center_Segment`, and (since the 2026-07-07 reload) `DeviceID`/`MacSerialID`/`MachineType` too — `deviceCenterMap_()` in `Numbers.js` uses them as a fallback serial→center source behind `cloud_devices`. **Country filter source switched from `Spoke_Country` to `hub_country` (v5.33, 2026-08-14)** — `Spoke_Country` had ~9% NULLs plus data-entry noise (typos, a city name, a continent name); `hub_country` is used everywhere the country dimension is derived (`centerAttrCond_`, `countryOptions`, `centerBaseSpecCD_`, the center-detail drawer, and `Geo.js`'s geocode-key source) |
| `cloud_devices` | 1 row / device (~11.3k) | Fleet-status donut, device explorer, **serial→center bridge**, and (v5.33) the **CDM (Communicator Device Management) page** | `LastTimeStamp` is **IST wall-time** (+330 min at load — see `sql/cloud_devices.lineage.sql:9`); `BatteryLevel` can be `"Charging"`; epoch-1970 = never seen |
| `zoho_data` | 1 row / ticket (~80k after dedup + unassigned-ticket exclusion, v5.22/v5.23) | Support view: ticket analytics, SLA compliance, uptime downtime proxy | `CreatedAt`/`ClosedAt` are native **DATETIME in production** (they were strings in the sandbox — `PARSE_DATETIME` on a DATETIME column crashed live until the v5.24 hotfix, 2026-08-13); priority often empty; **lacks** business-hours SLA fields (blocks FCR/FRT/CHI); the raw table has duplicate rows and unassigned (no-CenterID) tickets — deduped/excluded for every consumer except the Raw Data page, which intentionally shows the true raw count |
| `device_metrics` | device rows, duplicated | Reliability watchlist (downtime index) | Dedupe with `GROUP BY deviceid`; AVG/MAX only, never SUM |
| `device_center_mapping` | 1 row / device-center window (~56k) | **Retired as a user-facing source** — retained only for legacy Jira-asset serial linking | Was the old centers/geo source before the center_details migration (v4.4) |
| `jira_data` | issue × changelog rows (~49.9k rows; ~45.4k distinct `issue_key`) | **THE devices/fleet source** (`readJiraData_()` in `Numbers.js`, since 2026-07-30) — devices/fleet count, asset lifecycle, cohort/FTF analysis, map/drawer asset lists | `GROUP BY issue_key` + `ANY_VALUE`/`MIN` — issue-level fields (`summary`/`status_name`/`issuetype_name`/`ticket_created`/`customerid`) come from the issue side of the upstream LEFT JOIN and are constant per `issue_key`, so no "latest changelog row" logic is needed. Device-type filter (`CONFIG.JIRA_NON_DEVICE_TYPES`) excludes only Task/Epic/Test — every other Issue Type counts as a device |
| `tom_tickets` | 1 row / issue (1,325 rows, 2025-12-30 → 2026-08-12) | **TOM page** (`TomTickets.js`, v5.30) — CS-owned issue/escalation tracker | Loaded from monthly spreadsheet tabs (`source_tab`, e.g. "2026 \| June 2026"). `remarks` is the OUTCOME column despite its name (Issue Resolved/Auto Resolved/Not resolved/etc.) — **this framing is inferred from the data, not confirmed by the CS team** (asked twice, no answer as of 2026-08-14). `t_o_m` is a single constant value ("Saidha") across all rows — unusable, deliberately not surfaced. `comments` is 98.3% null — can't carry the page even though it hints at machine-swap/HQ-dispatch activity. Filter coverage is **Centre + date range only** — no state/city/segment/hub columns exist on this table |
| `servicewrk_Tickets` | 1 row / ticket (36,403 rows, `ticket_id` unique — no dedupe needed, unlike `zoho_data`) | **Service page** (`ServiceWrk.js`, v5.29) — field-service ticket analytics | **Deliberately NOT the Machine Uptime (M-A1) source**, despite earlier docs/Config.js comments anticipating that swap once this table landed: `created_on`/`closed_date` are **date-only** (886 distinct values across ~947 days — no same-day downtime resolution), only 870/36,403 rows are `ticket_type='BREAKDOWN'`, and coverage starts 2024-01-08 while center `life` reaches years further back. See `docs/superpowers/specs/2026-08-13-service-tom-pages-design.md` §4.1. **Do not "fix" this** — the uptime engine stays on the `zoho_data` proxy. Filter coverage is the table's own state/city/customer_category columns, not the global center dimensions. The `servicewrk_Tickets.customer_id` → `center_details.CenterID` join has **not yet been verified** (see `ProfileNewSources.js`/`profileJoinKeys()` — open item) |

## jira_data — the devices/fleet source (switched from a Google Sheet, 2026-07-30)

- **Grain:** issue × changelog rows (~49.9k rows; ~45.4k distinct `issue_key`) — the upstream
  ETL LEFT JOINs a Jira issues table against a changelog table (see
  `sql/jira_data.lineage.sql`), so an issue with N field-change history entries gets N rows.
  Issue-level fields (`summary`, `status_name`, `issuetype_name`, `ticket_created`,
  `customerid`) all come from the issue side of that join and are constant across every row
  for a given `issue_key` — `readJiraData_()` (`Numbers.js`) collapses this correctly with a
  plain `GROUP BY issue_key` + `ANY_VALUE`/`MIN(ticket_created)`, no "pick the latest
  changelog row" logic needed.
- **Powers:** the **fleet/devices count** everywhere (`jiraDeviceStats_()` in `Numbers.js`),
  the Map/drawer asset lists and Asset-lifecycle/cohort analysis (`getAssetIndex_()` in
  `Api.js`). A device's center is resolved by its **serial** parsed from `summary`
  (regex `[A-Za-z0-9]{2}-[A-Za-z0-9]{6,}`) → bridged via `deviceCenterMap_()`
  (`cloud_devices.DeviceID` first, `center_details.DeviceID`/`MacSerialID` fallback). The Jira
  **`customerid` column is ignored** (per user).
- **Device-type filter (widened 2026-07-30):** `jiraDeviceStats_()` excludes rows whose Issue
  Type is `Task`, `Epic`, or `Test` (`CONFIG.JIRA_NON_DEVICE_TYPES`, matched case-insensitively
  via `isTrackedJiraDeviceType_()`) — every other Issue Type counts as a device (ECG Machine,
  Connector, SIM Card, UPS, Printer, BP Machine, Tab, Mobile, IV Trolley, Laptop, WiFi Dongle,
  TriCare Assets, etc.). `getAssetIndex_()` applies the same filter. This replaced an earlier
  restriction to Connector + ECG Machine only (v5.2), which was found to be excluding 12 other
  real device categories once the full `jira_data` issuetype_name breakdown was checked.
- **Why the switch:** the Jira devices Google Sheet depended on the Sheets API, which was
  disabled on the GCP project — the app was silently falling back to a frozen `JiraDump.js`
  snapshot (~3 weeks stale) for the devices count, and getting nothing at all for the asset
  index (no fallback existed there, so those panels were rendering empty). `jira_data` was
  confirmed live and actively loaded (most recent row 2 days old at the time of the switch) —
  fresher than the Sheet ever was for most users, with no functionality lost. `SheetSource.js`
  and `JiraDump.js` were deleted entirely; the `spreadsheets.readonly` OAuth scope was removed.

## CS/Service tracker Sheet (REMOVED 2026-07-29)

This Sheet (a manual field-team log — TAT/machine/issue-type/owner cases) previously powered
Support/CS's TAT trend, machines-in-the-field, field-issue-types, and case-owners panels, plus
Overview's field-TAT KPI. It was removed as a data source: the Sheets API was disabled on the
GCP project, so it was already failing in production, and — unlike the Jira devices Sheet
(which had `jira_data` to fall back to, see above) — there was no BigQuery table for this one.
Those panels have no replacement; they're gone from the UI. `CONFIG.CS_SHEET_ID`,
`readCsTracker()`, and the `cs_tracker` Raw Data source were all deleted.

## Raw Data page

A dedicated "Raw Data" tab exposes **4** live BigQuery sources (`rawSources_()` in
`RawData.js`) — `center_details`, `cloud_devices`, `zoho_data`, `jira_data` — each as its own
paginated, full-column table with a full-table CSV export. `device_metrics` and
`device_center_mapping` are deliberately excluded as user-facing raw sources (the BQ tables
still exist; nothing else in the app queries `device_metrics` at all, and
`device_center_mapping` is only read internally by `Geo.js`). Unlike every other page, **no
site filter applies here** (no global Segment/Status/State/Hub/date-range filter, no search,
and — unlike the rest of the app — the Jira Issue-Type restriction above does *not* apply to
this page's raw `jira_data` table either, so raw asset types outside Connector/ECG Machine are
visible here). It exists purely for source reconciliation and full-table export, straight from
each source, unaggregated (so the raw `jira_data` table here shows its true changelog grain —
multiple rows per device — unlike every other consumer, which collapses it to one row per
device). Server layer: `src/server/RawData.js` (`rawSources_()`, `apiGetRawPage()`,
`apiGetRawExport()`).

## Machine Uptime % (TRD M-A1 — North-Star)

The canonical North-Star KPI. `servicewrk_Tickets` (ServiceWRK) landed 2026-08-14 (v5.29) —
**this section previously said "swap the `tix` CTE source when ServiceWRK lands"; that decision
was reversed once the table was actually profiled.** It's built here as a **ticket-based proxy**
at **center grain** (`centerUptimeSql_` in `Queries.js`), sourced from `zoho_data`, **and stays
that way**:
- **Downtime** = UNION of *merged* device-failure ticket intervals `[CreatedAt, ClosedAt|NOW]`
  from `zoho_data` (overlaps counted once, not summed — unlike the old cumulative %). Failure
  tickets = `IssueCategory` matching `CONFIG.FAILURE_CATEGORY_REGEX` (machine/device/hardware/
  cable/network/sim/accessory/…), excluding billing/report/recharge/admin.
- **Birth** = earliest deployment per center — `center_details.deploymentdate` in the live
  CD edition (`centerUptimeSqlCD_` in `EditionCD.js`); the legacy `centerUptimeSql_` used
  `device_center_mapping.startdatetime`.
- **Uptime %** = `(life − downtime) / life × 100`, clamped 0–100.
- Fleet KPI = AVG(center uptime) + % of centers ≥ 99%. SLA bands: Critical 99.5 / Standard 95 / Dev 90.
- **Why ServiceWRK was NOT swapped in, despite this doc previously saying it would be:**
  `created_on`/`closed_date` on `servicewrk_Tickets` are date-only (886 distinct values across
  ~947 days — no same-day downtime resolution), only 870 of 36,403 rows are
  `ticket_type='BREAKDOWN'`, and its coverage only starts 2024-01-08 while center `life` reaches
  years further back. The `customer_id` → `CenterID` join is also still unverified. See
  `src/server/ServiceWrk.js`'s docblock and `docs/superpowers/specs/2026-08-13-service-tom-pages-design.md`
  §4.1. **Do not "fix" this without re-reading that reasoning first** — it was a deliberate,
  profiled decision, not an oversight.
- Powers: the "Fleet uptime" KPI (Overview + Asset) and the Reliability watchlist.
- **Live engine note:** the failure-ticket filter shown above (`FAILURE_CATEGORY_REGEX`) is
  the legacy `centerUptimeSql_`/`Queries.js` description; the live path
  (`centerUptimeSqlCD_` in `EditionCD.js`) uses `techBoolSql_()` (`SlaCatalog.js` — catalog
  `tech` flag first, `CONFIG.TECH_FALLBACK_REGEX` fallback). **v5.2:**
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
   (see `getCenter360RowsCD_` in `EditionCD.js` — the live path; `Api.js`'s
   `getCenter360Rows_` is the retired legacy equivalent); filtering/sorting/paging
   run over the joined rows, and the result is cached (chunked gzip, 30 min).
3. This is also how a Jira device's center gets resolved — `jira_data`'s `summary` column has
   no shared key with `cloud_devices`/`center_details`, only a serial that must be regex-parsed
   and matched in JS (`deviceCenterMap_`, `Numbers.js`) — a case SQL alone can't express.

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
