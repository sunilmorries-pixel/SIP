/**
 * RawData.js — raw per-source tables for the "Raw Data" page.
 *
 * Now respects the global Filters drawer (per user, 2026-08-13 — previously
 * exempt by design). Each source applies whichever dimensions it can support
 * from its own schema:
 *   - center_details: every center-attribute dimension (Segment/Status/State/
 *     Hub/City/Country) directly, plus deploymentdate for the date range.
 *   - cloud_devices / zoho_data: no center-attribute columns of their own, so
 *     they bridge via centerFilterSubqueryCond_ (CenterID IN center_details
 *     WHERE ...). zoho_data additionally gets CreatedAt for the date range.
 *     zoho_data deliberately still reads the RAW table, not zohoDedupSql_() —
 *     this page's job is reconciliation against Zoho itself, so it must keep
 *     showing the true row count (duplicates + unassigned tickets included)
 *     even though it's now filterable by center attributes.
 *   - jira_data: Device Type (issuetype_name) / Device Status in Jira
 *     (status_name, exclude) / date (ticket_created) directly — its own
 *     columns. Center-attribute filters do NOT apply here: mapping a Jira row
 *     to a center requires the serial-parsing bridge in deviceCenterMap_
 *     (Numbers.js), which is JS-side over the whole table and not practical
 *     to fold into this page's simple per-source SQL WHERE.
 */

var RAW_EXPORT_MAX_ROWS = 100000;

/**
 * Registry of every raw source the page exposes. A function (not a
 * top-level const) because it reads CONFIG — Apps Script loads files
 * alphabetically and this keeps the reference lazy regardless of order.
 * @return {Object<string, {label:string, kind:string, table:string, orderBy:string}>}
 */
function rawSources_() {
  return {
    center_details: { label: 'Center Details', kind: 'bq', table: 'center_details', orderBy: 'CenterID' },
    cloud_devices: { label: 'Cloud Devices', kind: 'bq', table: 'cloud_devices', orderBy: 'DeviceID' },
    // Deliberately points at the raw table, not zohoDedupSql_() (Queries.js) —
    // this page's whole purpose is reconciliation against Zoho itself, so it
    // must show the true row count including the sync's duplicate inserts and
    // unassigned tickets, not a cleaned-up view that would disagree with
    // Zoho's own export.
    zoho_data: { label: 'Zoho Tickets', kind: 'bq', table: 'zoho_data', orderBy: 'ticketNumber' },
    jira_data: { label: 'Jira Devices', kind: 'bq', table: 'jira_data', orderBy: 'issue_key' }
    // Removed as user-facing sources: device_metrics (no other app usage),
    // device_center_mapping (still read internally by Geo.js). No Sheet
    // sources remain — the CS tracker Sheet was removed 2026-07-29 and the
    // Jira devices Sheet was removed 2026-07-30 (both replaced/dropped in
    // favor of live BigQuery data), so the Sheets-reading machinery
    // (SheetSource.js, the Sheets OAuth scope) was deleted entirely.
  };
}

/**
 * Whitelist-rebuilds the global filters object from a client `options.filters`
 * payload — same pattern as every other endpoint (EditionCD.js).
 * @param {Object} options
 * @return {Object}
 */
function rawFiltersFromOptions_(options) {
  var f = options.filters || {};
  return {
    segments: f.segments || [], statuses: f.statuses || [], states: f.states || [],
    hubs: f.hubs || [], cities: f.cities || [], countries: f.countries || [],
    deviceTypes: f.deviceTypes || [], deviceStatusExclude: f.deviceStatusExclude || [],
    dateFrom: String(f.dateFrom || ''), dateTo: String(f.dateTo || '')
  };
}

/**
 * Full WHERE clause (including the "WHERE" keyword) for one raw source, given
 * the current global filters. See the file-header note for which dimensions
 * each source actually supports.
 * @param {string} key
 * @param {Object} filters
 * @return {string}
 */
function rawSourceWhere_(key, filters) {
  if (key === 'center_details') {
    return 'WHERE ' + cdFilter_() + centerAttrCond_(filters) +
      dateRangeCond_('deploymentdate', filters.dateFrom, filters.dateTo);
  }
  if (key === 'cloud_devices') {
    return 'WHERE TRUE' + centerFilterSubqueryCond_(filters);
  }
  if (key === 'zoho_data') {
    return 'WHERE TRUE' + centerFilterSubqueryCond_(filters) +
      dateRangeCond_('CreatedAt', filters.dateFrom, filters.dateTo);
  }
  if (key === 'jira_data') {
    return 'WHERE TRUE' + multiCond_('issuetype_name', filters.deviceTypes) +
      multiCondNot_('status_name', filters.deviceStatusExclude) +
      dateRangeCond_('ticket_created', filters.dateFrom, filters.dateTo);
  }
  return 'WHERE TRUE';
}

/**
 * One page of raw rows for a single source.
 * @param {{source:string, page:number, pageSize:number, filters:Object=}} options
 * @return {{ok:boolean, data?:Object, error?:Object}}
 */
function apiGetRawPage(options) {
  options = options || {};
  var key = String(options.source || '');
  var page = Math.max(0, parseInt(options.page, 10) || 0);
  var pageSize = Math.min(500, Math.max(5, parseInt(options.pageSize, 10) || 25));
  var filters = rawFiltersFromOptions_(options);
  return respond_(function () {
    var def = rawSources_()[key];
    if (!def) throw new Error('Unknown raw source: ' + key);

    var sql = 'SELECT *, COUNT(*) OVER() AS total_rows FROM ' + T(def.table) + ' ' +
      rawSourceWhere_(key, filters) +
      ' ORDER BY ' + def.orderBy + ' LIMIT ' + pageSize + ' OFFSET ' + (page * pageSize);
    var rows = runQuery(sql);
    var total = rows.length ? rows[0].total_rows : 0;
    var columns = rows.length ? Object.keys(rows[0]).filter(function (c) { return c !== 'total_rows'; }) : [];
    rows.forEach(function (r) { delete r.total_rows; });
    return { rows: rows, columns: columns, totalRows: total, page: page, pageSize: pageSize };
  });
}

/**
 * Every row for a single source (up to RAW_EXPORT_MAX_ROWS), for CSV export.
 * @param {{source:string, filters:Object=}} options
 * @return {{ok:boolean, data?:Object, error?:Object}}
 */
function apiGetRawExport(options) {
  options = options || {};
  var key = String(options.source || '');
  var filters = rawFiltersFromOptions_(options);
  return respond_(function () {
    var def = rawSources_()[key];
    if (!def) throw new Error('Unknown raw source: ' + key);

    var where = rawSourceWhere_(key, filters);
    var totalRows = (runQuery('SELECT COUNT(*) AS n FROM ' + T(def.table) + ' ' + where)[0] || {}).n || 0;
    var sql = 'SELECT * FROM ' + T(def.table) + ' ' + where + ' ORDER BY ' + def.orderBy +
      ' LIMIT ' + RAW_EXPORT_MAX_ROWS;
    var rows = runQuery(sql, null, { maxRows: RAW_EXPORT_MAX_ROWS });
    var columns = rows.length ? Object.keys(rows[0]) : [];
    return { rows: rows, columns: columns, totalRows: totalRows, truncated: totalRows > rows.length };
  });
}
