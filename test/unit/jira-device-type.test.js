'use strict';

/**
 * Unit test for isTrackedJiraDeviceType_ (src/server/Numbers.js): every Jira
 * "Issue Type" counts as a tracked device EXCEPT the housekeeping ticket
 * types in CONFIG.JIRA_NON_DEVICE_TYPES. Reads that list from the loaded
 * sandbox rather than hardcoding its members, so this doesn't silently drift
 * if Config.js changes.
 *
 * Loaded via loadGas(['Config.js', 'Numbers.js']).
 */

const { loadGas } = require('../helpers/loadGas');

describe('isTrackedJiraDeviceType_ (Numbers.js)', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'Numbers.js']);
  });

  test('CONFIG.JIRA_NON_DEVICE_TYPES is non-empty (sanity check for the fixtures below)', function () {
    expect(sandbox.CONFIG.JIRA_NON_DEVICE_TYPES.length).toBeGreaterThan(0);
  });

  test('an exact-case member of JIRA_NON_DEVICE_TYPES does NOT match', function () {
    const member = sandbox.CONFIG.JIRA_NON_DEVICE_TYPES[0];
    expect(sandbox.isTrackedJiraDeviceType_(member)).toBe(false);
  });

  test('a member with different casing and surrounding whitespace still does NOT match (trim + lowercase)', function () {
    const member = sandbox.CONFIG.JIRA_NON_DEVICE_TYPES[0];
    const noisy = '  ' + member.toUpperCase() + '  ';
    expect(sandbox.isTrackedJiraDeviceType_(noisy)).toBe(false);
  });

  test('a non-member issue type (a real device category) returns true', function () {
    expect(sandbox.CONFIG.JIRA_NON_DEVICE_TYPES.indexOf('sim card')).toBe(-1); // sanity: fixture really is a non-member
    expect(sandbox.isTrackedJiraDeviceType_('SIM Card')).toBe(true);
    expect(sandbox.isTrackedJiraDeviceType_('Connector')).toBe(true);
    expect(sandbox.isTrackedJiraDeviceType_('ECG Machine')).toBe(true);
  });

  test('a blank Issue Type is tracked (not in the exclusion list)', function () {
    expect(sandbox.isTrackedJiraDeviceType_('')).toBe(true);
  });
});

/**
 * filteredJiraDevices_ is the single filter chain behind every device count in
 * the app — the Overview Devices tree, the Asset "Total fleet" KPI, and the
 * Numbers page totals. It reads BigQuery through readJiraData_ /
 * deviceCenterMap_ / centerFilterMap_, so the tests below inject those three
 * seams instead of hitting the network: `dcm` is a documented parameter, and
 * the other two are reassigned on the sandbox (bare top-level `function`
 * declarations are properties of the vm global, so a call-time lookup finds
 * the replacement).
 *
 * This block replaces a placeholder that asserted only
 * `JIRA_NON_DEVICE_TYPES.length > 0` and deferred real coverage to
 * "jiraDeviceStats_'s own test coverage below" — which did not exist. That
 * gap is why the two defects exercised here (a date range rejecting every
 * device; the `centers` dimension being ignored) shipped unnoticed.
 */
describe('filteredJiraDevices_ (Numbers.js)', function () {
  let sandbox;

  /** Three tracked devices: two mapped to centers 1 and 2, one unmappable. */
  const JIRA_ROWS = [
    { issue_key: 'D-1', summary: 'Vcardia - A1-AAAAAA1', issuetype_name: 'Connector', status_name: 'Deployed', ticket_created: '2026-03-10 09:00:00' },
    { issue_key: 'D-2', summary: 'Vcardia - B2-BBBBBB2', issuetype_name: 'ECG Machine', status_name: 'Deployed', ticket_created: '2026-06-15 09:00:00' },
    { issue_key: 'D-3', summary: 'no serial here', issuetype_name: 'Connector', status_name: 'Deployed', ticket_created: '2026-06-20 09:00:00' },
    { issue_key: 'T-9', summary: 'Vcardia - C3-CCCCCC3', issuetype_name: 'Task', status_name: 'Deployed', ticket_created: '2026-06-21 09:00:00' },
  ];

  const DCM = { map: { 'A1-AAAAAA1': 1, 'B2-BBBBBB2': 2 }, source: 'test' };

  /**
   * Center-360 rows as getCenter360RowsCD_ really returns them. Stubbing at
   * THIS seam (the BigQuery read) rather than at centerFilterMap_ matters: the
   * defect under test lives inside centerFilterMap_, so a stub of that
   * function would paper over the very bug these tests exist to catch.
   * Center 1 is ACTIVE in Karnataka; center 2 is INACTIVE in Kerala.
   */
  const CENTER_360_ROWS = [
    { center_id: 1, segment: 'LE', status: 'ACTIVE', state: 'Karnataka', hub: 'H1', city: 'Bengaluru', country: 'India', deployment_date: '2024-01-01' },
    { center_id: 2, segment: 'SME', status: 'INACTIVE', state: 'Kerala', hub: 'H2', city: 'Kochi', country: 'India', deployment_date: '2024-02-01' },
  ];

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'BigQuery.js',
      'Api.js', 'EditionCD.js', 'Numbers.js']);
    sandbox.readJiraData_ = function () { return JIRA_ROWS; };
    sandbox.getCenter360RowsCD_ = function () { return CENTER_360_ROWS; };
  });

  test('centerFilterMap_ carries every field centerPassesFilters_ reads', function () {
    // The root cause of both defects below: the map built 6-field rows while
    // the predicate read 8. A missing deployment_date made the date branch
    // reject every row; a missing center_id made the centers branch compare
    // against String(undefined) === "undefined", which never matches.
    const row = sandbox.centerFilterMap_()[1];
    expect(row).toMatchObject({
      segment: 'LE', status: 'ACTIVE', state: 'Karnataka',
      hub: 'H1', city: 'Bengaluru', country: 'India',
      center_id: 1, deployment_date: '2024-01-01',
    });
  });

  /** issue_keys returned for a filter set, sorted for stable comparison. */
  function keysFor(filters) {
    return sandbox.filteredJiraDevices_(filters, DCM)
      .map(function (d) { return d.issue_key; })
      .sort();
  }

  test('excludes housekeeping issue types (Task) the way isTrackedJiraDeviceType_ does', function () {
    expect(keysFor({})).not.toContain('T-9');
  });

  test('with no filters, returns every tracked device including unmappable serials', function () {
    expect(keysFor({})).toEqual(['D-1', 'D-2', 'D-3']);
  });

  test('a center-attribute filter narrows to devices at matching centers, but never drops an unmapped one', function () {
    // D-2 (center 2, INACTIVE) is correctly excluded. D-3 has no resolvable
    // serial at all — since it can't be tested against the filter, it now
    // always passes rather than being silently dropped (fixed 2026-08-25;
    // see the comment on this filter in filteredJiraDevices_).
    expect(keysFor({ statuses: ['ACTIVE'] })).toEqual(['D-1', 'D-3']);
  });

  test('a date range does NOT reject every device', function () {
    // The bug: centerFilterMap_ rows carried no deployment_date, so
    // centerPassesFilters_'s `!d` branch rejected every row and the whole
    // fleet read 0 the moment any date was set in the Filters drawer.
    // D-3 stays in for the same unmapped-always-passes reason as above.
    expect(keysFor({ statuses: ['ACTIVE'], dateFrom: '2020-01-01' })).toEqual(['D-1', 'D-3']);
  });

  test('the date range filters on the device\'s own created date, not its center\'s deployment date', function () {
    // D-1 was created 2026-03-10, D-2 on 2026-06-15. A window opening in May
    // must drop D-1 and keep D-2 — the Asset page's correct path applies the
    // range to the asset's own birthday, and this chain must agree with it.
    expect(keysFor({ dateFrom: '2026-05-01' })).toEqual(['D-2', 'D-3']);
    expect(keysFor({ dateTo: '2026-05-01' })).toEqual(['D-1']);
  });

  test('the centers dimension narrows the fleet when it is the only active filter', function () {
    // The bug: `centers` was absent from hasCenterFilter, so a Center-only
    // selection skipped filtering entirely and returned the whole fleet.
    // D-3 (unmapped) still passes through — see the test above; picking a
    // specific center can't tell an unmapped device it doesn't belong there
    // any more than any other center-attribute filter can.
    expect(keysFor({ centers: ['1'] })).toEqual(['D-1', 'D-3']);
  });

  test('the centers dimension combines with another dimension instead of zeroing the result', function () {
    // The bug: hasCenterFilter was satisfied by `statuses`, then
    // centerPassesFilters_ compared f.centers against String(undefined) —
    // "undefined" never matches, so this returned 0 devices.
    expect(keysFor({ centers: ['1'], statuses: ['ACTIVE'] })).toEqual(['D-1', 'D-3']);
    // D-3 stays even here: centers ['2'] + statuses ACTIVE matches neither
    // D-1 (center 1) nor D-2 (center 2, INACTIVE), but D-3 is unmapped so
    // this dimension combination still can't exclude it.
    expect(keysFor({ centers: ['2'], statuses: ['ACTIVE'] })).toEqual(['D-3']);
  });

  test('deviceTypes is an include list and deviceStatusExclude is an exclude list', function () {
    expect(keysFor({ deviceTypes: ['ECG Machine'] })).toEqual(['D-2']);
    expect(keysFor({ deviceStatusExclude: ['Deployed'] })).toEqual([]);
  });
});
