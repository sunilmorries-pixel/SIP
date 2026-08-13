# Service + TOM Pages — Design

Date: 2026-08-13
Status: approved (design); implementation plan not yet written
Sources: `tricogde-dwh.abi_tables.servicewrk_Tickets`, `tricogde-dwh.abi_tables.tom_tickets`

## 1. Problem

The Service and TOM tabs have shipped as placeholders since the nav was built. Both render a
single "Data source not yet connected" empty-state card (`Index.html` §VIEW 4, §VIEW 5), and
Service's four KPI tiles are hard-set to the literal string `"data source pending"`
(`App.html` `renderKpiShells`). Two BigQuery tables have now landed in the dataset the app
already queries, one per page. This design turns both pages into real pages.

## 2. Design summary (one sentence)

Build the Service page as a **field-service operations** view over `servicewrk_Tickets` and the
TOM page as a **CS issue tracker** over `tom_tickets`, both filtered from each table's own
geography/segment columns rather than from a center join, and leave the M-A1 uptime engine
untouched.

## 3. Verified facts (live-probed via `profileNewSources`, not assumed)

### 3.1 servicewrk_Tickets — 36,403 rows, 49 columns

| Fact | Value | Consequence |
|---|---|---|
| Grain | `ticket_id` ≈36,583 approx-distinct vs 36,403 rows | One row per ticket. **No dedupe CTE** — unlike `zoho_data`, which needs `zohoDedupSql_` |
| Status | Closed 36,198 / Open 205 | Backlog KPI is small by nature; the page is mostly a history view |
| Window | `created_on` 2024-01-08 → 2026-08-12 | ~2.6 years |
| Timestamp grain | `created_on` has 886 distinct values over ~947 days; all min/max at `00:00:00+00` | **Date-only.** No time-of-day |
| TAT | `tat_days_` FLOAT64, `tat_min_` INT64, both 0.6% null | Precomputed upstream and finer-grained than the truncated dates (sample: 0.27 d = 6 h 22 m). Prefer these over date arithmetic |
| Load pattern | `source_files`: 36,075 = "Historical migration (tickets tab)"; ~330 from daily `Open/Closed Tickets of 2026-08-{10..13}.xlsx` | Pipeline is ~3 days old, refreshed by daily file drop |
| Segment vocabulary | `customer_category` = *LE - Large Hospital*, *Private - SME*, *LE - Cath Lab*, *Government*, *LE - Diagnostic Chain*, *ECHO*, *Project* | Identical to `hub_master_segment`; must route through `segmentGroupSql_` like every other segment surface |

Dirty data that the queries must handle explicitly:

- `tat_min_` min **−2158**, `tat_days_` min **−1.5**, and `closed_date` min (2024-01-06) predates
  `created_on` min (2024-01-08) → some rows close before they open.
- `distance_travelled_m_` max **17,397,101 m** (17,397 km) — a single-ticket outlier.
- Null rates split cleanly by lifecycle: the closure columns are ~0.6% null, matching the 205
  open tickets. That is expected, not a defect.
- High-null columns unusable as dimensions: `serial_number` 81.7%, `ticket_status` 99.4%,
  `reporting_manager` 99.4%, `service_partner_name` 99.5%, `customer_mail_id` 99.8%.

### 3.2 tom_tickets — 1,325 rows, 18 columns

- Window `received_date` 2025-12-30 → 2026-08-12; sourced from monthly spreadsheet tabs
  (`source_tab` = `"2026 | June 2026"` …, 8 tabs).
- `center_id` populated on 99.7% of rows (1,071 distinct); `zoho_id` on 99.9% (1,198 distinct).
- `tat_days_` INT64, 0 → 9, only 7 distinct values.
- `remarks` is a **resolution status**, not free text: *Issue identified+Service Visit* 811,
  *Issue Resolved* 256, *Auto Resolved* 86, *Service visit request for Identification* 68,
  *No response* 41, *Direct service Request by customer* 31, *Not resolved* 27.
- Two columns are unusable: `t_o_m` holds one value across all 1,325 rows (`"Saidha"`), and
  `comments` is 98.3% null.

## 4. Decisions

### 4.1 The M-A1 uptime engine is NOT repointed at ServiceWRK

`Config.js:83` and `docs/SOURCES.md:81` both anticipate ServiceWRK as the canonical downtime
source, with `SOURCES.md:93` saying "when ServiceWRK lands, swap the `tix` CTE source". The
profiled data does not support that swap:

1. **Date-only timestamps.** `centerUptimeSqlCD_` merges intervals at HOUR grain; a same-day
   open+close would contribute zero downtime. That redefines the metric rather than repointing it.
2. **Failure volume collapses.** Only 870 of 36,403 rows are `ticket_type = 'BREAKDOWN'`. The
   remainder is core service work, scheduled service, installations, even document collection.
   Downtime would shrink and uptime would rise toward 100% — a better-looking, less true number.
3. **Window too short.** ServiceWRK starts 2024-01-08 while `life = today − deploymentdate`
   reaches years further back, so all pre-2024 downtime would silently vanish.
4. **Center join unproven** (see §7).

Decision (user, 2026-08-13, after seeing the profile): keep M-A1 on the Zoho proxy. Revisit only
if a ServiceWRK feed with real open/close times arrives. No file outside the two new pages
changes as part of this work.

### 4.2 Filtering comes from each table's own columns, not from a center join

ServiceWRK carries `state`, `city`, `pincode`, `customer_category` and `ticket_territory`; TOM
carries `center_id`, `center_name` and `location`. Building the pages on these means the pages
work regardless of how the `customer_id` → `CenterID` join test turns out. The join is treated
as an **enhancement** (§7), buying hub/center filtering and center-drawer click-through — not as
a foundation. Building on the join instead would make a weak coverage result sink the page.

## 5. Service page

### 5.1 KPI strip (4 tiles, `kpi-grid-4`)

| Tile | Definition | Rationale |
|---|---|---|
| Open tickets | `COUNTIF(status = 'Open')` | The live field backlog |
| Median TAT | median `tat_days_` over closed tickets, negatives excluded | Median not mean — the −1.5 … 249.85 range makes a mean meaningless |
| Remote resolution % | `OVERCALL_RESOLUTION ÷ closed` (today 14.5%) | Every remote fix is an avoided truck roll — the cost lever on this page |
| Field visits · 30d | `closure_type = 'CENTER_VISIT'` within 30 days of `created_on` max | Current field load |

### 5.2 Charts

1. **Ticket flow** — created vs closed by month. Reuses the existing `ticketFlow` chart shape.
2. **TAT distribution** — bands same-day / 1–2d / 3–7d / 8–30d / 30d+.
3. **Resolution mix** — donut, `CENTER_VISIT` (30,822) vs `OVERCALL_RESOLUTION` (5,259).
4. **Top service types** — horizontal bar over `service_type` (27 distinct).
5. **By device model** — horizontal bar over `category` (MAC 600 17,109 · VCARDIA 16,994 · TR-series · ECHO).
6. **Field force** — top 12 `representative`s (of 114) by tickets closed.

### 5.3 Table

Service ticket explorer — paginated and sortable, same pattern as the Customer 360 table:
ticket · created · status · contact · territory · product · service type · representative ·
TAT · closure type.

### 5.4 Query guards (non-negotiable)

- Exclude `tat_days_ < 0` from every TAT statistic, and surface the excluded count rather than
  dropping it silently.
- Percentile-cap `distance_travelled_m_` anywhere it is charted.
- No dedupe CTE (§3.1) — adding one would be cargo-culting `zoho_data`'s shape.
- Format `TIMESTAMP` columns **in SQL**. `collectRows_` returns them as epoch strings
  (`"1.7712E9"`); formatting in JS reproduces the class of bug fixed in commit `7bcf2a5`.
- Route `customer_category` through `segmentGroupSql_`, per the standing rule from the
  2026-08-04 segment merge.

## 6. TOM page

Assumption, flagged: the layout treats TOM as a **CS issue tracker**, which is what the columns
describe. See §7 — if it is machine-transfer tracking, the framing changes to movements and
turnaround while the underlying queries mostly survive.

- **KPIs:** issues logged · resolved % (*Issue Resolved* + *Auto Resolved* = 342 of 1,325) ·
  avg `tat_days_` · unresolved (*Not resolved* 27 + *No response* 41).
- **Charts:** monthly volume · issue-type mix (Machine 420, lead cable 363, Communicator 252,
  OTG 128) · device-type mix (Vcardia 651, MAC600 342) · resolution outcome from `remarks` ·
  CS-owner workload across 13 staff · top `reason` values (102 distinct → top 12).
- **Table:** received · closed · zoho id · center · location · device type · issue type ·
  reason · owner · TAT · outcome.
- **Dropped columns:** `t_o_m` and `comments` (§3.2).

## 7. Open items

| Item | Decision rule |
|---|---|
| `profileJoinKeys` unrun — does `servicewrk.customer_id` / `tom.center_id` resolve to `center_details.CenterID`? | If coverage is high, add hub/center filtering and center-drawer click-through as a follow-up. If low, the pages stand as designed. Nothing in §5–6 depends on the outcome. |
| What TOM stands for and who uses the tracker | If it is machine-transfer tracking rather than issue tracking, re-frame §6's labels and KPIs around movements/turnaround. Column selection is largely unaffected. |
| ServiceWRK refresh cadence | Daily `.xlsx` drops observed over 3 days. Confirm before choosing a cache TTL different from `CONFIG.CACHE_TTL_SECONDS`. |

## 8. Testing & verification

- Unit tier: any new SQL builder gets a test in the existing Jest unit suite, in the pattern of
  the `segmentGroupSql_` tests.
- Every headline figure in §5.1 and §6 is verified against a hand-written BigQuery query before
  commit — the standing convention for this repo, and the reason the reconcile tier prefers
  independent-equivalence over bound checks.
- Local preview (`scripts/build_preview.ps1`) needs mock payloads for both new endpoints, with
  more than 5 rows per list so pagination is genuinely exercisable.

## 9. Out of scope

- Any change to M-A1 uptime, MTBF or health (§4.1).
- Any change to the Support page or `zoho_data`.
- Raw Data page pills for the two new tables.
- Backfilling `serial_number` (81.7% null) to bridge ServiceWRK tickets to devices.
