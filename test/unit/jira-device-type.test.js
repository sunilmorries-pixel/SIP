'use strict';

/**
 * Unit test for isTrackedJiraDeviceType_ (src/server/Numbers.js): the
 * permanent restriction that only specific Jira "Issue Type" values count as
 * a tracked device anywhere in the app. Reads CONFIG.JIRA_DEVICE_TYPES from
 * the loaded sandbox rather than hardcoding its members, so this doesn't
 * silently drift if Config.js changes.
 *
 * Loaded via loadGas(['Config.js', 'Numbers.js']).
 */

const { loadGas } = require('../helpers/loadGas');

describe('isTrackedJiraDeviceType_ (Numbers.js)', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'Numbers.js']);
  });

  test('CONFIG.JIRA_DEVICE_TYPES is non-empty (sanity check for the fixtures below)', function () {
    expect(sandbox.CONFIG.JIRA_DEVICE_TYPES.length).toBeGreaterThan(0);
  });

  test('an exact-case member of JIRA_DEVICE_TYPES matches', function () {
    const member = sandbox.CONFIG.JIRA_DEVICE_TYPES[0];
    expect(sandbox.isTrackedJiraDeviceType_(member)).toBe(true);
  });

  test('a member with different casing and surrounding whitespace still matches (trim + lowercase)', function () {
    const member = sandbox.CONFIG.JIRA_DEVICE_TYPES[0];
    const noisy = '  ' + member.toUpperCase() + '  ';
    expect(sandbox.isTrackedJiraDeviceType_(noisy)).toBe(true);
  });

  test('a non-member issue type returns false', function () {
    expect(sandbox.CONFIG.JIRA_DEVICE_TYPES.indexOf('tablet')).toBe(-1); // sanity: fixture really is a non-member
    expect(sandbox.isTrackedJiraDeviceType_('Tablet')).toBe(false);
  });
});
