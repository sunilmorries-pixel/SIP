/**
 * Cp.js — Channel Partner (CP) dealer coverage layer for the Overview map.
 *
 * WHY A STATIC CATALOG, NO BIGQUERY: unlike FSE (Fse.js), there is no ticket
 * field anywhere in the warehouse that names a CP — coverage here is a
 * DECLARED list of districts/cities per dealer company, not something
 * computed from tickets actually worked. So there is no coverage query, no
 * name-reconciliation step, and no "unmatched" bucket the way Fse.js has for
 * ServiceWRK representatives — buildCpLayer_ only has to resolve coordinates.
 *
 * CP_ROSTER SHIPS POPULATED (unlike FSE_ROSTER's deliberate empty start):
 * this data comes from a named, real source — "Progress on the Service
 * Dealer Network - BRM 2026.xlsx", 'CP' sheet, imported 2026-08-24 — not
 * placeholder content, so there is no "drawing a company that doesn't exist"
 * risk to guard against.
 *
 * Entry shape:
 *   name       {string}  REQUIRED. The dealer company name.
 *   hqCity     {string}  REQUIRED with hqState — informational only; not
 *   hqState    {string}  used to resolve the pin (lat/lng below does that).
 *   lat, lng   {number}  REQUIRED. Explicit HQ coordinate — supplied directly
 *                        rather than resolved through the geo store, because
 *                        most of these HQ/location towns have no guarantee of
 *                        already being geocoded via an existing center.
 *   locations  {Array<{name:string, lat:number, lng:number}>} the declared
 *                        covered districts/cities, each pre-geocoded the same
 *                        explicit way as the HQ.
 *
 * No `aliases`/`active` fields at this size (11 rows, 2026-08-24) — add them
 * if the roster later grows enough to need deactivating an entry without
 * deleting it (see Fse.js for the pattern to follow).
 */
var CP_ROSTER = [];

/**
 * Builds the map's CP layer. Pure — no BigQuery, no Apps Script services — so
 * it is unit-testable against fixture rows, mirroring buildFseLayer_'s shape
 * but without any ticket-coverage computation.
 *
 * @param {Array<Object>} roster CP_ROSTER (or a test fixture of the same shape).
 * @param {function(Object): ?Array<number>} hqCoordFn resolves a roster entry
 *   to its HQ [lat, lng], or null when unresolvable. Injected (rather than
 *   reading entry.lat/entry.lng directly) so a future switch to geo-store
 *   resolution doesn't change this function's shape.
 * @param {function(Object, Object): ?Array<number>} locationCoordFn resolves
 *   one covered-location entry to [lat, lng], or null when unresolvable.
 * @return {{dealers:Array<Object>, unlocatedRoster:Array<string>,
 *           unlocatedLocations:Array<{cp:string, location:string}>}}
 */
function buildCpLayer_(roster, hqCoordFn, locationCoordFn) {
  var dealers = [], unlocatedRoster = [], unlocatedLocations = [];

  (roster || []).forEach(function (entry) {
    var hq = hqCoordFn(entry);
    if (!hq) { unlocatedRoster.push(entry.name); return; }

    var locations = [];
    (entry.locations || []).forEach(function (loc) {
      var coord = locationCoordFn(entry, loc);
      if (!coord) { unlocatedLocations.push({ cp: entry.name, location: loc.name }); return; }
      locations.push({ name: loc.name, lat: coord[0], lng: coord[1] });
    });

    dealers.push({
      name: entry.name,
      hq: [entry.hqCity, entry.hqState].filter(Boolean).join(', '),
      lat: hq[0], lng: hq[1],
      locations: locations
    });
  });

  // Sorted so the payload (and therefore the drawn layer) is stable between
  // refreshes instead of following object key order — same rationale as
  // buildFseLayer_'s engineers.sort().
  dealers.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });

  return { dealers: dealers, unlocatedRoster: unlocatedRoster, unlocatedLocations: unlocatedLocations };
}
