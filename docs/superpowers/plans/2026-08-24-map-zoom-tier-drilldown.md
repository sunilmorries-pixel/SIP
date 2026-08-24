# Map Zoom-Tier Drill-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Overview/CDM/Top Customers maps' binary country shading with a
zoom-driven three-tier drill-down (country choropleth by count → state proportional
circles by count → existing marker-cluster/pins, restyled), plus remove the visible
"BRM 2026 review" citation text from the gray-area legend.

**Architecture:** Everything is client-side, in the shared `MapView()` module
(`src/client/MapView.html`) that already backs all three map instances. All three map
payloads already carry a `state` field per center row, so no server changes are needed —
country/state counts are aggregated from data the map already receives, on every
`setData()` call (which already re-runs on every filter change), and a `zoomend` listener
toggles which of the three tiers is visible.

**Tech Stack:** Vanilla ES5 (no arrow functions/`let`/`const`), Leaflet + Leaflet.markercluster
(already loaded), the project's `dataviz` skill's palette validator for the new color ramp.

**Spec:** `docs/superpowers/specs/2026-08-24-map-zoom-tier-drilldown-design.md`

## Global Constraints

- ES5 only — zero arrow functions, `let`, `const`, template literals, or classes anywhere
  in `src/` (verified convention, checked across all client files today).
- No `src/server/*.js` changes — every server payload already carries what this feature
  needs (spec §4).
- Count metric is **centers**, everywhere, all three tiers (spec §3) — never devices,
  never tickets.
- Color ramp: one hue (blue family), 5 steps + one separate fixed "no data" gray, chosen by
  running `scripts/validate_palette.js` (dataviz skill) — never hand-picked without running
  the validator (spec §6).
- Zoom tiers: country ≤ 4, state 5–6, city ≥ 7 (spec §5) — starting values, tunable visually
  during implementation, but land on these initial numbers.
- `npm test` must stay green (245 tests / 15 suites) after every task — this is a
  regression check (no server files change), not new coverage.
- No new client-side test framework — verification for every task is a visual check (local
  preview + `npm test` regression), per spec §12.

---

## File Structure

| File | Responsibility in this plan |
|---|---|
| `src/client/MapView.html` | All new logic: ramp constants + bucket function, count aggregation (country + state), state-circle layer, zoom-tier switching, cluster `iconCreateFunction`. |
| `src/client/App.html` | New `TCI` index constant for Top Customers' center-row array; `stateIdx` threaded into all three `setData()` call sites. |
| `src/client/Index.html` | Legend markup (all three maps) replaced; BRM citation text removed. |
| `src/client/Styles.html` | New `.legend-ramp` gradient swatch; new `.center-cluster` icon styling; removal of the old blunt `.marker-cluster-small/medium/large` override it replaces. |

No new files.

---

### Task 1: Color ramp — generate, validate, land as constants

**Files:**
- Modify: `src/client/MapView.html:70-71` (replace `COUNTRY_HAS_CENTER_COLOR_`/`COUNTRY_NO_CENTER_COLOR_`)

**Interfaces:**
- Produces: `MAP_RAMP_COLORS_` (array of 5 hex strings, index 0 = fewest centers, index 4 =
  most), `MAP_NO_DATA_COLOR_` (single hex string), `rampBucket_(count, maxCount)` (pure
  function: returns `-1` for `count <= 0` — "no data" — else an integer `0..4` bucket index,
  using a log scale so one dominant region — e.g. India — doesn't flatten every other
  region to the palest step). All three are consumed by Task 2 (country), Task 3 (state),
  and Task 5 (cluster icons).

- [ ] **Step 1: Load the dataviz skill and get the validator's current path**

Invoke the `dataviz` skill (via the Skill tool, `skill: "dataviz"`) if it is not already
loaded this session. Its response names this skill instance's base directory — the
validator script is at `<that base directory>/scripts/validate_palette.js`. Use that
resolved path in the next step (do not guess or hardcode a path from a different session).

- [ ] **Step 2: Run the validator against the starting candidate ramp**

Candidate 5-step ramp (light → dark, one hue, reusing the app's existing brand blue
`#2E9BD6` as a mid-step):

```
#CFE8F5,#9BCBE4,#5BA9D0,#2E9BD6,#124A67
```

Run (from the skill's base directory, adjust the path to Step 1's resolved location):

```bash
node scripts/validate_palette.js "#CFE8F5,#9BCBE4,#5BA9D0,#2E9BD6,#124A67" --mode light
node scripts/validate_palette.js "#CFE8F5,#9BCBE4,#5BA9D0,#2E9BD6,#124A67" --mode dark
```

Read the pass/fail report (adjacent-step separation, contrast against the surface). If
anything FAILs, adjust the failing step(s) toward more separation/contrast and re-run until
both modes pass. Record the final 5 hex values that pass both runs.

- [ ] **Step 3: Land the constants in MapView.html**

Replace lines 70-71:

```js
var COUNTRY_HAS_CENTER_COLOR_ = '#2E9BD6';  // existing info-blue accent (.btn-ghost:hover)
var COUNTRY_NO_CENTER_COLOR_ = '#869AB2';   // --text-3, the app's existing muted tone
```

with (the array below shows the Step 2 starting candidate — if the validator run required
adjusting any step to pass, use those adjusted hex values here instead of the candidate
shown):

```js
// 5-step sequential ramp (light -> dark), one hue, validated against both basemap
// surfaces via dataviz skill's scripts/validate_palette.js (see git history for the
// validator run). Index 0 = fewest centers, index 4 = most.
var MAP_RAMP_COLORS_ = ['#CFE8F5', '#9BCBE4', '#5BA9D0', '#2E9BD6', '#124A67'];
// Fixed "no data" tone, separate from the 5-step progression (standard choropleth
// convention) — same value as the old COUNTRY_NO_CENTER_COLOR_ it replaces.
var MAP_NO_DATA_COLOR_ = '#869AB2';

/**
 * Buckets a count into one of MAP_RAMP_COLORS_'s 5 steps, or -1 ("no data") for a
 * non-positive count. Log-scaled against the current render's own max so one dominant
 * region (e.g. India) doesn't flatten every other region to the palest step.
 * @param {number} count
 * @param {number} maxCount
 * @return {number} -1..4
 */
function rampBucket_(count, maxCount) {
  if (!count || count <= 0) return -1;
  if (!maxCount || maxCount <= 1) return 0;
  var t = Math.log(count + 1) / Math.log(maxCount + 1);
  var idx = Math.floor(t * MAP_RAMP_COLORS_.length);
  return idx >= MAP_RAMP_COLORS_.length ? MAP_RAMP_COLORS_.length - 1 : idx;
}
```

- [ ] **Step 4: Verify `rampBucket_` by hand (no test framework — plain node)**

`rampBucket_` is pure vanilla JS with no DOM dependency, so it can be sanity-checked
directly with `node`, even though this project has no client-side test framework:

```bash
node -e "
function rampBucket_(count, maxCount) {
  if (!count || count <= 0) return -1;
  if (!maxCount || maxCount <= 1) return 0;
  var t = Math.log(count + 1) / Math.log(maxCount + 1);
  var idx = Math.floor(t * 5);
  return idx >= 5 ? 4 : idx;
}
console.log('zero:', rampBucket_(0, 18126));
console.log('smallest real (Rwanda, 32):', rampBucket_(32, 18126));
console.log('mid (Philippines, 825):', rampBucket_(825, 18126));
console.log('max (India, 18126):', rampBucket_(18126, 18126));
console.log('single-country render:', rampBucket_(50, 50));
"
```

Expected: `zero` is `-1`; the three real counts print strictly increasing bucket indices in
`0..4`; the max count prints `4`; the single-country case (count equals maxCount) prints
`4`. If any of these don't hold, fix the formula before moving on — every later task
depends on this function's correctness.

- [ ] **Step 5: Commit**

```bash
git add src/client/MapView.html
git commit -m "Client: add validated 5-step count ramp + rampBucket_ for map drill-down"
```

---

### Task 2: Country tier — count-based aggregation and choropleth coloring

**Files:**
- Modify: `src/client/MapView.html:181-213` (`countryStyle_`, `refreshCountryFill_`)

**Interfaces:**
- Consumes: `MAP_RAMP_COLORS_`, `MAP_NO_DATA_COLOR_`, `rampBucket_(count, maxCount)` (Task 1).
- Produces: `countryCounts_` (module-level `{name: count}`, replaces `countryHasCenter_`) —
  read by `countryStyle_`. No other task consumes `countryCounts_` directly.

- [ ] **Step 1: Replace the boolean tracker with a count tracker**

Replace `var countryHasCenter_ = {};` (line 83) with:

```js
var countryCounts_ = {};  // country name -> center count (was countryHasCenter_ boolean)
```

- [ ] **Step 2: Change `refreshCountryFill_` to accumulate counts**

Replace the function body (lines 198-213):

```js
function refreshCountryFill_(rows) {
  if (!countryLayer) return;
  var counts = {};
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

(Same bbox-reject-first performance shape as before — still one pass per plotted point,
now with a `break` once a point lands in a country instead of a per-country `continue`
guard, since a point can only ever belong to one country.)

- [ ] **Step 3: Change `countryStyle_` to use the ramp**

Replace the function body (lines 181-191):

```js
function countryStyle_(feature) {
  var count = countryCounts_[feature.properties.name] || 0;
  var maxCount = 0;
  for (var name in countryCounts_) { if (countryCounts_[name] > maxCount) maxCount = countryCounts_[name]; }
  var bucket = rampBucket_(count, maxCount);
  return {
    fillColor: bucket === -1 ? MAP_NO_DATA_COLOR_ : MAP_RAMP_COLORS_[bucket],
    fillOpacity: bucket === -1 ? 0.16 : 0.22,
    color: 'transparent', weight: 0
  };
}
```

Note: `maxCount` is recomputed on every feature's style call here for simplicity (135
features × a small object scan — negligible next to the point-in-polygon pass this already
does per `setData()`). If a future profiling pass shows this matters, hoist it into
`refreshCountryFill_` and stash it in a module-level var instead — not needed at today's
data size.

- [ ] **Step 4: Visual verification**

Build the local preview (per this project's existing preview process — do not use
`scripts/build_preview.ps1` interactively; it blocks on its own web server, see that
script's own warning) and confirm: Overview map's country fill now shows visibly different
shades for India vs. Philippines/Kenya/Malaysia/Rwanda/Others (not just two flat tones),
and a country with zero centers still reads as the gray "no data" tone, on both themes.

- [ ] **Step 5: Run regression tests**

```bash
npm test
```

Expected: 245 tests / 15 suites, all passing (no server files touched, so this is purely a
regression check).

- [ ] **Step 6: Commit**

```bash
git add src/client/MapView.html
git commit -m "Client: country map layer shows a count-based ramp instead of binary has/no-center"
```

---

### Task 3: State tier — centroid table, aggregation, rendering, and wiring

**Files:**
- Modify: `src/client/MapView.html` (new `INDIA_STATE_CENTROIDS_` constant near
  `GRAY_AREA_STATES` at line 148; new `stateLayer` var alongside `countryLayer` at line 81;
  new `renderStateLayer_()` function; `ensureMap()` at line 215-235; `setData()` at
  line 271-310)
- Modify: `src/client/App.html:2117` (add `TCI` constant near `CI`/`CDMI`), `App.html:2767`,
  `App.html:2172`, `App.html:3279` (the three `setData()` call sites)

**Interfaces:**
- Consumes: `MAP_RAMP_COLORS_`, `MAP_NO_DATA_COLOR_`, `rampBucket_` (Task 1); `esc()` (existing).
- Produces: `stateLayer` (module-level Leaflet `LayerGroup`, shown/hidden by Task 4);
  `setData(rows, onClick, opts)` gains `opts.stateIdx` (required for the state tier to have
  any data — a map that doesn't pass it simply shows no state circles, same silent-drop
  convention as everything else in this file).

- [ ] **Step 1: Add the full state centroid table**

Add directly after `GRAY_AREA_STATES` (after line 156) in `MapView.html`:

```js
// All 28 states + 8 union territories, approximate centroids (public-domain
// administrative geography, hand-authored the same way GRAY_AREA_STATES above is —
// not extracted from any licensed dataset). Superset of GRAY_AREA_STATES; those 7
// keep their own coordinates unchanged. Used by the state-tier proportional-circle
// layer (renderStateLayer_ below) — matching is exact-name against each center row's
// own `state` field, same trust-the-data convention countryCounts_ already uses for
// COUNTRY_GEOJSON_'s `name` property. A row whose state isn't one of these 36 names
// (typo, blank, non-India) silently doesn't contribute to any circle.
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

- [ ] **Step 2: Add the `stateLayer` var and a render function**

Add `stateLayer = null,` to the `var map = null, cluster = null, tileLayer = null,
countryLayer = null;` line (81), making it:

```js
var map = null, cluster = null, tileLayer = null, countryLayer = null, stateLayer = null;
```

Add a new function near `refreshCountryFill_` (after it, before `ensureMap`):

```js
/**
 * Rebuilds the state proportional-circle layer from the current rows. Requires
 * opts.stateIdx (the array index holding each row's state name) — with no stateIdx,
 * this draws nothing (silent no-op), same convention as an unmatched country name.
 */
function renderStateLayer_(rows, stateIdx) {
  if (!stateLayer) return;
  stateLayer.clearLayers();
  if (stateIdx == null) return;
  var counts = {};
  for (var i = 0; i < rows.length; i++) {
    var s = rows[i][stateIdx];
    if (s) counts[s] = (counts[s] || 0) + 1;
  }
  var maxCount = 0;
  for (var name in counts) { if (counts[name] > maxCount) maxCount = counts[name]; }
  INDIA_STATE_CENTROIDS_.forEach(function (st) {
    var count = counts[st.name] || 0;
    if (count <= 0) return; // proportional-symbol convention: no symbol for zero
    var bucket = rampBucket_(count, maxCount);
    var radius = 6 + 14 * Math.sqrt(count / maxCount);
    var color = MAP_RAMP_COLORS_[bucket];
    L.circleMarker([st.lat, st.lng], {
      radius: radius, color: color, weight: 1,
      fillColor: color, fillOpacity: 0.55, interactive: true
    }).bindTooltip(esc(st.name) + ': ' + count + ' center' + (count === 1 ? '' : 's'),
      { direction: 'top' }
    ).addTo(stateLayer);
  });
}
```

- [ ] **Step 3: Create the layer in `ensureMap()` and clear it alongside country fill**

In `ensureMap()` (line 215-235), add `stateLayer` creation right after `countryLayer`'s
(line 227), before `cluster` is created:

```js
    countryLayer = L.geoJSON(COUNTRY_GEOJSON_, { style: countryStyle_, interactive: false }).addTo(map);
    stateLayer = L.layerGroup(); // NOT added to map yet — Task 4's updateTier_ controls visibility
```

- [ ] **Step 4: Call `renderStateLayer_` from `setData()`**

In `setData()` (line 271-310), add a call right after the existing
`refreshCountryFill_(centers);` line (300):

```js
    refreshCountryFill_(centers);
    renderStateLayer_(centers, opts && opts.stateIdx);
```

- [ ] **Step 5: Add the `TCI` index constant in App.html**

Add directly after the existing `CI`/`AI` constants (`App.html:2117-2121`):

```js
  // Compact center array indices for Top Customers' mapCenters (EditionCD.js
  // computeTopCustomersCD_) — same 12-element shape as CI minus `approx`.
  var TCI = { id: 0, name: 1, lat: 2, lng: 3, devices: 4, online: 5, tickets: 6, assets: 7, hub: 8, hubId: 9, segment: 10, state: 11 };
```

- [ ] **Step 6: Thread `stateIdx` through all three `setData()` call sites**

`App.html:2767` (Overview) — change:
```js
mainMap.setData(centers, CenterDetail.open);
```
to:
```js
mainMap.setData(centers, CenterDetail.open, { stateIdx: CI.state });
```

`App.html:2172` (CDM) — change:
```js
cdmMap.setData(payload.centers, CenterDetail.open, { tooltipFn: cdmTooltip_ });
```
to:
```js
cdmMap.setData(payload.centers, CenterDetail.open, { tooltipFn: cdmTooltip_, stateIdx: CDMI.state });
```

`App.html:3279` (Top Customers) — change:
```js
tcMap.setData(payload.mapCenters || [], CenterDetail.open);
```
to:
```js
tcMap.setData(payload.mapCenters || [], CenterDetail.open, { stateIdx: TCI.state });
```

- [ ] **Step 7: Check for real `state` value mismatches before relying on the table**

Per the spec's appendix note, grep the actual data once during implementation rather than
discovering a silently-empty circle later. From the repo root:

```bash
node -e "
// Adjust this to however this project's own scripts query BigQuery locally, or —
// if no local BigQuery access exists in this environment — skip this step and
// instead visually check during Step 8 whether any state that should clearly have
// a circle (e.g. Maharashtra, Karnataka) is missing one.
console.log('See INDIA_STATE_CENTROIDS_ in MapView.html for the 36 recognized names.');
"
```

If a real mismatch is found (e.g., data uses "Orissa" instead of "Odisha", or "NCT of
Delhi" instead of "Delhi"), add the actual observed spelling as an additional recognized
name for that state — either a second entry with the same coordinates, or extend
`renderStateLayer_`'s lookup with a small alias map. Do not silently leave a real,
frequently-occurring mismatch unresolved.

- [ ] **Step 8: Visual verification**

Local preview: confirm circles appear over India at multiple states once `stateLayer` is
actually added to the map (it isn't yet at the end of this task — Task 4 wires visibility;
for THIS task's verification, temporarily add `.addTo(map)` to the `stateLayer =
L.layerGroup()` line from Step 3, confirm circles render with sensible relative sizes and
tooltips, then remove the temporary `.addTo(map)` again before committing, since Task 4 owns
turning this on for real).

- [ ] **Step 9: Run regression tests**

```bash
npm test
```

Expected: 245 tests / 15 suites, all passing.

- [ ] **Step 10: Commit**

```bash
git add src/client/MapView.html src/client/App.html
git commit -m "Client: add state-tier proportional circle layer (not yet zoom-gated)"
```

---

### Task 4: Zoom-tier switching

**Files:**
- Modify: `src/client/MapView.html` (`ensureMap()` at line 215-235, `setData()` at
  line 271-310)

**Interfaces:**
- Consumes: `countryLayer`, `stateLayer`, `cluster` (all already module-level vars after
  Tasks 2-3).
- Produces: `updateTier_()` (module-level function; not exposed outside the module — no
  other task or file calls it directly).

- [ ] **Step 1: Add the tier-switching function**

Add near `ensureMap()`:

```js
// Zoom breakpoints: country <=4, state 5-6, city >=7 — starting values (spec §5),
// tunable here if a tier switch reads as premature/delayed once real data is on screen.
var MAP_TIER_COUNTRY_MAX_ = 4;
var MAP_TIER_STATE_MAX_ = 6;

function updateTier_() {
  if (!map) return;
  var z = map.getZoom();
  var tier = z <= MAP_TIER_COUNTRY_MAX_ ? 'country' : (z <= MAP_TIER_STATE_MAX_ ? 'state' : 'city');
  if (tier === 'country') {
    if (!map.hasLayer(countryLayer)) map.addLayer(countryLayer);
    if (map.hasLayer(stateLayer)) map.removeLayer(stateLayer);
    if (map.hasLayer(cluster)) map.removeLayer(cluster);
  } else if (tier === 'state') {
    if (map.hasLayer(countryLayer)) map.removeLayer(countryLayer);
    if (!map.hasLayer(stateLayer)) map.addLayer(stateLayer);
    if (map.hasLayer(cluster)) map.removeLayer(cluster);
  } else {
    if (map.hasLayer(countryLayer)) map.removeLayer(countryLayer);
    if (map.hasLayer(stateLayer)) map.removeLayer(stateLayer);
    if (!map.hasLayer(cluster)) map.addLayer(cluster);
  }
}
```

- [ ] **Step 2: Wire the listener and initial call in `ensureMap()`**

In `ensureMap()`, change the `countryLayer`/`stateLayer` creation lines so neither is
unconditionally `.addTo(map)`'d (tier switching owns that now), and add the listener.
Replace:

```js
    countryLayer = L.geoJSON(COUNTRY_GEOJSON_, { style: countryStyle_, interactive: false }).addTo(map);
    stateLayer = L.layerGroup(); // NOT added to map yet — Task 4's updateTier_ controls visibility
    cluster = L.markerClusterGroup({
      chunkedLoading: true, maxClusterRadius: 46,
      showCoverageOnHover: false, spiderfyOnMaxZoom: true
    });
    map.addLayer(cluster);
```

with:

```js
    countryLayer = L.geoJSON(COUNTRY_GEOJSON_, { style: countryStyle_, interactive: false });
    stateLayer = L.layerGroup();
    cluster = L.markerClusterGroup({
      chunkedLoading: true, maxClusterRadius: 46,
      showCoverageOnHover: false, spiderfyOnMaxZoom: true
    });
    map.on('zoomend', updateTier_);
    updateTier_(); // sets the correct initial tier for the map's starting zoom (5 -> state)
```

- [ ] **Step 3: Re-run the tier check after `setData()`'s `fitBounds`**

In `setData()`, after the existing `fitBounds` block (ends around line 309), add:

```js
    updateTier_(); // fitBounds may have changed the zoom level — resync the visible tier
```

- [ ] **Step 4: Visual verification**

Local preview, all three maps, both themes: confirm that zooming out to world view shows
only the country choropleth (no state circles, no pins); zooming to roughly India-country
level shows only state circles; zooming in further shows only pins/clusters and both area
layers disappear; zooming back out restores the choropleth. Confirm the map's initial
load (after data arrives and `fitBounds` runs) lands in a sensible tier, not obviously
wrong (e.g. not showing raw pins at a zoomed-out world view).

- [ ] **Step 5: Run regression tests**

```bash
npm test
```

Expected: 245 tests / 15 suites, all passing.

- [ ] **Step 6: Commit**

```bash
git add src/client/MapView.html
git commit -m "Client: wire zoom-driven tier switching between country/state/city map layers"
```

---

### Task 5: Cluster restyle

**Files:**
- Modify: `src/client/MapView.html` (`ensureMap()`'s `L.markerClusterGroup(...)` call)
- Modify: `src/client/Styles.html:1285-1292` (remove old override, add new class)

**Interfaces:**
- Consumes: `MAP_RAMP_COLORS_`, `rampBucket_` (Task 1).
- Produces: nothing new consumed elsewhere — purely visual.

- [ ] **Step 1: Add `iconCreateFunction` to the cluster group**

Change the `L.markerClusterGroup({...})` call (from Task 4's Step 2 edit) to:

`L.divIcon` has no top-level `style` option of its own — the returned icon's visual style
must live on an element inside `html` instead, so the inner `<span>` carries the inline
`background`/size, not the `divIcon` call itself:

```js
    cluster = L.markerClusterGroup({
      chunkedLoading: true, maxClusterRadius: 46,
      showCoverageOnHover: false, spiderfyOnMaxZoom: true,
      iconCreateFunction: function (clusterObj) {
        var count = clusterObj.getChildCount();
        // City tier only ever has to represent a handful of nearby pins per cluster
        // (state/country tiers absorb the low-zoom load now), so a modest fixed max
        // for the bucket's "brightest" step reads better than the true global max.
        var bucket = rampBucket_(count, Math.max(count, 60));
        var color = MAP_RAMP_COLORS_[bucket === -1 ? 0 : bucket];
        var size = Math.min(48, 28 + Math.sqrt(count) * 2);
        return L.divIcon({
          html: '<span class="center-cluster-inner" style="width:' + size + 'px;height:' + size + 'px;background:' + color + ';">' + count + '</span>',
          className: 'center-cluster',
          iconSize: [size, size]
        });
      }
    });
```

- [ ] **Step 2: Replace the old blunt CSS override with real styling**

Replace `Styles.html:1285-1292`:

```css
.marker-cluster-small, .marker-cluster-medium, .marker-cluster-large {
  background: rgba(46, 155, 214, 0.25) !important;
}
.marker-cluster-small div, .marker-cluster-medium div, .marker-cluster-large div {
  background: rgba(46, 155, 214, 0.8) !important;
  color: #fff !important;
  font-family: var(--font-head); font-weight: 600;
}
```

with:

```css
/* Custom cluster icon (iconCreateFunction in MapView.html) replaces
   Leaflet.markercluster's default marker-cluster-small/medium/large styling. */
.center-cluster { background: none; border: 0; }
.center-cluster-inner {
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%; color: #fff; font-family: var(--font-head); font-weight: 700;
  font-size: 12px; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
}
```

Also remove the now-dead light-theme override at lines 107-109
(`body[data-theme="light"] .marker-cluster-small div, ...`), since those classes no longer
render (the custom `iconCreateFunction` fully replaces Leaflet's default DOM structure).

- [ ] **Step 3: Visual verification**

Local preview, all three maps, both themes: confirm clusters now render as filled circles
in the app's own blue ramp (not Leaflet's default blue/yellow/orange), sized visibly by
count, with the count number legible in both themes; confirm individual (non-clustered)
pins are unaffected (they never went through `iconCreateFunction`).

- [ ] **Step 4: Run regression tests**

```bash
npm test
```

Expected: 245 tests / 15 suites, all passing.

- [ ] **Step 5: Commit**

```bash
git add src/client/MapView.html src/client/Styles.html
git commit -m "Client: restyle marker clusters to match the app's own palette instead of Leaflet.markercluster defaults"
```

---

### Task 6: Legend updates and BRM text removal

**Files:**
- Modify: `src/client/Index.html:221, 257, 385, 858`
- Modify: `src/client/Styles.html` (new `.legend-ramp` swatch, near `.legend-swatch` at
  line 1310-1313)

**Interfaces:**
- Consumes: `MAP_RAMP_COLORS_[0]` and `MAP_RAMP_COLORS_[4]` values (Task 1) — used as
  literal CSS `linear-gradient` stops, hand-copied into `Styles.html` (this project's
  existing convention: colors are literal hex in both `MapView.html` and `Styles.html`,
  never shared via a build step, since there is none).

- [ ] **Step 1: Add the gradient-ramp legend swatch CSS**

Add next to `.legend-swatch` (`Styles.html:1310-1313`), substituting Task 1's final
validated hex values for the two shown here:

```css
/* Gradient swatch for the count-based ramp legend (replaces the old two-tone
   has-center/no-center swatches). Light->dark left->right, same direction the ramp
   itself uses (index 0 lightest/fewest -> index 4 darkest/most). */
.legend-ramp {
  display: inline-block; width: 36px; height: 10px;
  border-radius: 2px; margin-right: 5px; vertical-align: -1px;
  background: linear-gradient(to right, #CFE8F5, #124A67);
}
```

- [ ] **Step 2: Replace the Overview map's legend note (`Index.html:221`)**

Replace:

```html
<span class="legend-note"><span class="legend-swatch" style="background:#2E9BD6"></span>Country has centers <span class="legend-swatch" style="background:#869AB2"></span>No centers · size = devices · faded/dashed = approximate location · click to filter</span>
```

with:

```html
<span class="legend-note"><span class="legend-ramp"></span>Fewer&nbsp;&rarr;&nbsp;more centers <span class="legend-swatch" style="background:#869AB2"></span>No data · size = devices · faded/dashed = approximate location · click to filter</span>
```

- [ ] **Step 3: Replace the CDM map's legend note (`Index.html:385`)**

Replace:

```html
<span class="legend-note"><span class="legend-swatch" style="background:#2E9BD6"></span>Country has centers <span class="legend-swatch" style="background:#869AB2"></span>No centers · size = communicators</span>
```

with:

```html
<span class="legend-note"><span class="legend-ramp"></span>Fewer&nbsp;&rarr;&nbsp;more centers <span class="legend-swatch" style="background:#869AB2"></span>No data · size = communicators</span>
```

- [ ] **Step 4: Replace the Top Customers map's legend note (`Index.html:858`)**

Replace:

```html
<span class="legend-note"><span class="legend-swatch" style="background:#2E9BD6"></span>Country has centers <span class="legend-swatch" style="background:#869AB2"></span>No centers · Bubble size = devices</span>
```

with:

```html
<span class="legend-note"><span class="legend-ramp"></span>Fewer&nbsp;&rarr;&nbsp;more centers <span class="legend-swatch" style="background:#869AB2"></span>No data · Bubble size = devices</span>
```

- [ ] **Step 5: Remove the BRM citation (`Index.html:257`)**

Replace:

```html
<span class="legend-note"><span class="legend-dot legend-dot-gray"></span>Gray areas — no dealer/engineer coverage (BRM 2026 review)</span>
```

with:

```html
<span class="legend-note"><span class="legend-dot legend-dot-gray"></span>Gray areas — no dealer/engineer coverage</span>
```

- [ ] **Step 6: Grep for any other visible BRM mention**

```bash
grep -rn "BRM" src/client/
```

Expected: no matches in `Index.html`, `MapView.html`, `App.html`, or `Styles.html` (any
remaining hits should only be in `src/server/Fse.js`/`Cp.js` code comments, which are never
rendered to a user — confirm none of the matches are inside an HTML string, tooltip, label,
or attribute value).

- [ ] **Step 7: Visual verification**

Local preview, all three maps, both themes: confirm the new gradient-ramp legend swatch
renders and reads clearly next to the "No data" gray swatch; confirm the gray-area legend
note no longer mentions "BRM."

- [ ] **Step 8: Run regression tests**

```bash
npm test
```

Expected: 245 tests / 15 suites, all passing.

- [ ] **Step 9: Commit**

```bash
git add src/client/Index.html src/client/Styles.html
git commit -m "Client: update map legends for the count ramp; remove BRM citation text"
```

---

### Task 7: Full regression and cross-map visual pass

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: 245 tests / 15 suites, all passing.

- [ ] **Step 2: Full visual pass, both themes, all three maps**

Local preview (and, if this project's convention for this stage is a live `@HEAD` check
rather than local-only, follow that same convention as prior map-affecting changes): for
each of Overview, CDM, and Top Customers, confirm — country tier renders a visibly
graduated ramp with a distinct "no data" gray; zooming through country → state → city shows
each tier cleanly (no double-rendering, no flash of the wrong tier); state circles show
sensible relative sizes and a tooltip with state name + count; individual pins/clusters at
city zoom still open the correct center's detail drawer on click (regression check — this
plan never touched click handling); cluster icons read as one coherent visual system, not
Leaflet's library defaults; the gray-area legend no longer says "BRM."

- [ ] **Step 3: Confirm no stray debug code**

```bash
grep -n "console.log\|console.warn" src/client/MapView.html | grep -v "^.*//"
```

Review any hits introduced by this plan's tasks (Task 1's `rampBucket_` verification was a
standalone `node -e` snippet, never landed in `MapView.html` itself — confirm that's still
true) and remove anything left in by mistake.

- [ ] **Step 4: Final commit (if Step 3 found anything to clean up; otherwise this task has
  no commit of its own — Tasks 1-6 already committed everything)**
