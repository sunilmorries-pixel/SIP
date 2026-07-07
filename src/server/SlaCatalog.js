/**
 * SlaCatalog.js — canonical Ticket Type → SLA mapping (provided by CS team).
 *
 * Each entry: { name, days, tech }
 *   days  — SLA target in DAYS (the actionable number; the human "SLA" string
 *           like "48 hrs" / "5 Days" is derived from this for display).
 *   tech  — true = Tech (device/hardware/network), false = Non-Tech (admin/
 *           billing/reporting). This is the AUTHORITATIVE Tech classification,
 *           preferred over CONFIG.FAILURE_CATEGORY_REGEX where a row exists.
 *
 * Matching (slaFor): case-insensitive exact match on IssueCategory first; if no
 * row exists, fall back to a keyword heuristic for `tech` + CONFIG.SLA_DEFAULT_DAYS.
 * Names mirror zoho_data.IssueCategory; several high-volume live categories have
 * no row yet (Data Update Query, Report Related Query, MAC 600 Machine Issue,
 * Tricog Device Network/Hardware Issue) and rely on the fallback.
 */
var SLA_CATALOG = [
  { name: 'Doctor Signature/Qualification Request', days: 2, tech: false },
  { name: 'Billing Query', days: 2, tech: false },
  { name: 'New Contract Request', days: 3, tech: false },
  { name: 'Acquisition Delay -Network Issue', days: 4, tech: true },
  { name: 'Prepaid Recharge Request', days: 2, tech: false },
  { name: 'Urgent Report Request', days: 1, tech: false },
  { name: 'Battery', days: 6, tech: true },
  { name: 'Network -Sim Card Issue', days: 6, tech: true },
  { name: 'Billing Name Change', days: 2, tech: false },
  { name: 'Duplicate Ticket', days: 30, tech: false },
  { name: 'Lead cable', days: 6, tech: true },
  { name: 'Spoke Change Request', days: 5, tech: true },
  { name: 'Add Contact', days: 2, tech: false },
  { name: 'Report Not Received', days: 1, tech: false },
  { name: 'Report Not received via/Mail/SMS/App', days: 2, tech: false },
  { name: 'Junk Mail - Not a Relevant Query', days: 30, tech: false },
  { name: 'OTG Cable', days: 6, tech: true },
  { name: 'ECG Paper', days: 8, tech: false },
  { name: 'Trilink Issue', days: 1, tech: true },
  { name: 'Request for ownership Transfer', days: 4, tech: false },
  { name: 'Service Request', days: 7, tech: true },
  { name: 'Remove Contact', days: 1, tech: false },
  { name: 'Deactivation Request', days: 10, tech: false },
  { name: 'V-Cardia lead cable issue', days: 6, tech: true },
  { name: 'Limb Lead / Chest Lead Reversal', days: 5, tech: true },
  { name: 'Customer Portal Issue', days: 1, tech: false },
  { name: 'Power Adapter Full Set', days: 6, tech: true },
  { name: 'Delayed Reporting By Med Team', days: 1, tech: false },
  { name: 'Logo Request', days: 1, tech: false },
  { name: 'Clarification of ECG Report/Diagnosis', days: 2, tech: false },
  { name: 'Keypad', days: 5, tech: true },
  { name: 'Acquisition Delay -WIFI Issue', days: 5, tech: true },
  { name: 'Software Issue', days: 5, tech: true },
  { name: 'Printer', days: 5, tech: true },
  { name: 'V-Cardia App Issue', days: 2, tech: false },
  { name: 'Change Of Customer/Company Name/Address', days: 5, tech: false },
  { name: 'Spare Inventory', days: 6, tech: true },
  { name: 'V-Cardia keypad', days: 6, tech: true },
  { name: 'Training Request', days: 6, tech: true },
  { name: 'Display', days: 6, tech: true },
  { name: 'Temporary Suspension', days: 5, tech: false },
  { name: 'Report Missing', days: 2, tech: false },
  { name: 'Poor Quality/Repeat ECG', days: 5, tech: true },
  { name: 'Power Adapter Damage', days: 6, tech: true },
  { name: 'Camp Request', days: 5, tech: false },
  { name: 'ECG Billing Clarity', days: 3, tech: false },
  { name: 'Machine Water Clogging Damage', days: 6, tech: true },
  { name: 'Monthly Invoice Request', days: 3, tech: false },
  { name: 'Temporary swapping', days: 6, tech: true },
  { name: 'Activation/Installation Request', days: 6, tech: true },
  { name: 'Payment Collection', days: 8, tech: false },
  { name: 'Bulbs/ Clamps', days: 3, tech: true },
  { name: 'Delay in Reporting due to Downtime', days: 1, tech: false },
  { name: 'V-Cardia machine replaced', days: 6, tech: true },
  { name: 'Tricog Document Request', days: 4, tech: false },
  { name: 'Business/Sales Query', days: 3, tech: false },
  { name: 'Gel Bottle', days: 6, tech: false },
  { name: 'Product Training Request', days: 2, tech: false },
  { name: 'Lead Cable Damage', days: 5, tech: true },
  { name: 'Mother Board', days: 5, tech: true },
  { name: 'Connector /Serial/Charging Pin', days: 6, tech: true },
  { name: 'International Demo Swapping', days: 1, tech: true },
  { name: 'Close clone-Age Issue', days: 1, tech: false },
  { name: 'Software issue/API error', days: 2, tech: false },
  { name: 'Wrongly Mapped Device/Machine', days: 1, tech: false },
  { name: 'Power Adapter', days: 6, tech: true },
  { name: 'Print Issue', days: 6, tech: true },
  { name: 'Cardio Net access', days: 1, tech: false },
  { name: 'HR-Query', days: 2, tech: false },
  { name: 'Hubbr credentials', days: 1, tech: false },
  { name: 'Feed Back Ticket', days: 2, tech: false },
  { name: 'Antenna', days: 4, tech: true },
  { name: 'UPS Issue', days: 35, tech: true },
  { name: 'Demo Request', days: 1, tech: true },
  { name: 'Echo Data Upload', days: 1, tech: false },
  { name: 'Critical Call Concerns', days: 4, tech: false },
  { name: 'Calibration Certificate', days: 3, tech: true },
  { name: 'Phone Issue', days: 5, tech: false },
  { name: 'Equipment Stolen/misplaced', days: 10, tech: false },
  { name: 'Skip Echo case', days: 2, tech: false },
  { name: 'Mac 600 To V-Cardia(Swapping)', days: 5, tech: true },
  { name: 'V-Cardia Logs', days: 5, tech: true },
  { name: 'Junk', days: 2, tech: false },
  { name: 'Machine issue', days: 5, tech: true },
  { name: 'Power Chord', days: 6, tech: true },
  { name: 'Mobile Compatibly Issue', days: 5, tech: false },
  { name: 'AMC - CMC Request', days: 5, tech: true },
  { name: 'Plan Change Request', days: 3, tech: false },
  { name: 'Change in billing plan', days: 3, tech: false },
  { name: 'IVR Critical Call', days: 3, tech: false },
  { name: 'Expansion Order', days: 10, tech: false },
  { name: 'Digitization Request', days: 3, tech: false },
  { name: 'Printer Roller Missing', days: 5, tech: true },
  { name: 'Product Enhancement/Data Request', days: 15, tech: false },
  { name: 'Hard/ software reset button', days: 6, tech: true },
  { name: 'New Process Update', days: 2, tech: false },
  { name: 'IT Related issue', days: 2, tech: false },
  { name: 'Barcode Activation', days: 3, tech: true },
  { name: 'Mac Battery Pin', days: 6, tech: true },
  { name: 'Sim card Tray', days: 6, tech: true },
  { name: 'Phone Stolen', days: 10, tech: false },
  { name: 'General Report Related Query', days: 3, tech: false },
  { name: 'Urgent Report Request-ECHO', days: 1, tech: false },
  { name: 'Urgent Report Request-ECG', days: 1, tech: false },
  { name: 'Clarification of ECG Report/Diagnosis-ECHO', days: 1, tech: false },
  { name: 'Clarification of ECG Report/Diagnosis-ECG', days: 1, tech: false },
  { name: 'Clarification of ReportDiagnosis-ECHO', days: 1, tech: false },
  { name: 'Churn Pickup', days: 15, tech: false },
  { name: 'NPA MH', days: 5, tech: true },
  { name: 'NPA', days: 5, tech: false },
  { name: 'Ethernet/USB Cable-TR 200', days: 5, tech: true },
  { name: 'Refund Request', days: 5, tech: false },
  { name: 'TABLET ISSUE', days: 15, tech: true },
  { name: 'ECG-Clarification of Report Diagnosis', days: 1, tech: false },
  { name: 'ECHO-Clarification of Report Diagnosis', days: 1, tech: false },
  { name: 'TAT Discrepancy', days: 5, tech: false }
];

/** Lazy case-insensitive lookup index (built once per execution). */
var SLA_INDEX_ = null;
function slaIndex_() {
  if (!SLA_INDEX_) {
    SLA_INDEX_ = {};
    SLA_CATALOG.forEach(function (r) { SLA_INDEX_[r.name.trim().toLowerCase()] = r; });
  }
  return SLA_INDEX_;
}

/**
 * Resolve SLA + Tech classification for an IssueCategory.
 * @param {string} category zoho_data.IssueCategory
 * @return {{days:number, tech:boolean, matched:boolean}}
 */
function slaFor(category) {
  var key = String(category || '').trim().toLowerCase();
  var hit = slaIndex_()[key];
  if (hit) return { days: hit.days, tech: hit.tech, matched: true };
  // Fallback: infer Tech from hardware/network keywords; default SLA target.
  var tech = new RegExp(CONFIG.TECH_FALLBACK_REGEX).test(key);
  return { days: CONFIG.SLA_DEFAULT_DAYS, tech: tech, matched: false };
}

/** Human SLA label from a day count, e.g. 2 → "2 days", 1 → "1 day". */
function slaLabel(days) {
  return days + (days === 1 ? ' day' : ' days');
}

/* ═════════════════ SQL fragment generators ══════════════════════════════
 * These let BigQuery apply the catalog directly (per-ticket sla_days + the
 * Tech classification) so aggregation stays server-side.
 * ────────────────────────────────────────────────────────────────────── */

/** Escape a JS string for a single-quoted SQL literal. */
function sqlLit_(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

/**
 * Comma-joined, lowercased catalog names for a SQL IN() list.
 * @param {string} mode 'tech' (Tech rows only) | 'all' (every row)
 */
function catalogInList_(mode) {
  return SLA_CATALOG
    .filter(function (r) { return mode === 'all' || r.tech; })
    .map(function (r) { return sqlLit_(r.name.trim().toLowerCase()); })
    .join(', ');
}

/**
 * SQL boolean — is this IssueCategory a Tech (device/hardware) ticket?
 * Catalog Tech rows, OR unlisted categories that match the fallback regex.
 * This is the authoritative device-failure filter (replaces the old regex).
 * @param {string} col SQL expression yielding the raw IssueCategory
 * @return {string} a parenthesised SQL boolean
 */
function techBoolSql_(col) {
  var c = 'LOWER(TRIM(' + col + '))';
  return '(' + c + ' IN (' + catalogInList_('tech') + ') OR (' +
    c + ' NOT IN (' + catalogInList_('all') + ') AND ' +
    "REGEXP_CONTAINS(" + c + ", r'" + CONFIG.TECH_FALLBACK_REGEX + "')))";
}

/**
 * SQL expression mapping IssueCategory → SLA target in days (catalog value,
 * else CONFIG.SLA_DEFAULT_DAYS).
 * @param {string} col SQL expression yielding the raw IssueCategory
 * @return {string} a CASE expression
 */
function slaDaysCaseSql_(col) {
  var c = 'LOWER(TRIM(' + col + '))';
  var whens = SLA_CATALOG.map(function (r) {
    return 'WHEN ' + sqlLit_(r.name.trim().toLowerCase()) + ' THEN ' + r.days;
  }).join(' ');
  return 'CASE ' + c + ' ' + whens + ' ELSE ' + CONFIG.SLA_DEFAULT_DAYS + ' END';
}
