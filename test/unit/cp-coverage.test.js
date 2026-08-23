'use strict';

/**
 * Unit tests for the CP (Channel Partner) dealer layer (src/server/Cp.js).
 *
 * buildCpLayer_ is pure (roster + two injected coordinate resolvers), so it is
 * tested end-to-end against fixtures rather than by string-shape checks —
 * same approach as fse-coverage.test.js. Unlike FSE, there is no ticket data
 * to reconcile against: coverage here is a static declared list, so there is
 * no unmatchedReps-equivalent and no coverage-window concept.
 */

const { loadGas } = require('../helpers/loadGas');

describe('CP dealer layer (Cp.js)', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Cp.js']);
  });

  // Every test sets its own roster; reset so ordering can't leak.
  beforeEach(function () { sandbox.CP_ROSTER = []; });

  const hqFixed = () => [18.52, 73.85];
  const locFixed = () => [19.00, 74.00];

  describe('buildCpLayer_', function () {
    test('empty roster yields an empty layer', function () {
      const out = sandbox.buildCpLayer_([], hqFixed, locFixed);
      expect(out.dealers).toEqual([]);
      expect(out.unlocatedRoster).toEqual([]);
      expect(out.unlocatedLocations).toEqual([]);
    });

    test('resolves HQ and every covered location', function () {
      const roster = [{
        name: 'Acme Dealers', hqCity: 'Pune', hqState: 'Maharashtra',
        locations: [{ name: 'Satara' }, { name: 'Solapur' }]
      }];
      const hq = e => (e.hqCity === 'Pune' ? [18.52, 73.85] : null);
      const loc = (e, l) => (l.name === 'Satara' ? [17.68, 74.02] : l.name === 'Solapur' ? [17.66, 75.91] : null);
      const out = sandbox.buildCpLayer_(roster, hq, loc);

      expect(out.dealers).toHaveLength(1);
      const d = out.dealers[0];
      expect(d.name).toBe('Acme Dealers');
      expect(d.hq).toBe('Pune, Maharashtra');
      expect(d.lat).toBe(18.52);
      expect(d.lng).toBe(73.85);
      expect(d.locations).toEqual([
        { name: 'Satara', lat: 17.68, lng: 74.02 },
        { name: 'Solapur', lat: 17.66, lng: 75.91 }
      ]);
      expect(out.unlocatedRoster).toEqual([]);
      expect(out.unlocatedLocations).toEqual([]);
    });

    test('an unresolvable HQ drops the whole entry, not plotted at 0,0', function () {
      const roster = [
        { name: 'Nowhere Co', hqCity: 'Atlantis', hqState: 'XX', locations: [] },
        { name: 'Somewhere Co', hqCity: 'Pune', hqState: 'Maharashtra', locations: [] }
      ];
      const hq = e => (e.hqCity === 'Pune' ? [18.52, 73.85] : null);
      const out = sandbox.buildCpLayer_(roster, hq, locFixed);

      expect(out.dealers.map(d => d.name)).toEqual(['Somewhere Co']);
      expect(out.unlocatedRoster).toEqual(['Nowhere Co']);
    });

    test('an unresolvable single location drops only that point, not the whole CP', function () {
      const roster = [{
        name: 'Acme Dealers', hqCity: 'Pune', hqState: 'Maharashtra',
        locations: [{ name: 'Satara' }, { name: 'Nowhereville' }]
      }];
      const loc = (e, l) => (l.name === 'Satara' ? [17.68, 74.02] : null);
      const out = sandbox.buildCpLayer_(roster, hqFixed, loc);

      expect(out.dealers).toHaveLength(1);
      expect(out.dealers[0].locations).toEqual([{ name: 'Satara', lat: 17.68, lng: 74.02 }]);
      expect(out.unlocatedLocations).toEqual([{ cp: 'Acme Dealers', location: 'Nowhereville' }]);
    });

    test('a CP with no covered locations still plots, with an empty locations array', function () {
      const roster = [{ name: 'Solo Dealer', hqCity: 'Pune', hqState: 'Maharashtra', locations: [] }];
      const out = sandbox.buildCpLayer_(roster, hqFixed, locFixed);
      expect(out.dealers).toHaveLength(1);
      expect(out.dealers[0].locations).toEqual([]);
    });

    test('a roster entry with no locations field at all is treated as zero locations', function () {
      const roster = [{ name: 'No Locations Key', hqCity: 'Pune', hqState: 'Maharashtra' }];
      const out = sandbox.buildCpLayer_(roster, hqFixed, locFixed);
      expect(out.dealers[0].locations).toEqual([]);
    });

    test('dealers come back name-sorted so the layer is stable across refreshes', function () {
      const roster = [
        { name: 'Zoya Corp', hqCity: 'Pune', hqState: 'Maharashtra', locations: [] },
        { name: 'Arun Corp', hqCity: 'Pune', hqState: 'Maharashtra', locations: [] },
        { name: 'Meera Corp', hqCity: 'Pune', hqState: 'Maharashtra', locations: [] }
      ];
      const out = sandbox.buildCpLayer_(roster, hqFixed, locFixed);
      expect(out.dealers.map(d => d.name)).toEqual(['Arun Corp', 'Meera Corp', 'Zoya Corp']);
    });
  });
});
