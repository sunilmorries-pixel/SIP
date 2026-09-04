'use strict';

/**
 * Unit tests for the curated TOP_CUSTOMERS list (src/server/TopCustomers.js)
 * and topCustomerGroupFor_ (src/server/EditionCD.js) — the pure lookup that
 * decides which group a center row belongs to, including the center_ids
 * override added 2026-09-04 for Matcare (whose spoke centers sit inside
 * Indira IVF's hub with no hub of their own).
 */

const { loadGas } = require('../helpers/loadGas');

describe('TOP_CUSTOMERS data + topCustomerGroupFor_ (EditionCD.js/TopCustomers.js)', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'TopCustomers.js', 'EditionCD.js']);
  });

  test('Matcare claims its 4 spoke centers via center_ids, with no hub_ids of its own', function () {
    const matcare = sandbox.TOP_CUSTOMERS.find(function (c) { return c.group === 'Matcare'; });
    expect(matcare.hub_ids).toEqual([]);
    expect(matcare.center_ids.slice().sort()).toEqual([50590, 50722, 52270, 54300].sort());
  });

  test('Indira IVF carries the full 61-hub list, not just the old single hub_id', function () {
    const indira = sandbox.TOP_CUSTOMERS.find(function (c) { return c.group === 'Indira IVF'; });
    expect(indira.hub_ids.length).toBe(61);
    expect(indira.hub_ids).toContain(36772); // the previously-known hub, still present
    expect(indira.hub_ids).toContain(42923); // Eves Hospital & Indira IVF, included per user
  });

  test('no hub_id is claimed by two different groups', function () {
    const owner = {};
    const dupes = [];
    sandbox.TOP_CUSTOMERS.forEach(function (c) {
      c.hub_ids.forEach(function (hid) {
        if (owner[hid] && owner[hid] !== c.group) dupes.push(hid + ' (' + owner[hid] + ' vs ' + c.group + ')');
        owner[hid] = c.group;
      });
    });
    expect(dupes).toEqual([]);
  });

  describe('topCustomerGroupFor_', function () {
    const hubToGroup = { 36772: { group: 'Indira IVF' } };
    const centerToGroup = { 50590: { group: 'Matcare' } };

    test('a center-level claim wins even when the row\'s hub also belongs to another group', function () {
      // Real-world case: center 50590's own hub_id is 36772 (Indira IVF's
      // hub), but it's explicitly claimed by Matcare via center_ids.
      const row = { hub_id: 36772, center_id: 50590 };
      expect(sandbox.topCustomerGroupFor_(row, hubToGroup, centerToGroup).group).toBe('Matcare');
    });

    test('falls back to the hub-level claim when the center has no center-level claim', function () {
      const row = { hub_id: 36772, center_id: 42230 };
      expect(sandbox.topCustomerGroupFor_(row, hubToGroup, centerToGroup).group).toBe('Indira IVF');
    });

    test('returns undefined when neither the hub nor the center is claimed by any group', function () {
      const row = { hub_id: 999999, center_id: 999999 };
      expect(sandbox.topCustomerGroupFor_(row, hubToGroup, centerToGroup)).toBeUndefined();
    });
  });
});
