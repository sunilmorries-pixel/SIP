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
 *   country  → Spoke_Country   (old bare `Country` column removed)
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
 * per call site (center_details.deploymentdate vs the SAFE.PARSE_DATETIME of
 * zoho_data.CreatedAt), so callers add their own dateRangeCond_.
 * @param {{segments:Array,statuses:Array,states:Array,hubs:Array}=} filters
 * @return {string} '' when no center-attribute dimension is active
 */
function centerAttrCond_(filters) {
  var f = filters || {};
  return multiCond_('hub_master_segment', f.segments) +
    multiCond_('Status', f.statuses) +
    multiCond_('State', f.states) +
    multiCond_('HubName', f.hubs);
}

/* ═══════════════ Uptime / MTBF / Health (birth = deploymentdate) ═════════ */

/**
 * Copy of centerUptimeSql_ with the birth CTE sourced from center_details
 * (deploymentdate) instead of device_center_mapping (startdatetime). Everything
 * else — Zoho device-failure downtime, MTBF, health tiers — is identical.
 * @param {string} tailSelect a SELECT over the final `scored` CTE
 */
function centerUptimeSqlCD_(tailSelect, filters) {
  var f = CONFIG.ZOHO_DT_FORMAT;
  var P = "SAFE.PARSE_DATETIME('" + f + "', ";
  var ff = filters || {};
  return "WITH tix AS (" +
    " SELECT CenterID AS center_id, " + P + "CreatedAt) AS s, " +
    "  COALESCE(" + P + "ClosedAt), CURRENT_DATETIME()) AS e " +
    " FROM " + T('zoho_data') + " WHERE CenterID IS NOT NULL " +
    "  AND " + techBoolSql_("IFNULL(IssueCategory,'')") + " " +
    "  AND " + P + "CreatedAt) IS NOT NULL), " +
    "birth AS (SELECT CenterID AS center_id, MIN(DATETIME(deploymentdate)) AS b " +
    "  FROM " + T('center_details') + " WHERE deploymentdate IS NOT NULL AND " + cdFilter_() +
    centerAttrCond_(ff) +
    dateRangeCond_('deploymentdate', ff.dateFrom, ff.dateTo) +
    " GROUP BY CenterID), " +
    "flagged AS (SELECT center_id, s, e, " +
    "  MAX(e) OVER (PARTITION BY center_id ORDER BY s ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS pe FROM tix), " +
    "islands AS (SELECT center_id, s, e, " +
    "  COUNTIF(pe IS NULL OR s > pe) OVER (PARTITION BY center_id ORDER BY s ROWS UNBOUNDED PRECEDING) AS grp FROM flagged), " +
    "dt AS (SELECT center_id, SUM(DATETIME_DIFF(se, ss, HOUR)) AS downtime_hrs " +
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
      " COUNT(DISTINCT NULLIF(TRIM(State), '')) AS states, " +
      " COUNT(DISTINCT NULLIF(TRIM(City), '')) AS cities, " +
      // center-grain, not row-grain: center_details has duplicate rows per
      // center, so COUNTIF(...) counted rows (25,648 > 18,370 centers → 140%).
      " COUNT(DISTINCT IF(deactivationdate IS NULL, CenterID, NULL)) AS active_deployments FROM " + CD + " WHERE " + F + filterCond + dateCond,
    geo:
      // Distinct CENTERS per state (the reload duplicated rows; every other
      // Centers metric dedupes — this one was still COUNT(*)). Field name stays
      // `devices` for client-payload compatibility; the card is retitled
      // "Centers by state" client-side.
      "SELECT IFNULL(NULLIF(TRIM(State), ''), 'Unknown') AS state, COUNT(DISTINCT CenterID) AS devices " +
      "FROM " + CD + " WHERE " + F + filterCond + dateCond + " GROUP BY state ORDER BY devices DESC LIMIT 12",
    // One row per center (MIN deploymentdate); counts DISTINCT centers so the
    // bands sum to the center count (was active-only rows → didn't match).
    deploymentAge:
      "WITH dep AS (SELECT CenterID, DATE_DIFF(CURRENT_DATE(), DATE(MIN(deploymentdate)), DAY) AS age_days " +
      " FROM " + CD + " WHERE deploymentdate IS NOT NULL AND " + F + filterCond + dateCond + " GROUP BY CenterID) " +
      "SELECT CASE WHEN age_days < 90 THEN '<3 mo' WHEN age_days < 180 THEN '3-6 mo' " +
      " WHEN age_days < 365 THEN '6-12 mo' WHEN age_days < 730 THEN '1-2 yr' ELSE '2+ yr' END AS band, " +
      " COUNT(*) AS devices FROM dep GROUP BY band",
    // "Deployment status" card repurposed to a segment breakdown (hub_master_segment, per user).
    // No dateCond here: the segment breakdown has no date semantics of its own
    // (filterCond's own segment component still legitimately narrows which
    // segments show; only the deployment-date range is skipped).
    activeVsEnded:
      "SELECT IFNULL(NULLIF(TRIM(hub_master_segment), ''), '(blank)') AS status, " +
      " COUNT(DISTINCT CenterID) AS devices FROM " + CD + " WHERE " + F + filterCond +
      " GROUP BY status ORDER BY devices DESC LIMIT 12",
    // "Top hubs" ranked by SPOKE COUNT (distinct centers per hub), not device
    // online/offline (the legacy spec read cloud_devices, unrelated to hubs here).
    hubs:
      "SELECT IFNULL(NULLIF(TRIM(HubName), ''), 'Unassigned') AS hub, " +
      " COUNT(DISTINCT CenterID) AS spokes FROM " + CD + " WHERE " + F + filterCond + dateCond +
      " GROUP BY hub ORDER BY spokes DESC LIMIT 12",
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
  var specs = buildDashboardQuerySpecs(hub, filters).map(function (s) {
    return cd[s.key] ? { key: s.key, params: s.params, sql: cd[s.key], maxRows: s.maxRows } : s;
  });
  // reliability/assetHealth now return EVERY scored center (LIMIT removed above) so the
  // client can merge + sort-toggle between uptime% and health score — the default
  // MAX_ROWS (1000) would silently truncate the ~28k-center universe, repeating the
  // exact bug already fixed once in getCenter360RowsCD_ (see its own maxRows comment).
  specs.forEach(function (s) {
    if (s.key === 'reliability' || s.key === 'assetHealth') s.maxRows = 60000;
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
    key: 'segmentOptions', maxRows: 200,
    sql: "SELECT DISTINCT TRIM(hub_master_segment) AS segment FROM " + CD +
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
  // Per-center Zoho failure aggregate (Zoho only — no jira) feeding the JS cohort.
  var P = "SAFE.PARSE_DATETIME('" + CONFIG.ZOHO_DT_FORMAT + "', ";
  specs.push({
    key: 'zohoFailByCenter', maxRows: 60000,
    sql:
      "WITH ftix AS (SELECT CenterID AS cid, " + P + "CreatedAt) AS created, IssueCategory AS cat " +
      " FROM " + T('zoho_data') + " WHERE CenterID IS NOT NULL AND " +
      techBoolSql_("IFNULL(IssueCategory,'')") + " AND " + P + "CreatedAt) IS NOT NULL), " +
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
      // PinCode/Spoke_Country replace the removed pin/Country columns; the
      // reload dropped latitude/longitude entirely → NULL here, coordinates
      // come from the pin-geocode store fallback (coordsForCD_).
      //
      // state/hub are TRIM'd for the same reason segment/status already were:
      // centerPassesFilters_ compares these fields against the filter values
      // with ===, while multiCond_ compares TRIM(IFNULL(col,'')) in SQL. Both
      // sides must normalize identically or the two paths disagree on the 2,806
      // sandbox rows with a padded HubName (review finding I4, 2026-07-29).
      "SELECT DISTINCT CenterID AS center_id, Centername AS center, HubID AS hub_id, " +
      " IFNULL(TRIM(HubName), '') AS hub, " +
      " City AS city, IFNULL(TRIM(State), '') AS state, PinCode AS pin, Spoke_Country AS country, " +
      " IFNULL(TRIM(hub_master_segment), '') AS segment, " +   // segment = hub_master_segment (per user)
      " IFNULL(TRIM(Status), '') AS status, " +                // NEW: needed for the global Status filter
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
  var ckey = 'ctr360cd_v7'; // v7: added mtbf_hrs/failures columns
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
        lat: base.lat, lng: base.lng, deployment_date: base.deployment_date || '',
        devices: tel ? tel.devices : 0, online: tel ? tel.online : 0,
        last_seen: (tel && tel.last_seen) || ''
      };
    }
  });

  var withTickets = leftJoin(withTelemetry, sources.centerTickets || [], {
    leftKey: 'center_id', rightKey: 'center_id',
    select: function (row, tickets) {
      row.open_tickets = tickets ? tickets.open_tickets : 0;
      row.tickets_total = tickets ? tickets.tickets_total : 0;
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

  // Jira device count per center (Connector + ECG, from the Sheet — see getAssetIndex_).
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
    if (r.devices == null) r.devices = c ? c.devices : 0;
  });
  return rows;
}

/** center_id → {segment, status, state, hub} from the cached Center-360 rows. */
function centerFilterMap_() {
  var m = {};
  getCenter360RowsCD_().forEach(function (r) {
    m[r.center_id] = { segment: r.segment || '', status: r.status || '', state: r.state || '', hub: r.hub || '' };
  });
  return m;
}

/**
 * Does this Center-360 row (or anything carrying the same 4 fields + a
 * deployment_date) pass the current global filter set? Empty array on any
 * dimension = no restriction on that dimension (existing convention).
 * @param {{segment:string,status:string,state:string,hub:string,deployment_date:string}} row
 * @param {{segments:Array,statuses:Array,states:Array,hubs:Array,dateFrom:string,dateTo:string}} filters
 * @return {boolean}
 */
function centerPassesFilters_(row, filters) {
  var f = filters || {};
  function inList(list, value) { return !list || !list.length || list.indexOf(value) !== -1; }
  if (!inList(f.segments, row.segment)) return false;
  if (!inList(f.statuses, row.status)) return false;
  if (!inList(f.states, row.state)) return false;
  if (!inList(f.hubs, row.hub)) return false;
  var d = row.deployment_date ? row.deployment_date.slice(0, 10) : '';
  if (f.dateFrom && (!d || d < f.dateFrom)) return false;
  if (f.dateTo && (!d || d > f.dateTo)) return false;
  return true;
}

/**
 * Narrows an outer table (zoho_data, cloud_devices) to rows whose CenterID
 * passes the center_details filter set. Generalizes the old single-segment,
 * device-only CenterID-subquery bridge (retired by Task 7) to all 4
 * center-attribute dimensions uniformly — one code path instead of mixing
 * native-column and subquery access per dimension.
 * @param {{segments:Array,statuses:Array,states:Array,hubs:Array}} filters
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
    var cacheKey = 'dashcd_v7_' + getCacheEpoch_() + '_' + filterHash_(filters) + '_' + shortHash(hub);
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
    // Jira metrics from the Sheet index; keep only assets whose center passes
    // the global filter (unmapped devices drop out whenever ANY of
    // Segment/Status/State/Hub is active — matching the existing v5.8
    // behavior for Segment alone). Date range checks the asset's OWN Jira
    // Created date directly, not the center's deployment date.
    var assetIdx = getAssetIndex_();
    var hasCenterFilter = filters.segments.length || filters.statuses.length ||
      filters.states.length || filters.hubs.length;
    if (hasCenterFilter) {
      var cfMap = centerFilterMap_();
      assetIdx = assetIdx.filter(function (a) {
        return a.center_id != null && centerPassesFilters_(cfMap[a.center_id] || {}, {
          segments: filters.segments, statuses: filters.statuses, states: filters.states, hubs: filters.hubs
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
    results.assets = assetsDonutFromIndex_(assetIdx);
    results.cohortReliability = cohortFromIndex_(assetIdx, results.zohoFailByCenter);
    delete results.zohoFailByCenter;
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
    sortRows(filtered, CENTER_SORT_KEYS[clean.sortBy] || 'devices', clean.sortDir);
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
        sql = "SELECT DISTINCT TRIM(HubName) AS hub FROM " + CD + base +
          " AND LOWER(TRIM(HubName)) LIKE @like ORDER BY hub LIMIT 50";
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

function apiGetMapDataCD(options) {
  options = options || {};
  var filters = {
    segments: (options.filters && options.filters.segments) || [],
    statuses: (options.filters && options.filters.statuses) || [],
    states: (options.filters && options.filters.states) || [],
    hubs: (options.filters && options.filters.hubs) || [],
    dateFrom: String((options.filters && options.filters.dateFrom) || ''),
    dateTo: String((options.filters && options.filters.dateTo) || '')
  };
  return respond_(function () {
    var cacheKey = 'mapcd_v6_' + getCacheEpoch_() + '_' + filterHash_(filters);
    if (options.bypassCache !== true) {
      var cached = cacheGetLarge(cacheKey);
      if (cached) return cached;
    }

    var centers = getCenter360RowsCD_().filter(function (row) { return centerPassesFilters_(row, filters); });
    var assets = getAssetIndex_();               // from the Jira SHEET (Connector + ECG only)
    var geoStore = loadGeoStore();

    var assetCount = {};
    assets.forEach(function (a) {
      if (a.center_id !== null) assetCount[a.center_id] = (assetCount[a.center_id] || 0) + 1;
    });

    var locatedIds = {}, located = [], unlocated = 0;
    centers.forEach(function (row) {
      var c = coordsForCD_(row, geoStore);
      if (c) {
        locatedIds[row.center_id] = true;
        located.push([
          row.center_id, row.center, c[0], c[1], row.devices, row.online,
          row.open_tickets, assetCount[row.center_id] || 0,
          row.hub || '', row.hub_id != null ? row.hub_id : '',
          row.segment || '', row.state || ''
        ]);
      } else { unlocated++; }
    });

    var typeDict = [], catDict = [], typeIdx = {}, catIdx = {};
    function intern_(dict, index, value) {
      var v = value || 'Other';
      if (!(v in index)) { index[v] = dict.length; dict.push(v); }
      return index[v];
    }
    var assetRows = [];
    assets.forEach(function (asset) {
      if (asset.center_id === null || !locatedIds[asset.center_id]) return;
      assetRows.push([asset.center_id, intern_(typeDict, typeIdx, asset.type),
        intern_(catDict, catIdx, asset.category),
        asset.age_days == null ? null : asset.age_days, asset.serial || '']);
    });

    var payload = {
      centers: located, assets: assetRows, assetTypes: typeDict, assetCats: catDict,
      unlocatedCenters: unlocated, geo: geoStats(),
      matchedAssets: Object.keys(assetCount).length,
      edition: 'center_details', flags: FLAGS_CD
    };
    cachePutLarge(cacheKey, payload, 1800); // outlives the 10-min warm interval
    return payload;
  });
}

/** Top-customers rollup over the center_details center universe. */
function computeTopCustomersCD_(filters) {
  var meta = {};
  TOP_CUSTOMERS.forEach(function (c) { meta[c.hub_id] = c; });

  var centers = getCenter360RowsCD_().filter(function (row) { return centerPassesFilters_(row, filters || {}); });
  var assets = getAssetIndex_();
  var geoStore = loadGeoStore();

  var centerHub = {};
  centers.forEach(function (row) { centerHub[row.center_id] = row.hub_id; });

  var assetByHub = {};
  assets.forEach(function (a) {
    if (a.center_id === null) return;
    var hub = centerHub[a.center_id];
    if (hub != null && meta[hub]) assetByHub[hub] = (assetByHub[hub] || 0) + 1;
  });

  var agg = {};
  TOP_CUSTOMERS.forEach(function (c) {
    agg[c.hub_id] = { hub_id: c.hub_id, hub: c.name, tier: c.tier, centers: 0,
      devices: 0, online: 0, open_tickets: 0, located: 0, assets: assetByHub[c.hub_id] || 0 };
  });

  var mapCenters = [];
  centers.forEach(function (row) {
    var a = agg[row.hub_id];
    if (!a) return;
    a.centers += 1; a.devices += row.devices || 0; a.online += row.online || 0;
    a.open_tickets += row.open_tickets || 0;
    var c = coordsForCD_(row, geoStore);
    if (c) {
      a.located += 1;
      mapCenters.push([row.center_id, row.center, c[0], c[1], row.devices, row.online,
        row.open_tickets, 0, row.hub || a.hub, row.hub_id, row.segment || '', row.state || '']);
    }
  });

  var customers = Object.keys(agg).map(function (k) { return agg[k]; })
    .sort(function (x, y) { return y.devices - x.devices; });

  var totals = { customers: customers.length, centers: 0, devices: 0, online: 0,
    open_tickets: 0, assets: 0, withData: 0 };
  customers.forEach(function (c) {
    totals.centers += c.centers; totals.devices += c.devices; totals.online += c.online;
    totals.open_tickets += c.open_tickets; totals.assets += c.assets;
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
    dateFrom: String((options.filters && options.filters.dateFrom) || ''),
    dateTo: String((options.filters && options.filters.dateTo) || '')
  };
  return respond_(function () {
    return withCache('topcustcd_v6_' + getCacheEpoch_() + '_' + filterHash_(filters),
      function () { return computeTopCustomersCD_(filters); },
      options.bypassCache === true);
  });
}

function apiGetExecOverviewCD(options) {
  options = options || {};
  var filters = {
    segments: (options.filters && options.filters.segments) || [],
    statuses: (options.filters && options.filters.statuses) || [],
    states: (options.filters && options.filters.states) || [],
    hubs: (options.filters && options.filters.hubs) || [],
    dateFrom: String((options.filters && options.filters.dateFrom) || ''),
    dateTo: String((options.filters && options.filters.dateTo) || '')
  };
  return respond_(function () {
    return withCache('execcd_v6_' + getCacheEpoch_() + '_' + filterHash_(filters), function () {
      var centers = getCenter360RowsCD_().filter(function (row) { return centerPassesFilters_(row, filters); });
      var top = computeTopCustomersCD_(filters);
      var want = { kpis: 1, fleetStatus: 1, zohoKpis: 1, zohoTrend: 1, geo: 1, reliability: 1, uptimeFleet: 1, slaKpis: 1 };
      var specs = buildDashboardQuerySpecsCD('', filters).filter(function (s) { return want[s.key]; });
      specs.push({
        key: 'deviceAge', maxRows: 1,
        // Center age = days since the center's deploymentdate (center-grain).
        sql: "SELECT ROUND(AVG(age_days), 0) AS avg_age_days, MAX(age_days) AS max_age_days FROM (" +
             " SELECT DATE_DIFF(CURRENT_DATE(), DATE(deploymentdate), DAY) AS age_days" +
             " FROM " + T('center_details') + " WHERE deploymentdate IS NOT NULL AND " + cdFilter_() +
             centerAttrCond_(filters) +
             dateRangeCond_('deploymentdate', filters.dateFrom, filters.dateTo) + ")"
      });
      var r = runQueriesParallel(specs);
      enrichCenterNamesCD_(r.reliability);
      var age = (r.deviceAge && r.deviceAge[0]) || {};

      var rollup = { centers: centers.length, devices: 0, online: 0, open_tickets: 0, attention_centers: 0 };
      centers.forEach(function (c) {
        rollup.devices += c.devices || 0; rollup.online += c.online || 0;
        rollup.open_tickets += c.open_tickets || 0;
        if ((c.open_tickets || 0) >= 4) rollup.attention_centers += 1;
      });

      var worstCenters = centers
        .filter(function (c) { return (c.open_tickets || 0) > 0; })
        .sort(function (a, b) { return b.open_tickets - a.open_tickets; })
        .slice(0, 8)
        .map(function (c) {
          return { center_id: c.center_id, center: c.center, hub: c.hub, state: c.state,
            devices: c.devices, online: c.online, open_tickets: c.open_tickets };
        });

      return {
        kpis: (r.kpis && r.kpis[0]) || {}, zohoKpis: (r.zohoKpis && r.zohoKpis[0]) || {},
        fleetStatus: r.fleetStatus || [], zohoTrend: r.zohoTrend || [], geo: r.geo || [],
        reliability: r.reliability || [], rollup: rollup, worstCenters: worstCenters,
        topCustomers: top.customers.slice(0, 6), topTotals: top.totals,
        avgAgeDays: age.avg_age_days != null ? age.avg_age_days : null,
        uptimeFleet: (r.uptimeFleet && r.uptimeFleet[0]) || null,
        slaKpis: (r.slaKpis && r.slaKpis[0]) || null,
        // jiraDeviceStats_ now accepts `filters` directly (Task 7) — see
        // apiGetDashboardCD's identical call site above.
        fleet: jiraDeviceStats_(filters),
        edition: 'center_details', flags: FLAGS_CD
      };
    }, options.bypassCache === true);
  });
}

function apiGetCenterDetailCD(options) {
  var centerId = parseInt(options && options.centerId, 10);
  return respond_(function () {
    if (!isFinite(centerId)) throw new Error('centerId is required');
    return withCache('ctrdetcd_v2_' + centerId, function () {
      // Reuse the original detail specs (devices/tickets/openTickets are keyed by
      // CenterID, center-table-agnostic); swap only the `info` query.
      var specs = buildCenterDetailSpecs(centerId).map(function (s) {
        if (s.key !== 'info') return s;
        return {
          key: 'info', params: s.params,
          sql:
            "SELECT ANY_VALUE(Centername) AS center, ANY_VALUE(HubID) AS hub_id, " +
            " ANY_VALUE(HubName) AS hub, ANY_VALUE(City) AS city, ANY_VALUE(State) AS state, " +
            " ANY_VALUE(PinCode) AS pin, ANY_VALUE(Spoke_Country) AS country, " +
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
        devices: detail.devices || [],
        assets: assets,
        edition: 'center_details', flags: FLAGS_CD
      };
    });
  });
}
