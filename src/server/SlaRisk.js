/**
 * SlaRisk.js — ticket-level drill-down behind the Support page's SLA numbers.
 *
 * The SLA compliance card has always shown "Open breached: N" and "At-risk: N"
 * as bare counts with no way to reach the underlying tickets. This file answers
 * "which ones?" as a paginated, sortable worklist.
 *
 * DEFINITIONS — identical to slaKpis' breached_open / atrisk_open and to the
 * `slaRisk` chart spec (both in Queries.js), so all three reconcile exactly:
 *   open     = status NOT IN CONFIG.ZOHO_TERMINAL_STATUSES
 *   age_days = now - CreatedAt, in days
 *   sla_days = per-IssueCategory target from SLA_CATALOG (SlaCatalog.js)
 *   BREACHED = open AND age_days >  sla_days
 *   AT_RISK  = open AND age_days <= sla_days AND age_days > 0.75 * sla_days
 * The union of the two is simply `age_days > 0.75 * sla_days`, which is the
 * single WHERE this query filters on — keep that in step with the two
 * thresholds above if either ever moves.
 *
 * Reads through zohoDedupSql_() like every other real Zoho consumer, so the
 * sync's duplicate rows and unassigned tickets can't inflate the worklist.
 */

/**
 * Sortable columns → the SQL they map to. A whitelist, not interpolation:
 * sortBy arrives from the client and is concatenated into ORDER BY.
 * Keys are the client's column keys (SLA_RISK_COLUMNS in App.html).
 */
var SLA_RISK_SORT_KEYS = {
  days_over: 'days_over',
  age_days: 'age_days',
  sla_days: 'sla_days',
  created: 'created',
  category: 'category',
  status: 'status',
  priority: 'priority',
  assignee: 'assignee',
  center_id: 'center_id',
  risk: 'risk'
};

/**
 * One page of open tickets that are past — or close to — their SLA target.
 *
 * @param {{page:number, pageSize:number, sortBy:string, sortDir:string,
 *          search:string, risk:string, filters:Object}} options
 *        risk: 'breached' | 'atrisk' | anything else = both.
 * @return {string} SQL
 */
function buildSlaRiskTicketsQuery(options) {
  var o = options || {};
  var page = Math.max(0, parseInt(o.page, 10) || 0);
  var pageSize = Math.min(200, Math.max(1, parseInt(o.pageSize, 10) || 15));
  var sortBy = SLA_RISK_SORT_KEYS[o.sortBy] || 'days_over';
  var sortDir = String(o.sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  // Two characters minimum, same rule as the Service explorer: a single letter
  // matches most of the table, so it costs a full scan to return noise.
  var search = segClean_(String(o.search || '')).toLowerCase();
  var searchCond = '';
  if (search.length >= 2) {
    var like = "'%" + likeEscape_(search) + "%'";
    searchCond = ' AND (LOWER(IFNULL(CAST(ticket AS STRING), "")) LIKE ' + like +
      ' OR LOWER(IFNULL(category, "")) LIKE ' + like +
      ' OR LOWER(IFNULL(assignee, "")) LIKE ' + like +
      ' OR LOWER(IFNULL(CAST(center_id AS STRING), "")) LIKE ' + like + ')';
  }

  // Optional single-band narrowing, driven by the chart legend / the two
  // summary chips above the table.
  var riskCond = '';
  var risk = String(o.risk || '').toLowerCase();
  if (risk === 'breached') riskCond = " AND risk = 'BREACHED'";
  else if (risk === 'atrisk') riskCond = " AND risk = 'AT_RISK'";

  return 'WITH t AS (SELECT ticketNumber AS ticket, CenterID AS center_id, ' +
    ' IFNULL(NULLIF(TRIM(IssueCategory), \'\'), \'Uncategorised\') AS category, ' +
    ' status, IFNULL(NULLIF(TRIM(priority), \'\'), \'—\') AS priority, ' +
    ' IFNULL(NULLIF(TRIM(assignee), \'\'), \'—\') AS assignee, ' +
    ' IFNULL(TicketLink, \'\') AS link, ' +
    slaDaysCaseSql_("IFNULL(IssueCategory,'')") + ' AS sla_days, ' +
    zohoParsedDates_() +
    ' FROM ' + zohoDedupSql_() + ' WHERE status NOT IN ' + CONFIG.ZOHO_TERMINAL_STATUSES +
    centerFilterSubqueryCond_(o.filters) +
    dateRangeCond_('CreatedAt', (o.filters || {}).dateFrom, (o.filters || {}).dateTo) + '), ' +
    // created_dt, not `created`: formatting to a string under the same name
    // would shadow the DATETIME that age_raw is derived from in this very
    // SELECT. BigQuery resolves it to the FROM-clause column either way, but
    // only a reader who knows that rule can tell — so keep the names distinct.
    'a AS (SELECT ticket, center_id, category, status, priority, assignee, link, sla_days, ' +
    ' created AS created_dt, ' +
    ' DATETIME_DIFF(CURRENT_DATETIME(), created, HOUR) / 24.0 AS age_raw ' +
    ' FROM t WHERE created IS NOT NULL), ' +
    'r AS (SELECT ticket, center_id, category, status, priority, assignee, link, sla_days, ' +
    ' FORMAT_DATETIME(\'%Y-%m-%d\', created_dt) AS created, ' +
    ' ROUND(age_raw, 1) AS age_days, ' +
    ' ROUND(age_raw - sla_days, 1) AS days_over, ' +
    ' IF(age_raw > sla_days, \'BREACHED\', \'AT_RISK\') AS risk ' +
    ' FROM a WHERE age_raw > 0.75 * sla_days) ' +
    'SELECT *, COUNT(*) OVER() AS total_rows FROM r WHERE TRUE' + riskCond + searchCond +
    ' ORDER BY ' + sortBy + ' ' + sortDir + ', ticket DESC' +
    ' LIMIT ' + pageSize + ' OFFSET ' + (page * pageSize);
}

/**
 * Paginated SLA-risk worklist. Named *CD because the client routes every
 * endpoint through ep(), which appends "CD" — there is no non-CD twin.
 * @param {Object=} options see buildSlaRiskTicketsQuery
 */
function apiGetSlaRiskTicketsCD(options) {
  options = options || {};
  var pageSize = Math.min(200, Math.max(1, parseInt(options.pageSize, 10) || 15));
  return respond_(function () {
    var rows = runQuery(buildSlaRiskTicketsQuery(options), null, { maxRows: pageSize }) || [];
    return {
      rows: rows,
      totalRows: rows.length ? Number(rows[0].total_rows || 0) : 0,
      page: Math.max(0, parseInt(options.page, 10) || 0),
      pageSize: pageSize
    };
  });
}
