'use strict';
const { loadGas } = require('../helpers/loadGas');

describe('multiCond_', function () {
  let sandbox;
  beforeAll(function () { sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js']); });

  test('empty/undefined array yields no condition', function () {
    expect(sandbox.multiCond_('Status', [])).toBe('');
    expect(sandbox.multiCond_('Status', undefined)).toBe('');
  });

  test('single value emits an IN-list of one', function () {
    expect(sandbox.multiCond_('Status', ['ACTIVE'])).toBe(" AND Status IN ('ACTIVE')");
  });

  test('multiple values are all included, sanitized', function () {
    var cond = sandbox.multiCond_('State', ["Karnataka", 'Tamil"Nadu']);
    expect(cond).toContain("'Karnataka'");
    expect(cond).toContain("'TamilNadu'"); // quote stripped by segClean_
    expect(cond).not.toMatch(/"/);
  });
});

describe('dateRangeCond_', function () {
  let sandbox;
  beforeAll(function () { sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js']); });

  test('both bounds empty yields no condition', function () {
    expect(sandbox.dateRangeCond_('deploymentdate', '', '')).toBe('');
  });

  test('from-only and to-only bounds', function () {
    expect(sandbox.dateRangeCond_('deploymentdate', '2026-01-01', '')).toBe(" AND DATE(deploymentdate) >= '2026-01-01'");
    expect(sandbox.dateRangeCond_('deploymentdate', '', '2026-03-31')).toBe(" AND DATE(deploymentdate) <= '2026-03-31'");
  });

  test('malformed date strings are rejected, not injected', function () {
    expect(sandbox.dateRangeCond_('deploymentdate', "2026-01-01' OR '1'='1", '')).toBe('');
  });
});

describe('filterHash_', function () {
  let sandbox;
  beforeAll(function () { sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'BigQuery.js', 'Queries.js']); });

  test('same filters in different array order hash identically', function () {
    var a = sandbox.filterHash_({ segments: ['Government', 'ECHO'], statuses: ['ACTIVE'], states: [], hubs: [], dateFrom: '', dateTo: '' });
    var b = sandbox.filterHash_({ segments: ['ECHO', 'Government'], statuses: ['ACTIVE'], states: [], hubs: [], dateFrom: '', dateTo: '' });
    expect(a).toBe(b);
  });

  test('different filters hash differently', function () {
    var a = sandbox.filterHash_({ segments: ['Government'], statuses: [], states: [], hubs: [], dateFrom: '', dateTo: '' });
    var b = sandbox.filterHash_({ segments: ['ECHO'], statuses: [], states: [], hubs: [], dateFrom: '', dateTo: '' });
    expect(a).not.toBe(b);
  });
});
