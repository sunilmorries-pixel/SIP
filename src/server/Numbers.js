/**
 * Numbers.js — the "Numbers" page: counts only (KPIs + small tables) for the
 * sole center source, center_details, plus device (Jira) and ticket (Zoho)
 * totals broken down by status / type.
 *
 * device_center_mapping has been removed as a data source, so this page now
 * reports center_details only. No baseline filter applies (removed 2026-07-22 —
 * see cdFilter_ in EditionCD.js): every number is the full distinct-center
 * universe. Status/segment come from center_details; Devices (Jira) and
 * Tickets (Zoho) are source-independent.
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
 * Fleet/device stats shared by the Numbers page, Asset "Total fleet" and
 * Overview "Devices" KPI. Devices = Jira issues (dedup by Key). A device's
 * serial resolves to a center via deviceCenterMap_ for global-filter matching
 * only (see below) — device→center coverage itself is not surfaced as a stat.
 * Cached.
 * @param {{segments:Array,statuses:Array,states:Array,hubs:Array}=} filters
 * @return {{total,by_status,source,center_source}}
 */
function jiraDeviceStats_(filters) {
  filters = filters || {};
  return withCache('jiradev_v6_' + getCacheEpoch_() + '_' + filterHash_(filters), function () {
    var jiraRows = readJiraData_().filter(function (row) { return isTrackedJiraDeviceType_(row.issuetype_name); });
    // The Jira "Customer ID" column is IGNORED — a device's center comes from
    // its serial (parsed from Summary) via deviceCenterMap_.
    var dcm = deviceCenterMap_();
    var dev2ctr = dcm.map;
    var SERIAL_RE = /([A-Za-z0-9]{2}-[A-Za-z0-9]{6,})/;
    var byIssue = {};
    jiraRows.forEach(function (row) {
      var ik = String(row.issue_key || row.summary || '');
      if (!ik) return;
      if (!byIssue[ik]) {
        var m = SERIAL_RE.exec(String(row.summary || '').toUpperCase());
        var cid = m ? dev2ctr[m[1]] : undefined;
        // Device age = today − Created (assetAgeDays_ in Api.js).
        byIssue[ik] = { status: String(row.status_name || '').trim(),
          cid: (cid == null ? NaN : cid), age: assetAgeDays_(row.ticket_created) };
      }
    });
    // Global filter: keep only devices mapped to a center passing the
    // filter set (center lookup via the cached Center-360 rows). Unmapped
    // devices drop out whenever ANY of Segment/Status/State/Hub is active —
    // by design, matching the existing v5.8 segment-only behavior.
    var hasCenterFilter = (filters.segments || []).length || (filters.statuses || []).length ||
      (filters.states || []).length || (filters.hubs || []).length;
    if (hasCenterFilter) {
      var cfMap = centerFilterMap_();
      Object.keys(byIssue).forEach(function (ik) {
        var o = byIssue[ik];
        if (!isFinite(o.cid) || !centerPassesFilters_(cfMap[o.cid] || {}, filters)) delete byIssue[ik];
      });
    }
    var dTotal = 0, dStatus = {};
    var ageSum = 0, ageN = 0;
    // Age bands (days): <1y / 1-2y / 2-3y / 3-5y / 5y+ (5-yr expected device life).
    var ageBands = { '<1y': 0, '1-2y': 0, '2-3y': 0, '3-5y': 0, '5y+': 0 };
    Object.keys(byIssue).forEach(function (ik) {
      var o = byIssue[ik]; dTotal++;
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
      past_life: ageBands['5y+'],          // devices older than the 5-yr expected life
      age_bands: Object.keys(ageBands).map(function (k) { return { k: k, n: ageBands[k] }; }),
      source: 'jira_data', center_source: dcm.source
    };
  });
}

function apiGetNumbers(options) {
  options = options || {};
  return respond_(function () {
    return withCache('numbers_v4', function () {
      var CD = T('center_details');
      var ZOHO = T('zoho_data');
      var techBool = techBoolSql_("IFNULL(IssueCategory,'')");
      var F = cdFilter_(); // no baseline filter (removed 2026-07-22) — always '1=1'

      var specs = [
        { key: 'centersTot', sql:
          "SELECT COUNT(DISTINCT CenterID) AS total FROM " + CD + " WHERE " + F },
        { key: 'centersStatus', maxRows: 50, sql:
          "SELECT IFNULL(NULLIF(TRIM(Status), ''), '(blank)') AS k, COUNT(DISTINCT CenterID) AS n " +
          "FROM " + CD + " WHERE " + F + " GROUP BY k ORDER BY n DESC" },
        { key: 'centersSegment', maxRows: 50, sql:
          "SELECT " + segmentGroupSql_('hub_master_segment') + " AS k, COUNT(DISTINCT CenterID) AS n " +
          "FROM " + CD + " WHERE " + F + " GROUP BY k ORDER BY n DESC LIMIT 15" },

        { key: 'hubsTot', sql:
          "SELECT COUNT(DISTINCT HubID) AS total FROM " + CD + " WHERE " + F },
        // 2026-07-07 reload removed HubStatus/HubSegment. Nearest equivalents:
        // hubs by the Status of their centers (a hub can appear under several
        // statuses) and by hub_master_segment.
        { key: 'hubsStatus', maxRows: 50, sql:
          "SELECT IFNULL(NULLIF(TRIM(Status), ''), '(blank)') AS k, COUNT(DISTINCT HubID) AS n " +
          "FROM " + CD + " WHERE " + F + " GROUP BY k ORDER BY n DESC" },
        { key: 'hubsSegment', maxRows: 50, sql:
          "SELECT " + segmentGroupSql_('hub_master_segment') + " AS k, COUNT(DISTINCT HubID) AS n " +
          "FROM " + CD + " WHERE " + F + " GROUP BY k ORDER BY n DESC LIMIT 15" },

        // Devices come from jira_data (readJiraData_), aggregated separately below.

        // Tickets = Zoho, total + by status + by Tech/Non-Tech (SLA catalog).
        { key: 'ticketsTot', sql:
          "SELECT COUNT(*) AS total, COUNTIF(is_tech) AS tech, COUNTIF(NOT is_tech) AS nontech " +
          "FROM (SELECT " + techBool + " AS is_tech FROM " + ZOHO + ")" },
        { key: 'ticketsStatus', maxRows: 50, sql:
          "SELECT IFNULL(NULLIF(TRIM(status), ''), '(blank)') AS k, COUNT(*) AS n " +
          "FROM " + ZOHO + " GROUP BY k ORDER BY n DESC LIMIT 15" }
      ];

      var r = runQueriesParallel(specs);
      var centersTot = (r.centersTot && r.centersTot[0]) || {};
      var hubsTot = (r.hubsTot && r.hubsTot[0]) || {};
      var ticketsTot = (r.ticketsTot && r.ticketsTot[0]) || {};

      var devices = jiraDeviceStats_();

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
 * Paginated RAW center_details rows for the Numbers page table (no baseline filter).
 * @param {{page:number, pageSize:number}=} options
 */
function apiGetCenterDetailsRaw(options) {
  options = options || {};
  var page = Math.max(0, parseInt(options.page, 10) || 0);
  var pageSize = Math.min(100, Math.max(5, parseInt(options.pageSize, 10) || 25));
  return respond_(function () {
    var sql =
      "WITH dev AS (SELECT CenterID, COUNT(*) AS devices FROM " + T('cloud_devices') +
      " WHERE CenterID IS NOT NULL GROUP BY CenterID), " +
      // DISTINCT CTE: the 2026-07-07 reload duplicated center rows verbatim —
      // dedupe BEFORE the COUNT(*) OVER() so the pager total is centers, not rows.
      "c AS (SELECT DISTINCT CenterID, Centername, Status, Type, Spoke_Center_Segment, " +
      " HubID, HubName, City, State, PinCode, deploymentdate, deactivationdate " +
      " FROM " + T('center_details') + " WHERE " + cdFilter_() + ") " +
      "SELECT c.CenterID AS center_id, c.Centername AS center, c.Status AS status, c.Type AS type, " +
      " c.Spoke_Center_Segment AS segment, c.HubID AS hub_id, c.HubName AS hub, c.City AS city, " +
      " c.State AS state, c.PinCode AS pin, CAST(c.deploymentdate AS STRING) AS deployed, " +
      " CAST(c.deactivationdate AS STRING) AS deactivated, IFNULL(d.devices, 0) AS devices, " +
      " COUNT(*) OVER() AS total_rows " +
      "FROM c LEFT JOIN dev d ON d.CenterID = c.CenterID " +
      "ORDER BY c.CenterID LIMIT " + pageSize + " OFFSET " + (page * pageSize);
    var rows = runQuery(sql);
    var total = rows.length ? rows[0].total_rows : 0;
    rows.forEach(function (r) { delete r.total_rows; });
    return { rows: rows, totalRows: total, page: page, pageSize: pageSize };
  });
}
