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
