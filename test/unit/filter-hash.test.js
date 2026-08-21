'use strict';

/**
 * Unit tests for filterHash_ (src/server/Queries.js) — the canonical hash
 * behind every filter-varying cache key in the app (dashcd, mapcd, cdmcd,
 * topcustcd, jiradev, ovflow, tom, numbers, svc).
 *
 * The contract is exactly this: two filter sets that produce different
 * NUMBERS must produce different hashes, and two filter sets that are
 * logically identical must produce the same hash. A dimension that changes
 * the result but not the key serves one filter set's cached payload under
 * another's — a plausible-looking wrong number with no error.
 *
 * Written after the 2026-08-19 audit found `centers` was applied in SQL
 * (centerAttrCond_ emits `CAST(CenterID AS STRING) IN (…)`) and in JS
 * (centerPassesFilters_ checks f.centers) but omitted from this hash.
 */

const { loadGas } = require('../helpers/loadGas');

describe('filterHash_ (Queries.js)', function () {
  let sandbox;

  beforeAll(function () {
    // BigQuery.js supplies shortHash, which filterHash_ calls.
    sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'BigQuery.js', 'Queries.js']);
  });

  test('is order-insensitive within a dimension', function () {
    expect(sandbox.filterHash_({ segments: ['A', 'B'] }))
      .toBe(sandbox.filterHash_({ segments: ['B', 'A'] }));
  });

  test('treats an absent dimension and an empty one as the same filter set', function () {
    expect(sandbox.filterHash_({ statuses: ['ACTIVE'] }))
      .toBe(sandbox.filterHash_({ statuses: ['ACTIVE'], states: [] }));
  });

  test('an empty filter set hashes stably', function () {
    expect(sandbox.filterHash_({})).toBe(sandbox.filterHash_({}));
    expect(sandbox.filterHash_({})).toBe(sandbox.filterHash_(null));
  });

  /**
   * One case per dimension the server actually applies. Any dimension missing
   * from the canonical object shows up here as a collision.
   */
  describe('every applied dimension changes the hash', function () {
    const BASE = { statuses: ['ACTIVE'] };
    const CASES = [
      ['segments', { segments: ['LE'] }],
      ['statuses', { statuses: ['ACTIVE', 'INACTIVE'] }],
      ['states', { states: ['Karnataka'] }],
      ['hubs', { hubs: ['Hub One'] }],
      ['cities', { cities: ['Bengaluru'] }],
      ['countries', { countries: ['India'] }],
      ['centers', { centers: ['1234'] }],
      ['deviceTypes', { deviceTypes: ['Connector'] }],
      ['deviceStatusExclude', { deviceStatusExclude: ['Decommissioned'] }],
      ['dateFrom', { dateFrom: '2026-01-01' }],
      ['dateTo', { dateTo: '2026-12-31' }],
    ];

    CASES.forEach(function (entry) {
      const dimension = entry[0];
      const overlay = entry[1];
      test(dimension, function () {
        const withDim = Object.assign({}, BASE, overlay);
        expect(sandbox.filterHash_(withDim)).not.toBe(sandbox.filterHash_(BASE));
      });
    });
  });

  test('two different centers selections do not collide with each other', function () {
    // The specific production failure: selecting center A served center B's
    // (or the warmed all-centers) payload for up to the 15-minute TTL.
    const a = sandbox.filterHash_({ statuses: ['ACTIVE'], centers: ['1234'] });
    const b = sandbox.filterHash_({ statuses: ['ACTIVE'], centers: ['5678'] });
    const none = sandbox.filterHash_({ statuses: ['ACTIVE'], centers: [] });
    expect(new Set([a, b, none]).size).toBe(3);
  });
});
