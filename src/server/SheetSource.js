/**
 * SheetSource.js — reads the Jira devices Google Sheet and provides a
 * generic full-fidelity reader for the Raw Data page.
 *
 * The web app executes as the deploying user, who must have Viewer access on
 * the sheet.
 *
 * Read via the Sheets REST API (not SpreadsheetApp): SpreadsheetApp.openById
 * requires the FULL read-write spreadsheets scope, while the REST API accepts
 * the least-privilege spreadsheets.readonly scope declared in appsscript.json.
 */

/**
 * Sheets-REST fetch with NEGATIVE caching. While the Sheets API is disabled
 * (or a sheet unshared), every cold dashboard/exec load was paying 1-4s of
 * guaranteed-403 UrlFetch calls; on failure we remember the outage for 10 min
 * and fail fast instead.
 * @param {string} sheetId
 * @param {string} label for the error log
 * @return {?Array<Array>} values or null
 */
function fetchSheetValues_(sheetId, label) {
  var cache = CacheService.getScriptCache();
  var downKey = 'sheetdown_' + sheetId.slice(0, 12);
  if (cache.get(downKey)) return null; // known-down: skip the doomed fetch
  try {
    var url = 'https://sheets.googleapis.com/v4/spreadsheets/' +
      sheetId + '/values/A:Z?majorDimension=ROWS';
    var response = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    var data = JSON.parse(response.getContentText());
    if (response.getResponseCode() >= 400) {
      throw new Error((data.error && data.error.message) || 'HTTP ' + response.getResponseCode());
    }
    return data.values || null;
  } catch (err) {
    console.error(label + ' sheet unreadable: ' + err.message);
    try { cache.put(downKey, '1', 600); } catch (e) { /* best effort */ }
    return null;
  }
}

/**
 * Reads the Jira devices Google Sheet (CONFIG.JIRA_SHEET_ID) — the replacement
 * for the jira_data BQ table. Columns are expected identical to jira_data
 * (issue_key, summary, customerid, status_name, issuetype_name, ticket_created);
 * headers are matched tolerantly (case/spacing/underscores ignored).
 * @return {?Array<Object>} row objects, or null if the sheet is unreadable.
 */
function readJiraSheet() {
  var values = fetchSheetValues_(CONFIG.JIRA_SHEET_ID, 'Jira devices');
  if (!values || values.length < 2) return null;

  var norm = values[0].map(function (h) { return String(h).toLowerCase().replace(/[^a-z0-9]/g, ''); });
  function col(frag) { return norm.findIndex(function (h) { return h.indexOf(frag) !== -1; }); }
  function first() { for (var i = 0; i < arguments.length; i++) { var x = col(arguments[i]); if (x !== -1) return x; } return -1; }
  // Sheet headers (verified) differ from jira_data: Key / Issue Type / Summary /
  // Status / Created / Customer ID. Match tolerantly, most-specific fragment first.
  var ci = {
    issue_key: first('issuekey', 'key'), summary: col('summary'), customerid: col('customerid'),
    status_name: first('statusname', 'status'), issuetype_name: first('issuetypename', 'issuetype'),
    ticket_created: first('ticketcreated', 'created')
  };
  function get(row, i) { return i >= 0 && row[i] != null ? row[i] : ''; }

  return values.slice(1).map(function (r) {
    return {
      issue_key: get(r, ci.issue_key), summary: get(r, ci.summary),
      customerid: get(r, ci.customerid), status_name: get(r, ci.status_name),
      issuetype_name: get(r, ci.issuetype_name), ticket_created: get(r, ci.ticket_created)
    };
  }).filter(function (o) { return o.issue_key || o.summary; });
}

/**
 * Generic full-fidelity sheet reader for the Raw Data page. Unlike
 * readJiraSheet() (which tolerant-maps a handful of named fields), this
 * returns EVERY column using the sheet's own header row as keys — used only
 * by RawData.js's raw/export endpoints.
 * @param {string} sheetId
 * @return {{columns:Array<string>, rows:Array<Object>}}
 */
function readRawSheetRows_(sheetId) {
  var cacheKey = 'rawsheet_v1_' + sheetId;
  var cached = cacheGetLarge(cacheKey);
  if (cached) return cached;

  var url = 'https://sheets.googleapis.com/v4/spreadsheets/' +
    sheetId + '/values/A:ZZ?majorDimension=ROWS';
  var response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  var data = JSON.parse(response.getContentText());
  if (response.getResponseCode() >= 400) {
    throw new Error('Sheet ' + sheetId + ' unreadable: ' +
      ((data.error && data.error.message) || 'HTTP ' + response.getResponseCode()));
  }
  var values = data.values;
  if (!values || values.length < 1) {
    return { columns: [], rows: [] };
  }
  var columns = values[0].map(function (h, i) { return String(h || '').trim() || ('Column ' + (i + 1)); });
  var rows = values.slice(1).map(function (r) {
    var obj = {};
    columns.forEach(function (c, i) { obj[c] = r[i] != null ? r[i] : ''; });
    return obj;
  });
  var result = { columns: columns, rows: rows };
  cachePutLarge(cacheKey, result, 600);
  return result;
}
