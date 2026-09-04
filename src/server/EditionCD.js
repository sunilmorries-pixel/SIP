/**
 * EditionCD.js — the "center_details edition": a one-for-one DUPLICATE of every
 * server endpoint the pages use, with the center dimension sourced from
 * `center_details` instead of `device_center_mapping`.
 *
 * This file is ADDITIVE. It never touches the original builders/endpoints — the
 * originals keep reading `device_center_mapping`, fully unchanged. The client
 * calls these *CD endpoints only when the "center_details" edition is active
 * (routes #new-overview, #new-asset, …).
 *
 * ── Field mapping (center_details, post 2026-07-07 reload: 114-col schema) ──
 *   CenterID/Centername/HubID/HubName/City/State → same (BQ case-insensitive;
 *     new schema stores centerid/city/state lowercase — SQL still resolves).
 *   pin      → PinCode         (old bare `pin` column removed)
 *   country  → hub_country     (old bare `Country` column removed; switched from
 *              Spoke_Country per user, 2026-08-14 — Spoke_Country has ~9%
 *              NULLs plus typos/non-country values ("Inida", "Phillipines",
 *              "Nairobi", "Africa") that hub_country doesn't)
 *   startdatetime  → deploymentdate  (DATE, center-level)
 *   enddatetime    → deactivationdate (active = deactivationdate IS NULL)
 *   coords   → NONE (latitude/longitude REMOVED by reload) → pin-geocode store
 *              is now the ONLY coordinate source (see coordsForCD_).
 *   NEW cols : DeviceID / MacSerialID / MachineType now EXIST → serial→center
 *              mapping auto-activates on center_details (deviceCenterMap_).
 *   Grain    : reload introduced exact duplicate rows (35,804 rows / 27,410
 *              distinct centers) → centerBase uses SELECT DISTINCT.
 */

/**
 * center_details WHERE fragment(s). REMOVED 2026-07-22 (user request,
 * tricogde-dwh migration): the app previously applied a fixed "Active + Paid"
 * baseline (Status = 'ACTIVE' AND F2P_Customer = 0) to every center query,
 * hiding ~9,300 deactivated centers from every KPI/table/map. That baseline
 * is gone — every number now reflects the FULL distinct-center universe.
 *
 * Both are kept declared (not deleted, not inlined as '') so every existing
 * "WHERE " + cdFilter_()/CD_SEG_FILTER + ... call site (here and in Geo.js's
 * distinctLocations_) stays syntactically valid SQL — '1=1' excludes nothing
 * and lets the query planner drop it. (cdFilter_ call sites now thread the
 * 5-dimension `filters` object via filterCond/multiCond_ instead of the old
 * single-segment cdSegCond_ — see buildDashboardQuerySpecsCD/centerUptimeSqlCD_.)
 */
var CD_SEG_FILTER = '1=1';
function cdFilter_() {
  return '1=1';
}

/** Machine-readable flags describing the device→center remap (shown in the UI banner). */
var FLAGS_CD = [
  'Source: center_details (2026-07-07 reload: 35,804 rows / 27,410 distinct centers).',
  'No device grain in center queries: "devices" figures are CENTER counts.',
  'startdatetime→deploymentdate, enddatetime→deactivationdate (active = not deactivated).',
  'No coordinate columns since the reload — pins come from the pin-geocode store only.',
  'Jira devices from the live jira_data BQ table; serial→center = cloud_devices first, center_details fallback.'
];

/* ═══════════════ Shared center-attribute filter chain ═══════════════════ */

/**
 * The "center attribute" half of the global filter, as one SQL fragment:
 * segment + status + state + hub, ANDed, each via multiCond_.
 *
 * ONE definition on purpose. This exact 4-line chain used to be duplicated
 * verbatim at 4 call sites (centerFilterSubqueryCond_, centerUptimeSqlCD_,
 * buildDashboardQuerySpecsCD, and apiGetExecOverviewCD's deviceAge spec), so
 * changing how a dimension is compared — e.g. adding multiCond_'s TRIM
 * normalization, finding I4 — risked landing in 3 of 4 places and leaving the
 * SQL path disagreeing with the JS path (centerPassesFilters_). Extracted by
 * the whole-branch-review fix wave, 2026-07-29 (finding I8).
 *
 * The DATE range is deliberately NOT part of this helper: its column differs
 * per call site (center_details.deploymentdate vs zoho_data.CreatedAt), so
 * callers add their own dateRangeCond_.
 * @param {{segments:Array,statuses:Array,states:Array,hubs:Array,cities:Array,countries:Array}=} filters
 * @return {string} '' when no center-attribute dimension is active
 */
function centerAttrCond_(filters) {
  var f = filters || {};
  // Segment values are compared post-merge (segmentGroupSql_) so selecting
  // "SME"/"LE" in the filter drawer matches every raw variant that merges
  // into it — segmentOptions ships the merged names, so the two must agree.
  return multiCond_(segmentGroupSql_('hub_master_segment'), f.segments) +
    multiCond_('Status', f.statuses) +
    multiCond_('State', f.states) +
    multiCond_('HubName', f.hubs) +
    multiCond_('City', f.cities) +
    multiCond_('hub_country', f.countries) +
    // Center filters on the ID, not the name: center names are not unique in
    // center_details, so a name-keyed filter would match unrelated centers.
    // CAST so the numeric column compares against the string values the client
    // sends (multiCond_ emits quoted literals).
    multiCond_('CAST(CenterID AS STRING)', f.centers) +
    // Billable/MachineType/DeviceID/MacSerialID (per user, 2026-08-21) — 4 more
    // center_details columns, same include-list treatment as everything above.
    multiCond_('Billable', f.billable) +
    multiCond_('MachineType', f.machineTypes) +
    multiCond_('DeviceID', f.deviceIds) +
    multiCond_('MacSerialID', f.macSerialIds);
}

/* ═══════════════ Uptime / MTBF / Health (birth = deploymentdate) ═════════ */

/**
 * Copy of centerUptimeSql_ with the birth CTE sourced from center_details
 * (deploymentdate) instead of device_center_mapping (startdatetime). Everything
 * else — Zoho device-failure downtime, MTBF, health tiers — is identical.
 * @param {string} tailSelect a SELECT over the final `scored` CTE
 */
function centerUptimeSqlCD_(tailSelect, filters) {
  var ff = filters || {};
  return "WITH tix AS (" +
    " SELECT CenterID AS center_id, CreatedAt AS s, " +
    "  COALESCE(ClosedAt, CURRENT_DATETIME()) AS e " +
    " FROM " + zohoDedupSql_() + " WHERE CenterID IS NOT NULL " +
    "  AND " + techBoolSql_("IFNULL(IssueCategory,'')") + " " +
    "  AND CreatedAt IS NOT NULL), " +
    "birth AS (SELECT CenterID AS center_id, MIN(DATETIME(deploymentdate)) AS b " +
    "  FROM " + T('center_details') + " WHERE deploymentdate IS NOT NULL AND " + cdFilter_() +
    centerAttrCond_(ff) +
    dateRangeCond_('deploymentdate', ff.dateFrom, ff.dateTo) +
    " GROUP BY CenterID), " +
    "flagged AS (SELECT center_id, s, e, " +
    "  MAX(e) OVER (PARTITION BY center_id ORDER BY s ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS pe FROM tix), " +
    "islands AS (SELECT center_id, s, e, " +
    "  COUNTIF(pe IS NULL OR s > pe) OVER (PARTITION BY center_id ORDER BY s ROWS UNBOUNDED PRECEDING) AS grp FROM flagged), " +
    // GREATEST(0, …) per island: an interval can end before it starts when
    // ClosedAt < CreatedAt in the source data, or when an OPEN ticket's end
    // (CURRENT_DATETIME(), UTC) precedes its own IST-stamped CreatedAt. A
    // negative summand SUBTRACTS from downtime, and uptime_pct's 0–100 clamp
    // then hides it — so the clamp was doing structural work rather than
    // rounding work, while downtime_days reached the Customers table negative.
    "dt AS (SELECT center_id, SUM(GREATEST(0, DATETIME_DIFF(se, ss, HOUR))) AS downtime_hrs " +
    "  FROM (SELECT center_id, grp, MIN(s) ss, MAX(e) se FROM islands GROUP BY center_id, grp) GROUP BY center_id), " +
    "fail AS (SELECT center_id, COUNT(*) AS failures FROM tix GROUP BY center_id), " +
    "base AS (SELECT b.center_id, " +
    "  DATETIME_DIFF(CURRENT_DATETIME(), b.b, HOUR) AS life_hrs, " +
    "  IFNULL(dt.downtime_hrs, 0) AS downtime_hrs, IFNULL(fail.failures, 0) AS failures " +
    "  FROM birth b LEFT JOIN dt USING (center_id) LEFT JOIN fail USING (center_id) WHERE b.b IS NOT NULL), " +
    "calc AS (SELECT center_id, life_hrs, downtime_hrs, failures, " +
    "  ROUND(GREATEST(0, LEAST(100, (life_hrs - downtime_hrs) / NULLIF(life_hrs, 0) * 100)), 2) AS uptime_pct, " +
    "  CASE WHEN failures >= 2 THEN ROUND(GREATEST(0, life_hrs - downtime_hrs) / failures, 1) ELSE NULL END AS mtbf_hrs " +
    "  FROM base), " +
    "scored AS (SELECT *, " +
    "  ROUND(0.5 * uptime_pct " +
    "   + CASE WHEN failures = 0 THEN 30 WHEN failures = 1 THEN 20 " +
    "          WHEN mtbf_hrs > 720 THEN 30 WHEN mtbf_hrs >= 168 THEN 20 ELSE 5 END " +
    "   + CASE WHEN failures = 0 THEN 20 WHEN failures <= 2 THEN 15 WHEN failures <= 5 THEN 10 ELSE 5 END, 0) AS health_score " +
    "  FROM calc) " +
    tailSelect;
}

/* ═══════════════ Dashboard specs (center specs swapped to center_details) ═ */

/**
 * buildDashboardQuerySpecs with the center-table-dependent specs replaced by
 * center_details variants. Non-center specs (cloud_devices, zoho, jira, SLA,
 * cohort) are reused verbatim from the original builder.
 * @param {string} hub
 */
function buildDashboardQuerySpecsCD(hub, filters) {
  var CD = T('center_details');
  var F = cdFilter_();
  var ff = filters || {};
  var filterCond = centerAttrCond_(ff);
  var dateCond = dateRangeCond_('deploymentdate', ff.dateFrom, ff.dateTo);
  var cd = {
    centerKpis:
      "SELECT COUNT(DISTINCT CenterID) AS centers, " +
      " COUNT(DISTINCT NULLIF(TRIM(City), '')) AS cities, " +
      // center-grain, not row-grain: center_details has duplicate rows per
      // center, so COUNTIF(...) counted rows (25,648 > 18,370 centers → 140%).
      " COUNT(DISTINCT IF(deactivationdate IS NULL, CenterID, NULL)) AS active_deployments, " +
      // Replaces the old "States" KPI tile (per user) — distinct centers with
      // at least one non-terminal Zoho ticket. CenterID IN (...), not a JOIN:
      // keeps every bare column reference above (State/City/deactivationdate)
      // unambiguous without needing a table alias.
      " COUNT(DISTINCT IF(CenterID IN (SELECT DISTINCT CenterID FROM " + zohoDedupSql_() +
      " WHERE CenterID IS NOT NULL AND status NOT IN " + CONFIG.ZOHO_TERMINAL_STATUSES + "), " +
      " CenterID, NULL)) AS centers_with_open_tickets FROM " + CD + " WHERE " + F + filterCond + dateCond,
    geo:
      // Distinct CENTERS per state (the reload duplicated rows; every other
      // Centers metric dedupes — this one was still COUNT(*)). Field name stays
      // `devices` for client-payload compatibility; the card is retitled
      // "Centers by state" client-side. Feeds Overview's "Where centers are"
      // chart ONLY — always by-state, deliberately untouched by the
      // single-state-selected switch below (see geoCustomers).
      "SELECT IFNULL(NULLIF(TRIM(State), ''), 'Unknown') AS state, COUNT(DISTINCT CenterID) AS devices " +
      "FROM " + CD + " WHERE " + F + filterCond + dateCond + " GROUP BY state ORDER BY devices DESC LIMIT 12",
    // One row per center (MIN deploymentdate); counts DISTINCT centers so the
    // bands sum to the center count (was active-only rows → didn't match).
    // Bands match the Asset-page Device age chart exactly (Numbers.js
    // jiraDeviceStats_'s ageBands: <1y/1-2y/2-3y/3-5y/5y+, off age/365 years)
    // so the two age distributions are directly comparable.
    deploymentAge:
      "WITH dep AS (SELECT CenterID, DATE_DIFF(CURRENT_DATE(), DATE(MIN(deploymentdate)), DAY) AS age_days " +
      " FROM " + CD + " WHERE deploymentdate IS NOT NULL AND " + F + filterCond + dateCond + " GROUP BY CenterID) " +
      "SELECT CASE WHEN age_days < 365 THEN '<1y' WHEN age_days < 730 THEN '1-2y' " +
      " WHEN age_days < 1095 THEN '2-3y' WHEN age_days < 1825 THEN '3-5y' ELSE '5y+' END AS band, " +
      " COUNT(*) AS devices FROM dep GROUP BY band",
    // "Deployment status" card repurposed to a segment breakdown (hub_master_segment, per user).
    // Segment variants merged (segmentGroupSql_ — SME/LE, per user) so this
    // agrees with the Filters drawer's Segment checklist and every other
    // segment-grouped chart/table app-wide.
    // No dateCond here: the segment breakdown has no date semantics of its own
    // (filterCond's own segment component still legitimately narrows which
    // segments show; only the deployment-date range is skipped).
    activeVsEnded:
      "SELECT " + segmentGroupSql_('hub_master_segment') + " AS status, " +
      " COUNT(DISTINCT CenterID) AS devices FROM " + CD + " WHERE " + F + filterCond +
      " GROUP BY status ORDER BY devices DESC LIMIT 12",
    reliability: centerUptimeSqlCD_(
      "SELECT center_id AS centerid, uptime_pct, ROUND(100 - uptime_pct, 1) AS downtime_pct, " +
      " failures, ROUND(life_hrs / 24.0, 0) AS life_days FROM scored ORDER BY uptime_pct ASC", filters),
    uptimeFleet: centerUptimeSqlCD_(
      "SELECT COUNT(*) AS scored, ROUND(AVG(uptime_pct), 1) AS avg_uptime, " +
      " ROUND(COUNTIF(uptime_pct >= 99) / NULLIF(COUNT(*), 0) * 100, 1) AS pct99, " +
      " ROUND(AVG(mtbf_hrs) / 24, 1) AS avg_mtbf_days, ROUND(AVG(health_score), 1) AS avg_health, " +
      " ROUND(COUNTIF(health_score >= 80) / NULLIF(COUNT(*), 0) * 100, 1) AS pct_healthy, " +
      // Center lifecycle (today − deploymentdate) + downtime, for the Centers summary.
      " ROUND(AVG(life_hrs) / 24 / 365, 1) AS avg_life_years, " +
      " ROUND(AVG(downtime_hrs) / 24, 1) AS avg_downtime_days FROM scored", filters),
    assetHealth: centerUptimeSqlCD_(
      "SELECT center_id AS centerid, uptime_pct, mtbf_hrs, failures, health_score " +
      "FROM scored ORDER BY health_score ASC", filters)
  };
  // The jira_data BQ specs (assets/cohortReliability) were removed from
  // buildDashboardQuerySpecs — the status/type donut and the batch cohort are
  // now computed in JS from the Jira SHEET asset index (see apiGetDashboardCD).
  // "Top hubs" (cloud_devices) and kpis/fleetStatus/firmware (cloud_devices)
  // were removed from buildDashboardQuerySpecs entirely, 2026-08-19 — no
  // filter needed here anymore, they're simply not in the base list.
  var specs = buildDashboardQuerySpecs(hub, filters)
    .map(function (s) {
      return cd[s.key] ? { key: s.key, params: s.params, sql: cd[s.key], maxRows: s.maxRows } : s;
    });
  // reliability/assetHealth now return EVERY scored center (LIMIT removed above) so the
  // client can merge + sort-toggle between uptime% and health score — the default
  // MAX_ROWS (1000) would silently truncate the ~28k-center universe, repeating the
  // exact bug already fixed once in getCenter360RowsCD_ (see its own maxRows comment).
  specs.forEach(function (s) {
    if (s.key === 'reliability' || s.key === 'assetHealth') s.maxRows = 60000;
  });

  // Customers page's OWN "Customers by state" chart (per user, 2026-08-13):
  // switches to a City breakdown once the filter drawer has exactly one State
  // selected (a by-state chart is uninformative once already scoped to one
  // state). A genuinely NEW key, not an override of an existing base spec —
  // must be specs.push()'d like segmentOptions/zohoFailByCenter below, not
  // added to the `cd` object above (that only overrides keys the base
  // buildDashboardQuerySpecs() list already has — see the .map() above).
  // Deliberately separate from `geo` (unchanged, always by-state): that field
  // feeds Overview's "Where centers are" card, a different page whose title
  // shouldn't silently go stale from a filter change made on the Customers page.
  // No LIMIT (unlike `geo` above): this card is the Customers page's own
  // full breakdown, not a Top-N summary — every state/city with data should
  // show. The chart card scrolls client-side (Charts.geo/Index.html) so an
  // unbounded row count stays browsable instead of squishing.
  specs.push({
    key: 'geoCustomers',
    sql: "SELECT IFNULL(NULLIF(TRIM(" + ((ff.states && ff.states.length === 1) ? 'City' : 'State') + "), ''), 'Unknown') AS state, " +
      "COUNT(DISTINCT CenterID) AS devices " +
      "FROM " + CD + " WHERE " + F + filterCond + dateCond + " GROUP BY state ORDER BY devices DESC"
  });

  // Distinct real segment/state values, for the global filter drawer's Segment
  // checklist and State combobox. Both ship WHOLE (the client filters them in
  // JS as the user types) because both are small: ~7 segments and 451 distinct
  // states on the sandbox.
  //
  // There is deliberately NO hubOptions spec: HubName has 13,721 distinct real
  // values, so no static list can be both complete and cheap (a 500-row cap
  // returned only the alphabetically-first punctuation-heavy junk — whole-branch
  // review finding C1). Hub is served by apiSearchHubsCD instead, a debounced
  // server-side search; see its docblock.
  specs.push({
    // Merged names (segmentGroupSql_ — SME/LE variants collapsed, per user) so
    // the checklist offers exactly the vocabulary every chart/table now uses,
    // and selecting "SME" here matches every underlying raw variant via
    // centerAttrCond_'s identically-merged comparison.
    key: 'segmentOptions', maxRows: 200,
    sql: "SELECT DISTINCT " + segmentGroupSql_('hub_master_segment') + " AS segment FROM " + CD +
      " WHERE " + F + " AND NULLIF(TRIM(hub_master_segment), '') IS NOT NULL ORDER BY segment"
  });
  specs.push({
    // 1000, not 200: there are 451 distinct real State values on the sandbox, so
    // the old 200 cap silently truncated the list mid-alphabet (dropping
    // Maharashtra/Tamil Nadu/Uttar Pradesh…). ~1000 short strings is cheap.
    key: 'stateOptions', maxRows: 1000,
    sql: "SELECT DISTINCT TRIM(State) AS state FROM " + CD +
      " WHERE " + F + " AND NULLIF(TRIM(State), '') IS NOT NULL ORDER BY state"
  });
  specs.push({
    // 5000: ~3,078 distinct real City values on the sandbox — far more than
    // State but nowhere near Hub's 13,721 (which is why Hub gets a remote
    // search instead), so a generous static list is still cheap and complete.
    key: 'cityOptions', maxRows: 5000,
    sql: "SELECT DISTINCT TRIM(City) AS city FROM " + CD +
      " WHERE " + F + " AND NULLIF(TRIM(City), '') IS NOT NULL ORDER BY city"
  });
  specs.push({
    // Small (~15-20 distinct real hub_country values on the sandbox) — shipped
    // raw, same as Segment/State: the app doesn't merge Country variants.
    // Switched from Spoke_Country (per user, 2026-08-14): Spoke_Country has
    // ~9% NULLs plus data-entry variants ("Inida"/"Phillipines"/"Nairobi"/
    // "Africa") that hub_country doesn't.
    key: 'countryOptions', maxRows: 200,
    sql: "SELECT DISTINCT TRIM(hub_country) AS country FROM " + CD +
      " WHERE " + F + " AND NULLIF(TRIM(hub_country), '') IS NOT NULL ORDER BY country"
  });
  specs.push({
    // Small (18 distinct real MachineType values on the sandbox) — shipped
    // whole, same as Segment/Country. Billable has no equivalent spec: it's
    // a fixed 2-value (YES/NO) dimension, hardcoded client-side like Status.
    // DeviceID/MacSerialID are NOT here — 7.4k/16k distinct values is Hub-scale,
    // so those two are server-searched instead (apiSearchDeviceIdsCD/
    // apiSearchMacSerialIdsCD), never shipped as a static list.
    key: 'machineTypeOptions', maxRows: 200,
    sql: "SELECT DISTINCT TRIM(MachineType) AS machineType FROM " + CD +
      " WHERE " + F + " AND NULLIF(TRIM(MachineType), '') IS NOT NULL ORDER BY machineType"
  });
  // Per-center Zoho failure aggregate (Zoho only — no jira) feeding the JS cohort.
  specs.push({
    key: 'zohoFailByCenter', maxRows: 60000,
    sql:
      "WITH ftix AS (SELECT CenterID AS cid, CreatedAt AS created, IssueCategory AS cat " +
      " FROM " + zohoDedupSql_() + " WHERE CenterID IS NOT NULL AND " +
      techBoolSql_("IFNULL(IssueCategory,'')") + " AND CreatedAt IS NOT NULL), " +
      "pc AS (SELECT cid, CAST(MIN(created) AS STRING) AS first_fail, COUNT(*) AS n_fail FROM ftix GROUP BY cid), " +
      "cr AS (SELECT cid, cat, ROW_NUMBER() OVER (PARTITION BY cid ORDER BY COUNT(*) DESC) AS rn " +
      " FROM ftix GROUP BY cid, cat) " +
      "SELECT pc.cid, pc.first_fail, pc.n_fail, c.cat AS top_cat " +
      "FROM pc LEFT JOIN cr c ON c.cid = pc.cid AND c.rn = 1"
  });
  return specs;
}

/**
 * Status + Issue-Type counts for the Asset-page donuts, computed from the Jira
 * SHEET asset index (replaces the old jira_data BQ `assets` spec). Same shape:
 * [{dim:'status'|'type', label, cnt}], each block sorted by cnt desc.
 * @param {Array<Object>} assets getAssetIndex_() output
 */
function assetsDonutFromIndex_(assets) {
  var byStatus = {}, byType = {};
  assets.forEach(function (a) {
    var s = String(a.status || '').trim() || '(blank)';
    byStatus[s] = (byStatus[s] || 0) + 1;
    var t = String(a.type || 'Other');
    byType[t] = (byType[t] || 0) + 1;
  });
  function rows(dim, map) {
    return Object.keys(map).map(function (k) { return { dim: dim, label: k, cnt: map[k] }; })
      .sort(function (x, y) { return y.cnt - x.cnt; });
  }
  return rows('status', byStatus).concat(rows('type', byType));
}

/**
 * Batch-cohort failure analysis (M-A3/M-A5) computed in JS from the Jira SHEET
 * asset index + a per-center Zoho failure aggregate. Batch = YEAR of the device's
 * Created date (approx: the flat sheet has no changelog, so "first appearance"
 * collapses to Created). Failure signal is CENTER-grain, as in the old BQ version.
 * Same output shape as the retired cohortReliabilitySql_.
 * @param {Array<Object>} assets getAssetIndex_() output
 * @param {Array<{cid,first_fail,n_fail,top_cat}>} zohoFail per-center Zoho aggregate
 */
function cohortFromIndex_(assets, zohoFail) {
  var fc = {};
  (zohoFail || []).forEach(function (r) {
    fc[r.cid] = { first_fail: r.first_fail || null, n_fail: r.n_fail || 0, top_cat: r.top_cat || '' };
  });
  var years = {};
  assets.forEach(function (a) {
    if (!a.birthday) return;
    var y = parseInt(a.birthday.slice(0, 4), 10);
    if (!y) return;
    var g = years[y] || (years[y] = { devices: 0, everFail: 0, ttff: [], early: 0, failSum: 0, cats: {} });
    g.devices++;
    var f = (a.center_id != null) ? fc[a.center_id] : null;
    if (f && f.first_fail) {
      g.everFail++;
      g.failSum += f.n_fail;
      var bd = new Date(a.birthday), ff = new Date(f.first_fail);
      if (!isNaN(bd.getTime()) && !isNaN(ff.getTime()) && ff > bd) {
        var days = Math.floor((ff - bd) / 86400000);
        g.ttff.push(days);
        if (days < 7) g.early++;
      }
      if (f.top_cat) g.cats[f.top_cat] = (g.cats[f.top_cat] || 0) + 1;
    }
  });
  function median(arr) {
    if (!arr.length) return null;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  }
  return Object.keys(years).map(function (y) {
    var g = years[y], topCat = '', topN = 0;
    Object.keys(g.cats).forEach(function (c) { if (g.cats[c] > topN) { topN = g.cats[c]; topCat = c; } });
    return {
      batch_year: parseInt(y, 10),
      devices: g.devices,
      ftf_rate_pct: g.devices ? Math.round(g.everFail / g.devices * 1000) / 10 : 0,
      median_ttff_days: median(g.ttff),
      early_fails: g.early,
      avg_failures: g.devices ? Math.round(g.failSum / g.devices * 100) / 100 : 0,
      top_issue: topCat
    };
  }).sort(function (a, b) { return a.batch_year - b.batch_year; });
}

/**
 * Device-grain uptime/downtime/MTBF/MTTR from the Jira status changelog —
 * methodology confirmed against TA-14445 (worked example, 2026-09-02): once
 * a device has ever reached Deployed, the next time it enters Hardware
 * status (any path back in, however many hops) starts a downtime incident;
 * it ends the moment the device's status next changes. An incident still
 * open as of that device's own latest known update (ticket_updated) is
 * capped there and marked ongoing rather than measured to today.
 *
 * Per device (only devices that ever reached Deployed are scored — before
 * that a device is still being provisioned, not "up" or "down"):
 *   window   = ticket_updated - first_deployed_at
 *   downtime = sum of incident durations (an ongoing incident capped at
 *              ticket_updated)
 *   uptime   = window - downtime
 *   MTBF     = uptime / incident count (every incident, closed + ongoing —
 *              it did fail, MTBF answers "how long between failures")
 *   MTTR     = completed-incident downtime / completed incident count
 *              (ongoing incidents excluded — not yet repaired, so they
 *              can't say how long a repair takes)
 *
 * Fleet aggregation is a plain AVG() across every scored device — v1 is
 * deliberately unfiltered (fleet-wide only, per user 2026-09-04), same
 * convention the Centers page's own uptimeFleet already uses (AVG(uptime_pct)
 * / AVG(mtbf_hrs) / AVG(downtime_hrs) in centerUptimeSqlCD_).
 * @param {Array<{issue_key:string, from_value:string, to_value:string,
 *   last_field_updated:string, ticket_updated:string}>} rows
 *   readJiraStatusChangelog_() output (Numbers.js), already ordered by
 *   issue_key then last_field_updated.
 * @return {{scored:number, avg_uptime_pct:(number|null), avg_downtime_days:(number|null),
 *   avg_mtbf_days:(number|null), avg_mttr_days:(number|null)}}
 */
function deviceUptimeFromChangelog_(rows) {
  // Group into per-issue transition arrays. Rows arrive pre-sorted by
  // issue_key then last_field_updated (the SQL's own ORDER BY) — one pass,
  // no re-sort needed.
  var byIssue = {}, order = [];
  rows.forEach(function (r) {
    if (!byIssue[r.issue_key]) { byIssue[r.issue_key] = []; order.push(r.issue_key); }
    byIssue[r.issue_key].push(r);
  });

  var scored = [];
  order.forEach(function (issueKey) {
    var tx = byIssue[issueKey];
    var firstDeployedAt = null;
    for (var i = 0; i < tx.length; i++) {
      if (tx[i].to_value === 'Deployed') { firstDeployedAt = tx[i].last_field_updated; break; }
    }
    if (!firstDeployedAt) return; // never deployed -> no observation window

    var snapshotAt = tx[0].ticket_updated; // identical on every row for this issue
    var windowMs = new Date(snapshotAt).getTime() - new Date(firstDeployedAt).getTime();
    if (!(windowMs > 0)) return; // guards a malformed/missing timestamp pair

    var wasDeployed = false, incidents = [];
    for (var j = 0; j < tx.length; j++) {
      var t = tx[j];
      if (t.to_value === 'Hardware' && wasDeployed) {
        var next = tx[j + 1];
        incidents.push({
          start: t.last_field_updated,
          end: next ? next.last_field_updated : snapshotAt,
          ongoing: !next
        });
      }
      if (t.to_value === 'Deployed') wasDeployed = true;
    }

    var durationMs = function (inc) {
      return Math.max(0, new Date(inc.end).getTime() - new Date(inc.start).getTime());
    };
    var downtimeMs = incidents.reduce(function (sum, inc) { return sum + durationMs(inc); }, 0);
    var uptimeMs = Math.max(0, windowMs - downtimeMs);
    var completed = incidents.filter(function (inc) { return !inc.ongoing; });
    var completedMs = completed.reduce(function (sum, inc) { return sum + durationMs(inc); }, 0);

    scored.push({
      uptime_pct: Math.min(100, Math.max(0, uptimeMs / windowMs * 100)),
      downtime_days: downtimeMs / 86400000,
      mtbf_days: incidents.length ? (uptimeMs / 86400000) / incidents.length : null,
      mttr_days: completed.length ? (completedMs / 86400000) / completed.length : null
    });
  });

  function avg(key) {
    var withVal = scored.filter(function (s) { return s[key] != null; });
    return withVal.length ?
      withVal.reduce(function (sum, s) { return sum + s[key]; }, 0) / withVal.length : null;
  }
  function round1(v) { return v == null ? null : Math.round(v * 10) / 10; }

  return {
    scored: scored.length,
    avg_uptime_pct: round1(avg('uptime_pct')),
    avg_downtime_days: round1(avg('downtime_days')),
    avg_mtbf_days: round1(avg('mtbf_days')),
    avg_mttr_days: round1(avg('mttr_days'))
  };
}

/**
 * Cached fleet-wide device uptime/downtime/MTBF/MTTR (Asset page KPI tiles).
 * v1 is deliberately unfiltered — per user 2026-09-04, doesn't thread through
 * the Filters drawer yet (would need a device->center bridge for every
 * changelog row; can follow later if wanted). The aggregate result is tiny
 * (5 numbers), so a plain withCache suffices — no need for the gzip-chunked
 * cachePutLarge assets_v3 uses for its much bigger per-device array. Keyed by
 * getCacheEpoch_() (not listed in Setup.js's clearDashboardCache — see that
 * function's own comment on why folding the epoch into the key beats a
 * hard-coded removal list that can silently drift out of sync).
 * @return {{scored:number, avg_uptime_pct:(number|null), avg_downtime_days:(number|null),
 *   avg_mtbf_days:(number|null), avg_mttr_days:(number|null)}}
 */
function getDeviceUptimeFleet_() {
  return withCache('devuptime_v1_' + getCacheEpoch_(), function () {
    return deviceUptimeFromChangelog_(readJiraStatusChangelog_());
  });
}

/* ═══════════════ Center-360 rows from center_details ═════════════════════ */

/**
 * The center-dimension source spec behind getCenter360RowsCD_ — the row shape
 * the JS filter predicate (centerPassesFilters_) runs over.
 *
 * Its OWN function (rather than inline in getCenter360RowsCD_) so the
 * reconciliation suite can generate exactly this SQL and cross-check the JS
 * predicate's row count against the SQL path's COUNT(DISTINCT CenterID) for the
 * same filter set — the permanent guard for finding I4 (SQL-vs-JS drift).
 * @return {{key:string, maxRows:number, sql:string}}
 */
function centerBaseSpecCD_() {
  return {
    key: 'centerBase', maxRows: 60000,
    sql:
      // DISTINCT: the 2026-07-07 reload has exact duplicate rows per center.
      // PinCode replaces the removed pin column; the reload dropped
      // latitude/longitude entirely → NULL here, coordinates come from the
      // pin-geocode store fallback (coordsForCD_). country sources from
      // hub_country, not Spoke_Country (per user, 2026-08-14 — Spoke_Country
      // has ~9% NULLs plus typos/non-country values hub_country doesn't).
      //
      // state/hub/city/country are TRIM'd for the same reason segment/status
      // already were: centerPassesFilters_ compares these fields against the
      // filter values with ===, while multiCond_ compares TRIM(IFNULL(col,''))
      // in SQL. Both sides must normalize identically or the two paths
      // disagree on the 2,806 sandbox rows with a padded HubName (review
      // finding I4, 2026-07-29).
      "SELECT DISTINCT CenterID AS center_id, Centername AS center, HubID AS hub_id, " +
      " IFNULL(TRIM(HubName), '') AS hub, " +
      " IFNULL(TRIM(City), '') AS city, IFNULL(TRIM(State), '') AS state, PinCode AS pin, " +
      " IFNULL(TRIM(hub_country), '') AS country, " +
      " " + segmentGroupSql_('hub_master_segment') + " AS segment, " +   // segment = hub_master_segment, SME/LE variants merged (per user)
      " IFNULL(TRIM(Status), '') AS status, " +                // NEW: needed for the global Status filter
      // Billable/MachineType/DeviceID/MacSerialID (per user, 2026-08-21) — 4
      // more center_details filter dimensions. TRIM'd for the same SQL-vs-JS
      // agreement reason as state/hub/city/country above.
      " IFNULL(TRIM(Billable), '') AS billable, " +
      " IFNULL(TRIM(MachineType), '') AS machine_type, " +
      " IFNULL(TRIM(DeviceID), '') AS device_id, " +
      " IFNULL(TRIM(MacSerialID), '') AS mac_serial_id, " +
      // Current_MRR + Device_Rental, per user 2026-07-07 (see HANDOFF §M-C3) —
      // the two fields the removed MRR-at-Risk feature already established as
      // "real MRR" for this table. Summed here, not carried as two fields:
      // every consumer (computeTopCustomersCD_) only ever wants the total.
      // NOTE the SELECT DISTINCT above: if a center's duplicate rows ever
      // disagree on either MRR field (they haven't been checked for that
      // specifically), this would count as a "genuinely different row" the
      // same way the 368-center case already does for other columns.
      " ROUND(IFNULL(Current_MRR, 0) + IFNULL(Device_Rental, 0), 2) AS mrr, " +
      " CAST(NULL AS FLOAT64) AS lat, CAST(NULL AS FLOAT64) AS lng, " +
      " CAST(deploymentdate AS STRING) AS deployment_date " +
      "FROM " + T('center_details') + " WHERE " + cdFilter_()
  };
}

/**
 * center_details center dimension ⟕ live telemetry ⟕ open tickets (by CenterID).
 * @param {boolean=} bypassCache force a rebuild (used by the warm trigger)
 */
function getCenter360RowsCD_(bypassCache) {
  // Epoch folded in (2026-08-21) so clearDashboardCache() actually reaches this
  // cache, matching every sibling key in this file. It previously carried no
  // epoch AND the clearer named a dead prefix ('ctr360cd_v9', last written at
  // v9), so an explicit clear left these rows untouched for their full 1800s
  // TTL — every other cache recomputed against stale center dimension, geo,
  // telemetry, ticket and uptime columns. That is worse than a no-op: the
  // operator sees each KPI move and concludes the app is current, while the
  // Customers table, both maps, the Overview Customers tree and Top Customers
  // are still serving pre-reload rows.
  var ckey = 'ctr360cd_v15_' + getCacheEpoch_(); // v15: withTickets carries max_open_age_days (per-center oldest open ticket age)
  if (bypassCache !== true) {
    var cached = cacheGetLarge(ckey);
    if (cached) return cached;
  }

  var specs = buildCenterSourceSpecs().map(function (s) {
    // telemetry + tickets are center-table-agnostic; only the center dimension swaps
    return s.key === 'centerBase' ? centerBaseSpecCD_() : s;
  });
  var sources = runQueriesParallel(specs);

  var withTelemetry = leftJoin(sources.centerBase || [], sources.centerTelemetry || [], {
    leftKey: 'center_id', rightKey: 'center_id',
    select: function (base, tel) {
      return {
        center_id: base.center_id, center: base.center || '', hub: base.hub || '',
        hub_id: base.hub_id != null ? base.hub_id : '', city: base.city || '',
        state: base.state || '', pin: base.pin || '', country: base.country || '',
        segment: base.segment || '', // from center_details, not Zoho tickets
        status: base.status || '',
        billable: base.billable || '', machine_type: base.machine_type || '',
        device_id: base.device_id || '', mac_serial_id: base.mac_serial_id || '',
        mrr: base.mrr || 0,
        lat: base.lat, lng: base.lng, deployment_date: base.deployment_date || '',
        devices: tel ? tel.devices : 0, online: tel ? tel.online : 0,
        last_seen: (tel && tel.last_seen) || '',
        avg_csq: tel ? tel.avg_csq : null, avg_battery: tel ? tel.avg_battery : null,
        low_battery: tel ? tel.low_battery : 0
      };
    }
  });

  var withTickets = leftJoin(withTelemetry, sources.centerTickets || [], {
    leftKey: 'center_id', rightKey: 'center_id',
    select: function (row, tickets) {
      row.open_tickets = tickets ? tickets.open_tickets : 0;
      row.tickets_total = tickets ? tickets.tickets_total : 0;
      row.swapped = tickets ? tickets.swapped : 0;
      // -1 sentinel ("no currently-open ticket"), never a real age — every
      // real age_days elsewhere in this codebase is >= 0.
      row.max_open_age_days = (tickets && tickets.max_open_age_days != null) ? tickets.max_open_age_days : -1;
      // segment already set from center_details (centerBase) — a center's own
      // attribute, so centers with no tickets still carry their segment.
      return row;
    }
  });

  // Per-center lifecycle/downtime/uptime — same "scored" engine as the North-Star
  // KPI and the reliability/health watchlists, but for EVERY scored center (no
  // LIMIT), for the Center-360 table columns.
  // maxRows is REQUIRED here: without it collectRows_ capped at 1000, so only
  // 1000 of ~18k centers got lifecycle/downtime/uptime columns.
  var uptimeRows = runQuery(centerUptimeSqlCD_(
    "SELECT center_id, " +
    " ROUND(life_hrs / 24 / 365, 2) AS lifecycle_years, " +
    " ROUND(downtime_hrs / 24, 1) AS downtime_days, " +
    " uptime_pct, mtbf_hrs, failures FROM scored"), null, { maxRows: 60000 });
  var uptimeByCenter = {};
  uptimeRows.forEach(function (r) { uptimeByCenter[r.center_id] = r; });

  // Jira device count per center, unfiltered by device type (see getAssetIndex_).
  var jiraCountByCenter = {};
  getAssetIndex_().forEach(function (a) {
    if (a.center_id != null) jiraCountByCenter[a.center_id] = (jiraCountByCenter[a.center_id] || 0) + 1;
  });

  var joined = withTickets.map(function (row) {
    var u = uptimeByCenter[row.center_id];
    row.lifecycle_years = u ? u.lifecycle_years : null;
    row.downtime_days = u ? u.downtime_days : null;
    row.uptime_pct = u ? u.uptime_pct : null;
    row.mtbf_hrs = u ? u.mtbf_hrs : null;
    row.failures = u ? u.failures : 0;
    row.jira_devices = jiraCountByCenter[row.center_id] || 0;
    return row;
  });

  cachePutLarge(ckey, joined, 1800); // outlives the 10-min warm interval
  return joined;
}

/** enrichCenterNames_ using the center_details rows. */
function enrichCenterNamesCD_(rows) {
  if (!rows || !rows.length) return rows;
  var byId = {};
  getCenter360RowsCD_().forEach(function (r) { byId[r.center_id] = r; });
  rows.forEach(function (r) {
    var c = byId[r.centerid];
    r.center = (c && c.center) || ('Center #' + r.centerid);
    // Jira fleet count, not cloud_devices — per user, 2026-08-19: everywhere
    // except CDM. reliability/assetHealth specs never select their own
    // `devices` field, so this always backfills it (the `== null` guard is
    // for safety, not because some caller already sets it).
    if (r.devices == null) r.devices = c ? c.jira_devices : 0;
  });
  return rows;
}

/** Sorted, non-blank distinct values of one field across an array of objects. */
function distinctValues_(rows, field) {
  var seen = {}, out = [];
  rows.forEach(function (r) {
    var v = String((r && r[field]) || '').trim();
    if (v && !seen[v]) { seen[v] = true; out.push(v); }
  });
  return out.sort();
}

/** center_id → {segment, status, state, hub, city, country, billable, machine_type, device_id, mac_serial_id} from the cached Center-360 rows. */
function centerFilterMap_() {
  var m = {};
  getCenter360RowsCD_().forEach(function (r) {
    // center_id and deployment_date are NOT optional extras: centerPassesFilters_
    // reads all these. While the map supplied only the first six, the
    // predicate's `centers` branch compared f.centers against
    // String(undefined) === "undefined" (never matches, so a Center selection
    // returned nothing) and its date branch hit `!d` on an empty string (so ANY
    // date range rejected every row, and the whole device fleet read 0). The
    // same omission bug would hit billable/machineTypes/deviceIds/macSerialIds
    // (added 2026-08-21) if they weren't carried here too.
    m[r.center_id] = { segment: r.segment || '', status: r.status || '', state: r.state || '', hub: r.hub || '',
      city: r.city || '', country: r.country || '',
      billable: r.billable || '', machine_type: r.machine_type || '',
      device_id: r.device_id || '', mac_serial_id: r.mac_serial_id || '',
      center_id: r.center_id, deployment_date: r.deployment_date || '' };
  });
  return m;
}

/**
 * Does this Center-360 row (or anything carrying the same 6 fields + a
 * deployment_date) pass the current global filter set? Empty array on any
 * dimension = no restriction on that dimension (existing convention).
 * @param {{segment:string,status:string,state:string,hub:string,city:string,country:string,deployment_date:string}} row
 * @param {{segments:Array,statuses:Array,states:Array,hubs:Array,cities:Array,countries:Array,dateFrom:string,dateTo:string}} filters
 * @return {boolean}
 */
function centerPassesFilters_(row, filters) {
  var f = filters || {};
  function inList(list, value) { return !list || !list.length || list.indexOf(value) !== -1; }
  if (!inList(f.segments, row.segment)) return false;
  if (!inList(f.statuses, row.status)) return false;
  if (!inList(f.states, row.state)) return false;
  if (!inList(f.hubs, row.hub)) return false;
  if (!inList(f.cities, row.city)) return false;
  if (!inList(f.countries, row.country)) return false;
  // String()-compared: the filter values arrive from the client as strings
  // while row.center_id is numeric, and the SQL path compares them as strings
  // too (see centerAttrCond_'s CAST) — both paths must agree or they disagree
  // on the same filter set (the finding-I4 failure mode).
  if (!inList(f.centers, String(row.center_id))) return false;
  if (!inList(f.billable, row.billable)) return false;
  if (!inList(f.machineTypes, row.machine_type)) return false;
  if (!inList(f.deviceIds, row.device_id)) return false;
  if (!inList(f.macSerialIds, row.mac_serial_id)) return false;
  var d = row.deployment_date ? row.deployment_date.slice(0, 10) : '';
  if (f.dateFrom && (!d || d < f.dateFrom)) return false;
  if (f.dateTo && (!d || d > f.dateTo)) return false;
  return true;
}

/**
 * Narrows an outer table (zoho_data, cloud_devices) to rows whose CenterID
 * passes the center_details filter set. Generalizes the old single-segment,
 * device-only CenterID-subquery bridge (retired by Task 7) to all
 * center-attribute dimensions uniformly — one code path instead of mixing
 * native-column and subquery access per dimension.
 * @param {{segments:Array,statuses:Array,states:Array,hubs:Array,cities:Array,countries:Array}} filters
 * @return {string}
 */
function centerFilterSubqueryCond_(filters) {
  var cond = centerAttrCond_(filters);
  if (!cond) return '';
  return ' AND CenterID IN (SELECT DISTINCT CenterID FROM ' + T('center_details') +
    ' WHERE ' + cdFilter_() + cond + ')';
}

/** Resolve [lat,lng] for a center_details row: direct coords, else pin-geostore. */
function coordsForCD_(row, geoStore) {
  var lat = typeof row.lat === 'number' ? row.lat : parseFloat(row.lat);
  var lng = typeof row.lng === 'number' ? row.lng : parseFloat(row.lng);
  if (isFinite(lat) && isFinite(lng) && (lat !== 0 || lng !== 0)) return [lat, lng];
  var coords = geoStore[geoKeyFor(row)];
  if (coords && coords !== 'x') {
    var p = coords.split(',');
    return [parseFloat(p[0]), parseFloat(p[1])];
  }
  return null;
}

/* ═══════════════ Duplicate endpoints (client calls these in CD edition) ══ */

function apiGetDashboardCD(options) {
  options = options || {};
  var hub = String(options.hub || '').slice(0, 120);
  var filters = {
    segments: (options.filters && options.filters.segments) || [],
    statuses: (options.filters && options.filters.statuses) || [],
    states: (options.filters && options.filters.states) || [],
    hubs: (options.filters && options.filters.hubs) || [],
    cities: (options.filters && options.filters.cities) || [],
    countries: (options.filters && options.filters.countries) || [],
    centers: (options.filters && options.filters.centers) || [],
    deviceTypes: (options.filters && options.filters.deviceTypes) || [],
    deviceStatusExclude: (options.filters && options.filters.deviceStatusExclude) || [],
    billable: (options.filters && options.filters.billable) || [],
    machineTypes: (options.filters && options.filters.machineTypes) || [],
    deviceIds: (options.filters && options.filters.deviceIds) || [],
    macSerialIds: (options.filters && options.filters.macSerialIds) || [],
    dateFrom: String((options.filters && options.filters.dateFrom) || ''),
    dateTo: String((options.filters && options.filters.dateTo) || '')
  };
  return respond_(function () {
    // reliability carries every scored center (2026-07-23 watchlist merge,
    // narrowed 2026-07-30 to drop the no-longer-needed assetHealth spec from
    // THIS endpoint only — see the .filter() below), not just 12, so this
    // payload can exceed withCache's 100KB-per-key limit. cachePutLarge/
    // cacheGetLarge (gzip + chunked, already used for Center-360) replace
    // withCache here — same TTL, no size ceiling.
    // v9: reverted the v8 Tech/Nontech zoho*/sla* spec split — Support keeps
    // the combined Zoho dataset again (Service will get its own, separate
    // data source instead of a Zoho scope).
    // v10: zoho_data dedup (see zohoDedupSql_, Queries.js).
    // v11: City/Country filter dimensions added.
    // v12: centerKpis.states -> centers_with_open_tickets.
    // v13: zoho_data excludes unassigned tickets.
    // v14: Device Type/Status filter applied to asset donuts/cohort + fleet.
    // v15: country filter sources from hub_country.
    // v16: Support page — dropped zohoPriority/zohoChannel, added zohoOpenAge.
    // v17: Asset page — dropped cloud_devices kpis/fleetStatus/firmware/hubs
    // specs (device-status donut, firmware chart, device explorer all removed;
    // cloud_devices data is CDM/Numbers/Raw-Data only now).
    // v18: billable/machineTypes/deviceIds/macSerialIds filters added.
    // v19: unmapped Jira assets no longer excluded by a center-attribute filter.
    // v20: Support page — added zohoMonthlyCompletion (same-month resolution rate).
    var cacheKey = 'dashcd_v20_' + getCacheEpoch_() + '_' + filterHash_(filters) + '_' + shortHash(hub);
    if (options.bypassCache !== true) {
      var cached = cacheGetLarge(cacheKey);
      if (cached) return cached;
    }
    // assetHealth is excluded here (2026-07-30): Center 360 now carries
    // mtbf_hrs/failures directly, so nothing consumes this endpoint's
    // assetHealth anymore. reliability is NOT excluded — it stays computed
    // (Overview's separate apiGetExecOverviewCD endpoint depends on the same
    // spec definition, and this array is otherwise harmless/unused here).
    var dashSpecs = buildDashboardQuerySpecsCD(hub, filters).filter(function (s) {
      return s.key !== 'assetHealth';
    });
    var results = runQueriesParallel(dashSpecs);
    enrichCenterNamesCD_(results.reliability);
    // Jira metrics from jira_data. An asset whose center is unresolved
    // (center_id == null) now always passes the center-attribute filter
    // instead of being dropped by it — matches the 2026-08-25 fix in
    // Numbers.js's filteredJiraDevices_ (see its comment for the full
    // reasoning: this exact "drop whenever ANY of Segment/Status/State/Hub/
    // City/Country is active" behavior, present since v5.8, was silently
    // zeroing out entire Jira Issue Types under the default Status:Active
    // filter). Date range checks the asset's OWN Jira Created date directly,
    // not the center's deployment date.
    var assetIdx = getAssetIndex_();
    // Device Type / Device Status (in Jira) option lists for the Filters
    // drawer — always the FULL vocabulary (unfiltered by any other active
    // dimension), same convention as segmentOptions/stateOptions/etc.
    results.deviceTypeOptions = distinctValues_(assetIdx, 'type').map(function (v) { return { type: v }; });
    results.deviceStatusOptions = distinctValues_(assetIdx, 'status').map(function (v) { return { status: v }; });
    var hasCenterFilter = filters.segments.length || filters.statuses.length ||
      filters.states.length || filters.hubs.length || filters.cities.length ||
      filters.countries.length || (filters.centers || []).length ||
      (filters.billable || []).length || (filters.machineTypes || []).length ||
      (filters.deviceIds || []).length || (filters.macSerialIds || []).length;
    if (hasCenterFilter) {
      var cfMap = centerFilterMap_();
      assetIdx = assetIdx.filter(function (a) {
        return a.center_id == null || centerPassesFilters_(cfMap[a.center_id] || {}, {
          segments: filters.segments, statuses: filters.statuses, states: filters.states, hubs: filters.hubs,
          cities: filters.cities, countries: filters.countries, centers: filters.centers || [],
          billable: filters.billable || [], machineTypes: filters.machineTypes || [],
          deviceIds: filters.deviceIds || [], macSerialIds: filters.macSerialIds || []
        });
      });
    }
    if (filters.dateFrom || filters.dateTo) {
      assetIdx = assetIdx.filter(function (a) {
        var d = a.birthday || '';
        if (filters.dateFrom && (!d || d < filters.dateFrom)) return false;
        if (filters.dateTo && (!d || d > filters.dateTo)) return false;
        return true;
      });
    }
    // Device Type / Device Status (in Jira) — per user, 2026-08-13. Keeps the
    // Asset page's own donuts/cohort internally consistent with the `fleet`
    // KPI below, which applies the identical filter inside jiraDeviceStats_.
    if (filters.deviceTypes.length) {
      assetIdx = assetIdx.filter(function (a) { return filters.deviceTypes.indexOf(a.type) !== -1; });
    }
    if (filters.deviceStatusExclude.length) {
      assetIdx = assetIdx.filter(function (a) { return filters.deviceStatusExclude.indexOf(a.status) === -1; });
    }
    results.assets = assetsDonutFromIndex_(assetIdx);
    results.cohortReliability = cohortFromIndex_(assetIdx, results.zohoFailByCenter);
    delete results.zohoFailByCenter;
    results.deviceUptime = getDeviceUptimeFleet_();
    results.appName = CONFIG.APP_NAME;
    results.appVersion = CONFIG.APP_VERSION;
    // jiraDeviceStats_ (Numbers.js) now accepts a `filters` object directly
    // (Task 7 — "jiraDeviceStats_ + device explorer filter threading") and
    // applies the same centerFilterMap_/centerPassesFilters_ narrowing as the
    // rest of this payload.
    results.fleet = jiraDeviceStats_(filters);
    results.filters = filters;
    results.edition = 'center_details';
    results.flags = FLAGS_CD;
    results.hub = hub;
    cachePutLarge(cacheKey, results, CONFIG.CACHE_TTL_SECONDS);
    return results;
  });
}

function apiGetCentersCD(options) {
  options = options || {};
  var clean = {
    search: String(options.search || '').toLowerCase().slice(0, 80),
    filters: {
      segments: ((options.filters && options.filters.segments) || []).map(segClean_).filter(Boolean),
      statuses: ((options.filters && options.filters.statuses) || []).map(segClean_).filter(Boolean),
      states: ((options.filters && options.filters.states) || []).map(segClean_).filter(Boolean),
      hubs: ((options.filters && options.filters.hubs) || []).map(segClean_).filter(Boolean),
      cities: ((options.filters && options.filters.cities) || []).map(segClean_).filter(Boolean),
      countries: ((options.filters && options.filters.countries) || []).map(segClean_).filter(Boolean),
      centers: ((options.filters && options.filters.centers) || []).map(segClean_).filter(Boolean),
      billable: ((options.filters && options.filters.billable) || []).map(segClean_).filter(Boolean),
      machineTypes: ((options.filters && options.filters.machineTypes) || []).map(segClean_).filter(Boolean),
      deviceIds: ((options.filters && options.filters.deviceIds) || []).map(segClean_).filter(Boolean),
      macSerialIds: ((options.filters && options.filters.macSerialIds) || []).map(segClean_).filter(Boolean),
      dateFrom: String((options.filters && options.filters.dateFrom) || ''),
      dateTo: String((options.filters && options.filters.dateTo) || '')
    },
    sortBy: String(options.sortBy || 'devices'),
    sortDir: options.sortDir === 'asc' ? 'asc' : 'desc',
    page: Math.max(0, parseInt(options.page, 10) || 0),
    pageSize: Math.min(100, Math.max(5, parseInt(options.pageSize, 10) || 15))
  };
  return respond_(function () {
    var joined = getCenter360RowsCD_();
    var filtered = joined.filter(function (row) {
      if (!centerPassesFilters_(row, clean.filters)) return false;
      if (!clean.search) return true;
      return (String(row.center).toLowerCase().indexOf(clean.search) !== -1 ||
              String(row.center_id).indexOf(clean.search) !== -1 ||
              String(row.hub).toLowerCase().indexOf(clean.search) !== -1 ||
              String(row.state).toLowerCase().indexOf(clean.search) !== -1);
    });
    var sortCol = CENTER_SORT_KEYS[clean.sortBy] || 'devices';
    // Per user, 2026-08-13: sorting by open tickets tiebreaks on uptime asc,
    // so the 0-ticket majority still surfaces its worst-uptime centers first.
    sortRows(filtered, sortCol, clean.sortDir, sortCol === 'open_tickets' ? 'uptime_pct' : null, 'asc');
    var start = clean.page * clean.pageSize;
    return {
      rows: filtered.slice(start, start + clean.pageSize),
      totalRows: filtered.length, page: clean.page, pageSize: clean.pageSize,
      edition: 'center_details', flags: FLAGS_CD
    };
  });
}

/**
 * Server-side Hub search for the global filter drawer's Hub combobox.
 *
 * Why an endpoint instead of an option list: center_details holds 13,721
 * distinct real HubName values (live sandbox count), so shipping them with the
 * dashboard payload the way segmentOptions/stateOptions do is neither cheap nor
 * completable — any static cap truncates mid-alphabet (whole-branch review
 * finding C1; user decision was "search endpoint, not a bigger list"). The
 * client debounces keystrokes and renders whatever comes back.
 *
 * Two modes:
 *   query < 2 chars → the top 50 hubs BY CENTER COUNT. This is the default set
 *     the combobox shows on focus, before the user types — the alphabetically
 *     first 50 would be punctuation-heavy junk, the biggest 50 are useful.
 *   query >= 2 chars → up to 50 hubs whose name contains it (case-insensitive).
 *
 * Sanitisation: segClean_ (quotes/length, as every other filter input) then
 * likeEscape_ for the LIKE wildcards, passed as a named parameter — never
 * concatenated into the SQL. Values come back TRIM'd, matching multiCond_'s
 * TRIM(IFNULL(...)) comparison so a selected hub actually matches (finding I4).
 * @param {{query:string}=} options
 * @return {Object} envelope with { hubs:Array<string>, query:string, mode:string }
 */
function apiSearchHubsCD(options) {
  options = options || {};
  var q = segClean_(String(options.query || '')).toLowerCase();
  return respond_(function () {
    return withCache('hubsrch_v1_' + getCacheEpoch_() + '_' + shortHash(q), function () {
      var CD = T('center_details');
      var base = " WHERE " + cdFilter_() + " AND NULLIF(TRIM(HubName), '') IS NOT NULL";
      var sql, params = null;
      if (q.length < 2) {
        sql = "SELECT TRIM(HubName) AS hub, COUNT(DISTINCT CenterID) AS centers FROM " + CD +
          base + " GROUP BY hub ORDER BY centers DESC, hub LIMIT 50";
      } else {
        // Matches HubName OR HubID (per user): operators know hubs by id as
        // often as by name. The RETURNED value is still the hub NAME, because
        // that's the dimension centerAttrCond_/centerPassesFilters_ compare
        // against — searching by id is a lookup convenience, not a change to
        // what gets filtered. CAST so a numeric HubID is matchable as text.
        sql = "SELECT DISTINCT TRIM(HubName) AS hub FROM " + CD + base +
          " AND (LOWER(TRIM(HubName)) LIKE @like OR CAST(HubID AS STRING) LIKE @like)" +
          " ORDER BY hub LIMIT 50";
        params = { like: '%' + likeEscape_(q) + '%' };
      }
      var rows = runQuery(sql, params, { maxRows: 50 }) || [];
      return {
        hubs: rows.map(function (r) { return r.hub; }),
        query: q, mode: q.length < 2 ? 'top' : 'search',
        edition: 'center_details'
      };
    }, options.bypassCache === true);
  });
}

/**
 * Server-side Center search for the Center filter dimension — same design as
 * apiSearchHubsCD and for the same reason: center_details holds ~28k distinct
 * centers, far too many to ship as a static option list.
 *
 * Returns {value, label} pairs rather than bare strings: the filter keys on
 * CenterID (unique) while the drawer shows "Name · #id", because center names
 * are NOT unique and a name-keyed filter would quietly match the wrong rows.
 * A query matches EITHER the name or the id (per user) — operators refer to
 * centers both ways. An empty/1-char query returns the first 50 by CenterID,
 * which is what the combobox shows on focus. That ordering is arbitrary rather
 * than "most relevant" — unlike apiSearchHubsCD's default, which ranks by
 * center count. Worth revisiting if the default list proves unhelpful; ranking
 * centers would need a device/ticket count join this lookup deliberately avoids.
 */
function apiSearchCentersCD(options) {
  options = options || {};
  var q = segClean_(String(options.query || '')).toLowerCase();
  return respond_(function () {
    return withCache('ctrsrch_v1_' + getCacheEpoch_() + '_' + shortHash(q), function () {
      var CD = T('center_details');
      var base = " WHERE " + cdFilter_() + " AND CenterID IS NOT NULL";
      var sql, params = null;
      if (q.length < 2) {
        sql = "SELECT CAST(CenterID AS STRING) AS value, " +
          " CONCAT(IFNULL(NULLIF(TRIM(Centername), ''), 'Center'), ' · #', CAST(CenterID AS STRING)) AS label " +
          "FROM " + CD + base + " GROUP BY CenterID, Centername ORDER BY CenterID LIMIT 50";
      } else {
        sql = "SELECT CAST(CenterID AS STRING) AS value, " +
          " CONCAT(IFNULL(NULLIF(TRIM(Centername), ''), 'Center'), ' · #', CAST(CenterID AS STRING)) AS label " +
          "FROM " + CD + base +
          " AND (LOWER(TRIM(Centername)) LIKE @like OR CAST(CenterID AS STRING) LIKE @like)" +
          " GROUP BY CenterID, Centername ORDER BY CenterID LIMIT 50";
        params = { like: '%' + likeEscape_(q) + '%' };
      }
      var rows = runQuery(sql, params, { maxRows: 50 }) || [];
      return {
        centers: rows.map(function (r) { return { value: String(r.value), label: String(r.label) }; }),
        query: q, mode: q.length < 2 ? 'top' : 'search',
        edition: 'center_details'
      };
    }, options.bypassCache === true);
  });
}

/**
 * Server-side Device ID search for the Device ID filter dimension — same
 * design as apiSearchHubsCD and for the same reason: center_details holds
 * ~7,400 distinct DeviceID values, far too many to ship as a static list.
 * @param {{query:string, bypassCache:boolean}=} options
 */
function apiSearchDeviceIdsCD(options) {
  options = options || {};
  var q = segClean_(String(options.query || '')).toLowerCase();
  return respond_(function () {
    return withCache('devidsrch_v1_' + getCacheEpoch_() + '_' + shortHash(q), function () {
      var CD = T('center_details');
      var base = " WHERE " + cdFilter_() + " AND NULLIF(TRIM(DeviceID), '') IS NOT NULL";
      var sql, params = null;
      if (q.length < 2) {
        sql = "SELECT TRIM(DeviceID) AS deviceId, COUNT(DISTINCT CenterID) AS centers FROM " + CD +
          base + " GROUP BY deviceId ORDER BY centers DESC, deviceId LIMIT 50";
      } else {
        sql = "SELECT DISTINCT TRIM(DeviceID) AS deviceId FROM " + CD + base +
          " AND LOWER(TRIM(DeviceID)) LIKE @like ORDER BY deviceId LIMIT 50";
        params = { like: '%' + likeEscape_(q) + '%' };
      }
      var rows = runQuery(sql, params, { maxRows: 50 }) || [];
      return {
        deviceIds: rows.map(function (r) { return r.deviceId; }),
        query: q, mode: q.length < 2 ? 'top' : 'search',
        edition: 'center_details'
      };
    }, options.bypassCache === true);
  });
}

/**
 * Server-side Mac Serial ID search for the Mac Serial ID filter dimension —
 * same design as apiSearchDeviceIdsCD, for the same reason (center_details
 * holds ~16,000 distinct MacSerialID values).
 * @param {{query:string, bypassCache:boolean}=} options
 */
function apiSearchMacSerialIdsCD(options) {
  options = options || {};
  var q = segClean_(String(options.query || '')).toLowerCase();
  return respond_(function () {
    return withCache('macsrch_v1_' + getCacheEpoch_() + '_' + shortHash(q), function () {
      var CD = T('center_details');
      var base = " WHERE " + cdFilter_() + " AND NULLIF(TRIM(MacSerialID), '') IS NOT NULL";
      var sql, params = null;
      if (q.length < 2) {
        sql = "SELECT TRIM(MacSerialID) AS macSerialId, COUNT(DISTINCT CenterID) AS centers FROM " + CD +
          base + " GROUP BY macSerialId ORDER BY centers DESC, macSerialId LIMIT 50";
      } else {
        sql = "SELECT DISTINCT TRIM(MacSerialID) AS macSerialId FROM " + CD + base +
          " AND LOWER(TRIM(MacSerialID)) LIKE @like ORDER BY macSerialId LIMIT 50";
        params = { like: '%' + likeEscape_(q) + '%' };
      }
      var rows = runQuery(sql, params, { maxRows: 50 }) || [];
      return {
        macSerialIds: rows.map(function (r) { return r.macSerialId; }),
        query: q, mode: q.length < 2 ? 'top' : 'search',
        edition: 'center_details'
      };
    }, options.bypassCache === true);
  });
}

function apiGetMapDataCD(options) {
  options = options || {};
  var filters = {
    segments: (options.filters && options.filters.segments) || [],
    statuses: (options.filters && options.filters.statuses) || [],
    states: (options.filters && options.filters.states) || [],
    hubs: (options.filters && options.filters.hubs) || [],
    cities: (options.filters && options.filters.cities) || [],
    countries: (options.filters && options.filters.countries) || [],
    centers: (options.filters && options.filters.centers) || [],
    billable: (options.filters && options.filters.billable) || [],
    machineTypes: (options.filters && options.filters.machineTypes) || [],
    deviceIds: (options.filters && options.filters.deviceIds) || [],
    macSerialIds: (options.filters && options.filters.macSerialIds) || [],
    dateFrom: String((options.filters && options.filters.dateFrom) || ''),
    dateTo: String((options.filters && options.filters.dateTo) || '')
  };
  return respond_(function () {
    // v13: ungeocoded centers (no direct lat/lng, no cached pin-geocode) are no
    // longer dropped outright — they're plotted at a proxy coordinate (the
    // average of already-geocoded centers sharing their city, else their hub),
    // per user 2026-08-21, so the map's count matches Customer 360 instead of
    // trailing it by however many centers runGeocodeBatch() hasn't reached yet.
    // Index 12 (approx) flags these so the client can mark them visually
    // distinct — they're a neighborhood-level guess, not the center's real spot.
    // v14: billable/machineTypes/deviceIds/macSerialIds filters added.
    // v15: payload gained `fse` (the coverage layer) — a v14 entry cached before
    // this deploy has no such key, and the client would read it as "no
    // engineers" for up to the 30-min TTL rather than as "not loaded yet".
    // NOTE: the key does not hash FSE_ROSTER, so a roster edit can serve a
    // stale layer until the entry expires (or getCacheEpoch_ moves).
    // v16: payload gained `cp` (the dealer layer) — same reasoning as v15: a
    // v15 entry cached before this deploy has no `cp` key, and would read as
    // "no dealers" for up to the 30-min TTL rather than "not loaded yet".
    // v17: payload rows gained index 13 (max_open_age_days) for the map's
    // ticket-severity color/legend/filter, switched from open-ticket count.
    // v18: payload rows gained index 14 (country, from hub_country) for the
    // map's country-outline layer, switched from point-in-polygon to an
    // exact-name match.
    var cacheKey = 'mapcd_v18_' + getCacheEpoch_() + '_' + filterHash_(filters);
    if (options.bypassCache !== true) {
      var cached = cacheGetLarge(cacheKey);
      if (cached) return cached;
    }

    var allCenters = getCenter360RowsCD_();
    var centers = allCenters.filter(function (row) { return centerPassesFilters_(row, filters); });
    var assets = getAssetIndex_();               // from the Jira SHEET (Connector + ECG only)
    var geoStore = loadGeoStore();

    var assetCount = {};
    assets.forEach(function (a) {
      if (a.center_id !== null) assetCount[a.center_id] = (assetCount[a.center_id] || 0) + 1;
    });

    // Proxy pool built from EVERY center with a real coordinate (not just the
    // current filter's) — a center's geographic neighbors don't depend on
    // which segment/status/etc. happens to be selected right now.
    var cityCoords = {}, hubCoords = {};
    function accumulate_(map, key, c) {
      var e = map[key] || (map[key] = { latSum: 0, lngSum: 0, n: 0 });
      e.latSum += c[0]; e.lngSum += c[1]; e.n++;
    }
    allCenters.forEach(function (row) {
      var c = coordsForCD_(row, geoStore);
      if (!c) return;
      if (row.city) accumulate_(cityCoords, row.city + '|' + row.state, c);
      if (row.hub_id != null && row.hub_id !== '') accumulate_(hubCoords, String(row.hub_id), c);
    });
    function proxyCoord_(row) {
      var cc = row.city && cityCoords[row.city + '|' + row.state];
      if (cc) return [cc.latSum / cc.n, cc.lngSum / cc.n];
      var hc = row.hub_id != null && row.hub_id !== '' && hubCoords[String(row.hub_id)];
      if (hc) return [hc.latSum / hc.n, hc.lngSum / hc.n];
      return null;
    }

    var locatedIds = {}, located = [];
    centers.forEach(function (row) {
      var c = coordsForCD_(row, geoStore);
      var approx = c ? 0 : 1;
      if (!c) c = proxyCoord_(row);
      if (c) {
        locatedIds[row.center_id] = true;
        located.push([
          // index 4 ("devices") is Jira-sourced (row.jira_devices), not
          // cloud_devices — per user, 2026-08-19: devices means the Jira
          // fleet count everywhere except the CDM page, which stays on
          // cloud_devices telemetry on purpose. index 5 ("online") was the
          // cloud_devices heartbeat stat — dropped per user, 2026-08-19:
          // cloud_devices data is CDM/Numbers/Raw-Data only now. Index 7
          // duplicates the same Jira count for the App.html drawer fallback
          // that reads it directly (jiraDevCount = assetsList.length || c[7]).
          row.center_id, row.center, c[0], c[1], row.jira_devices, 0,
          row.open_tickets, assetCount[row.center_id] || 0,
          row.hub || '', row.hub_id != null ? row.hub_id : '',
          // index 13 (max_open_age_days, -1 sentinel for "no open ticket") —
          // per user, 2026-08-25: the map's ticket-severity color/legend/click
          // filter switched from open-ticket COUNT to the oldest open ticket's
          // AGE in days, same field getCenter360RowsCD_ already computes for
          // the Top Customers leaderboard. c[6] (open ticket count) stays as
          // it was for the tooltip text — only the color/bucket source moved.
          // index 14 (country, from hub_country — already computed on `row`
          // by getCenter360RowsCD_, just not previously projected here) feeds
          // the map's country-outline layer, which switched from a lat/lng
          // point-in-polygon test to an exact-name match against this field.
          row.segment || '', row.state || '', approx, row.max_open_age_days,
          row.country || ''
        ]);
      }
    });

    // [center_id, serial] only — the map's serial search is the sole
    // remaining consumer now that the chart cards are gone.
    var assetRows = [];
    assets.forEach(function (asset) {
      if (asset.center_id === null || !locatedIds[asset.center_id]) return;
      assetRows.push([asset.center_id, asset.serial || '']);
    });

    // FSE coverage layer (Fse.js). Guarded on a non-empty roster so an empty one
    // costs nothing. That guard was load-bearing for six deploys: FSE_ROSTER was
    // empty from @83/@84 through @88, so this sent fse: null and production drew
    // no pins at all. 78ed2f8/@89 filled it, so the query now really runs -- on
    // every cache MISS, not every map load (Warm.js re-warms the default filter
    // set every 10 min, so users normally hit a hot cache). To discover the names
    // to seed the roster with, run fseListRepNames() from the editor.
    //
    // plottedIds, not every center: coverage of a center the current filter has
    // hidden must not count, or an engineer's fan would draw to a marker that
    // isn't there. Uses the SAME coordsForCD_ the centers above go through, so
    // an HQ in a city that already has a geocoded center needs no new geocode.
    var fse = null;
    if (fseRosterActive_().length) {
      var plottedIds = {};
      located.forEach(function (c) { plottedIds[String(c[0])] = true; });
      var fseRows = runQueriesParallel([buildFseCoverageSpec_()]).fseCoverage || [];
      fse = buildFseLayer_(fseRows, function (entry) {
        return coordsForCD_(
          { lat: entry.lat, lng: entry.lng, city: entry.hqCity, state: entry.hqState }, geoStore);
      }, plottedIds);
    }

    // CP (Channel Partner) dealer layer (Cp.js). Unlike fse above, this needs
    // no query and no active-roster guard to skip a query cost — every
    // coordinate on CP_ROSTER is explicit (spec: docs/superpowers/specs/
    // 2026-08-24-cp-dealer-layer-design.md), so hqCoordFn/locationCoordFn are
    // trivial pass-throughs. Guarded on non-empty roster only so an empty
    // catalog sends `cp: null` (no layer) instead of an empty-but-present one.
    var cp = null;
    if (CP_ROSTER.length) {
      cp = buildCpLayer_(CP_ROSTER,
        function (entry) { return (entry.lat != null && entry.lng != null) ? [entry.lat, entry.lng] : null; },
        function (entry, loc) { return (loc.lat != null && loc.lng != null) ? [loc.lat, loc.lng] : null; });
    }

    var payload = {
      centers: located, assets: assetRows, fse: fse, cp: cp,
      edition: 'center_details', flags: FLAGS_CD
    };
    cachePutLarge(cacheKey, payload, 1800); // outlives the 10-min warm interval
    return payload;
  });
}

/**
 * CDM (Communicator Device Management) page: fleet-wide KPIs/charts
 * (buildCdmQuerySpecs, cloud_devices-only — no CD-suffixed duplicate needed)
 * plus a center-location map reusing the same Center-360 rows + pin-geocode
 * store as apiGetMapDataCD. Self-contained (own endpoint, own cache key) —
 * does NOT share the Asset/Centers/Support/Service/Overview dashboard payload.
 */
function apiGetCdmDataCD(options) {
  options = options || {};
  var filters = {
    segments: (options.filters && options.filters.segments) || [],
    statuses: (options.filters && options.filters.statuses) || [],
    states: (options.filters && options.filters.states) || [],
    hubs: (options.filters && options.filters.hubs) || [],
    cities: (options.filters && options.filters.cities) || [],
    countries: (options.filters && options.filters.countries) || [],
    centers: (options.filters && options.filters.centers) || [],
    billable: (options.filters && options.filters.billable) || [],
    machineTypes: (options.filters && options.filters.machineTypes) || [],
    deviceIds: (options.filters && options.filters.deviceIds) || [],
    macSerialIds: (options.filters && options.filters.macSerialIds) || []
  };
  return respond_(function () {
    var cacheKey = 'cdmcd_v5_' + getCacheEpoch_() + '_' + filterHash_(filters); // v5: map rows gained index 11 (country) for the map's country-outline layer; v4: map restricted to centers cloud_devices actually reports on
    if (options.bypassCache !== true) {
      var cached = cacheGetLarge(cacheKey);
      if (cached) return cached;
    }

    var results = runQueriesParallel(buildCdmQuerySpecs(filters));

    // Map scope = cloud_devices' own footprint, not every center_details row
    // that passes filters — per user, 2026-08-25. A center_details center
    // with no cloud_devices rows (e.g. Jira-only fleet) has nothing for this
    // page to show and would otherwise inflate the map past what "Total
    // Communicators" above it claims to cover.
    var cdCenterIds_ = {};
    (results.cdmCenterIds || []).forEach(function (r) { cdCenterIds_[r.center_id] = true; });
    var centers = getCenter360RowsCD_().filter(function (row) {
      return centerPassesFilters_(row, filters) && cdCenterIds_[row.center_id];
    });
    var geoStore = loadGeoStore();
    var located = [], unlocated = 0;
    centers.forEach(function (row) {
      var c = coordsForCD_(row, geoStore);
      if (c) {
        located.push([
          row.center_id, row.center, c[0], c[1], row.devices, row.online,
          row.low_battery || 0, row.avg_csq, row.hub || '', row.hub_id != null ? row.hub_id : '', row.state || '',
          row.country || ''
        ]);
      } else { unlocated++; }
    });

    var payload = {
      kpis: (results.cdmKpis && results.cdmKpis[0]) || {},
      signal: results.cdmSignal || [], battery: results.cdmBattery || [],
      hardware: results.cdmHardware || [], ecg: results.cdmEcg || [],
      centers: located, unlocatedCenters: unlocated,
      edition: 'center_details', flags: FLAGS_CD
    };
    cachePutLarge(cacheKey, payload, CONFIG.CACHE_TTL_SECONDS);
    return payload;
  });
}

/**
 * Resolves which curated TOP_CUSTOMERS group (if any) a center row belongs
 * to. A center-level claim (centerToGroup) always wins over a hub-level one
 * (hubToGroup) — added 2026-09-04 for Matcare, whose 4 spoke centers sit
 * inside Indira IVF's hub with no hub of their own: without this priority,
 * matching purely on row.hub_id would attribute them to whichever group
 * claims that hub instead.
 * @param {{hub_id:*, center_id:*}} row
 * @param {Object} hubToGroup hub_id -> group
 * @param {Object} centerToGroup center_id -> group
 * @return {Object|undefined}
 */
function topCustomerGroupFor_(row, hubToGroup, centerToGroup) {
  return centerToGroup[row.center_id] || hubToGroup[row.hub_id];
}

/**
 * Top-customers rollup over the center_details center universe.
 *
 * Devices and assets were dropped from this page's aggregation (per user,
 * 2026-08-24) — `getAssetIndex_()` is no longer read here at all, and
 * `row.jira_devices` is no longer summed per group. Individual centers still
 * carry their own device count into `mapCenters` (index 4, unchanged) since
 * that feeds the shared map factory's per-marker bubble sizing, not this
 * page's own KPI/table/chart surface. MRR was dropped from this page's own
 * aggregation the same way (per user, 2026-08-25) -- nothing else reads it.
 * Swapped (tickets_total's swapped count) and the oldest-open-ticket age
 * bucket were added in its place, both per user, 2026-08-25.
 */
function computeTopCustomersCD_(filters) {
  // hub_id -> owning group (a group can list several hub_ids), plus
  // center_id -> owning group for a group that claims individual spoke
  // centers instead of a whole hub (e.g. Matcare — see TOP_CUSTOMERS' own
  // comment). A center-level claim always wins: topCustomerGroupFor_ checks
  // centerToGroup before hubToGroup, so a center explicitly claimed by one
  // group isn't silently swept into another group that owns its hub.
  var hubToGroup = {}, centerToGroup = {};
  TOP_CUSTOMERS.forEach(function (c) {
    c.hub_ids.forEach(function (hid) { hubToGroup[hid] = c; });
    (c.center_ids || []).forEach(function (cid) { centerToGroup[cid] = c; });
  });

  var centers = getCenter360RowsCD_().filter(function (row) { return centerPassesFilters_(row, filters || {}); });
  var geoStore = loadGeoStore();

  // Aggregate by GROUP (summed across every hub_id/center_id it lists).
  var agg = {};
  TOP_CUSTOMERS.forEach(function (c) {
    agg[c.group] = { hub: c.group, hub_ids: c.hub_ids.slice(), center_ids: (c.center_ids || []).slice(),
      tier: c.tier, centers: 0, open_tickets: 0, located: 0, swapped: 0, maxOpenAgeDays: -1 };
  });

  var mapCenters = [];
  centers.forEach(function (row) {
    var grp = topCustomerGroupFor_(row, hubToGroup, centerToGroup);
    if (!grp) return;
    var a = agg[grp.group];
    a.centers += 1;
    a.open_tickets += row.open_tickets || 0;
    a.swapped += row.swapped || 0;
    if (row.max_open_age_days > a.maxOpenAgeDays) a.maxOpenAgeDays = row.max_open_age_days;
    var c = coordsForCD_(row, geoStore);
    if (c) {
      a.located += 1;
      // index 12 is a placeholder (this map has no "approx location" concept
      // the way Overview's does) so index 13 (max_open_age_days) lines up
      // with the same position as Overview's mapCenters — the shared
      // ticketColor colorFn/tooltip read a fixed index regardless of which
      // map instance supplied the row.
      mapCenters.push([row.center_id, row.center, c[0], c[1], row.jira_devices, 0,
        row.open_tickets, 0, row.hub || a.hub, row.hub_id, row.segment || '', row.state || '',
        0, row.max_open_age_days, row.country || '']);
    }
  });

  var customers = Object.keys(agg).map(function (k) { return agg[k]; })
    .sort(function (x, y) { return y.centers - x.centers; });

  var totals = { customers: customers.length, centers: 0,
    open_tickets: 0, withData: 0 };
  customers.forEach(function (c) {
    totals.centers += c.centers;
    totals.open_tickets += c.open_tickets;
    if (c.centers > 0) totals.withData += 1;
  });

  // Ticket count + SLA breach are hub-scoped (Zoho by HubID) — identical to the
  // default edition; reuse the shared helper. `filters` MUST be threaded: every
  // other number on this page is filtered, so an unfiltered ticket_count put a
  // filtered sub-label next to an unfiltered headline in the same tile
  // (whole-branch review finding I5, 2026-07-29).
  var sla = topCustomerTicketStats_(filters);
  totals.ticket_count = sla.total_tickets;
  totals.sla_breach = sla.sla_breach;
  totals.sla_within_pct = sla.sla_within_pct;

  return { customers: customers, mapCenters: mapCenters, totals: totals,
    edition: 'center_details', flags: FLAGS_CD };
}

function apiGetTopCustomersCD(options) {
  options = options || {};
  var filters = {
    segments: (options.filters && options.filters.segments) || [],
    statuses: (options.filters && options.filters.statuses) || [],
    states: (options.filters && options.filters.states) || [],
    hubs: (options.filters && options.filters.hubs) || [],
    cities: (options.filters && options.filters.cities) || [],
    countries: (options.filters && options.filters.countries) || [],
    centers: (options.filters && options.filters.centers) || [],
    billable: (options.filters && options.filters.billable) || [],
    machineTypes: (options.filters && options.filters.machineTypes) || [],
    deviceIds: (options.filters && options.filters.deviceIds) || [],
    macSerialIds: (options.filters && options.filters.macSerialIds) || [],
    dateFrom: String((options.filters && options.filters.dateFrom) || ''),
    dateTo: String((options.filters && options.filters.dateTo) || '')
  };
  return respond_(function () {
    return withCache('topcustcd_v16_' + getCacheEpoch_() + '_' + filterHash_(filters), // v16: mapCenters rows gained index 14 (country) for the map's country-outline layer; v15: gained max_open_age_days for the map's ticket-severity coloring
      function () { return computeTopCustomersCD_(filters); },
      options.bypassCache === true);
  });
}

function apiGetCenterDetailCD(options) {
  var centerId = parseInt(options && options.centerId, 10);
  return respond_(function () {
    if (!isFinite(centerId)) throw new Error('centerId is required');
    return withCache('ctrdetcd_v7_' + centerId, function () { // v7: added ServiceWRK ticket specs (svcTickets/svcOpenTickets/svcClosedTickets/svcSwappedTickets) and the matching Zoho swappedTickets (same '%swap%' IssueCategory match as centerTickets' swapped count)
      // Reuse the original detail specs (tickets/openTickets are keyed by
      // CenterID, center-table-agnostic); swap only the `info` query.
      var specs = buildCenterDetailSpecs(centerId).map(function (s) {
        if (s.key !== 'info') return s;
        return {
          key: 'info', params: s.params,
          sql:
            "SELECT ANY_VALUE(Centername) AS center, ANY_VALUE(HubID) AS hub_id, " +
            " ANY_VALUE(HubName) AS hub, ANY_VALUE(City) AS city, ANY_VALUE(State) AS state, " +
            " ANY_VALUE(PinCode) AS pin, ANY_VALUE(hub_country) AS country, " +
            " CAST(DATE(MIN(deploymentdate)) AS STRING) AS first_deployment, " +
            " DATE_DIFF(CURRENT_DATE(), DATE(MIN(deploymentdate)), MONTH) AS age_months, " +
            " NULL AS devices_ever " +           // no device grain in center_details
            "FROM " + T('center_details') + " WHERE CenterID = @cid"
        };
      });
      var detail = runQueriesParallel(specs);
      var assets = getAssetIndex_()
        .filter(function (asset) { return asset.center_id === centerId; })
        .sort(function (a, b) { return (b.age_days || 0) - (a.age_days || 0); })
        .slice(0, 100);
      return {
        info: (detail.info && detail.info[0]) || null,
        tickets: (detail.tickets && detail.tickets[0]) || null,
        openTickets: detail.openTickets || [],
        allTickets: detail.allTickets || [],
        swappedTickets: detail.swappedTickets || [],
        svcTickets: (detail.svcTickets && detail.svcTickets[0]) || null,
        svcOpenTickets: detail.svcOpenTickets || [],
        svcClosedTickets: detail.svcClosedTickets || [],
        svcSwappedTickets: detail.svcSwappedTickets || [],
        assets: assets,
        edition: 'center_details', flags: FLAGS_CD
      };
    });
  });
}

/**
 * Support/CS has no per-ticket or per-center list to filter (it's all
 * aggregate breakdown cards), so its global-search box is repurposed as a
 * lookup instead: try the query as a CenterID first, then as a Zoho
 * ticketNumber, resolving the ticket to ITS center — the client opens the
 * one existing center-detail drawer either way. Returns
 * `{kind:null}` (not an error) on no match; "not found" is a normal search
 * outcome, not a failure.
 */
function apiSupportSearchCD(options) {
  var idNum = parseInt(options && options.query, 10);
  return respond_(function () {
    if (!isFinite(idNum)) return { kind: null };
    return withCache('supportsearchcd_v3_' + idNum, function () { // v3: zoho_data excludes unassigned tickets
      var centerHit = runQuery(
        "SELECT CenterID AS center_id FROM " + T('center_details') + " WHERE CenterID = @id LIMIT 1",
        { id: idNum }
      );
      if (centerHit && centerHit[0]) return { kind: 'center', centerId: centerHit[0].center_id };

      var ticketHit = runQuery(
        "SELECT CenterID AS center_id FROM " + zohoDedupSql_() +
        " WHERE ticketNumber = @id AND CenterID IS NOT NULL LIMIT 1",
        { id: idNum }
      );
      if (ticketHit && ticketHit[0]) return { kind: 'ticket', centerId: ticketHit[0].center_id, ticketNumber: idNum };

      return { kind: null };
    });
  });
}
