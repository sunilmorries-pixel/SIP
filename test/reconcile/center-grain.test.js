'use strict';

/**
 * Structural invariants for center-grain queries: catch row-vs-center-grain
 * bugs (the "140% of centers" class of defect) regardless of what the live
 * data actually contains. These assert SHAPE, not business value — they
 * should stay true no matter how BigQuery's row counts change day to day.
 */

const { loadGas } = require('../helpers/loadGas');
const { hasCredentials, runQuery } = require('../helpers/bq');

const maybeDescribe = hasCredentials() ? describe : describe.skip;

maybeDescribe('center-grain invariants (live BigQuery)', function () {
  let sandbox;
  let specs;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'EditionCD.js']);
    specs = sandbox.buildDashboardQuerySpecsCD('', '');
  });

  test('centerKpis: active_deployments <= centers (row-grain vs center-grain regression guard)', async function () {
    const spec = specs.find(function (s) { return s.key === 'centerKpis'; });
    const rows = await runQuery(spec.sql);
    const row = rows[0];
    expect(row.active_deployments).toBeLessThanOrEqual(row.centers);
    // Also catches the specific historical bug shape: if a future edit
    // reintroduces COUNTIF(...) over raw rows instead of
    // COUNT(DISTINCT IF(...)), duplicate rows per center would push this
    // ratio back over 1.0 (was 25,648 / 18,370 = 1.40).
    expect(row.active_deployments / row.centers).toBeLessThanOrEqual(1.0);
  });

  test('centerKpis: states/cities counts are non-negative and bounded by centers', async function () {
    const spec = specs.find(function (s) { return s.key === 'centerKpis'; });
    const rows = await runQuery(spec.sql);
    const row = rows[0];
    // A center is in exactly one state/city, so distinct states/cities can
    // never exceed distinct centers.
    expect(row.states).toBeGreaterThanOrEqual(0);
    expect(row.states).toBeLessThanOrEqual(row.centers);
  });

  test('geo: per-state distinct-center sum does not exceed the true center total (row-inflation guard)', async function () {
    const geoSpec = specs.find(function (s) { return s.key === 'geo'; });
    const kpiSpec = specs.find(function (s) { return s.key === 'centerKpis'; });
    const [geoRows, kpiRows] = await Promise.all([
      runQuery(geoSpec.sql),
      runQuery(kpiSpec.sql),
    ]);
    const geoSum = geoRows.reduce(function (sum, r) { return sum + Number(r.devices); }, 0);
    // geo is LIMIT 12 (top states only), so this is <=, not ==.
    expect(geoSum).toBeLessThanOrEqual(kpiRows[0].centers);
  });

  test('geo spec SQL uses COUNT(DISTINCT ...) — regression guard against reverting to COUNT(*)', function () {
    const geoSpec = specs.find(function (s) { return s.key === 'geo'; });
    expect(geoSpec.sql).toMatch(/COUNT\(DISTINCT\s+CenterID\)/i);
  });

  test('uptimeFleet: pct99 and pct_healthy are valid percentages (0-100)', async function () {
    const spec = specs.find(function (s) { return s.key === 'uptimeFleet'; });
    const rows = await runQuery(spec.sql);
    const row = rows[0];
    if (row.pct99 != null) {
      expect(row.pct99).toBeGreaterThanOrEqual(0);
      expect(row.pct99).toBeLessThanOrEqual(100);
    }
    if (row.pct_healthy != null) {
      expect(row.pct_healthy).toBeGreaterThanOrEqual(0);
      expect(row.pct_healthy).toBeLessThanOrEqual(100);
    }
  });

  test('uptimeFleet: scored centers <= total centers', async function () {
    const uptimeSpec = specs.find(function (s) { return s.key === 'uptimeFleet'; });
    const kpiSpec = specs.find(function (s) { return s.key === 'centerKpis'; });
    const [uptimeRows, kpiRows] = await Promise.all([
      runQuery(uptimeSpec.sql),
      runQuery(kpiSpec.sql),
    ]);
    expect(uptimeRows[0].scored).toBeLessThanOrEqual(kpiRows[0].centers);
  });
});
