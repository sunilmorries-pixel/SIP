# Global Navigation + Universal Filter — Design

**Date:** 2026-07-28
**Status:** Approved by user (all sections, including two refinements mid-review)
**Baseline:** live @39 / git `ef78703` (v5.10 + centers-tab-kpi-rebuild deployed)

## 1. Problem

Two independent-but-related asks, both "global level" changes to navigation and filtering:

1. **Overview's tab bar position doesn't match its role.** It's the default landing page (a
   deliberate v5.7 decision — "landing ≠ tab position") but sits 6th in the tab bar, after
   Centers/Support/Asset/Map/Top Customers. New users scanning the tab bar don't see it first.
2. **Filtering is fragmented and thin.** Since v5.8, Asset/Centers/Support each carry their own
   independent Segment dropdown (single-select, one dimension). Map, Top Customers, Numbers,
   Overview, and Raw Data have no filtering at all. Two dimensions that existed before v5.8
   (Hub, and a Status/Active concept) were removed rather than generalized. There's no way to
   see, at a glance, which filters are currently narrowing what you're looking at.

## 2. Navigation

Reorder the tab bar to: **Overview → Centers/Customers → Support/CS → Asset → Map → Top
Customers → Numbers → Raw Data**. Pure markup reorder in `Index.html`'s `<nav class="tabs">` —
`wireTabs()`/`activateTab()` iterate the DOM, not a hardcoded list, so no JS changes are
required. Overview keeps `is-active`/landing behavior, unchanged.

## 3. Filter data model

One shared global state object replaces the v5.8 per-page `state.pageSegment`:

```js
state.globalFilters = {
  segments: [],           // hub_master_segment values, multi-select
  statuses: ['ACTIVE'],   // center Status values, multi-select — DEFAULTS to ['ACTIVE']
  states: [],             // center_details.State values, multi-select
  hubs: [],               // HubName values, multi-select
  dateFrom: '', dateTo: '' // 'YYYY-MM-DD' — page-interpreted, see §4
};
```

Empty array/string on any dimension = no filter on that dimension (existing convention,
unchanged). **`statuses` is the one dimension with a non-empty default** (`['ACTIVE']`, the
exact literal value existing code already uses) — a deliberate, user-adjustable default, not a
hidden baseline: it renders as a normal removable chip from first load ("Status: Active ✕"),
threads through the identical `multiCond_` mechanism as every other selected value, and can be
cleared like any other filter to see all statuses. This is NOT a revival of the old fixed
`cdFilter_()` baseline architecture (removed in v5.10, and staying removed) — it's an ordinary
filter value that happens to start pre-selected.

Global search stays a separate, independent control (unchanged from today) — explicitly
excluded from the filter button/panel per the user's request.

## 4. Backend threading

Extends the v5.8 per-dimension pattern (sanitize → SQL-condition builder → thread through each
grain's query builder) rather than introducing a declarative filter engine — see the rejected
alternatives in §7.

### 4.1 New shared helper (`Queries.js`)

```js
/** column IN ('v1','v2',...) for a sanitized, non-empty array; '' otherwise. */
function multiCond_(column, values) {
  var clean = (values || []).map(segClean_).filter(Boolean);
  if (!clean.length) return '';
  return ' AND ' + column + ' IN (' + clean.map(function (v) { return "'" + v + "'"; }).join(',') + ')';
}
```

Segment, Status, State, and Hub all reuse this one helper — they're structurally identical
("match this column against a list of values").

### 4.2 The center_details / zoho_data / cloud_devices column-ownership nuance

Status and State are **center_details-only** columns. `zoho_data` and `cloud_devices` don't
have them — and critically, `zoho_data.status` is the *ticket's* status (Open/Closed/Duplicate/
Junk), not the center's (Active/Deactivated); these must never be conflated in a `multiCond_`
call. Segment and Hub *do* exist natively on `zoho_data` (`hub_master_segment`, `HubName`) and
thread there directly via `multiCond_`.

For Status/State filtering on Support (zoho_data) and Asset's `cloud_devices`-backed tiles
(Poor signal, Unsynced, Firmware, Device status donut), generalize the existing `devSegCond_`
subquery-bridge pattern:

```js
/** Narrows an outer table to rows whose CenterID passes the center_details filter set. */
function centerFilterSubqueryCond_(filters) {
  var cond = multiCond_('hub_master_segment', filters.segments) +
             multiCond_('Status', filters.statuses) +
             multiCond_('State', filters.states) +
             multiCond_('HubName', filters.hubs);
  if (!cond) return '';
  return ' AND CenterID IN (SELECT DISTINCT CenterID FROM ' + T('center_details') +
    ' WHERE ' + cdFilter_() + cond + ')';
}
```

Reused for both `zoho_data`-backed Support specs and `cloud_devices`-backed Asset specs — same
shape, different outer table. Segment/Hub could theoretically use their native column instead
of the subquery on zoho_data, but using the subquery uniformly for ALL four dimensions keeps
one code path instead of two, at the cost of one extra `IN (SELECT ...)` — acceptable given
`center_details` centerBase is already a bounded ~28k-row scan.

### 4.3 Date range — page-interpreted, not a single shared column

No table has one universal "date" column, so the same `dateFrom`/`dateTo` pair is applied
differently per page, matching the user's explicit mapping:

| Page | Date field | Mechanism |
|---|---|---|
| Centers | `center_details.deploymentdate` | SQL `DATE` comparison |
| Map | `center_details.deploymentdate` | Same as Centers (Map is fundamentally a center visualization — assumption, flagged to user, not corrected) |
| Support | `zoho_data.CreatedAt` | SQL, via existing `SAFE.PARSE_DATETIME` pattern (`zohoParsedDates_()`) |
| Asset | Jira sheet `Created` (via `getAssetIndex_()`) | JS-side comparison on each asset's own date field — Asset's real device data lives in the Jira sheet, not `cloud_devices` |
| Top Customers, Overview | — | **Exempt** — no single natural date column across the mixed grains they composite (assumption, flagged to user, not corrected) |
| Numbers, Raw Data | — | **Exempt from ALL filtering** (see §4.4) |

```js
/** SQL DATE column bounds check; '' if both bounds are empty. */
function dateRangeCond_(column, from, to) {
  var f = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : '';
  var t = /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : '';
  var cond = '';
  if (f) cond += " AND DATE(" + column + ") >= '" + f + "'";
  if (t) cond += " AND DATE(" + column + ") <= '" + t + "'";
  return cond;
}
```

Zoho's version parses the string column first (`DATE(SAFE.PARSE_DATETIME(...))`), otherwise
identical shape. Asset's JS version compares `assetDateStr_(a.birthday) >= from` etc. directly,
no SQL involved.

### 4.4 Exemptions

- **Numbers and Raw Data are exempt from every dimension.** Both are explicitly diagnostic/raw
  pages by design — Raw Data's entire purpose is showing unfiltered source data (already
  documented in its own on-page copy); retrofitting filters would contradict that purpose.
- **Top Customers and Overview are exempt from date filtering only** (Segment/Status/State/Hub
  still apply) — flagged as an assumption, not a hard requirement; correctable later if wrong.

### 4.5 Files touched

| File | Change |
|---|---|
| `src/server/Queries.js` | Add `multiCond_`, `dateRangeCond_`; thread `centerFilterSubqueryCond_(filters)` (all 4 dimensions uniformly, per §4.2's one-code-path decision) into zoho specs (`zohoKpis`, `slaKpis`, `slaByType`, `zohoTrend`, `zohoOpenByStatus`, `zohoCategories`, `zohoPriority`, `zohoChannel`, `zohoSegment`) and device specs (`kpis`, `fleetStatus`, `firmware`); add `dateRangeCond_` to `zohoKpis`/`slaKpis`/`slaByType`/`zohoTrend` (Support's `CreatedAt`) |
| `src/server/EditionCD.js` | Generalize `devSegCond_` → `centerFilterSubqueryCond_`; `buildDashboardQuerySpecsCD(hub, filters)` (was `(hub, segment)`) threads all 5 dimensions into `centerKpis`/`geo`/`deploymentAge`/`activeVsEnded`/`hubs`; `centerUptimeSqlCD_(tailSelect, filters)`; `getCenter360RowsCD_(filters)`; `apiGetDashboardCD({filters, bypassCache})`. **Reverses v5.8's explicit "Exec Overview stays unsegmented" contract for Overview/Top Customers** (§4.4 now requires Segment/Status/State/Hub — not date — on both): `apiGetExecOverviewCD(options)`, `apiGetTopCustomersCD(options)`, and `computeTopCustomersCD_(filters)` (currently zero-arg) all gain a `filters` parameter and pass it through to the same `getCenter360RowsCD_(filters)`/`buildDashboardQuerySpecsCD(hub, filters)` calls Centers already uses — no new query logic, just wiring the parameter through. **Numbers stays fully unsegmented** (`apiGetNumbers`/`jiraDeviceStats_()` called with no `filters` — per §4.4, Numbers is exempt from everything). |
| `src/server/Numbers.js` | `jiraDeviceStats_(filters)` — JS filtering via a generalized `centerFilterMap_()` (was `centerSegmentMap_()`, segment-only): now returns `{center_id: {segment, status, state, hub}}` and every Asset-page Jira metric (Total devices, Device age, Asset lifecycle/types, cohort) checks all 4 center-attribute dimensions via each asset's mapped `center_id`, plus a direct date-string comparison against the asset's own Jira `Created` field. Unmapped assets (no resolvable center) drop out whenever any of Segment/Status/State/Hub is active — matching the existing v5.8 behavior for Segment alone. |
| `src/server/Setup.js` | Cache-epoch mechanism (§5) |

## 5. Caching — epoch-based invalidation

v5.8's approach (enumerate every segment value, clear one cache key per value) does not scale
to 5 multi-select dimensions — the combination space is unbounded. Replacing it:

- A counter in Script Properties (`CACHE_EPOCH`, starts at `0`).
- Every cache key folds it in: `dashcd_v6_<epoch>_<filterHash>_<hubHash>`, `ctr360cd_v6_<epoch>_<filterHash>`, etc. `<filterHash>` = `shortHash(JSON.stringify(sorted filter arrays + date range))`.
- `clearDashboardCache()` increments `CACHE_EPOCH` instead of enumerating keys — every existing
  filtered variant becomes unreachable (a new epoch number appears in all future keys) without
  needing to know what combinations were ever cached. Old entries age out via the existing
  900s TTL; no explicit deletion needed.
- Cache-key version bumps `v5` → `v6` everywhere (signals the shape change from single-segment
  to multi-dimension; old `v5` keys are simply never addressed again).

## 6. Filter UI

- **Topbar**: one new "Filters" button (funnel icon + label + count badge) replaces the 3
  per-page `.page-filters` bars, which are deleted from the Asset/Centers/Support panel markup
  entirely. **The badge always shows the current total count of active filter values across
  every dimension, including the default Status** — so a fresh page load shows "Filters · 1"
  (the default `Status: Active`), not "Filters · 0" or a hidden badge. This is deliberate: the
  whole point of this feature is visibility into what's filtering the data, including defaults
  the user didn't explicitly set.
- **Panel**: a right-side slide-in drawer reusing the existing `#centerDrawer`/`#centerScrim`
  CSS/JS mechanics (consistent interaction language, no new component). Sections in order:
  Segment (checkbox list, ~9 values), Status (checkbox list, 2 values), State (searchable
  multi-select — see data-quality note below), Hub (searchable multi-select), Date range (two
  native `<input type="date">`). **"Searchable multi-select" = a small vanilla-JS combobox
  (text input filters a checkbox list shown in a dropdown) built from scratch, matching this
  app's existing no-external-UI-library convention (echarts/Leaflet are the only third-party
  deps, both chart/map-specific) — not a new dependency.**
  - **Data-quality note, not fixed by this feature**: `State` currently has **357 distinct raw
    values** in `center_details` (not the ~36 real Indian states/UTs — almost certainly messy
    free text, the same class of problem `hub_master_segment` solved for Segment). A flat
    checkbox list would be unusable at that cardinality; the searchable multi-select handles it
    regardless of how many distinct values exist, but the underlying data isn't being cleaned
    up here.
- **Footer**: "Apply" (commits pending selections into `state.globalFilters`, triggers the
  refetch cascade below) and "Clear all" (resets every dimension to its default — note Status
  resets to `['ACTIVE']`, not empty, matching §3).
- **Chips**: rendered next to the Filters button, one per currently-applied value (not
  per-dimension) — e.g. "Segment: Government ✕", "Status: Active ✕", "Date: Jan 1–Mar 31 ✕".
  Clicking a chip's ✕ removes just that value and re-applies immediately, without reopening
  the panel.

### 6.1 Refetch cascade on Apply

Reuses the exact pattern the old v5.7/5.8 "Active only" toggle used for its own invalidation:
on Apply, reset every page's lazy-load flag (`execLoaded`, `mapLoaded`, `topLoaded`,
`numbersLoaded` stays untouched — Numbers is exempt — `lastDashboard = null`,
`cdRaw.total = 0`), then immediately reload whichever tab is currently active. Every other tab
refetches fresh (bypassing nothing — just a natural cache-key miss under the new filter hash)
the next time it's opened.

## 7. Rejected alternatives

- **A declarative filter engine** (config-driven SQL generation for any dimension) — more
  abstraction than this codebase uses anywhere else, and breaks down for Asset's Jira-sheet
  filtering, which isn't SQL at all (a JS center→segment map lookup). Premature generalization
  for 5 dimensions across 4 grains.
- **Client-side-only filtering** (fetch everything once, filter in the browser) — not viable at
  this data volume (18k–28k centers, tens of thousands of tickets); this app's uptime/health/
  MTBF figures are BigQuery aggregates, not derivable from raw rows in JS without
  reimplementing the whole uptime engine client-side.

## 8. Brand tagline + info icon

- Text: `Service Insight Platform` → `Service Insights Platform` (`Index.html` brand-sub span).
- A small ⓘ next to it, reusing the existing info-dot/popover mechanism (`setupMetricInfo()`,
  `.info-dot`/`.info-pop` in `App.html`/`Styles.html`) already built for KPI tooltips — one new
  static entry, not routed through the `KPI_METRIC`/`TITLE_METRIC` lookup maps (those are keyed
  by tile id/card title; this is a standalone "about the product" popover). Draft copy (open to
  editing): *"SIP Insights is Tricog's live operations dashboard — one view into device health,
  center uptime, ticket SLAs, and where the business needs attention right now, drawn directly
  from BigQuery, Zoho, and Jira."*

## 9. Verification plan

- Every new/changed SQL (`multiCond_`, `dateRangeCond_`, `centerFilterSubqueryCond_`,
  per-grain threading) verified live on BigQuery before commit — established pattern (node eval
  → `bq query` stdin).
- Extend the Jest reconciliation suite (`test/reconcile/`, built 2026-07-28) with: multi-value
  IN-list correctness (2 segments selected → result equals the sum of each selected
  individually, no double-counting since a center can't hold two segment values); date-range
  boundary inclusivity; a regression pin on the Status/State/Hub subquery bridge never
  silently zeroing out results when a filter combination is valid but narrow.
- Preview pass: panel opens/closes, each dimension's multi-select works, chips render and
  individually remove, badge count tracks the active set, Apply cascades a refetch on the
  active tab, tab bar shows Overview first, brand text + info icon render and pop correctly in
  both light and dark themes, 0 console errors.

## 10. Open items (explicitly out of scope)

- `State` column data-quality cleanup (357 raw values) — not addressed here, only worked around
  in the UI via searchable multi-select.
- Whether Top Customers/Overview should eventually get date-range support — deferred pending
  user feedback after this ships.
- Extending filtering to Numbers/Raw Data — explicitly rejected (§4.4), not a "later" item.
