'use strict';

/**
 * Unit tests for the page-level Segment dropdown's SQL-fragment helpers in
 * src/server/Queries.js (segClean_, segSlug_, cdSegCond_).
 * These are pure string transforms — no BigQuery, no network — so they're
 * exercised directly against the loaded Apps Script sandbox.
 *
 * devSegCond_ (cloud_devices' old single-segment CenterID-subquery bridge)
 * was retired 2026-07-28 by the universal-filter migration (Task 7) in favor
 * of centerFilterSubqueryCond_ (EditionCD.js), which generalizes the same
 * bridge to all 4 center-attribute dimensions at once — see
 * buildDeviceExplorerQuery. Its dedicated test block was removed along with
 * the function; centerFilterSubqueryCond_ now has its own dedicated test
 * block below (`describe('centerFilterSubqueryCond_ ...')`), which is the
 * actual replacement coverage for that same "narrow an outer table via a
 * CenterID subquery" pattern.
 *
 * Loaded via loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js']): Queries.js
 * references CONFIG/T()/cdFilter_ at call time in other functions in the same
 * file, so all three files are loaded for a stable, reusable sandbox — even
 * though these three functions specifically only need CONFIG.
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
});

/**
 * centerFilterSubqueryCond_ (src/server/EditionCD.js) is the generalized
 * replacement for the retired devSegCond_ (see file header above): it narrows
 * an outer table (cloud_devices, zoho_data) to rows whose CenterID passes the
 * center_details filter set, across all 4 center-attribute dimensions
 * (segment/status/state/hub) instead of just segment. It calls multiCond_/T()
 * (Queries.js) and cdFilter_ (EditionCD.js), so this needs its own sandbox
 * loading EditionCD.js in addition to Config.js/SlaCatalog.js/Queries.js.
 */
describe('centerFilterSubqueryCond_ (EditionCD.js)', function () {
  let sandboxWithCd;

  beforeAll(function () {
    sandboxWithCd = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'EditionCD.js']);
  });

  test('returns "" for an empty filters object', function () {
    expect(sandboxWithCd.centerFilterSubqueryCond_({})).toBe('');
  });

  test('returns "" when every dimension array is present but empty', function () {
    expect(sandboxWithCd.centerFilterSubqueryCond_({ segments: [], statuses: [], states: [], hubs: [] })).toBe('');
  });

  test('returns "" for undefined/null filters', function () {
    expect(sandboxWithCd.centerFilterSubqueryCond_(undefined)).toBe('');
    expect(sandboxWithCd.centerFilterSubqueryCond_(null)).toBe('');
  });

  test('a single-dimension filter yields a CenterID subquery referencing cdFilter_() and the cleaned literal', function () {
    // cdFilter_ lives in EditionCD.js too, so call it directly rather than
    // hardcoding today's '1=1' value — this test shouldn't drift if that changes.
    const cdFilterValue = sandboxWithCd.cdFilter_();
    const cleaned = sandboxWithCd.segClean_('Government');

    const result = sandboxWithCd.centerFilterSubqueryCond_({ segments: ['Government'] });

    expect(result).toContain('CenterID IN (');
    expect(result).toContain(cleaned);
    expect(result).toContain(cdFilterValue);
    expect(result).toContain("hub_master_segment IN ('" + cleaned + "')");
  });

  test('multiple dimensions are ANDed together inside ONE subquery, not one per dimension', function () {
    const result = sandboxWithCd.centerFilterSubqueryCond_({ statuses: ['ACTIVE'], hubs: ['SomeHub'] });
    expect(result).toContain("Status IN ('ACTIVE')");
    expect(result).toContain("HubName IN ('SomeHub')");
    const subqueryCount = (result.match(/CenterID IN \(/g) || []).length;
    expect(subqueryCount).toBe(1);
  });

  test('all 4 dimensions (segments/statuses/states/hubs) can combine in a single call', function () {
    const result = sandboxWithCd.centerFilterSubqueryCond_({
      segments: ['Government'], statuses: ['ACTIVE'], states: ['Karnataka'], hubs: ['SomeHub']
    });
    expect(result).toContain("hub_master_segment IN ('Government')");
    expect(result).toContain("Status IN ('ACTIVE')");
    expect(result).toContain("State IN ('Karnataka')");
    expect(result).toContain("HubName IN ('SomeHub')");
  });

  test('the emitted literal is sanitized (quotes stripped) the same way multiCond_/segClean_ do', function () {
    const result = sandboxWithCd.centerFilterSubqueryCond_({ segments: ["Gov't"] });
    expect(result).not.toContain("Gov't");
    expect(result).toContain("hub_master_segment IN ('Govt')");
  });
});
