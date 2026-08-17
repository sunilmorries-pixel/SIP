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
