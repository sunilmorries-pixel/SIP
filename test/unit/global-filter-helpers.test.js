'use strict';

/**
 * Unit tests for the universal filter helpers in src/server/Queries.js
 * (multiCond_, dateRangeCond_, filterHash_). These are pure SQL-fragment and
 * hash-key builders — no BigQuery, no network — tested directly against the
 * loaded Apps Script sandbox.
 *
 * Loaded via loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js']): Queries.js
 * references CONFIG (T(), segClean_) at call time, so all are loaded for a
 * stable, reusable sandbox. filterHash_ additionally needs shortHash (from
 * BigQuery.js) and its Utilities.computeDigest API, both provided via local
 * Utilities mock in the test's beforeAll — not from shared helpers.
 */

const { loadGas } = require('../helpers/loadGas');
const crypto = require('crypto');

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
  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'BigQuery.js']);
    sandbox.Utilities = {
      DigestAlgorithm: { MD5: 'MD5' },
      computeDigest: function (algo, text) {
        if (algo !== 'MD5') throw new Error('Only MD5 algorithm is supported in test');
        return Array.from(crypto.createHash('md5').update(text).digest());
      }
    };
  });

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
