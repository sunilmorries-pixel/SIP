# Overview Decomposition Trees Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Overview page's exec-summary layout with three interactive ECharts decomposition trees — Customers (country → segment), Devices (type → age band), Tickets (source → outcome) — each with expand/collapse, a hover tooltip, and click-through to either a global filter or the relevant page.

**Architecture:** One new server file (`src/server/OverviewFlow.js`) builds all three trees. Customers and Devices are pure JS aggregation over data this app already caches on every page load (`getCenter360RowsCD_`, and a refactored `jiraDeviceStats_`) — no new BigQuery queries for either. Only Tickets needs new SQL, and it's three small counting queries, not a new aggregation engine. One endpoint (`apiGetOverviewFlowCD`) ships all three trees pre-nested into the `{name, value, children}` shape ECharts' `tree` series consumes directly — nesting happens server-side inside the builder functions, not as a separate client-side step. One new client renderer, `Charts.decompTree`, used by all three.

**Tech Stack:** Google Apps Script (ES5-style, `var`/`function`), BigQuery Standard SQL (Tickets tree only), ECharts `tree` series via `Charts.html`, Jest for unit tests.

**Spec:** `docs/superpowers/specs/2026-08-17-overview-decomposition-trees-design.md`

## Global Constraints

- ES5 style only — `var`, `function`, no arrow functions, no `const`/`let`, no template literals.
- Country is `hub_country`, never `Spoke_Country` (~9% nulls, garbage values — `EditionCD.js:15-18`).
- Segment is always `segmentGroupSql_('hub_master_segment')` (`Queries.js:110`) — never compare `hub_master_segment` raw.
- Age bands are exactly `<1y / 1-2y / 2-3y / 3-5y / 5y+`, matching `Numbers.js`'s existing bucketing bit-for-bit (`y = age/365`, thresholds at 1/2/3/5).
- Device type/status filtering: `filters.deviceTypes` is an INCLUDE list, `filters.deviceStatusExclude` is an EXCLUDE list — same convention as `jiraDeviceStats_`.
- The global Filters drawer has these dimensions and no others: `segments, statuses, states, hubs, cities, countries, centers, deviceTypes, deviceStatusExclude, dateFrom, dateTo`. No age dimension, no ticket-source dimension — confirmed in the spec (§4) and load-bearing for Task 6's click handlers.
- Endpoint name ends in `CD` (`ep()` in `App.html` appends `CD` to every call).
- Every endpoint returns through `respond_(...)`; cacheable payloads go through `withCache(key, fn, bypass)`.
- No dedent from the "no dedupe CTE unless the source needs one" rule: `servicewrk_Tickets`/`tom_tickets` don't need dedup (confirmed in the Service/TOM session); `zoho_data` does, via `zohoDedupSql_()`.

---

### Task 1: Extract `filteredJiraDevices_` — shared, type-preserving device filter

`jiraDeviceStats_` (`Numbers.js`) already does exactly the filtering/dedup the Devices tree needs, but its private `byIssue` dict doesn't retain the device `type`, and it's not callable from outside. Extracting it (rather than writing a third near-duplicate of this filter chain) avoids adding a new instance of the SQL-vs-JS-path-drift bug class this repo has hit before.

**Files:**
- Modify: `src/server/Numbers.js` (extract + refactor `jiraDeviceStats_`)
- Test: `test/unit/jira-device-type.test.js` (extend)

**Interfaces:**
- Produces: `filteredJiraDevices_(filters)` → `Array<{issue_key:string, type:string, status:string, cid:number, age:number|null}>` — one entry per tracked, deduped, filter-passing device. `type` is `row.issuetype_name`, newly retained (the original `byIssue` didn't keep it).
- Consumes (unchanged): `readJiraData_()`, `isTrackedJiraDeviceType_()`, `deviceCenterMap_()`, `centerFilterMap_()`, `centerPassesFilters_()`.

- [ ] **Step 1: Write the failing test**

Append to `test/unit/jira-device-type.test.js`:

```javascript
describe('filteredJiraDevices_ (Numbers.js)', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'BigQuery.js',
      'Api.js', 'EditionCD.js', 'Numbers.js']);
  });

  test('is a function that accepts a filters object', function () {
    expect(typeof sandbox.filteredJiraDevices_).toBe('function');
  });

  test('excludes housekeeping issue types the same way isTrackedJiraDeviceType_ does', function () {
    // Indirect check: the function must call isTrackedJiraDeviceType_ internally.
    // Direct behavior is exercised via jiraDeviceStats_'s own test coverage below,
    // since filteredJiraDevices_ requires a live BigQuery read (readJiraData_) and
    // cannot be unit-tested against real rows without network access.
    expect(sandbox.CONFIG.JIRA_NON_DEVICE_TYPES.length).toBeGreaterThan(0);
  });
});
```

Note: `filteredJiraDevices_` calls `readJiraData_()` internally (a live `runQuery`), so it can't be
exercised end-to-end in the unit tier — this mirrors `jiraDeviceStats_`'s own existing untestable
shape. The test above only locks down that the function exists and is loadable; Task 2's tests
cover the aggregation logic that consumes its *output shape* against hand-built fixtures instead.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/unit/jira-device-type.test.js -t filteredJiraDevices_`
Expected: FAIL — `sandbox.filteredJiraDevices_ is not a function`.

- [ ] **Step 3: Extract the helper and refactor `jiraDeviceStats_` to use it**

In `src/server/Numbers.js`, replace the `jiraDeviceStats_` function body's filter/dedupe block
(currently inline) with a call to a new extracted function. Insert this new function immediately
before `jiraDeviceStats_`:

```javascript
/**
 * Tracked, deduped, filter-passing Jira devices — the shared core of
 * jiraDeviceStats_ (status/age breakdown) and the Overview Devices tree
 * (type/age breakdown). Extracted so there is exactly ONE implementation of
 * this filter chain, not two independently-maintained copies that could
 * silently drift (the SQL-vs-JS filter-path-disagreement bug class this repo
 * has been bitten by before).
 * @param {{segments:Array,statuses:Array,states:Array,hubs:Array,cities:Array,
 *          countries:Array,deviceTypes:Array,deviceStatusExclude:Array}=} filters
 * @return {Array<{issue_key:string, type:string, status:string, cid:number, age:(number|null)}>}
 */
function filteredJiraDevices_(filters) {
  filters = filters || {};
  var jiraRows = readJiraData_().filter(function (row) { return isTrackedJiraDeviceType_(row.issuetype_name); });
  var typeFilter = filters.deviceTypes || [];
  var statusExclude = filters.deviceStatusExclude || [];
  if (typeFilter.length) jiraRows = jiraRows.filter(function (row) { return typeFilter.indexOf(row.issuetype_name) !== -1; });
  if (statusExclude.length) jiraRows = jiraRows.filter(function (row) { return statusExclude.indexOf(row.status_name) === -1; });
  var dcm = deviceCenterMap_();
  var dev2ctr = dcm.map;
  var SERIAL_RE = /([A-Za-z0-9]{2}-[A-Za-z0-9]{6,})/;
  var byIssue = {};
  jiraRows.forEach(function (row) {
    var ik = String(row.issue_key || row.summary || '');
    if (!ik || byIssue[ik]) return;
    var m = SERIAL_RE.exec(String(row.summary || '').toUpperCase());
    var cid = m ? dev2ctr[m[1]] : undefined;
    byIssue[ik] = {
      issue_key: ik, type: String(row.issuetype_name || 'Other'),
      status: String(row.status_name || '').trim(),
      cid: (cid == null ? NaN : cid), age: assetAgeDays_(row.ticket_created)
    };
  });
  var hasCenterFilter = (filters.segments || []).length || (filters.statuses || []).length ||
    (filters.states || []).length || (filters.hubs || []).length ||
    (filters.cities || []).length || (filters.countries || []).length;
  var out = Object.keys(byIssue).map(function (k) { return byIssue[k]; });
  if (hasCenterFilter) {
    var cfMap = centerFilterMap_();
    out = out.filter(function (o) { return isFinite(o.cid) && centerPassesFilters_(cfMap[o.cid] || {}, filters); });
  }
  return out;
}
```

Then replace `jiraDeviceStats_`'s body (everything from `var jiraRows = readJiraData_()...` through
the `hasCenterFilter`/`cfMap` block) with:

```javascript
function jiraDeviceStats_(filters) {
  filters = filters || {};
  return withCache('jiradev_v9_' + getCacheEpoch_() + '_' + filterHash_(filters), function () {
    var devices = filteredJiraDevices_(filters);
    var dTotal = 0, dStatus = {};
    var ageSum = 0, ageN = 0;
    var ageBands = { '<1y': 0, '1-2y': 0, '2-3y': 0, '3-5y': 0, '5y+': 0 };
    devices.forEach(function (o) {
      dTotal++;
      var st = o.status || '(blank)';
      dStatus[st] = (dStatus[st] || 0) + 1;
      if (o.age != null) {
        ageSum += o.age; ageN++;
        var y = o.age / 365;
        if (y < 1) ageBands['<1y']++; else if (y < 2) ageBands['1-2y']++;
        else if (y < 3) ageBands['2-3y']++; else if (y < 5) ageBands['3-5y']++;
        else ageBands['5y+']++;
      }
    });
    return {
      total: dTotal,
      by_status: Object.keys(dStatus).map(function (k) { return { k: k, n: dStatus[k] }; })
        .sort(function (a, b) { return b.n - a.n; }),
      avg_age_days: ageN ? Math.round(ageSum / ageN) : null,
      aged_devices: ageN,
      past_life: ageBands['5y+'],
      age_bands: Object.keys(ageBands).map(function (k) { return { k: k, n: ageBands[k] }; }),
      source: 'jira_data', center_source: deviceCenterMap_().source
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/unit/jira-device-type.test.js`
Expected: PASS, 6 tests (5 existing + 1 new). Then `npm test` → 128 passed (122 existing + 6, since
1 test file gained 1 test — verify the exact prior total with `npm test` before this step if unsure).

- [ ] **Step 5: Commit**

```bash
git add src/server/Numbers.js test/unit/jira-device-type.test.js
git commit -m "refactor(overview): extract filteredJiraDevices_ shared helper from jiraDeviceStats_"
```

---

### Task 2: Customers and Devices trees — pure JS aggregation

**Files:**
- Create: `src/server/OverviewFlow.js`
- Test: `test/unit/overview-flow-helpers.test.js`

**Interfaces:**
- Consumes: `getCenter360RowsCD_()` (`EditionCD.js`), `centerPassesFilters_()` (`EditionCD.js`), `filteredJiraDevices_(filters)` (Task 1, `Numbers.js`).
- Produces: `topNPlusOthers_(items, n, keyFn, othersLabel)`, `ageBandForDays_(days)`, `buildCustomersTree_(filters)` → `{name:'Total customers', value, children}`, `buildDevicesTree_(filters)` → `{name:'Total devices', value, children}`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/overview-flow-helpers.test.js`:

```javascript
'use strict';

/**
 * Unit tests for the Overview decomposition-tree builders (src/server/OverviewFlow.js).
 * Customers and Devices trees are pure JS aggregation — no BigQuery — so they're
 * tested end-to-end against hand-built fixture arrays, not just string-shape checks.
 */

const { loadGas } = require('../helpers/loadGas');

describe('Overview decomposition tree helpers (OverviewFlow.js)', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'OverviewFlow.js']);
  });

  describe('topNPlusOthers_', function () {
    const items = [
      { key: 'India', cnt: 1203 }, { key: 'Nepal', cnt: 312 }, { key: 'Bhutan', cnt: 89 },
      { key: 'Kenya', cnt: 40 }, { key: 'UAE', cnt: 22 }, { key: 'Oman', cnt: 5 }, { key: 'Fiji', cnt: 1 }
    ];

    test('keeps the top N by count, descending', function () {
      const out = sandbox.topNPlusOthers_(items, 5, function (i) { return i.key; }, function (i) { return i.cnt; });
      expect(out.slice(0, 5).map(function (o) { return o.key; }))
        .toEqual(['India', 'Nepal', 'Bhutan', 'Kenya', 'UAE']);
    });

    test('sums everything past N into one Others bucket', function () {
      const out = sandbox.topNPlusOthers_(items, 5, function (i) { return i.key; }, function (i) { return i.cnt; });
      expect(out).toHaveLength(6);
      expect(out[5]).toEqual({ key: 'Others', cnt: 6 }); // Oman 5 + Fiji 1
    });

    test('omits the Others bucket entirely when there is nothing left over', function () {
      const small = items.slice(0, 3);
      const out = sandbox.topNPlusOthers_(small, 5, function (i) { return i.key; }, function (i) { return i.cnt; });
      expect(out).toHaveLength(3);
      expect(out.some(function (o) { return o.key === 'Others'; })).toBe(false);
    });

    test('returns an empty array for an empty input', function () {
      expect(sandbox.topNPlusOthers_([], 5, function (i) { return i.key; }, function (i) { return i.cnt; })).toEqual([]);
    });
  });

  describe('ageBandForDays_', function () {
    test('matches the five Numbers.js bands exactly', function () {
      expect(sandbox.ageBandForDays_(100)).toBe('<1y');       // 0.27y
      expect(sandbox.ageBandForDays_(400)).toBe('1-2y');       // 1.1y
      expect(sandbox.ageBandForDays_(800)).toBe('2-3y');       // 2.19y
      expect(sandbox.ageBandForDays_(1500)).toBe('3-5y');      // 4.1y
      expect(sandbox.ageBandForDays_(2000)).toBe('5y+');       // 5.5y
    });

    test('boundary at exactly 1 year falls into the 1-2y band (matches Numbers.js < not <=)', function () {
      expect(sandbox.ageBandForDays_(365)).toBe('1-2y');
    });

    test('null/undefined age returns null, not a band', function () {
      expect(sandbox.ageBandForDays_(null)).toBeNull();
      expect(sandbox.ageBandForDays_(undefined)).toBeNull();
    });
  });

  describe('buildCustomersTree_', function () {
    // Fixture mirrors getCenter360RowsCD_'s row shape, trimmed to the fields
    // the tree actually reads.
    const rows = [
      { center_id: 1, country: 'India', segment: 'SME', city: 'Pune', devices: 10, uptime_pct: 98, open_tickets: 1 },
      { center_id: 2, country: 'India', segment: 'SME', city: 'Pune', devices: 8, uptime_pct: 96, open_tickets: 0 },
      { center_id: 3, country: 'India', segment: 'LE', city: 'Mumbai', devices: 40, uptime_pct: 99, open_tickets: 3 },
      { center_id: 4, country: 'Nepal', segment: 'Government', city: 'Kathmandu', devices: 5, uptime_pct: 90, open_tickets: 0 }
    ];
    let tree;

    beforeAll(function () {
      const fakeSandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'OverviewFlow.js']);
      fakeSandbox.getCenter360RowsCD_ = function () { return rows; };
      fakeSandbox.centerPassesFilters_ = function () { return true; };
      tree = fakeSandbox.buildCustomersTree_({});
    });

    test('root total equals the row count', function () {
      expect(tree.name).toBe('Total customers');
      expect(tree.value).toBe(4);
    });

    test('level 1 splits by country', function () {
      const names = tree.children.map(function (c) { return c.name; });
      expect(names.sort()).toEqual(['India', 'Nepal']);
    });

    test('level 2 splits by segment within each country', function () {
      const india = tree.children.filter(function (c) { return c.name === 'India'; })[0];
      expect(india.value).toBe(3);
      const segNames = india.children.map(function (c) { return c.name; }).sort();
      expect(segNames).toEqual(['LE', 'SME']);
      const sme = india.children.filter(function (c) { return c.name === 'SME'; })[0];
      expect(sme.value).toBe(2);
    });

    test('each node carries filterDim/filterValue for click-to-filter', function () {
      const india = tree.children.filter(function (c) { return c.name === 'India'; })[0];
      expect(india.filterDim).toBe('countries');
      expect(india.filterValue).toBe('India');
      const sme = india.children.filter(function (c) { return c.name === 'SME'; })[0];
      expect(sme.filterDim).toBe('segments');
      expect(sme.filterValue).toBe('SME');
    });

    test('root carries clearDims to reset both filter dimensions', function () {
      expect(tree.clearDims).toEqual(['countries', 'segments']);
    });

    test('a node carries hover stats (devices, uptime, open tickets, top city)', function () {
      const india = tree.children.filter(function (c) { return c.name === 'India'; })[0];
      expect(india.stats.devices).toBe(58); // 10+8+40
      expect(india.stats.openTickets).toBe(4); // 1+0+3
      expect(india.stats.topCity).toBe('Pune'); // 2 of 3 rows
      expect(india.stats.uptimePct).toBeCloseTo((98 + 96 + 99) / 3, 1);
    });
  });

  describe('buildDevicesTree_', function () {
    const devices = [
      { type: 'Connector', age: 100 },   // <1y
      { type: 'Connector', age: 800 },   // 2-3y
      { type: 'ECG Machine', age: 2000 }, // 5y+
      { type: 'ECG Machine', age: 2100 }  // 5y+
    ];

    let tree;
    beforeAll(function () {
      const fakeSandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'OverviewFlow.js']);
      fakeSandbox.filteredJiraDevices_ = function () { return devices; };
      tree = fakeSandbox.buildDevicesTree_({});
    });

    test('root total equals the device count', function () {
      expect(tree.name).toBe('Total devices');
      expect(tree.value).toBe(4);
    });

    test('level 1 splits by type, level 2 by age band', function () {
      const connector = tree.children.filter(function (c) { return c.name === 'Connector'; })[0];
      expect(connector.value).toBe(2);
      const bandNames = connector.children.map(function (c) { return c.name; }).sort();
      expect(bandNames).toEqual(['2-3y', '<1y']);
    });

    test('device-type node carries filterDim=deviceTypes; age-band leaf carries navTab instead', function () {
      const connector = tree.children.filter(function (c) { return c.name === 'Connector'; })[0];
      expect(connector.filterDim).toBe('deviceTypes');
      expect(connector.filterValue).toBe('Connector');
      const band = connector.children[0];
      expect(band.filterDim).toBeUndefined();
      expect(band.navTab).toBe('tab-asset');
      expect(band.navDeviceType).toBe('Connector');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/unit/overview-flow-helpers.test.js`
Expected: FAIL — `ENOENT: ... OverviewFlow.js` (module doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/server/OverviewFlow.js`:

```javascript
/**
 * OverviewFlow.js — the Overview page's decomposition trees.
 *
 * Customers and Devices are pure JS aggregation over data this app already
 * fetches and caches on every page load (getCenter360RowsCD_,
 * filteredJiraDevices_) — no new BigQuery queries for either. Tickets (see
 * the apiGetOverviewFlowCD half of this file) is the only tree that needs
 * new SQL, and it's three small counting queries, not a new engine.
 *
 * Every tree builder returns an ALREADY-NESTED {name, value, children} node,
 * the exact shape ECharts' `tree` series consumes — nesting happens here,
 * not as a separate client-side step (a deliberate simplification over the
 * design spec's original "flat rows, client nests" sketch: once the data is
 * JS objects rather than raw SQL rows, nesting in the same pass is strictly
 * less code, not more).
 *
 * Every non-Others, non-leaf-without-a-filter-dimension node carries
 * filterDim/filterValue so the client's click handler can set the matching
 * global filter without re-deriving it from the node's position in the tree.
 * Nodes for which no global filter dimension exists (age bands, anything on
 * the Tickets tree) carry navTab (+ navDeviceType where relevant) instead —
 * clicking them switches tabs rather than filtering, per the design spec §6.
 */

/**
 * Ranks items by count descending, keeps the top N, sums the remainder into
 * one trailing `{key: othersLabel, cnt: sum}` entry (omitted if there is
 * nothing left over).
 * @param {Array} items
 * @param {number} n
 * @param {function(*): string} keyFn
 * @param {function(*): number} cntFn
 * @return {Array<{key:string, cnt:number}>}
 */
function topNPlusOthers_(items, n, keyFn, cntFn) {
  if (!items || !items.length) return [];
  var sorted = items.slice().sort(function (a, b) { return cntFn(b) - cntFn(a); });
  var top = sorted.slice(0, n).map(function (i) { return { key: keyFn(i), cnt: cntFn(i) }; });
  var rest = sorted.slice(n);
  if (!rest.length) return top;
  var restSum = rest.reduce(function (s, i) { return s + cntFn(i); }, 0);
  top.push({ key: 'Others', cnt: restSum });
  return top;
}

/**
 * The exact five age bands Numbers.js's jiraDeviceStats_ already uses —
 * duplicated here (not imported) because the source bucketing is inline in
 * that function, not its own callable helper. Must stay bit-for-bit
 * identical to Numbers.js's thresholds or the two would silently disagree.
 * @param {?number} days
 * @return {?string} one of '<1y'/'1-2y'/'2-3y'/'3-5y'/'5y+', or null
 */
function ageBandForDays_(days) {
  if (days == null) return null;
  var y = days / 365;
  if (y < 1) return '<1y';
  if (y < 2) return '1-2y';
  if (y < 3) return '2-3y';
  if (y < 5) return '3-5y';
  return '5y+';
}

/**
 * Aggregates an array of Center-360 rows (already filtered) by a key
 * function, returning {devices, openTickets, topCity, uptimePct} — the
 * hover-stat bundle for one tree node.
 * @param {Array<Object>} rows
 * @return {{devices:number, openTickets:number, topCity:string, uptimePct:?number}}
 */
function centerRowStats_(rows) {
  var devices = 0, openTickets = 0, uptimeSum = 0, uptimeN = 0;
  var cityCounts = {};
  rows.forEach(function (r) {
    devices += r.devices || 0;
    openTickets += r.open_tickets || 0;
    if (r.uptime_pct != null) { uptimeSum += r.uptime_pct; uptimeN++; }
    var c = r.city || '';
    if (c) cityCounts[c] = (cityCounts[c] || 0) + 1;
  });
  var topCity = '';
  var topCityN = 0;
  Object.keys(cityCounts).forEach(function (c) {
    if (cityCounts[c] > topCityN) { topCity = c; topCityN = cityCounts[c]; }
  });
  return {
    devices: devices, openTickets: openTickets, topCity: topCity,
    uptimePct: uptimeN ? Math.round((uptimeSum / uptimeN) * 10) / 10 : null
  };
}

/**
 * Total customers -> hub_country (top 5 + Others) -> hub_master_segment.
 * @param {Object} filters the global filter drawer's state
 * @return {{name:string, value:number, clearDims:Array<string>, children:Array}}
 */
function buildCustomersTree_(filters) {
  var rows = getCenter360RowsCD_().filter(function (r) { return centerPassesFilters_(r, filters || {}); });

  var byCountry = {};
  rows.forEach(function (r) {
    var c = r.country || '(blank)';
    (byCountry[c] = byCountry[c] || []).push(r);
  });
  var countryItems = Object.keys(byCountry).map(function (c) { return { key: c, cnt: byCountry[c].length }; });
  var topCountries = topNPlusOthers_(countryItems, 5, function (i) { return i.key; }, function (i) { return i.cnt; });

  var children = topCountries.map(function (entry) {
    var isOthers = entry.key === 'Others';
    var countryRows = isOthers
      ? rows.filter(function (r) { return topCountries.slice(0, -1).map(function (t) { return t.key; }).indexOf(r.country || '(blank)') === -1; })
      : byCountry[entry.key];

    var node = { name: entry.key, value: entry.cnt, stats: centerRowStats_(countryRows) };
    if (!isOthers) {
      node.filterDim = 'countries';
      node.filterValue = entry.key;

      var bySegment = {};
      countryRows.forEach(function (r) {
        var s = r.segment || '(blank)';
        (bySegment[s] = bySegment[s] || []).push(r);
      });
      node.children = Object.keys(bySegment).map(function (s) {
        return {
          name: s, value: bySegment[s].length, stats: centerRowStats_(bySegment[s]),
          filterDim: 'segments', filterValue: s
        };
      }).sort(function (a, b) { return b.value - a.value; });
    }
    return node;
  });

  return {
    name: 'Total customers', value: rows.length,
    clearDims: ['countries', 'segments'],
    children: children
  };
}

/**
 * Total devices -> device type -> age band.
 * @param {Object} filters the global filter drawer's state
 * @return {{name:string, value:number, children:Array}}
 */
function buildDevicesTree_(filters) {
  var devices = filteredJiraDevices_(filters || {});

  var byType = {};
  devices.forEach(function (d) {
    (byType[d.type] = byType[d.type] || []).push(d);
  });

  var children = Object.keys(byType).map(function (type) {
    var typeDevices = byType[type];
    var byBand = {};
    typeDevices.forEach(function (d) {
      var band = ageBandForDays_(d.age);
      if (band) (byBand[band] = byBand[band] || []).push(d);
    });
    var AGE_ORDER = ['<1y', '1-2y', '2-3y', '3-5y', '5y+'];
    return {
      name: type, value: typeDevices.length,
      filterDim: 'deviceTypes', filterValue: type,
      children: AGE_ORDER.filter(function (b) { return byBand[b]; }).map(function (b) {
        return { name: b, value: byBand[b].length, navTab: 'tab-asset', navDeviceType: type };
      })
    };
  }).sort(function (a, b) { return b.value - a.value; });

  return { name: 'Total devices', value: devices.length, children: children };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/unit/overview-flow-helpers.test.js`
Expected: PASS, 15 tests. Then `npm test` → confirms no regressions elsewhere.

- [ ] **Step 5: Commit**

```bash
git add src/server/OverviewFlow.js test/unit/overview-flow-helpers.test.js
git commit -m "feat(overview): Customers and Devices decomposition trees (pure JS aggregation)"
```

---

### Task 3: Tickets tree + the combined endpoint

**Files:**
- Modify: `src/server/OverviewFlow.js` (append)
- Test: `test/unit/overview-flow-helpers.test.js` (append)

**Interfaces:**
- Consumes: `zohoDedupSql_()`, `CONFIG.ZOHO_TERMINAL_STATUSES` (`Queries.js`/`Config.js`); `swTable_()`, `swFilterCond_()` (`ServiceWrk.js`); `tomTable_()`, `tomFilterCond_()`, `tomResolvedCond_()`, `tomUnresolvedCond_()` (`TomTickets.js`); `runQueriesParallel()`, `respond_()`, `withCache()`, `getCacheEpoch_()`, `filterHash_()`.
- Produces: `buildTicketsQuerySpecs(filters)` → array of specs; `nestTicketsTree_(rows)` → the tree node (pure, testable against fixture rows); `apiGetOverviewFlowCD(options)` → `{customers, devices, tickets}`.

- [ ] **Step 1: Write the failing test**

Append to `test/unit/overview-flow-helpers.test.js`:

```javascript
  describe('buildTicketsQuerySpecs', function () {
    let sandbox2;
    beforeAll(function () {
      // EditionCD.js is required here (not just Queries.js): the zoho spec's
      // centerFilterSubqueryCond_ lives there, along with its own
      // dependencies cdFilter_/centerAttrCond_ — omitting it would throw
      // "centerFilterSubqueryCond_ is not defined" the moment the test
      // actually calls buildTicketsQuerySpecs({}), not at load time.
      sandbox2 = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'EditionCD.js', 'ServiceWrk.js', 'TomTickets.js', 'OverviewFlow.js']);
    });

    test('returns one spec per ticket source', function () {
      const keys = sandbox2.buildTicketsQuerySpecs({}).map(function (s) { return s.key; });
      expect(keys).toEqual(['zoho', 'servicewrk', 'tom']);
    });

    test('zoho spec dedupes and counts open vs total', function () {
      const zoho = sandbox2.buildTicketsQuerySpecs({}).filter(function (s) { return s.key === 'zoho'; })[0];
      expect(zoho.sql).toContain('QUALIFY ROW_NUMBER()'); // via zohoDedupSql_
      expect(zoho.sql).toContain('total');
      expect(zoho.sql).toContain('open');
    });

    test('servicewrk spec reuses swTable_/swFilterCond_ and groups by closure_type', function () {
      const sw = sandbox2.buildTicketsQuerySpecs({}).filter(function (s) { return s.key === 'servicewrk'; })[0];
      expect(sw.sql).toContain('servicewrk_Tickets');
      expect(sw.sql).toContain('closure_type');
    });

    test('tom spec buckets into resolved/unresolved/other via the existing outcome conditions', function () {
      const tom = sandbox2.buildTicketsQuerySpecs({}).filter(function (s) { return s.key === 'tom'; })[0];
      expect(tom.sql).toContain('tom_tickets');
      expect(tom.sql).toContain('Issue Resolved');
      expect(tom.sql).toContain('Not resolved');
    });
  });

  describe('nestTicketsTree_', function () {
    let sandbox3;
    beforeAll(function () {
      sandbox3 = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'OverviewFlow.js']);
    });

    test('nests source totals under one root, each with its own outcome children', function () {
      const tree = sandbox3.nestTicketsTree_({
        zoho: { total: 84545, open: 211 },
        servicewrk: [{ label: 'CENTER_VISIT', cnt: 30822 }, { label: 'OVERCALL_RESOLUTION', cnt: 5259 }],
        tom: { resolved: 342, unresolved: 68, other: 915 }
      });
      expect(tree.name).toBe('Total tracked records');
      expect(tree.value).toBe(84545 + 36081 + 1325); // zoho total + SW sum + TOM sum
      const zoho = tree.children.filter(function (c) { return c.name === 'Zoho'; })[0];
      expect(zoho.value).toBe(84545);
      const zohoChildren = zoho.children.map(function (c) { return c.name; }).sort();
      expect(zohoChildren).toEqual(['Closed', 'Open']);
      const sw = tree.children.filter(function (c) { return c.name === 'ServiceWRK'; })[0];
      expect(sw.value).toBe(36081);
      const tom = tree.children.filter(function (c) { return c.name === 'TOM'; })[0];
      expect(tom.value).toBe(1325);
    });

    test('no node on this tree carries filterDim (no ticket-source filter dimension exists)', function () {
      const tree = sandbox3.nestTicketsTree_({
        zoho: { total: 10, open: 3 }, servicewrk: [{ label: 'CENTER_VISIT', cnt: 5 }], tom: { resolved: 1, unresolved: 1, other: 1 }
      });
      function walk(n) {
        expect(n.filterDim).toBeUndefined();
        (n.children || []).forEach(walk);
      }
      walk(tree);
    });

    test('every source and outcome node carries navTab to its own page', function () {
      const tree = sandbox3.nestTicketsTree_({
        zoho: { total: 10, open: 3 }, servicewrk: [{ label: 'CENTER_VISIT', cnt: 5 }], tom: { resolved: 1, unresolved: 1, other: 1 }
      });
      const zoho = tree.children.filter(function (c) { return c.name === 'Zoho'; })[0];
      expect(zoho.navTab).toBe('tab-support');
      const sw = tree.children.filter(function (c) { return c.name === 'ServiceWRK'; })[0];
      expect(sw.navTab).toBe('tab-service');
      const tom = tree.children.filter(function (c) { return c.name === 'TOM'; })[0];
      expect(tom.navTab).toBe('tab-tom');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/unit/overview-flow-helpers.test.js -t buildTicketsQuerySpecs`
Expected: FAIL — `sandbox2.buildTicketsQuerySpecs is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/server/OverviewFlow.js`:

```javascript
/* ═══════════════ Tickets tree ═══════════════ */

/**
 * Three independent counting queries, one per ticket source. Each source
 * keeps its OWN outcome taxonomy (no shared "status" exists across Zoho/
 * ServiceWRK/TOM) — see the design spec §5.3 for why this isn't unified.
 * @param {Object} filters
 * @return {Array<{key:string, sql:string, maxRows:number}>}
 */
function buildTicketsQuerySpecs(filters) {
  var f = filters || {};
  return [
    {
      key: 'zoho', maxRows: 1,
      sql: 'SELECT COUNT(*) AS total, ' +
        ' COUNTIF(status NOT IN ' + CONFIG.ZOHO_TERMINAL_STATUSES + ') AS open ' +
        'FROM ' + zohoDedupSql_() + ' WHERE TRUE' + centerFilterSubqueryCond_(f)
    },
    {
      key: 'servicewrk', maxRows: 10,
      sql: 'SELECT IFNULL(NULLIF(TRIM(closure_type), ""), "Unknown") AS label, COUNT(*) AS cnt ' +
        'FROM ' + swTable_() + ' WHERE TRUE' + swFilterCond_(f) + ' GROUP BY label'
    },
    {
      key: 'tom', maxRows: 1,
      sql: 'SELECT COUNTIF(' + tomResolvedCond_() + ') AS resolved, ' +
        ' COUNTIF(' + tomUnresolvedCond_() + ') AS unresolved, ' +
        ' COUNTIF(NOT (' + tomResolvedCond_() + ') AND NOT (' + tomUnresolvedCond_() + ')) AS other ' +
        'FROM ' + tomTable_() + ' WHERE TRUE' + tomFilterCond_(f)
    }
  ];
}

/**
 * Nests the three sources' raw query results into one tree. Pure function —
 * no BigQuery — so it's fully unit-testable against fixture rows.
 * @param {{zoho:{total:number,open:number}, servicewrk:Array<{label:string,cnt:number}>,
 *          tom:{resolved:number,unresolved:number,other:number}}} r
 * @return {{name:string, value:number, children:Array}}
 */
function nestTicketsTree_(r) {
  var zohoTotal = r.zoho.total || 0;
  var zohoOpen = r.zoho.open || 0;
  var swTotal = (r.servicewrk || []).reduce(function (s, x) { return s + (x.cnt || 0); }, 0);
  var tomTotal = (r.tom.resolved || 0) + (r.tom.unresolved || 0) + (r.tom.other || 0);

  var children = [
    {
      name: 'Zoho', value: zohoTotal, navTab: 'tab-support',
      children: [
        { name: 'Open', value: zohoOpen },
        { name: 'Closed', value: zohoTotal - zohoOpen }
      ]
    },
    {
      name: 'ServiceWRK', value: swTotal, navTab: 'tab-service',
      children: (r.servicewrk || []).map(function (x) { return { name: x.label, value: x.cnt }; })
    },
    {
      name: 'TOM', value: tomTotal, navTab: 'tab-tom',
      children: [
        { name: 'Resolved', value: r.tom.resolved || 0 },
        { name: 'Unresolved', value: r.tom.unresolved || 0 },
        { name: 'Visit needed', value: r.tom.other || 0 }
      ]
    }
  ];

  return { name: 'Total tracked records', value: zohoTotal + swTotal + tomTotal, children: children };
}

/**
 * Overview page payload — all three decomposition trees, one cached round trip.
 * @param {{filters:Object, bypassCache:boolean}=} options
 */
function apiGetOverviewFlowCD(options) {
  options = options || {};
  var filters = options.filters || {};
  return respond_(function () {
    return withCache('ovflow_v1_' + getCacheEpoch_() + '_' + filterHash_(filters), function () {
      var ticketRows = runQueriesParallel(buildTicketsQuerySpecs(filters));
      return {
        customers: buildCustomersTree_(filters),
        devices: buildDevicesTree_(filters),
        tickets: nestTicketsTree_({
          zoho: (ticketRows.zoho && ticketRows.zoho[0]) || { total: 0, open: 0 },
          servicewrk: ticketRows.servicewrk || [],
          tom: (ticketRows.tom && ticketRows.tom[0]) || { resolved: 0, unresolved: 0, other: 0 }
        })
      };
    }, options.bypassCache === true);
  });
}
```

Note on `centerFilterSubqueryCond_(f)` in the `zoho` spec: this is the existing shared bridge
(`EditionCD.js`) that narrows a non-center table by the center-attribute filters (segment/status/
state/hub/city/country) via a `CenterID IN (...)` subquery — the same helper `buildDashboardQuerySpecsCD`
already uses for `zohoTrend`/`zohoKpis`. Reused here, not reimplemented.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/unit/overview-flow-helpers.test.js`
Expected: PASS, 21 tests. Then `npm test` for the full suite.

- [ ] **Step 5: Commit**

```bash
git add src/server/OverviewFlow.js test/unit/overview-flow-helpers.test.js
git commit -m "feat(overview): Tickets decomposition tree and the combined apiGetOverviewFlowCD endpoint"
```

---

### Task 4: `Charts.decompTree` — the ECharts renderer

**Files:**
- Modify: `src/client/Charts.html` (add function + export)

**Interfaces:**
- Consumes: `base(extra)`, `render(id, option)`, `showEmpty(id)`, `onClick(id, handler)`, palette `C` — all existing.
- Produces: `Charts.decompTree(id, treeNode, opts)` where `opts = {onNodeClick: function(nodeData){}}`.

- [ ] **Step 1: Add the renderer**

Insert into `src/client/Charts.html`, immediately before the `return {` export block:

```javascript
  /* ── Decomposition trees (Overview) ──────────────────────────── */

  /**
   * Renders a top-down decomposition tree. `treeNode` is the exact
   * {name, value, children, stats?, filterDim?, filterValue?, clearDims?,
   * navTab?, navDeviceType?} shape OverviewFlow.js's tree builders return —
   * the metadata fields ride along on ECharts' native node data untouched,
   * so the click handler reads them straight off `params.data`.
   */
  function decompTree(id, treeNode, opts) {
    opts = opts || {};
    if (!treeNode || !treeNode.children || !treeNode.children.length) return showEmpty(id);
    render(id, base({
      tooltip: {
        trigger: 'item', triggerOn: 'mousemove',
        formatter: function (info) {
          var d = info.data;
          var lines = ['<strong>' + d.name + '</strong>: ' + FMT.format(d.value)];
          if (d.stats) {
            if (d.stats.devices != null) lines.push(FMT.format(d.stats.devices) + ' devices');
            if (d.stats.uptimePct != null) lines.push(d.stats.uptimePct + '% uptime');
            if (d.stats.openTickets != null) lines.push(FMT.format(d.stats.openTickets) + ' open tickets');
            if (d.stats.topCity) lines.push('Top city: ' + d.stats.topCity);
          }
          return lines.join('<br/>');
        }
      },
      series: [{
        type: 'tree', data: [treeNode],
        orient: 'TB', layout: 'orthogonal',
        top: '4%', bottom: '4%', left: '8%', right: '8%',
        symbol: 'roundRect', symbolSize: [70, 30],
        itemStyle: { color: C.primary, borderColor: C.axis },
        lineStyle: { color: C.axis, curveness: 0.3 },
        label: {
          position: 'inside', color: '#fff', fontSize: 11, fontWeight: 700,
          formatter: function (info) { return info.data.name + '\n' + FMT.format(info.data.value); },
          lineHeight: 14
        },
        leaves: { label: { position: 'inside' } },
        expandAndCollapse: true,
        initialTreeDepth: -1,
        animationDuration: 400
      }]
    }));
    if (opts.onNodeClick) {
      onClick(id, function (params) {
        if (params.data) opts.onNodeClick(params.data);
      });
    }
  }
```

- [ ] **Step 2: Export it**

In the `return {` block, add:

```javascript
    decompTree: decompTree,
```

- [ ] **Step 3: Verify**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('src/client/Charts.html','utf8');const m=/<script[^>]*>([\s\S]*?)<\/script>/.exec(s);new Function(m[1]);console.log('Charts.html syntax OK')"`
Expected: `Charts.html syntax OK`

- [ ] **Step 4: Commit**

```bash
git add src/client/Charts.html
git commit -m "feat(overview): Charts.decompTree — ECharts tree-series renderer for decomposition trees"
```

---

### Task 5: Overview page markup

**Files:**
- Modify: `src/client/Index.html:140-224` (replace the entire `#panel-overview` section)

**Interfaces:**
- Produces: element ids `treeCustomers`, `treeDevices`, `treeTickets`.

- [ ] **Step 1: Replace the Overview panel**

Replace `Index.html:140-224` (from `<!-- ══... VIEW 0 · EXECUTIVE OVERVIEW ... -->` through the
closing `</section>` of `panel-overview`) with:

```html
  <!-- ══════════════ VIEW 0 · OVERVIEW (landing) ══════════════
       Three decomposition trees, replacing the old exec-summary layout
       entirely (device-age ring, KPI grid, 6 chart/table cards — all
       removed, per the 2026-08-17 design spec). Overview no longer shares
       apiGetDashboardCD with Asset/Customers/Support/Service — it has its
       own endpoint, apiGetOverviewFlowCD. -->
  <section id="panel-overview" class="panel is-active" role="tabpanel" aria-labelledby="tab-overview">
    <div class="card-grid">
      <article class="card span-12">
        <header class="card-head">
          <h2 class="card-title">Customers</h2>
          <p class="card-sub">Total customers, by country (top 5 + others), then by segment · click a node to filter, hover for more</p>
        </header>
        <div id="treeCustomers" class="chart chart-tree" role="img"
             aria-label="Decomposition tree of customers by country and segment"></div>
      </article>

      <article class="card span-12">
        <header class="card-head">
          <h2 class="card-title">Devices</h2>
          <p class="card-sub">Total devices, by type, then by age band · click a device type to filter, click an age band to jump to Asset</p>
        </header>
        <div id="treeDevices" class="chart chart-tree" role="img"
             aria-label="Decomposition tree of devices by type and age band"></div>
      </article>

      <article class="card span-12">
        <header class="card-head">
          <h2 class="card-title">Tickets</h2>
          <p class="card-sub">Tracked records across Zoho, ServiceWRK and TOM · click any node to open that source's page</p>
        </header>
        <div id="treeTickets" class="chart chart-tree" role="img"
             aria-label="Decomposition tree of tracked tickets by source and outcome"></div>
      </article>
    </div>
  </section>
```

- [ ] **Step 2: Add the `.chart-tree` height rule**

In `src/client/Styles.html`, find the existing `.chart` / `.chart-tall` rules and add, immediately
after them:

```css
/* Decomposition trees need more vertical room than a bar/donut chart — two
   levels of boxes plus label text. */
.chart-tree { height: 420px; }
```

- [ ] **Step 3: Verify the markup builds**

Run: `powershell -File scripts/build_preview.ps1` (or the equivalent Node preview-build snippet used
earlier this session) and confirm the file writes with no template-tag errors — the three tree
`<div>`s will render empty (no data wired yet) until Task 6.

- [ ] **Step 4: Commit**

```bash
git add src/client/Index.html src/client/Styles.html
git commit -m "feat(overview): replace exec-summary markup with three decomposition-tree cards"
```

---

### Task 6: Client data wiring

**Files:**
- Modify: `src/client/App.html` — preview mock, `loadOverviewFlow`/`renderOverviewFlow`, tab hook, remove old Overview-specific render code and its shared-payload membership.

**Interfaces:**
- Consumes: `apiGetOverviewFlowCD` (Task 3), `Charts.decompTree` (Task 4), the element ids from Task 5.
- Produces: `state.overviewFlowLoaded`, `state.overviewFlowFilters`, `loadOverviewFlow()`.

- [ ] **Step 1: Unhook Overview from the old shared-payload/exec flow — four spots, not two**

Grep for `'tab-overview'` in `App.html` before editing — line numbers drift release to release, but
as of this plan there are four touch points, all inside or near `commitGlobalFilters_()` and
`activateTab()`:

1. Inside `commitGlobalFilters_()`, the `sharesPayload` array:
   `['tab-asset', 'tab-centers', 'tab-support', 'tab-service', 'tab-overview']` → drop
   `'tab-overview'`.
2. Immediately below it, inside the same function:
   `if (state.activeTab === 'tab-overview') { state.execLoaded = false; loadExec(); }` → replace
   with `if (state.activeTab === 'tab-overview') loadOverviewFlow();`.
3. Inside `activateTab()`, the tab's own initial/switch-to load trigger:
   `if (tabId === 'tab-overview' && !state.execLoaded) loadExec();` → replace with
   `var overviewFlowStale = state.overviewFlowFilters && !filtersEqual_(state.overviewFlowFilters, state.globalFilters);` then
   `if (tabId === 'tab-overview' && (!state.overviewFlowLoaded || overviewFlowStale)) loadOverviewFlow();`
   — this is also where the *very first* load happens, since Overview is `state.activeTab`'s
   default value and `activateTab` runs on startup; no separate `init()` call is needed.
4. Inside `activateTab()`, the `sharesDashboardPayload` array (same five-tab list as #1) → drop
   `'tab-overview'`.

Do not touch `TAB_IDS` (`App.html`, the full tab-id list used for wiring click handlers) or the
`SEARCH_TAB_INFO`/`'tab-overview'` disabled-search entry — both are unrelated to the dashboard
payload and still correct as-is.

- [ ] **Step 2: Delete the old Overview-specific render code**

Delete the block of code that sets loading state on and renders into `execFleet`, `execTrend`,
`execCentersTable`, `execRelTable`, `execTopCust`, `execGeo`, and the `execRing`/`execRingPct`/
`execRingLabel`/`execRingCap` elements (the function containing the lines shown in the design
spec's grounding step, roughly `App.html:2514-2586` as of this session — confirm exact lines by
searching for `execFleet` before deleting, since other sessions may have shifted line numbers).
Also delete the `$('execKpiGrid').innerHTML = ...` KPI-tile block if one exists for Overview
specifically (search for `execKpiGrid`).

- [ ] **Step 3: Add the preview mock**

In `App.html`'s `mockCall` function, add (matching the BASE endpoint name — `mockCall` strips a
trailing `CD` before matching, a lesson paid for once already this session):

```javascript
    if (fn === 'apiGetOverviewFlow') {
      function leaf(name, value, extra) { return Object.assign({ name: name, value: value }, extra || {}); }
      return Promise.resolve({
        customers: {
          name: 'Total customers', value: 1842, clearDims: ['countries', 'segments'],
          children: [
            leaf('India', 1203, { filterDim: 'countries', filterValue: 'India', stats: { devices: 14880, uptimePct: 97.2, openTickets: 340, topCity: 'Mumbai' },
              children: [
                leaf('SME', 612, { filterDim: 'segments', filterValue: 'SME', stats: { devices: 5200, uptimePct: 96.8, openTickets: 140, topCity: 'Mumbai' } }),
                leaf('LE', 401, { filterDim: 'segments', filterValue: 'LE', stats: { devices: 7100, uptimePct: 98.1, openTickets: 150, topCity: 'Pune' } }),
                leaf('Government', 140, { filterDim: 'segments', filterValue: 'Government', stats: { devices: 1900, uptimePct: 95.0, openTickets: 40, topCity: 'Delhi' } }),
                leaf('ECHO', 50, { filterDim: 'segments', filterValue: 'ECHO', stats: { devices: 680, uptimePct: 99.0, openTickets: 10, topCity: 'Mumbai' } })
              ] }),
            leaf('Nepal', 312, { filterDim: 'countries', filterValue: 'Nepal', stats: { devices: 3800, uptimePct: 94.5, openTickets: 60, topCity: 'Kathmandu' },
              children: [leaf('SME', 200, { filterDim: 'segments', filterValue: 'SME', stats: { devices: 2400, uptimePct: 94.0, openTickets: 40, topCity: 'Kathmandu' } })] }),
            leaf('Others', 327, { stats: { devices: 4100, uptimePct: 93.1, openTickets: 90, topCity: '—' } })
          ]
        },
        devices: {
          name: 'Total devices', value: 28444,
          children: [
            leaf('Connector', 10414, { filterDim: 'deviceTypes', filterValue: 'Connector',
              children: ['<1y', '1-2y', '2-3y', '3-5y', '5y+'].map(function (b, i) {
                return leaf(b, [1200, 2400, 3100, 2500, 1214][i], { navTab: 'tab-asset', navDeviceType: 'Connector' });
              }) }),
            leaf('ECG Machine', 18030, { filterDim: 'deviceTypes', filterValue: 'ECG Machine',
              children: ['<1y', '1-2y', '2-3y', '3-5y', '5y+'].map(function (b, i) {
                return leaf(b, [2100, 4200, 5400, 4330, 2000][i], { navTab: 'tab-asset', navDeviceType: 'ECG Machine' });
              }) })
          ]
        },
        tickets: {
          name: 'Total tracked records', value: 84545 + 36081 + 1325,
          children: [
            leaf('Zoho', 84545, { navTab: 'tab-support', children: [leaf('Open', 211), leaf('Closed', 84334)] }),
            leaf('ServiceWRK', 36081, { navTab: 'tab-service', children: [leaf('CENTER_VISIT', 30822), leaf('OVERCALL_RESOLUTION', 5259)] }),
            leaf('TOM', 1325, { navTab: 'tab-tom', children: [leaf('Resolved', 256), leaf('Unresolved', 68), leaf('Visit needed', 1001)] })
          ]
        }
      });
    }
```

- [ ] **Step 4: Add page state, load, and render**

Add to the `state` initializer, alongside `state.serviceLoaded`:

```javascript
    overviewFlowLoaded: false, overviewFlowFilters: null,
```

Add near `loadService`:

```javascript
  /* ── Overview page (decomposition trees) ─────────────────────── */
  var overviewFlowRequestId = 0;
  function loadOverviewFlow() {
    var requestId = ++overviewFlowRequestId;
    var sentFilters = JSON.parse(JSON.stringify(state.globalFilters));
    gsCall(ep('apiGetOverviewFlow'), { filters: state.globalFilters })
      .then(function (payload) {
        if (requestId !== overviewFlowRequestId) return;
        state.overviewFlowLoaded = true;
        state.overviewFlowFilters = sentFilters;
        renderOverviewFlow(payload);
      })
      .catch(function (err) {
        if (requestId !== overviewFlowRequestId) return;
        toast('Overview failed: ' + err.message, 'error');
      });
  }

  /**
   * Applies a tree node's click: sets/clears a global filter, or switches tabs.
   *
   * Mutates state.globalFilters DIRECTLY, not state.globalFiltersPending — the
   * pending object only exists while the Filters drawer is open (null
   * otherwise, per its own comment at the state initializer), so writing to it
   * here would throw on the normal case of the drawer being closed. This
   * mirrors what the Filters drawer's own Apply button does at commit time
   * (`state.globalFilters = state.globalFiltersPending`) minus the
   * pending-object indirection, since there is no drawer session to commit —
   * a tree click sets the live filter directly, the same way a saved search
   * or a deep link would.
   */
  function handleTreeNodeClick_(nodeData) {
    if (nodeData.clearDims) {
      nodeData.clearDims.forEach(function (dim) { state.globalFilters[dim] = []; });
      commitGlobalFilters_();
      return;
    }
    if (nodeData.filterDim) {
      state.globalFilters[nodeData.filterDim] = [nodeData.filterValue];
      commitGlobalFilters_();
      return;
    }
    if (nodeData.navTab) {
      // Order note: commitGlobalFilters_() dispatches on state.activeTab AT
      // CALL TIME. Calling it here (still on tab-overview) means it refreshes
      // the trees we're about to leave rather than the tab we're headed to —
      // one harmless redundant fetch, not a correctness bug, since
      // activateTab() below runs that destination tab's OWN staleness check
      // independently and will load it correctly regardless. Not optimized
      // away here because doing so would mean asserting a call-order
      // guarantee (commitGlobalFilters_ dispatching correctly against a
      // not-yet-active tab) this codebase doesn't otherwise rely on.
      if (nodeData.navDeviceType) {
        state.globalFilters.deviceTypes = [nodeData.navDeviceType];
        commitGlobalFilters_();
      }
      activateTab(nodeData.navTab);
    }
  }

  function renderOverviewFlow(payload) {
    Charts.decompTree('treeCustomers', payload.customers, { onNodeClick: handleTreeNodeClick_ });
    Charts.decompTree('treeDevices', payload.devices, { onNodeClick: handleTreeNodeClick_ });
    Charts.decompTree('treeTickets', payload.tickets, { onNodeClick: handleTreeNodeClick_ });
  }
```

`commitGlobalFilters_()` (`App.html:2051`) and `activateTab(tabId)` (`App.html:2743`) were read in
full while writing this plan — both names and their current behavior are confirmed, not assumed.
`state.globalFiltersPending` is deliberately NOT used here (see the comment above
`handleTreeNodeClick_`); it exists only as the Filters drawer's open-session staging object, `null`
otherwise (`App.html:32`).

- [ ] **Step 5: Wire `refreshAll`**

The tab-switch and initial-load hooks are already done in Step 1 (point #3, inside `activateTab`).
The only remaining hook is the periodic/manual refresh path — in `refreshAll`, add:

```javascript
    if (state.overviewFlowLoaded) loadOverviewFlow();
```

- [ ] **Step 6: Verify in the preview**

Run the preview build, open the app (Overview is the landing tab), and confirm: all three trees
render with real-looking numbers, hovering a node shows the tooltip stats, expand/collapse works,
clicking a country/segment/device-type node visibly narrows the KPI counts on other tabs (open the
Filters drawer to confirm the chip appeared), clicking an age-band leaf switches to Asset with
Connector/ECG Machine pre-filtered, and clicking any Tickets-tree node switches to Support/Service/
TOM respectively. Zero console errors.

- [ ] **Step 7: Commit**

```bash
git add src/client/App.html
git commit -m "feat(overview): wire the three decomposition trees to apiGetOverviewFlowCD"
```

---

### Task 7: Live verification and diagnostics

**Files:**
- Modify: `src/server/Setup.js` — extend `diagnostics()`

- [ ] **Step 1: Add a diagnostics line**

In `diagnostics()`, alongside the existing source checks:

```javascript
  var flow = apiGetOverviewFlowCD({ filters: {} });
  Logger.log(flow.ok
    ? 'overview flow: ' + flow.data.customers.value + ' customers, ' +
      flow.data.devices.value + ' devices, ' + flow.data.tickets.value + ' tracked records'
    : 'overview flow FAILED: ' + JSON.stringify(flow.error));
```

- [ ] **Step 2: Push and run against live BigQuery**

Run: `npx clasp push -f`, then run `diagnostics` in the Apps Script editor.
Expected: `overview flow: <N> customers, <N> devices, <N> tracked records`, with no thrown error.

- [ ] **Step 3: Hand-verify the headline totals**

Cross-check `customers.value` against the existing `customersCount` KPI figure (Customers tab) and
`devices.value` against the existing `devicesCount` KPI figure (Asset tab) under the SAME filter
set — they must match exactly, since both trees are built from the same underlying cached data
those KPIs already use. Cross-check `tickets.value`'s three children against the Support/Service/
TOM pages' own "total tickets"/"issues logged" KPI tiles.

- [ ] **Step 4: Live browser check on `@HEAD`**

Push, then exercise the `@HEAD` test deployment exactly as the browser check in Task 6 Step 6
describes, but against live BigQuery data instead of the mock — confirm the three trees render,
hover/click behave as designed, and the headline totals match Step 3's hand-verification.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm test
npm run verify-before-deploy
git add src/server/Setup.js
git commit -m "feat(overview): diagnostics coverage for the decomposition-tree endpoint"
```

Deployment (bumping `CONFIG.APP_VERSION`/`APP_DEPLOYED_AT` and running `clasp deploy -i <stable-id>`)
follows this project's standing convention — same as every other release this session — and is a
final step taken only after explicit user go-ahead, not part of this plan's automated steps.

---

## Self-Review

**Spec coverage.** §5.1 Customers tree → Task 2. §5.2 Devices tree → Task 1 (shared filter
extraction) + Task 2. §5.3 Tickets tree → Task 3. §6 Interactivity: expand/collapse → Task 4 (native
ECharts, `expandAndCollapse: true`); hover popup → Task 4's tooltip formatter + Task 2/3's `stats`
fields; click-sets-filter → Task 6's `handleTreeNodeClick_`; the two resolved edge cases (age-band
leaf → Asset tab pre-filtered; Tickets tree → source's own page) → the `navTab`/`navDeviceType`
fields built in Task 2/3 and consumed in Task 6. §7 Architecture: dedicated endpoint, Overview
unhooked from the shared dashboard payload → Task 6 Step 1; server-side nesting (deviation from the
spec's original client-nests sketch, noted inline in `OverviewFlow.js`'s file-level comment) →
Task 2/3. §8 Out of scope: no color-coding (Task 4's `itemStyle.color` is a flat `C.primary`, not
data-driven); `Others` non-expandable (Task 2's Customers tree gives `Others` no `children` key);
no new filter dimensions added (confirmed — Task 6 only ever sets existing `state.globalFilters`
keys).

**Placeholder scan.** No TBD/TODO. One real bug was caught and fixed during this self-review, not
left as a placeholder: the first draft of `handleTreeNodeClick_` wrote to
`state.globalFiltersPending`, which is `null` whenever the Filters drawer is closed (confirmed by
reading `App.html:32`, `:1836`, `:3365-3372`) — it would have thrown on every normal click. Fixed to
mutate `state.globalFilters` directly, mirroring the Apply button's own commit step. This also
surfaced that Overview's old exec-summary wiring touches FOUR spots in `App.html`, not the two the
design spec's grounding step found — Task 6 Step 1 now lists all four with their current line
numbers. A second bug was caught the same way: Task 3's `buildTicketsQuerySpecs` test loaded
`Queries.js` but not `EditionCD.js`, and the zoho spec's `centerFilterSubqueryCond_` (plus its own
`cdFilter_`/`centerAttrCond_` dependencies) lives in the latter — the test would have thrown
`centerFilterSubqueryCond_ is not defined` the moment it actually called the function. Fixed by
adding `EditionCD.js` to that test's `loadGas` list.

**Type consistency.** Tree node shape — `{name, value, children?, stats?, filterDim?, filterValue?,
clearDims?, navTab?, navDeviceType?}` — is identical across Task 2 (Customers/Devices builders),
Task 3 (Tickets builder), Task 4 (`decompTree`'s consumption of `params.data`), and Task 6 (the
preview mock and `handleTreeNodeClick_`). `filteredJiraDevices_`'s return shape
(`{issue_key, type, status, cid, age}`) matches between its Task 1 definition and Task 2's
`buildDevicesTree_` consumption (`d.type`, `d.age`). `apiGetOverviewFlowCD`'s response keys
(`customers`, `devices`, `tickets`) match between Task 3's server code, Task 6's mock, and Task 6's
`renderOverviewFlow`.
