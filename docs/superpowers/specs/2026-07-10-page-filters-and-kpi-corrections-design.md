# Page-Level Filters + KPI Corrections — Design

**Date:** 2026-07-10
**Status:** Approved by user (page map, filter system, corrections ledger)
**Baseline:** live deployment @31 == repo `main` @ `25f7390` (verified byte-level via Apps Script REST API, 2026-07-10)
**Companion doc:** KPI Lineage Audit (artifact, 2026-07-10) — the code-traced inventory this design corrects.

## 1. Problem

Three seams from the app's edition-by-edition growth:

1. **Grain confusion.** The Asset page (device-grain) hosts four center-grain items: Center
   uptime KPI, Center health KPI, Reliability watchlist, Asset health score table. The v5.7
   decision was that center uptime/health belong on Centers. Centers has a "Devices mapped"
   KPI that actually counts centers (identical SQL to the Centers tile).
2. **Filter anarchy.** Three coexisting mechanisms: topbar Hub dropdown (honored by some
   queries, ignored by others — on Centers it filters only the Center-360 table, not the
   KPIs/charts), topbar Active-only toggle (threads server-side), and a hardcoded dormant
   F2P exclusion. No single answer to "what am I looking at?".
3. **Label drift.** Tooltips cite retired sources (jira_data BQ, device_center_mapping);
   the Top-hubs aria-label describes a deleted chart; CS-sheet cards silently mix all-time
   windows with 90-day Zoho neighbors.

## 2. Design summary (one sentence)

Every page shows exactly one grain, scoped by one **fixed visible rule** (Active + Paid
centers), with one **Segment dropdown** that filters everything on that page server-side —
and every label tells the truth about its source and window.

## 3. Page ownership map (approved)

| Page | Grain | Keeps | Gains | Loses |
|---|---|---|---|---|
| Asset | Device | Total devices, Device age chart, Asset lifecycle, Asset types (Jira sheet); Device status donut, Firmware, Poor signal, Unsynced (cloud_devices); FTF cohort chart + Batch signal + cohort table | Avg device age + Past-5yr-life as KPI tiles | Center uptime KPI, Center health KPI, Reliability watchlist, Asset health score table |
| Centers | Center | Exec summary, Centers KPI, Active placements, States, Cities, Deployment age, Segment donut, Top hubs, Center-360 | Center uptime KPI + Center health KPI (from Asset); Reliability watchlist + Center health score tables (from Asset); "Devices by state" → renamed "Centers by state" + dedup fix | "Devices mapped" KPI |
| Support/CS | Ticket / field case | Everything | Honest period labels on every card | — |

**New KPI strips**
- Asset (5): Total devices · Avg device age · Past 5-yr life · Poor signal · Unsynced ECGs
- Centers (6): Centers · Center uptime · Center health · Active placements · States · Cities

The two tables moving to Centers keep their metric engines (`centerUptimeSqlCD_`) unchanged;
only markup + render wiring move. "Asset health score" table is retitled **"Center health
score"** on Centers.

## 4. Filter system (Approach A — parameterized server filter, approved)

### 4.1 Fixed baseline (all pages)

`cdFilter_()` (EditionCD.js) loses its `activeOnly` parameter and always emits:

```sql
IFNULL(F2P_Customer, 0) = 0 AND UPPER(Status) = 'ACTIVE'
```

- Applied to every `center_details` read app-wide (centerKpis, geo, deploymentAge,
  activeVsEnded, hubs, uptimeFleet/exec summary, centerBase, uptime birth CTE, Numbers,
  RawData center source stays raw/unfiltered by design — Raw Data page shows tables as-is).
- Topbar "Active only" toggle removed (state.activeOnly, #activeOnlyBtn, `_a` cache
  suffixes, activeOnly params through apiGet*CD signatures).
- Each page filter bar shows a static, non-interactive chip: **"Active · Paid centers"**.
- Expected number shifts (from v5.7 verification): scored centers ~27,370 → ~18,460-range
  (active-only); F2P half dormant until DE populates the flag.

### 4.2 Segment dropdown (per page)

A slim filter bar under the tabs on Asset, Centers, Support/CS:
`Segment: [All segments ▾]` + baseline chip. Options from the existing `segmentOptions`
spec (distinct `hub_master_segment`). Per-page state (`state.pageSegment[page]`), refetches
that page's payload with `segment` param on change.

**Shared-payload rule:** Asset, Support/CS (and Overview) all read the one
`apiGetDashboardCD` payload. The payload is always fetched with the *currently active
page's* segment; switching to a tab whose stored segment differs from the payload's
segment triggers a refetch (cache makes repeats cheap — 7 segments max). Centers has its
own endpoint (`apiGetCentersCD`) and refetches independently.

Threading by grain:

| Data family | Mechanism |
|---|---|
| center_details queries | `AND hub_master_segment = @segment` |
| zoho_data queries (Support charts, SLA, downtime engine) | `AND hub_master_segment = @segment` (native column) |
| cloud_devices queries (Device status, Firmware, Poor signal, Unsynced) | `AND CenterID IN (SELECT DISTINCT CenterID FROM center_details WHERE <baseline> AND hub_master_segment = @segment)` — subquery only added when a segment is selected |
| Jira-sheet JS metrics (Total devices, Device age, lifecycle/types, FTF cohort) | filter asset index via `deviceCenterMap_` → new cached `centerId → segment` lookup (one small BQ read); unmapped devices drop out when a segment is selected (approved) |
| CS-tracker sheet (Field cases, Avg TAT, TAT chart, machines, issue types, owners) | **exempt** — no segment lineage in the sheet; subtitles state "all segments" |

Topbar after this change: **global search + theme toggle only.** Hub dropdown and Segment
dropdown removed from topbar (segment moves into page bars; hub filtering dissolved — its
job covered by Top-hubs drill-ins and Center-360 search). The `@hub` param plumbing in
Queries.js specs may remain (passed as '') to minimize SQL churn, but the UI control goes.

### 4.3 Caching

Cache keys gain a segment slug: `dashcd_v5_<seg>`, `ctr360cd_v5_<seg>`, `mapcd_v5_<seg>`,
`topcustcd_v5_<seg>`, `execcd_v5_<seg>`, `jiradev_v5_<seg>`, `assets_v4_<seg>` (slug =
lowercased segment, non-alnum → '-', 'all' when unset). `_a` active suffixes deleted.
`clearDashboardCache()` updated to iterate segment slugs.

## 5. Corrections ledger (approved actions)

| # | Finding | Action |
|---|---|---|
| 1 | "Devices by state" `COUNT(*)` double-counts duplicate center_details rows | Fix: `COUNT(DISTINCT CenterID)`; rename card "Centers by state" |
| 2 | "Devices mapped" KPI = center count | Remove tile (strip redesign) |
| 3 | Hub filter only touches Center-360 | Dissolved: hub UI removed; segment threads server-side everywhere |
| 4 | Asset tooltips cite jira_data BQ | Fix METRIC_INFO: source = Jira Google Sheet |
| 5 | Centers tooltips cite device_center_mapping / enddatetime | Fix METRIC_INFO: source = center_details CD queries |
| 6 | Top-hubs aria-label describes retired stacked chart | Fix: "Bar chart of spoke counts per hub" |
| 7 | Segment donut keys colors on Active/Ended | Fix: deliberate per-segment palette in Charts.html |
| 8 | FTF "failures/device" is center-grain proxy | Keep; subtitle + tooltip state "center-grain proxy" |
| 9 | Dead code: `apiGetDashboard` (non-CD), `cohortReliabilitySql_`, `buildAssetSourceSpecs`, `assets` BQ spec | Delete the confirmed-dead non-CD dashboard path + orphaned spec builders (verify no references first) |
| 10 | CS-sheet cards all-time vs Zoho 90d/12mo | Fix subtitles: every card states its window ("all-time", "last 90 days", "last 12 months") |
| 11 | Active backlog chart has no date window | Intentional; subtitle → "current open backlog · all-time" |
| 12 | Uncatalogued IssueCategories silently get 5-day SLA + regex tech guess | Partial: SLA tooltip discloses the default; cataloging real entries needs CS input → **open item** |
| 13 | "Avg open age" trusts zoho_data.TicketActiveDays | Fix: recompute `DATETIME_DIFF(NOW, created, HOUR)/24.0` in the zohoKpis spec (consistent with SLA engine) |

## 6. Component impact map

| File | Changes |
|---|---|
| `src/server/EditionCD.js` | cdFilter_ baseline; segment param through buildDashboardQuerySpecsCD, getCenter360RowsCD_, centerUptimeSqlCD_, all apiGet*CD; cloud_devices IN-subquery injection; centerId→segment lookup + Jira-index segment filtering; geo dedup fix; cache keys |
| `src/server/Queries.js` | zoho specs gain `@segment`; zohoKpis avg_open_age recompute; delete dead specs (after reference check) |
| `src/server/Api.js` | delete apiGetDashboard (non-CD) if reference check passes; getAssetIndex_ unchanged |
| `src/server/Numbers.js` | jiraDeviceStats_ takes segment (filter via center map); cache key |
| `src/client/Index.html` | per-page filter bars; KPI strip re-composition (Asset −2 center tiles +2 age tiles; Centers +2 tiles −1); move 2 tables Asset→Centers; card renames/subtitles/aria-labels; topbar slimmed |
| `src/client/App.html` | page-segment state + loaders pass segment; remove activeOnly/hub state; KPI wiring for new strips; METRIC_INFO fixes; render wiring for moved tables; filter-bar change handlers |
| `src/client/Charts.html` | segment donut palette; no builder moves needed (tables are HTML) |
| `src/client/Styles.html` | filter-bar styles; baseline chip |
| `src/server/Setup.js` / cache utils | clearDashboardCache iterates segment slugs |

## 7. Testing & verification

- Every changed/new SQL verified live on BQ before commit (established gen-SQL → `bq query`
  stdin pattern; env `CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE`).
- Cross-checks: Centers-by-state totals == COUNT(DISTINCT CenterID) roll-up; segment-filtered
  device counts ≤ unfiltered; sum over 7 segments + blank == "All" for center counts.
- Preview (`sip-preview` launch config, rebuild after client edits): filter bar renders,
  segment change refetches, KPI strips correct, moved tables on Centers, 0 console errors.
- Deploy: `clasp push --force` + `clasp deploy -i AKfycbwV6hHz…` (stable URL), then
  `clearDashboardCache()`, `diagnostics()`.

## 8. Open items (explicitly out of scope)

- SLA catalog additions for live uncatalogued categories (needs CS team input).
- Device-grain uptime/health (no per-device downtime source in sandbox — deferred by user).
- Overview / Map / Top Customers / Numbers / Raw Data pages: untouched this round except
  where shared plumbing (baseline filter) flows through naturally. Overview keeps its
  existing tiles this round; a follow-up pass can align it to the same filter bar.
- Hub-level filtering UI (removed; revisit only if users miss it).
