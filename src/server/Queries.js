/**
 * Queries.js — every SQL statement in the app, in one reviewable place.
 *
 * Conventions:
 *  - T() qualifies table names with the configured dataset.
 *  - All statements aggregate server-side; raw rows never ship to the client
 *    except the paginated Device / Center explorers.
 *  - @hub is a named parameter on fleet/support queries; empty string = all.
 *  - zoho_data.CreatedAt/ClosedAt are native DATETIME columns in production
 *    (tricogde-dwh) — used bare, no PARSE_DATETIME. CORRECTED 2026-08-13: an
 *    earlier assumption that they were STRING (format '%d-%b-%Y %I:%M:%S %p')
 *    was only true of the sandbox project (magnaquest-sand-box), which has a
 *    different column type for this table — real schema drift between the
 *    two, not a code bug that was ever actually exercised against prod until
 *    this broke live with "Unable to coerce type DATETIME to expected type
 *    STRING". Every zoho_data query in this file was affected; all fixed in
 *    the same pass. Lesson: this project's local verification harness can
 *    only reach the sandbox (no `bigquery.jobs.create` on tricogde-dwh), so
 *    schema assumptions about the real project must be treated as unverified
 *    until confirmed against a live error or an explicit admin-side check.
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
 * Deduplicated zoho_data — the Zoho→BigQuery sync writes some tickets more
 * than once (confirmed 2026-08-12: ~37 tickets tripled in the sandbox,
 * ticketNumber IS NOT NULL for 100% of rows there), which silently inflates
 * every COUNT(*)/row-list query reading the base table directly. Collapses
 * to one row per ticketNumber (the most-recently-created copy) via QUALIFY,
 * evaluated on a SELECT * so ticketNumber/CreatedAt stay in scope even for
 * callers that only project a narrow column list afterward.
 *
 * Drop-in replacement for T('zoho_data') at every real call site (verified:
 * none of them alias the table or use a `zoho_data.column`-qualified
 * reference, so an unaliased parenthesized subquery substitutes cleanly).
 * Deliberately NOT used by RawData.js's raw browser/export — that page's
 * whole purpose is showing the true unfiltered rows for reconciliation
 * against Zoho itself, duplicates AND unassigned tickets included.
 *
 * Also excludes "Unassigned" tickets (per user, 2026-08-13): rows with no
 * agent in `assignee` (blank or NULL). Applied globally, not just on the
 * Support page — same reasoning as the dedup itself, this is the one choke
 * point every real Zoho read goes through.
 *
 * CreatedAt is a native DATETIME in production — ORDER BY sorts it directly
 * (see the file-header note on the 2026-08-13 STRING-assumption correction).
 * The IFNULL fallback guards against any future NULL ticketNumber row
 * merging with others of the same NULL rather than staying its own row.
 * @return {string}
 */
function zohoDedupSql_() {
  return "(SELECT * FROM " + T('zoho_data') +
    " WHERE NULLIF(TRIM(assignee), '') IS NOT NULL" +
    " QUALIFY ROW_NUMBER() OVER (" +
    "PARTITION BY IFNULL(CAST(ticketNumber AS STRING), GENERATE_UUID()) " +
    "ORDER BY CreatedAt DESC" +
    ") = 1)";
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

/**
 * Merges segment-name variants into one canonical bucket, GLOBALLY (every
 * chart/table/filter that groups or filters by hub_master_segment uses this
 * same expression, so they all agree on one vocabulary): anything containing
 * "SME" -> 'SME', anything containing "LE" -> 'LE' (case-insensitive
 * substring match, per user request — current real values "Private - SME",
 * "LE - Cath Lab", "LE - Diagnostic Chain", "LE - Large Hospital" all match
 * cleanly; "Government"/"ECHO"/"Project" contain neither and pass through
 * unchanged). Blank/null -> blankLabel (default '(blank)') so callers that
 * used a different fallback (e.g. zohoSegment's 'Unknown') can keep it.
 * @param {string} column bare column name or any SQL expression
 * @param {string=} blankLabel
 * @return {string} a CASE...END SQL expression
 */
function segmentGroupSql_(column, blankLabel) {
  var blank = (blankLabel || '(blank)').replace(/'/g, "\\'");
  return "CASE " +
    "WHEN NULLIF(TRIM(" + column + "), '') IS NULL THEN '" + blank + "' " +
    "WHEN UPPER(" + column + ") LIKE '%SME%' THEN 'SME' " +
    "WHEN UPPER(" + column + ") LIKE '%LE%' THEN 'LE' " +
    "ELSE TRIM(" + column + ") END";
}

/* ── Segment filter helpers (page-level Segment dropdown, 2026-07-10) ──
 * The segment value is user input → sanitize before inlining as a SQL literal.
 * hub_master_segment exists on BOTH center_details and zoho_data, so cdSegCond_
 * works for either table. cloud_devices has no segment column of its own; its
 * old single-segment CenterID-subquery bridge was retired by the universal-
 * filter migration (Task 7, 2026-07-28) in favor of centerFilterSubqueryCond_
 * (EditionCD.js), which generalizes the same subquery bridge to all 4
 * center-attribute dimensions (segment/status/state/hub) at once — see
 * buildDeviceExplorerQuery. */
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

/**
 * column IN ('v1','v2',...) for a sanitized, non-empty array; '' otherwise.
 * Segment/Status/State/Hub all reuse this — structurally identical dimensions
 * ("match this column against a list of values").
 *
 * The column is wrapped in TRIM(IFNULL(...,'')) — not compared bare — because
 * the app filters the SAME dimensions through TWO paths that must agree: this
 * SQL fragment, and the JS predicate centerPassesFilters_ (EditionCD.js) over
 * the cached Center-360 rows, whose segment/status/state/hub fields all come
 * from TRIM'd SELECT expressions. Live sandbox measurement: 2,806
 * center_details rows carry a padded HubName, so a bare `column IN (...)`
 * made the two paths silently disagree (whole-branch review finding I4,
 * 2026-07-29). The literals emitted here are already trimmed at the source —
 * every option list is a SELECT DISTINCT TRIM(...) and the Hub search endpoint
 * returns TRIM(HubName).
 * @param {string} column
 * @param {Array<string>=} values
 * @return {string}
 */
function multiCond_(column, values) {
  var clean = (values || []).map(sqlLiteral_).filter(Boolean);
  if (!clean.length) return '';
  return " AND TRIM(IFNULL(" + column + ",'')) IN (" +
    clean.map(function (v) { return "'" + v + "'"; }).join(',') + ')';
}

/**
 * column NOT IN ('v1','v2',...) for a sanitized, non-empty array; '' otherwise.
 * The exclude-style counterpart to multiCond_ — only Device Status in Jira
 * uses this (see CONFIG.JIRA_DEVICE_STATUS_EXCLUDE_DEFAULT for why it's
 * exclude- rather than include-based).
 * @param {string} column
 * @param {Array<string>=} values
 * @return {string}
 */
function multiCondNot_(column, values) {
  var clean = (values || []).map(sqlLiteral_).filter(Boolean);
  if (!clean.length) return '';
  return " AND TRIM(IFNULL(" + column + ",'')) NOT IN (" +
    clean.map(function (v) { return "'" + v + "'"; }).join(',') + ')';
}

/**
 * Escapes a value for use as a BigQuery STRING LITERAL — the emit-side
 * counterpart to segClean_.
 *
 * segClean_ DELETES quote characters, which is right for its own jobs (slugs,
 * cache-key canonicalisation) but wrong for a literal: a real hub named
 * "St. Mary's Hospital" was rewritten to "St. Marys Hospital", a value that
 * exists nowhere in the column, so every SQL-backed panel silently returned
 * zero rows. Worse, the JS filter path (centerPassesFilters_) compares the
 * UNCLEANED value with ===, so Map / CDM / Top Customers / the Overview trees
 * still matched — the same filter produced two different answers on one
 * screen. That is the SQL-vs-JS divergence class of finding I4, reached
 * through the quote character instead of through whitespace.
 *
 * So: double the apostrophe (SQL's own escape) rather than removing it, and
 * do NOT truncate — a shortened hospital name matches nothing. Backslashes
 * and newlines are removed outright: BigQuery reads a backslash as an escape
 * introducer inside a quoted literal, and neither character can legitimately
 * appear in a center attribute.
 * @param {*} value
 * @return {string} safe to interpolate between single quotes
 */
function sqlLiteral_(value) {
  return String(value == null ? '' : value)
    .replace(/[\\\r\n\t\0]/g, '')
    .replace(/'/g, "''");
}

/**
 * Escapes a value for use INSIDE a BigQuery LIKE pattern. '%' and '_' are
 * wildcards there, so a user typing "50%" or "a_b" would otherwise match far
 * more than they asked for. BigQuery's LIKE escape character is backslash and
 * the operator takes no ESCAPE clause, so the escaped value must travel as a
 * NAMED QUERY PARAMETER (inside a SQL string literal the backslash would need
 * doubling). Pair with segClean_ for quote/length sanitisation — see
 * apiSearchHubsCD (EditionCD.js), the only LIKE over free user text whose
 * pattern isn't already a bare substring match.
 * @param {string} value
 * @return {string}
 */
function likeEscape_(value) {
  return String(value == null ? '' : value).replace(/([\\%_])/g, '\\$1');
}

/**
 * DATE column bounds check against a 'YYYY-MM-DD' from/to pair; '' if both
 * are empty/invalid. `column` must already be a DATE/DATETIME-typed SQL
 * expression at the call site — zoho_data.CreatedAt is passed bare (native
 * DATETIME in production, see the file-header note).
 * @param {string} column
 * @param {string=} from
 * @param {string=} to
 * @return {string}
 */
function dateRangeCond_(column, from, to) {
  var f = /^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) ? from : '';
  var t = /^\d{4}-\d{2}-\d{2}$/.test(String(to || '')) ? to : '';
  var cond = '';
  if (f) cond += " AND DATE(" + column + ") >= '" + f + "'";
  if (t) cond += " AND DATE(" + column + ") <= '" + t + "'";
  return cond;
}

/**
 * Stable hash of a filters object for cache keys — sorts each array so
 * ['A','B'] and ['B','A'] hash identically, and fixes key order so the
 * shape of `filters` (Task 3) never produces two different hashes for the
 * same logical filter set.
 * @param {{segments:Array,statuses:Array,states:Array,hubs:Array,cities:Array,countries:Array,
 *          deviceTypes:Array,deviceStatusExclude:Array,dateFrom:string,dateTo:string}} filters
 * @return {string}
 */
function filterHash_(filters) {
  var f = filters || {};
  function sorted(arr) { return (arr || []).map(segClean_).filter(Boolean).sort(); }
  var canonical = JSON.stringify({
    segments: sorted(f.segments), statuses: sorted(f.statuses),
    states: sorted(f.states), hubs: sorted(f.hubs),
    cities: sorted(f.cities), countries: sorted(f.countries),
    // centers MUST be here: centerAttrCond_ emits CAST(CenterID AS STRING)
    // IN (...) for it, tomFilterCond_ emits center_id IN (...), and
    // centerPassesFilters_ checks it in JS — so it changes the payload. While
    // it was missing, {centers:[]} and {centers:['1234']} hashed identically
    // and the colliding key was the WARMED one: selecting a center served the
    // all-centers payload under a visible "Center: X" chip for the full TTL,
    // and in reverse leaked one center's numbers to every other viewer.
    centers: sorted(f.centers),
    deviceTypes: sorted(f.deviceTypes), deviceStatusExclude: sorted(f.deviceStatusExclude),
    // billable/machineTypes/deviceIds/macSerialIds (center_details columns,
    // added 2026-08-21) MUST be here too, same reasoning as the `centers`
    // note above — omitting one of these from the hash would silently
    // collide two different filter selections onto the same cache key.
    billable: sorted(f.billable), machineTypes: sorted(f.machineTypes),
    deviceIds: sorted(f.deviceIds), macSerialIds: sorted(f.macSerialIds),
    dateFrom: String(f.dateFrom || ''), dateTo: String(f.dateTo || '')
  });
  return shortHash(canonical);
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
  return "WITH tix AS (" +
    " SELECT CenterID AS center_id, CreatedAt AS s, " +
    "  COALESCE(ClosedAt, CURRENT_DATETIME()) AS e " +
    " FROM " + zohoDedupSql_() + " WHERE CenterID IS NOT NULL " +
    "  AND " + techBoolSql_("IFNULL(IssueCategory,'')") + " " +
    "  AND CreatedAt IS NOT NULL), " +
    "birth AS (SELECT centerid AS center_id, MIN(startdatetime) AS b " +
    "  FROM " + T('device_center_mapping') + " WHERE startdatetime IS NOT NULL GROUP BY centerid), " +
    "flagged AS (SELECT center_id, s, e, " +
    "  MAX(e) OVER (PARTITION BY center_id ORDER BY s ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS pe FROM tix), " +
    "islands AS (SELECT center_id, s, e, " +
    "  COUNTIF(pe IS NULL OR s > pe) OVER (PARTITION BY center_id ORDER BY s ROWS UNBOUNDED PRECEDING) AS grp FROM flagged), " +
    // GREATEST(0, …) — see the identical guard in EditionCD.js's
    // centerUptimeSqlCD_ (the live path) for why a per-island duration can go
    // negative and what it does to downtime_days.
    "dt AS (SELECT center_id, SUM(GREATEST(0, DATETIME_DIFF(se, ss, HOUR))) AS downtime_hrs " +
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

/** Zoho stringly-typed datetime parser fragments. */
function zohoParsedDates_() {
  return "CreatedAt AS created, " +
         "ClosedAt AS closed";
}

/**
 * Open-ticket age bucketing — Same day/1-2d/3-7d/8-30d/30d+, identical to
 * the Service page's TAT bands (ServiceWrk.js's swTatBandSql_) so both pages
 * describe "how long has this been open" with the same vocabulary. Assumes
 * an `age_days` column upstream. SQL returns bands alphabetically; the
 * client orders them with a fixed array (see ZOHO_OPEN_AGE_ORDER).
 */
function zohoOpenAgeBandSql_() {
  return "CASE WHEN age_days < 1 THEN 'Same day' " +
    "WHEN age_days < 3 THEN '1-2d' " +
    "WHEN age_days < 8 THEN '3-7d' " +
    "WHEN age_days <= 30 THEN '8-30d' " +
    "ELSE '30d+' END";
}

/**
 * The full parallel batch behind the main dashboard payload — one entry per
 * chart/KPI block across the three views (Asset / Centers / Support).
 * @param {string} hub '' for all hubs
 * @return {Array<{key:string, sql:string, params:Object}>}
 */
function buildDashboardQuerySpecs(hub, filters) {
  var p = { hub: hub || '' };
  var f = filters || {};
  var centerCond = centerFilterSubqueryCond_(f);          // for zoho_data
  var supportDateCond = dateRangeCond_("CreatedAt", f.dateFrom, f.dateTo);

  return [

    /* ═══════════ ASSET VIEW — fleet health, hardware, reliability ═══════
     * kpis/fleetStatus/firmware (cloud_devices fleet-health/status/firmware)
     * removed 2026-08-19 — per user, cloud_devices data is CDM/Numbers/
     * Raw-Data only now. Asset's own KPI tiles/device-status-donut/firmware
     * chart/device-explorer were dropped from Index.html+App.html in the same
     * pass; the same telemetry still lives on the CDM page (buildCdmQuerySpecs
     * below), which is unaffected. */
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

    /* ═══════════ SUPPORT VIEW — Zoho ticket analytics (all tickets) ═════ */
    {
      key: 'zohoKpis',
      params: p,
      sql:
        "WITH t AS (SELECT status, " + zohoParsedDates_() + " " +
        " FROM " + zohoDedupSql_() + " WHERE " + HUB_FILTER_SQL + centerCond + supportDateCond + ") " +
        "SELECT " +
        " COUNT(*) AS total_tickets, " +
        " COUNTIF(status NOT IN " + CONFIG.ZOHO_TERMINAL_STATUSES + ") AS open_tickets, " +
        " COUNTIF(created >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 7 DAY)) AS created_7d, " +
        " COUNTIF(closed >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 7 DAY)) AS closed_7d, " +
        // The 7-day window immediately BEFORE the two above, so the KPI tiles can
        // show a prior-period delta ("340 created, ▲12% vs prior 7d"). Same scan,
        // no extra query — just two more COUNTIFs over `t`.
        //
        // FLOW metrics only. created/closed are counts over a window, so the
        // window can be shifted back and compared. open_tickets/total_tickets are
        // STOCKS (a snapshot of now); there is no historical snapshot table in
        // this schema, so they deliberately get no *_prev column — a delta for
        // them would have to be invented. Don't add one here.
        //
        // When a date filter is active, supportDateCond clips BOTH windows
        // identically, so the comparison stays like-for-like; if the filter
        // excludes the prior window entirely it returns 0 and the client
        // suppresses the delta rather than dividing by zero.
        " COUNTIF(created >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 14 DAY)" +
        "   AND created < DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 7 DAY)) AS created_7d_prev, " +
        " COUNTIF(closed >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 14 DAY)" +
        "   AND closed < DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 7 DAY)) AS closed_7d_prev, " +
        " ROUND(AVG(IF(status NOT IN " + CONFIG.ZOHO_TERMINAL_STATUSES + " AND created IS NOT NULL, " +
        "   DATETIME_DIFF(CURRENT_DATETIME(), created, HOUR) / 24.0, NULL)), 1) AS avg_open_age_days " +
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
        " FROM " + zohoDedupSql_() + " WHERE " + HUB_FILTER_SQL + centerCond + supportDateCond + "), " +
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
        zohoParsedDates_() + " FROM " + zohoDedupSql_() + " WHERE " + HUB_FILTER_SQL + centerCond + supportDateCond + "), " +
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
      // Where the CURRENTLY-OPEN SLA risk sits, by issue type. Sibling of
      // slaByType above, but a different question: slaByType scores RESOLVED
      // history (how often did we miss?), this one counts what is open and
      // late RIGHT NOW (what do we chase today?). Same two thresholds as
      // slaKpis' breached_open / atrisk_open so the chart's column totals
      // reconcile exactly with the two numbers on the SLA compliance card:
      //   breached = open AND age > sla
      //   at-risk  = open AND 0.75*sla < age <= sla
      // Ticket-level drill-down of these same rows: SlaRisk.js.
      key: 'slaRisk',
      params: p,
      sql:
        "WITH t AS (SELECT IFNULL(NULLIF(TRIM(IssueCategory), ''), 'Uncategorised') AS category, status, " +
        slaDaysCaseSql_("IFNULL(IssueCategory,'')") + " AS sla_days, " +
        zohoParsedDates_() + " FROM " + zohoDedupSql_() + " WHERE " + HUB_FILTER_SQL + centerCond + supportDateCond + "), " +
        "s AS (SELECT category, sla_days, " +
        " (status NOT IN " + CONFIG.ZOHO_TERMINAL_STATUSES + ") AS is_open, " +
        " CASE WHEN created IS NOT NULL THEN DATETIME_DIFF(CURRENT_DATETIME(), created, HOUR) / 24.0 END AS age_days " +
        " FROM t) " +
        "SELECT category, " +
        " COUNTIF(is_open AND age_days > sla_days) AS breached, " +
        " COUNTIF(is_open AND age_days <= sla_days AND age_days > 0.75 * sla_days) AS atrisk " +
        "FROM s GROUP BY category " +
        "HAVING breached + atrisk > 0 ORDER BY breached + atrisk DESC LIMIT 12"
    },
    {
      key: 'zohoTrend',
      params: p,
      sql:
        "WITH t AS (SELECT " + zohoParsedDates_() + " FROM " + zohoDedupSql_() + " WHERE " + HUB_FILTER_SQL + centerCond + supportDateCond + ") " +
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
        "SELECT status, COUNT(*) AS cnt FROM " + zohoDedupSql_() + " " +
        "WHERE " + HUB_FILTER_SQL + centerCond + supportDateCond + " AND status NOT IN " + CONFIG.ZOHO_TERMINAL_STATUSES + " " +
        "GROUP BY status ORDER BY cnt DESC LIMIT 10"
    },
    {
      key: 'zohoCategories',
      params: p,
      sql:
        "WITH t AS (SELECT IssueCategory, HubName, hub_master_segment, CenterID, CreatedAt, " +
        " CreatedAt AS created " +
        " FROM " + zohoDedupSql_() + ") " +
        "SELECT IFNULL(NULLIF(TRIM(IssueCategory), ''), 'Uncategorised') AS category, COUNT(*) AS cnt " +
        "FROM t WHERE " + HUB_FILTER_SQL + centerCond + supportDateCond + " AND created >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 90 DAY) " +
        "GROUP BY category ORDER BY cnt DESC LIMIT 10"
    },
    {
      // Open (non-terminal) tickets bucketed by days-since-created. Same
      // bands as the Service page's TAT chart (swTatBandSql_/SVC_TAT_ORDER)
      // for one consistent "how long has this been sitting" vocabulary.
      key: 'zohoOpenAge',
      params: p,
      sql:
        "WITH t AS (SELECT status, " + zohoParsedDates_() + " " +
        " FROM " + zohoDedupSql_() + " WHERE " + HUB_FILTER_SQL + centerCond + supportDateCond + "), " +
        "s AS (SELECT DATETIME_DIFF(CURRENT_DATETIME(), created, HOUR) / 24.0 AS age_days " +
        " FROM t WHERE status NOT IN " + CONFIG.ZOHO_TERMINAL_STATUSES + " AND created IS NOT NULL) " +
        "SELECT " + zohoOpenAgeBandSql_() + " AS band, COUNT(*) AS cnt FROM s GROUP BY band"
    },
    {
      key: 'zohoSegment',
      params: p,
      sql:
        "WITH t AS (SELECT hub_master_segment, HubName, CenterID, CreatedAt, " +
        " CreatedAt AS created " +
        " FROM " + zohoDedupSql_() + ") " +
        "SELECT " + segmentGroupSql_('hub_master_segment', 'Unknown') + " AS segment, COUNT(*) AS cnt " +
        "FROM t WHERE " + HUB_FILTER_SQL + centerCond + supportDateCond + " AND created >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 90 DAY) " +
        "GROUP BY segment ORDER BY cnt DESC LIMIT 8"
    }
  ];
}

/* ═════════════════ CDM — Communicator Device Management ═════════════════
 * cloud_devices fields not surfaced anywhere else in the app (Latency,
 * Retries, SpaceAvailable, EcgCounter, the two hardware-version columns) are
 * the focus here; signal/battery are repeated from the Asset view for
 * context. All of these are self-contained (own endpoint, own cache key) —
 * unlike Asset/Centers/Support/Service, CDM does NOT share the dashboard
 * payload, matching the Map/Top Customers pattern instead. */

/**
 * Fleet-wide CDM KPI + chart specs. Every spec here reads cloud_devices
 * directly (single physical table, same across editions) — no CD-suffixed
 * duplicate builder is needed; centerFilterSubqueryCond_ already dispatches
 * to the right center dimension internally.
 * @param {{segments:Array,statuses:Array,states:Array,hubs:Array,cities:Array,countries:Array,centers:Array}=} filters
 * @return {Array<{key:string, sql:string}>}
 */
function buildCdmQuerySpecs(filters) {
  var NOW_IST_SQL = nowIstSql_();
  var centerCond = centerFilterSubqueryCond_(filters || {});
  var CD = T('cloud_devices');
  return [
    {
      key: 'cdmKpis',
      sql:
        "WITH d AS (SELECT LastTimeStamp, SAFE_CAST(CSQ AS INT64) AS csq, " +
        " SAFE_CAST(NULLIF(UPPER(BatteryLevel), 'CHARGING') AS INT64) AS batt, " +
        " SAFE_CAST(Latency AS FLOAT64) AS latency, SAFE_CAST(Retries AS INT64) AS retries, " +
        " SAFE_CAST(UnsyncedData AS INT64) AS unsynced, SAFE_CAST(SpaceAvailable AS FLOAT64) AS space_avail, " +
        " NULLIF(TRIM(hardwareversion_clouddevices), '') AS hw_cd, " +
        " NULLIF(TRIM(hardwareversion_devicestable), '') AS hw_dt " +
        " FROM " + CD + " WHERE TRUE" + centerCond + ") " +
        "SELECT COUNT(*) AS total, " +
        " COUNTIF(LastTimeStamp >= TIMESTAMP_SUB(" + NOW_IST_SQL + ", INTERVAL " + CONFIG.ONLINE_WINDOW_HOURS + " HOUR)) AS online, " +
        " ROUND(AVG(csq), 1) AS avg_csq, " +
        " COUNTIF(batt IS NOT NULL AND batt < 20) AS low_battery, " +
        " ROUND(AVG(latency), 1) AS avg_latency, COUNTIF(latency IS NOT NULL) AS latency_reporting, " +
        " ROUND(AVG(retries), 1) AS avg_retries, " +
        " SUM(IFNULL(unsynced, 0)) AS unsynced_total, " +
        " ROUND(AVG(space_avail), 0) AS avg_space, COUNTIF(space_avail IS NOT NULL) AS space_reporting, " +
        " COUNTIF(hw_cd IS NOT NULL AND hw_dt IS NOT NULL AND hw_cd != hw_dt) AS hw_mismatch, " +
        " COUNTIF(hw_cd IS NOT NULL AND hw_dt IS NOT NULL) AS hw_both_reporting " +
        "FROM d"
    },
    {
      // CSQ (signal quality) bucket, same >=10 "poor" threshold the Asset-view
      // kpis spec already uses for poor_signal, extended to a full breakdown.
      key: 'cdmSignal',
      sql:
        "SELECT CASE " +
        " WHEN SAFE_CAST(CSQ AS INT64) IS NULL THEN 'Unknown' " +
        " WHEN SAFE_CAST(CSQ AS INT64) < 10 THEN 'Poor' " +
        " WHEN SAFE_CAST(CSQ AS INT64) < 20 THEN 'Fair' " +
        " WHEN SAFE_CAST(CSQ AS INT64) < 30 THEN 'Good' ELSE 'Excellent' END AS k, " +
        " COUNT(*) AS n " +
        "FROM " + CD + " WHERE TRUE" + centerCond + " GROUP BY k"
    },
    {
      // BatteryLevel is a STRING column that is EITHER the literal 'Charging'
      // or a numeric percentage (see buildDashboardQuerySpecs' kpis spec).
      key: 'cdmBattery',
      sql:
        "SELECT CASE " +
        " WHEN UPPER(IFNULL(BatteryLevel, '')) = 'CHARGING' THEN 'Charging' " +
        " WHEN SAFE_CAST(BatteryLevel AS INT64) IS NULL THEN 'Unknown' " +
        " WHEN SAFE_CAST(BatteryLevel AS INT64) < 20 THEN 'Low' ELSE 'Normal' END AS k, " +
        " COUNT(*) AS n " +
        "FROM " + CD + " WHERE TRUE" + centerCond + " GROUP BY k"
    },
    {
      key: 'cdmHardware',
      sql:
        "SELECT IFNULL(NULLIF(TRIM(hardwareversion_clouddevices), ''), 'Unknown') AS hw, COUNT(*) AS devices " +
        "FROM " + CD + " WHERE TRUE" + centerCond + " GROUP BY hw ORDER BY devices DESC LIMIT 8"
    },
    {
      // EcgCounter is sparse (~30% of rows) — NULL rows are dropped rather
      // than bucketed as 'Unknown', so the chart reflects reporting devices only.
      key: 'cdmEcg',
      sql:
        "SELECT CASE " +
        " WHEN SAFE_CAST(EcgCounter AS INT64) = 0 THEN '0' " +
        " WHEN SAFE_CAST(EcgCounter AS INT64) <= 5 THEN '1-5' " +
        " WHEN SAFE_CAST(EcgCounter AS INT64) <= 20 THEN '6-20' " +
        " ELSE '21+' END AS k, COUNT(*) AS n " +
        "FROM " + CD + " WHERE SAFE_CAST(EcgCounter AS INT64) IS NOT NULL" + centerCond + " GROUP BY k"
    }
  ];
}

/** Sortable columns for the Communicator explorer — whitelist against injection. */
var CDM_SORT_COLUMNS = {
  device: 'DeviceID', center: 'Centername', hub: 'HubName', last_seen: 'LastTimeStamp',
  csq: 'SAFE_CAST(CSQ AS INT64)', battery: 'SAFE_CAST(BatteryLevel AS INT64)',
  latency: 'SAFE_CAST(Latency AS FLOAT64)', retries: 'SAFE_CAST(Retries AS INT64)',
  space: 'SAFE_CAST(SpaceAvailable AS FLOAT64)', ecg: 'SAFE_CAST(EcgCounter AS INT64)'
};

/**
 * Paginated, filterable Communicator (cloud_devices) explorer — same shape
 * as buildDeviceExplorerQuery, with the CDM-specific fields (Latency,
 * Retries, SpaceAvailable, EcgCounter, hardware version) instead of
 * FirmwareName/ServiceProvider. No dateFrom/dateTo: cloud_devices has no
 * "created" column to range against (same exemption as the Device explorer).
 * @param {{search:string, filters:Object, sortBy:string, sortDir:string,
 *          page:number, pageSize:number}} opts sanitised by Api.js
 * @return {{sql:string, params:Object}}
 */
function buildCdmDeviceExplorerQuery(opts) {
  var FLEET_BUCKET_SQL = fleetBucketSql_();
  var sortCol = CDM_SORT_COLUMNS[opts.sortBy] || 'LastTimeStamp';
  var sortDir = opts.sortDir === 'asc' ? 'ASC' : 'DESC';
  var globalCond = centerFilterSubqueryCond_(opts.filters || {});
  var sql =
    "WITH d AS (SELECT DeviceID, Centername, HubName, LastTimeStamp, " +
    " BatteryLevel, CSQ, Latency, Retries, SpaceAvailable, EcgCounter, UnsyncedData, " +
    " hardwareversion_clouddevices, hardwareversion_devicestable, " +
    " " + FLEET_BUCKET_SQL + " AS status_bucket " +
    " FROM " + T('cloud_devices') + " WHERE TRUE" + globalCond + ") " +
    "SELECT DeviceID AS device, IFNULL(Centername,'') AS center, IFNULL(HubName,'') AS hub, " +
    " CAST(LastTimeStamp AS STRING) AS last_seen, " +
    " IFNULL(BatteryLevel,'') AS battery, SAFE_CAST(CSQ AS INT64) AS csq, " +
    " SAFE_CAST(Latency AS FLOAT64) AS latency, SAFE_CAST(Retries AS INT64) AS retries, " +
    " SAFE_CAST(SpaceAvailable AS FLOAT64) AS space_avail, SAFE_CAST(EcgCounter AS INT64) AS ecg, " +
    " SAFE_CAST(UnsyncedData AS INT64) AS unsynced, " +
    " IFNULL(NULLIF(TRIM(hardwareversion_clouddevices), ''), 'Unknown') AS hardware, " +
    " IFNULL(NULLIF(TRIM(hardwareversion_devicestable), ''), '') AS hardware_dt, " +
    " status_bucket AS status, " +
    " COUNT(*) OVER() AS total_rows " +
    "FROM d " +
    "WHERE (@search = '' OR LOWER(DeviceID) LIKE @like " +
    "      OR LOWER(IFNULL(Centername,'')) LIKE @like " +
    "      OR LOWER(IFNULL(HubName,'')) LIKE @like) " +
    "ORDER BY " + sortCol + " " + sortDir + " " +
    "LIMIT @limit OFFSET @offset";
  return {
    sql: sql,
    params: {
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
      // avg_csq/avg_battery/low_battery added for the CDM (Communicator Device
      // Management) map/table — additive columns, existing consumers unaffected.
      key: 'centerTelemetry',
      maxRows: 60000,
      sql:
        "SELECT CenterID AS center_id, COUNT(*) AS devices, " +
        " COUNTIF(LastTimeStamp >= TIMESTAMP_SUB(" + NOW_IST_SQL + ", INTERVAL " + CONFIG.ONLINE_WINDOW_HOURS + " HOUR)) AS online, " +
        " CAST(MAX(LastTimeStamp) AS STRING) AS last_seen, " +
        " ROUND(AVG(SAFE_CAST(CSQ AS INT64)), 1) AS avg_csq, " +
        " ROUND(AVG(SAFE_CAST(NULLIF(UPPER(BatteryLevel), 'CHARGING') AS INT64)), 1) AS avg_battery, " +
        " COUNTIF(SAFE_CAST(NULLIF(UPPER(BatteryLevel), 'CHARGING') AS INT64) < 20) AS low_battery " +
        "FROM " + T('cloud_devices') + " GROUP BY CenterID"
    },
    {
      key: 'centerTickets',
      maxRows: 50000,
      sql:
        // Segment comes from ALL tickets (open filter would drop centers whose
        // tickets are all closed), open_tickets counts only active ones.
        // swapped = tickets whose IssueCategory is one of the 3 real "swap"
        // categories (Temporary swapping / International Demo Swapping /
        // Mac 600 To V-Cardia(Swapping)) — all-time count, not open-only,
        // since a swap is a completed action, not a backlog item.
        // max_open_age_days = age (in days, same DATETIME_DIFF/HOUR/24.0
        // pattern as every other age_days in this file) of the OLDEST
        // currently-open ticket at this center; NULL when there are none —
        // added for the Top Customers leaderboard's "oldest open ticket"
        // column (per user, 2026-08-25), bucketed client-side into the same
        // Same day/1-2d/3-7d/8-30d/30d+ bands as zohoOpenAgeBandSql_.
        "SELECT CenterID AS center_id, COUNT(*) AS tickets_total, " +
        " COUNTIF(status NOT IN " + CONFIG.ZOHO_TERMINAL_STATUSES + ") AS open_tickets, " +
        " COUNTIF(LOWER(IFNULL(IssueCategory, '')) LIKE '%swap%') AS swapped, " +
        " MAX(CASE WHEN status NOT IN " + CONFIG.ZOHO_TERMINAL_STATUSES +
        "  THEN DATETIME_DIFF(CURRENT_DATETIME(), CreatedAt, HOUR) / 24.0 END) AS max_open_age_days, " +
        " ANY_VALUE(CASE WHEN NULLIF(TRIM(hub_master_segment), '') IS NULL THEN NULL " +
        "  ELSE " + segmentGroupSql_('hub_master_segment') + " END) AS segment " +
        "FROM " + zohoDedupSql_() + " WHERE CenterID IS NOT NULL " +
        "GROUP BY CenterID"
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
      key: 'tickets',
      params: p,
      sql:
        "SELECT COUNT(*) AS total_tickets, " +
        " COUNTIF(status NOT IN " + CONFIG.ZOHO_TERMINAL_STATUSES + ") AS open_tickets, " +
        // NULL (not '(blank)') on a blank segment — the drawer's dt_('Segment', …)
        // falls back to its own '—' for a falsy value; segmentGroupSql_'s
        // blank-LABEL default would otherwise show the literal string "(blank)".
        " ANY_VALUE(CASE WHEN NULLIF(TRIM(hub_master_segment), '') IS NULL THEN NULL " +
        "  ELSE " + segmentGroupSql_('hub_master_segment') + " END) AS segment " +
        "FROM " + zohoDedupSql_() + " WHERE CenterID = @cid"
    },
    {
      key: 'openTickets',
      params: p,
      sql:
        "SELECT ticketNumber AS ticket, status, IFNULL(NULLIF(TRIM(priority),''),'—') AS priority, " +
        " IFNULL(NULLIF(TRIM(subject),''),'(no subject)') AS subject, " +
        " IFNULL(NULLIF(TRIM(IssueCategory),''),'') AS category, " +
        " IFNULL(TicketLink,'') AS link " +
        "FROM " + zohoDedupSql_() + " " +
        "WHERE CenterID = @cid AND status NOT IN " + CONFIG.ZOHO_TERMINAL_STATUSES + " " +
        "ORDER BY CreatedAt DESC " +
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
        " CAST(CreatedAt AS STRING) AS created " +
        "FROM " + zohoDedupSql_() + " " +
        "WHERE CenterID = @cid " +
        "ORDER BY CreatedAt DESC " +
        "LIMIT 50"
    },
    {
      // Zoho tickets whose IssueCategory marks them a device swap — same
      // '%swap%' convention as centerTickets' `swapped` column (Center-360),
      // so this list is exactly what that count is counting. All-time, not
      // status-scoped, mirroring svcSwappedTickets below.
      key: 'swappedTickets',
      params: p,
      sql:
        "SELECT ticketNumber AS ticket, status, IFNULL(NULLIF(TRIM(priority),''),'—') AS priority, " +
        " IFNULL(NULLIF(TRIM(subject),''),'(no subject)') AS subject, " +
        " IFNULL(NULLIF(TRIM(IssueCategory),''),'') AS category, " +
        " IFNULL(TicketLink,'') AS link, " +
        " CAST(CreatedAt AS STRING) AS created " +
        "FROM " + zohoDedupSql_() + " " +
        "WHERE CenterID = @cid AND LOWER(IFNULL(IssueCategory, '')) LIKE '%swap%' " +
        "ORDER BY CreatedAt DESC " +
        "LIMIT 50"
    },
    {
      // ServiceWRK tickets for this center, via customer_id -> CenterID (join
      // verified live via profileJoinKeys() 2026-08-23: 87.7% of all rows
      // resolve to a real center, 7,786 distinct centers hit — high enough to
      // build on, per the decision rule in
      // docs/superpowers/specs/2026-08-13-service-tom-pages-design.md §7.
      // customer_id is TEXT in servicewrk_Tickets and CenterID is numeric in
      // center_details, same CAST-to-STRING join as Fse.js's coverage layer.
      key: 'svcTickets',
      params: p,
      sql:
        "SELECT COUNT(*) AS total_tickets, " +
        " COUNTIF(status = 'Open') AS open_tickets, " +
        " COUNTIF(status = 'Closed') AS closed_tickets, " +
        // Swapped mirrors centerTickets' Zoho `swapped` convention (LIKE
        // '%swap%', all-time not status-scoped — a swap is a completed
        // action, not a backlog item) but over ServiceWRK's own service_type
        // column rather than Zoho's IssueCategory.
        " COUNTIF(LOWER(IFNULL(service_type, '')) LIKE '%swap%') AS swapped " +
        "FROM " + swTable_() + " WHERE customer_id = CAST(@cid AS STRING)"
    },
    {
      key: 'svcOpenTickets',
      params: p,
      sql:
        "SELECT ticket_id AS ticket, status, " +
        " IFNULL(NULLIF(TRIM(service_type),''),'(unspecified)') AS category, " +
        " IFNULL(NULLIF(TRIM(representative),''),'Unassigned') AS representative, " +
        " FORMAT_DATE('%Y-%m-%d', DATE(created_on)) AS created " +
        "FROM " + swTable_() + " " +
        "WHERE customer_id = CAST(@cid AS STRING) AND status = 'Open' " +
        "ORDER BY created_on DESC " +
        "LIMIT 25"
    },
    {
      key: 'svcClosedTickets',
      params: p,
      sql:
        "SELECT ticket_id AS ticket, status, " +
        " IFNULL(NULLIF(TRIM(service_type),''),'(unspecified)') AS category, " +
        " IFNULL(NULLIF(TRIM(representative),''),'Unassigned') AS representative, " +
        " FORMAT_DATE('%Y-%m-%d', DATE(created_on)) AS created " +
        "FROM " + swTable_() + " " +
        "WHERE customer_id = CAST(@cid AS STRING) AND status = 'Closed' " +
        "ORDER BY created_on DESC " +
        "LIMIT 50"
    },
    {
      key: 'svcSwappedTickets',
      params: p,
      sql:
        "SELECT ticket_id AS ticket, status, " +
        " IFNULL(NULLIF(TRIM(service_type),''),'(unspecified)') AS category, " +
        " IFNULL(NULLIF(TRIM(representative),''),'Unassigned') AS representative, " +
        " FORMAT_DATE('%Y-%m-%d', DATE(created_on)) AS created " +
        "FROM " + swTable_() + " " +
        "WHERE customer_id = CAST(@cid AS STRING) AND LOWER(IFNULL(service_type, '')) LIKE '%swap%' " +
        "ORDER BY created_on DESC " +
        "LIMIT 50"
    }
  ];
}
