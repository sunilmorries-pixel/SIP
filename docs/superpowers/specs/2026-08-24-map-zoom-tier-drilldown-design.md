# Map Zoom-Tier Drill-Down (Country → State → City) — Design

Date: 2026-08-24
Status: approved (design); implementation plan not yet written

## 1. Problem

The Overview/CDM/Top Customers maps (all backed by the shared `MapView()` module in
`src/client/MapView.html`) show a binary country choropleth (has-center vs no-center,
`countryHasCenter_`) and a Leaflet marker-cluster of individual center pins. Per user
request, 2026-08-24: (a) the country layer should show an actual **count**, not a binary
flag; (b) zooming in should progressively reveal **state**, then **city** detail instead of
jumping straight from a country wash to a wall of individual pins; (c) the marker cluster
"looks clustered" — the default Leaflet.markercluster styling reads as visual clutter, not
a deliberate design; (d) the visible "(BRM 2026 review)" citation on the gray-area legend
note should be removed.

## 2. Design summary (one sentence)

Add a zoom-driven tier switch to `MapView()` — country choropleth (sequential ramp by
center count) at low zoom, a new proportional-circle layer by Indian state at mid zoom,
and the existing (restyled) marker-cluster/pins at high zoom — computed entirely
client-side from data the map already receives, plus a one-line text removal for the BRM
citation.

## 3. Scope decisions (user, 2026-08-24)

- **All three maps** (Overview, CDM, Top Customers) get the same tiered treatment.
- **Count metric: centers, everywhere** — one consistent metric across all three maps and
  all three tiers (not devices, not tickets; not a different metric per map).
- **District tier: dropped.** `center_details` has no district field anywhere (only
  pin/city/state/country), and there's no bundled district-boundary data. Tiers are
  country → state → city, not the four originally named.
- **BRM removal: text only.** The gray-area/FSE/CP layers stay exactly as they work today
  (they represent real coverage/roster data) — only the visible "(BRM 2026 review)"
  citation string is removed from `Index.html`'s gray-area legend note.
- **State layer: proportional circles at hand-authored centroids, not a boundary
  choropleth.** Same reasoning as the CP layer design (`2026-08-24-cp-dealer-layer-design.md`
  §3): the app has no India state boundary GeoJSON, and sourcing/trimming/licensing one is
  a separate, much larger asset problem than this feature warrants. A centroid table is
  the same lightweight pattern `GRAY_AREA_STATES` already uses, just complete (36 entries:
  28 states + 8 UTs) instead of the 7 "gray" ones.

## 4. Verified facts (from the current codebase)

- All three map payloads already carry `state` per center row — **no server change needed**:
  - `apiGetMapDataCD` (Overview): `CI.state = 11` (`src/client/App.html`).
  - `apiGetCdmDataCD` (CDM): `CDMI.state = 10`.
  - `computeTopCustomersCD_`'s `mapCenters` (Top Customers): index 11, same 12-element shape
    as `CI` minus `approx`. (No named index constant exists for this array today — one will
    be added, see §7.)
  - `lat`/`lng` are index 2/3 on all three shapes.
- `refreshCountryFill_(rows)` (`MapView.html:198`) already does bbox-prechecked
  point-in-polygon against the bundled `COUNTRY_GEOJSON_` (135 features) for every row, once
  per `setData()` call — today it sets a boolean per country; changing it to a running count
  is a small, contained edit to a function that already has the right shape and performance
  characteristics (bbox reject first, confirmed cheap at ~19k centers × 135 polygons).
  Country GeoJSON's licence is already flagged as "dubious?" in `docs/SOURCES.md` — this
  change doesn't touch that file or make the licence question worse or better.
  A per-country **country-code** field is not present on `COUNTRY_GEOJSON_`'s properties
  (only `name` is used today, per `countryStyle_`'s `feature.properties.name` lookup) — the
  new count logic keys off the same `name` property, no new lookup needed.
- `GRAY_AREA_STATES` (`MapView.html:148`) is the exact pattern to extend: `{name, lat, lng}`
  objects, no boundary data, client-side only.
- `ensureMap()` layer order today: `tileLayer` → `countryLayer` (non-interactive fill) →
  `cluster` (interactive). The new state-circle layer slots in the same position as
  `countryLayer` — non-interactive fill/circle layers below the interactive cluster.
- No `zoomend`/`moveend` listener exists on `map` today — this is new.
- `cluster = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 46,
  showCoverageOnHover: false, spiderfyOnMaxZoom: true })` — no `iconCreateFunction`, so it
  renders Leaflet.markercluster's built-in default icon (its own blue/yellow/orange
  count-bubble styling), which doesn't match the app's own palette or either theme — this is
  the concrete cause of "looks clustered."

## 5. Zoom tiers

Three tiers, driven by `map.getZoom()` on a new `map.on('zoomend', updateTier_)` (also run
once after `setData()`'s `fitBounds`, so the initial view starts in the right tier):

| Tier | Zoom | Visible |
|---|---|---|
| Country | ≤ 4 | Country choropleth (sequential ramp). State circles and cluster hidden. |
| State | 5–6 | State proportional circles (sequential ramp). Country fill and cluster hidden. |
| City | ≥ 7 | State circles hidden, country fill hidden. Cluster + individual pins shown (today's behavior, restyled per §6). |

These three ranges are a starting point tuned against the map's actual default view
(`setView([21.5, 79], 5)`, then `fitBounds` to the service region — landing around zoom
4–6 for this data today) — exact breakpoints will be adjusted visually during
implementation if a tier change reads as premature or delayed once real data is on screen.

`updateTier_()` just toggles `map.hasLayer(...)`/`addLayer`/`removeLayer` on the three
layer groups (`countryLayer`, a new `stateLayer`, `cluster`) — no data refetch, no
re-aggregation, since all three tiers' data is computed once per `setData()` call (§6) and
just shown/hidden by zoom.

## 6. Count aggregation & color ramp

**Country tier** — `refreshCountryFill_` changes from a boolean to a count:

```js
function refreshCountryFill_(rows) {
  if (!countryLayer) return;
  var counts = {};  // name -> count
  var features = COUNTRY_GEOJSON_.features;
  for (var i = 0; i < rows.length; i++) {
    var lat = rows[i][2], lng = rows[i][3];
    for (var j = 0; j < features.length; j++) {
      var f = features[j], name = f.properties.name;
      var b = f._bbox;
      if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng) continue;
      if (pointInGeometry_(f.geometry, lat, lng)) { counts[name] = (counts[name] || 0) + 1; break; }
    }
  }
  countryCounts_ = counts;
  countryLayer.setStyle(countryStyle_);
}
```

(The existing `continue`-on-already-true early-exit becomes a `break` out of the inner
loop once a point is assigned to a country — still one pass per point, same performance
class as today.)

**State tier** — new, much cheaper (no polygon test, just a lookup by the row's own
`state` field against the new centroid table):

```js
var counts = {};  // state name -> count
rows.forEach(function (c) { var s = c[stateIdx]; if (s) counts[s] = (counts[s] || 0) + 1; });
```

`stateIdx` is passed via `opts` to `setData()` (12 for Overview/Top-Customers-shaped rows,
10 for CDM), matching how `colorFn`/`tooltipFn` are already threaded through `opts` today.
Rows whose `state` isn't one of the 36 known names (typos, blank, non-India) simply don't
contribute to any circle — same silent-drop convention as an out-of-bbox country point
today. This is also where Top Customers' array gets its first named index constant
(`TCI`, mirroring `CI`/`CDMI` in `App.html`), rather than a bare-number index at the call
site.

**Color ramp** — one hue (the existing info-blue, `#2E9BD6`), 5 steps light→dark, assigned
by **log-scale quantile bucket** (not linear — India's raw count is ~50-90× the next
country, so a linear scale would flatten every other country to the palest step). Buckets
computed fresh each `setData()` from whatever's actually on screen (respects the global
filter), using `log(count + 1)` divided into 5 equal-width bins across the current min/max.
Zero-count entities get a **separate, fixed "no data" gray** (`COUNTRY_NO_CENTER_COLOR_`,
unchanged) — not part of the 5-step progression, standard choropleth convention. Exact hex
steps for the 5-bucket ramp will be generated and run through the dataviz skill's
`scripts/validate_palette.js` (colorblind-safe adjacent-step separation, contrast against
both basemaps) before being committed to code — not hand-picked by eye.

**State circles** — same 5-step ramp + gray "no data" (no circle drawn at all for
zero-count states, vs. a fill for zero-count countries — proportional-symbol maps
conventionally omit the symbol entirely rather than draw a zero-size one). Radius formula:
`radius = 6 + 14 * Math.sqrt(count / maxCount)` (area-proportional via `sqrt`, capped so
the largest state's circle stays visually reasonable at India-wide zoom; exact constants
tuned visually during implementation).

## 7. Legend changes

All three maps' existing "Country has centers / No centers" two-swatch legend
(`Index.html`, `.map-legend`) is replaced with:
- A small horizontal gradient swatch (5 steps) labeled "Fewer → More centers" (country/state
  tiers share one legend entry, since they share one ramp).
- A separate gray swatch labeled "No data" for zero-count entities.
- The existing per-pin ticket-severity legend (green/amber/red) is unchanged — that's the
  city-tier pin coloring, a different channel from the new area/circle ramp.

## 8. Cluster restyle ("looks clustered" fix)

`L.markerClusterGroup(...)` gains an `iconCreateFunction` returning a `divIcon` styled with
the app's own tokens instead of Leaflet.markercluster's built-in default (blue/yellow/orange
circles with a black count label): a single rounded pill using the same blue ramp family as
the choropleth (darker = more centers in that cluster, consistent visual language top to
bottom), theme-aware (dark/light), sized modestly by count (not the library default's
large-radius-jumps-by-threshold look). `maxClusterRadius`/`spiderfyOnMaxZoom` stay as-is
unless visual testing during implementation shows a need to retune them now that clustering
only has to carry the city tier's zoom range instead of every zoom level.

## 9. Files touched

- `src/client/MapView.html` — `refreshCountryFill_` (count instead of boolean),
  `countryStyle_` (ramp instead of binary), new `stateLayer`/`stateCounts_`/state-circle
  render function, new `INDIA_STATE_CENTROIDS_` constant (36 entries, extends
  `GRAY_AREA_STATES`'s pattern), new `updateTier_()` + `zoomend` listener, cluster
  `iconCreateFunction`, `setData()` gains a `stateIdx` opt.
- `src/client/App.html` — new `TCI` index constant for Top Customers' `mapCenters` array;
  `stateIdx` passed at all three `setData()` call sites.
- `src/client/Index.html` — legend markup replaced (ramp + no-data swatches) on all three
  maps' `.map-legend` blocks; "(BRM 2026 review)" removed from the gray-area legend note.
- `src/client/Styles.html` — small addition for the gradient-swatch legend element (a CSS
  `linear-gradient` background on a `.legend-ramp` span, no new colors needed beyond the 5
  ramp steps chosen in §6).
- No `src/server/*.js` changes.

## 10. Appendix: `INDIA_STATE_CENTROIDS_` (36 entries)

All 28 states + 8 union territories, approximate geographic centroids (public-domain
administrative geography — hand-authored the same way `GRAY_AREA_STATES` already is, not
extracted from any licensed dataset). The 7 existing `GRAY_AREA_STATES` entries keep their
current coordinates unchanged; this table is a superset.

```js
var INDIA_STATE_CENTROIDS_ = [
  { name: 'Andhra Pradesh', lat: 15.9129, lng: 79.7400 },
  { name: 'Arunachal Pradesh', lat: 28.2180, lng: 94.7278 },
  { name: 'Assam', lat: 26.2006, lng: 92.9376 },
  { name: 'Bihar', lat: 25.0961, lng: 85.3131 },
  { name: 'Chhattisgarh', lat: 21.2787, lng: 81.8661 },
  { name: 'Goa', lat: 15.2993, lng: 74.1240 },
  { name: 'Gujarat', lat: 22.2587, lng: 71.1924 },
  { name: 'Haryana', lat: 29.0588, lng: 76.0856 },
  { name: 'Himachal Pradesh', lat: 31.1048, lng: 77.1734 },
  { name: 'Jharkhand', lat: 23.6102, lng: 85.2799 },
  { name: 'Karnataka', lat: 15.3173, lng: 75.7139 },
  { name: 'Kerala', lat: 10.8505, lng: 76.2711 },
  { name: 'Madhya Pradesh', lat: 22.9734, lng: 78.6569 },
  { name: 'Maharashtra', lat: 19.7515, lng: 75.7139 },
  { name: 'Manipur', lat: 24.6637, lng: 93.9063 },
  { name: 'Meghalaya', lat: 25.4670, lng: 91.3662 },
  { name: 'Mizoram', lat: 23.1645, lng: 92.9376 },
  { name: 'Nagaland', lat: 26.1584, lng: 94.5624 },
  { name: 'Odisha', lat: 20.9517, lng: 85.0985 },
  { name: 'Punjab', lat: 31.1471, lng: 75.3412 },
  { name: 'Rajasthan', lat: 27.0238, lng: 74.2179 },
  { name: 'Sikkim', lat: 27.5330, lng: 88.5122 },
  { name: 'Tamil Nadu', lat: 11.1271, lng: 78.6569 },
  { name: 'Telangana', lat: 18.1124, lng: 79.0193 },
  { name: 'Tripura', lat: 23.9408, lng: 91.9882 },
  { name: 'Uttar Pradesh', lat: 26.8467, lng: 80.9462 },
  { name: 'Uttarakhand', lat: 30.0668, lng: 79.0193 },
  { name: 'West Bengal', lat: 22.9868, lng: 87.8550 },
  { name: 'Andaman & Nicobar Islands', lat: 11.7401, lng: 92.6586 },
  { name: 'Chandigarh', lat: 30.7333, lng: 76.7794 },
  { name: 'Dadra & Nagar Haveli and Daman & Diu', lat: 20.1809, lng: 73.0169 },
  { name: 'Delhi', lat: 28.7041, lng: 77.1025 },
  { name: 'Jammu & Kashmir', lat: 33.7782, lng: 76.5762 },
  { name: 'Ladakh', lat: 34.1526, lng: 77.5770 },
  { name: 'Lakshadweep', lat: 10.5667, lng: 72.6417 },
  { name: 'Puducherry', lat: 11.9416, lng: 79.8083 }
];
```

Matching against a row's `state` field is exact-name lookup (same trust-the-data convention
`countryHasCenter_` already uses for `feature.properties.name`) — no fuzzy matching. If real
data uses a spelling/abbreviation not in this list (e.g. "J&K" instead of "Jammu & Kashmir"),
those rows silently don't contribute to a circle, same as an unmatched country today; worth
a quick grep of actual distinct `state` values in `center_details` during implementation to
catch any real mismatch before shipping, rather than discovering it from a visually-empty
circle later.

## 11. Explicitly out of scope

- District tier (§3 — no backing data).
- Any change to the FSE/CP/gray-area layers themselves (§3 — BRM removal is text-only).
- A real India state boundary GeoJSON / choropleth fill for states (§3 — centroid circles
  instead, same call the CP layer design already made for the same reason).
- Country-level data beyond center count (e.g. device count) — deferred; see §3, one metric
  only for this round.
- Any new client-side test framework — client HTML has none today; verification is visual
  (§12), consistent with every prior map/chart change in this project.

## 12. Testing

- `npm test` must stay green (245 tests / 15 suites) — no server files change, so this is
  a regression check, not new coverage.
- Local preview + live check (same convention as the CP layer and country-shading work):
  visually confirm all three tiers render and switch cleanly on zoom in/out, on both themes,
  on all three maps; confirm the gray "no data" countries/states are visually distinct from
  the lightest ramp step; confirm cluster pills look like part of one design system rather
  than a different library's defaults; confirm the BRM citation text is gone from the
  gray-area legend and nothing else visible mentions BRM.
- Run `scripts/validate_palette.js` (dataviz skill) against the final 5-step ramp before
  committing the hex values, for both light and dark basemap surfaces.

## 13. Open items

- Exact zoom breakpoints (§5) and circle-radius constants (§6) are starting points, tuned
  visually during implementation once real data is on screen.
- Whether the state-tier should also render country fill faded-but-visible underneath (for
  geographic context) or fully hidden, as specified — can be revisited from a screenshot if
  fully-hidden reads as too stark a jump.
