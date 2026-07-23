# Centers Tab — KPI & Watchlist Rebuild — Design

**Date:** 2026-07-23
**Status:** Approved by user (KPI grid, merged watchlist table)
**Scope:** First tab of the incremental, tab-by-tab KPI/page-structure rebuild (started
2026-07-22, per user request "rebuild the KPI and rearrange and rebuild the pages... I
will tell you where to calculate and how"). This pass covers the **Centers / Customers**
tab (`panel-centers` in `Index.html`) only.

## 1. Problem

The Centers tab's KPI grid and its two watchlist tables (Reliability watchlist, Center
health score) carry metrics that have accumulated across editions without a fresh pass:
two of the six KPI tiles (Active placements, Cities) are no longer the numbers the user
wants surfaced, MTBF is buried in a KPI subtitle instead of standing on its own, and the
Reliability watchlist / Center health score tables — flagged for a merge back on
2026-07-14 — still duplicate the same underlying `centerUptimeSqlCD_` "scored" query as
two separate cards with different sort orders and no way to see both signals on one row.

## 2. Design summary (one sentence)

The KPI grid drops to 5 tiles (Centers, Center uptime, Center health, States, MTBF), and
the Reliability watchlist + Center health score tables merge into one sortable
watchlist — no formula changes to uptime, health score, or MTBF; this is a
recomposition of what's *displayed*, not how it's calculated.

## 3. KPI grid

| Tile | Before | After |
|---|---|---|
| Centers | `COUNT(DISTINCT CenterID)`, no filter | **Unchanged** |
| Center uptime | `AVG(uptime_pct)` over scored centers | **Unchanged** |
| Center health | `AVG(health_score)` over scored centers | **Unchanged** |
| Active placements | `COUNT(DISTINCT CenterID WHERE deactivationdate IS NULL)` / % of centers | **Removed** |
| States | `COUNT(DISTINCT State)` | **Unchanged** |
| Cities | `COUNT(DISTINCT City)` | **Removed** |
| MTBF | *(shown only in Center-health tile subtitle)* | **New tile** — `uptimeFleet.avg_mtbf_days`, already computed server-side; no new query, client-only tile addition |

Net: 6 tiles → 5 tiles (Centers, Center uptime, Center health, States, MTBF).

## 4. Merged watchlist table

Replaces the "Reliability watchlist" and "Center health score" cards (`Index.html`
~394-434) with one card.

**Columns:** Center · Devices · Health score · Uptime % · Downtime % · MTBF · Failures
(union of both source tables, de-duplicating the shared Uptime %/Failures columns).

**Sort:** a toggle control (Uptime % / Health score), defaulting to **Uptime % ascending**
(worst first) — matches today's Reliability-watchlist default. Switching the toggle
re-sorts and re-slices to the worst 12 for whichever metric is active.

**Data/backend (Approach C — client-only merge, per user's explicit choice over two
backend-consolidation alternatives that were also considered and rejected — see §7):**
No change to `centerUptimeSqlCD_` or to either spec's SQL logic. The only backend change
is dropping `LIMIT 12` from both the `reliability` and `assetHealth` specs in
`buildDashboardQuerySpecsCD` (`EditionCD.js`) so each returns **every** scored center
(both already share the exact same "scored" row set, so no `ORDER BY` need change either
— the client re-sorts). `enrichCenterNamesCD_` continues to run on both arrays unchanged
(adds `center` name + `devices` count).

Client-side (`App.html`): merge `data.reliability` and `data.assetHealth` by `centerid`
into one row set (each row already carries every field needed — `uptime_pct`,
`downtime_pct`, `failures`, `health_score`, `mtbf_hrs`, `devices`, `center` — since both
arrays cover the same centers, a plain key-indexed merge is sufficient, no fuzzy
matching). One render function replaces `renderReliability` + `renderAssetHealth`,
takes a `sortBy` param (`'uptime_pct' | 'health_score'`, ascending), and re-renders on
toggle without a re-fetch (data already in memory from the dashboard payload).

**Rejected because the user chose otherwise, not because they're wrong:**
- *Full consolidation* (compute the "scored" CTE once per load and feed the watchlist,
  the KPI averages, and Center 360 all from it) would fully resolve the existing
  "uptime CTE recomputed 4×/load" perf-backlog item, but touches Center 360's
  independent caching (`getCenter360RowsCD_`, reused by `centerSegmentMap_` and
  `enrichCenterNamesCD_`) and the dashboard's parallel-query orchestration — out of
  scope for this pass, left as a standalone future perf item.
- *Minimal backend merge* (one new `centerWatchlist` spec replacing both) would cut
  redundant CTE runs from 4→3 per load with a small, isolated diff — also declined in
  favor of the zero-SQL-change option.

## 5. Explicitly unchanged this pass

- All four Centers-tab charts (Centers by state, Deployment age, Centers by segment,
  Top hubs) — no changes.
- Center 360 table — no changes.
- Segment filter, executive-summary narrative — no changes.
- Uptime %, health-score, and MTBF **formulas** themselves (`centerUptimeSqlCD_`) — no
  changes; this pass only changes what's displayed and how it's grouped.

## 6. Component impact map

| File | Changes |
|---|---|
| `src/server/EditionCD.js` | Drop `LIMIT 12` from the `reliability` and `assetHealth` specs in `buildDashboardQuerySpecsCD` |
| `src/client/Index.html` | KPI grid markup: remove Active-placements + Cities tiles, add MTBF tile; replace the two watchlist `<article>` cards with one merged card + sort-toggle control |
| `src/client/App.html` | KPI wiring for the new/removed tiles; new merged-watchlist render function (replaces `renderReliability` + `renderAssetHealth`) with client-side merge-by-`centerid` and sort-toggle handling |
| `src/client/Styles.html` | Minor: styling for the sort-toggle control on the merged watchlist card |

## 7. Testing & verification

- Live click-through on the Centers tab: Centers / Center uptime / Center health / States
  KPI values match today's production numbers exactly (unchanged formulas/queries).
- MTBF tile shows a sane value matching the number currently in the Center-health
  tile's subtitle.
- Merged watchlist, default view (Uptime % ascending): row-for-row match against
  today's Reliability watchlist (same 12 centers, same order).
- Toggle to Health score: row-for-row match against today's Center health score table.
- 0 console errors; empty-state rendering unchanged (falls through to the existing
  "No reliability metrics yet" / "No health data yet" style empty message).

## 8. Open items (explicitly out of scope)

- Full backend consolidation of the "scored" CTE (4×/load → 1×/load) — remains on the
  perf backlog as a standalone item, not bundled here.
- Reconsidering the Active-placements / Cities metrics for reuse elsewhere on the
  dashboard (they're removed from Centers, not necessarily dead everywhere) — not
  raised by the user, not addressed.
- Every other tab in the KPI/page rebuild (Customers, Support/CS, Overview, Map, Top
  Customers, Numbers, Raw Data) — untouched this round; rebuilt one at a time per the
  user's stated approach.
