/**
 * ProfileNewSources.js — TEMPORARY diagnostic, safe to delete once the Service
 * and TOM pages are designed.
 *
 * Why this exists: `servicewrk_Tickets` and `tom_tickets` are readable only by
 * the app's own service account (SA_KEY_DWH). A local `bq`/gcloud session on a
 * developer's Google identity gets Access Denied on both bigquery.jobs.create
 * and bigquery.tables.get for tricogde-dwh, so the tables cannot be profiled
 * from a workstation. Running this from the Apps Script editor borrows the
 * credential that already serves production.
 *
 * READ-ONLY: only SELECTs, only against INFORMATION_SCHEMA and the two tables.
 *
 * HOW TO RUN: open the Apps Script editor, pick a function in the dropdown,
 * press Run, then copy the whole execution log.
 *   profileNewSources() — schema, null rates, cardinality, top values (done)
 *   profileJoinKeys()   — can these tables actually be joined to the app? (next)
 */

/** Tables to profile. Add to this list if more new sources land. */
var PROFILE_TABLES_ = ['servicewrk_Tickets', 'tom_tickets'];

/** Column types that can't be fed to APPROX_COUNT_DISTINCT / MIN / MAX. */
var PROFILE_SKIP_TYPES_ = /^(STRUCT|ARRAY|RECORD|JSON|GEOGRAPHY)/i;

/** Types worth asking for a MIN/MAX range on. */
var PROFILE_RANGE_TYPES_ = /^(DATE|DATETIME|TIMESTAMP|TIME|INT64|INTEGER|FLOAT64|FLOAT|NUMERIC|BIGNUMERIC)/i;

/**
 * Profiles every table in PROFILE_TABLES_ and writes the result to the log:
 * column list + types, row count, per-column null rate and distinct count,
 * min/max for date and numeric columns, and top values for any column with
 * few enough distinct values to be a category.
 *
 * Each table is wrapped in its own try/catch so one inaccessible table doesn't
 * hide the other's profile — a permission error on ONE of them is itself a
 * finding worth seeing.
 */
function profileNewSources() {
  PROFILE_TABLES_.forEach(function (table) {
    Logger.log('\n═══════════════════════════════════════════════');
    Logger.log('TABLE: ' + CONFIG.BQ_DATASET + '.' + table);
    Logger.log('═══════════════════════════════════════════════');
    try {
      profileOneTable_(table);
    } catch (err) {
      Logger.log('FAILED: ' + err.message);
    }
  });
  Logger.log('\n=== profile complete ===');
}

/** @param {string} table bare table name inside CONFIG.BQ_DATASET */
function profileOneTable_(table) {
  var fq = '`' + CONFIG.BQ_DATASET + '.' + table + '`';

  // ── 1. Schema ────────────────────────────────────────────────────────────
  var cols = runQuery(
    'SELECT column_name, data_type FROM `' + CONFIG.BQ_DATASET +
    '.INFORMATION_SCHEMA.COLUMNS` WHERE table_name = @t ORDER BY ordinal_position',
    { t: table }, { maxRows: 500 }) || [];

  if (!cols.length) {
    Logger.log('No columns returned — table missing, or the service account cannot see it.');
    return;
  }
  Logger.log('COLUMNS (' + cols.length + '):');
  Logger.log(cols.map(function (c) { return c.column_name + ' ' + c.data_type; }).join(' | '));

  // ── 2. Row count + per-column null / distinct / range ────────────────────
  // One pass over the table for everything: a table this wide would otherwise
  // cost one full scan per column.
  var parts = ['COUNT(*) AS row_count'];
  var profiled = [];
  cols.forEach(function (c, i) {
    if (PROFILE_SKIP_TYPES_.test(c.data_type)) return;
    var q = '`' + c.column_name + '`';
    var a = 'c' + i;
    parts.push('COUNTIF(' + q + ' IS NULL) AS ' + a + '_nulls');
    parts.push('APPROX_COUNT_DISTINCT(' + q + ') AS ' + a + '_distinct');
    if (PROFILE_RANGE_TYPES_.test(c.data_type)) {
      parts.push('CAST(MIN(' + q + ') AS STRING) AS ' + a + '_min');
      parts.push('CAST(MAX(' + q + ') AS STRING) AS ' + a + '_max');
    }
    profiled.push({ col: c.column_name, type: c.data_type, alias: a });
  });

  var stats = (runQuery('SELECT ' + parts.join(', ') + ' FROM ' + fq, null, { maxRows: 1 }) || [])[0] || {};
  var total = Number(stats.row_count || 0);
  Logger.log('\nROW COUNT: ' + total);
  Logger.log('\nPER-COLUMN (name | type | null% | distinct | min → max):');
  profiled.forEach(function (p) {
    var nulls = Number(stats[p.alias + '_nulls'] || 0);
    var pct = total ? Math.round((nulls / total) * 1000) / 10 : 0;
    var range = (stats[p.alias + '_min'] !== undefined)
      ? ' | ' + stats[p.alias + '_min'] + ' → ' + stats[p.alias + '_max'] : '';
    Logger.log(p.col + ' | ' + p.type + ' | ' + pct + '% null | ' +
      stats[p.alias + '_distinct'] + ' distinct' + range);
  });

  // ── 3. Top values for the categorical columns ────────────────────────────
  // Anything with <= 25 distinct values is a status/type/category worth charting;
  // that threshold is what separates a dimension from free text or an id.
  var cats = profiled.filter(function (p) {
    var d = Number(stats[p.alias + '_distinct'] || 0);
    return d > 0 && d <= 25 && !PROFILE_RANGE_TYPES_.test(p.type);
  });
  if (cats.length) {
    Logger.log('\nCATEGORY COLUMNS — top values:');
    cats.forEach(function (p) {
      try {
        var rows = runQuery(
          'SELECT CAST(`' + p.col + '` AS STRING) AS v, COUNT(*) AS n FROM ' + fq +
          ' GROUP BY v ORDER BY n DESC LIMIT 25', null, { maxRows: 25 }) || [];
        Logger.log(p.col + ': ' + rows.map(function (r) {
          return (r.v === null ? '(null)' : r.v) + '=' + r.n;
        }).join(', '));
      } catch (e) {
        Logger.log(p.col + ': (failed — ' + e.message + ')');
      }
    });
  }

  // ── 4. Two sample rows, so the shape of the real values is visible ───────
  try {
    var sample = runQuery('SELECT * FROM ' + fq + ' LIMIT 2', null, { maxRows: 2 }) || [];
    Logger.log('\nSAMPLE ROWS:');
    sample.forEach(function (r, i) { Logger.log('[' + i + '] ' + JSON.stringify(r)); });
  } catch (e) {
    Logger.log('\nSAMPLE ROWS failed: ' + e.message);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   PASS 2 — the questions the first profile raised but could not answer.
   Every check is its own try/catch: one bad column name must not cost the
   whole run, because each round trip here needs a human to press Run.
   ═══════════════════════════════════════════════════════════════════════════ */

var SW_ = '`' + 'tricogde-dwh.abi_tables' + '.servicewrk_Tickets`';
var TOM_ = '`' + 'tricogde-dwh.abi_tables' + '.tom_tickets`';

/** Runs one labelled check and logs its single result row. */
function jcheck_(label, sql) {
  try {
    var rows = runQuery(sql, null, { maxRows: 30 }) || [];
    Logger.log('\n── ' + label + ' ──');
    rows.forEach(function (r) { Logger.log(JSON.stringify(r)); });
    if (!rows.length) Logger.log('(no rows)');
  } catch (e) {
    Logger.log('\n── ' + label + ' ── FAILED: ' + e.message);
  }
}

/**
 * Answers the four questions that decide whether these tables can back a page:
 *   1. Do their customer/center keys actually resolve to center_details?
 *   2. Do their zoho references actually resolve to zoho_data?
 *   3. Are the timestamps real, or date-only (decides if downtime intervals
 *      can be merged at hour grain the way M-A1 does today)?
 *   4. How much of ServiceWRK is device FAILURE work, over what window, versus
 *      the Zoho proxy the uptime engine uses now?
 */
function profileJoinKeys() {
  var CD = T('center_details');
  var ZD = zohoDedupSql_();

  Logger.log('═══ 1. KEY RESOLUTION ═══');

  jcheck_('servicewrk.customer_id — shape of the real values',
    'SELECT customer_id, COUNT(*) AS n FROM ' + SW_ +
    ' WHERE customer_id IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 10');

  jcheck_('servicewrk.customer_id vs center_details.CenterID',
    'SELECT COUNT(*) AS sw_rows,' +
    ' COUNTIF(customer_id IS NOT NULL) AS has_customer_id,' +
    ' COUNTIF(REGEXP_CONTAINS(customer_id, r"^[0-9]+$")) AS numeric_looking,' +
    ' COUNTIF(customer_id IN (SELECT CAST(CenterID AS STRING) FROM ' + CD + ')) AS resolves_to_center,' +
    ' COUNT(DISTINCT IF(customer_id IN (SELECT CAST(CenterID AS STRING) FROM ' + CD + '), customer_id, NULL)) AS distinct_centers_hit' +
    ' FROM ' + SW_);

  jcheck_('servicewrk.serial_number vs center_details / cloud_devices serials',
    'SELECT COUNT(*) AS sw_rows,' +
    ' COUNTIF(serial_number IS NOT NULL) AS has_serial,' +
    ' COUNTIF(serial_number IN (SELECT CAST(DeviceID AS STRING) FROM ' + T('cloud_devices') + ')) AS in_cloud_devices,' +
    ' COUNTIF(serial_number IN (SELECT CAST(DeviceID AS STRING) FROM ' + CD + ')) AS in_center_details_device,' +
    ' COUNTIF(serial_number IN (SELECT CAST(MacSerialID AS STRING) FROM ' + CD + ')) AS in_center_details_mac' +
    ' FROM ' + SW_);

  jcheck_('tom_tickets.center_id vs center_details.CenterID',
    'SELECT COUNT(*) AS tom_rows,' +
    ' COUNTIF(center_id IS NOT NULL) AS has_center_id,' +
    ' COUNTIF(REGEXP_CONTAINS(center_id, r"^[0-9]+$")) AS numeric_looking,' +
    ' COUNTIF(center_id IN (SELECT CAST(CenterID AS STRING) FROM ' + CD + ')) AS resolves_to_center' +
    ' FROM ' + TOM_);

  jcheck_('tom_tickets.center_id — shape of the real values',
    'SELECT center_id, center_name, COUNT(*) AS n FROM ' + TOM_ +
    ' WHERE center_id IS NOT NULL GROUP BY 1,2 ORDER BY n DESC LIMIT 10');

  Logger.log('\n═══ 2. ZOHO CROSS-REFERENCE ═══');

  jcheck_('servicewrk.zoho_ticket vs zoho_data.ticketNumber',
    'SELECT COUNT(*) AS sw_rows,' +
    ' COUNTIF(zoho_ticket IS NOT NULL) AS has_zoho_ref,' +
    ' COUNTIF(REGEXP_REPLACE(IFNULL(zoho_ticket, ""), r"[^0-9]", "") IN' +
    '   (SELECT CAST(ticketNumber AS STRING) FROM ' + ZD + ')) AS resolves_to_zoho' +
    ' FROM ' + SW_);

  jcheck_('tom_tickets.zoho_id vs zoho_data.ticketNumber',
    'SELECT COUNT(*) AS tom_rows,' +
    ' COUNTIF(zoho_id IS NOT NULL) AS has_zoho_ref,' +
    ' COUNTIF(REGEXP_REPLACE(IFNULL(zoho_id, ""), r"[^0-9]", "") IN' +
    '   (SELECT CAST(ticketNumber AS STRING) FROM ' + ZD + ')) AS resolves_to_zoho' +
    ' FROM ' + TOM_);

  Logger.log('\n═══ 3. ARE THE TIMESTAMPS REAL? ═══');

  jcheck_('servicewrk — time-of-day present, and closed-before-created rows',
    'SELECT COUNT(*) AS n,' +
    ' COUNTIF(TIME(created_on) != "00:00:00") AS created_has_time,' +
    ' COUNTIF(TIME(closed_date) != "00:00:00") AS closed_has_time,' +
    ' COUNTIF(closed_date < created_on) AS closed_before_created,' +
    ' COUNTIF(tat_days_ < 0) AS negative_tat,' +
    ' ROUND(AVG(tat_days_), 2) AS avg_tat_days,' +
    ' ROUND(APPROX_QUANTILES(tat_days_, 100)[OFFSET(50)], 2) AS median_tat_days' +
    ' FROM ' + SW_);

  jcheck_('tom_tickets — time-of-day present, and closed-before-received rows',
    'SELECT COUNT(*) AS n,' +
    ' COUNTIF(TIME(received_date) != "00:00:00") AS received_has_time,' +
    ' COUNTIF(TIME(closed_date) != "00:00:00") AS closed_has_time,' +
    ' COUNTIF(closed_date < received_date) AS closed_before_received,' +
    ' ROUND(AVG(tat_days_), 2) AS avg_tat_days' +
    ' FROM ' + TOM_);

  Logger.log('\n═══ 4. UPTIME-SWAP FEASIBILITY ═══');

  jcheck_('servicewrk — failure-type volume per year, and how much maps to a center',
    'SELECT EXTRACT(YEAR FROM created_on) AS yr,' +
    ' COUNT(*) AS all_tickets,' +
    ' COUNTIF(ticket_type = "BREAKDOWN") AS breakdown,' +
    ' COUNTIF(ticket_type = "BREAKDOWN" AND customer_id IN' +
    '   (SELECT CAST(CenterID AS STRING) FROM ' + CD + ')) AS breakdown_with_center' +
    ' FROM ' + SW_ + ' GROUP BY yr ORDER BY yr');

  jcheck_('zoho_data — the proxy the uptime engine uses TODAY, for comparison',
    'SELECT EXTRACT(YEAR FROM CreatedAt) AS yr, COUNT(*) AS tickets,' +
    ' COUNTIF(' + techBoolSql_('IFNULL(IssueCategory,"")') + ') AS tech_failure_tickets,' +
    ' COUNT(DISTINCT CenterID) AS centers' +
    ' FROM ' + ZD + ' WHERE CreatedAt IS NOT NULL GROUP BY yr ORDER BY yr');

  Logger.log('\n=== join-key profile complete ===');
}
