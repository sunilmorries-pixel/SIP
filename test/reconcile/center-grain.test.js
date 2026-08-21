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

  test('centerKpis: centers_with_open_tickets is non-negative and bounded by centers', async function () {
    // Was asserting on `row.states`, a column centerKpis stopped returning when
    // v12 replaced the "States" tile with centers_with_open_tickets — so this
    // test would have thrown on expect(undefined) the moment it ran with
    // credentials. It never did: test/reconcile is credential-gated, and
    // `npm test` roots only at test/unit. Retargeted 2026-08-21 onto the column
    // that actually exists, preserving the same bounded-by-centers invariant.
    const spec = specs.find(function (s) { return s.key === 'centerKpis'; });
    const rows = await runQuery(spec.sql);
    const row = rows[0];
    // Every counted center is drawn from the same filtered center set, so a
    // subset count can never exceed the total. If it does, the sub-count has
    // regressed to counting raw rows instead of COUNT(DISTINCT CenterID).
    expect(row.centers_with_open_tickets).toBeGreaterThanOrEqual(0);
    expect(row.centers_with_open_tickets).toBeLessThanOrEqual(row.centers);
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

  test('apiGetCentersCD Status filter narrows results to only that status (structural check via direct SQL, since apiGetCentersCD itself needs the Apps Script runtime)', async function () {
    const specs = sandbox.buildDashboardQuerySpecsCD('', {});
    // Proxy check: COUNT(DISTINCT CenterID) WHERE Status IN ('ACTIVE') must be
    // strictly <= the unfiltered centerKpis.centers count, and > 0 (sandbox/dwh
    // always has some active centers) — a full apiGetCentersCD() call needs the
    // live Apps Script environment (PropertiesService/CacheService), so this
    // test checks the underlying SQL/grain logic apiGetCentersCD's predicate
    // ultimately reads from instead.
    const kpiSpec = specs.find(function (s) { return s.key === 'centerKpis'; });
    const allRows = await runQuery(kpiSpec.sql);
    const activeSpecs = sandbox.buildDashboardQuerySpecsCD('', { statuses: ['ACTIVE'] });
    const activeRows = await runQuery(activeSpecs.find(function (s) { return s.key === 'centerKpis'; }).sql);
    expect(activeRows[0].centers).toBeGreaterThan(0);
    expect(activeRows[0].centers).toBeLessThanOrEqual(allRows[0].centers);
  });

  test('multi-value segment filter: 2 segments selected sums to each selected individually (no double-counting)', async function () {
    var specs = sandbox.buildDashboardQuerySpecsCD('', {});
    var segOptRows = await runQuery(specs.find(function (s) { return s.key === 'segmentOptions'; }).sql);
    var segs = segOptRows.map(function (r) { return r.segment; }).slice(0, 2);
    if (segs.length < 2) return; // skip gracefully if fewer than 2 real segments exist
    var eachTotal = 0;
    for (var i = 0; i < segs.length; i++) {
      var s1 = sandbox.buildDashboardQuerySpecsCD('', { segments: [segs[i]] });
      var r1 = await runQuery(s1.find(function (s) { return s.key === 'centerKpis'; }).sql);
      eachTotal += r1[0].centers;
    }
    var sBoth = sandbox.buildDashboardQuerySpecsCD('', { segments: segs });
    var rBoth = await runQuery(sBoth.find(function (s) { return s.key === 'centerKpis'; }).sql);
    expect(rBoth[0].centers).toBe(eachTotal); // a center holds exactly one segment value — no overlap possible
  });

  /**
   * The permanent guard for finding I4 (2026-07-29 whole-branch review).
   *
   * This app filters the SAME dimensions through TWO independent paths, by
   * design (see the "Center-360 JS-predicate architecture" note in the SDD
   * ledger): SQL — multiCond_ fragments inside the center_details queries — and
   * JS — centerPassesFilters_ over the cached Center-360 row array. Nothing in
   * the type system makes them agree; a normalization difference in either one
   * silently skews or zeroes out results. These two tests make the two paths
   * count the same universe and assert they land on the same number.
   */
  test('SQL filter path and JS centerPassesFilters_ predicate agree on the same filter set', async function () {
    const filters = { segments: [], statuses: ['ACTIVE'], states: [], hubs: [], dateFrom: '', dateTo: '' };
    const kpiSpec = sandbox.buildDashboardQuerySpecsCD('', filters)
      .find(function (s) { return s.key === 'centerKpis'; });
    const [baseRows, kpiRows] = await Promise.all([
      runQuery(sandbox.centerBaseSpecCD_().sql), // the exact rows the JS predicate runs over
      runQuery(kpiSpec.sql),
    ]);

    // Dedupe to center grain on the JS side too — centerKpis is
    // COUNT(DISTINCT CenterID), and center_details has duplicate rows per center.
    const passing = {};
    baseRows.forEach(function (r) {
      if (sandbox.centerPassesFilters_(r, filters)) passing[r.center_id] = true;
    });

    expect(kpiRows[0].centers).toBeGreaterThan(0); // guard against a vacuous 0 === 0 pass
    expect(Object.keys(passing).length).toBe(kpiRows[0].centers);
  });

  test('a whitespace-padded HubName matches identically in SQL and JS (the exact I4 failure mode)', async function () {
    // 2,806 sandbox rows carry a padded HubName. Pre-fix, the SQL path compared
    // the raw column while the JS path compared an untrimmed field, so selecting
    // one of these hubs could silently return a different count per path.
    const CD = sandbox.T('center_details');
    const paddedRows = await runQuery(
      "SELECT TRIM(HubName) AS hub, COUNT(*) AS n FROM " + CD +
      " WHERE HubName != TRIM(HubName) AND NULLIF(TRIM(HubName), '') IS NOT NULL" +
      " GROUP BY hub ORDER BY n DESC LIMIT 1");
    if (!paddedRows.length) return; // dataset has no padded values — nothing to guard here

    const filters = { segments: [], statuses: [], states: [], hubs: [paddedRows[0].hub], dateFrom: '', dateTo: '' };
    const kpiSpec = sandbox.buildDashboardQuerySpecsCD('', filters)
      .find(function (s) { return s.key === 'centerKpis'; });
    const [baseRows, kpiRows] = await Promise.all([
      runQuery(sandbox.centerBaseSpecCD_().sql),
      runQuery(kpiSpec.sql),
    ]);

    const passing = {};
    baseRows.forEach(function (r) {
      if (sandbox.centerPassesFilters_(r, filters)) passing[r.center_id] = true;
    });

    // > 0 is the load-bearing half: an untrimmed comparison on either side makes
    // a padded hub select nothing at all, which would still satisfy equality.
    expect(kpiRows[0].centers).toBeGreaterThan(0);
    expect(Object.keys(passing).length).toBe(kpiRows[0].centers);
  });

  test('date-range filter narrows deploymentAge band totals versus unfiltered', async function () {
    var unfiltered = sandbox.buildDashboardQuerySpecsCD('', {});
    var uRows = await runQuery(unfiltered.find(function (s) { return s.key === 'deploymentAge'; }).sql);
    var uTotal = uRows.reduce(function (sum, r) { return sum + r.devices; }, 0);
    var filtered = sandbox.buildDashboardQuerySpecsCD('', { dateFrom: '2024-01-01', dateTo: '2024-12-31' });
    var fRows = await runQuery(filtered.find(function (s) { return s.key === 'deploymentAge'; }).sql);
    var fTotal = fRows.reduce(function (sum, r) { return sum + r.devices; }, 0);
    expect(fTotal).toBeLessThanOrEqual(uTotal);
  });
});
