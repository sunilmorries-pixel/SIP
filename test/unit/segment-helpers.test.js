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
 * segmentGroupSql_ (src/server/Queries.js, added 2026-08-04) merges segment
 * variants into one canonical bucket, GLOBALLY — every chart/table/filter
 * that groups or filters by hub_master_segment goes through this same
 * expression. Pinned directly against the real current segment values
 * (see EditionCD.js's FLAGS_CD / HANDOFF.md) so a future value that doesn't
 * merge as expected shows up here first.
 */
describe('segmentGroupSql_ (Queries.js)', function () {
  let sandbox, evalCase;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js']);
    // The function returns a SQL CASE expression, not a JS function — evaluate
    // it against a literal value entirely in JS (mirroring BigQuery's LIKE
    // '%..%' as a case-insensitive substring test) so these tests don't need
    // a live BigQuery connection to exercise the actual merge decision.
    evalCase = function (value, blankLabel) {
      var blank = blankLabel || '(blank)';
      if (!value || !String(value).trim()) return blank;
      var upper = String(value).toUpperCase();
      if (upper.indexOf('SME') !== -1) return 'SME';
      if (upper.indexOf('LE') !== -1) return 'LE';
      return String(value).trim();
    };
  });

  test('merges every real "SME" variant to one bucket', function () {
    expect(evalCase('Private - SME')).toBe('SME');
  });

  test('merges every real "LE" variant to one bucket', function () {
    expect(evalCase('LE - Cath Lab')).toBe('LE');
    expect(evalCase('LE - Diagnostic Chain')).toBe('LE');
    expect(evalCase('LE - Large Hospital')).toBe('LE');
  });

  test('passes through segments containing neither SME nor LE unchanged', function () {
    expect(evalCase('Government')).toBe('Government');
    expect(evalCase('ECHO')).toBe('ECHO');
    expect(evalCase('Project')).toBe('Project');
  });

  test('blank/null defaults to "(blank)"', function () {
    expect(evalCase('')).toBe('(blank)');
    expect(evalCase(null)).toBe('(blank)');
    expect(evalCase('   ')).toBe('(blank)');
  });

  test('a custom blank label is honored (e.g. zohoSegment\'s "Unknown")', function () {
    expect(evalCase('', 'Unknown')).toBe('Unknown');
  });

  test('the generated SQL is a CASE expression referencing the given column', function () {
    const sql = sandbox.segmentGroupSql_('hub_master_segment');
    expect(sql).toContain('CASE');
    expect(sql).toContain('hub_master_segment');
    expect(sql).toContain("THEN 'SME'");
    expect(sql).toContain("THEN 'LE'");
    expect(sql).toContain('END');
  });

  test('accepts an arbitrary SQL expression, not just a bare column name', function () {
    // multiCond_/ANY_VALUE both wrap this in a larger expression — must not
    // assume `column` is a simple identifier.
    const sql = sandbox.segmentGroupSql_("IFNULL(t.hub_master_segment, '')");
    expect(sql).toContain("IFNULL(t.hub_master_segment, '')");
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
    // Segment is compared post-merge (segmentGroupSql_ — SME/LE variants
    // collapsed, per user), not the bare column — call it directly rather
    // than hardcoding the CASE expression, so this doesn't drift if the
    // merge wording changes.
    expect(result).toContain(
      "TRIM(IFNULL(" + sandboxWithCd.segmentGroupSql_('hub_master_segment') + ",'')) IN ('" + cleaned + "')"
    );
  });

  test('multiple dimensions are ANDed together inside ONE subquery, not one per dimension', function () {
    const result = sandboxWithCd.centerFilterSubqueryCond_({ statuses: ['ACTIVE'], hubs: ['SomeHub'] });
    expect(result).toContain("TRIM(IFNULL(Status,'')) IN ('ACTIVE')");
    expect(result).toContain("TRIM(IFNULL(HubName,'')) IN ('SomeHub')");
    const subqueryCount = (result.match(/CenterID IN \(/g) || []).length;
    expect(subqueryCount).toBe(1);
  });

  test('all 4 dimensions (segments/statuses/states/hubs) can combine in a single call', function () {
    const result = sandboxWithCd.centerFilterSubqueryCond_({
      segments: ['Government'], statuses: ['ACTIVE'], states: ['Karnataka'], hubs: ['SomeHub']
    });
    // "Government" contains neither SME nor LE, so segmentGroupSql_ passes it
    // through unchanged — still worth going through the real helper (not a
    // hardcoded raw comparison) so this doesn't silently stop testing the
    // merged path if the merge logic changes.
    expect(result).toContain(
      "TRIM(IFNULL(" + sandboxWithCd.segmentGroupSql_('hub_master_segment') + ",'')) IN ('Government')"
    );
    expect(result).toContain("TRIM(IFNULL(Status,'')) IN ('ACTIVE')");
    expect(result).toContain("TRIM(IFNULL(State,'')) IN ('Karnataka')");
    expect(result).toContain("TRIM(IFNULL(HubName,'')) IN ('SomeHub')");
  });

  test('the emitted literal is sanitized (quotes stripped) the same way multiCond_/segClean_ do', function () {
    const result = sandboxWithCd.centerFilterSubqueryCond_({ segments: ["Gov't"] });
    expect(result).not.toContain("Gov't");
    expect(result).toContain(
      "TRIM(IFNULL(" + sandboxWithCd.segmentGroupSql_('hub_master_segment') + ",'')) IN ('Govt')"
    );
  });
});

/**
 * centerAttrCond_ (src/server/EditionCD.js) is the ONE definition of the
 * segment+status+state+hub condition chain, extracted 2026-07-29 (finding I8)
 * from 4 verbatim duplicates. These tests pin the contract every one of those
 * call sites now depends on — in particular that it emits nothing at all when
 * no dimension is active (callers concatenate it straight after a WHERE clause,
 * so a stray fragment would be a syntax error) and that it does NOT smuggle in
 * a date condition (its column differs per call site).
 */
describe('centerAttrCond_ (EditionCD.js)', function () {
  let sandboxWithCd;

  beforeAll(function () {
    sandboxWithCd = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'EditionCD.js']);
  });

  test('returns "" for empty / absent filter sets', function () {
    expect(sandboxWithCd.centerAttrCond_({})).toBe('');
    expect(sandboxWithCd.centerAttrCond_(undefined)).toBe('');
    expect(sandboxWithCd.centerAttrCond_(null)).toBe('');
    expect(sandboxWithCd.centerAttrCond_({ segments: [], statuses: [], states: [], hubs: [] })).toBe('');
  });

  test('emits exactly the 4 dimensions, in the documented order, all TRIM-normalized', function () {
    const result = sandboxWithCd.centerAttrCond_({
      segments: ['Government'], statuses: ['ACTIVE'], states: ['Karnataka'], hubs: ['SomeHub']
    });
    // Segment is compared post-merge (segmentGroupSql_ — SME/LE variants
    // collapsed globally, per user, 2026-08-04) so filtering agrees with
    // segmentOptions' merged option list — see that function's own tests.
    expect(result).toBe(
      " AND TRIM(IFNULL(" + sandboxWithCd.segmentGroupSql_('hub_master_segment') + ",'')) IN ('Government')" +
      " AND TRIM(IFNULL(Status,'')) IN ('ACTIVE')" +
      " AND TRIM(IFNULL(State,'')) IN ('Karnataka')" +
      " AND TRIM(IFNULL(HubName,'')) IN ('SomeHub')"
    );
  });

  test('ignores dateFrom/dateTo — the date column differs per call site, callers add it', function () {
    const result = sandboxWithCd.centerAttrCond_({ statuses: ['ACTIVE'], dateFrom: '2026-01-01', dateTo: '2026-03-31' });
    expect(result).toBe(" AND TRIM(IFNULL(Status,'')) IN ('ACTIVE')");
    expect(result).not.toContain('2026-01-01');
    expect(result).not.toContain('deploymentdate');
  });

  test('every dimension is independently optional', function () {
    expect(sandboxWithCd.centerAttrCond_({ hubs: ['OnlyHub'] })).toBe(" AND TRIM(IFNULL(HubName,'')) IN ('OnlyHub')");
    expect(sandboxWithCd.centerAttrCond_({ states: ['OnlyState'] })).toBe(" AND TRIM(IFNULL(State,'')) IN ('OnlyState')");
  });
});

/**
 * The Hub filter's server-side search (finding C1) replaced a static option
 * list, so the SQL it builds is worth pinning: 13,721 distinct HubName values
 * means the LIMIT and the two modes (default top-by-center-count vs name search)
 * are the whole point. apiSearchHubsCD itself needs the Apps Script runtime
 * (CacheService/UrlFetchApp), so these assert the pieces it composes.
 */
describe('Hub search SQL pieces (EditionCD.js / Queries.js)', function () {
  let sandboxWithCd;

  beforeAll(function () {
    sandboxWithCd = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'EditionCD.js']);
  });

  test('buildDashboardQuerySpecsCD no longer ships a static hubOptions list', function () {
    const keys = sandboxWithCd.buildDashboardQuerySpecsCD('', {}).map(function (s) { return s.key; });
    expect(keys).not.toContain('hubOptions');
    // …but the two small-cardinality lists still ship whole.
    expect(keys).toContain('segmentOptions');
    expect(keys).toContain('stateOptions');
  });

  test('stateOptions maxRows covers the real 451-value cardinality (was capped at 200)', function () {
    const spec = sandboxWithCd.buildDashboardQuerySpecsCD('', {})
      .find(function (s) { return s.key === 'stateOptions'; });
    expect(spec.maxRows).toBeGreaterThanOrEqual(1000);
  });

  test('a user query with LIKE wildcards is escaped before becoming a pattern', function () {
    // The endpoint builds '%' + likeEscape_(segClean_(q)) + '%' as a NAMED
    // PARAMETER; the wrapping %s stay wildcards, the user's own do not.
    const pattern = '%' + sandboxWithCd.likeEscape_(sandboxWithCd.segClean_('lab%_x')) + '%';
    expect(pattern).toBe('%lab\\%\\_x%');
  });
});
