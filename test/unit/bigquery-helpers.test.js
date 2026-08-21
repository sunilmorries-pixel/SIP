'use strict';

/**
 * Unit tests for src/server/BigQuery.js's pure helpers — the layer every
 * number in the app passes through on its way out of BigQuery.
 *
 * This file exists because the 2026-08-19 data-correctness audit found
 * BigQuery.js had NO unit coverage at all: parseRows_'s type coercion,
 * NULL preservation, and shortHash's cache-key formatting were entirely
 * untested, and two real defects were sitting in them.
 *
 * parseRows_ and shortHash are pure (no UrlFetchApp, no CacheService), so
 * they run directly against the loaded sandbox. shortHash needs a real MD5
 * — see the Utilities stub in test/helpers/loadGas.js for why.
 */

const { loadGas } = require('../helpers/loadGas');

describe('shortHash (BigQuery.js)', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'BigQuery.js']);
  });

  test('is stable — the same input always yields the same digest', function () {
    expect(sandbox.shortHash('abc')).toBe(sandbox.shortHash('abc'));
  });

  test('emits exactly two hex characters per source byte', function () {
    // MD5 is 16 bytes -> 32 hex chars, truncated to 16 by shortHash. Any byte
    // below 0x10 rendering as ONE char makes the digest shorter than 16 and
    // makes the concatenation ambiguous: bytes [0x0A,0xBC] and [0xAB,0x0C]
    // would both render "abc". Probe many inputs so at least one digest is
    // near-certain to contain a low byte.
    for (let i = 0; i < 200; i++) {
      const digest = sandbox.shortHash('probe-' + i);
      expect(digest).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  test('two inputs whose digests differ only in low-byte placement do not collide', function () {
    // Guards the concatenation ambiguity directly: with correct zero-padding
    // every distinct 16-char prefix stays distinct. Collect a large sample and
    // assert no two distinct inputs share a digest.
    const seen = new Map();
    for (let i = 0; i < 2000; i++) {
      const input = 'filters-' + i;
      const digest = sandbox.shortHash(input);
      expect(seen.has(digest)).toBe(false);
      seen.set(digest, input);
    }
  });
});

describe('parseRows_ (BigQuery.js)', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'BigQuery.js']);
  });

  /** Builds a BigQuery REST-shaped response for one row. */
  function response(fields, values) {
    return {
      schema: { fields: fields },
      rows: [{ f: values.map(function (v) { return { v: v }; }) }],
    };
  }

  test('SQL NULL stays null — never coerced to 0 or empty string', function () {
    // The single most consequential behaviour in this file: a NULL coerced to 0
    // would silently drag every average down and inflate every count.
    const rows = sandbox.parseRows_(response(
      [{ name: 'n', type: 'INTEGER' }, { name: 'f', type: 'FLOAT' }, { name: 's', type: 'STRING' }],
      [null, null, null]
    ));
    expect(rows[0].n).toBeNull();
    expect(rows[0].f).toBeNull();
    expect(rows[0].s).toBeNull();
  });

  test('coerces the legacy type names the REST API currently returns', function () {
    const rows = sandbox.parseRows_(response(
      [{ name: 'i', type: 'INTEGER' }, { name: 'f', type: 'FLOAT' },
       { name: 'n', type: 'NUMERIC' }, { name: 'b', type: 'BOOLEAN' }],
      ['42', '3.5', '7.25', 'true']
    ));
    expect(rows[0].i).toBe(42);
    expect(rows[0].f).toBe(3.5);
    expect(rows[0].n).toBe(7.25);
    expect(rows[0].b).toBe(true);
  });

  test('coerces the standard type names too, so a future API change cannot silently stringify every number', function () {
    // If the REST API ever emits INT64/FLOAT64/BOOL instead of the legacy
    // names, unhandled types fall through as strings and downstream JS
    // arithmetic string-concatenates instead of adding — a silently wrong
    // number with no error.
    const rows = sandbox.parseRows_(response(
      [{ name: 'i', type: 'INT64' }, { name: 'f', type: 'FLOAT64' }, { name: 'b', type: 'BOOL' }],
      ['42', '3.5', 'true']
    ));
    expect(rows[0].i).toBe(42);
    expect(rows[0].f).toBe(3.5);
    expect(rows[0].b).toBe(true);
  });

  test('renders TIMESTAMP as an ISO string, not a raw epoch float', function () {
    // BigQuery serialises TIMESTAMP as seconds-since-epoch in a string
    // ("1.7555616E9"). The Raw Data page issues SELECT *, so raw TIMESTAMP
    // columns (cloud_devices.LastTimeStamp, jira_data.ticket_created) reach
    // the on-screen table and the CSV export verbatim.
    const rows = sandbox.parseRows_(response(
      [{ name: 'ts', type: 'TIMESTAMP' }],
      ['1.7555616E9']
    ));
    expect(rows[0].ts).toBe('2025-08-19T00:00:00.000Z'); // 1755561600s since epoch
  });

  test('keeps an INT64 beyond Number.MAX_SAFE_INTEGER as a string rather than losing precision', function () {
    const rows = sandbox.parseRows_(response(
      [{ name: 'big', type: 'INTEGER' }],
      ['9007199254740993']
    ));
    expect(rows[0].big).toBe('9007199254740993');
  });

  test('leaves DATE and DATETIME as the usable strings BigQuery already returns', function () {
    const rows = sandbox.parseRows_(response(
      [{ name: 'd', type: 'DATE' }, { name: 'dt', type: 'DATETIME' }],
      ['2026-08-21', '2026-08-21 14:05:00']
    ));
    expect(rows[0].d).toBe('2026-08-21');
    expect(rows[0].dt).toBe('2026-08-21 14:05:00');
  });

  test('returns an empty array when the response carries no rows', function () {
    expect(sandbox.parseRows_({ schema: { fields: [] } })).toEqual([]);
    expect(sandbox.parseRows_({ rows: [] })).toEqual([]);
  });
});
