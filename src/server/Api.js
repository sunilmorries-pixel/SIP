/**
 * Api.js — the only functions the client is allowed to call via
 * google.script.run. Every endpoint:
 *   1. sanitises input,
 *   2. serves from cache when possible,
 *   3. returns an { ok, data | error } envelope so the client never
 *      has to guess what a failure looks like.
 */

/** Wraps a producer in the standard response envelope. */
function respond_(producer) {
  try {
    assertAuthorized_();
    return { ok: true, data: producer(), meta: { generatedAt: new Date().toISOString() } };
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return { ok: false, error: { message: String(err && err.message ? err.message : err) } };
  }
}

/**
 * Paginated Communicator (cloud_devices) explorer for the CDM page — cloud_devices
 * is a single physical table, so nothing here differs by edition. The Asset
 * page's own device explorer (apiGetDevices) was removed 2026-08-19 — per
 * user, cloud_devices data is CDM/Numbers/Raw-Data only now.
 * @param {{search:string, filters:Object=, sortBy:string, sortDir:string,
 *          page:number, pageSize:number}=} options
 * @return {Object} envelope with { rows, totalRows, page, pageSize }
 */
function apiGetCdmDevices(options) {
  options = options || {};
  var clean = {
    search: String(options.search || '').toLowerCase().slice(0, 80),
    filters: {
      segments: ((options.filters && options.filters.segments) || []).map(segClean_).filter(Boolean),
      statuses: ((options.filters && options.filters.statuses) || []).map(segClean_).filter(Boolean),
      states: ((options.filters && options.filters.states) || []).map(segClean_).filter(Boolean),
      hubs: ((options.filters && options.filters.hubs) || []).map(segClean_).filter(Boolean),
      cities: ((options.filters && options.filters.cities) || []).map(segClean_).filter(Boolean),
      countries: ((options.filters && options.filters.countries) || []).map(segClean_).filter(Boolean),
      centers: ((options.filters && options.filters.centers) || []).map(segClean_).filter(Boolean)
    },
    sortBy: String(options.sortBy || 'last_seen'),
    sortDir: options.sortDir === 'asc' ? 'asc' : 'desc',
    page: Math.max(0, parseInt(options.page, 10) || 0),
    pageSize: Math.min(100, Math.max(5, parseInt(options.pageSize, 10) || 15))
  };
  return respond_(function () {
    var cacheKey = 'cdmdev_v2_' + shortHash(JSON.stringify(clean)); // v2: country filter sources from hub_country
    return withCache(cacheKey, function () {
      var query = buildCdmDeviceExplorerQuery(clean);
      var rows = runQuery(query.sql, query.params);
      var totalRows = rows.length ? rows[0].total_rows : 0;
      rows.forEach(function (row) { delete row.total_rows; });
      return { rows: rows, totalRows: totalRows, page: clean.page, pageSize: clean.pageSize };
    });
  });
}

/** Whitelisted sort columns for the joined Center-360 rows. */
var CENTER_SORT_KEYS = {
  center: 'center', state: 'state', devices: 'devices',
  open_tickets: 'open_tickets', swapped: 'swapped',
  lifecycle_years: 'lifecycle_years', downtime_days: 'downtime_days',
  uptime_pct: 'uptime_pct', tickets_total: 'tickets_total', jira_devices: 'jira_devices',
  mtbf_hrs: 'mtbf_hrs', failures: 'failures'
};

/* ═══════════ Map view: asset index (still used by getAssetIndex_) ═══════ */

/** Parse a Jira-sheet date cell ("4/14/2026 18:45:21" or a Date) → 'YYYY-MM-DD' or ''. */
function assetDateStr_(value) {
  if (!value) return '';
  var d = (value instanceof Date) ? value : new Date(String(value));
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

/** Whole days from a Jira-sheet date until today; null if unparseable. (age = today − Created, per user) */
function assetAgeDays_(value) {
  if (!value) return null;
  var d = (value instanceof Date) ? value : new Date(String(value));
  if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

/** Model/machine token parsed from the Summary prefix (e.g. "Vcardia - B2-…" → VCARDIA). */
function assetMachineModel_(summary) {
  var s = String(summary || '').trim();
  var a = /^([A-Za-z]{3,})/.exec(s);
  if (a) return a[1].toUpperCase();
  var b = /^([A-Za-z0-9]{2})-/.exec(s);
  return b ? b[1].toUpperCase() : '';
}

/**
 * Jira assets linked to centers — sourced from the LIVE jira_data BigQuery
 * table (readJiraData_, Numbers.js). Excludes Jira housekeeping ticket types
 * (isTrackedJiraDeviceType_), 1 row/device (deduped by Key). Per user's field
 * mapping:
 *   Key = ticket id · Summary = Device ID / Mac Serial ID · Issue Type = device
 *   type · Status = device status · age = today − Created.
 * A device's center: serial parsed from Summary → deviceCenterMap_ (cloud_devices
 * first, center_details fallback). The Jira "Customer ID" column is ignored.
 * @return {Array<Object>} assets with .center_id (or null when unmapped)
 */
function getAssetIndex_() {
  var cached = cacheGetLarge('assets_v3');
  if (cached) return cached;

  var jiraRows = readJiraData_();
  var dev2ctr = jiraRows.length ? deviceCenterMap_().map : {};
  var SERIAL_RE = /([A-Za-z0-9]{2}-[A-Za-z0-9]{6,})/;
  var seen = {}, assets = [];

  jiraRows.forEach(function (row) {
    if (!isTrackedJiraDeviceType_(row.issuetype_name)) return;   // excludes task/epic/test housekeeping tickets
    var key = String(row.issue_key || '').trim();
    if (!key || seen[key]) return;                                // dedupe by Key (1 row/device)
    seen[key] = true;
    var summary = String(row.summary || '');
    var m = SERIAL_RE.exec(summary.toUpperCase());
    var serial = m ? m[1] : '';
    var cid = (serial && (serial in dev2ctr)) ? dev2ctr[serial] : null;
    assets.push({
      key: key,
      summary: summary,
      serial: serial,
      type: String(row.issuetype_name || 'Other'),   // device type = Issue Type (per user)
      category: assetMachineModel_(summary),          // model token from Summary
      status: String(row.status_name || ''),          // device status = Status
      birthday: assetDateStr_(row.ticket_created),
      age_days: assetAgeDays_(row.ticket_created),
      center_id: (cid == null ? null : cid)
    });
  });

  cachePutLarge('assets_v3', assets, 1800);
  return assets;
}

/** Connectivity self-test — run from the editor after setup. */
function apiHealthCheck() {
  return respond_(function () {
    var rows = runQuery('SELECT 1 AS ok');
    return { bigquery: rows.length === 1 && rows[0].ok === 1 };
  });
}
