/**
 * Geo.js — progressive center geocoding with a persistent store.
 *
 * center_details carries no coordinates (the 2026-07-07 reload removed the old
 * latitude/longitude columns), so we geocode "pin, city, state, country"
 * strings with the built-in Apps Script Maps geocoder (no API key). The daily
 * quota (resets ~every 14h) can't cover all locations at once, so:
 *
 *   1. Run runGeocodeBatch() from the editor — it geocodes up to BATCH_LIMIT
 *      locations and saves results permanently in Script Properties.
 *   2. Re-run it on following days until `pending` reaches 0
 *      (geoStats() or the Map tab's progress strip shows the counts).
 *
 * ACTIVE centers are geocoded FIRST (distinctLocations_ orders active-first) so
 * the most useful pins land before the quota runs out; centers still awaiting a
 * geocode simply don't plot until located (coordsForCD_ returns null → the map
 * skips them). Coverage grows with each batch.
 */

var GEO_STORE_KEY = 'GEO_STORE_V1';
/**
 * Max locations geocoded per runGeocodeBatch() call. Set for a Workspace
 * account (30-min execution limit, high geocode quota) so one run finishes the
 * remaining ~4k locations. On a consumer account this batch would stop early on
 * the 6-min timeout or daily quota — progress checkpoints every 100, so it's
 * safe either way; just re-run until geoStats().pending is 0.
 */
var GEO_BATCH_LIMIT = 5000;

/**
 * Stable location key for a center row (from the centerGeo source).
 * Pincode is the primary key; city/state is the fallback.
 * @param {{pin:?string, city:?string, state:?string, country:?string}} row
 * @return {?string}
 */
function geoKeyFor(row) {
  var pin = String(row.pin || '').trim();
  var city = String(row.city || '').trim();
  var country = String(row.country || '').trim() || 'India';
  if (pin) return 'p:' + pin + '|' + country;
  if (city) return 'c:' + city + '|' + String(row.state || '').trim() + '|' + country;
  return null;
}

/** Human query string for the geocoder. */
function geoQueryFor_(row) {
  return [row.pin, row.city, row.state, row.country || 'India']
    .map(function (part) { return String(part || '').trim(); })
    .filter(Boolean)
    .join(', ');
}

/**
 * Loads the persistent geo store: { key: "lat,lng" } ("x" = known-unresolvable).
 * Chunked across Script Properties (9KB per-value limit).
 * @return {Object<string,string>}
 */
function loadGeoStore() {
  var props = PropertiesService.getScriptProperties();
  var meta = props.getProperty(GEO_STORE_KEY + '#meta');
  if (!meta) return {};
  var n = parseInt(meta, 10);
  var json = '';
  for (var i = 0; i < n; i++) json += props.getProperty(GEO_STORE_KEY + '#' + i) || '';
  try { return JSON.parse(json); } catch (err) { return {}; }
}

/** @param {Object<string,string>} store */
function saveGeoStore_(store) {
  var props = PropertiesService.getScriptProperties();
  var json = JSON.stringify(store);
  var chunkSize = 8500;
  var n = Math.ceil(json.length / chunkSize) || 1;
  var kv = {};
  for (var i = 0; i < n; i++) kv[GEO_STORE_KEY + '#' + i] = json.substr(i * chunkSize, chunkSize);
  kv[GEO_STORE_KEY + '#meta'] = String(n);
  props.setProperties(kv);
}

/**
 * Distinct geocodable locations from center_details (the live center source),
 * ORDERED ACTIVE-FIRST so runGeocodeBatch spends its quota on active centers
 * before deactivated ones. Locations serving any ACTIVE center sort ahead; the
 * JS dedup below then keeps that active-first row per geo key.
 * Reads PinCode/City/State/Spoke_Country (post-reload column names). No
 * baseline filter applies (CD_SEG_FILTER = '1=1' since 2026-07-22).
 */
function distinctLocations_() {
  var rows = runQuery(
    "SELECT pin, city, state, country FROM ( " +
    " SELECT PinCode AS pin, City AS city, State AS state, Spoke_Country AS country, " +
    "  MAX(IF(Status = 'ACTIVE', 1, 0)) AS any_active " +
    " FROM " + T('center_details') + " WHERE " + CD_SEG_FILTER + " " +
    " GROUP BY pin, city, state, country) " +
    "ORDER BY any_active DESC",
    null, { maxRows: 60000 });
  var seen = {};
  return rows.filter(function (row) {
    var key = geoKeyFor(row);
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

/**
 * Geocodes up to GEO_BATCH_LIMIT unlocated centers and persists the results.
 * Run repeatedly (e.g. once a day) until geoStats().pending is 0.
 */
function runGeocodeBatch() {
  var store = loadGeoStore();
  var locations = distinctLocations_();
  var geocoder = Maps.newGeocoder();
  var done = 0, failed = 0;

  for (var i = 0; i < locations.length && done + failed < GEO_BATCH_LIMIT; i++) {
    var key = geoKeyFor(locations[i]);
    if (!key || store[key] !== undefined) continue;
    try {
      var result = geocoder.geocode(geoQueryFor_(locations[i]));
      if (result.status === 'OK' && result.results && result.results.length) {
        var loc = result.results[0].geometry.location;
        store[key] = loc.lat.toFixed(4) + ',' + loc.lng.toFixed(4);
        done++;
      } else if (result.status === 'ZERO_RESULTS') {
        store[key] = 'x'; // permanently unresolvable — don't retry
        failed++;
      } else {
        // OVER_QUERY_LIMIT or transient error — save progress and stop.
        Logger.log('Geocoder returned ' + result.status + ' — stopping batch early.');
        break;
      }
    } catch (err) {
      Logger.log('Geocoder error (' + err.message + ') — stopping batch early.');
      break;
    }
    if ((done + failed) % 100 === 0) saveGeoStore_(store); // checkpoint
    Utilities.sleep(60); // be gentle with the quota
  }

  saveGeoStore_(store);
  var stats = geoStats();
  Logger.log('Batch done: +' + done + ' located, +' + failed + ' unresolvable. ' +
    'Totals — located: ' + stats.located + ', unresolvable: ' + stats.failed +
    ', pending: ' + stats.pending + ' of ' + stats.total + '. ' +
    (stats.pending > 0 ? 'Run runGeocodeBatch() again (tomorrow if quota ran out).' : 'All locations done!'));
  return stats;
}

/**
 * Coverage counters for the editor log and the Map tab progress strip.
 * @return {{located:number, failed:number, pending:number, total:number}}
 */
function geoStats() {
  var store = loadGeoStore();
  var locations = distinctLocations_();
  var located = 0, failed = 0, pending = 0;
  locations.forEach(function (row) {
    var value = store[geoKeyFor(row)];
    if (value === undefined) pending++;
    else if (value === 'x') failed++;
    else located++;
  });
  return { located: located, failed: failed, pending: pending, total: locations.length };
}
