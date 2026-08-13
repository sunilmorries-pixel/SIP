'use strict';

/**
 * Unit tests for the ServiceWRK SQL-fragment builders (src/server/ServiceWrk.js).
 * Pure string transforms — no BigQuery, no network.
 *
 * Loaded with Config.js + SlaCatalog.js + Queries.js because ServiceWrk.js
 * calls T()/multiCond_/segmentGroupSql_/segClean_/likeEscape_ at call time.
 */

const { loadGas } = require('../helpers/loadGas');

describe('ServiceWRK SQL helpers (ServiceWrk.js)', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'ServiceWrk.js']);
  });

  describe('swTable_', function () {
    test('resolves to the configured dataset', function () {
      expect(sandbox.swTable_()).toBe('`tricogde-dwh.abi_tables.servicewrk_Tickets`');
    });
  });

  describe('swDateCond_', function () {
    test('returns empty string when neither bound is set', function () {
      expect(sandbox.swDateCond_('', '')).toBe('');
    });

    test('emits a lower bound on created_on', function () {
      expect(sandbox.swDateCond_('2026-01-01', '')).toBe(
        " AND DATE(created_on) >= DATE('2026-01-01')");
    });

    test('emits both bounds when both are set', function () {
      expect(sandbox.swDateCond_('2026-01-01', '2026-06-30')).toBe(
        " AND DATE(created_on) >= DATE('2026-01-01')" +
        " AND DATE(created_on) <= DATE('2026-06-30')");
    });

    test('strips quotes from the date values before inlining them', function () {
      expect(sandbox.swDateCond_("2026-01-01'; DROP", '')).not.toContain("'; DROP");
    });
  });

  describe('swTatValidCond_', function () {
    test('excludes null and negative TAT', function () {
      expect(sandbox.swTatValidCond_()).toBe(
        ' AND tat_days_ IS NOT NULL AND tat_days_ >= 0');
    });
  });

  describe('swFilterCond_', function () {
    test('returns empty string for an empty filter set', function () {
      expect(sandbox.swFilterCond_({})).toBe('');
    });

    test('routes segments through segmentGroupSql_, not a raw comparison', function () {
      const cond = sandbox.swFilterCond_({ segments: ['LE'] });
      expect(cond).toContain('customer_category');
      expect(cond).toContain('CASE');
      expect(cond).toContain("'LE'");
    });

    test('filters state and city on ServiceWRKs own columns', function () {
      const cond = sandbox.swFilterCond_({ states: ['Odisha'], cities: ['Cuttack'] });
      expect(cond).toContain("IN ('Odisha')");
      expect(cond).toContain("IN ('Cuttack')");
    });

    test('ignores dimensions ServiceWRK cannot express', function () {
      const cond = sandbox.swFilterCond_({ hubs: ['H1'], centers: ['123'], statuses: ['ACTIVE'] });
      expect(cond).toBe('');
    });
  });

  describe('swTatBandSql_', function () {
    test('produces the five bands the client orders by', function () {
      const sql = sandbox.swTatBandSql_();
      ['Same day', '1-2d', '3-7d', '8-30d', '30d+'].forEach(function (band) {
        expect(sql).toContain("'" + band + "'");
      });
    });
  });

  describe('buildServiceQuerySpecs', function () {
    test('returns one spec per page component, each with a key and sql', function () {
      const specs = sandbox.buildServiceQuerySpecs({});
      const keys = specs.map(function (s) { return s.key; });
      expect(keys).toEqual(['kpis', 'flow', 'tatBands', 'resolution',
        'serviceTypes', 'models', 'reps']);
      specs.forEach(function (s) {
        expect(typeof s.sql).toBe('string');
        expect(s.sql.length).toBeGreaterThan(0);
      });
    });

    test('every spec queries the ServiceWRK table', function () {
      sandbox.buildServiceQuerySpecs({}).forEach(function (s) {
        expect(s.sql).toContain('servicewrk_Tickets');
      });
    });

    test('no spec contains a dedupe CTE — ticket_id is already unique', function () {
      sandbox.buildServiceQuerySpecs({}).forEach(function (s) {
        expect(s.sql).not.toContain('ROW_NUMBER() OVER');
      });
    });

    test('the active filter reaches every spec', function () {
      sandbox.buildServiceQuerySpecs({ states: ['Odisha'] }).forEach(function (s) {
        expect(s.sql).toContain("IN ('Odisha')");
      });
    });

    test('TAT statistics exclude negative rows', function () {
      const tat = sandbox.buildServiceQuerySpecs({}).filter(
        function (s) { return s.key === 'tatBands'; })[0];
      expect(tat.sql).toContain('tat_days_ >= 0');
    });

    test('kpis spec counts the negative-TAT rows rather than dropping them', function () {
      const kpis = sandbox.buildServiceQuerySpecs({}).filter(
        function (s) { return s.key === 'kpis'; })[0];
      expect(kpis.sql).toContain('invalid_tat');
    });

    test('kpis never nests an aggregate inside COUNTIF', function () {
      // bounds is CROSS JOINed so max_day is a row-level column; wrapping it in
      // ANY_VALUE() inside COUNTIF would be an aggregate-within-aggregate error
      // that only surfaces as a live BigQuery 400.
      const kpis = sandbox.buildServiceQuerySpecs({}).filter(
        function (s) { return s.key === 'kpis'; })[0];
      expect(kpis.sql).not.toContain('ANY_VALUE');
    });

    test('every chart spec aliases its columns to label/cnt for rankBar', function () {
      const charts = sandbox.buildServiceQuerySpecs({}).filter(function (s) {
        return ['resolution', 'serviceTypes', 'models', 'reps'].indexOf(s.key) !== -1;
      });
      expect(charts).toHaveLength(4);
      charts.forEach(function (s) {
        expect(s.sql).toContain('AS label');
        expect(s.sql).toContain('AS cnt');
      });
    });
  });

  describe('buildServiceTicketsQuery', function () {
    test('defaults to sorting by created_on descending', function () {
      expect(sandbox.buildServiceTicketsQuery({})).toContain('ORDER BY created_on DESC');
    });

    test('accepts a whitelisted sort column', function () {
      const sql = sandbox.buildServiceTicketsQuery({ sortBy: 'tat_days_', sortDir: 'asc' });
      expect(sql).toContain('ORDER BY tat_days_ ASC');
    });

    test('rejects a non-whitelisted sort column instead of inlining it', function () {
      const sql = sandbox.buildServiceTicketsQuery({ sortBy: 'x; DROP TABLE y' });
      expect(sql).not.toContain('DROP TABLE');
      expect(sql).toContain('ORDER BY created_on DESC');
    });

    test('search matches ticket id, contact and representative', function () {
      const sql = sandbox.buildServiceTicketsQuery({ search: 'abhisekh' });
      expect(sql).toContain('ticket_id');
      expect(sql).toContain('contact_person_name');
      expect(sql).toContain('representative');
      expect(sql).toContain('abhisekh');
    });

    test('ignores a one-character search rather than scanning on every keystroke', function () {
      expect(sandbox.buildServiceTicketsQuery({ search: 'a' })).not.toContain('LIKE');
    });

    test('formats timestamps in SQL, never returning raw epoch values', function () {
      expect(sandbox.buildServiceTicketsQuery({})).toContain('FORMAT_DATE');
    });

    test('paginates with LIMIT and OFFSET', function () {
      const sql = sandbox.buildServiceTicketsQuery({ page: 2, pageSize: 50 });
      expect(sql).toContain('LIMIT 50');
      expect(sql).toContain('OFFSET 100');
    });

    test('caps pageSize so a crafted request cannot ask for the whole table', function () {
      expect(sandbox.buildServiceTicketsQuery({ pageSize: 99999 })).toContain('LIMIT 200');
    });

    test('carries the global filter into the row list', function () {
      const sql = sandbox.buildServiceTicketsQuery({ filters: { states: ['Odisha'] } });
      expect(sql).toContain("IN ('Odisha')");
    });
  });
});
