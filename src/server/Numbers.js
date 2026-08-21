/**
 * Numbers.js — the "Numbers" page: counts only (KPIs + small tables) for the
 * sole center source, center_details, plus device (Jira) and ticket (Zoho)
 * totals broken down by status / type.
 *
 * device_center_mapping has been removed as a data source, so this page now
 * reports center_details only. No hardcoded BASELINE filter applies (removed
 * 2026-07-22 — see cdFilter_ in EditionCD.js). The page DOES respect the
 * global Filters drawer (per user, 2026-08-13 — previously exempt by design):
 * centers/hubs narrow via centerAttrCond_ + deploymentdate, tickets bridge to
 * center_details via CenterID + CreatedAt, devices via jiraDeviceStats_'s own
 * filters support. Status/segment come from center_details; Devices (Jira)
 * and Tickets (Zoho) are source-independent (different BigQuery tables).
 */
/**
 * Device serial → CenterID map, used to map a Jira device (by its Summary
 * serial) to a center. Precedence per user (2026-07-08):
 *   1. PRIMARY  — cloud_devices.DeviceID → CenterID.
 *   2. FALLBACK — center_details.DeviceID / MacSerialID, ONLY for serials not
 *      already matched in cloud_devices.
 * The two are UNIONed (max coverage); cloud_devices wins any conflict. The Jira
 * "Customer ID" column is never used.
 * @return {{map:Object, source:string}} SERIAL(upper) → CenterID
 */
function deviceCenterMap_() {
  var map = {};
  // 1. PRIMARY: cloud_devices.DeviceID.
  runQuery("SELECT UPPER(TRIM(DeviceID)) AS did, ANY_VALUE(CenterID) AS cid FROM " +
    T('cloud_devices') + " WHERE DeviceID IS NOT NULL AND CenterID IS NOT NULL GROUP BY did",
    null, { maxRows: 60000 }) // full map — default cap (1000) would drop most serials
    .forEach(function (r) { if (r.did) map[r.did] = r.cid; });
  // 2. FALLBACK: center_details DeviceID / MacSerialID (only serials not in cloud_devices).
  ['DeviceID', 'MacSerialID'].forEach(function (coln) {
    try {
      runQuery("SELECT UPPER(TRIM(" + coln + ")) AS did, ANY_VALUE(CenterID) AS cid FROM " +
        T('center_details') + " WHERE " + coln + " IS NOT NULL AND CenterID IS NOT NULL GROUP BY did",
        null, { maxRows: 60000 })
        .forEach(function (r) { if (r.did && !(r.did in map)) map[r.did] = r.cid; });
    } catch (e) { /* column not present → skip */ }
  });
  return { map: map, source: 'cloud_devices+center_details' };
}

/**
 * Is this Jira "Issue Type" one of the device categories the app tracks?
 * Every Issue Type counts as a fleet device EXCEPT Jira housekeeping ticket
 * types (CONFIG.JIRA_NON_DEVICE_TYPES: task/epic/test) — everywhere
 * jiraDeviceStats_() is consumed (per user request, 2026-07-30; widened
 * from the prior Connector+ECG-Machine-only restriction, which was
 * excluding real device categories like SIM Card/UPS/Printer/BP Machine).
 * @param {string} issueTypeName raw Issue Type value
 * @return {boolean}
 */
function isTrackedJiraDeviceType_(issueTypeName) {
  var key = String(issueTypeName || '').trim().toLowerCase();
  return CONFIG.JIRA_NON_DEVICE_TYPES.indexOf(key) === -1;
}

/**
 * Reads Jira devices from the LIVE jira_data BigQuery table — replaced the
 * Jira devices Google Sheet 2026-07-30 (the Sheet's Sheets API was disabled
 * on the GCP project, and its offline JiraDump.js fallback had gone ~3 weeks
 * stale; jira_data is confirmed actively loaded — most recent row 2 days old
 * at the time of the switch — so no fallback is needed).
 *
 * jira_data is CHANGELOG grain (one row per issue per field-change, fanned
 * out via a LEFT JOIN in its upstream ETL — see sql/jira_data.lineage.sql),
 * but the issue-level fields this app reads (summary/status_name/
 * issuetype_name/ticket_created/customerid) come from the issue table side
 * of that join and are constant across every row for a given issue_key — so
 * a plain GROUP BY + ANY_VALUE/MIN collapses it correctly with no "pick the
 * latest changelog row" logic needed. This is the same approach the app's
 * pre-Sheet code used successfully (see git history, `cohortReliabilitySql_`/
 * `buildAssetSourceSpecs` before they were retired in favor of the Sheet).
 *
 * Returns the same row shape the old readJiraSheet() did, so every consumer
 * (getAssetIndex_, jiraDeviceStats_) needed no changes beyond the call site.
 * @return {Array<{issue_key:string, summary:string, customerid:*, status_name:string, issuetype_name:string, ticket_created:string}>}
 */
function readJiraData_() {
  return runQuery(
    "SELECT issue_key, ANY_VALUE(summary) AS summary, ANY_VALUE(customerid) AS customerid, " +
    "ANY_VALUE(status_name) AS status_name, ANY_VALUE(issuetype_name) AS issuetype_name, " +
    "CAST(MIN(ticket_created) AS STRING) AS ticket_created " +
    "FROM " + T('jira_data') + " WHERE issue_key IS NOT NULL GROUP BY issue_key",
    null, { maxRows: 60000 });
}

/**
 * Tracked, deduped, filter-passing Jira devices — the shared core of
 * jiraDeviceStats_ (status/age breakdown) and the Overview Devices tree
 * (type/age breakdown). Extracted so there is exactly ONE implementation of
 * this filter chain, not two independently-maintained copies that could
 * silently drift (the SQL-vs-JS filter-path-disagreement bug class this repo
 * has been bitten by before).
 * @param {{segments:Array,statuses:Array,states:Array,hubs:Array,cities:Array,
 *          countries:Array,deviceTypes:Array,deviceStatusExclude:Array}=} filters
 * @param {{map:Object, source:string}=} dcm optional pre-computed deviceCenterMap_;
 *        if not provided, computed locally to avoid redundant calls when passed by caller.
 * @return {Array<{issue_key:string, type:string, status:string, cid:number, age:(number|null)}>}
 */
function filteredJiraDevices_(filters, dcm) {
  filters = filters || {};
  dcm = dcm || deviceCenterMap_();
  var jiraRows = readJiraData_().filter(function (row) { return isTrackedJiraDeviceType_(row.issuetype_name); });
  var typeFilter = filters.deviceTypes || [];
  var statusExclude = filters.deviceStatusExclude || [];
  if (typeFilter.length) jiraRows = jiraRows.filter(function (row) { return typeFilter.indexOf(row.issuetype_name) !== -1; });
  if (statusExclude.length) jiraRows = jiraRows.filter(function (row) { return statusExclude.indexOf(row.status_name) === -1; });
  var dev2ctr = dcm.map;
  var SERIAL_RE = /([A-Za-z0-9]{2}-[A-Za-z0-9]{6,})/;
  var byIssue = {};
  jiraRows.forEach(function (row) {
    var ik = String(row.issue_key || row.summary || '');
    if (!ik || byIssue[ik]) return;
    var m = SERIAL_RE.exec(String(row.summary || '').toUpperCase());
    var cid = m ? dev2ctr[m[1]] : undefined;
    byIssue[ik] = {
      issue_key: ik, type: String(row.issuetype_name || 'Other'),
      status: String(row.status_name || '').trim(),
      cid: (cid == null ? NaN : cid), age: assetAgeDays_(row.ticket_created),
      // The device's OWN created date — the date range belongs here, not on
      // its center's deploymentdate. See the date block below.
      birthday: assetDateStr_(row.ticket_created)
    };
  });
  // `centers` belongs in this guard: it is a real user-facing dimension (the
  // "Center: …" chip, applied in SQL by centerAttrCond_). While it was absent,
  // a Center-only selection skipped filtering entirely and returned the WHOLE
  // fleet, and a Center selection combined with any other dimension returned 0.
  var hasCenterFilter = (filters.segments || []).length || (filters.statuses || []).length ||
    (filters.states || []).length || (filters.hubs || []).length ||
    (filters.cities || []).length || (filters.countries || []).length ||
    (filters.centers || []).length ||
    (filters.billable || []).length || (filters.machineTypes || []).length ||
    (filters.deviceIds || []).length || (filters.macSerialIds || []).length;
  var out = Object.keys(byIssue).map(function (k) { return byIssue[k]; });
  if (hasCenterFilter) {
    var cfMap = centerFilterMap_();
    // Hand centerPassesFilters_ ONLY the center dimensions — never dateFrom/
    // dateTo. Its date branch tests the CENTER's deploymentdate, which is a
    // different question from "was this device created in the window", and
    // passing the whole filters object here is what drove the entire fleet to
    // 0 on any date selection. apiGetDashboardCD's asset path already splits
    // the two this way; this is the same split, applied consistently.
    var centerDims = {
      segments: filters.segments, statuses: filters.statuses, states: filters.states,
      hubs: filters.hubs, cities: filters.cities, countries: filters.countries,
      centers: filters.centers,
      billable: filters.billable, machineTypes: filters.machineTypes,
      deviceIds: filters.deviceIds, macSerialIds: filters.macSerialIds
    };
    out = out.filter(function (o) { return isFinite(o.cid) && centerPassesFilters_(cfMap[o.cid] || {}, centerDims); });
  }
  if (filters.dateFrom || filters.dateTo) {
    out = out.filter(function (o) {
      if (!o.birthday) return false;                                  // undated device: outside any explicit window
      if (filters.dateFrom && o.birthday < filters.dateFrom) return false;
      if (filters.dateTo && o.birthday > filters.dateTo) return false;
      return true;
    });
  }
  return out;
}

/**
 * Fleet/device stats shared by the Numbers page, Asset "Total fleet" and
 * Overview "Devices" KPI. Devices = Jira issues (dedup by Key). A device's
 * serial resolves to a center via deviceCenterMap_ for global-filter matching
 * only (see below) — device→center coverage itself is not surfaced as a stat.
 * Cached.
 * @param {{segments:Array,statuses:Array,states:Array,hubs:Array,cities:Array,countries:Array,
 *          deviceTypes:Array,deviceStatusExclude:Array}=} filters
 * @return {{total,by_status,source,center_source}}
 */
function jiraDeviceStats_(filters) {
  filters = filters || {};
  return withCache('jiradev_v10_' + getCacheEpoch_() + '_' + filterHash_(filters), function () { // v10: billable/machineTypes/deviceIds/macSerialIds filters added
    var dcm = deviceCenterMap_();
    var devices = filteredJiraDevices_(filters, dcm);
    var dTotal = 0, dStatus = {};
    var ageSum = 0, ageN = 0;
    var ageBands = { '<1y': 0, '1-2y': 0, '2-3y': 0, '3-5y': 0, '5y+': 0 };
    devices.forEach(function (o) {
      dTotal++;
      var st = o.status || '(blank)';
      dStatus[st] = (dStatus[st] || 0) + 1;
      if (o.age != null) {
        ageSum += o.age; ageN++;
        var y = o.age / 365;
        if (y < 1) ageBands['<1y']++; else if (y < 2) ageBands['1-2y']++;
        else if (y < 3) ageBands['2-3y']++; else if (y < 5) ageBands['3-5y']++;
        else ageBands['5y+']++;
      }
    });
    return {
      total: dTotal,
      by_status: Object.keys(dStatus).map(function (k) { return { k: k, n: dStatus[k] }; })
        .sort(function (a, b) { return b.n - a.n; }),
      avg_age_days: ageN ? Math.round(ageSum / ageN) : null,
      aged_devices: ageN,
      past_life: ageBands['5y+'],
      age_bands: Object.keys(ageBands).map(function (k) { return { k: k, n: ageBands[k] }; }),
      source: 'jira_data', center_source: dcm.source
    };
  });
}

function apiGetNumbers(options) {
  options = options || {};
  var filters = {
    segments: (options.filters && options.filters.segments) || [],
    statuses: (options.filters && options.filters.statuses) || [],
    states: (options.filters && options.filters.states) || [],
    hubs: (options.filters && options.filters.hubs) || [],
    cities: (options.filters && options.filters.cities) || [],
    countries: (options.filters && options.filters.countries) || [],
    // centers was missing from this whitelist, so the "Center: …" chip rendered
    // as active on Numbers and had no effect on a single number.
    centers: (options.filters && options.filters.centers) || [],
    deviceTypes: (options.filters && options.filters.deviceTypes) || [],
    deviceStatusExclude: (options.filters && options.filters.deviceStatusExclude) || [],
    billable: (options.filters && options.filters.billable) || [],
    machineTypes: (options.filters && options.filters.machineTypes) || [],
    deviceIds: (options.filters && options.filters.deviceIds) || [],
    macSerialIds: (options.filters && options.filters.macSerialIds) || [],
    dateFrom: String((options.filters && options.filters.dateFrom) || ''),
    dateTo: String((options.filters && options.filters.dateTo) || '')
  };
  return respond_(function () {
    // Numbers now respects the global filter set like every other page (per
    // user, 2026-08-13 — this page was previously exempt by design). Centers/
    // Hubs use the center-attribute chain + deploymentdate (matches Centers/
    // Map); Tickets bridge to center_details via CenterID + CreatedAt (matches
    // Support); Devices already accepted the full filters object.
    return withCache('numbers_v10_' + getCacheEpoch_() + '_' + filterHash_(filters), function () { // v10: billable/machineTypes/deviceIds/macSerialIds filters added
      var CD = T('center_details');
      var ZOHO = zohoDedupSql_();
      var techBool = techBoolSql_("IFNULL(IssueCategory,'')");
      var F = cdFilter_(); // no baseline filter (removed 2026-07-22) — always '1=1'
      var centerCond = centerAttrCond_(filters);
      var centerDateCond = dateRangeCond_('deploymentdate', filters.dateFrom, filters.dateTo);
      var ticketCond = centerFilterSubqueryCond_(filters);
      var ticketDateCond = dateRangeCond_('CreatedAt', filters.dateFrom, filters.dateTo);

      var specs = [
        { key: 'centersTot', sql:
          "SELECT COUNT(DISTINCT CenterID) AS total FROM " + CD + " WHERE " + F + centerCond + centerDateCond },
        { key: 'centersStatus', maxRows: 50, sql:
          "SELECT IFNULL(NULLIF(TRIM(Status), ''), '(blank)') AS k, COUNT(DISTINCT CenterID) AS n " +
          "FROM " + CD + " WHERE " + F + centerCond + centerDateCond + " GROUP BY k ORDER BY n DESC" },
        { key: 'centersSegment', maxRows: 50, sql:
          "SELECT " + segmentGroupSql_('hub_master_segment') + " AS k, COUNT(DISTINCT CenterID) AS n " +
          "FROM " + CD + " WHERE " + F + centerCond + centerDateCond + " GROUP BY k ORDER BY n DESC LIMIT 15" },

        { key: 'hubsTot', sql:
          "SELECT COUNT(DISTINCT HubID) AS total FROM " + CD + " WHERE " + F + centerCond + centerDateCond },
        // 2026-07-07 reload removed HubStatus/HubSegment. Nearest equivalents:
        // hubs by the Status of their centers (a hub can appear under several
        // statuses) and by hub_master_segment.
        { key: 'hubsStatus', maxRows: 50, sql:
          "SELECT IFNULL(NULLIF(TRIM(Status), ''), '(blank)') AS k, COUNT(DISTINCT HubID) AS n " +
          "FROM " + CD + " WHERE " + F + centerCond + centerDateCond + " GROUP BY k ORDER BY n DESC" },
        { key: 'hubsSegment', maxRows: 50, sql:
          "SELECT " + segmentGroupSql_('hub_master_segment') + " AS k, COUNT(DISTINCT HubID) AS n " +
          "FROM " + CD + " WHERE " + F + centerCond + centerDateCond + " GROUP BY k ORDER BY n DESC LIMIT 15" },

        // Devices come from jira_data (readJiraData_), aggregated separately below.

        // Tickets = Zoho, total + by status + by Tech/Non-Tech (SLA catalog).
        { key: 'ticketsTot', sql:
          "SELECT COUNT(*) AS total, COUNTIF(is_tech) AS tech, COUNTIF(NOT is_tech) AS nontech " +
          "FROM (SELECT " + techBool + " AS is_tech FROM " + ZOHO +
          " WHERE TRUE" + ticketCond + ticketDateCond + ")" },
        { key: 'ticketsStatus', maxRows: 50, sql:
          "SELECT IFNULL(NULLIF(TRIM(status), ''), '(blank)') AS k, COUNT(*) AS n " +
          "FROM " + ZOHO + " WHERE TRUE" + ticketCond + ticketDateCond + " GROUP BY k ORDER BY n DESC LIMIT 15" }
      ];

      var r = runQueriesParallel(specs);
      var centersTot = (r.centersTot && r.centersTot[0]) || {};
      var hubsTot = (r.hubsTot && r.hubsTot[0]) || {};
      var ticketsTot = (r.ticketsTot && r.ticketsTot[0]) || {};

      var devices = jiraDeviceStats_(filters);

      return {
        centers: {
          total: centersTot.total || 0,
          by_status: r.centersStatus || [], by_segment: r.centersSegment || []
        },
        hubs: {
          total: hubsTot.total || 0,
          by_status: r.hubsStatus || [], by_segment: r.hubsSegment || []
        },
        devices: devices,
        tickets: {
          total: ticketsTot.total || 0, tech: ticketsTot.tech || 0, nontech: ticketsTot.nontech || 0,
          by_status: r.ticketsStatus || []
        }
      };
    }, options.bypassCache === true);
  });
}

/**
 * Paginated RAW center_details rows for the Numbers page table (no hardcoded
 * baseline filter — but DOES respect the global Filters drawer, 2026-08-13).
 * @param {{page:number, pageSize:number, filters:Object=}=} options
 */
function apiGetCenterDetailsRaw(options) {
  options = options || {};
  var page = Math.max(0, parseInt(options.page, 10) || 0);
  var pageSize = Math.min(100, Math.max(5, parseInt(options.pageSize, 10) || 25));
  var filters = {
    segments: (options.filters && options.filters.segments) || [],
    statuses: (options.filters && options.filters.statuses) || [],
    states: (options.filters && options.filters.states) || [],
    hubs: (options.filters && options.filters.hubs) || [],
    cities: (options.filters && options.filters.cities) || [],
    countries: (options.filters && options.filters.countries) || [],
    // Same omission as apiGetNumbers above — the raw center table ignored the
    // "Center: …" chip while displaying it as active.
    centers: (options.filters && options.filters.centers) || [],
    dateFrom: String((options.filters && options.filters.dateFrom) || ''),
    dateTo: String((options.filters && options.filters.dateTo) || '')
  };
  return respond_(function () {
    var centerCond = centerAttrCond_(filters);
    var centerDateCond = dateRangeCond_('deploymentdate', filters.dateFrom, filters.dateTo);
    var sql =
      // DISTINCT CTE: the 2026-07-07 reload duplicated center rows verbatim —
      // dedupe BEFORE the COUNT(*) OVER() so the pager total is centers, not rows.
      "WITH c AS (SELECT DISTINCT CenterID, Centername, Status, Type, Spoke_Center_Segment, " +
      " HubID, HubName, City, State, PinCode, deploymentdate, deactivationdate " +
      " FROM " + T('center_details') + " WHERE " + cdFilter_() + centerCond + centerDateCond + ") " +
      "SELECT c.CenterID AS center_id, c.Centername AS center, c.Status AS status, c.Type AS type, " +
      " c.Spoke_Center_Segment AS segment, c.HubID AS hub_id, c.HubName AS hub, c.City AS city, " +
      " c.State AS state, c.PinCode AS pin, CAST(c.deploymentdate AS STRING) AS deployed, " +
      " CAST(c.deactivationdate AS STRING) AS deactivated, " +
      " COUNT(*) OVER() AS total_rows " +
      "FROM c ORDER BY c.CenterID LIMIT " + pageSize + " OFFSET " + (page * pageSize);
    var rows = runQuery(sql);
    var total = rows.length ? rows[0].total_rows : 0;
    rows.forEach(function (r) { delete r.total_rows; });
    // devices = Jira fleet count per center, not cloud_devices — per user,
    // 2026-08-19: devices means Jira everywhere except the CDM page. Built in
    // JS (not a SQL join, since jira_data has no CenterID — see
    // deviceCenterMap_) from the cached asset index, so this only costs a
    // cache read per page-turn, not a fresh BigQuery scan.
    var jiraCountByCenter = {};
    getAssetIndex_().forEach(function (a) {
      if (a.center_id != null) jiraCountByCenter[a.center_id] = (jiraCountByCenter[a.center_id] || 0) + 1;
    });
    rows.forEach(function (r) { r.devices = jiraCountByCenter[r.center_id] || 0; });
    return { rows: rows, totalRows: total, page: page, pageSize: pageSize };
  });
}
