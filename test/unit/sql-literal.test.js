'use strict';

/**
 * Unit tests for sqlLiteral_ (src/server/Queries.js) and the IN-list builders
 * that emit through it (multiCond_, multiCondNot_).
 *
 * Background: segClean_ is a *sanitiser for slugs and cache keys* — it
 * DELETES quote characters. That is correct for its own purposes, but
 * multiCond_ used it to build SQL string literals, so a filter value
 * containing an apostrophe ("St. Mary's Hospital") was silently rewritten to
 * a value that exists nowhere in the column ("St. Marys Hospital") and
 * matched zero rows. Meanwhile the JS filter path (centerPassesFilters_)
 * compares UNCLEANED values with ===, so Map / CDM / Top Customers / the
 * Overview trees still matched — same filter, same screen, two answers.
 *
 * sqlLiteral_ is the fix: escape (double the apostrophe, per SQL) instead of
 * deleting, so the emitted literal means what the user selected. segClean_ is
 * deliberately left alone — see segment-helpers.test.js for its contract.
 */

const { loadGas } = require('../helpers/loadGas');

describe('sqlLiteral_ (Queries.js)', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js']);
  });

  test('leaves an ordinary value untouched', function () {
    expect(sandbox.sqlLiteral_('Karnataka')).toBe('Karnataka');
  });

  test('doubles an apostrophe rather than deleting it', function () {
    expect(sandbox.sqlLiteral_("St. Mary's Hospital")).toBe("St. Mary''s Hospital");
  });

  test('doubles every apostrophe in a value that has several', function () {
    expect(sandbox.sqlLiteral_("A'B'C")).toBe("A''B''C");
  });

  test('removes backslashes, which BigQuery would otherwise read as escapes', function () {
    expect(sandbox.sqlLiteral_('a\\b')).toBe('ab');
  });

  test('strips newlines and carriage returns so a literal cannot break out of its quotes', function () {
    expect(sandbox.sqlLiteral_('a\nb\rc')).toBe('abc');
  });

  test('neutralises a classic injection payload instead of executing it', function () {
    // The apostrophe is doubled, so the whole payload stays one string literal.
    const emitted = sandbox.sqlLiteral_("x' OR 1=1 --");
    expect(emitted).toBe("x'' OR 1=1 --");
    expect(emitted.split("''").length - 1).toBe(1); // exactly one escaped quote
  });

  test('coerces null and undefined to an empty string', function () {
    expect(sandbox.sqlLiteral_(null)).toBe('');
    expect(sandbox.sqlLiteral_(undefined)).toBe('');
  });

  test('does not truncate a long real-world hospital name', function () {
    // segClean_ caps at 80 characters for slug purposes; a SQL literal must
    // not be silently shortened, because a truncated name matches nothing.
    const long = 'Sri Sathya Sai Institute of Higher Medical Sciences Prasanthigram Anantapur District';
    expect(long.length).toBeGreaterThan(80);
    expect(sandbox.sqlLiteral_(long)).toBe(long);
  });
});

describe('multiCond_ / multiCondNot_ emit escaped literals (Queries.js)', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js']);
  });

  test('an apostrophe in a hub name survives into the IN list, doubled', function () {
    const sql = sandbox.multiCond_('HubName', ["St. Mary's Hospital"]);
    expect(sql).toContain("'St. Mary''s Hospital'");
  });

  test('multiCondNot_ escapes the same way', function () {
    const sql = sandbox.multiCondNot_('status_name', ["Won't Fix"]);
    expect(sql).toContain("'Won''t Fix'");
  });

  test('an empty or all-blank list still emits nothing', function () {
    expect(sandbox.multiCond_('HubName', [])).toBe('');
    expect(sandbox.multiCond_('HubName', null)).toBe('');
    expect(sandbox.multiCond_('HubName', ['', null])).toBe('');
  });

  test('a multi-value list is comma-joined with each value quoted', function () {
    const sql = sandbox.multiCond_('State', ['Karnataka', 'Kerala']);
    expect(sql).toContain("IN ('Karnataka','Kerala')");
  });
});
