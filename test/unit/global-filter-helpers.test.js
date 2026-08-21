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
    expect(sandbox.multiCond_('Status', ['ACTIVE'])).toBe(" AND TRIM(IFNULL(Status,'')) IN ('ACTIVE')");
  });

  test('multiple values are all included, escaped rather than mangled', function () {
    // Was: asserted 'Tamil"Nadu' arrived as 'TamilNadu' because segClean_
    // DELETED the quote. That is exactly the defect fixed on 2026-08-21 —
    // deleting a character rewrites the value into one that exists nowhere in
    // the column, so the filter matched zero rows while the JS filter path
    // (which compares uncleaned values) still matched. multiCond_ now emits
    // through sqlLiteral_, which preserves the value. A double quote is an
    // ordinary character inside a single-quoted BigQuery literal, so it needs
    // no treatment at all; an apostrophe is doubled.
    var cond = sandbox.multiCond_('State', ['Karnataka', 'Tamil"Nadu']);
    expect(cond).toContain("'Karnataka'");
    expect(cond).toContain("'Tamil\"Nadu'");
  });

  test('an apostrophe in a value is doubled, keeping the literal closed', function () {
    var cond = sandbox.multiCond_('HubName', ["St. Mary's Hospital"]);
    expect(cond).toContain("'St. Mary''s Hospital'");
  });

  test('the column is TRIM(IFNULL(...))-normalized, never compared bare (finding I4 guard)', function () {
    // The JS filter path (centerPassesFilters_) compares against TRIM'd values
    // from centerBase's SELECT. If this fragment ever reverts to a bare
    // `column IN (...)`, the SQL and JS paths silently disagree on the 2,806
    // sandbox rows with a padded HubName. Assert the normalization explicitly,
    // for every dimension the global filter drives.
    ['hub_master_segment', 'Status', 'State', 'HubName'].forEach(function (col) {
      var cond = sandbox.multiCond_(col, ['x']);
      expect(cond).toBe(" AND TRIM(IFNULL(" + col + ",'')) IN ('x')");
      expect(cond).not.toBe(' AND ' + col + " IN ('x')");
    });
  });
});

describe('likeEscape_', function () {
  let sandbox;
  beforeAll(function () { sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js']); });

  test('a plain string passes through unchanged', function () {
    expect(sandbox.likeEscape_('metropolis')).toBe('metropolis');
  });

  test("LIKE wildcards % and _ are escaped so they match literally", function () {
    expect(sandbox.likeEscape_('50%')).toBe('50\\%');
    expect(sandbox.likeEscape_('a_b')).toBe('a\\_b');
  });

  test('a backslash is escaped first, so an escape marker cannot be forged', function () {
    expect(sandbox.likeEscape_('a\\%b')).toBe('a\\\\\\%b');
  });

  test('null/undefined collapse to an empty string', function () {
    expect(sandbox.likeEscape_(null)).toBe('');
    expect(sandbox.likeEscape_(undefined)).toBe('');
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
