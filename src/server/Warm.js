/**
 * Warm.js — keeps the dashboard caches hot so users never hit a cold load
 * (measured ~40s uncached vs <2s cached).
 *
 * SETUP (one time, as the deploying user): run installWarmTrigger() from the
 * editor. It schedules warmCaches() every 10 minutes. CACHE_TTL_SECONDS (900)
 * and the large-object TTLs (1800) exceed the warm interval, so a warmed
 * value never expires before the next pass.
 *
 * Notes:
 *  - Only the DEFAULT (no hub / no segment) payload variants are warmed;
 *    filtered views still benefit because the shared Center-360 and asset
 *    caches stay hot.
 *  - warmCaches() calls the api* endpoints, which run assertAuthorized_().
 *    Time-driven triggers execute as the trigger owner — if you set the
 *    AUTHORIZED_EMAILS Script Property, include the owner's email or warming
 *    will fail with "Not authorized".
 */

/** Rebuilds every default cache. Safe to run manually at any time. */
function warmCaches() {
  var t0 = Date.now();

  // Shared base first (with bypass) so the endpoint rebuilds below reuse it
  // instead of racing to recompute it.
  try { getCenter360RowsCD_(true); } catch (e) { console.error('warm center360: ' + e.message); }

  [
    ['dashboard', function () { return apiGetDashboardCD({ bypassCache: true }); }],
    ['exec', function () { return apiGetExecOverviewCD({ bypassCache: true }); }],
    ['map', function () { return apiGetMapDataCD({ bypassCache: true }); }],
    ['topCustomers', function () { return apiGetTopCustomersCD({ bypassCache: true }); }],
    ['numbers', function () { return apiGetNumbers({ bypassCache: true }); }]
  ].forEach(function (job) {
    try {
      var r = job[1]();
      if (r && r.ok === false) console.error('warm ' + job[0] + ' failed: ' + JSON.stringify(r.error));
    } catch (e) {
      console.error('warm ' + job[0] + ' error: ' + e.message);
    }
  });

  console.log('warmCaches finished in ' + Math.round((Date.now() - t0) / 1000) + 's');
}

/** Installs the 10-minute warm trigger (idempotent — removes older ones first). */
function installWarmTrigger() {
  removeWarmTrigger();
  ScriptApp.newTrigger('warmCaches').timeBased().everyMinutes(10).create();
  console.log('warmCaches trigger installed (every 10 minutes).');
}

/** Removes the warm trigger(s). */
function removeWarmTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'warmCaches') ScriptApp.deleteTrigger(t);
  });
}
