'use strict';

/**
 * Unit tests for the FSE coverage layer (src/server/Fse.js).
 *
 * buildFseLayer_ is pure (roster + coverage rows + an injected HQ resolver), so
 * it is tested end-to-end against fixtures rather than by string-shape checks.
 * FSE_ROSTER ships empty, so every test seeds the sandbox's roster directly —
 * which also proves the empty default really does produce an empty layer.
 */

const { loadGas } = require('../helpers/loadGas');

describe('FSE coverage layer (Fse.js)', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'ServiceWrk.js', 'Fse.js']);
  });

  // Every test sets its own roster; reset so ordering can't leak.
  beforeEach(function () { sandbox.FSE_ROSTER = []; });

  const hqFixed = () => [18.52, 73.85];
  const plotted = ids => ids.reduce((m, id) => { m[String(id)] = true; return m; }, {});

  describe('fseNameKey_', function () {
    test('lowercases, collapses whitespace and trims', function () {
      expect(sandbox.fseNameKey_('  R   Kulkarni ')).toBe('r kulkarni');
      expect(sandbox.fseNameKey_('R KULKARNI')).toBe('r kulkarni');
    });

    test('treats null/undefined/empty as empty string', function () {
      expect(sandbox.fseNameKey_(null)).toBe('');
      expect(sandbox.fseNameKey_(undefined)).toBe('');
      expect(sandbox.fseNameKey_('   ')).toBe('');
    });

    test('does NOT collapse distinct people by reordering words', function () {
      expect(sandbox.fseNameKey_('Kumar R')).not.toBe(sandbox.fseNameKey_('R Kumar'));
    });
  });

  describe('buildFseLayer_', function () {
    test('empty roster yields an empty layer even when coverage rows exist', function () {
      const out = sandbox.buildFseLayer_(
        [{ rep: 'R Kulkarni', customer_id: '101', tickets: 4 }], hqFixed, plotted([101]));
      expect(out.engineers).toEqual([]);
      // The rep is still reported as unmatched rather than dropped silently.
      expect(out.unmatchedReps).toEqual([{ rep: 'R Kulkarni', tickets: 4 }]);
    });

    test('aggregates tickets per center and totals per engineer', function () {
      sandbox.FSE_ROSTER = [{ name: 'R Kulkarni', hqCity: 'Pune', hqState: 'Maharashtra' }];
      const out = sandbox.buildFseLayer_([
        { rep: 'R Kulkarni', customer_id: '101', tickets: 3 },
        { rep: 'r  kulkarni', customer_id: '101', tickets: 2 },   // case/spacing variant
        { rep: 'R Kulkarni', customer_id: '202', tickets: 1 }
      ], hqFixed, plotted([101, 202]));

      expect(out.engineers).toHaveLength(1);
      const e = out.engineers[0];
      expect(e.name).toBe('R Kulkarni');
      expect(e.hq).toBe('Pune, Maharashtra');
      expect(e.tickets).toBe(6);
      expect(e.centers.sort()).toEqual(['101', '202']);
      expect(out.coveredCenterIds.sort()).toEqual(['101', '202']);
      expect(out.unmatchedReps).toEqual([]);
    });

    test('aliases fold onto the same engineer', function () {
      sandbox.FSE_ROSTER = [{
        name: 'R Kulkarni', aliases: ['Kulkarni Rahul', 'RK'],
        hqCity: 'Pune', hqState: 'Maharashtra'
      }];
      const out = sandbox.buildFseLayer_([
        { rep: 'R Kulkarni', customer_id: '101', tickets: 1 },
        { rep: 'Kulkarni Rahul', customer_id: '202', tickets: 5 },
        { rep: 'rk', customer_id: '303', tickets: 2 }
      ], hqFixed, plotted([101, 202, 303]));

      expect(out.engineers).toHaveLength(1);
      expect(out.engineers[0].tickets).toBe(8);
      expect(out.engineers[0].centers.sort()).toEqual(['101', '202', '303']);
      expect(out.unmatchedReps).toEqual([]);
    });

    test('coverage to a center the current filter hid is not counted', function () {
      sandbox.FSE_ROSTER = [{ name: 'A One', hqCity: 'Pune', hqState: 'Maharashtra' }];
      const out = sandbox.buildFseLayer_([
        { rep: 'A One', customer_id: '101', tickets: 3 },
        { rep: 'A One', customer_id: '999', tickets: 7 }   // 999 not plotted
      ], hqFixed, plotted([101]));

      expect(out.engineers[0].centers).toEqual(['101']);
      expect(out.engineers[0].tickets).toBe(3);
      expect(out.coveredCenterIds).toEqual(['101']);
    });

    test('an engineer with no tickets still plots, with zero coverage', function () {
      sandbox.FSE_ROSTER = [{ name: 'Idle Engineer', hqCity: 'Kochi', hqState: 'Kerala' }];
      const out = sandbox.buildFseLayer_([], hqFixed, plotted([]));
      expect(out.engineers).toHaveLength(1);
      expect(out.engineers[0].centers).toEqual([]);
      expect(out.engineers[0].tickets).toBe(0);
    });

    test('inactive roster rows are excluded entirely', function () {
      sandbox.FSE_ROSTER = [
        { name: 'Gone', hqCity: 'Pune', hqState: 'Maharashtra', active: false },
        { name: 'Here', hqCity: 'Pune', hqState: 'Maharashtra' }
      ];
      const out = sandbox.buildFseLayer_(
        [{ rep: 'Gone', customer_id: '101', tickets: 9 }], hqFixed, plotted([101]));
      expect(out.engineers.map(e => e.name)).toEqual(['Here']);
      // A leaver's tickets are not reported as an unmatched data problem.
      expect(out.unmatchedReps).toEqual([]);
    });

    test('an unlocatable HQ is reported, not plotted at 0,0', function () {
      sandbox.FSE_ROSTER = [
        { name: 'Nowhere', hqCity: 'Atlantis', hqState: 'XX' },
        { name: 'Somewhere', hqCity: 'Pune', hqState: 'Maharashtra' }
      ];
      const hqOnlyPune = e => (e.hqCity === 'Pune' ? [18.52, 73.85] : null);
      const out = sandbox.buildFseLayer_([], hqOnlyPune, plotted([]));
      expect(out.engineers.map(e => e.name)).toEqual(['Somewhere']);
      expect(out.unlocatedRoster).toEqual(['Nowhere']);
    });

    test('explicit lat/lng is honoured by the injected resolver', function () {
      sandbox.FSE_ROSTER = [{ name: 'Pinned', lat: 12.97, lng: 77.59 }];
      const hqFromEntry = e => (e.lat != null && e.lng != null ? [e.lat, e.lng] : null);
      const out = sandbox.buildFseLayer_([], hqFromEntry, plotted([]));
      expect(out.engineers[0].lat).toBe(12.97);
      expect(out.engineers[0].lng).toBe(77.59);
    });

    test('unmatched reps are ranked by ticket volume', function () {
      const out = sandbox.buildFseLayer_([
        { rep: 'Small', customer_id: '1', tickets: 1 },
        { rep: 'Big', customer_id: '2', tickets: 40 },
        { rep: 'Mid', customer_id: '3', tickets: 7 }
      ], hqFixed, plotted([1, 2, 3]));
      expect(out.unmatchedReps.map(u => u.rep)).toEqual(['Big', 'Mid', 'Small']);
    });

    test('engineers come back name-sorted so the layer is stable across refreshes', function () {
      sandbox.FSE_ROSTER = [
        { name: 'Zoya', hqCity: 'Pune', hqState: 'Maharashtra' },
        { name: 'Arun', hqCity: 'Pune', hqState: 'Maharashtra' },
        { name: 'Meera', hqCity: 'Pune', hqState: 'Maharashtra' }
      ];
      const out = sandbox.buildFseLayer_([], hqFixed, plotted([]));
      expect(out.engineers.map(e => e.name)).toEqual(['Arun', 'Meera', 'Zoya']);
    });

    test('reports the coverage window it used', function () {
      const out = sandbox.buildFseLayer_([], hqFixed, plotted([]));
      expect(out.windowDays).toBe(sandbox.CONFIG.FSE_COVERAGE_DAYS);
      expect(out.windowDays).toBe(90);
    });
  });

  describe('buildFseCoverageSpec_', function () {
    test('window is a rolling CURRENT_DATE interval, not a filter range', function () {
      const spec = sandbox.buildFseCoverageSpec_();
      expect(spec.key).toBe('fseCoverage');
      expect(spec.sql).toContain('DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)');
      // Must not accept the global date filter — that is the whole point.
      expect(spec.sql).not.toMatch(/dateFrom|dateTo/);
    });

    test('groups by rep and center, and excludes blank names/ids', function () {
      const spec = sandbox.buildFseCoverageSpec_();
      expect(spec.sql).toContain('GROUP BY rep, customer_id');
      expect(spec.sql).toContain('representative IS NOT NULL');
      expect(spec.sql).toContain('customer_id IS NOT NULL');
    });
  });
});
