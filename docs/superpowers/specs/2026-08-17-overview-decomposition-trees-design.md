# Overview Page — Decomposition Tree Rework — Design

Date: 2026-08-17
Status: approved (design); implementation plan not yet written

## 1. Problem

The Overview tab (`Index.html:140-224`) is the app's landing page and currently a standard
exec-summary layout: a device-age ring, a KPI strip, and six chart/table cards (Jira status donut,
ticket trend, centers-needing-attention table, reliability watchlist, top customers chart, geo bar
chart). The user wants the page reworked entirely into a small set of interactive decomposition
trees — a root total that branches into a first-level category, each branch splitting again into a
second level — for Customers, Devices, and Tickets.

## 2. Design summary (one sentence)

Replace the Overview page with three ECharts `tree`-series decomposition diagrams (Customers,
Devices, Tickets), each fetched from one new dedicated endpoint, with expand/collapse, a hover
tooltip carrying a few extra stats per node, and click-through that either narrows the global
filter or navigates to the relevant page, depending on what that node's dimension actually supports.

## 3. Scope decision (user, 2026-08-17)

- **Full replace**, not an addition: the device-age ring, KPI grid, and all six existing
  chart/table cards are removed from the Overview panel.
- **Three trees**, not two: Customers and Devices (user's original ask) plus a third for Tickets
  (Zoho + ServiceWRK + TOM), added after the user confirmed the page rework should cover ticket
  data too.
- Diagram shape: **decomposition tree** (top-down boxes + connecting lines), chosen over Sankey and
  treemap alternatives presented — matches the user's own description ("total, then below divided
  by country") most literally.

## 4. Verified facts (grep'd against current source, not assumed)

- Country: `hub_country`, not `Spoke_Country`. `EditionCD.js:15-18` documents the 2026-08-14 switch
  — `Spoke_Country` has ~9% nulls plus garbage values ("Nairobi", "Africa") that `hub_country`
  doesn't. Every existing country dimension in this app (`multiCond_('hub_country', ...)` at
  `EditionCD.js:87`, the country-options query at `EditionCD.js:292-293`) already uses it.
- Segment: `segmentGroupSql_('hub_master_segment')` (`Queries.js:110`) — the standing SME/LE/
  Government/ECHO/Project merge, used at 7+ call sites across `EditionCD.js`, `Numbers.js`,
  `Queries.js`. The trees must route through this helper, never compare `hub_master_segment` raw.
- Device type: the Jira asset index's `type` field (`EditionCD.js:655`,
  `distinctValues_(assetIdx, 'type')`) — Connector / ECG Machine per
  `CONFIG.JIRA_DEVICE_TYPE_DEFAULT`.
- Age bands: `Numbers.js:152-154`, `ageBands['<1y'/'1-2y'/'2-3y'/'3-5y'/'5y+']` — the exact bucketing
  already driving the Asset page's Device age chart. Reused verbatim, not redefined.
- No existing "top-N + Others" SQL pattern anywhere in this codebase (grepped, zero hits) — this is
  new.
- Overview currently shares `apiGetDashboardCD` with Asset/Customers/Support/Service via
  `sharesDashboardPayload` / `sharesPayload` (`App.html:2076-2077, 2794-2795`, both list
  `'tab-overview'`). None of that payload's fields (fleet-status donut, zoho trend, centers table,
  reliability table, top-customers chart, geo chart) map to anything the three trees need.
- The global Filters drawer's dimensions are exactly: `segments, statuses, states, hubs, cities,
  countries, centers, deviceTypes, deviceStatusExclude, dateFrom, dateTo` (`Warm.js`
  `warmDefaultFilters_`, `App.html` `state.globalFilters`). **No age dimension. No ticket-source
  dimension.** This is load-bearing for §7.

## 5. The three trees

### 5.1 Customers — `Total → hub_country (top 5 + Others) → hub_master_segment`

- Root: `COUNT(DISTINCT CenterID)` — same definition as the existing `customersCount` metric
  (`App.html:3135`).
- Level 1: rank countries by count, keep the top 5, sum everything else into one `Others` node.
  `Others` does not expand further and is not click-filterable (no single country value to set).
- Level 2: `segmentGroupSql_('hub_master_segment')`, grouped within each country.
- Hover stats per node (both levels): device count, avg uptime, open tickets, top city. Computed
  via a LEFT JOIN to `cloud_devices`/`zoho_data` aggregated by the same grouping keys — the same
  join shape the Center-360 rows already use, just grouped by country/segment instead of by center.

### 5.2 Devices — `Total → device type → age band`

- Root: the existing `devicesCount` metric definition (Jira Connector+ECG dedup by `issue_key`).
- Level 1: device `type` (Connector / ECG Machine).
- Level 2: age band, the five buckets from §4, computed within each type.
- Hover stats: device count, % online, avg age.

### 5.3 Tickets — `Total → source → that source's own outcome`

- Root: sum of three independent systems' record counts (Zoho `zoho_data`, ServiceWRK
  `servicewrk_Tickets`, TOM `tom_tickets`) — **not deduplicated**. Roughly 90% of ServiceWRK/TOM
  rows do cross-reference a Zoho ticket (profiled 2026-08-14), but this tree does not reconcile
  across systems; it is a decomposition of three separately-tracked totals, consistent with how a
  decomposition tree's parent is always the sum of its children.
- Level 1: `Zoho | ServiceWRK | TOM`.
- Level 2, per source (no shared taxonomy — each branch uses its own):
  - Zoho → open / closed.
  - ServiceWRK → `CENTER_VISIT` vs `OVERCALL_RESOLUTION`.
  - TOM → resolved / unresolved / visit-needed (mirrors `tomResolvedCond_`/`tomUnresolvedCond_` in
    `TomTickets.js`).
- Hover stats: record count, and whatever per-source figure is cheapest to compute alongside the
  count (e.g. avg TAT where that source already has one).

## 6. Interactivity

- **Expand/collapse** — native to ECharts' `tree` series. No custom state or code.
- **Hover popup** — the tree series' own tooltip formatter, not a custom DOM component. Renders the
  3-5 stats from §5 per node.
- **Click**:
  - Customers tree, country node → sets `state.globalFilters.countries = [thatCountry]`.
  - Customers tree, segment leaf → additionally sets `state.globalFilters.segments = [thatSegment]`.
  - Devices tree, device-type node → sets `state.globalFilters.deviceTypes = [thatType]`.
  - Devices tree, age-band leaf → **no age filter exists.** Resolved fix (approved 2026-08-17):
    switches to the Asset tab, pre-filtered by that leaf's parent device type. The click still does
    something meaningful; it just isn't a filter-set.
  - Tickets tree, any node → **no ticket-source filter exists, by construction** (Zoho/ServiceWRK/
    TOM are separate pages, not a filterable slice of one payload). Resolved fix (approved
    2026-08-17): switches to that source's own page (Support / Service / TOM tab) instead of
    setting a filter.
  - Root node click on any tree clears that tree's own filter dimensions (country+segment, or
    deviceType) back to empty — the natural "reset" affordance.

## 7. Architecture

**Server** — one new file, `src/server/OverviewFlow.js`, mirroring the `ServiceWrk.js`/
`TomTickets.js` pattern:
- `buildOverviewFlowQuerySpecs(filters)` → the batch of SQL specs (customers-by-country,
  customers-by-country-segment, devices-by-type, devices-by-type-age, tickets-by-source,
  tickets-by-source-outcome, plus whatever the hover-stat joins need).
- `apiGetOverviewFlowCD(options)` → `respond_` + `withCache`, same convention as every other `CD`
  endpoint, returning `{ customers: {...}, devices: {...}, tickets: {...} }` as flat grouped rows
  (not yet nested into a tree — nesting is a client-side concern, §8).
- A dedicated top-N-plus-Others SQL helper (`topNPlusOthers_` or similar) — new, since no existing
  query in this codebase does this. Ranks by count, keeps top 5, sums the remainder into one
  `Others` row. Written once, used by the Customers tree only for now (Devices/Tickets level-1
  cardinality is already small enough not to need it).

**Overview stops sharing the dashboard payload.** Remove `'tab-overview'` from the
`sharesDashboardPayload`/`sharesPayload` arrays at `App.html:2076-2077` and `App.html:2794-2795`.
The shared `apiGetDashboardCD` endpoint itself is untouched — Asset/Customers/Support/Service keep
using it exactly as today; only the Overview tab's trigger condition changes.

**Client**:
- `Charts.decompTree(id, treeData, opts)` (new, `Charts.html`) — generic renderer over ECharts'
  `tree` series. `treeData` is the native `{name, value, children}` shape; `opts` carries a tooltip
  formatter and an `onNodeClick` handler, both supplied per-tree by the caller.
- `App.html`: `loadOverviewFlow()` / `renderOverviewFlow(payload)` replace the current
  Overview-specific render block (the code driving `execFleet`/`execTrend`/`execCentersTable`/
  `execRelTable`/`execTopCust`/`execGeo`/`execRing`). This block's *removal* is itself a scoped
  piece of work — those seven element IDs and their render calls go away entirely, not just get
  unused.
- Client-side nesting: the flat grouped rows from `apiGetOverviewFlowCD` are assembled into three
  `{name, value, children}` trees before being handed to `decompTree`. This nesting logic is pure
  JS, testable independently of the network call.
- `Index.html`: the Overview panel's markup (hero ring, KPI grid, six cards) is replaced with three
  cards, one per tree, each `span-12` (stacked, full width) — chosen over a 3-column layout because
  decomposition trees widen unpredictably with real data; can be revisited once real node counts are
  visible.

## 8. Explicitly out of scope for v1

- No color-coding of nodes by health/uptime — plain labeled boxes with a count.
- `Others` (Customers tree) is a single leaf; it does not expand into the constituent small
  countries it absorbed.
- No new filter dimension is added to the global Filters drawer (no age filter, no ticket-source
  filter) — the two clicks that would need one navigate to a page instead (§6).
- No changes to `apiGetDashboardCD` itself or to any other tab that still consumes it.

## 9. Testing

- Unit tests (Jest, `loadGas` harness) for every pure SQL builder in `OverviewFlow.js`, following
  the `servicewrk-helpers.test.js` / `tom-helpers.test.js` pattern — specifically: the top-N-plus-
  Others ranking logic, the segment/country routing through `segmentGroupSql_`/`hub_country`, and
  the per-source outcome conditions for the Tickets tree.
- A unit test for the client-side flat-rows-to-tree nesting function, independent of any network
  call.
- Every headline root/level-1 total hand-verified against live BigQuery before deploy — same
  convention as every release this session (Service: 205/14.6%; TOM: 1,325/342/68).
- Live browser check on the `@HEAD` test deployment: tree renders, hover tooltip shows real numbers,
  expand/collapse works, and both click-through paths (filter-set and page-navigate) actually do
  what §6 says before the stable URL is touched.

## 10. Open items

None blocking. If real data reveals a level with too many distinct values to render legibly as a
tree (e.g. an unexpectedly high-cardinality device-type list), that's a rendering tweak (truncate/
scroll/collapse-by-default), not a design change.
