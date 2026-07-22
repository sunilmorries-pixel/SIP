/**
 * Config.js — single source of truth for environment constants.
 * No secrets live here; the service-account key is stored in Script Properties
 * (see Setup.js).
 */

var CONFIG = {
  /**
   * GCP project that owns the BigQuery dataset AND is billed for queries.
   * Migrated 2026-07-22 from magnaquest-sand-box (dev/test) to tricogde-dwh
   * (production warehouse) — see docs/superpowers/specs/2026-07-22-tricogde-dwh-migration-design.md.
   * Rollback: revert this file; the old SA_KEY property and magnaquest-sand-box
   * access are untouched.
   */
  BQ_PROJECT_ID: 'tricogde-dwh',

  /** Fully-qualified dataset prefix used in every query. */
  BQ_DATASET: 'tricogde-dwh.abi_tables',

  /** Script Property key that holds the service-account JSON. */
  SA_PROPERTY_KEY: 'SA_KEY_DWH',

  /** OAuth scope — read-only, this app never writes to BigQuery. */
  BQ_SCOPE: 'https://www.googleapis.com/auth/bigquery.readonly',

  /**
   * Seconds a dashboard payload stays in CacheService before re-querying.
   * Kept LONGER than the warm-trigger interval (Warm.js, every 10 min) so a
   * warmed value never expires before the next warm pass — users always hit
   * a hot cache. Data is batch-loaded, not streaming, so 15 min is fresh.
   */
  CACHE_TTL_SECONDS: 900,

  /** Hard cap on rows returned by any single query. */
  MAX_ROWS: 1000,

  /** A device is "online" if it heartbeated within this many hours. */
  ONLINE_WINDOW_HOURS: 24,

  /**
   * cloud_devices.LastTimeStamp was shifted +330 min (IST) when the table was
   * loaded (see sql/cloud_devices.lineage.sql) — recency windows must compare
   * against IST-now, not UTC-now, or every bucket is 5.5h off.
   */
  IST_OFFSET_MINUTES: 330,

  /** CS/Service field tracker sheet (Support view). */
  CS_SHEET_ID: '16Q2q9R6GPBOBYVmvImRTZRp8g1kW-G6fio26XDJiULo',

  /**
   * Devices (Jira) source: the BQ table jira_data is commented out in favour of
   * this Google Sheet (same columns). Read via Sheets REST API in SheetSource.js
   * (readJiraSheet). Requires the Sheets API enabled + Viewer access for the
   * deploying user. Only the "Devices" section of the Numbers page uses it.
   */
  JIRA_SHEET_ID: '1FgLl1HJIE8kpM8R1_mgAFaUyGcDTzieYQ0i5LdoZekc',

  /**
   * Permanent restriction (per user request, 2026-07-07): only these Jira
   * "Issue Type" values count as a tracked device everywhere in the app
   * (Numbers page, Fleet/Devices KPIs, the Overview Jira-status donut).
   * Lowercase, trimmed — matched in isTrackedJiraDeviceType_ (Numbers.js).
   */
  JIRA_DEVICE_TYPES: ['connector', 'ecg machine'],

  /** Zoho statuses that mean a ticket is no longer active. */
  ZOHO_TERMINAL_STATUSES: "('Closed','Duplicate','Junk')",

  /**
   * Machine Uptime (TRD M-A1) — canonical downtime source is ServiceWRK (not
   * yet in the sandbox), so we proxy from Zoho device-FAILURE tickets. This
   * regex (matched lowercase against IssueCategory) selects device/hardware
   * failures and excludes billing/report/recharge/admin categories. Tune here.
   */
  FAILURE_CATEGORY_REGEX: 'machine|device|hardware|cable|network|sim|accessor|acquisition|battery|printer|connector',

  /** Format string for Zoho's stringly-typed datetimes: 02-Jul-2026 04:59:16 PM */
  ZOHO_DT_FORMAT: '%d-%b-%Y %I:%M:%S %p',

  /**
   * Fallback SLA target (days) for IssueCategory values not present in the CS
   * team's SLA catalog (SlaCatalog.js). ~5 days ≈ the modal Tech SLA.
   */
  SLA_DEFAULT_DAYS: 5,

  /**
   * Keyword regex (lowercased IssueCategory) that classifies an UNLISTED
   * category as Tech/device. Used by SlaCatalog.slaFor + techBoolSql_ so JS
   * and SQL agree. Listed categories use their catalog `tech` flag directly.
   */
  TECH_FALLBACK_REGEX: 'machine|device|hardware|cable|network|sim|accessor|acquisition|battery|printer|connector|adapter|display|keypad|antenna|board|tablet|charg|serial|ups|trilink|swap',

  /** App metadata shown in the UI. */
  APP_NAME: 'SIP Insights',
  APP_VERSION: '1.0.0'
};
