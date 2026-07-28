'use strict';

/**
 * Unit tests for the pure date/string parsing helpers in src/server/Api.js:
 * assetDateStr_, assetAgeDays_, assetMachineModel_. These parse Jira-sheet
 * asset fields (Created date, Summary) with no BigQuery, no network.
 *
 * Loaded via loadGas(['Config.js', 'Api.js']) — confirmed this loads cleanly
 * with no additional files: Api.js's other functions reference CONFIG /
 * segClean_ / query builders only inside function bodies (at call time), so
 * they don't need to be defined for the module to evaluate; the three
 * functions under test here don't call any of those helpers at all.
 */

const { loadGas } = require('../helpers/loadGas');

describe('asset field parsing helpers (Api.js)', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'Api.js']);
  });

  describe('assetDateStr_', function () {
    test('formats a Date object as YYYY-MM-DD', function () {
      expect(sandbox.assetDateStr_(new Date(2026, 6, 15))).toBe('2026-07-15');
    });

    test('parses a Jira-sheet date string as YYYY-MM-DD', function () {
      expect(sandbox.assetDateStr_('4/14/2026 18:45:21')).toBe('2026-04-14');
    });

    test('returns "" for an unparseable string', function () {
      expect(sandbox.assetDateStr_('not-a-date')).toBe('');
    });

    test('returns "" for falsy input', function () {
      expect(sandbox.assetDateStr_(null)).toBe('');
      expect(sandbox.assetDateStr_('')).toBe('');
    });
  });

  describe('assetAgeDays_', function () {
    test('a date far in the past yields a large positive integer', function () {
      const result = sandbox.assetAgeDays_('2000-01-01');
      expect(typeof result).toBe('number');
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThan(1000);
    });

    test('a date in the future floors to 0 (Math.max(0, ...) in the code)', function () {
      const future = new Date(Date.now() + 1000 * 86400000); // ~1000 days from now
      expect(sandbox.assetAgeDays_(future)).toBe(0);
    });

    test('returns null for falsy or unparseable input', function () {
      expect(sandbox.assetAgeDays_(null)).toBeNull();
      expect(sandbox.assetAgeDays_('')).toBeNull();
      expect(sandbox.assetAgeDays_('garbage-date-xyz')).toBeNull();
    });
  });

  describe('assetMachineModel_', function () {
    test('branch 1 — 3+ leading letters: takes the leading letter run, uppercased', function () {
      expect(sandbox.assetMachineModel_('Vcardia - B2-1234ABC')).toBe('VCARDIA');
    });

    test('branch 2 — exactly 2 leading alnum chars then a dash (only tried when branch 1 fails)', function () {
      expect(sandbox.assetMachineModel_('B2-123456')).toBe('B2');
    });

    test('matches neither pattern -> ""', function () {
      expect(sandbox.assetMachineModel_('123456')).toBe('');
    });

    test('empty input -> ""', function () {
      expect(sandbox.assetMachineModel_('')).toBe('');
    });
  });
});
