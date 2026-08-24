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
 * NEVER PLACEHOLDERS - REAL ROWS ONLY. An entry here draws a named human being
 * on a production operations map, so a placeholder would put a person who does
 * not exist in front of the people who staff the field. This roster therefore
 * shipped EMPTY from @83/@84 through @88 -- and while it was empty the guard in
 * EditionCD.js sent `fse: null`, so production drew NO engineer pins for six
 * deploys. Everything the docs recorded about this layer in that window was
 * verified against the preview mock, not production. Real rows arrived in
 * 78ed2f8 and shipped @89, so the layer is live now; hold anything added later
 * to the same bar. The local preview supplies its own demo engineers from the
 * mock in App.html, which never reaches production.
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
 *
 * SOURCE (2026-08-24): "Progress on the Service Dealer Network - BRM 2026.xlsx",
 * 'direct' sheet — 27 direct-employed FSEs. lat/lng are supplied explicitly
 * rather than left to the geo store: several HQ towns here (Kalaburagi,
 * Thirthahalli, Ramdurg, Munger, Jharsuguda, Rayagada, ...) have no guarantee
 * of already being geocoded via an existing center, and an explicit coordinate
 * means the pin always renders instead of silently landing in
 * unlocatedRoster. `territory` is derived from the sheet's "Segment" column,
 * which is actually the STEMI program the engineer works under, not a state
 * list — mapped here (KASTEMI -> Karnataka, BIHAR STEMI -> Bihar, ODISHA
 * STEMI -> Odisha); "Private" engineers carry no territory (general/nationwide
 * coverage, not tied to one state program). One row was SKIPPED: "Manumaya
 * Kumar" / HQ "Jaspur" / segment "MANIPUR STEMI" — Jaspur is not a Manipur
 * city (there's a Jaspur in Uttarakhand and a Jashpur in Chhattisgarh), so the
 * HQ state couldn't be resolved with confidence. Flagged to the user rather
 * than guessed; add the row once the correct HQ is confirmed.
 */
var FSE_ROSTER = [
  { name: 'Javed Hussain Khan', hqCity: 'Delhi', hqState: 'Delhi', lat: 28.7041, lng: 77.1025 },
  { name: 'Rakesh Kumar', hqCity: 'Chandigarh', hqState: 'Chandigarh', lat: 30.7333, lng: 76.7794 },
  { name: 'Kaushal Dubey', hqCity: 'Lucknow', hqState: 'Uttar Pradesh', lat: 26.8467, lng: 80.9462 },
  // Sheet spells this "Hydrabad" — corrected here; original spelling kept nowhere since it's a typo, not an alias ServiceWRK would use.
  { name: 'Sai Vamshi', hqCity: 'Hyderabad', hqState: 'Telangana', lat: 17.3850, lng: 78.4867 },
  { name: 'Madesh S', hqCity: 'Bengaluru', hqState: 'Karnataka', lat: 12.9716, lng: 77.5946 },
  // Sheet spells this "Guwahatti" — corrected.
  { name: 'Milan Sarma', hqCity: 'Guwahati', hqState: 'Assam', lat: 26.1445, lng: 91.7362 },
  { name: 'Sujoy Low', hqCity: 'Kolkata', hqState: 'West Bengal', lat: 22.5726, lng: 88.3639 },
  { name: 'Anish Sharma', hqCity: 'Mumbai', hqState: 'Maharashtra', lat: 19.0760, lng: 72.8777 },
  { name: 'Karthikeyan', hqCity: 'Chennai', hqState: 'Tamil Nadu', lat: 13.0827, lng: 80.2707 },

  { name: 'Anand Pimpale', hqCity: 'Kalaburagi', hqState: 'Karnataka', lat: 17.3297, lng: 76.8343, territory: ['Karnataka'] },
  { name: 'Umesha G M', hqCity: 'Davanagere', hqState: 'Karnataka', lat: 14.4644, lng: 75.9218, territory: ['Karnataka'] },
  { name: 'Sachin K M', hqCity: 'Thirthahalli', hqState: 'Karnataka', lat: 13.6833, lng: 75.2500, territory: ['Karnataka'] },
  { name: 'Ganuga Khader Basha', hqCity: 'Bengaluru', hqState: 'Karnataka', lat: 12.9716, lng: 77.5946, territory: ['Karnataka'] },
  { name: 'Vijayakumar Bilagi', hqCity: 'Ramdurg', hqState: 'Karnataka', lat: 15.9500, lng: 75.3000, territory: ['Karnataka'] },
  { name: 'Karthik', hqCity: 'Mysuru', hqState: 'Karnataka', lat: 12.2958, lng: 76.6394, territory: ['Karnataka'] },
  { name: 'Kishore Bhandari', hqCity: 'Udupi', hqState: 'Karnataka', lat: 13.3409, lng: 74.7421, territory: ['Karnataka'] },

  { name: 'Abhishek Kumar', hqCity: 'Bhagalpur', hqState: 'Bihar', lat: 25.2445, lng: 86.9718, territory: ['Bihar'] },
  { name: 'Manjeet Kumar', hqCity: 'Munger', hqState: 'Bihar', lat: 25.3747, lng: 86.4735, territory: ['Bihar'] },
  // Sheet spells this "Nalada" — corrected to Nalanda.
  { name: 'Sharad', hqCity: 'Nalanda', hqState: 'Bihar', lat: 25.1972, lng: 85.5217, territory: ['Bihar'] },
  { name: 'Rohit Patel', hqCity: 'Patna', hqState: 'Bihar', lat: 25.5941, lng: 85.1376, territory: ['Bihar'] },
  { name: 'Vikash Prasad', hqCity: 'Patna', hqState: 'Bihar', lat: 25.5941, lng: 85.1376, territory: ['Bihar'] },
  { name: 'Avisham Singh', hqCity: 'Patna', hqState: 'Bihar', lat: 25.5941, lng: 85.1376, territory: ['Bihar'] },

  // Sheet spells this "Bhubaneshwar" — corrected to Bhubaneswar.
  { name: 'Abhishek Mohapatra', hqCity: 'Bhubaneswar', hqState: 'Odisha', lat: 20.2961, lng: 85.8245, territory: ['Odisha'] },
  { name: 'Manas Ranjan Pati', hqCity: 'Jharsuguda', hqState: 'Odisha', lat: 21.8554, lng: 84.0062, territory: ['Odisha'] },
  // Sheet's "Baharampur" under the ODISHA STEMI segment is Berhampur/Brahmapur
  // (Ganjam district) — NOT the same-named town in West Bengal's Murshidabad
  // district, disambiguated by the segment it's grouped under.
  { name: 'Surjya Kanta Panda', hqCity: 'Berhampur', hqState: 'Odisha', lat: 19.3149, lng: 84.7941, territory: ['Odisha'] },
  { name: 'Lalu Palaka', hqCity: 'Rayagada', hqState: 'Odisha', lat: 19.1711, lng: 83.4163, territory: ['Odisha'] }

  // SKIPPED: 'Manumaya Kumar', HQ 'Jaspur', segment 'MANIPUR STEMI' — see the
  // SOURCE note above. Add once the real HQ city is confirmed.
];

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
