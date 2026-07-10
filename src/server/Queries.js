/**
 * Queries.js — every SQL statement in the app, in one reviewable place.
 *
 * Conventions:
 *  - T() qualifies table names with the configured dataset.
 *  - All statements aggregate server-side; raw rows never ship to the client
 *    except the paginated Device / Center explorers.
 *  - @hub is a named parameter on fleet/support queries; empty string = all.
 *  - Zoho date strings are parsed with SAFE.PARSE_DATETIME so malformed rows
 *    become NULL instead of failing the query.
 *  - Grain rules (docs/SOURCES.md): COUNT DISTINCT on fanned sources,
 *    AVG/MAX on device_metrics, ratio-of-sums for rates.
 *
 * "Views": joined, reusable queries live here as named builders — the service
 * account is read-only, so we express views as SQL-in-git rather than
 * CREATE VIEW in BigQuery. See buildCenterExplorerQuery (Center-360).
 */

/** @param {string} table @return {string} fully-qualified, backticked name */
function T(table) {
  return '`' + CONFIG.BQ_DATASET + '.' + table + '`';
}

/**
 * WHERE fragment restricting jira_data rows to real fleet devices
 * (CONFIG.JIRA_DEVICE_TYPES: Connector + ECG Machine) — the same permanent
 * filter jiraDeviceStats_ applies to the Jira Sheet. Lazy for load order.
 * @return {string}
 */
function jiraTypeFilterSql_() {
  var list = CONFIG.JIRA_DEVICE_TYPES.map(function (t) {
    return "'" + String(t).toLowerCase().replace(/'/g, "\\'") + "'";
  }).join(', ');
  return "LOWER(TRIM(IFNULL(issuetype_name, ''))) IN (" + list + ")";
}

/**
 * LastTimeStamp is IST wall-time (see CONFIG.IST_OFFSET_MINUTES), so "now"
 * for heartbeat-recency comparisons must also be IST.
 * Functions (not top-level consts) because Apps Script executes files
 * alphabetically — top-level CONFIG references would break on load order.
 * @return {string}
 */
function nowIstSql_() {
  return 'TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL ' + CONFIG.IST_OFFSET_MINUTES + ' MINUTE)';
}

/** Shared CASE expression that buckets a device by heartbeat recency. */
function fleetBucketSql_() {
  var NOW_IST_SQL = nowIstSql_();
  return "CASE " +
    "WHEN LastTimeStamp IS NULL OR LastTimeStamp < TIMESTAMP('2000-01-01') THEN 'Never seen' " +
    "WHEN LastTimeStamp >= TIMESTAMP_SUB(" + NOW_IST_SQL + ", INTERVAL 1 HOUR) THEN 'Live (<1h)' " +
    "WHEN LastTimeStamp >= TIMESTAMP_SUB(" + NOW_IST_SQL + ", INTERVAL 24 HOUR) THEN 'Online (<24h)' " +
    "WHEN LastTimeStamp >= TIMESTAMP_SUB(" + NOW_IST_SQL + ", INTERVAL 7 DAY) THEN 'Idle (1-7d)' " +
    "WHEN LastTimeStamp >= TIMESTAMP_SUB(" + NOW_IST_SQL + ", INTERVAL 30 DAY) THEN 'Offline (7-30d)' " +
    "ELSE 'Dark (>30d)' END";
}

/** WHERE fragment honouring the optional hub filter. */
var HUB_FILTER_SQL = "(@hub = '' OR HubName = @hub)";

/* ── Segment filter helpers (page-level Segment dropdown, 2026-07-10) ──
 * The segment value is user input → sanitize before inlining as a SQL literal.
 * hub_master_segment exists on BOTH center_details and zoho_data, so cdSegCond_
 * works for either table; cloud_devices has no segment → devSegCond_ bridges
 * via CenterID against the baseline-filtered center universe. */
function segClean_(segment) {
  return String(segment || '').slice(0, 80).replace(/['"\\]/g, '');
}
function segSlug_(segment) {
  var s = segClean_(segment).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'all';
}
function cdSegCond_(segment) {
  var s = segClean_(segment);
  return s ? " AND TRIM(IFNULL(hub_master_segment,'')) = '" + s + "'" : '';
}
function devSegCond_(segment) {
  var s = segClean_(segment);
  if (!s) return '';
  return " AND CenterID IN (SELECT DISTINCT CenterID FROM " + T('center_details') +
    " WHERE " + cdFilter_() + cdSegCond_(segment) + ")";
}

/**
 * Canonical Machine Uptime % (M-A1) + MTBF (M-A2) + Health Score (M-A6) at
 * CENTER grain, from sandbox data (ServiceWRK pending). Downtime = UNION of
 * merged device-failure ticket intervals [CreatedAt, ClosedAt|NOW] (overlaps
 * once); birth = earliest deployment; life = NOW − birth.
 *   uptime% = (life − downtime)/life × 100  (clamped 0–100)
 *   mtbf_hrs = uptime_hrs / failures  (NULL when failures < 2, per M-A2)
 *   health  = 0.5×uptime% + Tier_MTBF + Tier_Failures  (0–100, per M-A6)
 * ALL deployed centers are scored (no-failure center → 100% up, health ~100).
 * @param {string} tailSelect a SELECT over the final `scored` CTE
 * @return {string} full SQL
 */
function centerUptimeSql_(tailSelect) {
  var f = CONFIG.ZOHO_DT_FORMAT;
  var P = "SAFE.PARSE_DATETIME('" + f + "', ";
  return "WITH tix AS (" +
    " SELECT CenterID AS center_id, " + P + "CreatedAt) AS s, " +
    "  COALESCE(" + P + "ClosedAt), CURRENT_DATETIME()) AS e " +
    " FROM " + T('zoho_data') + " WHERE CenterID IS NOT NULL " +
    "  AND " + techBoolSql_("IFNULL(IssueCategory,'')") + " " +
    "  AND " + P + "CreatedAt) IS NOT NULL), " +
    "birth AS (SELECT centerid AS center_id, MIN(startdatetime) AS b " +
    "  FROM " + T('device_center_mapping') + " WHERE startdatetime IS NOT NULL GROUP BY centerid), " +
    "flagged AS (SELECT center_id, s, e, " +
    "  MAX(e) OVER (PARTITION BY center_id ORDER BY s ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS pe FROM tix), " +
    "islands AS (SELECT center_id, s, e, " +
    "  COUNTIF(pe IS NULL OR s > pe) OVER (PARTITION BY center_id ORDER BY s ROWS UNBOUNDED PRECEDING) AS grp FROM flagged), " +
    "dt AS (SELECT center_id, SUM(DATETIME_DIFF(se, ss, HOUR)) AS downtime_hrs " +
    "  FROM (SELECT center_id, grp, MIN(s) ss, MAX(e) se FROM islands GROUP BY center_id, grp) GROUP BY center_id), " +
    "fail AS (SELECT center_id, COUNT(*) AS failures FROM tix GROUP BY center_id), " +
    "base AS (SELECT b.center_id, " +
    "  DATETIME_DIFF(CURRENT_DATETIME(), b.b, HOUR) AS life_hrs, " +
    "  IFNULL(dt.downtime_hrs, 0) AS downtime_hrs, IFNULL(fail.failures, 0) AS failures " +
    "  FROM birth b LEFT JOIN dt USING (center_id) LEFT JOIN fail USING (center_id) WHERE b.b IS NOT NULL), " +
    "calc AS (SELECT center_id, life_hrs, downtime_hrs, failures, " +
    "  ROUND(GREATEST(0, LEAST(100, (life_hrs - downtime_hrs) / NULLIF(life_hrs, 0) * 100)), 2) AS uptime_pct, " +
    "  CASE WHEN failures >= 2 THEN ROUND(GREATEST(0, life_hrs - downtime_hrs) / failures, 1) ELSE NULL END AS mtbf_hrs " +
    "  FROM base), " +
    "scored AS (SELECT *, " +
    "  ROUND(0.5 * uptime_pct " +
    "   + CASE WHEN failures = 0 THEN 30 WHEN failures = 1 THEN 20 " +
    "          WHEN mtbf_hrs > 720 THEN 30 WHEN mtbf_hrs >= 168 THEN 20 ELSE 5 END " +
    "   + CASE WHEN failures = 0 THEN 20 WHEN failures <= 2 THEN 15 WHEN failures <= 5 THEN 10 ELSE 5 END, 0) AS health_score " +
    "  FROM calc) " +
    tailSelect;
}

/**
 * Batch-cohort failure analysis — First-Time-Failure (M-A3) + Batch Failure
 * Detection (M-A5), keyed on device production "batch" = YEAR of first Jira
 * appearance. One device = one distinct serial parsed from jira_data.summary;
 * birth = MIN(ticket_created); its center = jira_data.customerid (= CenterID).
 * Failure signal = device-failure Zoho tickets at that center (CENTER grain,
 * cohort-approximate — the TRD's ServiceWRK device-grain source is not in the
 * sandbox). Per batch year we return:
 *   devices          — cohort size (distinct serials born that year)
 *   ftf_rate_pct     — % of cohort whose center ever had a failure (M-A3)
 *   median_ttff_days — median time from birth to first failure (M-A3)
 *   early_fails      — count with first failure < 7 days (early-life / DOA)
 *   avg_failures     — mean device-failure tickets per device (M-A5 intensity)
 *   top_issue        — most frequent failure IssueCategory for the cohort (M-A5)
 * @return {string} full SQL, ordered oldest→newest batch
 */
function cohortReliabilitySql_() {
  var f = CONFIG.ZOHO_DT_FORMAT;
  var P = "SAFE.PARSE_DATETIME('" + f + "', ";
  var SERIAL = "UPPER(REGEXP_EXTRACT(summary, r'([A-Za-z0-9]{2}-[A-Za-z0-9]{6,})'))";
  return "WITH dev AS (" +
    " SELECT " + SERIAL + " AS serial, MIN(ticket_created) AS birth, " +
    "  ANY_VALUE(SAFE_CAST(customerid AS INT64)) AS center_id " +
    " FROM " + T('jira_data') + " WHERE REGEXP_CONTAINS(summary, r'[A-Za-z0-9]{2}-[A-Za-z0-9]{6,}') " +
    "  AND " + jiraTypeFilterSql_() + " " +   // fleet devices only (Connector + ECG Machine)
    " GROUP BY serial), " +
    "ftix AS (" +
    " SELECT CenterID AS center_id, " + P + "CreatedAt) AS created, IssueCategory " +
    " FROM " + T('zoho_data') + " WHERE CenterID IS NOT NULL " +
    "  AND " + techBoolSql_("IFNULL(IssueCategory,'')") + " " +
    "  AND " + P + "CreatedAt) IS NOT NULL), " +
    "fail AS (SELECT center_id, MIN(created) AS first_fail, COUNT(*) AS n_fail FROM ftix GROUP BY center_id), " +
    "pd AS (SELECT d.serial, EXTRACT(YEAR FROM d.birth) AS batch_year, d.center_id, " +
    "  (f.first_fail IS NOT NULL) AS ever_failed, IFNULL(f.n_fail, 0) AS n_fail, " +
    "  CASE WHEN f.first_fail > DATETIME(d.birth) THEN DATETIME_DIFF(f.first_fail, DATETIME(d.birth), DAY) END AS ttff_days " +
    "  FROM dev d LEFT JOIN fail f ON d.center_id = f.center_id WHERE d.birth IS NOT NULL), " +
    "cohort AS (SELECT batch_year, COUNT(*) AS devices, " +
    "  ROUND(COUNTIF(ever_failed) / COUNT(*) * 100, 1) AS ftf_rate_pct, " +
    "  ROUND(APPROX_QUANTILES(ttff_days, 2)[OFFSET(1)], 0) AS median_ttff_days, " +
    "  COUNTIF(ttff_days IS NOT NULL AND ttff_days < 7) AS early_fails, " +
    "  ROUND(AVG(n_fail), 2) AS avg_failures FROM pd GROUP BY batch_year), " +
    "issue_rank AS (SELECT batch_year, IssueCategory, " +
    "  ROW_NUMBER() OVER (PARTITION BY batch_year ORDER BY COUNT(*) DESC) AS rn " +
    "  FROM pd JOIN ftix USING (center_id) GROUP BY batch_year, IssueCategory), " +
    "top_issue AS (SELECT batch_year, IssueCategory AS top_issue FROM issue_rank WHERE rn = 1) " +
    "SELECT c.batch_year, c.devices, c.ftf_rate_pct, c.median_ttff_days, c.early_fails, " +
    " c.avg_failures, t.top_issue " +
    "FROM cohort c LEFT JOIN top_issue t USING (batch_year) ORDER BY c.batch_year";
}

/** Zoho stringly-typed datetime parser fragments. */
function zohoParsedDates_() {
  return "SAFE.PARSE_DATETIME('" + CONFIG.ZOHO_DT_FORMAT + "', CreatedAt) AS created, " +
         "SAFE.PARSE_DATETIME('" + CONFIG.ZOHO_DT_FORMAT + "', ClosedAt) AS closed";
}

/**
 * The full parallel batch behind the main dashboard payload — one entry per
 * chart/KPI block across the three views (Asset / Centers / Support).
 * @param {string} hub '' for all hubs
 * @return {Array<{key:string, sql:string, params:Object}>}
 */
function buildDashboardQuerySpecs(hub, segment) {
  var p = { hub: hub || '' };
  var NOW_IST_SQL = nowIstSql_();
  var FLEET_BUCKET_SQL = fleetBucketSql_();
  var segZ = cdSegCond_(segment);
  var segD = devSegCond_(segment);

  return [

    /* ═══════════ ASSET VIEW — fleet health, hardware, reliability ═══════ */
    {
      key: 'kpis',
      params: p,
      sql:
        "WITH d AS (SELECT LastTimeStamp, " +
        " SAFE_CAST(BatteryLevel AS INT64) AS batt, " +
        " UPPER(IFNULL(BatteryLevel,'')) = 'CHARGING' AS charging, " +
        " SAFE_CAST(CSQ AS INT64) AS csq, " +
        " SAFE_CAST(UnsyncedData AS INT64) AS unsynced " +
        " FROM " + T('cloud_devices') + " WHERE " + HUB_FILTER_SQL + segD + ") " +
        "SELECT COUNT(*) AS total_devices, " +
        " COUNTIF(LastTimeStamp >= TIMESTAMP_SUB(" + NOW_IST_SQL + ", INTERVAL " + CONFIG.ONLINE_WINDOW_HOURS + " HOUR)) AS online_24h, " +
        " COUNTIF(LastTimeStamp >= TIMESTAMP_SUB(" + NOW_IST_SQL + ", INTERVAL 1 HOUR)) AS live_1h, " +
        " COUNTIF(LastTimeStamp IS NULL OR LastTimeStamp < TIMESTAMP_SUB(" + NOW_IST_SQL + ", INTERVAL 7 DAY)) AS offline_7d, " +
        " COUNTIF(batt IS NOT NULL AND batt < 20) AS low_battery, " +
        " COUNTIF(charging) AS charging_now, " +
        " COUNTIF(csq IS NOT NULL AND csq < 10) AS poor_signal, " +
        " ROUND(AVG(csq), 1) AS avg_csq, " +
        " SUM(IFNULL(unsynced, 0)) AS unsynced_total, " +
        " CAST(MAX(LastTimeStamp) AS STRING) AS latest_heartbeat " +
        "FROM d"
    },
    {
      key: 'fleetStatus',
      params: p,
      sql:
        "SELECT " + FLEET_BUCKET_SQL + " AS status, COUNT(*) AS cnt " +
        "FROM " + T('cloud_devices') + " WHERE " + HUB_FILTER_SQL + segD + " " +
        "GROUP BY status"
    },
    {
      key: 'firmware',
      params: p,
      sql:
        "SELECT IFNULL(NULLIF(TRIM(FirmwareName), ''), 'Unknown') AS firmware, COUNT(*) AS devices " +
        "FROM " + T('cloud_devices') + " " +
        "WHERE " + HUB_FILTER_SQL + segD + " AND LastTimeStamp >= TIMESTAMP_SUB(" + NOW_IST_SQL + ", INTERVAL 30 DAY) " +
        "GROUP BY firmware ORDER BY devices DESC LIMIT 8"
    },
    {
      key: 'assets',
      sql:
        // Permanent fleet-device filter (Connector + ECG Machine only).
        "SELECT 'status' AS dim, status_name AS label, COUNT(DISTINCT issue_key) AS cnt " +
        "FROM " + T('jira_data') + " WHERE " + jiraTypeFilterSql_() + " GROUP BY label " +
        "UNION ALL " +
        "SELECT 'type' AS dim, issuetype_name AS label, COUNT(DISTINCT issue_key) AS cnt " +
        "FROM " + T('jira_data') + " WHERE " + jiraTypeFilterSql_() + " GROUP BY label " +
        "ORDER BY dim, cnt DESC"
    },
    {
      // Reliability watchlist = canonical Machine Uptime % (TRD M-A1), worst
      // (lowest-uptime) centers first. center name + devices added in Api.js.
      key: 'reliability',
      sql: centerUptimeSql_(
        "SELECT center_id AS centerid, uptime_pct, " +
        " ROUND(100 - uptime_pct, 1) AS downtime_pct, failures, " +
        " ROUND(life_hrs / 24.0, 0) AS life_days " +
        "FROM scored ORDER BY uptime_pct ASC LIMIT 12")
    },
    {
      // Fleet-wide North-Star: uptime, MTBF and health-score rollups.
      key: 'uptimeFleet',
      sql: centerUptimeSql_(
        "SELECT COUNT(*) AS scored, ROUND(AVG(uptime_pct), 1) AS avg_uptime, " +
        " ROUND(COUNTIF(uptime_pct >= 99) / NULLIF(COUNT(*), 0) * 100, 1) AS pct99, " +
        " ROUND(AVG(mtbf_hrs) / 24, 1) AS avg_mtbf_days, " +
        " ROUND(AVG(health_score), 1) AS avg_health, " +
        " ROUND(COUNTIF(health_score >= 80) / NULLIF(COUNT(*), 0) * 100, 1) AS pct_healthy " +
        "FROM scored")
    },
    {
      // Asset Health watchlist (M-A6): lowest-health centers first.
      key: 'assetHealth',
      sql: centerUptimeSql_(
        "SELECT center_id AS centerid, uptime_pct, mtbf_hrs, failures, health_score " +
        "FROM scored ORDER BY health_score ASC LIMIT 12")
    },
    {
      // Batch-cohort failure analysis: First-Time-Failure (M-A3) + Batch
      // Failure Detection (M-A5), one row per device production year.
      key: 'cohortReliability',
      sql: cohortReliabilitySql_()
    },

    /* ═══════════ CENTERS / CUSTOMERS VIEW — geography & deployments ═════ */
    {
      key: 'centerKpis',
      sql:
        "WITH latest AS (SELECT deviceid, centerid, state, city, " +
        " (enddatetime IS NULL) AS active, " +
        " ROW_NUMBER() OVER (PARTITION BY deviceid ORDER BY startdatetime DESC) AS rn " +
        " FROM " + T('device_center_mapping') + ") " +
        "SELECT COUNT(DISTINCT centerid) AS centers, COUNT(*) AS devices, " +
        " COUNT(DISTINCT NULLIF(TRIM(state), '')) AS states, " +
        " COUNT(DISTINCT NULLIF(TRIM(city), '')) AS cities, " +
        " COUNTIF(active) AS active_deployments " +
        "FROM latest WHERE rn = 1"
    },
    {
      key: 'geo',
      sql:
        "WITH latest AS (SELECT deviceid, state, " +
        " ROW_NUMBER() OVER (PARTITION BY deviceid ORDER BY startdatetime DESC) AS rn " +
        " FROM " + T('device_center_mapping') + ") " +
        "SELECT IFNULL(NULLIF(TRIM(state), ''), 'Unknown') AS state, COUNT(*) AS devices " +
        "FROM latest WHERE rn = 1 GROUP BY state ORDER BY devices DESC LIMIT 12"
    },
    {
      key: 'hubs',
      params: p,
      sql:
        "SELECT IFNULL(NULLIF(TRIM(HubName), ''), 'Unassigned') AS hub, COUNT(*) AS devices, " +
        " COUNTIF(LastTimeStamp >= TIMESTAMP_SUB(" + NOW_IST_SQL + ", INTERVAL " + CONFIG.ONLINE_WINDOW_HOURS + " HOUR)) AS online " +
        "FROM " + T('cloud_devices') + " WHERE " + HUB_FILTER_SQL + " " +
        "GROUP BY hub ORDER BY devices DESC LIMIT 12"
    },
    {
      key: 'deploymentAge',
      sql:
        "WITH active AS (SELECT deviceid, " +
        " DATETIME_DIFF(CURRENT_DATETIME(), startdatetime, DAY) AS age_days, " +
        " ROW_NUMBER() OVER (PARTITION BY deviceid ORDER BY startdatetime DESC) AS rn " +
        " FROM " + T('device_center_mapping') + " WHERE enddatetime IS NULL) " +
        "SELECT CASE " +
        " WHEN age_days < 90 THEN '<3 mo' " +
        " WHEN age_days < 180 THEN '3-6 mo' " +
        " WHEN age_days < 365 THEN '6-12 mo' " +
        " WHEN age_days < 730 THEN '1-2 yr' " +
        " ELSE '2+ yr' END AS band, COUNT(*) AS devices " +
        "FROM active WHERE rn = 1 GROUP BY band"
    },
    {
      key: 'activeVsEnded',
      sql:
        "SELECT IF(enddatetime IS NULL OR enddatetime > CURRENT_DATETIME(), 'Active', 'Ended') AS status, " +
        " COUNT(DISTINCT deviceid) AS devices " +
        "FROM " + T('device_center_mapping') + " GROUP BY status"
    },

    /* ═══════════ SUPPORT / CS VIEW — Zoho ticket analytics ══════════════ */
    {
      key: 'zohoKpis',
      params: p,
      sql:
        "WITH t AS (SELECT status, TicketActiveDays, " + zohoParsedDates_() + " " +
        " FROM " + T('zoho_data') + " WHERE " + HUB_FILTER_SQL + segZ + ") " +
        "SELECT " +
        " COUNT(*) AS total_tickets, " +
        " COUNTIF(status NOT IN " + CONFIG.ZOHO_TERMINAL_STATUSES + ") AS open_tickets, " +
        " COUNTIF(created >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 7 DAY)) AS created_7d, " +
        " COUNTIF(closed >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 7 DAY)) AS closed_7d, " +
        " ROUND(AVG(IF(status NOT IN " + CONFIG.ZOHO_TERMINAL_STATUSES + ", TicketActiveDays, NULL)), 1) AS avg_open_age_days " +
        "FROM t"
    },
    {
      // SLA compliance (CS-team catalog): resolved-within-target %, Tech vs
      // Non-Tech split, and breached / at-risk open tickets vs per-type SLA.
      key: 'slaKpis',
      params: p,
      sql:
        "WITH t AS (SELECT status, " + slaDaysCaseSql_("IFNULL(IssueCategory,'')") + " AS sla_days, " +
        techBoolSql_("IFNULL(IssueCategory,'')") + " AS is_tech, " + zohoParsedDates_() + " " +
        " FROM " + T('zoho_data') + " WHERE " + HUB_FILTER_SQL + segZ + "), " +
        "s AS (SELECT sla_days, is_tech, " +
        " (status = 'Closed' AND created IS NOT NULL AND closed IS NOT NULL) AS resolved, " +
        " CASE WHEN status = 'Closed' AND created IS NOT NULL AND closed IS NOT NULL " +
        "   THEN DATETIME_DIFF(closed, created, HOUR) / 24.0 END AS res_days, " +
        " (status NOT IN " + CONFIG.ZOHO_TERMINAL_STATUSES + ") AS is_open, " +
        " CASE WHEN created IS NOT NULL THEN DATETIME_DIFF(CURRENT_DATETIME(), created, HOUR) / 24.0 END AS age_days " +
        " FROM t) " +
        "SELECT COUNTIF(resolved) AS resolved_n, " +
        " ROUND(COUNTIF(resolved AND res_days <= sla_days) / NULLIF(COUNTIF(resolved), 0) * 100, 1) AS within_pct, " +
        " ROUND(COUNTIF(is_tech AND resolved AND res_days <= sla_days) / NULLIF(COUNTIF(is_tech AND resolved), 0) * 100, 1) AS within_tech, " +
        " ROUND(COUNTIF(NOT is_tech AND resolved AND res_days <= sla_days) / NULLIF(COUNTIF(NOT is_tech AND resolved), 0) * 100, 1) AS within_nontech, " +
        " COUNTIF(is_open AND age_days > sla_days) AS breached_open, " +
        " COUNTIF(is_open AND age_days <= sla_days AND age_days > 0.75 * sla_days) AS atrisk_open, " +
        " ROUND(AVG(IF(resolved, res_days, NULL)), 1) AS avg_res_days " +
        "FROM s"
    },
    {
      // Worst issue types by SLA breach rate (min 20 resolved for signal).
      key: 'slaByType',
      params: p,
      sql:
        "WITH t AS (SELECT IFNULL(NULLIF(TRIM(IssueCategory), ''), 'Uncategorised') AS category, status, " +
        slaDaysCaseSql_("IFNULL(IssueCategory,'')") + " AS sla_days, " + techBoolSql_("IFNULL(IssueCategory,'')") + " AS is_tech, " +
        zohoParsedDates_() + " FROM " + T('zoho_data') + " WHERE " + HUB_FILTER_SQL + segZ + "), " +
        "s AS (SELECT category, sla_days, is_tech, " +
        " (status = 'Closed' AND created IS NOT NULL AND closed IS NOT NULL) AS resolved, " +
        " CASE WHEN status = 'Closed' AND created IS NOT NULL AND closed IS NOT NULL " +
        "   THEN DATETIME_DIFF(closed, created, HOUR) / 24.0 END AS res_days " +
        " FROM t) " +
        "SELECT category, ANY_VALUE(sla_days) AS sla_days, ANY_VALUE(is_tech) AS is_tech, " +
        " COUNT(*) AS tickets, COUNTIF(resolved) AS resolved_n, " +
        " ROUND(COUNTIF(resolved AND res_days > sla_days) / NULLIF(COUNTIF(resolved), 0) * 100, 1) AS breach_pct, " +
        " ROUND(AVG(IF(resolved, res_days, NULL)), 1) AS avg_res_days " +
        "FROM s GROUP BY category HAVING resolved_n >= 20 ORDER BY breach_pct DESC, tickets DESC LIMIT 15"
    },
    {
      key: 'zohoTrend',
      params: p,
      sql:
        "WITH t AS (SELECT " + zohoParsedDates_() + " FROM " + T('zoho_data') + " WHERE " + HUB_FILTER_SQL + segZ + ") " +
        "SELECT month, SUM(created_n) AS created, SUM(closed_n) AS closed FROM (" +
        " SELECT FORMAT_DATETIME('%Y-%m', created) AS month, COUNT(*) AS created_n, 0 AS closed_n " +
        "  FROM t WHERE created >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 12 MONTH) GROUP BY month " +
        " UNION ALL " +
        " SELECT FORMAT_DATETIME('%Y-%m', closed), 0, COUNT(*) " +
        "  FROM t WHERE closed >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 12 MONTH) GROUP BY 1" +
        ") GROUP BY month ORDER BY month"
    },
    {
      key: 'zohoOpenByStatus',
      params: p,
      sql:
        "SELECT status, COUNT(*) AS cnt FROM " + T('zoho_data') + " " +
        "WHERE " + HUB_FILTER_SQL + segZ + " AND status NOT IN " + CONFIG.ZOHO_TERMINAL_STATUSES + " " +
        "GROUP BY status ORDER BY cnt DESC LIMIT 10"
    },
    {
      key: 'zohoCategories',
      params: p,
      sql:
        "WITH t AS (SELECT IssueCategory, HubName, hub_master_segment, " +
        " SAFE.PARSE_DATETIME('" + CONFIG.ZOHO_DT_FORMAT + "', CreatedAt) AS created " +
        " FROM " + T('zoho_data') + ") " +
        "SELECT IFNULL(NULLIF(TRIM(IssueCategory), ''), 'Uncategorised') AS category, COUNT(*) AS cnt " +
        "FROM t WHERE " + HUB_FILTER_SQL + segZ + " AND created >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 90 DAY) " +
        "GROUP BY category ORDER BY cnt DESC LIMIT 10"
    },
    {
      key: 'zohoPriority',
      params: p,
      sql:
        "WITH t AS (SELECT priority, HubName, hub_master_segment, " +
        " SAFE.PARSE_DATETIME('" + CONFIG.ZOHO_DT_FORMAT + "', CreatedAt) AS created " +
        " FROM " + T('zoho_data') + ") " +
        "SELECT IFNULL(NULLIF(TRIM(priority), ''), 'Unset') AS priority, COUNT(*) AS cnt " +
        "FROM t WHERE " + HUB_FILTER_SQL + segZ + " AND created >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 90 DAY) " +
        "GROUP BY priority ORDER BY cnt DESC LIMIT 6"
    },
    {
      key: 'zohoChannel',
      params: p,
      sql:
        "WITH t AS (SELECT Channel, HubName, hub_master_segment, " +
        " SAFE.PARSE_DATETIME('" + CONFIG.ZOHO_DT_FORMAT + "', CreatedAt) AS created " +
        " FROM " + T('zoho_data') + ") " +
        "SELECT IFNULL(NULLIF(TRIM(Channel), ''), 'Unknown') AS channel, COUNT(*) AS cnt " +
        "FROM t WHERE " + HUB_FILTER_SQL + segZ + " AND created >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 90 DAY) " +
        "GROUP BY channel ORDER BY cnt DESC LIMIT 8"
    },
    {
      key: 'zohoSegment',
      params: p,
      sql:
        "WITH t AS (SELECT hub_master_segment, HubName, " +
        " SAFE.PARSE_DATETIME('" + CONFIG.ZOHO_DT_FORMAT + "', CreatedAt) AS created " +
        " FROM " + T('zoho_data') + ") " +
        "SELECT IFNULL(NULLIF(TRIM(hub_master_segment), ''), 'Unknown') AS segment, COUNT(*) AS cnt " +
        "FROM t WHERE " + HUB_FILTER_SQL + segZ + " AND created >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 90 DAY) " +
        "GROUP BY segment ORDER BY cnt DESC LIMIT 8"
    },

    /* ═══════════ SHARED ═════════════════════════════════════════════════ */
    {
      key: 'hubOptions',
      sql:
        "SELECT HubName AS hub, COUNT(*) AS devices FROM " + T('cloud_devices') + " " +
        "WHERE TRIM(IFNULL(HubName, '')) != '' " +
        "GROUP BY hub ORDER BY devices DESC LIMIT 300"
    }
  ];
}

/* ═════════════════ Device explorer (Asset view) ═════════════════════════ */

/** Sortable columns — whitelist against injection. */
var DEVICE_SORT_COLUMNS = {
  device: 'DeviceID',
  center: 'Centername',
  hub: 'HubName',
  last_seen: 'LastTimeStamp',
  battery: 'SAFE_CAST(BatteryLevel AS INT64)',
  csq: 'SAFE_CAST(CSQ AS INT64)',
  unsynced: 'SAFE_CAST(UnsyncedData AS INT64)'
};

/**
 * Paginated, filterable device explorer query.
 * @param {{search:string, hub:string, status:string, sortBy:string,
 *          sortDir:string, page:number, pageSize:number}} opts sanitised by Api.js
 * @return {{sql:string, params:Object}}
 */
function buildDeviceExplorerQuery(opts) {
  var FLEET_BUCKET_SQL = fleetBucketSql_();
  var sortCol = DEVICE_SORT_COLUMNS[opts.sortBy] || 'LastTimeStamp';
  var sortDir = opts.sortDir === 'asc' ? 'ASC' : 'DESC';
  var sql =
    "WITH d AS (SELECT DeviceID, Centername, HubName, LastTimeStamp, " +
    " BatteryLevel, CSQ, UnsyncedData, SpaceAvailable, FirmwareName, ServiceProvider, " +
    " " + FLEET_BUCKET_SQL + " AS status_bucket " +
    " FROM " + T('cloud_devices') + ") " +
    "SELECT DeviceID AS device, IFNULL(Centername,'') AS center, IFNULL(HubName,'') AS hub, " +
    " CAST(LastTimeStamp AS STRING) AS last_seen, " +
    " IFNULL(BatteryLevel,'') AS battery, SAFE_CAST(CSQ AS INT64) AS csq, " +
    " SAFE_CAST(UnsyncedData AS INT64) AS unsynced, IFNULL(FirmwareName,'') AS firmware, " +
    " IFNULL(ServiceProvider,'') AS provider, status_bucket AS status, " +
    " COUNT(*) OVER() AS total_rows " +
    "FROM d " +
    "WHERE (@hub = '' OR HubName = @hub) " +
    " AND (@status = '' OR status_bucket = @status) " +
    " AND (@search = '' OR LOWER(DeviceID) LIKE @like " +
    "      OR LOWER(IFNULL(Centername,'')) LIKE @like " +
    "      OR LOWER(IFNULL(HubName,'')) LIKE @like) " +
    "ORDER BY " + sortCol + " " + sortDir + " " +
    "LIMIT @limit OFFSET @offset";
  return {
    sql: sql,
    params: {
      hub: opts.hub,
      status: opts.status,
      search: opts.search,
      like: '%' + opts.search + '%',
      limit: opts.pageSize,
      offset: opts.page * opts.pageSize
    }
  };
}

/* ═══════════ Center-360 sources (Centers view) — joined in Apps Script ══ */

/**
 * Three SINGLE-TABLE aggregate reads, one row per CenterID each.
 * They are hash-joined in Apps Script (Api.js + Join.js) — no SQL JOINs.
 * Each side is pre-aggregated so the join keys are unique and the payloads
 * stay small (~5k rows per source, paged via spec.maxRows).
 * @return {Array<{key:string, sql:string, maxRows:number}>}
 */
function buildCenterSourceSpecs() {
  var NOW_IST_SQL = nowIstSql_();
  return [
    {
      // ANCHOR: the authoritative center + address dimension (~11.3k centers).
      // Every center with a deployment history lives here, including those
      // with no currently-reporting device. One row per center = latest
      // deployment's name/hub/address.
      key: 'centerBase',
      maxRows: 50000,
      sql:
        "SELECT centerid AS center_id, CenterName AS center, hubid AS hub_id, " +
        " hubname AS hub, city, state, pin, country FROM ( " +
        " SELECT centerid, CenterName, hubid, hubname, city, state, pin, country, " +
        "  ROW_NUMBER() OVER (PARTITION BY centerid ORDER BY startdatetime DESC) AS rn " +
        " FROM " + T('device_center_mapping') + ") WHERE rn = 1"
    },
    {
      // Live telemetry, present only for the ~4.7k centers with a device now.
      key: 'centerTelemetry',
      maxRows: 60000,
      sql:
        "SELECT CenterID AS center_id, COUNT(*) AS devices, " +
        " COUNTIF(LastTimeStamp >= TIMESTAMP_SUB(" + NOW_IST_SQL + ", INTERVAL " + CONFIG.ONLINE_WINDOW_HOURS + " HOUR)) AS online, " +
        " CAST(MAX(LastTimeStamp) AS STRING) AS last_seen " +
        "FROM " + T('cloud_devices') + " GROUP BY CenterID"
    },
    {
      key: 'centerTickets',
      maxRows: 50000,
      sql:
        // Segment comes from ALL tickets (open filter would drop centers whose
        // tickets are all closed), open_tickets counts only active ones.
        "SELECT CenterID AS center_id, COUNT(*) AS tickets_total, " +
        " COUNTIF(status NOT IN " + CONFIG.ZOHO_TERMINAL_STATUSES + ") AS open_tickets, " +
        " ANY_VALUE(NULLIF(TRIM(hub_master_segment), '')) AS segment " +
        "FROM " + T('zoho_data') + " WHERE CenterID IS NOT NULL " +
        "GROUP BY CenterID"
    }
  ];
}

/* ═══════════ Asset-360 sources (Map view) — joined in Apps Script ═══════ */

/**
 * Jira assets parsed per issue_key, plus the two lookup tables that link a
 * serial or SIM IMSI to a center. All single-table reads; the joins happen
 * in Api.js (getAssetIndex_).
 *
 * summary formats observed in the data:
 *   "Vcardia - B2-c2a6f0d2"  → machine type + Mac serial
 *   "H4-F79C6E22"            → bare device/serial id
 *   "IMSI-404453402490237"   → SIM card (joins via cloud_devices.IMSI)
 * @return {Array<{key:string, sql:string, maxRows:number}>}
 */
function buildAssetSourceSpecs() {
  return [
    {
      key: 'jiraAssets',
      maxRows: 80000,
      sql:
        "WITH a AS (SELECT issue_key, ANY_VALUE(summary) AS summary, " +
        " ANY_VALUE(issuetype_name) AS category, " +
        " CAST(DATE(MIN(ticket_created)) AS STRING) AS birthday, " +
        " DATE_DIFF(CURRENT_DATE(), DATE(MIN(ticket_created)), DAY) AS age_days " +
        // Permanent fleet-device filter (Connector + ECG Machine only).
        " FROM " + T('jira_data') + " WHERE " + jiraTypeFilterSql_() + " GROUP BY issue_key) " +
        "SELECT issue_key, summary, category, birthday, age_days, " +
        " UPPER(TRIM(REGEXP_EXTRACT(summary, r'([A-Za-z0-9]{2}-[A-Za-z0-9]{8})'))) AS serial, " +
        " REGEXP_EXTRACT(summary, r'^IMSI[- ]*([0-9]{8,})') AS imsi, " +
        " UPPER(COALESCE(NULLIF(TRIM(REGEXP_EXTRACT(summary, r'^([A-Za-z]{3,})')), ''), " +
        "  REGEXP_EXTRACT(summary, r'^([A-Za-z0-9]{2})-'))) AS machine_type " +
        "FROM a"
    },
    {
      key: 'deviceCenters',
      maxRows: 80000,
      sql:
        "SELECT UPPER(deviceid) AS device_key, centerid FROM ( " +
        " SELECT deviceid, centerid, " +
        "  ROW_NUMBER() OVER (PARTITION BY deviceid ORDER BY startdatetime DESC) AS rn " +
        " FROM " + T('device_center_mapping') + ") WHERE rn = 1"
    },
    {
      key: 'imsiCenters',
      maxRows: 80000,
      sql:
        "SELECT UPPER(IMSI) AS imsi, ANY_VALUE(CenterID) AS centerid " +
        "FROM " + T('cloud_devices') + " " +
        "WHERE TRIM(IFNULL(IMSI, '')) != '' GROUP BY imsi"
    }
  ];
}

/**
 * Per-center detail for the map sidebar — three single-table param queries,
 * combined with the asset index in Api.js.
 * @param {number} centerId
 * @return {Array<{key:string, sql:string, params:Object}>}
 */
function buildCenterDetailSpecs(centerId) {
  var p = { cid: centerId };
  return [
    {
      key: 'info',
      params: p,
      sql:
        "SELECT ANY_VALUE(CenterName) AS center, ANY_VALUE(hubid) AS hub_id, " +
        " ANY_VALUE(hubname) AS hub, ANY_VALUE(city) AS city, ANY_VALUE(state) AS state, " +
        " ANY_VALUE(pin) AS pin, ANY_VALUE(country) AS country, " +
        " CAST(DATE(MIN(startdatetime)) AS STRING) AS first_deployment, " +
        " DATE_DIFF(CURRENT_DATE(), DATE(MIN(startdatetime)), MONTH) AS age_months, " +
        " COUNT(DISTINCT deviceid) AS devices_ever " +
        "FROM " + T('device_center_mapping') + " WHERE centerid = @cid"
    },
    {
      key: 'devices',
      params: p,
      sql:
        "SELECT DeviceID AS device, UPPER(IFNULL(IMSI,'')) AS imsi, " +
        " CAST(LastTimeStamp AS STRING) AS last_seen, " +
        " IFNULL(BatteryLevel,'') AS battery, SAFE_CAST(CSQ AS INT64) AS csq, " +
        " " + fleetBucketSql_() + " AS status " +
        "FROM " + T('cloud_devices') + " WHERE CenterID = @cid LIMIT 200"
    },
    {
      key: 'tickets',
      params: p,
      sql:
        "SELECT COUNT(*) AS total_tickets, " +
        " COUNTIF(status NOT IN " + CONFIG.ZOHO_TERMINAL_STATUSES + ") AS open_tickets, " +
        " ANY_VALUE(NULLIF(TRIM(hub_master_segment), '')) AS segment " +
        "FROM " + T('zoho_data') + " WHERE CenterID = @cid"
    },
    {
      key: 'openTickets',
      params: p,
      sql:
        "SELECT ticketNumber AS ticket, status, IFNULL(NULLIF(TRIM(priority),''),'—') AS priority, " +
        " IFNULL(NULLIF(TRIM(subject),''),'(no subject)') AS subject, " +
        " IFNULL(NULLIF(TRIM(IssueCategory),''),'') AS category, " +
        " IFNULL(TicketLink,'') AS link " +
        "FROM " + T('zoho_data') + " " +
        "WHERE CenterID = @cid AND status NOT IN " + CONFIG.ZOHO_TERMINAL_STATUSES + " " +
        "ORDER BY SAFE.PARSE_DATETIME('" + CONFIG.ZOHO_DT_FORMAT + "', CreatedAt) DESC " +
        "LIMIT 25"
    },
    {
      // ALL tickets ever raised by the center (any status), newest first — per
      // user request: the drawer should show the center's full ticket history,
      // not just the open ones.
      key: 'allTickets',
      params: p,
      sql:
        "SELECT ticketNumber AS ticket, status, IFNULL(NULLIF(TRIM(priority),''),'—') AS priority, " +
        " IFNULL(NULLIF(TRIM(subject),''),'(no subject)') AS subject, " +
        " IFNULL(NULLIF(TRIM(IssueCategory),''),'') AS category, " +
        " IFNULL(TicketLink,'') AS link, " +
        " CAST(SAFE.PARSE_DATETIME('" + CONFIG.ZOHO_DT_FORMAT + "', CreatedAt) AS STRING) AS created " +
        "FROM " + T('zoho_data') + " " +
        "WHERE CenterID = @cid " +
        "ORDER BY SAFE.PARSE_DATETIME('" + CONFIG.ZOHO_DT_FORMAT + "', CreatedAt) DESC " +
        "LIMIT 50"
    }
  ];
}
