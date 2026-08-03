'use strict';

/**
 * Verifies apiSupportSearchCD's two lookup SQL shapes (CenterID exact-match,
 * ticketNumber-to-CenterID exact-match) against live BigQuery. The function
 * itself calls Apps Script services (UrlFetchApp/CacheService) this harness
 * doesn't stub, so this test re-runs the SAME query SHAPE via the Node BQ
 * client instead of calling apiSupportSearchCD directly — same approach as
 * center-grain.test.js's spec-SQL checks.
 *
 * IDs are discovered live, never hardcoded (past lesson from this repo:
 * prefer independent-equivalence over fixed values — see the
 * active_deployments bug in HANDOFF.md's v5.9 notes).
 */

const { loadGas } = require('../helpers/loadGas');
const { hasCredentials, runQuery } = require('../helpers/bq');

const maybeDescribe = hasCredentials() ? describe : describe.skip;

maybeDescribe('apiSupportSearchCD lookup shapes (live BigQuery)', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'Queries.js']);
  });

  test('CenterID exact-match finds a center that exists', async function () {
    const anyCenter = await runQuery(
      'SELECT CenterID FROM ' + sandbox.T('center_details') + ' WHERE CenterID IS NOT NULL LIMIT 1'
    );
    expect(anyCenter.length).toBe(1);
    const id = anyCenter[0].CenterID;

    const hit = await runQuery(
      'SELECT CenterID FROM ' + sandbox.T('center_details') + ' WHERE CenterID = ' + id + ' LIMIT 1'
    );
    expect(hit.length).toBe(1);
    expect(String(hit[0].CenterID)).toBe(String(id));
  });

  test('ticketNumber exact-match resolves to the same CenterID the ticket was raised against', async function () {
    const anyTicket = await runQuery(
      'SELECT ticketNumber, CenterID FROM ' + sandbox.T('zoho_data') +
      ' WHERE CenterID IS NOT NULL LIMIT 1'
    );
    expect(anyTicket.length).toBe(1);
    const ticketNumber = anyTicket[0].ticketNumber;
    const expectedCenterId = anyTicket[0].CenterID;

    const hit = await runQuery(
      'SELECT CenterID FROM ' + sandbox.T('zoho_data') +
      ' WHERE ticketNumber = ' + ticketNumber + ' AND CenterID IS NOT NULL LIMIT 1'
    );
    expect(hit.length).toBe(1);
    expect(String(hit[0].CenterID)).toBe(String(expectedCenterId));
  });

  test('a query matching neither table finds nothing (not-found is a normal outcome, not an error)', async function () {
    // An intentionally implausible ID — 13 nines exceeds any real
    // CenterID/ticketNumber's digit range without hardcoding a specific value.
    const implausibleId = '9999999999999';
    const centerMiss = await runQuery(
      'SELECT CenterID FROM ' + sandbox.T('center_details') + ' WHERE CenterID = ' + implausibleId + ' LIMIT 1'
    );
    const ticketMiss = await runQuery(
      'SELECT CenterID FROM ' + sandbox.T('zoho_data') +
      ' WHERE ticketNumber = ' + implausibleId + ' AND CenterID IS NOT NULL LIMIT 1'
    );
    expect(centerMiss.length).toBe(0);
    expect(ticketMiss.length).toBe(0);
  });
});
