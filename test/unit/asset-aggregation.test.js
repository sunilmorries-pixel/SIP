'use strict';

/**
 * Unit tests for the pure-JS asset aggregation helpers in
 * src/server/EditionCD.js: assetsDonutFromIndex_ (status/type counts for the
 * Asset-page donuts) and cohortFromIndex_ (batch-year cohort failure stats).
 * Both take plain arrays in and return plain arrays out — no BigQuery, no
 * network — so fixtures are hand-built and the expected numbers are
 * hand-computed from the real source (read at src/server/EditionCD.js:199
 * and :223).
 *
 * Loaded via loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js',
 * 'EditionCD.js']) since EditionCD.js's OTHER functions reference
 * CONFIG/T()/cdFilter_ at call time; loaded together for a stable sandbox
 * even though the two functions under test here need none of that.
 */

const { loadGas } = require('../helpers/loadGas');

describe('asset aggregation helpers (EditionCD.js)', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'EditionCD.js']);
  });

  describe('assetsDonutFromIndex_', function () {
    test('groups by status and type, each sorted by count descending, blank status and missing type normalized', function () {
      const assets = [
        { status: 'Open', type: 'Connector' },
        { status: 'Open', type: 'Connector' },
        { status: 'Open', type: 'Connector' },
        { status: 'Closed', type: 'ECG Machine' },
        { status: 'Closed', type: 'ECG Machine' },
        { status: '', type: undefined }, // blank status -> '(blank)'; missing type -> 'Other'
      ];

      const result = sandbox.assetsDonutFromIndex_(assets);

      expect(result).toEqual([
        { dim: 'status', label: 'Open', cnt: 3 },
        { dim: 'status', label: 'Closed', cnt: 2 },
        { dim: 'status', label: '(blank)', cnt: 1 },
        { dim: 'type', label: 'Connector', cnt: 3 },
        { dim: 'type', label: 'ECG Machine', cnt: 2 },
        { dim: 'type', label: 'Other', cnt: 1 },
      ]);

      // Structural check: each dim group is non-increasing by cnt.
      ['status', 'type'].forEach(function (dim) {
        const counts = result.filter(function (r) { return r.dim === dim; }).map(function (r) { return r.cnt; });
        for (let i = 1; i < counts.length; i++) {
          expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
        }
      });
    });
  });

  describe('cohortFromIndex_', function () {
    test('groups by birth year and computes ftf_rate_pct, median_ttff_days, early_fails, avg_failures, top_issue', function () {
      // Device A: born 2024-01-01, center 1, matched by a zohoFail row whose
      // first_fail (2024-01-05) is 4 days after birth -> counts as an early
      // fail (ttff < 7 days).
      // Device B: born 2024-06-15, center 2, no matching zohoFail row at all.
      const assets = [
        { birthday: '2024-01-01', center_id: 1 },
        { birthday: '2024-06-15', center_id: 2 },
      ];
      const zohoFail = [
        { cid: 1, first_fail: '2024-01-05', n_fail: 3, top_cat: 'Battery' },
      ];

      const result = sandbox.cohortFromIndex_(assets, zohoFail);

      // Hand-computed: devices=2, everFail=1 (device A only), ttff=[4 days],
      // early=1 (4 < 7), failSum=3, ftf_rate_pct=round(1/2*1000)/10=50,
      // avg_failures=round(3/2*100)/100=1.5, top_issue='Battery'.
      expect(result).toEqual([
        {
          batch_year: 2024,
          devices: 2,
          ftf_rate_pct: 50,
          median_ttff_days: 4,
          early_fails: 1,
          avg_failures: 1.5,
          top_issue: 'Battery',
        },
      ]);
    });

    test('a device with no birthday is excluded from any batch year', function () {
      const assets = [
        { birthday: '', center_id: 1 },
        { center_id: 2 }, // no birthday property at all
      ];
      const result = sandbox.cohortFromIndex_(assets, []);
      expect(result).toEqual([]);
    });
  });
});
