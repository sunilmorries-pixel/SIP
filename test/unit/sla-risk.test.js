'use strict';

/**
 * Unit tests for the SLA-risk worklist SQL builder (src/server/SlaRisk.js).
 * Pure string transforms — no BigQuery, no network.
 *
 * Loaded with Config.js + SlaCatalog.js + Queries.js + EditionCD.js because
 * SlaRisk.js calls slaDaysCaseSql_/zohoDedupSql_/zohoParsedDates_/segClean_/
 * likeEscape_/dateRangeCond_ and centerFilterSubqueryCond_ at call time.
 */

const { loadGas } = require('../helpers/loadGas');

describe('SLA-risk worklist (SlaRisk.js)', function () {
  let sandbox;
  let sql;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'EditionCD.js', 'SlaRisk.js']);
    sql = sandbox.buildSlaRiskTicketsQuery({});
  });

  describe('sort-key whitelist', function () {
    test('every advertised sort key maps to itself', function () {
      Object.keys(sandbox.SLA_RISK_SORT_KEYS).forEach(function (k) {
        expect(sandbox.SLA_RISK_SORT_KEYS[k]).toBe(k);
      });
    });

    test('defaults to most-overdue-first', function () {
      expect(sql).toContain('ORDER BY days_over DESC');
    });

    test('a whitelisted key is honoured, in the requested direction', function () {
      const asc = sandbox.buildSlaRiskTicketsQuery({ sortBy: 'age_days', sortDir: 'asc' });
      expect(asc).toContain('ORDER BY age_days ASC');
    });

    test('an unknown sort key falls back to the default instead of being interpolated', function () {
      const evil = sandbox.buildSlaRiskTicketsQuery({ sortBy: "age_days; DROP TABLE x--" });
      expect(evil).toContain('ORDER BY days_over DESC');
      expect(evil).not.toContain('DROP TABLE');
    });

    test('sortDir only ever emits ASC or DESC', function () {
      const evil = sandbox.buildSlaRiskTicketsQuery({ sortDir: 'desc; DROP TABLE x--' });
      expect(evil).toContain('ORDER BY days_over DESC');
      expect(evil).not.toContain('DROP TABLE');
    });
  });

  describe('risk-band narrowing', function () {
    test('no band filter when unspecified — both breached and at-risk', function () {
      expect(sql).not.toContain("risk = '");
    });

    test('breached band', function () {
      expect(sandbox.buildSlaRiskTicketsQuery({ risk: 'breached' })).toContain("risk = 'BREACHED'");
    });

    test('at-risk band', function () {
      expect(sandbox.buildSlaRiskTicketsQuery({ risk: 'atrisk' })).toContain("risk = 'AT_RISK'");
    });

    test('an unrecognised band is ignored rather than inlined', function () {
      const q = sandbox.buildSlaRiskTicketsQuery({ risk: "x' OR 1=1--" });
      expect(q).not.toContain('OR 1=1');
      expect(q).not.toContain("risk = '");
    });
  });

  describe('search', function () {
    test('a single character is ignored (would scan the table for noise)', function () {
      expect(sandbox.buildSlaRiskTicketsQuery({ search: 'a' })).not.toContain('LIKE');
    });

    test('two or more characters search ticket / category / assignee / center', function () {
      const q = sandbox.buildSlaRiskTicketsQuery({ search: 'mac' });
      expect(q).toContain("LIKE '%mac%'");
      ['ticket', 'category', 'assignee', 'center_id'].forEach(function (col) {
        expect(q).toContain(col);
      });
    });

    test('quotes are stripped before the term is inlined', function () {
      const q = sandbox.buildSlaRiskTicketsQuery({ search: "a' OR 1=1--" });
      expect(q).not.toContain("' OR 1=1");
    });

    test('LIKE wildcards in user input are escaped, not treated as wildcards', function () {
      expect(sandbox.buildSlaRiskTicketsQuery({ search: '50%' })).toContain('\\%');
    });
  });

  describe('pagination', function () {
    test('page and pageSize become LIMIT/OFFSET', function () {
      expect(sandbox.buildSlaRiskTicketsQuery({ page: 3, pageSize: 25 }))
        .toContain('LIMIT 25 OFFSET 75');
    });

    test('pageSize is clamped so one call cannot pull the whole table', function () {
      expect(sandbox.buildSlaRiskTicketsQuery({ pageSize: 100000 })).toContain('LIMIT 200');
    });

    test('a negative page cannot produce a negative OFFSET', function () {
      expect(sandbox.buildSlaRiskTicketsQuery({ page: -5 })).toContain('OFFSET 0');
    });
  });

  describe('global filters are threaded', function () {
    test('center-attribute filters reach the query', function () {
      const q = sandbox.buildSlaRiskTicketsQuery({ filters: { states: ['Karnataka'] } });
      expect(q).toContain('CenterID IN (SELECT DISTINCT CenterID');
      expect(q).toContain('Karnataka');
    });

    test('the date range is applied to CreatedAt', function () {
      const q = sandbox.buildSlaRiskTicketsQuery({ filters: { dateFrom: '2026-01-01' } });
      expect(q).toContain('CreatedAt');
      expect(q).toContain('2026-01-01');
    });
  });

  describe('reconciliation with the SLA compliance card', function () {
    // These two thresholds are duplicated across three places by necessity
    // (a paginated row query, an aggregate chart spec, and the KPI spec — all
    // different shapes). If one drifts, the worklist stops adding up to the
    // "Open breached" / "At-risk" numbers users see above it, silently.
    let slaKpisSql;
    let slaRiskSql;

    beforeAll(function () {
      const specs = sandbox.buildDashboardQuerySpecs('', {});
      slaKpisSql = specs.filter(function (s) { return s.key === 'slaKpis'; })[0].sql;
      slaRiskSql = specs.filter(function (s) { return s.key === 'slaRisk'; })[0].sql;
    });

    test('slaKpis and the slaRisk chart use the same two thresholds', function () {
      expect(slaKpisSql).toContain('age_days > sla_days');
      expect(slaKpisSql).toContain('age_days <= sla_days AND age_days > 0.75 * sla_days');
      expect(slaRiskSql).toContain('age_days > sla_days');
      expect(slaRiskSql).toContain('age_days <= sla_days AND age_days > 0.75 * sla_days');
    });

    test('the worklist selects exactly the union of those two bands', function () {
      // breached (age > sla) OR at-risk (0.75*sla < age <= sla) === age > 0.75*sla
      expect(sql).toContain('age_raw > 0.75 * sla_days');
      expect(sql).toContain("IF(age_raw > sla_days, 'BREACHED', 'AT_RISK')");
    });

    test('only open tickets are considered, matching is_open upstream', function () {
      expect(sql).toContain('status NOT IN ' + sandbox.CONFIG.ZOHO_TERMINAL_STATUSES);
    });

    test('reads through the dedup/assigned-only view, not the raw table', function () {
      expect(sql).toContain('QUALIFY ROW_NUMBER()');
      expect(sql).not.toMatch(/FROM\s+`[^`]*\.zoho_data`\s+WHERE\s+status/);
    });
  });
});
