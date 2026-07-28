'use strict';

/**
 * Regression pins for specific bugs already found and fixed in this
 * project's history. Each test names the bug, the commit that fixed it,
 * and the exact wrong behavior it guards against — so if one ever fails,
 * the fix log below explains what to check first.
 */

const { loadGas } = require('../helpers/loadGas');
const { hasCredentials, runQuery, resolveTarget } = require('../helpers/bq');

const maybeDescribe = hasCredentials() ? describe : describe.skip;

maybeDescribe('known regressions (live BigQuery)', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'EditionCD.js']);
  });

  test('avg_open_age_days is computed from CreatedAt, not a raw TicketActiveDays column (fixed 2026-07-16, b8f8725)', function () {
    // b8f8725 replaced AVG(TicketActiveDays) with a DATETIME_DIFF(...)
    // expression because the raw column's freshness/update cadence was
    // never verified. If someone reverts to trusting the raw column, this
    // string check catches it without needing live BigQuery.
    const specs = sandbox.buildDashboardQuerySpecs('', '');
    const spec = specs.find(function (s) { return s.key === 'zohoKpis'; });
    expect(spec.sql).not.toMatch(/AVG\([^)]*TicketActiveDays/i);
    expect(spec.sql).toMatch(/avg_open_age_days/i);
  });

  test('centerKpis has no dead duplicate "devices" alias (cleanup 2026-07-28, 724410f)', function () {
    // The original centerKpis spec had `COUNT(DISTINCT CenterID) AS devices`
    // as a second, unused copy of `centers` — confusing and easy to
    // mistake for an actual device count (center_details has no device
    // grain). Guards against it silently coming back.
    const specs = sandbox.buildDashboardQuerySpecsCD('', '');
    const spec = specs.find(function (s) { return s.key === 'centerKpis'; });
    expect(spec.sql).not.toMatch(/AS\s+devices\b/i);
  });

  test('centerKpis.active_deployments exactly matches an independently-computed distinct-center count', async function () {
    // A bound check (active_deployments <= centers) is NOT sufficient here:
    // post-v5.10 (baseline filter removed, 0c851b1), `centers` is the full
    // 27,410-row universe, so the historical bug's inflated row count
    // (25,863) sits UNDER that ceiling even though it's still wrong versus
    // the true distinct-active-center count (18,490) — a bound check alone
    // would silently pass this exact regression today. Verified by hand
    // 2026-07-28: COUNTIF(deactivationdate IS NULL)=25,863 vs
    // COUNT(DISTINCT IF(...))=18,490 vs total_centers=27,410 — the bug
    // reproduces and a <= check does not catch it.
    //
    // So this asserts EXACT equality against ground truth computed by a
    // query written independently here, not derived from the app's own
    // cdFilter_()/T() helpers — a bug shared between the app's SQL and this
    // test's "expected" side would otherwise cancel out and prove nothing.
    const specs = sandbox.buildDashboardQuerySpecsCD('', '');
    const spec = specs.find(function (s) { return s.key === 'centerKpis'; });
    const target = resolveTarget();
    const [appRows, truthRows] = await Promise.all([
      runQuery(spec.sql),
      runQuery(
        'SELECT COUNT(DISTINCT IF(deactivationdate IS NULL, CenterID, NULL)) AS active_centers ' +
        'FROM `' + target.dataset + '.center_details`'
      ),
    ]);
    expect(appRows[0].active_deployments).toBe(truthRows[0].active_centers);
  });

  test('segment values reach SQL verbatim (untrimmed) — segClean_ never trims (design invariant, 2026-07-10)', function () {
    // segClean_ deliberately does NOT trim, because segmentOptions already
    // emits pre-trimmed values server-side (TRIM(hub_master_segment)) — if
    // segClean_ started trimming too, a value with meaningful whitespace
    // (if one ever existed) would silently diverge between what the client
    // sent and what matched in SQL. This pins the "no trim" contract.
    const withSpace = ' Government ';
    const cleaned = sandbox.segClean_(withSpace);
    expect(cleaned).toBe(withSpace); // untouched except quote/backslash stripping
  });

  test('segClean_ strips quotes and backslashes (SQL-injection guard)', function () {
    const dangerous = 'a\'"\\b';
    const cleaned = sandbox.segClean_(dangerous);
    expect(cleaned).not.toMatch(/['"\\]/);
  });
});
