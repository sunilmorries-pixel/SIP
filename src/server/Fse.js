/**
 * Fse.js — Field Service Engineer roster + service-coverage layer for the
 * Overview map.
 *
 * WHY A STATIC CATALOG: there is no FSE table in BigQuery and no engineer
 * roster anywhere in the warehouse — the only FSE signal in the data is
 * `servicewrk_Tickets.representative`, a free-text name on each ticket. An
 * engineer's HQ exists nowhere at all; it has to be supplied. So the roster
 * below is CS-team-provided reference data held in source, exactly like
 * SlaCatalog.js (also a sheet the CS team owns, consumed into a .js catalog).
 * Same rules apply: edit it here, note where the values came from, and keep it
 * ordered so diffs read cleanly.
 *
 * FSE_ROSTER SHIPS EMPTY ON PURPOSE. An entry here draws a named human being
 * on a production operations map, so a placeholder would put a person who does
 * not exist in front of the people who staff the field. Until real roster rows
 * are pasted in, the map simply has no FSE layer. The local preview supplies
 * its own demo engineers from the mock in App.html, which never reaches
 * production.
 *
 * Entry shape:
 *   name      {string}  REQUIRED. Must reconcile with servicewrk_Tickets
 *                       .representative. Compared via fseNameKey_ (lowercased,
 *                       whitespace collapsed), so case and spacing variants are
 *                       already tolerated; anything beyond that needs `aliases`.
 *   aliases   {Array<string>=} other spellings the same person appears under in
 *                       ServiceWRK (initials, reversed name, misspellings).
 *   hqCity    {string}  REQUIRED with hqState — resolved through the existing
 *   hqState   {string}  geo store (Geo.js), whose keys are already
 *                       'c:city|state|country'. An HQ in a city that already
 *                       has a center is therefore geocoded for free.
 *   lat, lng  {number=} explicit coordinate; skips the geo store entirely. Use
 *                       when the HQ city is not otherwise geocoded.
 *   territory {Array<string>=} states the engineer is ASSIGNED to. Optional and
 *                       purely informational — coverage is always computed from
 *                       tickets actually worked, never from this. Present so
 *                       assigned-vs-actual can be compared later.
 *   active    {boolean=} default true. false keeps history without drawing them.
 *
 * Example row (commented — do not ship invented names):
 *   // { name: 'R Kulkarni', hqCity: 'Pune', hqState: 'Maharashtra',
 *   //   territory: ['Maharashtra', 'Goa'], active: true },
 */
var FSE_ROSTER = [];

/**
 * Editor-run helper for SEEDING the roster above: prints every distinct
 * `representative` in the coverage window with its ticket count, so the roster
 * can be filled from the names ServiceWRK actually uses rather than from names
 * typed by hand that then fail to match. Run it from the Apps Script editor
 * (same idea as Geo.js's runGeocodeBatch) — nothing calls it automatically,
 * because it costs a query and only matters while onboarding the roster.
 */
function fseListRepNames() {
  var rows = runQueriesParallel([{
    key: 'reps', maxRows: 2000,
    sql: 'SELECT TRIM(representative) AS rep, COUNT(*) AS tickets, ' +
      ' COUNT(DISTINCT TRIM(customer_id)) AS centers ' +
      'FROM ' + swTable_() + ' ' +
      'WHERE representative IS NOT NULL AND TRIM(representative) != "" ' +
      ' AND DATE(created_on) >= DATE_SUB(CURRENT_DATE(), INTERVAL ' +
          CONFIG.FSE_COVERAGE_DAYS + ' DAY) ' +
      'GROUP BY rep ORDER BY tickets DESC'
  }]).reps || [];
  Logger.log('%s representatives in the last %s days:', rows.length, CONFIG.FSE_COVERAGE_DAYS);
  rows.forEach(function (r) {
    Logger.log('  %s  —  %s tickets across %s centers', r.rep, r.tickets, r.centers);
  });
  return rows;
}

/**
 * Normalises a representative name for comparison: lowercased, internal
 * whitespace collapsed to one space, trimmed. Deliberately does NOT strip
 * punctuation or initials — that would collide distinct people (e.g. "R Kumar"
 * and "R. Kumar" are the same person and normalise together, but "Kumar R" is
 * left alone rather than guessed at; use `aliases` for those).
 * @param {string} name
 * @return {string}
 */
function fseNameKey_(name) {
  return String(name == null ? '' : name).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Active roster rows only. @return {Array<Object>} */
function fseRosterActive_() {
  return FSE_ROSTER.filter(function (e) { return e.active !== false; });
}

/**
 * Every name key one roster entry answers to (its own name plus any aliases).
 * @param {Object} entry
 * @return {Array<string>}
 */
function fseEntryKeys_(entry) {
  return [entry.name].concat(entry.aliases || [])
    .map(fseNameKey_)
    .filter(function (k) { return !!k; });
}

/**
 * Coverage query: which centers each engineer has actually worked, over a
 * ROLLING window ending today.
 *
 * The window is deliberately independent of the global date filter (per user,
 * 2026-08-21: "use last 90 days for coverage"). Coverage answers "is this
 * center served today", and an engineer who visited once in 2022 is not
 * coverage now — so it must not stretch when someone widens the date range to
 * look at history. CONSEQUENCE TO KNOW: while a date filter is active, this
 * layer intentionally disagrees with every other number on the page, which are
 * all filter-scoped. That is the trade the fixed window buys.
 *
 * customer_id is TEXT in servicewrk_Tickets and CenterID is numeric in
 * center_details, so the join happens client-of-BigQuery side (buildFseLayer_)
 * against a string-keyed index rather than in SQL — same reason the profiling
 * in ProfileNewSources.js casts CenterID to STRING to compare them.
 * @return {{key:string, sql:string, maxRows:number}}
 */
function buildFseCoverageSpec_() {
  return {
    key: 'fseCoverage', maxRows: 5000,
    sql: 'SELECT TRIM(representative) AS rep, TRIM(customer_id) AS customer_id, COUNT(*) AS tickets ' +
      'FROM ' + swTable_() + ' ' +
      'WHERE representative IS NOT NULL AND TRIM(representative) != "" ' +
      ' AND customer_id IS NOT NULL AND TRIM(customer_id) != "" ' +
      ' AND DATE(created_on) >= DATE_SUB(CURRENT_DATE(), INTERVAL ' +
          CONFIG.FSE_COVERAGE_DAYS + ' DAY) ' +
      'GROUP BY rep, customer_id'
  };
}

/**
 * Builds the map's FSE layer. Pure — no BigQuery, no Apps Script services — so
 * it is unit-testable against fixture rows.
 *
 * @param {Array<{rep:string, customer_id:string, tickets:number}>} coverageRows
 *   output of buildFseCoverageSpec_.
 * @param {function(Object): ?Array<number>} hqCoordFn resolves a roster entry to
 *   [lat, lng], or null when its HQ cannot be located. Injected rather than
 *   reaching for the geo store directly, so tests need no Script Properties.
 * @param {Object<string, boolean>} plottedCenterIds center ids (as strings) that
 *   are actually on the map right now — coverage to a center the current filter
 *   has hidden must not be counted, or the fan would draw to nothing.
 * @return {{engineers:Array<Object>, unmatchedReps:Array<Object>,
 *           unlocatedRoster:Array<string>, coveredCenterIds:Array<string>}}
 */
function buildFseLayer_(coverageRows, hqCoordFn, plottedCenterIds) {
  var rows = coverageRows || [];
  var plotted = plottedCenterIds || {};

  // name key -> roster entry (one entry can claim several keys via aliases).
  // Built from the FULL roster, inactive rows included: an inactive engineer is
  // someone we know about and chose not to draw, so their tickets must still be
  // RECOGNISED here or they'd fall through to unmatchedReps and get reported as
  // a name-reconciliation problem. That bucket is for names in nobody's roster.
  var byKey = {};
  FSE_ROSTER.forEach(function (entry) {
    fseEntryKeys_(entry).forEach(function (k) { byKey[k] = entry; });
  });

  var acc = {};       // entry.name -> { centers: {id: tickets}, tickets }
  var unmatched = {}; // rep name as it appears in data -> ticket count
  rows.forEach(function (r) {
    var key = fseNameKey_(r.rep);
    var entry = byKey[key];
    var tickets = r.tickets || 0;
    if (!entry) {
      unmatched[r.rep] = (unmatched[r.rep] || 0) + tickets;
      return;
    }
    if (entry.active === false) return;   // recognised, deliberately not drawn
    var id = String(r.customer_id);
    if (!plotted[id]) return;   // center not on the map under the current filter
    var a = acc[entry.name] || (acc[entry.name] = { centers: {}, tickets: 0 });
    a.centers[id] = (a.centers[id] || 0) + tickets;
    a.tickets += tickets;
  });

  var engineers = [], unlocated = [], coveredIds = {};
  fseRosterActive_().forEach(function (entry) {
    var coord = hqCoordFn(entry);
    if (!coord) { unlocated.push(entry.name); return; }
    var a = acc[entry.name] || { centers: {}, tickets: 0 };
    var centerIds = Object.keys(a.centers);
    centerIds.forEach(function (id) { coveredIds[id] = true; });
    engineers.push({
      name: entry.name,
      hq: [entry.hqCity, entry.hqState].filter(Boolean).join(', '),
      lat: coord[0], lng: coord[1],
      centers: centerIds,
      tickets: a.tickets,
      territory: entry.territory || []
    });
  });

  // Sorted so the payload (and therefore the drawn layer) is stable between
  // refreshes instead of following object key order.
  engineers.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });

  return {
    engineers: engineers,
    // Surfaced, not swallowed: a roster name that matches no ticket and a
    // ticket name in nobody's roster are both real data problems, and the
    // symptom of either one is an engineer silently showing zero coverage.
    unmatchedReps: Object.keys(unmatched)
      .map(function (n) { return { rep: n, tickets: unmatched[n] }; })
      .sort(function (a, b) { return b.tickets - a.tickets; }),
    unlocatedRoster: unlocated,
    coveredCenterIds: Object.keys(coveredIds),
    windowDays: CONFIG.FSE_COVERAGE_DAYS
  };
}
