# Data Loading Spec — for the DE team

**Updated:** 2026-07-07 (v5.0 data model)

The dashboard reads **entirely from** `tricogde-dwh.abi_tables` (BigQuery; migrated 2026-07-22
from the `magnaquest-sand-box.abi_team_sip_devtest_poc` dev/test copy described below — see
`docs/superpowers/specs/2026-07-22-tricogde-dwh-migration-design.md`). No Google Sheets remain
as data sources (the last one, Jira devices, was replaced by `jira_data` 2026-07-30 — see
`docs/SOURCES.md`). The rest of this doc's gap analysis (written 2026-07-07, against the sandbox copy) has not
been re-verified against `tricogde-dwh` and may be stale — re-run `diagnostics()`/the column
comparison in `Diag.js` before treating any row below as still accurate. Reloading a table with
the **same schema + more rows/columns** is picked up automatically — no code change, no
redeploy. Row caps in the app support 50–80k per source.

| Table | Sandbox now | Production target | Gap / action |
|---|---|---|---|
| `center_details` | ~35.8k rows / 27,410 distinct centers (no F2P-exclusion — full universe), 70 cols | full centers dim | **reload WITH `DeviceID` + `MacSerialID`** (see below) — highest priority |
| `cloud_devices` | ~11,331 devices | ~49,137 device master | load full device master (currently the serial→center bridge) |
| `zoho_data` | ~84,545 tickets | (full) | **add the business-hours SLA-quality fields** (see below) |
| `device_metrics` | dup rows | (full) | reload if partial |
| `device_center_mapping` | ~56k | — | legacy; no longer a user-facing source |
| `jira_data` | ~49.9k rows / ~45.4k devices (changelog grain) | (full) | **THE live devices/fleet source** (since 2026-07-30, replacing a Google Sheet) — confirmed actively loaded, most recent row 2 days old at switch time |

## Priority asks (these unlock currently-blocked features)

### 1. `center_details` — add `DeviceID` + `MacSerialID` (unlocks exact device→center mapping)
The sandbox `center_details` has 70 columns but is **missing the derivation's `DeviceID` and
`MacSerialID`**. Today a device's center is bridged indirectly through `cloud_devices` (only
9,888 of 43,794 devices map). The app's `deviceCenterMap_()` is **pre-wired** to prefer
`center_details.MacSerialID` then `DeviceID` — the moment either column is present, exact
serial→center mapping activates with **no code change**.
> Keep `CenterID`, `Current_MRR`, `Device_Rental`, `Status` (`ACTIVE`/…), `Spoke_Center_Segment`,
> `deploymentdate`, `deactivationdate`, `latitude`, `longitude`, and center name/city/state/pin.

### 2. `zoho_data` — add SLA-quality fields (unlocks M-C2 CHI, M-S1 FCR, M-S3 FRT)
These TRD metrics are blocked purely because the sandbox `zoho_data` lacks the quality columns:
`Resolution Time (Business Hours)`, `First Response Time (Business Hours)`, `Number of Threads`,
`SLA Violation Type`. Load them and the FCR/FRT/CHI panels can be built.

### 3. Jira changelog (unlocks M-A4 Lifecycle Dwell)
Per-status transition timestamps (a changelog grain) are needed for true lifecycle-dwell timing.

## Required columns (do not drop or rename — the app queries these exact names)

### `center_details` — one row per center (SOLE center source)
`CenterID`, center name, `city`, `state`, `pin` (was bare `pin`, now `PinCode`),
`deploymentdate`, `deactivationdate`, `Status`, `Spoke_Center_Segment`, `Current_MRR`,
`Device_Rental`, **`DeviceID`/`MacSerialID`/`MachineType`** (arrived with the 2026-07-07
reload — the "requested" ask below is fulfilled; `deviceCenterMap_()` in `Numbers.js` uses
them as a fallback serial→center source).
> ⚠️ **`latitude`/`longitude` no longer exist** — the same 2026-07-07 reload that added the
> serial columns REMOVED the coordinate columns. The pin-geocode store (`server/Geo.js`,
> `runGeocodeBatch()`) is now the *only* coordinate source; centers without a stored geocode
> simply don't plot on the map.
> Grain = one row per `CenterID` (duplicate rows exist; center counts always use
> `COUNT(DISTINCT CenterID)`). No segment is excluded by the app — the old F2P-exclusion
> baseline was removed 2026-07-22; `Status` is now a user-facing global filter (defaults to
> `ACTIVE`, removable).

### `cloud_devices` — one row per device (device master + latest telemetry)
`DeviceID`, `CenterID`, `Centername`, `HubName`, `IMSI`, `CSQ`, `LastTimeStamp` (TIMESTAMP,
**IST wall-time, +330 min** as today), `BatteryLevel` (may be `"Charging"`), `UnsyncedData`,
`SpaceAvailable`, `FirmwareName`, `ServiceProvider`
> Grain = one row per `DeviceID`. Used for the fleet-status donut, device explorer, and serial→center bridge.

### `zoho_data` — one row per support ticket
`ticketNumber`, `CenterID`, `status`, `CreatedAt` (STRING `%d-%b-%Y %I:%M:%S %p`), `ClosedAt`,
`TicketActiveDays`, `IssueCategory`, `priority`, `Channel`, `hub_master_segment`, `HubName`, `TicketLink`
**+ (requested) the SLA-quality fields in Priority ask #2.**

### `device_metrics` — reliability (may repeat per device)
`deviceid`, `centerid`, `down_time_percentage`, `total_no_of_tickets`, `mean_time_between_failures_hrs`

## Google Sheets — none remain (both removed)
Both Sheets this app ever used depended on the Sheets API, which was disabled on GCP project
218180702013 — Jira devices (replaced by `jira_data` 2026-07-30, no functionality lost) and the
CS/Service tracker (removed 2026-07-29, no BigQuery equivalent existed, so those Support/CS
panels have no replacement). Re-enabling the Sheets API is no longer needed for this app.

## `jira_data` — required columns (do not drop or rename)
`issue_key`, `summary` (holds serial, e.g. `H4-F79C6E22`), `issuetype_name`, `status_name`,
`ticket_created`, `customerid` (ignored by the app, kept for shape parity). Changelog columns
(`author`, `field_changed`, `from_value`, `to_value`, `last_field_updated`) exist upstream (see
`sql/jira_data.lineage.sql`) but nothing in the app reads them yet — see the M-A4 ask above.

## After a reload — 3 steps
1. **Wait ≤10 min** (cache TTL) or run `clearDashboardCache()` in the editor.
2. **Run `runGeocodeBatch()`** (`server/Geo`) — new centers bring new pincodes; re-run until `pending: 0`.
3. **Run `diagnostics()`** — confirm the new counts (centers, map located, devices, SLA lines).
No redeploy is required unless the app code itself changes.

## What the app will NOT do
- It can't invent centers/devices absent from these tables/sheets.
- (2026-07-07 note, now superseded: at the time this doc was written, `tricogde-dwh` access
  was denied and everything had to land in the sandbox dataset. As of 2026-07-22 the app has
  its own isolated service account with `tricogde-dwh` access and reads from it directly.)
