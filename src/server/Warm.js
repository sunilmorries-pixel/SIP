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
 *  - Only the DEFAULT payload variants are warmed (no hub, and the client's
 *    default global filter — see warmDefaultFilters_); other filter
 *    combinations still benefit because the shared Center-360 and asset caches
 *    stay hot.
 *  - warmCaches() calls the api* endpoints, which run assertAuthorized_().
 *    Time-driven triggers execute as the trigger owner — if you set the
 *    AUTHORIZED_EMAILS Script Property, include the owner's email or warming
 *    will fail with "Not authorized".
 */

/**
 * The client's DEFAULT global filter state, duplicated here deliberately.
 *
 * The 4 filter-aware endpoints key their caches on filterHash_(filters), so
 * warming with NO filters hashed under filterHash_({}) — a key no real page
 * load ever asks for, because the client boots with Status:Active applied. Every
 * first load therefore missed the warmed entry and paid the ~40s cold cost
 * (whole-branch review finding I6, 2026-07-29).
 *
 * KEEP IN SYNC with src/client/App.html's `state.globalFilters` initializer
 * (which carries the mirror-image comment). Server .js and client .html are
 * separate execution contexts in Apps Script, so they cannot share a constant —
 * if you change the default on one side, change it here too.
 * @return {{segments:Array,statuses:Array,states:Array,hubs:Array,cities:Array,countries:Array,
 *           deviceTypes:Array,deviceStatusExclude:Array,dateFrom:string,dateTo:string}}
 */
function warmDefaultFilters_() {
  return { segments: [], statuses: ['ACTIVE'], states: [], hubs: [], cities: [], countries: [],
    deviceTypes: CONFIG.JIRA_DEVICE_TYPE_DEFAULT, deviceStatusExclude: CONFIG.JIRA_DEVICE_STATUS_EXCLUDE_DEFAULT,
    dateFrom: '', dateTo: '' };
}

/** Rebuilds every default cache. Safe to run manually at any time. */
function warmCaches() {
  var t0 = Date.now();

  // Shared base first (with bypass) so the endpoint rebuilds below reuse it
  // instead of racing to recompute it.
  try { getCenter360RowsCD_(true); } catch (e) { console.error('warm center360: ' + e.message); }

  var f = warmDefaultFilters_();
  [
    ['dashboard', function () { return apiGetDashboardCD({ bypassCache: true, filters: f }); }],
    ['exec', function () { return apiGetExecOverviewCD({ bypassCache: true, filters: f }); }],
    ['map', function () { return apiGetMapDataCD({ bypassCache: true, filters: f }); }],
    ['topCustomers', function () { return apiGetTopCustomersCD({ bypassCache: true, filters: f }); }],
    // apiGetNumbers takes no filters — the Numbers page is exempt from the
    // global filter by design (it reports the full universe).
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
