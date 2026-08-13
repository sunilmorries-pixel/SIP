/**
 * TomTickets.js — the TOM page's data layer, over `tom_tickets`.
 *
 * WHAT THIS TABLE IS (inferred from the data, 2026-08-14): a CS-owned issue /
 * escalation tracker, loaded from monthly spreadsheet tabs (`source_tab` reads
 * "2026 | June 2026"). 1,325 rows spanning 2025-12-30 → 2026-08-12, one row per
 * issue, with the centre, device type, issue type, owning CS agent, TAT in
 * whole days, and an outcome.
 *
 * `remarks` is the OUTCOME column despite its name — its values are
 * "Issue identified+Service Visit" (811), "Issue Resolved" (256), "Auto
 * Resolved" (86), "Service visit request for Identification" (68), "No
 * response" (41), "Direct service Request by customer" (31), "Not resolved"
 * (27). That resolution vocabulary is why this is modelled as an issue
 * tracker rather than machine-movement tracking; `comments` mentions swapping
 * and HQ dispatch but is 98.3% empty (23 rows), so it cannot carry the page.
 * If the CS team says otherwise, the labels change — the queries mostly stand.
 *
 * TWO COLUMNS ARE UNUSABLE and are deliberately not surfaced anywhere:
 *   t_o_m   — a single value ("Saidha") across all 1,325 rows, so it has zero
 *             discriminating power.
 *   comments — 98.3% null.
 */

/** @return {string} the fully-qualified, backticked TOM table. */
function tomTable_() {
  return T('tom_tickets');
}

/**
 * Date-range condition, bounded on received_date (when the issue arrived)
 * rather than closed_date, so the range means "issues raised in this window".
 * @param {string=} dateFrom ISO yyyy-mm-dd
 * @param {string=} dateTo ISO yyyy-mm-dd
 * @return {string} '' when neither bound is set
 */
function tomDateCond_(dateFrom, dateTo) {
  var cond = '';
  var from = segClean_(String(dateFrom || ''));
  var to = segClean_(String(dateTo || ''));
  if (from) cond += " AND DATE(received_date) >= DATE('" + from + "')";
  if (to) cond += " AND DATE(received_date) <= DATE('" + to + "')";
  return cond;
}

/**
 * The global filter drawer, expressed in tom_tickets' OWN columns.
 *
 * Only Centre and the date range apply: this table has no state/city/segment/
 * hub columns, and bridging to them would need the customer/centre join that
 * is still unverified (profileJoinKeys has not been run). center_id is
 * populated on 99.7% of rows, so the Centre dimension works directly.
 *
 * @param {Object} filters
 * @return {string} SQL fragment beginning with ' AND', or ''
 */
function tomFilterCond_(filters) {
  var f = filters || {};
  return multiCond_('center_id', f.centers) +
    tomDateCond_(f.dateFrom, f.dateTo);
}

/** Outcomes that mean the issue was closed out without a site visit. */
function tomResolvedCond_() {
  return "TRIM(IFNULL(remarks, '')) IN ('Issue Resolved', 'Auto Resolved')";
}

/** Outcomes that mean the issue was NOT closed out. */
function tomUnresolvedCond_() {
  return "TRIM(IFNULL(remarks, '')) IN ('Not resolved', 'No response')";
}

/* ═══════════════ Query specs ═══════════════ */

/**
 * Every query the TOM page needs, as one parallel batch. Chart specs alias to
 * `label`/`cnt` because Charts.rankBar reads those two names directly.
 *
 * @param {Object} filters the global filter drawer's state
 * @return {Array<{key:string, sql:string, maxRows:number}>}
 */
function buildTomQuerySpecs(filters) {
  var TOM = tomTable_();
  var where = ' WHERE TRUE' + tomFilterCond_(filters);

  return [
    {
      key: 'kpis', maxRows: 1,
      sql: 'SELECT COUNT(*) AS issues, ' +
        ' COUNTIF(' + tomResolvedCond_() + ') AS resolved, ' +
        ' COUNTIF(' + tomUnresolvedCond_() + ') AS unresolved, ' +
        ' ROUND(SAFE_DIVIDE(COUNTIF(' + tomResolvedCond_() + '), NULLIF(COUNT(*), 0)) * 100, 1) AS resolved_pct, ' +
        ' ROUND(AVG(IF(tat_days_ >= 0, tat_days_, NULL)), 1) AS avg_tat_days ' +
        'FROM ' + TOM + where
    },
    {
      key: 'volume', maxRows: 40,
      // Derived from received_date, NOT the `month` column: that column holds
      // bare names ('Jan','Jun'), so ordering by it sorts Apr < Aug < Dec.
      //
      // Aliased `ym`, deliberately NOT `month` — tom_tickets really does have a
      // `month` column, and an alias of the same name would leave GROUP BY /
      // ORDER BY resolving between the alias and the raw column. Sidestepped
      // rather than relying on BigQuery's precedence rules.
      sql: 'SELECT FORMAT_DATE("%Y-%m", DATE(received_date)) AS ym, COUNT(*) AS cnt ' +
        'FROM ' + TOM + where + ' AND received_date IS NOT NULL ' +
        'GROUP BY ym ORDER BY ym'
    },
    {
      key: 'issueTypes', maxRows: 12,
      sql: 'SELECT IFNULL(NULLIF(TRIM(issue_type), ""), "Unknown") AS label, COUNT(*) AS cnt ' +
        'FROM ' + TOM + where + ' GROUP BY label ORDER BY cnt DESC LIMIT 12'
    },
    {
      key: 'deviceTypes', maxRows: 12,
      sql: 'SELECT IFNULL(NULLIF(TRIM(machine_devicetype), ""), "Unknown") AS label, COUNT(*) AS cnt ' +
        'FROM ' + TOM + where + ' GROUP BY label ORDER BY cnt DESC LIMIT 12'
    },
    {
      key: 'outcomes', maxRows: 10,
      sql: 'SELECT IFNULL(NULLIF(TRIM(remarks), ""), "Unknown") AS label, COUNT(*) AS cnt ' +
        'FROM ' + TOM + where + ' GROUP BY label ORDER BY cnt DESC'
    },
    {
      key: 'owners', maxRows: 14,
      sql: 'SELECT IFNULL(NULLIF(TRIM(cs_team_name_service_team), ""), "Unassigned") AS label, COUNT(*) AS cnt ' +
        'FROM ' + TOM + where + ' GROUP BY label ORDER BY cnt DESC LIMIT 14'
    },
    {
      key: 'reasons', maxRows: 12,
      sql: 'SELECT IFNULL(NULLIF(TRIM(reason), ""), "Unknown") AS label, COUNT(*) AS cnt ' +
        'FROM ' + TOM + where + ' GROUP BY label ORDER BY cnt DESC LIMIT 12'
    }
  ];
}

/**
 * TOM page payload — KPIs plus all six charts, in one cached round trip.
 * @param {{filters:Object, bypassCache:boolean}=} options
 */
function apiGetTomCD(options) {
  options = options || {};
  var filters = options.filters || {};
  return respond_(function () {
    return withCache('tom_v1_' + getCacheEpoch_() + '_' + filterHash_(filters), function () {
      var r = runQueriesParallel(buildTomQuerySpecs(filters));
      return {
        kpis: (r.kpis && r.kpis[0]) || {},
        volume: r.volume || [],
        issueTypes: r.issueTypes || [],
        deviceTypes: r.deviceTypes || [],
        outcomes: r.outcomes || [],
        owners: r.owners || [],
        reasons: r.reasons || []
      };
    }, options.bypassCache === true);
  });
}

/* ═══════════════ Issue explorer ═══════════════ */

/** Whitelisted sort columns — a map, so an arbitrary sortBy can't reach SQL. */
var TOM_SORT_KEYS = {
  received_date: 'received_date', closed_date: 'closed_date',
  center_name: 'center_name', location: 'location',
  machine_devicetype: 'machine_devicetype', issue_type: 'issue_type',
  cs_team_name_service_team: 'cs_team_name_service_team',
  tat_days_: 'tat_days_', remarks: 'remarks'
};

/**
 * One page of the TOM issue explorer.
 * @param {{page:number, pageSize:number, sortBy:string, sortDir:string,
 *          search:string, filters:Object}} options
 * @return {string} SQL
 */
function buildTomTicketsQuery(options) {
  var o = options || {};
  var page = Math.max(0, parseInt(o.page, 10) || 0);
  var pageSize = Math.min(200, Math.max(1, parseInt(o.pageSize, 10) || 15));
  var sortBy = TOM_SORT_KEYS[o.sortBy] || 'received_date';
  var sortDir = String(o.sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  var search = segClean_(String(o.search || '')).toLowerCase();
  var searchCond = '';
  if (search.length >= 2) {
    var like = "'%" + likeEscape_(search) + "%'";
    searchCond = ' AND (LOWER(IFNULL(center_name, "")) LIKE ' + like +
      ' OR LOWER(IFNULL(zoho_id, "")) LIKE ' + like +
      ' OR LOWER(IFNULL(issue, "")) LIKE ' + like + ')';
  }

  return 'SELECT FORMAT_DATE("%Y-%m-%d", DATE(received_date)) AS received, ' +
    ' FORMAT_DATE("%Y-%m-%d", DATE(closed_date)) AS closed, ' +
    ' IFNULL(zoho_id, "") AS zoho_id, IFNULL(center_id, "") AS center_id, ' +
    ' IFNULL(center_name, "") AS center_name, IFNULL(location, "") AS location, ' +
    ' IFNULL(machine_devicetype, "") AS device_type, IFNULL(issue_type, "") AS issue_type, ' +
    ' IFNULL(reason, "") AS reason, ' +
    ' IFNULL(cs_team_name_service_team, "") AS owner, ' +
    ' tat_days_, IFNULL(remarks, "") AS outcome, ' +
    ' COUNT(*) OVER() AS total_rows ' +
    'FROM ' + tomTable_() + ' WHERE TRUE' + tomFilterCond_(o.filters) + searchCond +
    ' ORDER BY ' + sortBy + ' ' + sortDir +
    ' LIMIT ' + pageSize + ' OFFSET ' + (page * pageSize);
}

/**
 * Paginated TOM issue list.
 * @param {Object=} options see buildTomTicketsQuery
 */
function apiGetTomTicketsCD(options) {
  options = options || {};
  var pageSize = Math.min(200, Math.max(1, parseInt(options.pageSize, 10) || 15));
  return respond_(function () {
    var rows = runQuery(buildTomTicketsQuery(options), null, { maxRows: pageSize }) || [];
    return {
      rows: rows,
      totalRows: rows.length ? Number(rows[0].total_rows || 0) : 0,
      page: Math.max(0, parseInt(options.page, 10) || 0),
      pageSize: pageSize
    };
  });
}
