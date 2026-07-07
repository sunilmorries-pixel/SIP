/**
 * SheetSource.js — reads the CS/Service field tracker Google Sheet and
 * aggregates it for the Support/CS view.
 *
 * Sheet grain: 1 row per resolved service case. Columns include
 * Received/Closed dates, Zoho ID, Center, Machine & DeviceType, Issue Type,
 * CS team member and TAT (days). See docs/SOURCES.md.
 *
 * The web app executes as the deploying user, who must have Viewer access on
 * the sheet.
 *
 * Read via the Sheets REST API (not SpreadsheetApp): SpreadsheetApp.openById
 * requires the FULL read-write spreadsheets scope, while the REST API accepts
 * the least-privilege spreadsheets.readonly scope declared in appsscript.json.
 */

/**
 * Reads and aggregates the tracker. Returns null on failure so the rest of
 * the dashboard still renders (the client shows an empty state).
 * @return {?{kpis:Object, tatByMonth:Array, byMachine:Array,
 *            byIssueType:Array, byOwner:Array}}
 */
function readCsTracker() {
  var values;
  try {
    var url = 'https://sheets.googleapis.com/v4/spreadsheets/' +
      CONFIG.CS_SHEET_ID + '/values/A:Z?majorDimension=ROWS';
    var response = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    var data = JSON.parse(response.getContentText());
    if (response.getResponseCode() >= 400) {
      throw new Error((data.error && data.error.message) || 'HTTP ' + response.getResponseCode());
    }
    values = data.values;
  } catch (err) {
    console.error('CS tracker sheet unreadable: ' + err.message);
    return null;
  }
  if (!values || values.length < 2) return null;

  var col = headerIndex_(values[0]);
  var rows = values.slice(1);

  var totalCases = 0, tatSum = 0, tatCount = 0;
  var months = {}, machines = {}, issueTypes = {}, owners = {};

  rows.forEach(function (row) {
    // REST API omits trailing empty cells, so short/blank rows are normal.
    var received = row[col.received];
    if (!received && !row[col.zoho]) return; // blank padding row
    totalCases++;

    var tat = Number(row[col.tat]);
    var hasTat = row[col.tat] !== '' && !isNaN(tat);
    if (hasTat) { tatSum += tat; tatCount++; }

    var monthKey = toMonthKey_(received);
    if (monthKey) {
      var m = months[monthKey] || (months[monthKey] = { cases: 0, tatSum: 0, tatN: 0 });
      m.cases++;
      if (hasTat) { m.tatSum += tat; m.tatN++; }
    }

    bump_(machines, row[col.machine]);
    bump_(issueTypes, row[col.issueType]);

    var owner = String(row[col.owner] || '').trim();
    if (owner) {
      var o = owners[owner] || (owners[owner] = { cases: 0, tatSum: 0, tatN: 0 });
      o.cases++;
      if (hasTat) { o.tatSum += tat; o.tatN++; }
    }
  });

  return {
    kpis: {
      total_cases: totalCases,
      avg_tat_days: tatCount ? Math.round((tatSum / tatCount) * 10) / 10 : null,
      owners: Object.keys(owners).length
    },
    tatByMonth: Object.keys(months).sort().slice(-12).map(function (key) {
      var m = months[key];
      return {
        month: key,
        cases: m.cases,
        avg_tat: m.tatN ? Math.round((m.tatSum / m.tatN) * 10) / 10 : null
      };
    }),
    byMachine: topEntries_(machines, 8),
    byIssueType: topEntries_(issueTypes, 8),
    byOwner: Object.keys(owners).map(function (name) {
      var o = owners[name];
      return {
        owner: name,
        cases: o.cases,
        avg_tat: o.tatN ? Math.round((o.tatSum / o.tatN) * 10) / 10 : null
      };
    }).sort(function (a, b) { return b.cases - a.cases; }).slice(0, 10)
  };
}

/**
 * Reads the Jira devices Google Sheet (CONFIG.JIRA_SHEET_ID) — the replacement
 * for the jira_data BQ table. Columns are expected identical to jira_data
 * (issue_key, summary, customerid, status_name, issuetype_name, ticket_created);
 * headers are matched tolerantly (case/spacing/underscores ignored).
 * @return {?Array<Object>} row objects, or null if the sheet is unreadable.
 */
function readJiraSheet() {
  var values;
  try {
    var url = 'https://sheets.googleapis.com/v4/spreadsheets/' +
      CONFIG.JIRA_SHEET_ID + '/values/A:Z?majorDimension=ROWS';
    var response = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    var data = JSON.parse(response.getContentText());
    if (response.getResponseCode() >= 400) {
      throw new Error((data.error && data.error.message) || 'HTTP ' + response.getResponseCode());
    }
    values = data.values;
  } catch (err) {
    console.error('Jira sheet unreadable: ' + err.message);
    return null;
  }
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

/** Maps expected headers to column indexes, tolerant of spacing/case drift. */
function headerIndex_(headerRow) {
  var normalized = headerRow.map(function (h) {
    return String(h).toLowerCase().replace(/[^a-z]/g, '');
  });
  function find(fragment, fallback) {
    var i = normalized.findIndex(function (h) { return h.indexOf(fragment) !== -1; });
    return i === -1 ? fallback : i;
  }
  return {
    owner: find('tom', 0),
    received: find('receiveddate', 1),
    zoho: find('zohoid', 3),
    machine: find('machine', 8),
    issueType: find('issuetype', 9),
    tat: find('tat', 16)
  };
}

/** @return {?string} 'YYYY-MM' from a Date or M/D/YYYY string */
function toMonthKey_(value) {
  var date = (value instanceof Date) ? value : new Date(String(value));
  if (isNaN(date)) return null;
  return date.getFullYear() + '-' + ('0' + (date.getMonth() + 1)).slice(-2);
}

function bump_(map, rawKey) {
  var key = String(rawKey || '').trim() || 'Unknown';
  map[key] = (map[key] || 0) + 1;
}

/** @return {Array<{label:string, cnt:number}>} top-N of a counter map */
function topEntries_(map, n) {
  return Object.keys(map)
    .map(function (key) { return { label: key, cnt: map[key] }; })
    .sort(function (a, b) { return b.cnt - a.cnt; })
    .slice(0, n);
}
