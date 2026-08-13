'use strict';

/**
 * Unit tests for the TOM SQL-fragment builders (src/server/TomTickets.js).
 * Pure string transforms — no BigQuery, no network.
 *
 * Loaded with Config.js + SlaCatalog.js + Queries.js because TomTickets.js
 * calls T()/multiCond_/segClean_/likeEscape_ at call time.
 */

const { loadGas } = require('../helpers/loadGas');

describe('TOM SQL helpers (TomTickets.js)', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'TomTickets.js']);
  });

  describe('tomTable_', function () {
    test('resolves to the configured dataset', function () {
      expect(sandbox.tomTable_()).toBe('`tricogde-dwh.abi_tables.tom_tickets`');
    });
  });

  describe('tomDateCond_', function () {
    test('returns empty string when neither bound is set', function () {
      expect(sandbox.tomDateCond_('', '')).toBe('');
    });

    test('bounds on received_date, not closed_date', function () {
      const cond = sandbox.tomDateCond_('2026-02-01', '2026-06-30');
      expect(cond).toContain('DATE(received_date) >= DATE(\'2026-02-01\')');
      expect(cond).toContain('DATE(received_date) <= DATE(\'2026-06-30\')');
      expect(cond).not.toContain('closed_date');
    });

    test('strips quotes before inlining', function () {
      expect(sandbox.tomDateCond_("2026-01-01'; DROP", '')).not.toContain("'; DROP");
    });
  });

  describe('tomFilterCond_', function () {
    test('returns empty string for an empty filter set', function () {
      expect(sandbox.tomFilterCond_({})).toBe('');
    });

    test('filters centers directly on center_id', function () {
      const cond = sandbox.tomFilterCond_({ centers: ['12862'] });
      expect(cond).toContain('center_id');
      expect(cond).toContain("IN ('12862')");
    });

    test('ignores dimensions tom_tickets has no column for', function () {
      // No state/city/segment/hub columns exist on this table; bridging them
      // would need the unverified center_id -> CenterID join.
      const cond = sandbox.tomFilterCond_({
        states: ['Odisha'], cities: ['Cuttack'], segments: ['LE'], hubs: ['H1']
      });
      expect(cond).toBe('');
    });
  });

  describe('tomResolvedCond_ / tomUnresolvedCond_', function () {
    test('resolved covers both the resolved outcomes', function () {
      const sql = sandbox.tomResolvedCond_();
      expect(sql).toContain('Issue Resolved');
      expect(sql).toContain('Auto Resolved');
    });

    test('unresolved covers the two failure outcomes', function () {
      const sql = sandbox.tomUnresolvedCond_();
      expect(sql).toContain('Not resolved');
      expect(sql).toContain('No response');
    });

    test('the two sets do not overlap', function () {
      const resolved = sandbox.tomResolvedCond_();
      expect(resolved).not.toContain('Not resolved');
      expect(resolved).not.toContain('No response');
    });
  });

  describe('buildTomQuerySpecs', function () {
    test('returns one spec per page component', function () {
      const keys = sandbox.buildTomQuerySpecs({}).map(function (s) { return s.key; });
      expect(keys).toEqual(['kpis', 'volume', 'issueTypes', 'deviceTypes',
        'outcomes', 'owners', 'reasons']);
    });

    test('every spec queries tom_tickets', function () {
      sandbox.buildTomQuerySpecs({}).forEach(function (s) {
        expect(s.sql).toContain('tom_tickets');
      });
    });

    test('the active filter reaches every spec', function () {
      sandbox.buildTomQuerySpecs({ centers: ['12862'] }).forEach(function (s) {
        expect(s.sql).toContain("IN ('12862')");
      });
    });

    test('monthly volume derives sortable months from received_date', function () {
      // `month` is a bare string ('Jan','Jun'), so ordering by it would sort
      // Apr < Aug < Dec. FORMAT_DATE gives a lexicographically sortable key.
      const vol = sandbox.buildTomQuerySpecs({}).filter(
        function (s) { return s.key === 'volume'; })[0];
      expect(vol.sql).toContain('FORMAT_DATE');
      expect(vol.sql).toContain('ORDER BY ym');
    });

    test('monthly volume never aliases over the real `month` column', function () {
      // tom_tickets HAS a month column; an alias of the same name would leave
      // GROUP BY/ORDER BY resolving between the alias and the raw column.
      const vol = sandbox.buildTomQuerySpecs({}).filter(
        function (s) { return s.key === 'volume'; })[0];
      expect(vol.sql).not.toContain('AS month');
      expect(vol.sql).not.toMatch(/ORDER BY\s+month\b/);
    });

    test('chart specs alias to label/cnt for rankBar', function () {
      const charts = sandbox.buildTomQuerySpecs({}).filter(function (s) {
        return ['issueTypes', 'deviceTypes', 'outcomes', 'owners', 'reasons'].indexOf(s.key) !== -1;
      });
      expect(charts).toHaveLength(5);
      charts.forEach(function (s) {
        expect(s.sql).toContain('AS label');
        expect(s.sql).toContain('AS cnt');
      });
    });

    test('kpis spec reports resolved, unresolved and average TAT', function () {
      const kpis = sandbox.buildTomQuerySpecs({}).filter(
        function (s) { return s.key === 'kpis'; })[0];
      expect(kpis.sql).toContain('resolved');
      expect(kpis.sql).toContain('unresolved');
      expect(kpis.sql).toContain('avg_tat_days');
    });
  });

  describe('buildTomTicketsQuery', function () {
    test('defaults to newest received first', function () {
      expect(sandbox.buildTomTicketsQuery({})).toContain('ORDER BY received_date DESC');
    });

    test('accepts a whitelisted sort column', function () {
      expect(sandbox.buildTomTicketsQuery({ sortBy: 'tat_days_', sortDir: 'asc' }))
        .toContain('ORDER BY tat_days_ ASC');
    });

    test('rejects a non-whitelisted sort column', function () {
      const sql = sandbox.buildTomTicketsQuery({ sortBy: 'x; DROP TABLE y' });
      expect(sql).not.toContain('DROP TABLE');
      expect(sql).toContain('ORDER BY received_date DESC');
    });

    test('search matches centre name, zoho id and issue', function () {
      const sql = sandbox.buildTomTicketsQuery({ search: 'apollo' });
      expect(sql).toContain('center_name');
      expect(sql).toContain('zoho_id');
      expect(sql).toContain('apollo');
    });

    test('ignores a one-character search', function () {
      expect(sandbox.buildTomTicketsQuery({ search: 'a' })).not.toContain('LIKE');
    });

    test('formats timestamps in SQL', function () {
      expect(sandbox.buildTomTicketsQuery({})).toContain('FORMAT_DATE');
    });

    test('paginates with LIMIT and OFFSET', function () {
      const sql = sandbox.buildTomTicketsQuery({ page: 3, pageSize: 15 });
      expect(sql).toContain('LIMIT 15');
      expect(sql).toContain('OFFSET 45');
    });

    test('caps pageSize', function () {
      expect(sandbox.buildTomTicketsQuery({ pageSize: 99999 })).toContain('LIMIT 200');
    });
  });
});
