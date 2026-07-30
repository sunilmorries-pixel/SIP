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

## Scope

**In scope:** fold Health score, MTBF, and Failures into the Center 360 table as three new
sortable columns; delete the separate Reliability & Health card entirely; drop the
now-unused `assetHealth` query from the main dashboard payload.

**Out of scope:** the Overview tab's own "Reliability" widget (`execRelTable`, fed by a
separate `apiGetExecOverview` call reading the `reliability` spec) is untouched — confirmed
as a distinct consumer, not part of this merge. No changes to charts, KPI grid, or executive
summary on the Centers page.

## Server changes (`src/server/EditionCD.js`)

`getCenter360RowsCD_` already runs a no-`LIMIT` `centerUptimeSqlCD_` query to attach
`lifecycle_years` / `downtime_days` / `uptime_pct` to every center row. Extend that same
query's `SELECT` to also return `mtbf_hrs`, `health_score`, and `failures` — reusing the
exact CASE expression already defined at `EditionCD.js:118-124` (the same formula the old
watchlist used, so numbers must match exactly). Merge the three fields into `joined` rows
the same way the existing three already are. No new BigQuery query is introduced.

`apiGetDashboardCD` currently runs the full `buildDashboardQuerySpecsCD` list unfiltered,
which includes both `reliability` and `assetHealth` (each carrying every scored center —
the reason this endpoint needed `cachePutLarge`/gzip chunking in the first place, per the
existing code comment). Once `renderCenterWatchlist` is deleted, `assetHealth` becomes
unused by this endpoint's client consumer — exclude it from the query list `apiGetDashboardCD`
runs (`reliability` must stay: Overview's separate endpoint still needs the spec definition,
and nothing here should touch `buildDashboardQuerySpecsCD` itself, only what `apiGetDashboardCD`
requests from it).

`CENTER_SORT_KEYS` (`src/server/Api.js:65`) gains three entries: `health_score`, `mtbf_hrs`,
`failures`, so the new columns are click-sortable like every existing one.

**Cache keys bumped** (existing repo convention on any row/payload shape change):
`ctr360cd_v6` → `v7` (Center 360 row shape gains 3 fields), `dashcd_v6_` → `v7_` (dashboard
payload drops `assetHealth`). `clearDashboardCache()` updated to match.

## Client changes (`src/client/App.html`, `src/client/Index.html`)

- `CENTER_COLUMNS` gains 3 sortable columns: **Health**, **MTBF (days)**, **Failures**,
  positioned after Uptime. Same badge-color thresholds as the old watchlist (health ≥80 ok /
  ≥60 warn / else danger; MTBF humanized as `Nd` from hours, `—` when null).
- `renderCenterTable`'s row-builder gets 3 new `<td>` cells matching those thresholds.
- Delete entirely: the "Reliability & Health" `<article>` card and its `#watchlistSort`
  dropdown (Index.html); `renderCenterWatchlist()` and its call site in `render()`; the
  `watchlistSort` change listener; `state.centersWatchlistSort`; the `#centerWatchlistTable`
  CSS rule (Styles.html:459); the `METRIC_INFO['reliability']` tooltip entry (now describes a
  deleted card) — its formula text folds into the existing `METRIC_INFO['center360']` entry
  (`App.html:2374`, already wired to the "Center 360" card title via `TITLE_METRIC`), which
  gets Health/MTBF/Failures added to its formula description.
- Mock/local-preview data (`App.html` demo-data generator) drops its `assetHealth` mock array
  and adds `health_score`/`mtbf_hrs`/`failures` fields to its Center 360 mock rows instead.
- **Default sort unchanged** — Center 360 keeps sorting by Devices (desc) on load. Worst
  uptime/health is one column-header click away, consistent with every other column; no
  special-cased "worst first" default is introduced for this merge.
- Column count grows 14 → 17. The table already scrolls horizontally via `.table-scroll` —
  no layout rework.

## Testing / verification

1. Build the local mock preview (`scripts/build_preview.ps1`), confirm the 3 new columns
   render with correct badge colors and are sortable, and that the Reliability & Health card
   is gone with no layout gap.
2. Against live BigQuery: cross-check Health/MTBF/Failures values for a handful of centers
   against today's (pre-change) watchlist numbers to confirm the merged query produces
   identical values — same formula, so this should be an exact match, not an approximation.
3. Confirm Center 360 pagination/search/sort still work correctly with the wider row shape,
   and that `apiGetDashboardCD`'s payload no longer includes `assetHealth` (smaller response).
4. Run `npm test` (existing unit suite) — no new pure-JS logic is introduced, so this is a
   regression check, not new coverage.

## Risks / notes

- The Health/MTBF/Failures formula is copy-identical to what the watchlist already used, so
  there is no formula-review risk here — this is a display/dedup change, not a metric change.
- Removing `assetHealth` from `apiGetDashboardCD` only affects that one endpoint's query
  list, not the shared `buildDashboardQuerySpecsCD` spec definitions — Overview's
  `apiGetExecOverviewCD` (which filters specs via its own `want` map) is unaffected.
