'use strict';

/**
 * Unit tests for src/server/SlaCatalog.js: slaFor (JS lookup + fallback
 * heuristic) and the SQL-fragment generators techBoolSql_ / slaDaysCaseSql_.
 * CONFIG.SLA_DEFAULT_DAYS and CONFIG.TECH_FALLBACK_REGEX are read from the
 * loaded sandbox rather than hardcoded, so these tests don't silently drift
 * if Config.js changes.
 *
 * Loaded via loadGas(['Config.js', 'SlaCatalog.js']).
 */

const { loadGas } = require('../helpers/loadGas');

describe('SLA catalog (SlaCatalog.js)', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'SlaCatalog.js']);
  });

  describe('slaFor', function () {
    test('a category IN the catalog returns its exact row', function () {
      // Real catalog entry (src/server/SlaCatalog.js:18): days 2, tech false.
      expect(sandbox.slaFor('Doctor Signature/Qualification Request')).toEqual({
        days: 2,
        tech: false,
        matched: true,
      });
    });

    test('a category NOT in the catalog falls back to CONFIG.SLA_DEFAULT_DAYS and a regex-based tech flag', function () {
      const category = 'Some Totally Made Up Category';
      const expectedTech = new RegExp(sandbox.CONFIG.TECH_FALLBACK_REGEX).test(category.toLowerCase());
      expect(expectedTech).toBe(false); // sanity: this fixture shouldn't hit the fallback keywords

      expect(sandbox.slaFor(category)).toEqual({
        days: sandbox.CONFIG.SLA_DEFAULT_DAYS,
        tech: false,
        matched: false,
      });
    });

    test('an unlisted category matching TECH_FALLBACK_REGEX resolves tech: true', function () {
      const category = 'Random Machine Explosion'; // contains "machine", not an exact catalog name
      const expectedTech = new RegExp(sandbox.CONFIG.TECH_FALLBACK_REGEX).test(category.toLowerCase());
      expect(expectedTech).toBe(true); // sanity: this fixture SHOULD hit the fallback keywords

      expect(sandbox.slaFor(category)).toEqual({
        days: sandbox.CONFIG.SLA_DEFAULT_DAYS,
        tech: true,
        matched: false,
      });
    });
  });

  describe('techBoolSql_', function () {
    test('returned SQL fragment contains the passed-in column expression', function () {
      const sql = sandbox.techBoolSql_('MyCol');
      expect(sql).toContain('MyCol');
    });
  });

  describe('slaDaysCaseSql_', function () {
    test('returned SQL contains the column expression, a real catalog WHEN clause, and the ELSE default', function () {
      const sql = sandbox.slaDaysCaseSql_('MyCol2');

      expect(sql).toContain('MyCol2');
      // Real catalog entry: 'Doctor Signature/Qualification Request' -> days 2.
      expect(sql).toContain("WHEN 'doctor signature/qualification request' THEN 2");
      expect(sql).toContain('ELSE ' + sandbox.CONFIG.SLA_DEFAULT_DAYS + ' END');
    });
  });
});
