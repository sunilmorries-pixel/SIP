# Data Loading Spec — for the DE team

**Updated:** 2026-07-07 (v5.0 data model)

The dashboard reads from `magnaquest-sand-box.abi_team_sip_devtest_poc` (BigQuery) plus two
Google Sheets. Today the BigQuery dataset is a **partial copy** of production with **6 tables**
(no `DIM_Centers`). Reloading a table with the **same schema + more rows/columns** is picked up
automatically — no code change, no redeploy. Row caps in the app support 50–80k per source.

| Table | Sandbox now | Production target | Gap / action |
|---|---|---|---|
| `center_details` | ~55.7k centers (28,299 after F2P-exclusion), 70 cols | full centers dim | **reload WITH `DeviceID` + `MacSerialID`** (see below) — highest priority |
| `cloud_devices` | ~11,331 devices | ~49,137 device master | load full device master (currently the serial→center bridge) |
| `zoho_data` | ~84,545 tickets | (full) | **add the business-hours SLA-quality fields** (see below) |
| `device_metrics` | dup rows | (full) | reload if partial |
| `device_center_mapping` | ~56k | — | legacy; no longer a user-facing source |
| `jira_data` | ~12.8k assets | — | legacy; devices now come from the Jira Sheet |

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
`CenterID`, center name, `city`, `state`, `pin`, `latitude`, `longitude`, `deploymentdate`,
`deactivationdate`, `Status`, `Spoke_Center_Segment`, `Current_MRR`, `Device_Rental`
**+ (requested) `DeviceID`, `MacSerialID`.**
> Grain = one row per `CenterID`. All center counts are `COUNT(DISTINCT CenterID)`; `F2P_CENTER`
> segment is excluded by the app. `latitude`/`longitude` drive the map (only ~3,428 populated today).

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

## Google Sheets (not BigQuery)
- **Jira devices export** (`CONFIG.JIRA_SHEET_ID`) — the devices/fleet source (~43,794 rows).
  Columns: `Key`, `Issue Type`, `Summary` (holds serial, e.g. `H4-F79C6E22`), `Status`, `Created`,
  `Customer ID`, `Customer Name`, `Tricog Device Type`. **Needs the Sheets API enabled** on GCP
  project 218180702013 + Viewer share; until then the app uses the offline `JiraDump.js` snapshot.
- **CS tracker** (`CONFIG.CS_SHEET_ID`) — field-service cases (TAT/machine/owner).

## After a reload — 3 steps
1. **Wait ≤10 min** (cache TTL) or run `clearDashboardCache()` in the editor.
2. **Run `runGeocodeBatch()`** (`server/Geo`) — new centers bring new pincodes; re-run until `pending: 0`.
3. **Run `diagnostics()`** — confirm the new counts (centers, map located, devices, SLA lines).
No redeploy is required unless the app code itself changes.

## What the app will NOT do
- It can't invent centers/devices absent from these tables/sheets.
- It can't reach production directly — this service account is scoped to the sandbox
  (verified: `tricogde-dwh` is Access Denied). Everything must land in `abi_team_sip_devtest_poc`.
