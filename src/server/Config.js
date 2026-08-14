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

  /**
   * Non-device Jira "Issue Type" values (per user request, 2026-07-30) —
   * excluded everywhere a tracked device is counted (Numbers page,
   * Fleet/Devices KPIs, the Overview Jira-status donut). Every other Issue
   * Type (ECG Machine, Connector, SIM Card, UPS, Printer, BP Machine, Tab,
   * Mobile, IV Trolley, Laptop, WiFi Dongle, TriCare Assets, etc.) counts as
   * a device — only Jira housekeeping ticket types are excluded.
   * Lowercase, trimmed — matched in isTrackedJiraDeviceType_ (Numbers.js).
   */
  JIRA_NON_DEVICE_TYPES: ['task', 'epic', 'test'],

  /**
   * Default Device Type (issuetype_name) / Device Status in Jira (status_name)
   * filter values (per user, 2026-08-13) — mirrored client-side by App.html's
   * `state.globalFilters` initializer and server-side by Warm.js's
   * `warmDefaultFilters_()` (same "can't share a constant across .js/.html"
   * constraint as every other default in this file).
   *
   * deviceTypes is an INCLUDE list (empty = no restriction, same convention
   * as every other filter dimension) — non-empty INITIAL value, same pattern
   * as `statuses: ['ACTIVE']`.
   *
   * deviceStatusExclude is an EXCLUDE list, deliberately not an include list:
   * only 'Decommissioned' is meant to be hidden by default, and every other
   * (including any FUTURE) status should show. An include-list default would
   * need to enumerate all ~11 other real statuses (badge/chip clutter on
   * first load, and a new status would silently default to hidden until this
   * list was updated) — exclude-by-name is both cleaner and safer here.
   */
  JIRA_DEVICE_TYPE_DEFAULT: ['Connector', 'ECG Machine'],
  JIRA_DEVICE_STATUS_EXCLUDE_DEFAULT: ['Decommissioned'],

  /** Zoho statuses that mean a ticket is no longer active. */
  ZOHO_TERMINAL_STATUSES: "('Closed','Duplicate','Junk')",

  /**
   * Machine Uptime (TRD M-A1) — canonical downtime source is ServiceWRK (not
   * yet in the sandbox), so we proxy from Zoho device-FAILURE tickets. This
   * regex (matched lowercase against IssueCategory) selects device/hardware
   * failures and excludes billing/report/recharge/admin categories. Tune here.
   */
  FAILURE_CATEGORY_REGEX: 'machine|device|hardware|cable|network|sim|accessor|acquisition|battery|printer|connector',

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

  /** App metadata shown in the UI.
   *
   * ⚠️ BUMP BOTH OF THESE AS PART OF EVERY `clasp deploy` — they are the
   * footer's only source of truth and nothing derives them automatically
   * (Apps Script cannot read its own deployment version at runtime). The
   * previous value sat at a placeholder '1.0.0' across all 21 releases
   * because nothing tied it to the release step; the footer was simply wrong.
   *
   * APP_VERSION      = the version THIS DEPLOY WILL CREATE, i.e. (current live
   *                    @N in `clasp deployments`) + 1 — NOT the version that is
   *                    live while you're editing. Setting it to the current live
   *                    number is the mistake that already happened once: @54
   *                    shipped carrying '53', so production's footer claimed a
   *                    version one behind what it was actually running.
   * APP_DEPLOYED_AT  = when that version is pointed at the production URL.
   */
  APP_NAME: 'SIP Insights',
  APP_VERSION: '62',
  APP_DEPLOYED_AT: 'Aug 14, 2026, 12:48 PM'
};
