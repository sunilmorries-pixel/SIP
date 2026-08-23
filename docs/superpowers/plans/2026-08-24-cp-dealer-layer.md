# CP (Channel Partner) Dealer Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second static-catalog map layer — Channel Partner (CP) dealer coverage — to the
Overview map, alongside the existing FSE (Field Service Engineer) layer, behind its own "Dealers"
legend toggle.

**Architecture:** A new pure-data server file (`src/server/Cp.js`, mirroring `Fse.js`) holds an
11-company `CP_ROSTER` with every HQ and covered-location coordinate supplied explicitly (no
BigQuery query, no ticket reconciliation — CP coverage is a static declaration, unlike FSE's
ticket-derived coverage). `EditionCD.js`'s `apiGetMapDataCD` gains a `cp` field in its payload,
computed the same way the existing `fse` field is. The client (`MapView.html`, `Styles.html`,
`Index.html`, `App.html`) gets a parallel set of CP marker/legend/focus-mode functions modeled
directly on the existing FSE ones, with a distinct pin color/glyph and no same-HQ marker grouping
(unlike FSE, none of the 11 CPs share an HQ city).

**Tech Stack:** Google Apps Script (server), vanilla JS + Leaflet.js (client), Jest (`test/unit`,
via the `loadGas` eval harness).

**Spec:** `docs/superpowers/specs/2026-08-24-cp-dealer-layer-design.md`

## Global Constraints

- No BigQuery query for CP data — every coordinate is explicit on the roster (spec §5).
- CP pins must be visually distinct from FSE pins by both **shape** (building/briefcase glyph vs.
  FSE's person glyph) and **color** (a new fixed hex constant, not reused from FSE/severity hues) —
  spec §7, following this codebase's own stated principle that engineer/dealer identity should not
  depend on colour vision alone (`MapView.html`'s FSE-layer file comment).
- No same-HQ marker grouping for CP (spec §7 addendum) — none of the 11 roster entries share an HQ
  city; skip the "+N" collapsing logic FSE needs.
- `CP_ROSTER` ships **populated** in this change (spec §5) — unlike `FSE_ROSTER`'s deliberate empty
  start, this data is real and user-provided (BRM 2026 sheet), not placeholder content.
- District/state choropleth shading and the "Gray areas" (uncovered-states) sheet are out of scope
  (spec §8).
- `npm test` must stay green throughout (233 tests / 14 suites as of this plan's writing).

---

## File Structure

| File | Change |
|---|---|
| `src/server/Cp.js` | **New.** `CP_ROSTER` data + `buildCpLayer_()` pure function. |
| `test/unit/cp-coverage.test.js` | **New.** Unit tests for `buildCpLayer_` + a data-integrity smoke test over the real roster. |
| `src/server/EditionCD.js` | **Modify.** Wire `buildCpLayer_` into `apiGetMapDataCD`'s payload; bump the cache key version. |
| `src/client/MapView.html` | **Modify.** CP layer state, `cpIcon_`, `setCp`, `focusCp`, `clearCpFocus`, `applyCpFocus_`, `setCpVisible`; extend the module's returned object. |
| `src/client/Styles.html` | **Modify.** `.cp-pin`/`.cp-glyph`/`.legend-dot-cp`/`.cp-focus-bar` CSS. |
| `src/client/Index.html` | **Modify.** New `map-legend-cp` row + `cpFocusBar` markup. |
| `src/client/App.html` | **Modify.** `renderCpLayer_`, wiring into `applyMapFilters()`, legend toggle + focus-clear handlers, Escape-key handling, and a `cp` mock branch for the local preview. |

---

### Task 1: `buildCpLayer_` pure function

**Files:**
- Create: `src/server/Cp.js`
- Test: `test/unit/cp-coverage.test.js`

**Interfaces:**
- Produces: `buildCpLayer_(roster, hqCoordFn, locationCoordFn)` → `{dealers: Array<{name, hq, lat,
  lng, locations: Array<{name, lat, lng}>}>, unlocatedRoster: Array<string>, unlocatedLocations:
  Array<{cp: string, location: string}>}`. `hqCoordFn(entry) -> [lat,lng]|null`,
  `locationCoordFn(entry, location) -> [lat,lng]|null` — both injected so the function is pure and
  testable without touching the geo store.
- Also produces (module-level): `var CP_ROSTER = [];` (populated for real in Task 2 — starts empty
  here so this task's tests exercise `buildCpLayer_` against fixtures only, exactly like
  `fse-coverage.test.js` does against `FSE_ROSTER`).

- [ ] **Step 1: Write the failing tests**

Create `test/unit/cp-coverage.test.js`:

```js
'use strict';

/**
 * Unit tests for the CP (Channel Partner) dealer layer (src/server/Cp.js).
 *
 * buildCpLayer_ is pure (roster + two injected coordinate resolvers), so it is
 * tested end-to-end against fixtures rather than by string-shape checks —
 * same approach as fse-coverage.test.js. Unlike FSE, there is no ticket data
 * to reconcile against: coverage here is a static declared list, so there is
 * no unmatchedReps-equivalent and no coverage-window concept.
 */

const { loadGas } = require('../helpers/loadGas');

describe('CP dealer layer (Cp.js)', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Cp.js']);
  });

  // Every test sets its own roster; reset so ordering can't leak.
  beforeEach(function () { sandbox.CP_ROSTER = []; });

  const hqFixed = () => [18.52, 73.85];
  const locFixed = () => [19.00, 74.00];

  describe('buildCpLayer_', function () {
    test('empty roster yields an empty layer', function () {
      const out = sandbox.buildCpLayer_([], hqFixed, locFixed);
      expect(out.dealers).toEqual([]);
      expect(out.unlocatedRoster).toEqual([]);
      expect(out.unlocatedLocations).toEqual([]);
    });

    test('resolves HQ and every covered location', function () {
      const roster = [{
        name: 'Acme Dealers', hqCity: 'Pune', hqState: 'Maharashtra',
        locations: [{ name: 'Satara' }, { name: 'Solapur' }]
      }];
      const hq = e => (e.hqCity === 'Pune' ? [18.52, 73.85] : null);
      const loc = (e, l) => (l.name === 'Satara' ? [17.68, 74.02] : l.name === 'Solapur' ? [17.66, 75.91] : null);
      const out = sandbox.buildCpLayer_(roster, hq, loc);

      expect(out.dealers).toHaveLength(1);
      const d = out.dealers[0];
      expect(d.name).toBe('Acme Dealers');
      expect(d.hq).toBe('Pune, Maharashtra');
      expect(d.lat).toBe(18.52);
      expect(d.lng).toBe(73.85);
      expect(d.locations).toEqual([
        { name: 'Satara', lat: 17.68, lng: 74.02 },
        { name: 'Solapur', lat: 17.66, lng: 75.91 }
      ]);
      expect(out.unlocatedRoster).toEqual([]);
      expect(out.unlocatedLocations).toEqual([]);
    });

    test('an unresolvable HQ drops the whole entry, not plotted at 0,0', function () {
      const roster = [
        { name: 'Nowhere Co', hqCity: 'Atlantis', hqState: 'XX', locations: [] },
        { name: 'Somewhere Co', hqCity: 'Pune', hqState: 'Maharashtra', locations: [] }
      ];
      const hq = e => (e.hqCity === 'Pune' ? [18.52, 73.85] : null);
      const out = sandbox.buildCpLayer_(roster, hq, locFixed);

      expect(out.dealers.map(d => d.name)).toEqual(['Somewhere Co']);
      expect(out.unlocatedRoster).toEqual(['Nowhere Co']);
    });

    test('an unresolvable single location drops only that point, not the whole CP', function () {
      const roster = [{
        name: 'Acme Dealers', hqCity: 'Pune', hqState: 'Maharashtra',
        locations: [{ name: 'Satara' }, { name: 'Nowhereville' }]
      }];
      const loc = (e, l) => (l.name === 'Satara' ? [17.68, 74.02] : null);
      const out = sandbox.buildCpLayer_(roster, hqFixed, loc);

      expect(out.dealers).toHaveLength(1);
      expect(out.dealers[0].locations).toEqual([{ name: 'Satara', lat: 17.68, lng: 74.02 }]);
      expect(out.unlocatedLocations).toEqual([{ cp: 'Acme Dealers', location: 'Nowhereville' }]);
    });

    test('a CP with no covered locations still plots, with an empty locations array', function () {
      const roster = [{ name: 'Solo Dealer', hqCity: 'Pune', hqState: 'Maharashtra', locations: [] }];
      const out = sandbox.buildCpLayer_(roster, hqFixed, locFixed);
      expect(out.dealers).toHaveLength(1);
      expect(out.dealers[0].locations).toEqual([]);
    });

    test('a roster entry with no locations field at all is treated as zero locations', function () {
      const roster = [{ name: 'No Locations Key', hqCity: 'Pune', hqState: 'Maharashtra' }];
      const out = sandbox.buildCpLayer_(roster, hqFixed, locFixed);
      expect(out.dealers[0].locations).toEqual([]);
    });

    test('dealers come back name-sorted so the layer is stable across refreshes', function () {
      const roster = [
        { name: 'Zoya Corp', hqCity: 'Pune', hqState: 'Maharashtra', locations: [] },
        { name: 'Arun Corp', hqCity: 'Pune', hqState: 'Maharashtra', locations: [] },
        { name: 'Meera Corp', hqCity: 'Pune', hqState: 'Maharashtra', locations: [] }
      ];
      const out = sandbox.buildCpLayer_(roster, hqFixed, locFixed);
      expect(out.dealers.map(d => d.name)).toEqual(['Arun Corp', 'Meera Corp', 'Zoya Corp']);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/unit/cp-coverage.test.js`
Expected: FAIL — `loadGas: failed evaluating Cp.js` (file does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/server/Cp.js`:

```js
/**
 * Cp.js — Channel Partner (CP) dealer coverage layer for the Overview map.
 *
 * WHY A STATIC CATALOG, NO BIGQUERY: unlike FSE (Fse.js), there is no ticket
 * field anywhere in the warehouse that names a CP — coverage here is a
 * DECLARED list of districts/cities per dealer company, not something
 * computed from tickets actually worked. So there is no coverage query, no
 * name-reconciliation step, and no "unmatched" bucket the way Fse.js has for
 * ServiceWRK representatives — buildCpLayer_ only has to resolve coordinates.
 *
 * CP_ROSTER SHIPS POPULATED (unlike FSE_ROSTER's deliberate empty start):
 * this data comes from a named, real source — "Progress on the Service
 * Dealer Network - BRM 2026.xlsx", 'CP' sheet, imported 2026-08-24 — not
 * placeholder content, so there is no "drawing a company that doesn't exist"
 * risk to guard against.
 *
 * Entry shape:
 *   name       {string}  REQUIRED. The dealer company name.
 *   hqCity     {string}  REQUIRED with hqState — informational only; not
 *   hqState    {string}  used to resolve the pin (lat/lng below does that).
 *   lat, lng   {number}  REQUIRED. Explicit HQ coordinate — supplied directly
 *                        rather than resolved through the geo store, because
 *                        most of these HQ/location towns have no guarantee of
 *                        already being geocoded via an existing center.
 *   locations  {Array<{name:string, lat:number, lng:number}>} the declared
 *                        covered districts/cities, each pre-geocoded the same
 *                        explicit way as the HQ.
 *
 * No `aliases`/`active` fields at this size (11 rows, 2026-08-24) — add them
 * if the roster later grows enough to need deactivating an entry without
 * deleting it (see Fse.js for the pattern to follow).
 */
var CP_ROSTER = [];

/**
 * Builds the map's CP layer. Pure — no BigQuery, no Apps Script services — so
 * it is unit-testable against fixture rows, mirroring buildFseLayer_'s shape
 * but without any ticket-coverage computation.
 *
 * @param {Array<Object>} roster CP_ROSTER (or a test fixture of the same shape).
 * @param {function(Object): ?Array<number>} hqCoordFn resolves a roster entry
 *   to its HQ [lat, lng], or null when unresolvable. Injected (rather than
 *   reading entry.lat/entry.lng directly) so a future switch to geo-store
 *   resolution doesn't change this function's shape.
 * @param {function(Object, Object): ?Array<number>} locationCoordFn resolves
 *   one covered-location entry to [lat, lng], or null when unresolvable.
 * @return {{dealers:Array<Object>, unlocatedRoster:Array<string>,
 *           unlocatedLocations:Array<{cp:string, location:string}>}}
 */
function buildCpLayer_(roster, hqCoordFn, locationCoordFn) {
  var dealers = [], unlocatedRoster = [], unlocatedLocations = [];

  (roster || []).forEach(function (entry) {
    var hq = hqCoordFn(entry);
    if (!hq) { unlocatedRoster.push(entry.name); return; }

    var locations = [];
    (entry.locations || []).forEach(function (loc) {
      var coord = locationCoordFn(entry, loc);
      if (!coord) { unlocatedLocations.push({ cp: entry.name, location: loc.name }); return; }
      locations.push({ name: loc.name, lat: coord[0], lng: coord[1] });
    });

    dealers.push({
      name: entry.name,
      hq: [entry.hqCity, entry.hqState].filter(Boolean).join(', '),
      lat: hq[0], lng: hq[1],
      locations: locations
    });
  });

  // Sorted so the payload (and therefore the drawn layer) is stable between
  // refreshes instead of following object key order — same rationale as
  // buildFseLayer_'s engineers.sort().
  dealers.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });

  return { dealers: dealers, unlocatedRoster: unlocatedRoster, unlocatedLocations: unlocatedLocations };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/unit/cp-coverage.test.js`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/Cp.js test/unit/cp-coverage.test.js
git commit -m "Server: add buildCpLayer_ for the CP dealer coverage layer"
```

---

### Task 2: Populate the real `CP_ROSTER` data

**Files:**
- Modify: `src/server/Cp.js`
- Modify: `test/unit/cp-coverage.test.js`

**Interfaces:**
- Consumes: `buildCpLayer_` from Task 1 (unchanged signature).
- Produces: `CP_ROSTER` populated with 11 real entries, consumed by Task 3's `EditionCD.js` wiring.

**Data cleaning applied** (per spec §4 — do not carry the sheet's raw duplicates into the roster):
`SBM Corp`'s location list merges `"Chh. Sambajinagar"`+`"Aurangabad"` into one
`"Chhatrapati Sambhajinagar"` entry, `"Sangli"`+`"Sangali"` into one `"Sangli"` entry, and drops the
bare lowercase `"pune"` duplicate of its own HQ city.

- [ ] **Step 1: Write the failing integrity test**

Append to `test/unit/cp-coverage.test.js` (inside the existing `describe('CP dealer layer (Cp.js)'`
block, as a sibling to `describe('buildCpLayer_', ...)`):

```js
  describe('CP_ROSTER (real data)', function () {
    // This suite intentionally reads the REAL roster (not a reset fixture) —
    // it exists to catch typos/missing fields in the hand-entered coordinate
    // data, which unit tests over buildCpLayer_ alone cannot see.
    let realSandbox;
    beforeAll(function () { realSandbox = loadGas(['Cp.js']); });

    test('has 11 companies', function () {
      expect(realSandbox.CP_ROSTER).toHaveLength(11);
    });

    test('every entry has a complete HQ (name, hqCity, hqState, lat, lng)', function () {
      realSandbox.CP_ROSTER.forEach(function (entry) {
        expect(typeof entry.name).toBe('string');
        expect(entry.name.length).toBeGreaterThan(0);
        expect(typeof entry.hqCity).toBe('string');
        expect(typeof entry.hqState).toBe('string');
        expect(typeof entry.lat).toBe('number');
        expect(typeof entry.lng).toBe('number');
      });
    });

    test('every covered location has a name and coordinates', function () {
      realSandbox.CP_ROSTER.forEach(function (entry) {
        (entry.locations || []).forEach(function (loc) {
          expect(typeof loc.name).toBe('string');
          expect(loc.name.length).toBeGreaterThan(0);
          expect(typeof loc.lat).toBe('number');
          expect(typeof loc.lng).toBe('number');
        });
      });
    });

    test('feeding the real roster through buildCpLayer_ plots all 11 with no unlocated entries', function () {
      var identity = function (e) { return [e.lat, e.lng]; };
      var identityLoc = function (e, l) { return [l.lat, l.lng]; };
      var out = realSandbox.buildCpLayer_(realSandbox.CP_ROSTER, identity, identityLoc);
      expect(out.dealers).toHaveLength(11);
      expect(out.unlocatedRoster).toEqual([]);
      expect(out.unlocatedLocations).toEqual([]);
    });

    test('SBM Corp\'s renamed/duplicate location names were merged, not carried in twice', function () {
      var sbm = realSandbox.CP_ROSTER.filter(function (e) { return e.name === 'SBM Corp'; })[0];
      var names = sbm.locations.map(function (l) { return l.name; });
      expect(names.filter(function (n) { return n === 'Chhatrapati Sambhajinagar'; })).toHaveLength(1);
      expect(names).not.toContain('Aurangabad');
      expect(names).not.toContain('Chh. Sambajinagar');
      expect(names.filter(function (n) { return n === 'Sangli'; })).toHaveLength(1);
      expect(names).not.toContain('Sangali');
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/unit/cp-coverage.test.js`
Expected: FAIL — `CP_ROSTER` is still `[]` (0 companies, not 11).

- [ ] **Step 3: Populate `CP_ROSTER`**

In `src/server/Cp.js`, replace `var CP_ROSTER = [];` with:

```js
var CP_ROSTER = [
  {
    name: 'SBM Corp', hqCity: 'Pune', hqState: 'Maharashtra', lat: 18.5204, lng: 73.8567,
    locations: [
      { name: 'Wardha', lat: 20.7453, lng: 78.6022 },
      { name: 'Baramati', lat: 18.1514, lng: 74.5815 },
      { name: 'Jalgaon', lat: 21.0077, lng: 75.5626 },
      { name: 'Akola', lat: 20.7002, lng: 77.0082 },
      { name: 'Kolhapur', lat: 16.7050, lng: 74.2433 },
      { name: 'Thane', lat: 19.2183, lng: 72.9781 },
      { name: 'Nagpur', lat: 21.1458, lng: 79.0882 },
      { name: 'Amravati', lat: 20.9374, lng: 77.7796 },
      { name: 'Nandurbar', lat: 21.3667, lng: 74.2500 },
      { name: 'Sindhudurg', lat: 16.0667, lng: 73.6333 },
      { name: 'Gadchiroli', lat: 20.1809, lng: 80.0037 },
      { name: 'Nanded', lat: 19.1383, lng: 77.3210 },
      { name: 'Buldhana', lat: 20.5293, lng: 76.1809 },
      { name: 'Palghar', lat: 19.6963, lng: 72.7692 },
      { name: 'Nashik', lat: 19.9975, lng: 73.7898 },
      { name: 'Gondia', lat: 21.4602, lng: 80.1922 },
      { name: 'Bhandara', lat: 21.1667, lng: 79.6500 },
      { name: 'Latur', lat: 18.4088, lng: 76.5604 },
      { name: 'Washim', lat: 20.1000, lng: 77.1333 },
      { name: 'Chandrapur', lat: 19.9500, lng: 79.3000 },
      { name: 'Satara', lat: 17.6805, lng: 74.0183 },
      // Sheet listed "Sangli" and "Sangali" (typo) as two rows — merged.
      { name: 'Sangli', lat: 16.8524, lng: 74.5815 },
      // Sheet listed "Chh. Sambajinagar" and "Aurangabad" as two rows — same
      // city, renamed 2023 — merged to the current name.
      { name: 'Chhatrapati Sambhajinagar', lat: 19.8762, lng: 75.3433 },
      { name: 'Beed', lat: 18.9891, lng: 75.7601 },
      { name: 'Dhule', lat: 20.9042, lng: 74.7749 },
      { name: 'Solapur', lat: 17.6599, lng: 75.9064 },
      { name: 'Jalna', lat: 19.8410, lng: 75.8864 },
      { name: 'Yavatmal', lat: 20.3888, lng: 78.1204 },
      { name: 'Parbhani', lat: 19.2704, lng: 76.7600 },
      { name: 'Raigad', lat: 18.6414, lng: 72.8722 },
      { name: 'Dharashiv', lat: 18.1667, lng: 76.0333 },
      { name: 'Ahilyanagar', lat: 19.0952, lng: 74.7496 },
      { name: 'Ratnagiri', lat: 16.9902, lng: 73.3120 },
      { name: 'Hingoli', lat: 19.7147, lng: 77.1449 }
      // Sheet also listed a bare lowercase "pune" — dropped as a duplicate of
      // this CP's own HQ city.
    ]
  },
  {
    name: 'Chetan Healthcare', hqCity: 'Vijayawada', hqState: 'Andhra Pradesh', lat: 16.5062, lng: 80.6480,
    locations: [
      // Sheet spells this "Rajamahadevapuram" — the city's newer official name.
      { name: 'Rajamahadevapuram', lat: 17.0005, lng: 81.8040 },
      { name: 'Kakinada', lat: 16.9891, lng: 82.2475 },
      { name: 'Vizag', lat: 17.6868, lng: 83.2185 },
      { name: 'Ongole', lat: 15.5057, lng: 80.0499 },
      { name: 'Nellore', lat: 14.4426, lng: 79.9865 },
      { name: 'Tirupati', lat: 13.6288, lng: 79.4192 },
      { name: 'Khammam', lat: 17.2473, lng: 80.1514 },
      { name: 'Guntur', lat: 16.3067, lng: 80.4365 }
    ]
  },
  {
    name: 'Horizon Technoworld', hqCity: 'Chhatrapati Sambhajinagar', hqState: 'Maharashtra', lat: 19.8762, lng: 75.3433,
    locations: [
      { name: 'Jalna', lat: 19.8410, lng: 75.8864 }
    ]
  },
  {
    name: 'Hospilab Solution', hqCity: 'Varanasi', hqState: 'Uttar Pradesh', lat: 25.3176, lng: 82.9739,
    locations: [
      { name: 'Jaunpur', lat: 25.7539, lng: 82.6825 },
      { name: 'Prayagraj', lat: 25.4358, lng: 81.8463 },
      { name: 'Azamgarh', lat: 26.0685, lng: 83.1836 },
      { name: 'Ghazipur', lat: 25.5859, lng: 83.5772 },
      { name: 'Ballia', lat: 25.7593, lng: 84.1499 },
      { name: 'Sultanpur', lat: 26.2647, lng: 82.0721 }
    ]
  },
  {
    name: 'Shree Sai Healthcare', hqCity: 'Erode', hqState: 'Tamil Nadu', lat: 11.3410, lng: 77.7172,
    locations: [
      { name: 'Coimbatore', lat: 11.0168, lng: 76.9558 },
      { name: 'Salem', lat: 11.6643, lng: 78.1460 },
      { name: 'Thanjavur', lat: 10.7870, lng: 79.1378 },
      { name: 'Dindigul', lat: 10.3673, lng: 77.9803 },
      { name: 'Karur', lat: 10.9601, lng: 78.0766 },
      { name: 'Ooty', lat: 11.4064, lng: 76.6932 },
      { name: 'Palakkad', lat: 10.7867, lng: 76.6548 },
      { name: 'Thrissur', lat: 10.5276, lng: 76.2144 }
    ]
  },
  {
    // Sheet's HQ column reads "Indore & Bhopal" (two cities) — hqCity is set
    // to Indore (listed first); Bhopal is separately one of the 3 covered
    // locations below, so it is still represented on the map either way.
    name: 'Hayana Enterprises', hqCity: 'Indore', hqState: 'Madhya Pradesh', lat: 22.7196, lng: 75.8577,
    locations: [
      { name: 'Dewas', lat: 22.9676, lng: 76.0534 },
      { name: 'Bhopal', lat: 23.2599, lng: 77.4126 },
      { name: 'Ujjain', lat: 23.1765, lng: 75.7885 }
    ]
  },
  {
    name: 'S S Medical System', hqCity: 'Gorakhpur', hqState: 'Uttar Pradesh', lat: 26.7606, lng: 83.3732,
    locations: [
      { name: 'Basti', lat: 26.8148, lng: 82.7274 },
      { name: 'Deoria', lat: 26.5024, lng: 83.7791 },
      // LOW CONFIDENCE (spec §4/§10): a small tehsil town in Gorakhpur
      // district; placed approximately near Gorakhpur. Revisit if a more
      // precise location is confirmed.
      { name: 'Campierganj', lat: 26.9333, lng: 83.4667 }
    ]
  },
  {
    name: 'Spandan Medi solutions', hqCity: 'Agra', hqState: 'Uttar Pradesh', lat: 27.1767, lng: 78.0081,
    locations: [
      { name: 'Mathura', lat: 27.4924, lng: 77.6737 },
      { name: 'Hathras', lat: 27.5959, lng: 78.0522 },
      { name: 'Aligarh', lat: 27.8974, lng: 78.0880 },
      { name: 'Bharatpur', lat: 27.2173, lng: 77.4901 }
    ]
  },
  {
    name: 'Techmed Solutions', hqCity: 'Ghaziabad', hqState: 'Uttar Pradesh', lat: 28.6692, lng: 77.4538,
    locations: [
      { name: 'New Delhi', lat: 28.6139, lng: 77.2090 },
      { name: 'Gurugram', lat: 28.4595, lng: 77.0266 },
      { name: 'Greater Noida', lat: 28.4744, lng: 77.5040 },
      { name: 'Noida', lat: 28.5355, lng: 77.3910 },
      { name: 'Modinagar', lat: 28.8324, lng: 77.5768 },
      { name: 'Hapur', lat: 28.7300, lng: 77.7800 }
    ]
  },
  {
    name: 'AM Agencies', hqCity: 'Bengaluru', hqState: 'Karnataka', lat: 12.9716, lng: 77.5946,
    locations: [
      { name: 'Hosur', lat: 12.7409, lng: 77.8253 }
    ]
  },
  {
    name: 'Pioneer Medical Devices', hqCity: 'Jaipur', hqState: 'Rajasthan', lat: 26.9124, lng: 75.7873,
    locations: [
      { name: 'Kota', lat: 25.2138, lng: 75.8648 },
      { name: 'Sikar', lat: 27.6094, lng: 75.1399 },
      { name: 'Alwar', lat: 27.5530, lng: 76.6346 }
    ]
  }
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/unit/cp-coverage.test.js`
Expected: PASS — 12 tests (7 from Task 1 + 5 from this task).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — all suites green (233 + 5 new = 238 tests).

- [ ] **Step 6: Commit**

```bash
git add src/server/Cp.js test/unit/cp-coverage.test.js
git commit -m "Server: populate CP_ROSTER with the 11-company BRM 2026 dealer network"
```

---

### Task 3: Wire the CP layer into `apiGetMapDataCD`

**Files:**
- Modify: `src/server/EditionCD.js`

**Interfaces:**
- Consumes: `CP_ROSTER`, `buildCpLayer_` from `Cp.js` (Tasks 1-2).
- Produces: `apiGetMapDataCD`'s payload gains a `cp` field:
  `{dealers, unlocatedRoster, unlocatedLocations}` or `null`. Consumed by Task 5's `App.html`
  wiring.

- [ ] **Step 1: Bump the cache key and add the `cp` field**

In `src/server/EditionCD.js`, find this comment block and cache-key line (currently):

```js
    // v13: ungeocoded centers (no direct lat/lng, no cached pin-geocode) are no
    // longer dropped outright — they're plotted at a proxy coordinate (the
    // average of already-geocoded centers sharing their city, else their hub),
    // per user 2026-08-21, so the map's count matches Customer 360 instead of
    // trailing it by however many centers runGeocodeBatch() hasn't reached yet.
    // Index 12 (approx) flags these so the client can mark them visually
    // distinct — they're a neighborhood-level guess, not the center's real spot.
    // v14: billable/machineTypes/deviceIds/macSerialIds filters added.
    // v15: payload gained `fse` (the coverage layer) — a v14 entry cached before
    // this deploy has no such key, and the client would read it as "no
    // engineers" for up to the 30-min TTL rather than as "not loaded yet".
    // NOTE: the key does not hash FSE_ROSTER, so a roster edit can serve a
    // stale layer until the entry expires (or getCacheEpoch_ moves).
    var cacheKey = 'mapcd_v15_' + getCacheEpoch_() + '_' + filterHash_(filters);
```

Replace with:

```js
    // v13: ungeocoded centers (no direct lat/lng, no cached pin-geocode) are no
    // longer dropped outright — they're plotted at a proxy coordinate (the
    // average of already-geocoded centers sharing their city, else their hub),
    // per user 2026-08-21, so the map's count matches Customer 360 instead of
    // trailing it by however many centers runGeocodeBatch() hasn't reached yet.
    // Index 12 (approx) flags these so the client can mark them visually
    // distinct — they're a neighborhood-level guess, not the center's real spot.
    // v14: billable/machineTypes/deviceIds/macSerialIds filters added.
    // v15: payload gained `fse` (the coverage layer) — a v14 entry cached before
    // this deploy has no such key, and the client would read it as "no
    // engineers" for up to the 30-min TTL rather than as "not loaded yet".
    // NOTE: the key does not hash FSE_ROSTER, so a roster edit can serve a
    // stale layer until the entry expires (or getCacheEpoch_ moves).
    // v16: payload gained `cp` (the dealer layer) — same reasoning as v15: a
    // v15 entry cached before this deploy has no `cp` key, and would read as
    // "no dealers" for up to the 30-min TTL rather than "not loaded yet".
    var cacheKey = 'mapcd_v16_' + getCacheEpoch_() + '_' + filterHash_(filters);
```

- [ ] **Step 2: Compute the `cp` layer next to the existing `fse` block**

Find:

```js
    var fse = null;
    if (fseRosterActive_().length) {
      var plottedIds = {};
      located.forEach(function (c) { plottedIds[String(c[0])] = true; });
      var fseRows = runQueriesParallel([buildFseCoverageSpec_()]).fseCoverage || [];
      fse = buildFseLayer_(fseRows, function (entry) {
        return coordsForCD_(
          { lat: entry.lat, lng: entry.lng, city: entry.hqCity, state: entry.hqState }, geoStore);
      }, plottedIds);
    }

    var payload = {
      centers: located, assets: assetRows, fse: fse,
      edition: 'center_details', flags: FLAGS_CD
    };
```

Replace with:

```js
    var fse = null;
    if (fseRosterActive_().length) {
      var plottedIds = {};
      located.forEach(function (c) { plottedIds[String(c[0])] = true; });
      var fseRows = runQueriesParallel([buildFseCoverageSpec_()]).fseCoverage || [];
      fse = buildFseLayer_(fseRows, function (entry) {
        return coordsForCD_(
          { lat: entry.lat, lng: entry.lng, city: entry.hqCity, state: entry.hqState }, geoStore);
      }, plottedIds);
    }

    // CP (Channel Partner) dealer layer (Cp.js). Unlike fse above, this needs
    // no query and no active-roster guard to skip a query cost — every
    // coordinate on CP_ROSTER is explicit (spec: docs/superpowers/specs/
    // 2026-08-24-cp-dealer-layer-design.md), so hqCoordFn/locationCoordFn are
    // trivial pass-throughs. Guarded on non-empty roster only so an empty
    // catalog sends `cp: null` (no layer) instead of an empty-but-present one.
    var cp = null;
    if (CP_ROSTER.length) {
      cp = buildCpLayer_(CP_ROSTER,
        function (entry) { return (entry.lat != null && entry.lng != null) ? [entry.lat, entry.lng] : null; },
        function (entry, loc) { return (loc.lat != null && loc.lng != null) ? [loc.lat, loc.lng] : null; });
    }

    var payload = {
      centers: located, assets: assetRows, fse: fse, cp: cp,
      edition: 'center_details', flags: FLAGS_CD
    };
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — no existing test asserts on `apiGetMapDataCD`'s exact payload shape (it requires
live BigQuery and is excluded from the unit tier, same as the pre-existing `fse` field), so this is
a regression check, not a new-test check.

- [ ] **Step 4: Commit**

```bash
git add src/server/EditionCD.js
git commit -m "Server: wire the CP dealer layer into apiGetMapDataCD's payload"
```

---

### Task 4: Client-side CP layer — markers, styling, legend

**Files:**
- Modify: `src/client/MapView.html`
- Modify: `src/client/Styles.html`
- Modify: `src/client/Index.html`

**Interfaces:**
- Produces (`MapView.html`'s returned module object gains): `setCp(dealers, onSelect)`,
  `focusCp(name)`, `clearCpFocus()`, `setCpVisible(visible)` — exact same call shapes as the
  existing `setFse`/`focusFse`/`clearFseFocus`/`setFseVisible`, but `dealers` entries carry
  `{name, hq, lat, lng, locations: [{name,lat,lng}]}` (no `centers`/`tickets`, and no `+N` grouping
  since no two entries share an HQ). Consumed by Task 5's `App.html` wiring.
- Produces (`Index.html`): `#cpLegend` (hidden by default), `#cpToggle` button, `#cpFocusBar` with
  `#cpFocusName`/`#cpFocusMeta`/`#cpFocusClear` — same id-naming convention as the FSE equivalents.

- [ ] **Step 1: Add CP layer state, color, and icon to `MapView.html`**

Find (near the top of the map factory function):

```js
  // FSE layer state. fseGroup holds the engineer pins (a plain LayerGroup, NOT
  // the marker cluster — engineers must never collapse into a count bubble the
  // way centers do; there are tens of them, and the whole point is that a named
  // person stays visible). reachGroup holds the focus-mode lines. markerById
  // lets focus mode restyle individual centers, which setData alone can't do.
  var fseGroup = null, reachGroup = null, fseMarkers = {}, markerById = {};
  var fseFocused = null, fseSelectHandler = null;
  var REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Violet, not the brand teal. Measured against both CARTO basemaps and the
  // three severity hues already on this map: teal #04E0B8 scores 1.13 against
  // the "no open tickets" green #34D399 — adjacent hue, near-identical
  // luminance — so every engineer would have read as another healthy center.
  // #8B5CF6 was the only candidate clearing 3:1 on dark (3.49) AND light (3.72)
  // while staying separable from green/amber/red (2.20/2.54/1.53).
  var FSE_COLOR = '#8B5CF6';
```

Replace with (adds CP state/color immediately after the FSE block):

```js
  // FSE layer state. fseGroup holds the engineer pins (a plain LayerGroup, NOT
  // the marker cluster — engineers must never collapse into a count bubble the
  // way centers do; there are tens of them, and the whole point is that a named
  // person stays visible). reachGroup holds the focus-mode lines. markerById
  // lets focus mode restyle individual centers, which setData alone can't do.
  var fseGroup = null, reachGroup = null, fseMarkers = {}, markerById = {};
  var fseFocused = null, fseSelectHandler = null;
  var REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Violet, not the brand teal. Measured against both CARTO basemaps and the
  // three severity hues already on this map: teal #04E0B8 scores 1.13 against
  // the "no open tickets" green #34D399 — adjacent hue, near-identical
  // luminance — so every engineer would have read as another healthy center.
  // #8B5CF6 was the only candidate clearing 3:1 on dark (3.49) AND light (3.72)
  // while staying separable from green/amber/red (2.20/2.54/1.53).
  var FSE_COLOR = '#8B5CF6';

  // CP (Channel Partner dealer) layer state. cpGroup holds the dealer pins;
  // cpReachGroup holds focus-mode fan-lines to covered locations. No
  // markerById-style center-restyling here (unlike FSE): CP coverage points
  // are independent geocoded districts, not existing center markers, so
  // focus mode draws its own small endpoint dots (see applyCpFocus_) instead
  // of re-styling anything already on the map.
  var cpGroup = null, cpReachGroup = null, cpMarkers = {};
  var cpFocused = null, cpSelectHandler = null;

  // Burnt orange, not FSE's violet or any of the three severity hues.
  // Computed the same way FSE_COLOR was: #C2410C clears 3:1 against both
  // basemaps (dark 3.62, light 5.18) and separates from green/amber/red
  // (2.69/3.10/1.87) at least as well as FSE_COLOR does. It sits closer to
  // violet by raw contrast (1.22) than to the others, but CP pins are also
  // shape-distinct (briefcase glyph vs. FSE's person glyph) — the same
  // "distinguish by shape, not just colour" principle the FSE layer above
  // already relies on for colour-vision accessibility.
  var CP_COLOR = '#C2410C';
```

- [ ] **Step 2: Add `cpIcon_` and the CP layer functions to `MapView.html`**

Find:

```js
  function setFseVisible(visible) {
    if (!fseGroup || !map) return;
    if (visible) { fseGroup.addTo(map); } else { clearFseFocus(); map.removeLayer(fseGroup); }
  }

  function focusByName(query, onClick) {
```

Replace with (inserts the whole CP block between `setFseVisible` and `focusByName`):

```js
  function setFseVisible(visible) {
    if (!fseGroup || !map) return;
    if (visible) { fseGroup.addTo(map); } else { clearFseFocus(); map.removeLayer(fseGroup); }
  }

  /* ── CP (Channel Partner dealer) layer ───────────────────────────
     Same "distinguish by shape" principle as the FSE layer above, with a
     briefcase glyph instead of a person. No same-HQ grouping: none of the
     roster's dealer companies share an HQ city (spec §7), so unlike
     fseIcon_/setFse there is no "+N" collapsing to do. */

  /** Briefcase pin. 24px glyph in a 44×44 box, same sizing as fseIcon_. */
  function cpIcon_(name, isFocused) {
    return L.divIcon({
      className: 'cp-pin' + (isFocused ? ' is-focused' : ''),
      iconSize: [44, 44], iconAnchor: [22, 22],
      html:
        '<span class="cp-glyph" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" width="24" height="24">' +
            '<rect x="3" y="7" width="18" height="13" rx="2"/>' +
            '<path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
            '<path d="M3 13h18"/>' +
          '</svg>' +
        '</span>' +
        '<span class="fse-name cp-name">' + esc(name) + '</span>'
    });
  }

  /**
   * Draws the dealer pins. `dealers` is the payload's cp.dealers array
   * ({name, hq, lat, lng, locations[]}). Called with a falsy/empty list this
   * clears the layer.
   */
  function setCp(dealers, onSelect) {
    cpSelectHandler = onSelect || null;
    if (!map) { pendingRender = function () { setCp(dealers, onSelect); }; return; }
    if (!cpGroup) { cpGroup = L.layerGroup().addTo(map); }
    cpGroup.clearLayers();
    cpMarkers = {};
    clearCpFocus();
    var list = dealers || [];
    if (!list.length) return;

    list.forEach(function (d) {
      var marker = L.marker([d.lat, d.lng], {
        icon: cpIcon_(d.name, false),
        keyboard: true, riseOnHover: true, zIndexOffset: 900
      });
      var n = (d.locations || []).length;
      marker.bindTooltip(
        '<strong>' + esc(d.name) + '</strong><br>' + esc(d.hq) +
        '<br>' + n + ' location' + (n === 1 ? '' : 's') + ' covered',
        { direction: 'top', className: 'cp-tip' }
      );
      marker.on('click', function () {
        // Toggle: clicking the focused dealer clears focus, mirroring the
        // FSE pin's own click behavior.
        if (cpFocused === d.name) { clearCpFocus(); if (cpSelectHandler) cpSelectHandler(null); return; }
        focusCp(d.name);
        if (cpSelectHandler) cpSelectHandler(d);
      });
      cpMarkers[d.name] = { marker: marker, data: d };
      cpGroup.addLayer(marker);
    });
  }

  /** Restores every dealer pin's default icon and removes the reach fan. */
  function clearCpFocus() {
    cpFocused = null;
    if (cpReachGroup) { cpReachGroup.clearLayers(); }
    Object.keys(cpMarkers).forEach(function (n) {
      var rec = cpMarkers[n];
      rec.marker.setIcon(cpIcon_(rec.data.name, false));
    });
  }

  function applyCpFocus_(name) {
    var rec = cpMarkers[name];
    if (!rec || !map) return;
    if (!cpReachGroup) { cpReachGroup = L.layerGroup().addTo(map); }
    cpReachGroup.clearLayers();

    // Unlike FSE's focus mode, there is no existing center marker to ring —
    // covered locations are independent geocoded points, so the fan draws its
    // own small endpoint dot at each one, with the location's name in a
    // tooltip.
    var hq = [rec.data.lat, rec.data.lng];
    var locations = rec.data.locations || [];
    function drawOne(loc) {
      cpReachGroup.addLayer(L.polyline([hq, [loc.lat, loc.lng]], {
        color: CP_COLOR, weight: 1.25, opacity: 0.5, interactive: false
      }));
      cpReachGroup.addLayer(L.circleMarker([loc.lat, loc.lng], {
        radius: 4, color: CP_COLOR, weight: 1.5,
        fillColor: CP_COLOR, fillOpacity: 0.6, interactive: false
      }).bindTooltip(esc(loc.name), { direction: 'top' }));
    }
    if (REDUCED_MOTION) {
      locations.forEach(drawOne);
    } else {
      // Staggered fan-out, same technique as applyFseFocus_ — setTimeout, not
      // a CSS/SVG stroke animation, since the map runs preferCanvas.
      locations.forEach(function (loc, i) {
        setTimeout(function () { if (cpFocused === name) drawOne(loc); }, i * 15);
      });
    }

    rec.marker.setIcon(cpIcon_(rec.data.name, true));
  }

  function focusCp(name) {
    clearCpFocus();
    cpFocused = name;
    applyCpFocus_(name);
  }

  function setCpVisible(visible) {
    if (!cpGroup || !map) return;
    if (visible) { cpGroup.addTo(map); } else { clearCpFocus(); map.removeLayer(cpGroup); }
  }

  function focusByName(query, onClick) {
```

- [ ] **Step 3: Extend the module's returned object**

Find:

```js
  return {
    ensureMap: ensureMap, setData: setData, focusByName: focusByName, setTheme: setTheme,
    setFse: setFse, focusFse: focusFse, clearFseFocus: clearFseFocus,
    focusFseByName: focusFseByName, setFseVisible: setFseVisible
  };
}
```

Replace with:

```js
  return {
    ensureMap: ensureMap, setData: setData, focusByName: focusByName, setTheme: setTheme,
    setFse: setFse, focusFse: focusFse, clearFseFocus: clearFseFocus,
    focusFseByName: focusFseByName, setFseVisible: setFseVisible,
    setCp: setCp, focusCp: focusCp, clearCpFocus: clearCpFocus, setCpVisible: setCpVisible
  };
}
```

- [ ] **Step 4: Add CP styling to `Styles.html`**

Find:

```css
.fse-tip-rule { border: 0; border-top: 1px solid var(--border); margin: 5px 0; }
```

Replace with (adds the CP rules directly after the FSE tooltip rule, before the focus-active
comment block):

```css
.fse-tip-rule { border: 0; border-top: 1px solid var(--border); margin: 5px 0; }

/* CP (Channel Partner dealer) pins — same casing/halo technique as .fse-glyph
   above, burnt orange (#C2410C, see MapView.html's CP_COLOR comment for the
   contrast math) instead of violet, briefcase glyph instead of a person. */
.cp-pin {
  display: grid; place-items: center;
  background: none; border: 0;
}
.cp-glyph { display: grid; place-items: center; width: 44px; height: 44px; }
.cp-glyph svg {
  fill: none; stroke: #C2410C; stroke-width: 2.2;
  stroke-linecap: round; stroke-linejoin: round;
  paint-order: stroke;
  filter: drop-shadow(0 0 1.5px #0B1220) drop-shadow(0 0 1.5px #0B1220);
}
body[data-theme="light"] .cp-glyph svg {
  filter: drop-shadow(0 0 1.5px #FFFFFF) drop-shadow(0 0 1.5px #FFFFFF);
}
.cp-name {
  color: #FFF1E7; background: rgba(11, 18, 32, 0.82);
  border: 1px solid rgba(194, 65, 12, 0.6);
}
body[data-theme="light"] .cp-name {
  color: #7C2D12; background: rgba(255, 255, 255, 0.92);
  border-color: rgba(194, 65, 12, 0.6);
}
.cp-pin.is-focused .cp-glyph svg { stroke-width: 2.8; }
.cp-pin.is-focused .cp-name {
  color: #fff; background: #C2410C; border-color: #C2410C;
}
.cp-pin:focus-visible .cp-glyph {
  outline: 2px solid #C2410C; outline-offset: 2px; border-radius: 50%;
}
```

Find:

```css
.map-legend-fse { flex-wrap: wrap; }
.legend-dot-fse { background: #8B5CF6; }
.legend-dot-gap {
  background: transparent; border: 2px solid #F87171; box-sizing: border-box;
}
```

Replace with:

```css
.map-legend-fse { flex-wrap: wrap; }
.legend-dot-fse { background: #8B5CF6; }
.legend-dot-gap {
  background: transparent; border: 2px solid #F87171; box-sizing: border-box;
}
.map-legend-cp { flex-wrap: wrap; }
.legend-dot-cp { background: #C2410C; }
```

Find:

```css
.fse-focus-bar {
  position: absolute; left: 12px; top: 12px; z-index: 500;
  display: flex; align-items: center; gap: 10px;
  max-width: calc(100% - 24px);
  padding: 8px 10px 8px 12px;
  border-radius: var(--radius-sm);
  background: rgba(4, 18, 34, 0.9);
  border: 1px solid rgba(139, 92, 246, 0.55);
  box-shadow: var(--shadow-card);
  animation: rise 200ms var(--ease-out) both;
}
body[data-theme="light"] .fse-focus-bar {
  background: rgba(255, 255, 255, 0.95);
  border-color: rgba(139, 92, 246, 0.5);
}
```

Replace with (adds a `.cp-focus-bar` variant right after — reuses `.fse-focus-name`/
`.fse-focus-meta`'s layout rules verbatim by sharing those classes in the markup, so only the
bar's own background/border need a CP-colored counterpart):

```css
.fse-focus-bar {
  position: absolute; left: 12px; top: 12px; z-index: 500;
  display: flex; align-items: center; gap: 10px;
  max-width: calc(100% - 24px);
  padding: 8px 10px 8px 12px;
  border-radius: var(--radius-sm);
  background: rgba(4, 18, 34, 0.9);
  border: 1px solid rgba(139, 92, 246, 0.55);
  box-shadow: var(--shadow-card);
  animation: rise 200ms var(--ease-out) both;
}
body[data-theme="light"] .fse-focus-bar {
  background: rgba(255, 255, 255, 0.95);
  border-color: rgba(139, 92, 246, 0.5);
}
/* CP's focus bar reuses .fse-focus-bar's layout (position/flex/padding/
   shadow/animation) via the SAME class in Index.html's markup — only the
   accent border differs, via this modifier class stacked alongside it. */
.cp-focus-bar { border-color: rgba(194, 65, 12, 0.55); }
body[data-theme="light"] .cp-focus-bar { border-color: rgba(194, 65, 12, 0.5); }
```

- [ ] **Step 5: Add the CP legend row and focus bar to `Index.html`**

Find:

```html
      <div class="map-legend map-legend-fse" id="fseLegend" role="group" aria-label="Engineer coverage" hidden>
        <button id="fseToggle" class="legend-filter" type="button" aria-pressed="true">
          <span class="legend-dot legend-dot-fse"></span><span id="fseToggleLabel">Engineers</span>
        </button>
        <button class="legend-filter" type="button" id="fseGapFilter" data-bucket="gap" aria-pressed="false">
          <span class="legend-dot legend-dot-gap"></span>Coverage gaps
        </button>
        <span class="legend-note" id="fseWindowNote"></span>
      </div>
      </div><!-- /.map-legend-stack -->

      <!-- Focus bar: appears only while one engineer is selected. Carries the
           Clear action, which is one of three escape routes from focus mode
           (the others being Esc and re-clicking the pin). -->
      <div class="fse-focus-bar" id="fseFocusBar" role="status" hidden>
        <span class="fse-focus-name" id="fseFocusName"></span>
        <span class="fse-focus-meta" id="fseFocusMeta"></span>
        <button class="btn btn-ghost btn-sm" type="button" id="fseFocusClear">Clear</button>
      </div>
    </div>
```

Replace with:

```html
      <div class="map-legend map-legend-fse" id="fseLegend" role="group" aria-label="Engineer coverage" hidden>
        <button id="fseToggle" class="legend-filter" type="button" aria-pressed="true">
          <span class="legend-dot legend-dot-fse"></span><span id="fseToggleLabel">Engineers</span>
        </button>
        <button class="legend-filter" type="button" id="fseGapFilter" data-bucket="gap" aria-pressed="false">
          <span class="legend-dot legend-dot-gap"></span>Coverage gaps
        </button>
        <span class="legend-note" id="fseWindowNote"></span>
      </div>

      <!-- Dealer (CP) layer toggle. Own row, own hidden guard — same
           reasoning as the engineer row above: no dead chrome if the roster
           is ever emptied, even though it ships populated today. -->
      <div class="map-legend map-legend-cp" id="cpLegend" role="group" aria-label="Dealer coverage" hidden>
        <button id="cpToggle" class="legend-filter" type="button" aria-pressed="true">
          <span class="legend-dot legend-dot-cp"></span>Dealers
        </button>
      </div>
      </div><!-- /.map-legend-stack -->

      <!-- Focus bar: appears only while one engineer is selected. Carries the
           Clear action, which is one of three escape routes from focus mode
           (the others being Esc and re-clicking the pin). -->
      <div class="fse-focus-bar" id="fseFocusBar" role="status" hidden>
        <span class="fse-focus-name" id="fseFocusName"></span>
        <span class="fse-focus-meta" id="fseFocusMeta"></span>
        <button class="btn btn-ghost btn-sm" type="button" id="fseFocusClear">Clear</button>
      </div>

      <!-- Same three-escape-route convention as the engineer focus bar. -->
      <div class="fse-focus-bar cp-focus-bar" id="cpFocusBar" role="status" hidden>
        <span class="fse-focus-name" id="cpFocusName"></span>
        <span class="fse-focus-meta" id="cpFocusMeta"></span>
        <button class="btn btn-ghost btn-sm" type="button" id="cpFocusClear">Clear</button>
      </div>
    </div>
```

- [ ] **Step 6: Commit**

```bash
git add src/client/MapView.html src/client/Styles.html src/client/Index.html
git commit -m "Client: CP dealer pins, focus-mode fan lines, and Dealers legend toggle"
```

---

### Task 5: Wire the CP layer into `App.html` and verify end-to-end

**Files:**
- Modify: `src/client/App.html`

**Interfaces:**
- Consumes: `MapView.setCp/focusCp/clearCpFocus/setCpVisible` (Task 4), `state.mapBundle.cp` (Task 3's
  payload field, arriving via the existing `loadMapData()`/`gsCall(ep('apiGetMapData'), ...)` call —
  no change needed to the fetch itself).

- [ ] **Step 1: Render the CP layer whenever the map data refreshes**

Find:

```js
    mainMap.setData(centers, CenterDetail.open);
    renderFseLayer_(fse);
  }
```

Replace with:

```js
    mainMap.setData(centers, CenterDetail.open);
    renderFseLayer_(fse);
    renderCpLayer_(state.mapBundle.cp || null);
  }
```

Find:

```js
    if (fse.unlocatedRoster && fse.unlocatedRoster.length) {
      console.warn('[SIP] roster entries whose HQ could not be located (add lat/lng, or geocode the city):',
        fse.unlocatedRoster);
    }
  }

  /** Shows/hides the focus bar. `group` is the clicked pin's engineers, or null. */
  function setFseFocusBar_(group) {
```

Replace with (inserts the two new functions between `renderFseLayer_`'s closing brace and
`setFseFocusBar_`, leaving `setFseFocusBar_` itself untouched):

```js
    if (fse.unlocatedRoster && fse.unlocatedRoster.length) {
      console.warn('[SIP] roster entries whose HQ could not be located (add lat/lng, or geocode the city):',
        fse.unlocatedRoster);
    }
  }

  /**
   * Draws the dealer layer and its toggle, or hides both when the payload
   * carries no dealers. `cp` is null on a payload cached before the layer
   * existed (see the mapcd_v16 note in EditionCD.js) or if CP_ROSTER is ever
   * emptied, which is why the guard tests for the object rather than for an
   * empty dealers array.
   */
  function renderCpLayer_(cp) {
    var legend = $('cpLegend');
    if (!legend) return;
    var dealers = (cp && cp.dealers) || [];
    legend.hidden = !dealers.length;
    if (!dealers.length) { mainMap.setCp([]); setCpFocusBar_(null); return; }

    mainMap.setCp(dealers, setCpFocusBar_);
    mainMap.setCpVisible(state.cpVisible !== false);
    $('cpToggle').setAttribute('aria-pressed', String(state.cpVisible !== false));

    if (cp.unlocatedRoster && cp.unlocatedRoster.length) {
      console.warn('[SIP] CP roster entries whose HQ could not be located (add lat/lng):',
        cp.unlocatedRoster);
    }
    if (cp.unlocatedLocations && cp.unlocatedLocations.length) {
      console.warn('[SIP] CP covered locations that could not be located (add lat/lng):',
        cp.unlocatedLocations);
    }
  }

  function setCpFocusBar_(dealer) {
    var bar = $('cpFocusBar');
    if (!bar) return;
    if (!dealer) { bar.hidden = true; return; }
    var n = (dealer.locations || []).length;
    $('cpFocusName').textContent = dealer.name;
    $('cpFocusMeta').textContent = dealer.hq + ' — ' + FMT.format(n) + ' location' + (n === 1 ? '' : 's') + ' covered';
    bar.hidden = false;
  }

  /** Shows/hides the focus bar. `group` is the clicked pin's engineers, or null. */
  function setFseFocusBar_(group) {
```

- [ ] **Step 2: Wire the legend toggle and focus-clear button, and extend Escape handling**

Find:

```js
    $('fseToggle').addEventListener('click', function () {
      state.fseVisible = !state.fseVisible;
      $('fseToggle').setAttribute('aria-pressed', String(state.fseVisible));
      mainMap.setFseVisible(state.fseVisible);
      if (!state.fseVisible) setFseFocusBar_(null);
    });
```

Replace with:

```js
    $('fseToggle').addEventListener('click', function () {
      state.fseVisible = !state.fseVisible;
      $('fseToggle').setAttribute('aria-pressed', String(state.fseVisible));
      mainMap.setFseVisible(state.fseVisible);
      if (!state.fseVisible) setFseFocusBar_(null);
    });

    $('cpToggle').addEventListener('click', function () {
      state.cpVisible = !state.cpVisible;
      $('cpToggle').setAttribute('aria-pressed', String(state.cpVisible));
      mainMap.setCpVisible(state.cpVisible);
      if (!state.cpVisible) setCpFocusBar_(null);
    });
```

Find:

```js
    $('fseFocusClear').addEventListener('click', function () {
      mainMap.clearFseFocus();
      setFseFocusBar_(null);
    });
    document.addEventListener('keydown', function (event) {
      // Ordered after the drawer's own Escape handler above: with the drawer
      // open, Escape should close the drawer and leave the engineer focused,
      // which is why this checks the drawer is already shut.
      if (event.key === 'Escape' && $('centerDrawer').hidden && !$('fseFocusBar').hidden) {
        mainMap.clearFseFocus();
        setFseFocusBar_(null);
      }
    });
```

Replace with:

```js
    $('fseFocusClear').addEventListener('click', function () {
      mainMap.clearFseFocus();
      setFseFocusBar_(null);
    });
    $('cpFocusClear').addEventListener('click', function () {
      mainMap.clearCpFocus();
      setCpFocusBar_(null);
    });
    document.addEventListener('keydown', function (event) {
      // Ordered after the drawer's own Escape handler above: with the drawer
      // open, Escape should close the drawer and leave the engineer/dealer
      // focused, which is why this checks the drawer is already shut.
      if (event.key !== 'Escape' || !$('centerDrawer').hidden) return;
      if (!$('fseFocusBar').hidden) { mainMap.clearFseFocus(); setFseFocusBar_(null); }
      if (!$('cpFocusBar').hidden) { mainMap.clearCpFocus(); setCpFocusBar_(null); }
    });
```

- [ ] **Step 3: Add a `cp` mock branch for the local preview**

Find (the FSE demo mock inside the `apiGetMapData` mock branch):

```js
        fse: (function () {
          var roster = [
            { name: 'Demo FSE North', hq: 'Delhi, Delhi', lat: 28.61, lng: 77.21 },
            { name: 'Demo FSE West', hq: 'Pune, Maharashtra', lat: 18.52, lng: 73.85 },
            { name: 'Demo FSE South', hq: 'Bengaluru, Karnataka', lat: 12.97, lng: 77.59 },
            { name: 'Demo FSE Coast', hq: 'Kochi, Kerala', lat: 9.93, lng: 76.27 }
          ];
          var coveredAll = {};
          var engineers = roster.map(function (e, i) {
            // Every 4th center from a rotating offset — deterministic, so the
            // fan doesn't reshuffle on each refresh, and overlapping enough to
            // leave some centers uncovered (the coverage gaps the layer is for).
            var mine = [];
            for (var k = i; k < 140; k += 4) { mine.push(String(pts[k][0])); coveredAll[String(pts[k][0])] = true; }
            return {
              name: e.name, hq: e.hq, lat: e.lat, lng: e.lng,
              centers: mine, tickets: mine.length * rnd(1, 4), territory: []
            };
          });
          return {
            engineers: engineers,
            unmatchedReps: [{ rep: 'Unrostered Demo Rep', tickets: 12 }],
            unlocatedRoster: [], coveredCenterIds: Object.keys(coveredAll), windowDays: 90
          };
        })(),
```

Replace with (adds a `cp` sibling key right after `fse`'s closing `,`):

```js
        fse: (function () {
          var roster = [
            { name: 'Demo FSE North', hq: 'Delhi, Delhi', lat: 28.61, lng: 77.21 },
            { name: 'Demo FSE West', hq: 'Pune, Maharashtra', lat: 18.52, lng: 73.85 },
            { name: 'Demo FSE South', hq: 'Bengaluru, Karnataka', lat: 12.97, lng: 77.59 },
            { name: 'Demo FSE Coast', hq: 'Kochi, Kerala', lat: 9.93, lng: 76.27 }
          ];
          var coveredAll = {};
          var engineers = roster.map(function (e, i) {
            // Every 4th center from a rotating offset — deterministic, so the
            // fan doesn't reshuffle on each refresh, and overlapping enough to
            // leave some centers uncovered (the coverage gaps the layer is for).
            var mine = [];
            for (var k = i; k < 140; k += 4) { mine.push(String(pts[k][0])); coveredAll[String(pts[k][0])] = true; }
            return {
              name: e.name, hq: e.hq, lat: e.lat, lng: e.lng,
              centers: mine, tickets: mine.length * rnd(1, 4), territory: []
            };
          });
          return {
            engineers: engineers,
            unmatchedReps: [{ rep: 'Unrostered Demo Rep', tickets: 12 }],
            unlocatedRoster: [], coveredCenterIds: Object.keys(coveredAll), windowDays: 90
          };
        })(),
        // Demo dealer layer — exercises the CP layer locally without touching
        // the real (committed, populated) CP_ROSTER server-side. Two dealers,
        // one with several covered locations (to see the fan-out) and one
        // with just one (to see the single-line case).
        cp: {
          dealers: [
            {
              name: 'Demo Dealer Corp', hq: 'Nagpur, Maharashtra', lat: 21.15, lng: 79.09,
              locations: [
                { name: 'Wardha', lat: 20.75, lng: 78.60 },
                { name: 'Chandrapur', lat: 19.95, lng: 79.30 },
                { name: 'Gondia', lat: 21.46, lng: 80.19 }
              ]
            },
            {
              name: 'Demo Single-Location Dealer', hq: 'Jaipur, Rajasthan', lat: 26.91, lng: 75.79,
              locations: [{ name: 'Kota', lat: 25.21, lng: 75.86 }]
            }
          ],
          unlocatedRoster: [], unlocatedLocations: []
        },
```

- [ ] **Step 4: Add `state.cpVisible` next to `state.fseVisible`**

Find:

```js
    fseVisible: true,   // engineer pins on the map (layer toggle)
    mapGapsOnly: false, // show only centers with open tickets and no FSE coverage
```

Replace with:

```js
    fseVisible: true,   // engineer pins on the map (layer toggle)
    cpVisible: true,    // dealer pins on the map (layer toggle)
    mapGapsOnly: false, // show only centers with open tickets and no FSE coverage
```

- [ ] **Step 5: Build and run the local preview**

Run: `powershell -File scripts/build_preview.ps1` (or `pwsh -File scripts/build_preview.ps1`,
whichever is on PATH — this is a long-running server, run it in the background)

Then, in a browser, open `http://localhost:8765/preview.html` and verify:
- The Overview map's legend now shows a third row: a "Dealers" toggle with an orange dot.
- Two orange briefcase pins render (Nagpur, Jaipur), visually distinct in shape and color from the
  violet person-shaped FSE pins.
- Hovering the Nagpur pin shows "Demo Dealer Corp / Nagpur, Maharashtra / 3 locations covered".
- Clicking the Nagpur pin fans out three lines to small orange dots at Wardha/Chandrapur/Gondia, and
  the top-left focus bar shows "Demo Dealer Corp — Nagpur, Maharashtra — 3 locations covered" with a
  Clear button.
- Clicking Clear (or pressing Escape, or re-clicking the pin) removes the fan and hides the focus bar.
- Clicking the "Dealers" toggle hides both dealer pins; clicking again restores them.
- Repeat the same checks in light theme (the sun/moon toggle in the header).

- [ ] **Step 6: Run the full test suite one more time**

Run: `npm test`
Expected: PASS — this task touches no server logic, so this is a final regression check before
committing.

- [ ] **Step 7: Commit**

```bash
git add src/client/App.html
git commit -m "Client: wire the CP dealer layer into the map, legend toggle, and local preview mock"
```

- [ ] **Step 8: Stop the local preview server**

If it was started in the foreground, `Ctrl+C`. If backgrounded, stop the task by whatever means
started it (e.g. `TaskStop` if using the Claude Code harness).

---

## Post-plan verification (not a task — a reminder for whoever deploys this)

Before the stable Apps Script deployment is touched:
- `clasp push` and check the `@HEAD` test deployment first, same convention as every other
  map-affecting change this project has shipped (see `688d8d2`/`6148bc8`'s history).
- Confirm the live BigQuery-backed `apiGetMapDataCD` payload actually carries a populated `cp` field
  (the local preview only proves the client renders `cp` correctly — it does not prove the server
  wiring from Task 3 executes against real data without error).
- Bump `CONFIG.APP_VERSION`/`APP_DEPLOYED_AT` in `src/server/Config.js` in the same change as the
  `clasp deploy`, per this project's standing convention.
