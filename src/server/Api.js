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
 * Paginated device explorer.
 * @param {{search:string, hub:string, status:string,
 *          filters:{segments:Array,statuses:Array,states:Array,hubs:Array}=,
 *          sortBy:string, sortDir:string, page:number, pageSize:number}=} options
 *          `filters` is the new global filter — SEPARATE from the pre-existing
 *          `hub` (free-text HubName equality) and `status` (device heartbeat
 *          bucket) params, which are device-explorer-local concepts. No
 *          dateFrom/dateTo: cloud_devices has no "created" field to range
 *          against (see the design spec's device-explorer date exemption).
 * @return {Object} envelope with { rows, totalRows, page, pageSize }
 */
function apiGetDevices(options) {
  options = options || {};
  var clean = {
    search: String(options.search || '').toLowerCase().slice(0, 80),
    hub: String(options.hub || '').slice(0, 120),
    status: String(options.status || '').slice(0, 40),
    filters: {
      segments: ((options.filters && options.filters.segments) || []).map(segClean_).filter(Boolean),
      statuses: ((options.filters && options.filters.statuses) || []).map(segClean_).filter(Boolean),
      states: ((options.filters && options.filters.states) || []).map(segClean_).filter(Boolean),
      hubs: ((options.filters && options.filters.hubs) || []).map(segClean_).filter(Boolean)
      // no dateFrom/dateTo here — cloud_devices has no "created" field to
      // range against (see the design spec's device-explorer date exemption).
    },
    sortBy: String(options.sortBy || 'last_seen'),
    sortDir: options.sortDir === 'asc' ? 'asc' : 'desc',
    page: Math.max(0, parseInt(options.page, 10) || 0),
    pageSize: Math.min(100, Math.max(5, parseInt(options.pageSize, 10) || 15))
  };
  return respond_(function () {
    var cacheKey = 'dev_v3_' + shortHash(JSON.stringify(clean)); // v3: country filter sources from hub_country
    return withCache(cacheKey, function () {
      var query = buildDeviceExplorerQuery(clean);
      var rows = runQuery(query.sql, query.params);
      var totalRows = rows.length ? rows[0].total_rows : 0;
      rows.forEach(function (row) { delete row.total_rows; });
      return { rows: rows, totalRows: totalRows, page: clean.page, pageSize: clean.pageSize };
    });
  });
}

/**
 * Paginated Communicator (cloud_devices) explorer for the CDM page — same
 * shape as apiGetDevices, called directly (no CD suffix): cloud_devices is
 * a single physical table, so nothing here differs by edition.
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
  open_tickets: 'open_tickets',
  lifecycle_years: 'lifecycle_years', downtime_days: 'downtime_days',
  uptime_pct: 'uptime_pct', tickets_total: 'tickets_total', jira_devices: 'jira_devices',
  mtbf_hrs: 'mtbf_hrs', failures: 'failures'
};

/**
 * Paginated Center-360 explorer — one row per center.
 * The three sources are SINGLE-TABLE BigQuery reads (Queries.js) and the
 * join happens HERE in Apps Script via Join.js:
 *   cloud_devices agg ⟕ latest location ⟕ open-ticket counts, on CenterID.
 * Filtering, sorting and paging also run in JS over the joined rows.
 * @param {{search:string, hub:string, sortBy:string, sortDir:string,
 *          page:number, pageSize:number}=} options
 * @return {Object} envelope with { rows, totalRows, page, pageSize }
 */
function apiGetCenters(options) {
  options = options || {};
  var clean = {
    search: String(options.search || '').toLowerCase().slice(0, 80),
    hub: String(options.hub || '').slice(0, 120),
    segment: String(options.segment || '').slice(0, 80),
    sortBy: String(options.sortBy || 'devices'),
    sortDir: options.sortDir === 'asc' ? 'asc' : 'desc',
    page: Math.max(0, parseInt(options.page, 10) || 0),
    pageSize: Math.min(100, Math.max(5, parseInt(options.pageSize, 10) || 15))
  };
  return respond_(function () {
    var joined = getCenter360Rows_();

    var filtered = joined.filter(function (row) {
      if (clean.hub && row.hub !== clean.hub) return false;
      if (clean.segment && row.segment !== clean.segment) return false;
      if (!clean.search) return true;
      return (String(row.center).toLowerCase().indexOf(clean.search) !== -1 ||
              String(row.center_id).indexOf(clean.search) !== -1 ||
              String(row.hub).toLowerCase().indexOf(clean.search) !== -1 ||
              String(row.state).toLowerCase().indexOf(clean.search) !== -1);
    });

    var sortCol = CENTER_SORT_KEYS[clean.sortBy] || 'devices';
    sortRows(filtered, sortCol, clean.sortDir, sortCol === 'open_tickets' ? 'uptime_pct' : null, 'asc');

    var start = clean.page * clean.pageSize;
    return {
      rows: filtered.slice(start, start + clean.pageSize),
      totalRows: filtered.length,
      page: clean.page,
      pageSize: clean.pageSize
    };
  });
}

/**
 * Fetches the three center sources in parallel and joins them in JS.
 * The joined result (~5k small rows) is cached with the chunked large-cache.
 * @return {Array<Object>}
 */
function getCenter360Rows_() {
  var cached = cacheGetLarge('ctr360_v3');
  if (cached) return cached;

  var sources = runQueriesParallel(buildCenterSourceSpecs());

  // Anchor on the full center dimension; live telemetry & tickets are optional.
  var withTelemetry = leftJoin(sources.centerBase || [], sources.centerTelemetry || [], {
    leftKey: 'center_id',
    rightKey: 'center_id',
    select: function (base, tel) {
      return {
        center_id: base.center_id,
        center: base.center || '',
        hub: base.hub || '',
        hub_id: base.hub_id != null ? base.hub_id : '',
        city: base.city || '',
        state: base.state || '',
        pin: base.pin || '',
        country: base.country || '',
        devices: tel ? tel.devices : 0,
        online: tel ? tel.online : 0,
        last_seen: (tel && tel.last_seen) || ''
      };
    }
  });

  var joined = leftJoin(withTelemetry, sources.centerTickets || [], {
    leftKey: 'center_id',
    rightKey: 'center_id',
    select: function (row, tickets) {
      row.open_tickets = tickets ? tickets.open_tickets : 0;
      row.segment = (tickets && tickets.segment) || '';
      return row;
    }
  });

  cachePutLarge('ctr360_v3', joined, 600);
  return joined;
}

/* ═══════════ Map view: asset index + map data + center detail ═══════════ */

/**
 * Adds a friendly `center` name to rows keyed by `centerid`, using the cached
 * Center-360 rows (no extra query). Falls back to "Center #<id>".
 * @param {Array<Object>} rows mutated in place
 * @return {Array<Object>}
 */
function enrichCenterNames_(rows) {
  if (!rows || !rows.length) return rows;
  var byId = {};
  getCenter360Rows_().forEach(function (r) { byId[r.center_id] = r; });
  rows.forEach(function (r) {
    var c = byId[r.centerid];
    r.center = (c && c.center) || ('Center #' + r.centerid);
    if (r.devices == null) r.devices = c ? c.devices : 0;
  });
  return rows;
}

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

/**
 * Everything the Map page needs in one cached payload — the client does all
 * filtering, KPI recompute and chart aggregation from this, so there are no
 * round-trips on filter changes.
 *
 * centers: compact arrays, indices are STABLE (MapView + App depend on them):
 *   [0]center_id [1]name [2]lat [3]lng [4]devices [5]online
 *   [6]open_tickets [7]assets [8]hub [9]hub_id [10]segment [11]state
 * assets: dictionary-encoded to stay compact at 12k–49k rows:
 *   [0]center_id [1]typeIdx [2]catIdx [3]age_days [4]serial
 *   with assetTypes[] / assetCats[] as the dictionaries.
 */
function apiGetMapData() {
  return respond_(function () {
    var cached = cacheGetLarge('map_v3');
    if (cached) return cached;

    var centers = getCenter360Rows_();
    var assets = getAssetIndex_();
    var geoStore = loadGeoStore();

    var assetCount = {};
    assets.forEach(function (asset) {
      if (asset.center_id !== null) {
        assetCount[asset.center_id] = (assetCount[asset.center_id] || 0) + 1;
      }
    });

    var locatedIds = {};
    var located = [];
    var unlocated = 0;
    centers.forEach(function (row) {
      var coords = geoStore[geoKeyFor(row)];
      if (coords && coords !== 'x') {
        var parts = coords.split(',');
        locatedIds[row.center_id] = true;
        located.push([
          row.center_id, row.center,
          parseFloat(parts[0]), parseFloat(parts[1]),
          row.devices, row.online, row.open_tickets,
          assetCount[row.center_id] || 0,
          row.hub || '', row.hub_id != null ? row.hub_id : '',
          row.segment || '', row.state || ''
        ]);
      } else {
        unlocated++;
      }
    });

    var typeDict = [], catDict = [], typeIdx = {}, catIdx = {};
    function intern_(dict, index, value) {
      var v = value || 'Other';
      if (!(v in index)) { index[v] = dict.length; dict.push(v); }
      return index[v];
    }
    var assetRows = [];
    assets.forEach(function (asset) {
      if (asset.center_id === null || !locatedIds[asset.center_id]) return;
      assetRows.push([
        asset.center_id,
        intern_(typeDict, typeIdx, asset.type),
        intern_(catDict, catIdx, asset.category),
        asset.age_days == null ? null : asset.age_days,
        asset.serial || ''
      ]);
    });

    var payload = {
      centers: located,
      assets: assetRows,
      assetTypes: typeDict,
      assetCats: catDict,
      unlocatedCenters: unlocated,
      geo: geoStats(),
      matchedAssets: Object.keys(assetCount).length
    };
    cachePutLarge('map_v3', payload, 600);
    return payload;
  });
}

/**
 * Sidebar payload for one center: center/hub info, fleet, tickets and the
 * Jira assets currently linked to it.
 * @param {{centerId:number}} options
 */
function apiGetCenterDetail(options) {
  var centerId = parseInt(options && options.centerId, 10);
  return respond_(function () {
    if (!isFinite(centerId)) throw new Error('centerId is required');
    return withCache('ctrdet_v2_' + centerId, function () {
      var detail = runQueriesParallel(buildCenterDetailSpecs(centerId));
      var assets = getAssetIndex_()
        .filter(function (asset) { return asset.center_id === centerId; })
        .sort(function (a, b) { return (b.age_days || 0) - (a.age_days || 0); })
        .slice(0, 100);
      return {
        info: (detail.info && detail.info[0]) || null,
        tickets: (detail.tickets && detail.tickets[0]) || null,
        openTickets: detail.openTickets || [],
        allTickets: detail.allTickets || [],
        devices: detail.devices || [],
        assets: assets
      };
    });
  });
}

/** Connectivity self-test — run from the editor after setup. */
function apiHealthCheck() {
  return respond_(function () {
    var rows = runQuery('SELECT 1 AS ok');
    return { bigquery: rows.length === 1 && rows[0].ok === 1 };
  });
}
