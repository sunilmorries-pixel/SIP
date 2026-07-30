# Centers page: merge Reliability & Health into Center 360

**Date:** 2026-07-30
**Status:** Approved, ready for implementation plan

## Problem

The Centers/Customers page currently shows two overlapping per-center tables:

1. **Reliability & Health watchlist** (`#centerWatchlistTable`) — Center, Devices, Health,
   Uptime %, Downtime %, MTBF (days), Failures. Worst 12 centers only (by uptime or health,
   user-toggled). Static, no search/pagination.
2. **Center 360 explorer** (`#centerTable`) — Center, ID, Hub, City, State, Devices, Jira
   devices, Online, Lifecycle, Downtime, Uptime, Tickets, Open tickets, Last heartbeat. All
   centers, paginated/sortable/searchable via `apiGetCenters`.

Both surface uptime for every scored center; the watchlist additionally has Health/MTBF/
Failures that Center 360 lacks. This is redundant — two tables, two render paths, one data
story. The user wants them combined into a single table (keeping the "Center 360" identity).

## Final column list (after review)

The user reviewed the full source/formula list for all 14 existing + 3 candidate new columns
and trimmed it: drop **Online** and **Last heartbeat** (existing columns — the same data
still shows independently in the center-detail drawer's "Online 24h" stat, confirmed via
`makeCenterDetail`/`openCenterRow`, so no data is lost, just de-duplicated off this table),
and drop **Health** from the new additions (the most "derived-of-derived" of the three — a
scoring formula built from uptime + failures/MTBF, which are already represented directly).
Net effect: 14 columns in, 14 columns out — same width, no redundancy.

Final Center 360 columns: Center, ID, Hub, City, State, Devices, Jira devices, Lifecycle,
Downtime, Uptime, Tickets, Open tickets, **MTBF (days)** *(new)*, **Failures** *(new)*.

## Scope

**In scope:** fold MTBF and Failures into the Center 360 table as two new sortable columns;
remove the Online and Last heartbeat columns from Center 360 (data still available via the
center-detail drawer); delete the separate Reliability & Health card entirely; drop the
now-unused `assetHealth` query from the main dashboard payload.

**Out of scope:** the Overview tab's own "Reliability" widget (`execRelTable`, fed by a
separate `apiGetExecOverview` call reading the `reliability` spec) is untouched — confirmed
as a distinct consumer, not part of this merge. No changes to charts, KPI grid, or executive
summary on the Centers page.

## Server changes (`src/server/EditionCD.js`)

`getCenter360RowsCD_` already runs a no-`LIMIT` `centerUptimeSqlCD_` query to attach
`lifecycle_years` / `downtime_days` / `uptime_pct` to every center row. Extend that same
query's `SELECT` to also return `mtbf_hrs` and `failures` (both already computed inside the
`scored`/`calc` CTEs at `EditionCD.js:111-124` — the same formula the old watchlist used, so
numbers must match exactly). `health_score` is computed in the same CTE chain regardless
(it's defined upstream of the tail-select) but is deliberately NOT selected — it's not being
added as a column. Merge the two new fields into `joined` rows the same way the existing
three (`lifecycle_years`/`downtime_days`/`uptime_pct`) already are. No new BigQuery query is
introduced.

`apiGetDashboardCD` currently runs the full `buildDashboardQuerySpecsCD` list unfiltered,
which includes both `reliability` and `assetHealth` (each carrying every scored center —
the reason this endpoint needed `cachePutLarge`/gzip chunking in the first place, per the
existing code comment). Once `renderCenterWatchlist` is deleted, `assetHealth` becomes
unused by this endpoint's client consumer — exclude it from the query list `apiGetDashboardCD`
runs (`reliability` must stay: Overview's separate endpoint still needs the spec definition,
and nothing here should touch `buildDashboardQuerySpecsCD` itself, only what `apiGetDashboardCD`
requests from it).

`CENTER_SORT_KEYS` (`src/server/Api.js:65`) gains `mtbf_hrs` and `failures` (click-sortable
like every existing column), and drops `online`/`last_seen` — now-unreachable dead entries
once their columns/headers are removed from the table.

**Cache keys bumped** (existing repo convention on any row/payload shape change):
`ctr360cd_v6` → `v7` (Center 360 row shape gains `mtbf_hrs`/`failures`), `dashcd_v6_` → `v7_`
(dashboard payload drops `assetHealth`). `clearDashboardCache()` updated to match.

## Client changes (`src/client/App.html`, `src/client/Index.html`)

- `CENTER_COLUMNS` (App.html:1035) removes the **Online** and **Last heartbeat** entries and
  adds 2 new sortable columns: **MTBF (days)**, **Failures** — same badge/format conventions
  as the old watchlist (MTBF humanized as `Nd` from hours, `—` when null; failures shown as
  a plain count, no badge — same as the old watchlist's Failures column).
- `renderCenterTable`'s row-builder (App.html:1093) drops the Online/Last-heartbeat `<td>`
  cells and adds 2 new `<td>` cells for MTBF/Failures.
- Delete entirely: the "Reliability & Health" `<article>` card and its `#watchlistSort`
  dropdown (Index.html); `renderCenterWatchlist()` and its call site in `render()`; the
  `watchlistSort` change listener; `state.centersWatchlistSort`; the `#centerWatchlistTable`
  CSS rule (Styles.html:459); the `METRIC_INFO['reliability']` tooltip entry (now describes a
  deleted card) — its formula text folds into the existing `METRIC_INFO['center360']` entry
  (`App.html:2374`, already wired to the "Center 360" card title via `TITLE_METRIC`), which
  gets MTBF/Failures added to its formula description (Online/Last-heartbeat mentions removed
  from that description if present, since they're no longer table columns).
- Mock/local-preview data (`App.html` demo-data generator) drops its `assetHealth` mock array
  and adds `mtbf_hrs`/`failures` fields to its Center 360 mock rows instead; Online/Last-seen
  mock fields on Center 360 rows can stay in the underlying mock object (harmless, unused by
  the table) or be dropped — implementer's call, no behavioral difference.
- **Default sort unchanged** — Center 360 keeps sorting by Devices (desc) on load. Worst
  uptime is one column-header click away, consistent with every other column; no
  special-cased "worst first" default is introduced for this merge.
- **Column count stays at 14** (2 removed, 2 added) — no width/layout concern, unlike the
  earlier 14→17 draft.

## Testing / verification

1. Build the local mock preview (`scripts/build_preview.ps1`), confirm MTBF/Failures render
   correctly and are sortable, Online/Last-heartbeat columns are gone, and the Reliability &
   Health card is gone with no layout gap.
2. Against live BigQuery: cross-check MTBF/Failures values for a handful of centers against
   today's (pre-change) watchlist numbers to confirm the merged query produces identical
   values — same formula, so this should be an exact match, not an approximation.
3. Confirm Center 360 pagination/search/sort still work correctly with the updated row shape,
   and that `apiGetDashboardCD`'s payload no longer includes `assetHealth` (smaller response).
4. Run `npm test` (existing unit suite) — no new pure-JS logic is introduced, so this is a
   regression check, not new coverage.

## Risks / notes

- The MTBF/Failures formula is copy-identical to what the watchlist already used, so there is
  no formula-review risk here — this is a display/dedup change, not a metric change.
- Removing `assetHealth` from `apiGetDashboardCD` only affects that one endpoint's query
  list, not the shared `buildDashboardQuerySpecsCD` spec definitions — Overview's
  `apiGetExecOverviewCD` (which filters specs via its own `want` map) is unaffected.
- Dropping the Online/Last-heartbeat *columns* does not remove that data server-side (still
  needed for `rollup.online`/`worstCenters` on Overview and the center-detail drawer's own
  "Online 24h" stat) — only the Center 360 table's display of it goes away.
