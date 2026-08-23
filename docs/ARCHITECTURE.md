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

**@77/v5.48–@88 the renderer was a treemap** — `Charts.decompTreemap`, replacing `Charts.decompTree`.
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
shape is unchanged again, so `OverviewFlow.js` and the click handler were untouched — the renderer
still hands `opts.onNodeClick` the raw payload node by reference. The treemap was correct but was a
*mosaic*: no total flowing into parts and no connector anywhere on the card, which is what the user
asked to replace. The flow is one ECharts `custom` series with `coordinateSystem: 'none'`: a left
column of level-1 blocks, a right column of level-2 blocks, and one polygon ribbon per parent→child
relationship, every pixel computed inside `renderItem` from `api.getWidth()/getHeight()`. "Rectangle
area = share of the total" is therefore no longer the encoding: a row's height is a floor
(`ROW1_MIN`) plus an exactly-proportional share of the remaining free height, one scale for the left
column, and level 2 is normalised within its parent — compressed rather than ratio-true, which is
why every drawn block prints its own count and share and the tooltip prints both denominators. Read
the comment block above `flowPalette_` in `Charts.html` before changing any of it: it carries the
alignment argument (five arithmetic identities plus runtime postcondition checks), the measured
role-palette ΔE/contrast numbers, and the label-fitting ladder. Capacity is bounded by the card
height, so a folded tail is drawn as its own block sized by the tail's true sum, labelled with what
it stands for, listing its members in its tooltip, and clicking through to where they split out.

**Overview's map gained an FSE (Field Service Engineer) coverage layer at v5.54/@83–84**
(`src/server/Fse.js`) — pins for engineers from a hand-maintained roster (`FSE_ROSTER`, ships
empty until real names are pasted in — see the file's docblock), fanned to every center they've
worked a `servicewrk_Tickets` ticket for in a fixed 90-day rolling window
(`CONFIG.FSE_COVERAGE_DAYS`, deliberately independent of the global date filter — coverage means
"served now", not "served within whatever range is selected"). The `customer_id` → `CenterID`
join it relies on is the same one profiled for the center-detail drawer below. The map itself was
also fixed in the same pass to actually fit India's proportions rather than an arbitrary
bounding box.

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
