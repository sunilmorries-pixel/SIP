'use strict';

/**
 * Unit tests for the page-level Segment dropdown's SQL-fragment helpers in
 * src/server/Queries.js (segClean_, segSlug_, cdSegCond_, devSegCond_).
 * These are pure string transforms — no BigQuery, no network — so they're
 * exercised directly against the loaded Apps Script sandbox.
 *
 * Loaded via loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js']): Queries.js
 * references CONFIG/T()/cdFilter_ at call time in other functions in the same
 * file, so all three files are loaded for a stable, reusable sandbox — even
 * though these four functions specifically only need CONFIG (segClean_,
 * segSlug_, cdSegCond_) or T()+cdFilter_ (devSegCond_, and even then only for
 * the non-empty branch).
 */

const { loadGas } = require('../helpers/loadGas');

describe('segment filter helpers (Queries.js)', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js']);
  });

  describe('segClean_', function () {
    test('passes through a clean string unchanged', function () {
      expect(sandbox.segClean_('Government')).toBe('Government');
    });

    test('strips single quotes, double quotes, and backslashes', function () {
      expect(sandbox.segClean_('a\'b"c\\d')).toBe('abcd');
    });

    test('truncates a 100-char string to 80 chars', function () {
      const long = 'a'.repeat(100);
      const cleaned = sandbox.segClean_(long);
      expect(cleaned.length).toBe(80);
      expect(cleaned).toBe('a'.repeat(80));
    });

    test('returns "" for null, undefined, and empty string', function () {
      expect(sandbox.segClean_(null)).toBe('');
      expect(sandbox.segClean_(undefined)).toBe('');
      expect(sandbox.segClean_('')).toBe('');
    });

    test('does NOT trim whitespace (deliberate design invariant, not an oversight)', function () {
      // segmentOptions already emits pre-trimmed values server-side; if
      // segClean_ started trimming too, this contract would silently break.
      const withSpace = ' Government ';
      expect(sandbox.segClean_(withSpace)).toBe(withSpace);
    });
  });

  describe('segSlug_', function () {
    test('lowercases and hyphenates a multi-word segment', function () {
      expect(sandbox.segSlug_('LE - Cath Lab')).toBe('le-cath-lab');
    });

    test('defaults to "all" for empty string and null', function () {
      expect(sandbox.segSlug_('')).toBe('all');
      expect(sandbox.segSlug_(null)).toBe('all');
    });

    test('defaults to "all" when the input is entirely non-alphanumeric', function () {
      // '---' collapses to a single '-' run, which is then stripped of its
      // leading/trailing '-', leaving '' — which falls back to 'all'.
      expect(sandbox.segSlug_('---')).toBe('all');
    });
  });

  describe('cdSegCond_', function () {
    test('returns "" for an empty/falsy segment', function () {
      expect(sandbox.cdSegCond_('')).toBe('');
      expect(sandbox.cdSegCond_(null)).toBe('');
    });

    test('returns an AND clause using the CLEANED segment as the SQL literal', function () {
      expect(sandbox.cdSegCond_('Government'))
        .toBe(" AND TRIM(IFNULL(hub_master_segment,'')) = 'Government'");
    });

    test('the emitted literal is segClean_(segment), not the raw input — quotes get stripped too', function () {
      const raw = "Gov't";
      const result = sandbox.cdSegCond_(raw);
      const cleaned = sandbox.segClean_(raw); // 'Govt'
      expect(result).toBe(" AND TRIM(IFNULL(hub_master_segment,'')) = '" + cleaned + "'");
      expect(result).not.toContain("Gov't");
    });
  });

  describe('devSegCond_', function () {
    test('returns "" for an empty/falsy segment', function () {
      expect(sandbox.devSegCond_('')).toBe('');
      expect(sandbox.devSegCond_(null)).toBe('');
    });

    test('non-empty segment yields a CenterID subquery referencing cdFilter_() and cdSegCond_()', function () {
      // cdFilter_ lives in EditionCD.js, so load a sandbox that includes it
      // here rather than baking today's '1=1' value into this test.
      const sandboxWithCd = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'EditionCD.js']);
      const cdFilterValue = sandboxWithCd.cdFilter_();
      const cleaned = sandboxWithCd.segClean_('Government');

      const result = sandboxWithCd.devSegCond_('Government');

      expect(result).toContain('CenterID IN (');
      expect(result).toContain(cleaned);
      expect(result).toContain(cdFilterValue);
    });
  });
});
