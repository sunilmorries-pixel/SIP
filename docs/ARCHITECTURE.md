# Architecture

## System overview

```
┌────────────────────┐        google.script.run         ┌─────────────────────────┐
│  Browser (client/) │ ───────────────────────────────► │  Apps Script (server/)  │
│                    │                                  │                         │
│  Index.html  shell │  ◄─── { ok, data | error } ───── │  Api.js     endpoints   │
│  Styles.html tokens│                                  │  BigQuery.js runner     │
│  Charts.html viz   │                                  │  Queries.js  SQL        │
│  App.html    state │                                  │  Auth.js     SA OAuth   │
└────────────────────┘                                  └───────────┬─────────────┘
                                                                    │ UrlFetchApp.fetchAll
                                                                    │ (parallel, Bearer token)
                                                        ┌───────────▼─────────────┐
                                                        │  BigQuery REST API      │
                                                        │  tricogde-dwh           │
                                                        │  abi_tables             │
                                                        └─────────────────────────┘
```

## Pages

Overview · Asset · **CDM** (Communicator Device Management, new v5.33 — `cloud_devices`,
battery/signal/hardware-mix) · Centers · Customers (Top Customers) · Support/CS · **Service**
(new v5.29 — `servicewrk_Tickets`) · **TOM** (new v5.30 — `tom_tickets`) · Numbers · Raw Data.
Every page now has a real data source — there are no "not yet connected" placeholder cards left.

**Overview was rebuilt as 3 decomposition trees as of v5.38/@67** (Customers, Devices, Tickets),
replacing the old always-static exec-summary cards. The decomposition is pure-JS aggregation over
one combined endpoint (`apiGetOverviewFlowCD`, `src/server/OverviewFlow.js`). The visual layout
churned across several same-week releases — TB orientation → depth-colored/sized nodes → briefly
replaced with a Sankey diagram (v5.44/@73) → reverted back to trees per user feedback (v5.46/@75)
→ LR orientation with a depth-based color ramp (@76/v5.47). See `HANDOFF.md`'s v5.38–v5.47 entries
for the full sequence and the reasoning behind each layout change before "fixing" any perceived
layout issue — several apparent bugs there were already tried, measured against real production
data, and deliberately reverted once.

**@78/v5.49–@89 the renderer was a treemap** — `Charts.decompTreemap`, replacing
`Charts.decompTree`. (It was authored for @77/v5.48 but stashed out of that deploy, so @78 is where
it first shipped, and @89 still shipped it — `HANDOFF.md` closing item 26 derives both ends from
the code rather than from a version list.)
That ended the layout churn above rather than continuing it: the `tree` series laid out by topology,
drawing every node at a fixed 88×52 / 70×48 box whatever its count, so magnitude existed only as
label text and same-depth siblings split one span whether a branch held 3% or 65% of its parent. Six
passes (@69–@76 plus `c977a00`) each moved the resulting label collision instead of removing it.
Rectangles that partition their parent by share cannot collide, so the page dropped from 2,436px to
~1,365px and label clipping went away structurally. (`c977a00`, 72px leaf slots, is **superseded and
was never deployed** — it fixed a renderer that no longer exists.)

**As of @90 the renderer is a hand-laid FLOW, not a treemap** — `Charts.decompFlow`
(`src/client/Charts.html`), replacing `Charts.decompTreemap`, which is deleted along with
`decompPalette_`, `decompTileLabel_`, `decompPrepLevel1_` and the 5% `DECOMP_COLLAPSE_SHARE` fold
(`decompEsc_` and `decompShare_` survive and now serve the flow's labels and tooltip). The payload
shape is unchanged again, so `OverviewFlow.js` was untouched. The treemap was correct but was a
*mosaic*: no total flowing into parts and no connector anywhere on the card, which is what the user
asked to replace. The flow is one ECharts `custom` series with `coordinateSystem: 'none'`, every
pixel computed inside `renderItem` from `api.getWidth()/getHeight()`.

**@90–@111 it ran left-to-right** (a left column of level-1 blocks, a right column of level-2
blocks, one ribbon per parent→child relationship crossing a horizontal gutter). **As of @112–@113
it runs top-to-bottom** (per user, 2026-08-25 — first a full re-orientation to a level-1 band
across the top and a level-2 band across the bottom, then a same-day follow-up correction once it
shipped as one continuous strip: each level-1 block's own children were already confined to that
block's own x-span — they never overlapped a neighbor's — but the gap between them (`GAP_OUT`) was
too small to actually READ as separate branches. Bumping `GAP_OUT` from 4px to 14px, while the
much smaller `GAP_IN` (2px, within one cluster) stayed put, is what makes the level-2 row read as
distinct **subbranches** per parent instead of one strip — see `FLOW`'s own comment in
`Charts.html` for the full argument). The click-through described two paragraphs down predates
both changes and no longer applies (see the read-only note below) — orientation only changed which
axis carries value and which is fixed, not what the renderer does with a click.

Blocks sit side by side WITHIN a band now, so the value-proportional dimension is **width**, not
height — text still reads left-to-right as ever, which is what let `flowFitLabel_` carry over
unchanged: it always took "available width" as a parameter, that parameter is just each block's
own drawn width now instead of one constant shared by a whole column. "Rectangle area = share of
the total" is not the encoding either way: a block's width is a floor (`BLOCK1_MIN`/`BLOCK2_MIN`)
plus an exactly-proportional share of the remaining free width, one scale for the whole top band,
and level 2 is normalised within its parent — compressed rather than ratio-true, which is why every
drawn block prints its own count and share and the tooltip prints both denominators. Read the
comment block above `flowPalette_` in `Charts.html` before changing any of it: it carries the
alignment argument (five arithmetic identities plus runtime postcondition checks), the measured
role-palette ΔE/contrast numbers, and the label-fitting ladder. Capacity is bounded by the card
WIDTH now (`.chart-flow`'s min-height grew from 340px to 480px at @112 to give the vertical gutter
room to read as a flow — the two bands themselves stay small fixed strips), so a folded tail is
drawn as its own block sized by the tail's true sum, labelled with what it stands for, listing its
members in its tooltip, and clicking through to where they split out — wait, no: as of @108 (see
below) a folded tail's tooltip still enumerates its members, but nothing on the card clicks through
any more.

**The flow is read-only as of @108/2026-08-25** — clicking a block used to hand its node to
`handleTreeNodeClick_`, which set global filters or switched tabs; that handler, `flowClickable_`
and the tooltip's "Click to filter…" lines all went with it, so nothing on the card offers an
action it no longer performs. `.chart-flow canvas { cursor: default }` in `Styles.html` corrects
the one visible remnant (zrender defaults every custom-series mark to `cursor: pointer` and ignores
a `cursor` element option, so the canvas kept advertising a click with no code change). Marks stay
hoverable — the tooltip is the entire interaction now.

## The map — one factory, three instances

`src/client/MapView.html` is a single factory, `MapView(containerId)`, instantiated three times in
`App.html`: `assetMap` (Overview, merged in from the old Map tab at @79/v5.50), `tcMap` (Top
Customers) and `cdmMap` (CDM). The scoping rule matters when editing it: anything declared inside
`function MapView(...)` is per-instance (the Leaflet map, the marker cluster, the country layer,
the FSE/CP layer state), and anything at `<script>` top level is shared by all three
(`COUNTRY_GEOJSON_` and its precomputed bboxes, the point-in-polygon helpers, the two fill
colours). The returned handle is the whole public surface — `ensureMap`, `setData`, `focusByName`,
`setTheme`, the FSE entry points (`setFse`/`focusFse`/`focusFseByName`/`clearFseFocus`/
`setFseVisible`), and the CP ones (`setCp`/`focusCp`/`clearCpFocus`/`setCpVisible`). A page that
needs different marker semantics passes `opts.colorFn`/`opts.tooltipFn` into `setData` instead of
forking the factory. `ticketColor(n)` (top-level in `MapView.html`, moved there @107 so `App.html`
can call it directly for its own overrides — it used to be a private closure inside
`MapView(containerId)`) is the shared 0/1-3/4+ green/amber/red bucketer every map's markers run
through; `setData`'s own default is `colorFn: c => ticketColor(c[6])`, and **CDM is the one map
that still uses that default** — its row shape puts low-battery count at index 6, so nothing there
changed. Overview and Top Customers now both pass an explicit override, `ticketColor(c[maxOpenAgeDays
index])` (@107, `CI.maxOpenAgeDays` / `TCI.maxOpenAgeDays`) — colored by the **oldest open ticket's
age in days** at that center, not by open-ticket count as before the same thresholds bucketed
count. Overview's map click-to-filter buckets and both maps' legends/tooltips were updated to match
(a clicked bucket now filters by age, and the tooltip states the oldest ticket's age so the color
has a visible reason).

**CDM's map footprint (@106).** `apiGetCdmDataCD` used to plot every `center_details` center
passing the global filters, regardless of whether that center had any `cloud_devices` telemetry at
all. A `cdmCenterIds` query (`buildCdmQuerySpecs`, `Queries.js`) now intersects the plotted set
with centers `cloud_devices` actually reports on, so the CDM map's footprint matches what the page
is actually about instead of the full center universe.

(The static zero-coverage "gray-area" marker layer — `GRAY_AREA_STATES`, `showGrayAreas` — that
used to live here was removed 2026-08-25 per user request. It was a real, if minor, case study in
the version-race problem this project has hit more than once: it shipped on the deploy `5dbb1d3`
bumped for, which landed as `@92` while its embedded footer still read '91' (a concurrent session
consumed 91 between `clasp push` and `clasp deploy`), and `e693a78` corrected `APP_VERSION`
forward. **Take the live version from `src/server/Config.js` (`APP_VERSION`/`APP_DEPLOYED_AT`),
never from a hard-coded @N in a doc** — that lesson outlives the feature that taught it.)

**Country + state shading (v5.59/@88, attribute-matched + state-outline rework @114).** The
basemap tiles are a flat raster image — there is no polygon in them to recolour — so the app
ships its own bundled polygon layers for both tiers. `COUNTRY_GEOJSON_` is one module-level
literal of 135 country features (116 Polygon / 19 MultiPolygon, 6,683 coordinate pairs rounded to
3 decimals); `INDIA_STATE_GEOJSON_` (added @114, replacing the old proportional-circle layer) is a
second literal of 36 India state/union-territory features from geoBoundaries, simplified with
`mapshaper` so adjacent states share borders with no gaps. Provenance and licence for both live in
`docs/SOURCES.md` → *Hand-maintained catalogs in source*; read that before re-sourcing or
extending either set. Both are Leaflet `interactive: true` `L.geoJSON` layers with a `bindTooltip`
per feature (name + live center count) — sitting in the overlay pane, below the marker pane, so
hovering them never blocks clicking a marker on top.

Matching switched from geometry to attributes at @114: `refreshCountryFill_(rows, countryIdx)` and
`refreshStateFill_(rows, stateIdx)` both run once per `setData()` (not per frame), tallying each
row's own `country`/`state` field into a name→count map and repainting with one `setStyle()` call
plus a `setTooltipContent()` per feature. This replaced the previous point-in-polygon approach
(`pointInGeometry_`/`pointInRing_`, an even-odd ray cast against a precomputed per-feature `_bbox`)
— country highlighting now keys off `hub_country` (via `EditionCD.js`'s `row.country`, index 14 on
the main/Top-Customers map payloads and index 11 on CDM's) exactly like state already keyed off
`state`, rather than depending on a center's lat/lng happening to land inside the right polygon.
Fill is `#2E9BD6` at 0.22 for "has a center" and `#869AB2` at 0.16 for "no center" — **one pair for
both themes and both tiers** — and the near-equal alphas are deliberate: a much fainter "no center"
wash just blended into the basemap.

**Zoom-driven country → state → city tiers (@98–@103, state tier reworked @114).** `updateTier_()`
(`MapView.html`) reads the map's current zoom on load and on every `zoomend`. At zoom ≤
`MAP_TIER_COUNTRY_MAX_` (4, "country" tier) only `countryLayer` shows. Between 5 and
`MAP_TIER_STATE_MAX_` (6, "state" tier) **both layers show together**: `countryLayer` stays visible
for every country except India (whose own polygon `countryStyle_` renders fully transparent at
this tier, tracked via a module-level `currentTier_`), while `stateLayer` draws India's own states
on top of it — added to the map after `countryLayer` each time, so it wins the Leaflet DOM/z-order
without an explicit `bringToFront()`. Above that is city tier: neither layer shows, just the
individual center pins/marker cluster. **The cluster is never actually hidden** at any tier — an
early version of `updateTier_()` removed it at the country and state tiers too, which (since
`fitBounds` for this data naturally lands around zoom 5) hid every real customer pin by default and
was the exact production regression a user reported as "I can't see my customers in the map"; the
fix keeps `cluster` always on the map and treats the country/state layers as additive context. The
country layer itself went through a **count-shaded 5-step sequential ramp** (@98–@102, replacing
the older binary has-center/no-center fill, validated with the dataviz skill's
`validate_palette.js`) and was then **reverted back to the binary fill** at @103 per user — read
that as the current, shipped state, not the ramp; `d29b22d`'s commit message and `HANDOFF.md` carry
the reasoning if the ramp is ever revisited. `stateIdx`/`countryIdx` (the row indices carrying a
center's `State`/`country`) are threaded through all three `setData()` call sites, via `CI`/`TCI`/
`CDMI` index constants (`App.html`) — Top Customers' and CDM's previously-unnamed/partial map-row
array shapes both gained a `country` index at @114 to match.

**Region-bounded auto-fit (v5.58/@87).** `SERVICE_REGION_BOUNDS_` (lat −12..40, lng −5..130) exists
because `fitBounds` used to fit *every* plotted center, so one bad geocode in the Americas or
central Europe zoomed the whole view out. It is declared inside the factory and consumed by the
shared `setData`, so **all three maps get it**, not just Overview (both server row shapes keep
lat/lng at indices [2]/[3] — `EditionCD.js`). The distinction to preserve when touching this code
is **view vs rendering**: markers are built and added from the *unfiltered* array, so every center
still renders, still clusters, still carries its tooltip and click handler, and is still reachable
via `focusByName` (which does its own `setView`); the filter is applied afterwards and only to the
`fitBounds` input. If no center qualifies, the fit falls back to all of them; if there are no
centers at all, `fitBounds` is skipped and the initial `setView([21.5, 79], 5)` stands. Note the
deliberate disagreement with the layer above: `refreshCountryFill_` is passed the *unfiltered*
array, so an out-of-region bad geocode still shades whichever bundled country contains it even
though it no longer drags the viewport — and a bad geocode west of lng −25 shades nothing at all,
because the bundle stops there.

**Sizing (v5.57/@86).** `#assetMap, #tcMap, #cdmMap` share one rule in `Styles.html`
(`width: 100%; height: 72vh; min-height: 480px`); the *only* override is
`#assetMap { height: 85vh; min-height: 620px; }`, so Overview's map differs from the other two in
height alone — width, background and z-index are identical. Two attempts on 2026-08-23 to square
the box up to India's near-square bbox were reverted here: the first kept full width and drove
height from width (`aspect-ratio: 1/1` capped by `max-height: min(76vh, 900px)`, which always
bound first, so the box stayed roughly 2:1), the second capped the width itself to
`min(100%, 82vh, 900px)` and centred it with gutters, adding a matching `.map-wrap:has(#assetMap)`
rule so the absolutely-positioned legend stayed flush with the narrowed map. Per user, both read
as the map shrinking rather than as "sized to fit India" — the ask was to *expand* the box. Read
the comment above the `#assetMap` rule before changing it. One known caveat: no responsive block
overrides map height, so the 620px floor applies at every breakpoint — on a short phone viewport
the Overview map is taller than the screen.

**Two coverage layers, computed vs declared.** Both draw pins plus a focus fan on the Overview
map and both are hand-maintained catalogs in source (see `docs/SOURCES.md`), but they are
architecturally different. **Both default to hidden as of @107** (`state.fseVisible`/
`state.cpVisible` now start `false`, per user — "by default in map I only want to see my
customer") — the server still computes and sends both layers every load (same payload/cache key
as always), this is a client-side visibility toggle only: `setFseVisible`/`setCpVisible`
(`MapView.html`) just add/remove the already-built Leaflet layer group from the map, so turning a
layer on is instant, with no round trip:

- **FSE — computed** (`src/server/Fse.js`, v5.54/@83–84). `FSE_ROSTER` supplies the engineers;
  coverage is *derived* from `servicewrk_Tickets` — an engineer is fanned to every center they
  have worked a ticket for within a fixed 90-day rolling window (`CONFIG.FSE_COVERAGE_DAYS`,
  deliberately independent of the global date filter: coverage means "served now", not "served
  within whatever range is selected"). That requires a query (`buildFseCoverageSpec_`) and a name
  reconciliation against the free-text `representative` column via `fseNameKey_`; ticket names
  that match no roster row are surfaced as `unmatchedReps` rather than swallowed. The fan is drawn
  only to centers the current filter actually plotted (`plottedIds`), so it can never point at a
  marker that isn't there. The `customer_id` → `CenterID` join it relies on is the same one
  profiled for the center-detail drawer below.
- **CP — declared** (`src/server/Cp.js`, v5.60/@89). No field anywhere in the warehouse names a
  Channel Partner, so coverage cannot be computed at all: `CP_ROSTER` carries each dealer's
  declared districts/cities directly. Hence no coverage query, no name reconciliation and no
  unmatched bucket — `buildCpLayer_` only resolves coordinates, and every coordinate in the roster
  is explicit, so the coord functions are pass-throughs. Focus mode draws its own endpoint dots
  instead of restyling center markers (a covered district is not necessarily a center).

Both layers ride the same map payload and cache key (`mapcd_v16_<epoch>_<filterHash>` in
`EditionCD.js`, 30-min TTL) and both are guarded on a non-empty roster, so emptying a catalog
sends `fse: null` / `cp: null` — no layer, rather than an empty one. That guard was load-bearing
for FSE: `FSE_ROSTER` shipped **empty from @83/@84 through @88**, so production drew no engineer
pins for six deploys even though the docs described the layer as live; real rows arrived in
`78ed2f8` and shipped @89. The cache key hashes neither roster, so a roster edit can serve a stale
layer until the entry expires or the cache epoch moves — see *Editing one of these* in
`docs/SOURCES.md`.

## Center-detail drawer

The shared drawer (`makeCenterDetail` in `App.html`, backed by `apiGetCenterDetailCD` →
`buildCenterDetailSpecs` in `Queries.js`) shows **two independent ticket sources**, each with its
own toggle group, added incrementally and kept in separate `data-*` namespaces so their click
handlers can't cross-wire:

- **Zoho** (`data-tix`): Open / All / **Swapped** (added v5.55/@84 — every ticket
  counted by Center-360's `swapped` column, `IssueCategory LIKE '%swap%'`, which previously had
  no drill-down list of its own).
- **Service** (`data-svctix`, new v5.55/@84): Open / Closed / **Swapped** (`service_type LIKE
  '%swap%'`, same convention, over ServiceWRK's own category column) — sourced from
  `servicewrk_Tickets` via the `customer_id` → `CenterID` join (see `docs/SOURCES.md`), verified
  at 87.7% coverage on 2026-08-23. Swapped is all-time and can overlap Open/Closed for both
  sources, same as the Center-360 column it mirrors — it isn't a third disjoint bucket.

Both toggle groups share the `.ticket-toggle-btn` class for styling but are queried by their
distinct data attribute (`[data-tix]` vs `[data-svctix]`) when binding click handlers, not by the
bare class — both groups now render a button whose visible text can be identical (`Swapped (N)`
appears in each), so a generic class-only click listener would bind to whichever group's DOM
order won and stomp the other's state variable. Verified in the browser that the two toggles are
fully independent (clicking one never changes the other's active tab).

## Data sources

See `docs/SOURCES.md` for the full source-of-truth table. Summary of current roles:

| Source | Rows | Role in the dashboard |
|---|---|---|
| `center_details` (BQ) | ~35.8k rows / 27,410 distinct centers (dup rows per center; no F2P-exclusion — full universe) | **Sole center source** — counts, uptime/MTBF/health, geo, deployment age. Country filter derives from `hub_country` (switched from `Spoke_Country`, v5.33 — see docs/SOURCES.md) |
| `jira_data` (BQ) | ~49.9k rows / ~45.4k distinct devices (changelog grain, `GROUP BY issue_key`) | **Devices/fleet count, asset lifecycle, cohort/FTF analysis**; serial (from `summary`) → center via `cloud_devices`/`center_details` |
| `cloud_devices` (BQ) | ~11.3k | Serial→center bridge, and the CDM page — its only user-facing surface since 2026-08-19 (device-status donut/firmware spread/device explorer on Asset were removed; that telemetry is now CDM/Numbers/Raw-Data only) |
| `zoho_data` (BQ) | ~80k (post-dedup + unassigned-ticket exclusion, v5.22/v5.23) | Support tickets, SLA compliance, uptime-downtime proxy. `CreatedAt`/`ClosedAt` are native DATETIME in production (not strings, despite the sandbox — a live-crashing assumption fixed in the v5.24 hotfix) |
| `device_metrics` (BQ) | dup rows | Reliability watchlist — deduped with `GROUP BY deviceid` |
| `device_center_mapping` (BQ) | — | **Retired as a user-facing source** (legacy serial-linking only, read internally by `Geo.js` history) |
| `tom_tickets` (BQ) | 1,325 rows | **TOM page** (v5.30) — CS issue tracker. Centre + date filter only; page framing is an unconfirmed inference (see docs/SOURCES.md) |
| `servicewrk_Tickets` (BQ) | ~36.4k rows | **Service page** (v5.29) — field-service tickets. Deliberately NOT wired into the Machine Uptime KPI (data-quality reasons, see docs/SOURCES.md) — that stays on the `zoho_data` proxy |

**No Google Sheets remain as data sources.** The CS/Service tracker Sheet was removed
2026-07-29 (TAT/machine/issue-type/owner panels on Support/CS, plus Overview's field-TAT KPI —
no replacement, those panels are gone; the Sheets API was disabled on the GCP project, so it
was already failing in production and there was no BigQuery equivalent to fall back to). The
Jira devices Sheet was removed 2026-07-30 — same underlying problem (Sheets API disabled), but
this one *did* have a BigQuery equivalent (`jira_data`, confirmed live and actively loaded —
most recent row 2 days old at the time of the switch — so it replaced the Sheet directly, with
no functionality lost). `SheetSource.js`, `JiraDump.js`, and the `spreadsheets.readonly` OAuth
scope were all deleted as a result.

**v5.2:** the devices/fleet count excludes Jira housekeeping ticket types (Task, Epic, Test —
`CONFIG.JIRA_NON_DEVICE_TYPES`, applied in `jiraDeviceStats_()` via `isTrackedJiraDeviceType_()`)
— true regardless of which underlying source (Sheet, then `jira_data`) has fed it over time.
This was widened from an earlier Connector+ECG-Machine-only restriction on 2026-07-30, once
the fuller `jira_data` breakdown showed that filter was excluding real device categories (SIM
Card, UPS, Printer, BP Machine, Tab, Mobile, IV Trolley, Laptop, WiFi Dongle, TriCare Assets).
A **Raw Data** view (`src/server/RawData.js`) exposes all 4 sources unfiltered, paginated,
with full-table CSV export. `swap` tickets are now classified as technical in
`TECH_FALLBACK_REGEX`. The Overview's fleet donut is a Jira lifecycle-status donut
(`Charts.jiraStatus()`).

## Key design decisions

### 1. One payload, parallel queries
`apiGetDashboardCD()` fans ~14 aggregate queries out through `UrlFetchApp.fetchAll`,
so total latency ≈ the slowest single query rather than the sum. One failed panel
returns `null` and the UI shows an empty state for that card only — a single bad
query never sinks the whole dashboard.

### 2. Aggregate on BigQuery, not in Apps Script
Every chart is fed by a `GROUP BY` that returns ≤ a few dozen rows. Raw rows only
ever leave BigQuery for the device explorer, which is paginated server-side
(`LIMIT @limit OFFSET @offset` + `COUNT(*) OVER()` for total).

### 3. Caching
Every filter-aware endpoint (`apiGetDashboardCD`, `apiGetMapDataCD`, `apiGetTopCustomersCD`,
`apiGetCenterDetailCD`, …) keys its `CacheService`/large-cache entry on a version tag
(bumped often as filters/queries change — check the current value in-code rather than trusting
a specific tag quoted here) + the current cache epoch (`getCacheEpoch_()`, a counter in Script
Properties) + a hash of the active filter set (`filterHash_(filters)` — 11 dimensions as of
v5.53/@82: Segment/Status/State/Hub/City/Country/Center (7 as of v5.33) plus
Billable/MachineTypes/DeviceIds/MacSerialIds (added @82, all sourced from `center_details`),
up from the original 4) — e.g.
`dashcd_v<N>_<epoch>_<filterHash>_<hub>`. `clearDashboardCache()` in `Setup.js` bumps
`CACHE_EPOCH` by one, instantly invalidating every existing filtered variant at once
instead of enumerating segment values one by one; the handful of caches that don't vary
by filter (Center-360 base fetch, Numbers, raw-sheet snapshots) are removed directly.
TTL is `CONFIG.CACHE_TTL_SECONDS` (900s / 15 min) for the main dashboard payload, and 1800s
for the larger shared caches (Center-360, map) — both longer than `Warm.js`'s 10-minute
warm-trigger interval, so a warmed value never expires before the next warm pass. The
Refresh button passes `bypassCache: true`.

### 4. Injection safety
- Untrusted values (search text, hub, status, paging) → **named query parameters**.
- Sort column/direction → validated against a whitelist map (`CDM_SORT_COLUMNS`, `CENTER_SORT_KEYS`, …).

### 4b. Joins happen in Apps Script, not SQL
All BigQuery statements are single-table reads. Multi-source views (Center-360,
Sheet ⋈ BQ enrichment) are built by hash-joining pre-aggregated result sets in
`server/Join.js`, with results cached via the chunked large-cache in
`server/BigQuery.js`. See docs/SOURCES.md → "Where joins happen".

### 5. Fleet status buckets
A single shared CASE expression (`FLEET_BUCKET_SQL`) defines heartbeat buckets
(Live <1h → Never seen). The same strings drive the donut, the status chips and
the explorer filter, so a donut-slice click can filter the table 1:1.
Timestamps at epoch (1970) are treated as "Never seen".

### 6. Frontend without a framework
Apps Script HTML-service pages ship as one document; a build step would add
friction for little gain at this size. Discipline instead comes from file
separation (shell / tokens / charts / state) and a small set of conventions:
- all server calls promisified through `gsCall()`,
- all chart configs in `Charts`, staged and applied lazily (hidden tab panels
  have zero size, so options are flushed when a tab becomes visible),
- mock fallback when `google` is undefined → the UI previews locally.

### 7. Design system
Tokens in `Styles.html` are **Tricog-branded** (rebranded v3.0): deep-navy surfaces
(`--bg-0 #04182C`), **red primary** `--primary #E5344F` (brand/CTA/active nav),
blue `--secondary #2E9BD6` + teal `--accent #04E0B8` for data viz, semantic status
colors, **Lato** for headings and body (tabular nums for numerals). Full light + dark
themes; motion tokens + entrance/hover animations respect `prefers-reduced-motion`.
(Note: `design-system/sip-insights/MASTER.md` was the original pre-rebrand brief — the
shipped tokens in `Styles.html` are the source of truth.)

## Request lifecycles

**Dashboard load**
1. `App.init()` → skeletons on, `gsCall(ep('apiGetDashboard'), {filters, bypassCache})` (`ep()` appends `CD` — the live edition)
2. `apiGetDashboardCD` → cache hit (epoch + filterHash key)? return : build specs → `runQueriesParallel`
3. Client renders KPIs (count-up), stages chart options, flushes visible ones.

**Communicator explorer (CDM)**
1. Search input (debounced 400ms) / sort / page → `gsCall('apiGetCdmDevices', query)`
2. Stale responses are dropped via a request-id guard (`cdmDevicesRequestId`).
   (The Asset page's own device explorer over `cloud_devices` — same shape, minus
   Latency/Retries/SpaceAvailable/EcgCounter/hardware-version — was removed 2026-08-19; that
   telemetry is CDM/Numbers/Raw-Data only now.)

**Auto-refresh**
1-second countdown ticker; at zero → `loadDashboard(bypassCache=true)` + `loadCenters()`.
Toggle state persists in `localStorage`.

## Extending

- **New chart**: add a query spec in `Queries.js` → add a builder in `Charts.html`
  → add a card in `Index.html` → wire it in `renderDashboard()`.
- **New filter**: add a named parameter to the relevant specs, thread it through
  `apiGetDashboardCD(options)` (and the sibling `*CD` endpoints), include it in the cache key
  (`filterHash_`).
- **Per-page design overrides**: create `design-system/sip-insights/pages/<page>.md`;
  it takes precedence over MASTER.md (see design-system README section in MASTER).
