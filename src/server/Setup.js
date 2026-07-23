/**
 * Setup.js — one-time provisioning + diagnostics.
 *
 * SECURITY: never leave a real private key in this file. Paste it, run
 * setupServiceAccountKey() once, confirm the log says "saved", then
 * IMMEDIATELY delete the pasted value and save the file again.
 */

/**
 * One-time: store the service-account key in Script Properties.
 * Paste the full JSON from credentials/…service_account.json between
 * the markers, run, then remove it.
 */
function setupServiceAccountKey() {
  // ── PASTE KEY BETWEEN THESE LINES, RUN ONCE, THEN DELETE ──────────────
  var key = null; // e.g. { "type": "service_account", "project_id": "...", ... }
  // ──────────────────────────────────────────────────────────────────────
  if (!key) {
    throw new Error('Paste the service-account JSON into `key` first (then delete it after running).');
  }
  PropertiesService.getScriptProperties()
    .setProperty(CONFIG.SA_PROPERTY_KEY, JSON.stringify(key));
  Logger.log('Service-account key saved to Script Properties. Now DELETE the pasted key from this file.');
}

/** Verifies auth + a trivial query. Run from the editor; check the log. */
function diagnostics() {
  var health = apiHealthCheck();
  Logger.log('Health check: ' + JSON.stringify(health));
  if (!health.ok) return;

  // Live app reads center_details only (device_center_mapping removed) → CD endpoints.
  var dash = apiGetDashboardCD({ bypassCache: true });
  if (!dash.ok) {
    Logger.log('Dashboard FAILED: ' + JSON.stringify(dash.error));
    return;
  }
  Object.keys(dash.data).forEach(function (key) {
    var value = dash.data[key];
    if (Array.isArray(value)) {
      Logger.log(key + ': ' + value.length + ' rows');
    } else if (value === null) {
      Logger.log(key + ': FAILED (see error log)');
    } else if (typeof value === 'object') {
      Logger.log(key + ': ok (' + Object.keys(value).join(', ') + ')');
    }
  });

  var centers = apiGetCentersCD({ pageSize: 5 });
  Logger.log(centers.ok
    ? 'center360 join: ' + centers.data.totalRows + ' centers'
    : 'center360 join FAILED: ' + JSON.stringify(centers.error));

  var mapData = apiGetMapDataCD();
  Logger.log(mapData.ok
    ? 'map: ' + mapData.data.centers.length + ' centers located, ' +
      mapData.data.unlocatedCenters + ' awaiting geocoding (geo: ' +
      JSON.stringify(mapData.data.geo) + ')'
    : 'map FAILED: ' + JSON.stringify(mapData.error));

  var top = apiGetTopCustomersCD();
  Logger.log(top.ok
    ? 'top customers: ' + top.data.totals.withData + '/' + top.data.totals.customers +
      ' with data, ' + top.data.totals.centers + ' centers, ' + top.data.totals.devices +
      ' devices, ' + top.data.mapCenters.length + ' mapped'
    : 'top customers FAILED: ' + JSON.stringify(top.error));

  var exec = apiGetExecOverviewCD();
  Logger.log(exec.ok
    ? 'exec overview: ' + exec.data.rollup.centers + ' centers, ' +
      exec.data.rollup.devices + ' devices, ' + exec.data.rollup.attention_centers +
      ' centers need attention, ' + exec.data.worstCenters.length + ' in watchlist'
    : 'exec overview FAILED: ' + JSON.stringify(exec.error));
  if (exec.ok && exec.data.uptimeFleet) {
    Logger.log('Machine Uptime (M-A1): fleet avg ' + exec.data.uptimeFleet.avg_uptime +
      '% across ' + exec.data.uptimeFleet.scored + ' centers · ' +
      exec.data.uptimeFleet.pct99 + '% at/above 99% (North-Star)');
  }
  if (dash.ok && dash.data.cohortReliability) {
    var co = dash.data.cohortReliability;
    var worst = co.reduce(function (a, b) { return (b.ftf_rate_pct || 0) > (a.ftf_rate_pct || 0) ? b : a; }, co[0] || {});
    Logger.log('Batch cohorts (M-A3/M-A5): ' + co.length + ' production years · worst FTF ' +
      (worst.ftf_rate_pct || 0) + '% (' + worst.batch_year + ' batch, top issue "' + (worst.top_issue || '—') + '")');
  }
  if (dash.ok && dash.data.slaKpis && dash.data.slaKpis[0]) {
    var sk = dash.data.slaKpis[0];
    Logger.log('SLA compliance: ' + sk.within_pct + '% within target (' + sk.resolved_n + ' resolved) · ' +
      'Tech ' + sk.within_tech + '% / Non-Tech ' + sk.within_nontech + '% · ' +
      sk.breached_open + ' open breached, ' + sk.atrisk_open + ' at-risk');
  }

  // Devices source = Google Sheet (jira_data BQ commented out) + raw center table.
  var jiraSheet = readJiraSheet();
  Logger.log(jiraSheet
    ? 'Jira sheet: ' + jiraSheet.length + ' rows read (devices source)'
    : 'Jira sheet UNREADABLE — enable Sheets API on the project + share the sheet with the deploying user');
  var raw = apiGetCenterDetailsRaw({ page: 0, pageSize: 5 });
  Logger.log(raw.ok
    ? 'center_details raw table: ' + raw.data.totalRows + ' rows (F2P excluded)'
    : 'raw table FAILED: ' + JSON.stringify(raw.error));
  var nums = apiGetNumbers();
  Logger.log(nums.ok
    ? 'Numbers: centers ' + nums.data.centers.total + ', hubs ' + nums.data.hubs.total +
      ', devices ' + nums.data.devices.total + ' (' + nums.data.devices.source + ')'
    : 'Numbers FAILED: ' + JSON.stringify(nums.error));

  // Jira device-type filter (Connector + ECG Machine only, permanent).
  var jiraStats = jiraDeviceStats_();
  Logger.log('Jira devices (Connector + ECG Machine only): ' + jiraStats.total +
    ' total, source=' + jiraStats.source);
  Logger.log('Jira devices by status: ' + JSON.stringify(jiraStats.by_status));

  // Raw Data page — one row-count check per source.
  Object.keys(rawSources_()).forEach(function (key) {
    var raw = apiGetRawPage({ source: key, page: 0, pageSize: 1 });
    Logger.log(raw.ok
      ? 'Raw data [' + key + ']: ' + raw.data.totalRows + ' rows'
      : 'Raw data [' + key + '] FAILED: ' + JSON.stringify(raw.error));
  });
}

/**
 * Clears cached payloads so the next load recomputes (e.g. after the Google
 * Sheet changes, to refresh the device count immediately). CacheService has no
 * clear-all, so we remove the current known keys.
 */
function clearDashboardCache() {
  var cache = CacheService.getScriptCache();
  var h = shortHash('');
  // Segment-sliced keys: one per real segment value + 'all'.
  var slugs = ['all'];
  try {
    runQuery("SELECT DISTINCT TRIM(hub_master_segment) AS s FROM " + T('center_details') +
      " WHERE NULLIF(TRIM(hub_master_segment), '') IS NOT NULL")
      .forEach(function (r) { slugs.push(segSlug_(r.s)); });
  } catch (e) { /* BQ unavailable → clear the 'all' slice at least */ }
  var small = ['dash_v7_' + h, 'exec_v4', 'execcd_v5', 'topcust_v1', 'topcustcd_v5', 'numbers_v4'];
  // Large (gzip-chunked) caches: remove #meta + each chunk.
  var largeBases = ['ctr360_v3', 'ctr360cd_v5', 'map_v3', 'mapcd_v5', 'assets_v3',
    'rawsheet_v1_' + CONFIG.JIRA_SHEET_ID, 'rawsheet_v1_' + CONFIG.CS_SHEET_ID];
  slugs.forEach(function (sg) {
    small.push('jiradev_v5_' + sg);
    // dashcd_v5_* moved to the large (gzip-chunked) cache 2026-07-23 — its
    // reliability/assetHealth arrays now carry every scored center, not 12,
    // and can exceed withCache's 100KB-per-key limit (see EditionCD.js
    // apiGetDashboardCD).
    largeBases.push('dashcd_v5_' + sg + '_' + h);
  });
  cache.removeAll(small);
  largeBases.forEach(function (base) {
    var meta = cache.get(base + '#meta');
    var n = meta ? parseInt(meta, 10) : 40;
    var keys = [base + '#meta'];
    for (var i = 0; i < n; i++) keys.push(base + '#' + i);
    cache.removeAll(keys);
  });
  Logger.log('Caches cleared (' + slugs.length + ' segment slices) — next load recomputes.');
}
