/**
 * ServiceWrk.js — the Service page's data layer, over
 * `servicewrk_Tickets` (ServiceWRK field-service operations).
 *
 * WHY THIS TABLE IS NOT THE UPTIME SOURCE: Config.js and docs/SOURCES.md both
 * anticipated swapping M-A1's downtime CTE onto ServiceWRK once it landed.
 * The profiled data does not support that — created_on/closed_date are
 * date-only (886 distinct values across ~947 days), only 870 of 36,403 rows
 * are ticket_type='BREAKDOWN', and coverage starts 2024-01-08 while center
 * `life` reaches years further back. See
 * docs/superpowers/specs/2026-08-13-service-tom-pages-design.md §4.1.
 * The uptime engine stays on the Zoho proxy. Do not "fix" this.
 *
 * NO DEDUPE CTE: ticket_id is unique (36,583 approx-distinct vs 36,403 rows),
 * unlike zoho_data which needs zohoDedupSql_. Adding one here would be
 * cargo-culting.
 */

/** @return {string} the fully-qualified, backticked ServiceWRK table. */
function swTable_() {
  return T('servicewrk_Tickets');
}

/**
 * Date-range condition on created_on. ServiceWRK's timestamps carry no
 * time-of-day, so DATE() comparison is exact rather than lossy.
 * @param {string=} dateFrom ISO yyyy-mm-dd
 * @param {string=} dateTo ISO yyyy-mm-dd
 * @return {string} '' when neither bound is set
 */
function swDateCond_(dateFrom, dateTo) {
  var cond = '';
  var from = segClean_(String(dateFrom || ''));
  var to = segClean_(String(dateTo || ''));
  if (from) cond += " AND DATE(created_on) >= DATE('" + from + "')";
  if (to) cond += " AND DATE(created_on) <= DATE('" + to + "')";
  return cond;
}

/**
 * TAT sanity guard. tat_days_ runs as low as -1.5 because some rows carry a
 * closed_date earlier than their created_on. Every TAT statistic excludes
 * these; apiGetServiceCD reports how many were excluded rather than hiding it.
 * @return {string}
 */
function swTatValidCond_() {
  return ' AND tat_days_ IS NOT NULL AND tat_days_ >= 0';
}

/**
 * The global filter drawer, expressed in ServiceWRK's OWN columns.
 *
 * Deliberately partial: hub/center/status/deviceType have no counterpart in
 * this table, and bridging them would need a customer_id -> CenterID join that
 * is unverified and at best partial (customer_id is 7.9% null, ~7,923 distinct
 * against ~27,410 centers). Silently ignoring those dimensions is the honest
 * behaviour — the page states its own filter coverage in the UI.
 *
 * @param {Object} filters
 * @return {string} SQL fragment beginning with ' AND', or ''
 */
function swFilterCond_(filters) {
  var f = filters || {};
  return multiCond_(segmentGroupSql_('customer_category'), f.segments) +
    multiCond_('state', f.states) +
    multiCond_('city', f.cities) +
    swDateCond_(f.dateFrom, f.dateTo);
}

/**
 * TAT bucketing expression. Bands are closed-open on whole days; the client
 * orders them with a fixed array (SVC_TAT_ORDER) because SQL returns them
 * alphabetically.
 * @return {string} a CASE expression producing a band label
 */
function swTatBandSql_() {
  return "CASE WHEN tat_days_ < 1 THEN 'Same day' " +
    "WHEN tat_days_ < 3 THEN '1-2d' " +
    "WHEN tat_days_ < 8 THEN '3-7d' " +
    "WHEN tat_days_ <= 30 THEN '8-30d' " +
    "ELSE '30d+' END";
}

/* ═══════════════ Query specs ═══════════════ */

/**
 * Every query the Service page needs, as one parallel batch.
 *
 * Each chart spec aliases its output columns to `label` and `cnt` because
 * Charts.rankBar reads those two names directly — it has no labelKey/valueKey
 * options (Charts.html).
 *
 * @param {Object} filters the global filter drawer's state
 * @return {Array<{key:string, sql:string, maxRows:number}>}
 */
function buildServiceQuerySpecs(filters) {
  var SW = swTable_();
  var where = ' WHERE TRUE' + swFilterCond_(filters);

  return [
    {
      key: 'kpis', maxRows: 1,
      // `bounds` anchors the 30-day window to the newest ticket rather than to
      // CURRENT_DATE: the feed is a daily file drop that can lag, and anchoring
      // to today would silently zero this tile on a missed drop.
      //
      // bounds is CROSS JOINed, so max_day is a row-level column and can be
      // read straight inside COUNTIF. Wrapping it in ANY_VALUE() would nest an
      // aggregate inside an aggregate — a BigQuery error, not a style problem.
      sql: 'WITH bounds AS (SELECT DATE(MAX(created_on)) AS max_day FROM ' + SW + where + ') ' +
        'SELECT COUNTIF(status = "Open") AS open_tickets, ' +
        ' COUNTIF(status = "Closed") AS closed_tickets, ' +
        ' ROUND(APPROX_QUANTILES(IF(tat_days_ >= 0, tat_days_, NULL), 100)[OFFSET(50)], 1) AS median_tat_days, ' +
        ' COUNTIF(tat_days_ < 0) AS invalid_tat, ' +
        ' ROUND(SAFE_DIVIDE(COUNTIF(closure_type = "OVERCALL_RESOLUTION"), ' +
        '   NULLIF(COUNTIF(closure_type IS NOT NULL), 0)) * 100, 1) AS remote_pct, ' +
        ' COUNTIF(closure_type = "CENTER_VISIT" AND ' +
        '   DATE(created_on) >= DATE_SUB(bounds.max_day, INTERVAL 30 DAY)) AS visits_30d ' +
        'FROM ' + SW + ' CROSS JOIN bounds' + where
    },
    {
      key: 'flow', maxRows: 40,
      // Created and closed are counted in separate CTEs and FULL OUTER JOINed:
      // a month can have closures without creations (and vice versa), and an
      // inner join would silently drop those months from the trend.
      sql: 'WITH c AS (SELECT FORMAT_DATE("%Y-%m", DATE(created_on)) AS month, COUNT(*) AS created ' +
        ' FROM ' + SW + where + ' GROUP BY month), ' +
        'x AS (SELECT FORMAT_DATE("%Y-%m", DATE(closed_date)) AS month, COUNT(*) AS closed ' +
        ' FROM ' + SW + where + ' AND closed_date IS NOT NULL GROUP BY month) ' +
        'SELECT month, IFNULL(c.created, 0) AS created, IFNULL(x.closed, 0) AS closed ' +
        'FROM c FULL OUTER JOIN x USING (month) ORDER BY month'
    },
    {
      key: 'tatBands', maxRows: 10,
      sql: 'SELECT ' + swTatBandSql_() + ' AS band, COUNT(*) AS cnt FROM ' + SW +
        where + swTatValidCond_() + ' GROUP BY band'
    },
    {
      key: 'resolution', maxRows: 10,
      sql: 'SELECT IFNULL(NULLIF(TRIM(closure_type), ""), "Unknown") AS label, COUNT(*) AS cnt ' +
        'FROM ' + SW + where + ' GROUP BY label ORDER BY cnt DESC'
    },
    {
      key: 'serviceTypes', maxRows: 12,
      sql: 'SELECT IFNULL(NULLIF(TRIM(service_type), ""), "Unknown") AS label, COUNT(*) AS cnt ' +
        'FROM ' + SW + where + ' GROUP BY label ORDER BY cnt DESC LIMIT 12'
    },
    {
      key: 'models', maxRows: 16,
      sql: 'SELECT IFNULL(NULLIF(TRIM(category), ""), "Unknown") AS label, COUNT(*) AS cnt ' +
        'FROM ' + SW + where + ' GROUP BY label ORDER BY cnt DESC LIMIT 16'
    },
    {
      key: 'reps', maxRows: 12,
      sql: 'SELECT IFNULL(NULLIF(TRIM(representative), ""), "Unassigned") AS label, COUNT(*) AS cnt ' +
        'FROM ' + SW + where + ' AND status = "Closed" GROUP BY label ORDER BY cnt DESC LIMIT 12'
    },
    {
      // Same '%swap%' service_type match as Queries.js's svcSwappedTickets
      // (center-detail drawer) and centerTickets' Zoho `swapped` column
      // (Center-360) — one vocabulary for "swap" across the app. Per user,
      // 2026-08-25: region here means the CENTER's state (center_details),
      // not ticket_territory (a sales-territory label, not a state) — join
      // via customer_id -> CenterID, same bridge Queries.js's centerTickets
      // spec and Fse.js already use. customer_id is TEXT, CenterID numeric,
      // hence the CAST; cs collapses center_details' occasional duplicate
      // CenterID rows with ANY_VALUE (same pattern as Numbers.js's device
      // -> CenterID map) since this is a display grouping, not a filter.
      key: 'swapsByRegion', maxRows: 15,
      sql: 'WITH cs AS (SELECT CAST(CenterID AS STRING) AS cid, ' +
        'ANY_VALUE(TRIM(State)) AS cd_state FROM ' + T('center_details') +
        ' WHERE CenterID IS NOT NULL GROUP BY cid) ' +
        'SELECT IFNULL(NULLIF(cs.cd_state, ""), "Unknown") AS label, COUNT(*) AS cnt ' +
        'FROM ' + SW + ' LEFT JOIN cs ON cs.cid = customer_id' + where +
        ' AND LOWER(IFNULL(service_type, "")) LIKE "%swap%" ' +
        'GROUP BY label ORDER BY cnt DESC LIMIT 15'
    },
    {
      // Same swap match as swapsByRegion above; representative's "Unassigned"
      // fallback mirrors the reps spec (this page's existing FSE breakdown).
      key: 'swapsByRep', maxRows: 12,
      sql: 'SELECT IFNULL(NULLIF(TRIM(representative), ""), "Unassigned") AS label, COUNT(*) AS cnt ' +
        'FROM ' + SW + where + ' AND LOWER(IFNULL(service_type, "")) LIKE "%swap%" ' +
        'GROUP BY label ORDER BY cnt DESC LIMIT 12'
    }
  ];
}

/**
 * Service page payload — KPIs plus all eight charts, in one cached round trip.
 * @param {{filters:Object, bypassCache:boolean}=} options
 */
function apiGetServiceCD(options) {
  options = options || {};
  var filters = options.filters || {};
  return respond_(function () {
    // v2: added swapsByRegion/swapsByRep
    // v3: swapsByRegion re-keyed to group by center_details.State, not
    // ticket_territory — bump so stale v2 payloads (old territory labels)
    // aren't served from cache until their TTL happens to expire.
    return withCache('svc_v3_' + getCacheEpoch_() + '_' + filterHash_(filters), function () {
      var r = runQueriesParallel(buildServiceQuerySpecs(filters));
      var k = (r.kpis && r.kpis[0]) || {};
      return {
        kpis: k,
        flow: r.flow || [],
        tatBands: r.tatBands || [],
        resolution: r.resolution || [],
        serviceTypes: r.serviceTypes || [],
        models: r.models || [],
        reps: r.reps || [],
        swapsByRegion: r.swapsByRegion || [],
        swapsByRep: r.swapsByRep || [],
        invalidTat: Number(k.invalid_tat || 0)
      };
    }, options.bypassCache === true);
  });
}

/* ═══════════════ Ticket explorer ═══════════════ */

/**
 * Whitelisted sort columns. A map, not an array, so an attacker-supplied
 * sortBy can never reach the SQL string — same guard as CENTER_SORT_KEYS.
 * Keys are the UNDERLYING column names, not the aliased output names, because
 * BigQuery's ORDER BY runs against the source table here.
 */
var SERVICE_SORT_KEYS = {
  created_on: 'created_on', status: 'status', state: 'state', city: 'city',
  product: 'product', service_type: 'service_type', representative: 'representative',
  tat_days_: 'tat_days_', closure_type: 'closure_type'
};

/**
 * One page of the service-ticket explorer.
 * @param {{page:number, pageSize:number, sortBy:string, sortDir:string,
 *          search:string, filters:Object}} options
 * @return {string} SQL
 */
function buildServiceTicketsQuery(options) {
  var o = options || {};
  var page = Math.max(0, parseInt(o.page, 10) || 0);
  var pageSize = Math.min(200, Math.max(1, parseInt(o.pageSize, 10) || 50));
  var sortBy = SERVICE_SORT_KEYS[o.sortBy] || 'created_on';
  var sortDir = String(o.sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  // Two characters minimum: a single letter matches most of the table, so it
  // costs a full scan to return something nobody wanted.
  var search = segClean_(String(o.search || '')).toLowerCase();
  var searchCond = '';
  if (search.length >= 2) {
    var like = "'%" + likeEscape_(search) + "%'";
    searchCond = ' AND (LOWER(IFNULL(ticket_id, "")) LIKE ' + like +
      ' OR LOWER(IFNULL(contact_person_name, "")) LIKE ' + like +
      ' OR LOWER(IFNULL(representative, "")) LIKE ' + like + ')';
  }

  return 'SELECT ticket_id, ' +
    ' FORMAT_DATE("%Y-%m-%d", DATE(created_on)) AS created, ' +
    ' FORMAT_DATE("%Y-%m-%d", DATE(closed_date)) AS closed, ' +
    ' status, IFNULL(contact_person_name, "") AS contact, ' +
    // Per user, 2026-08-25: state/city (ServiceWRK's own columns, same ones
    // swFilterCond_ already filters on) replace ticket_territory here — a
    // sales-territory label, not a state (see swapsByRegion above).
    ' IFNULL(state, "") AS state, IFNULL(city, "") AS city, IFNULL(product, "") AS product, ' +
    ' IFNULL(service_type, "") AS service_type, IFNULL(representative, "") AS representative, ' +
    ' tat_days_, IFNULL(closure_type, "") AS closure_type, ' +
    ' COUNT(*) OVER() AS total_rows ' +
    // Per user, 2026-08-25: the ticket explorer shows open tickets only.
    'FROM ' + swTable_() + ' WHERE TRUE' + swFilterCond_(o.filters) +
    ' AND status = "Open"' + searchCond +
    ' ORDER BY ' + sortBy + ' ' + sortDir +
    ' LIMIT ' + pageSize + ' OFFSET ' + (page * pageSize);
}

/**
 * Paginated service-ticket list.
 * @param {Object=} options see buildServiceTicketsQuery
 */
function apiGetServiceTicketsCD(options) {
  options = options || {};
  var pageSize = Math.min(200, Math.max(1, parseInt(options.pageSize, 10) || 50));
  return respond_(function () {
    var rows = runQuery(buildServiceTicketsQuery(options), null, { maxRows: pageSize }) || [];
    return {
      rows: rows,
      totalRows: rows.length ? Number(rows[0].total_rows || 0) : 0,
      page: Math.max(0, parseInt(options.page, 10) || 0),
      pageSize: pageSize
    };
  });
}
