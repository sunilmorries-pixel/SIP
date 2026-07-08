/**
 * RawData.js — raw, unfiltered per-source tables for the "Raw Data" page.
 * By design, NO site filters apply here (no F2P exclusion, no Active-centers
 * toggle, no hub/segment/search) — this page exists purely for source
 * reconciliation and full-table export, straight from each source.
 */

var RAW_EXPORT_MAX_ROWS = 100000;

/**
 * Registry of every raw source the page exposes. A function (not a
 * top-level const) because it reads CONFIG — Apps Script loads files
 * alphabetically and this keeps the reference lazy regardless of order.
 * @return {Object<string, {label:string, kind:string, table?:string, orderBy?:string, sheetId?:string}>}
 */
function rawSources_() {
  return {
    center_details: { label: 'Center Details', kind: 'bq', table: 'center_details', orderBy: 'CenterID' },
    cloud_devices: { label: 'Cloud Devices', kind: 'bq', table: 'cloud_devices', orderBy: 'DeviceID' },
    zoho_data: { label: 'Zoho Tickets', kind: 'bq', table: 'zoho_data', orderBy: 'ticketNumber' },
    device_metrics: { label: 'Device Metrics', kind: 'bq', table: 'device_metrics', orderBy: 'deviceid' },
    device_center_mapping: { label: 'Device-Center Mapping (legacy)', kind: 'bq', table: 'device_center_mapping', orderBy: 'deviceid, startdatetime' },
    jira_data: { label: 'Jira Issues (legacy BQ)', kind: 'bq', table: 'jira_data', orderBy: 'issue_key' },
    jira_sheet: { label: 'Jira Devices (Sheet)', kind: 'sheet', sheetId: CONFIG.JIRA_SHEET_ID },
    cs_tracker: { label: 'CS Tracker (Sheet)', kind: 'sheet', sheetId: CONFIG.CS_SHEET_ID }
  };
}

/**
 * One page of raw rows for a single source, no filters applied.
 * @param {{source:string, page:number, pageSize:number}} options
 * @return {{ok:boolean, data?:Object, error?:Object}}
 */
function apiGetRawPage(options) {
  options = options || {};
  var key = String(options.source || '');
  var page = Math.max(0, parseInt(options.page, 10) || 0);
  var pageSize = Math.min(500, Math.max(5, parseInt(options.pageSize, 10) || 25));
  return respond_(function () {
    var def = rawSources_()[key];
    if (!def) throw new Error('Unknown raw source: ' + key);

    if (def.kind === 'bq') {
      var sql = 'SELECT *, COUNT(*) OVER() AS total_rows FROM ' + T(def.table) +
        ' ORDER BY ' + def.orderBy + ' LIMIT ' + pageSize + ' OFFSET ' + (page * pageSize);
      var rows = runQuery(sql);
      var total = rows.length ? rows[0].total_rows : 0;
      var columns = rows.length ? Object.keys(rows[0]).filter(function (c) { return c !== 'total_rows'; }) : [];
      rows.forEach(function (r) { delete r.total_rows; });
      return { rows: rows, columns: columns, totalRows: total, page: page, pageSize: pageSize };
    }

    var sheet = readRawSheetRows_(def.sheetId);
    var slice = sheet.rows.slice(page * pageSize, page * pageSize + pageSize);
    return { rows: slice, columns: sheet.columns, totalRows: sheet.rows.length, page: page, pageSize: pageSize };
  });
}

/**
 * Every row for a single source (up to RAW_EXPORT_MAX_ROWS), for CSV export.
 * @param {{source:string}} options
 * @return {{ok:boolean, data?:Object, error?:Object}}
 */
function apiGetRawExport(options) {
  options = options || {};
  var key = String(options.source || '');
  return respond_(function () {
    var def = rawSources_()[key];
    if (!def) throw new Error('Unknown raw source: ' + key);

    if (def.kind === 'bq') {
      var totalRows = (runQuery('SELECT COUNT(*) AS n FROM ' + T(def.table))[0] || {}).n || 0;
      var sql = 'SELECT * FROM ' + T(def.table) + ' ORDER BY ' + def.orderBy +
        ' LIMIT ' + RAW_EXPORT_MAX_ROWS;
      var rows = runQuery(sql, null, { maxRows: RAW_EXPORT_MAX_ROWS });
      var columns = rows.length ? Object.keys(rows[0]) : [];
      return { rows: rows, columns: columns, totalRows: totalRows, truncated: totalRows > rows.length };
    }

    var sheet = readRawSheetRows_(def.sheetId);
    return { rows: sheet.rows, columns: sheet.columns, totalRows: sheet.rows.length, truncated: false };
  });
}
