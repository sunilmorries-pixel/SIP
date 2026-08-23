# CP (Channel Partner) Dealer Coverage Layer — Design

Date: 2026-08-24
Status: approved (design); implementation plan not yet written

## 1. Problem

The Overview map has an FSE (Field Service Engineer) layer (`src/server/Fse.js`, `MapView.html`'s
`fseGroup`/`reachGroup`) that plots named direct employees and their actually-worked ticket coverage.
There is a second, distinct part of the service network — Channel Partners (CP), third-party dealer
companies who cover a list of districts/cities each — with no representation anywhere in the app. The
user supplied real BRM 2026 data (`Progress on the Service Dealer Network - BRM 2026.xlsx`) and asked
for a full CP layer on the map, alongside FSE.

## 2. Design summary (one sentence)

Add a second static-catalog map layer, `CP_ROSTER` (`src/server/Cp.js`), rendered as HQ pins with a
distinct color/icon from FSE, each with fan-lines to its declared covered locations on click — same
interaction shape as FSE's focus mode, but with pre-declared coverage instead of ticket-derived
coverage — behind its own "Dealers" legend toggle.

## 3. Scope decisions (user, 2026-08-24)

- **Visualization: HQ pins + fan lines to covered locations** (not pins-only, not district
  choropleth). District/state boundary shading was considered and rejected for this round — the app
  only bundles country-level GeoJSON so far (`46e6e82`), and adding India district boundaries is a
  much larger, separate asset problem.
- **Separate legend toggle** ("Dealers"), independent of the FSE Engineers/Coverage-gaps toggles —
  keeps the map legible once both layers carry real data.
- **"Gray areas" sheet (7 states with zero coverage) is explicitly OUT of scope for this round** —
  revisit once/if district or state boundary shading exists to actually paint them.

## 4. Verified facts (from the source workbook)

- Workbook: `Progress on the Service Dealer Network - BRM 2026.xlsx`, sheet `CP` (982 rows, 11 with
  data). Columns: `Sl no`, `CP Name`, `CP HQ`, `Segment` (always `"Channel Partner"` — not a useful
  grouping dimension), then a ragged list of `Locations covered` columns (blank-padded to a shared
  width).
- 11 CP companies, 107 raw location mentions, 79 distinct location strings **before** per-company
  dedup; several company-internal duplicates and renamed-city collisions exist and must be cleaned
  during import, not carried into the roster verbatim:
  - SBM Corp (HQ Pune) lists both `"Chh. Sambajinagar"` and `"Aurangabad"` — the same city
    (renamed 2023); same for `"Sangli"`/`"Sangali"` (typo) and a bare lowercase `"pune"` duplicate of
    its own HQ. Collapse to one canonical name each.
  - This is the only CP with a large list (37 distinct locations, all Maharashtra districts). The
    other 10 range from 1 to 8 locations.
- This data has **no BigQuery/ServiceWRK counterpart to reconcile against** — unlike FSE, where
  `servicewrk_Tickets.representative` provides ground truth, there is no ticket field naming a CP.
  Coverage here is a static declaration, not a computed fact. This is the key architectural
  simplification vs. Fse.js (§6).
- One location name is low-confidence: `"Campierganj"` (S S Medical System, Gorakhpur) is a small
  tehsil town in Gorakhpur district — I can place it approximately (near Gorakhpur) but with lower
  precision than the other ~78 names, all of which are well-known district/city HQs I can geocode
  confidently. Flagged here rather than silently guessed; not a blocker.

## 5. Data model — `src/server/Cp.js` (new file, mirrors `Fse.js`)

```js
var CP_ROSTER = [
  {
    name: 'SBM Corp', hqCity: 'Pune', hqState: 'Maharashtra', lat: 18.5204, lng: 73.8567,
    locations: [
      { name: 'Wardha', lat: 20.7453, lng: 78.6022 },
      { name: 'Baramati', lat: 18.1514, lng: 74.5815 },
      // ... one entry per deduped covered location
    ]
  },
  // ... 10 more CP entries
];
```

- `name`, `hqCity`, `hqState` — required, same convention as `FSE_ROSTER`.
- `lat`/`lng` on the roster entry itself — **explicit, not geo-store-resolved**, same reasoning as
  the FSE roster: most of these HQ/location towns have no guarantee of already being geocoded via an
  existing center, and explicit coordinates mean a pin/fan-line always renders instead of silently
  dropping into an unlocated bucket.
- `locations: Array<{name, lat, lng}>` — the declared coverage list, pre-geocoded at import time
  (same explicit-coordinate reasoning). No separate coverage-computation step exists, unlike FSE.
- No `aliases`, no `active` flag needed at this size (11 rows) — can be added later if the roster
  grows enough to need deactivating an entry without deleting it.
- `CP_ROSTER` ships **populated** in this change (unlike `FSE_ROSTER`'s deliberate empty start) —
  the data already comes from a named, real, user-provided source (the BRM sheet), not placeholder
  content, so there's no "drawing a company that doesn't exist" risk to guard against.

## 6. Server — `buildCpLayer_()` (in `Cp.js`, called from `EditionCD.js`)

Pure function, unit-testable like `buildFseLayer_`, but simpler — no coverage query, no ticket join:

```js
function buildCpLayer_(roster, hqCoordFn, locationCoordFn) {
  // for each roster entry:
  //   resolve HQ via hqCoordFn(entry) -> [lat,lng] or null
  //   resolve each location via locationCoordFn(entry, location) -> [lat,lng] or null
  //   unresolved HQ -> push entry.name to unlocatedRoster, skip the whole entry
  //   unresolved location -> push {cp: entry.name, location: location.name} to
  //     unlocatedLocations, drop just that one point (the CP itself still plots)
  // returns { dealers: [{name, hq, lat, lng, locations: [{name,lat,lng}]}, ...],
  //           unlocatedRoster, unlocatedLocations }
}
```

Since every coordinate is explicit on the roster (§5), `hqCoordFn`/`locationCoordFn` are trivial
pass-throughs in production (unlike FSE's real geo-store lookup) — injected anyway so the function
stays pure and testable, and so a future switch to geo-store resolution (if the roster grows past
hand-maintained coordinates) doesn't change `buildCpLayer_`'s shape.

**Wiring** (`EditionCD.js`, next to the existing FSE block in `apiGetDashboardCD`):

```js
var cp = cpRosterActive_().length ? buildCpLayer_(CP_ROSTER, hqFn, locFn) : null;
payload.cp = cp;
```

Unconditional inclusion once non-empty (no ticket query to gate on cost, unlike FSE's
`fseRosterActive_().length` guard which exists to skip a BigQuery query — here the whole thing is
free, so the guard is only about not sending an empty layer to the client).

## 7. Client

**`MapView.html`** — new `cpGroup`/`cpReachGroup` layers, parallel to `fseGroup`/`reachGroup`:
- `cpIcon_(name, isFocused)` — distinct glyph (building/briefcase, not the FSE person icon) and color
  (`CP_COLOR`, an amber/gold — distinct from `FSE_COLOR`'s violet).
- `setCp(dealers, onSelect)` — one marker per CP at its HQ, tooltip: company name, HQ, and covered
  location count (`"14 locations"`), not a full text list — the fan-lines are the detail view,
  matching how FSE's tooltip shows a summary count rather than every center name. **No HQ-collision
  grouping needed**: FSE's marker code merges engineers sharing one HQ city into a single pin with a
  "+N" badge (`fseIcon_`'s `extra` param) because several engineers do share a city; none of the 11
  CPs share an HQ, so `setCp` can skip that grouping step entirely — one roster entry, one marker,
  always. Re-add grouping only if a future CP roster update introduces a real collision.
- `focusCp(name)` / `clearCpFocus()` / `applyCpFocus_()` — mirrors `focusFse`/`clearFseFocus`/
  `applyFseFocus_`: clicking a CP pin draws lines from its HQ to every covered location's point,
  clicking again (or Esc, or another pin) clears it. Same three-escape-route convention as FSE focus.
- `setCpVisible(visible)` — toggle backing the new legend button.

**`Index.html`** — new `map-legend-cp` row (mirrors `map-legend-fse`): a `cpToggle` button labeled
"Dealers", hidden via the same `hidden` attribute pattern until a payload actually carries `cp` data
(here: always visible once shipped, since `CP_ROSTER` ships populated — but the markup stays
guardable the same way in case the roster is ever emptied).

**`Styles.html`** — `.cp-pin`, `.cp-glyph`, `.cp-focus-bar` (if a focus-bar affordance is added,
mirroring `.fse-focus-bar`) — new color token alongside `--violet` (used by FSE) for the amber CP
accent.

**`App.html`** — `loadMapData()` passes `data.cp` into `MapView.setCp(...)`; legend button wired to
`setCpVisible`, following the exact `fseToggle`/`setFseVisible` wiring already in place.

## 8. Explicitly out of scope for v1

- District/state choropleth shading of covered areas (§3 — needs boundary data this round doesn't
  add).
- The "Gray areas" (7 uncovered states) sheet — not surfaced anywhere yet.
- Any CP ↔ ticket reconciliation — there is no data field to reconcile against (§4); this is a
  purely declarative layer, and unlike FSE there is no `unmatchedReps`-style discrepancy to surface.
- `aliases`/`active` fields on `CP_ROSTER` entries — deferred until the roster is large enough or
  changes often enough to need them (§5).
- Search/filter integration (the global search box does not need to find a CP by name in v1).

## 9. Testing

- New `test/unit/cp-coverage.test.js`, mirroring `test/unit/fse-coverage.test.js`'s structure: pure
  tests against `buildCpLayer_` — a normal roster resolves correctly, an unresolvable HQ drops the
  whole entry into `unlocatedRoster` without plotting at 0,0, an unresolvable single location drops
  just that point into `unlocatedLocations` while the rest of that CP's entry still renders, dealers
  come back name-sorted for render stability (same rationale as FSE's sort).
- `npm test` must stay green (currently 233 tests / 14 suites).
- Local preview (`scripts/build_preview.ps1`) — visually confirm: HQ pins render with the amber
  style, hovering shows company + HQ + location count, clicking fans out lines to every covered
  location, the Dealers legend toggle shows/hides the whole layer, and the layer looks visually
  distinct from FSE pins when both are on screen together.
- Live check on `@HEAD` before the stable deployment is touched, same convention as every other
  map-affecting change this project has shipped.

## 10. Open items

- `"Campierganj"` (§4) — placed at approximate coordinates near Gorakhpur; revisit if the user has a
  more precise location.
- Whether CP entries should eventually gain the same `active`/`aliases` shape as `FSE_ROSTER` is
  deferred (§8) — not needed at 11 rows.
- No decision yet on whether a future round should add a text list of covered locations to the CP
  tooltip in addition to the fan-lines (currently just a count, §7) — left for user feedback once the
  layer is live.
