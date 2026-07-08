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
 * Business filter: F2P (free-to-pilot) centers are excluded from every
 * center_details query via the F2P_Customer flag (0 = keep, non-zero = drop).
 * The legacy 'F2P_CENTER' segment value no longer exists in the data (verified
 * 0 rows after the 2026-07-07 reload), so the flag is the sole F2P signal.
 * Today all 35,804 rows have F2P_Customer = 0, so nothing is excluded yet —
 * the filter activates automatically once the DE team populates the flag.
 */
var CD_SEG_FILTER = "IFNULL(F2P_Customer, 0) = 0";

/** center_details WHERE fragment: F2P always excluded, + optional Status='ACTIVE'. */
function cdFilter_(activeOnly) {
  return CD_SEG_FILTER + (activeOnly ? " AND Status = 'ACTIVE'" : "");
}

/** Machine-readable flags describing the device→center remap (shown in the UI banner). */
var FLAGS_CD = [
  'Source: center_details (2026-07-07 reload: 35,804 rows / 27,410 distinct centers).',
  'No device grain in center queries: "devices" figures are CENTER counts.',
  'startdatetime→deploymentdate, enddatetime→deactivationdate (active = not deactivated).',
  'No coordinate columns since the reload — pins come from the pin-geocode store only.',
  'Jira from the Google Sheet only (jira_data BQ ignored); serial→center = cloud_devices first, center_details fallback.'
];

/* ═══════════════ Uptime / MTBF / Health (birth = deploymentdate) ═════════ */

/**
 * Copy of centerUptimeSql_ with the birth CTE sourced from center_details
 * (deploymentdate) instead of device_center_mapping (startdatetime). Everything
 * else — Zoho device-failure downtime, MTBF, health tiers — is identical.
 * @param {string} tailSelect a SELECT over the final `scored` CTE
 */
function centerUptimeSqlCD_(tailSelect, activeOnly) {
  var f = CONFIG.ZOHO_DT_FORMAT;
  var P = "SAFE.PARSE_DATETIME('" + f + "', ";
  return "WITH tix AS (" +
    " SELECT CenterID AS center_id, " + P + "CreatedAt) AS s, " +
    "  COALESCE(" + P + "ClosedAt), CURRENT_DATETIME()) AS e " +
    " FROM " + T('zoho_data') + " WHERE CenterID IS NOT NULL " +
    "  AND " + techBoolSql_("IFNULL(IssueCategory,'')") + " " +
    "  AND " + P + "CreatedAt) IS NOT NULL), " +
    "birth AS (SELECT CenterID AS center_id, MIN(DATETIME(deploymentdate)) AS b " +
    "  FROM " + T('center_details') + " WHERE deploymentdate IS NOT NULL AND " + cdFilter_(activeOnly) + " GROUP BY CenterID), " +
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
function buildDashboardQuerySpecsCD(hub, activeOnly) {
  var CD = T('center_details');
  var F = cdFilter_(activeOnly);
  var cd = {
    centerKpis:
      "SELECT COUNT(DISTINCT CenterID) AS centers, COUNT(DISTINCT CenterID) AS devices, " +
      " COUNT(DISTINCT NULLIF(TRIM(State), '')) AS states, " +
      " COUNT(DISTINCT NULLIF(TRIM(City), '')) AS cities, " +
      " COUNTIF(deactivationdate IS NULL) AS active_deployments FROM " + CD + " WHERE " + F,
    geo:
      "SELECT IFNULL(NULLIF(TRIM(State), ''), 'Unknown') AS state, COUNT(*) AS devices " +
      "FROM " + CD + " WHERE " + F + " GROUP BY state ORDER BY devices DESC LIMIT 12",
    deploymentAge:
      "WITH active AS (SELECT DATE_DIFF(CURRENT_DATE(), DATE(deploymentdate), DAY) AS age_days " +
      " FROM " + CD + " WHERE deactivationdate IS NULL AND deploymentdate IS NOT NULL AND " + F + ") " +
      "SELECT CASE WHEN age_days < 90 THEN '<3 mo' WHEN age_days < 180 THEN '3-6 mo' " +
      " WHEN age_days < 365 THEN '6-12 mo' WHEN age_days < 730 THEN '1-2 yr' ELSE '2+ yr' END AS band, " +
      " COUNT(*) AS devices FROM active GROUP BY band",
    activeVsEnded:
      "SELECT IF(deactivationdate IS NULL, 'Active', 'Ended') AS status, " +
      " COUNT(DISTINCT CenterID) AS devices FROM " + CD + " WHERE " + F + " GROUP BY status",
    reliability: centerUptimeSqlCD_(
      "SELECT center_id AS centerid, uptime_pct, ROUND(100 - uptime_pct, 1) AS downtime_pct, " +
      " failures, ROUND(life_hrs / 24.0, 0) AS life_days FROM scored ORDER BY uptime_pct ASC LIMIT 12", activeOnly),
    uptimeFleet: centerUptimeSqlCD_(
      "SELECT COUNT(*) AS scored, ROUND(AVG(uptime_pct), 1) AS avg_uptime, " +
      " ROUND(COUNTIF(uptime_pct >= 99) / NULLIF(COUNT(*), 0) * 100, 1) AS pct99, " +
      " ROUND(AVG(mtbf_hrs) / 24, 1) AS avg_mtbf_days, ROUND(AVG(health_score), 1) AS avg_health, " +
      " ROUND(COUNTIF(health_score >= 80) / NULLIF(COUNT(*), 0) * 100, 1) AS pct_healthy FROM scored", activeOnly),
    assetHealth: centerUptimeSqlCD_(
      "SELECT center_id AS centerid, uptime_pct, mtbf_hrs, failures, health_score " +
      "FROM scored ORDER BY health_score ASC LIMIT 12", activeOnly)
  };
  var specs = buildDashboardQuerySpecs(hub).map(function (s) {
    return cd[s.key] ? { key: s.key, params: s.params, sql: cd[s.key], maxRows: s.maxRows } : s;
  // Drop the jira_data BQ specs — the status/type donut and the batch cohort are
  // now computed in JS from the Jira SHEET asset index (see apiGetDashboardCD).
  }).filter(function (s) { return s.key !== 'assets' && s.key !== 'cohortReliability'; });

  // Distinct real segment values (center_details), for the topbar segment filter.
  specs.push({
    key: 'segmentOptions', maxRows: 200,
    sql: "SELECT DISTINCT TRIM(Spoke_Center_Segment) AS segment FROM " + CD +
      " WHERE " + F + " AND NULLIF(TRIM(Spoke_Center_Segment), '') IS NOT NULL ORDER BY segment"
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

/** center_details center dimension ⟕ live telemetry ⟕ open tickets (by CenterID). */
function getCenter360RowsCD_(activeOnly) {
  var ckey = 'ctr360cd_v3' + (activeOnly ? '_a' : '');
  var cached = cacheGetLarge(ckey);
  if (cached) return cached;

  var specs = buildCenterSourceSpecs().map(function (s) {
    if (s.key !== 'centerBase') return s; // telemetry + tickets are center-table-agnostic
    return {
      key: 'centerBase', maxRows: 60000,
      sql:
        // DISTINCT: the 2026-07-07 reload has exact duplicate rows per center.
        // PinCode/Spoke_Country replace the removed pin/Country columns; the
        // reload dropped latitude/longitude entirely → NULL here, coordinates
        // come from the pin-geocode store fallback (coordsForCD_).
        "SELECT DISTINCT CenterID AS center_id, Centername AS center, HubID AS hub_id, HubName AS hub, " +
        " City AS city, State AS state, PinCode AS pin, Spoke_Country AS country, " +
        " IFNULL(TRIM(Spoke_Center_Segment), '') AS segment, " +   // segment from the center itself
        " CAST(NULL AS FLOAT64) AS lat, CAST(NULL AS FLOAT64) AS lng, " +
        " CAST(deploymentdate AS STRING) AS deployment_date " +
        "FROM " + T('center_details') + " WHERE " + cdFilter_(activeOnly)
    };
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
        lat: base.lat, lng: base.lng, deployment_date: base.deployment_date || '',
        devices: tel ? tel.devices : 0, online: tel ? tel.online : 0,
        last_seen: (tel && tel.last_seen) || ''
      };
    }
  });

  var joined = leftJoin(withTelemetry, sources.centerTickets || [], {
    leftKey: 'center_id', rightKey: 'center_id',
    select: function (row, tickets) {
      row.open_tickets = tickets ? tickets.open_tickets : 0;
      // segment already set from center_details (centerBase) — a center's own
      // attribute, so centers with no tickets still carry their segment.
      return row;
    }
  });

  cachePutLarge(ckey, joined, 600);
  return joined;
}

/** enrichCenterNames_ using the center_details rows. */
function enrichCenterNamesCD_(rows, activeOnly) {
  if (!rows || !rows.length) return rows;
  var byId = {};
  getCenter360RowsCD_(activeOnly).forEach(function (r) { byId[r.center_id] = r; });
  rows.forEach(function (r) {
    var c = byId[r.centerid];
    r.center = (c && c.center) || ('Center #' + r.centerid);
    if (r.devices == null) r.devices = c ? c.devices : 0;
  });
  return rows;
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
  var activeOnly = options.activeOnly === true;
  return respond_(function () {
    return withCache('dashcd_v4_' + (activeOnly ? 'a' : '') + shortHash(hub), function () {
      var results = runQueriesParallel(buildDashboardQuerySpecsCD(hub, activeOnly));
      enrichCenterNamesCD_(results.reliability, activeOnly);
      enrichCenterNamesCD_(results.assetHealth, activeOnly);
      // Jira status/type donut + batch cohort — computed in JS from the Jira SHEET
      // asset index (jira_data BQ is ignored). Same payload shapes as before.
      var assetIdx = getAssetIndex_();
      results.assets = assetsDonutFromIndex_(assetIdx);
      results.cohortReliability = cohortFromIndex_(assetIdx, results.zohoFailByCenter);
      delete results.zohoFailByCenter;   // internal — not shipped to the client
      results.activeOnly = activeOnly;
      results.csTracker = readCsTracker();
      results.appName = CONFIG.APP_NAME;
      results.appVersion = CONFIG.APP_VERSION;
      results.fleet = jiraDeviceStats_();   // fleet total + mapped (from Jira sheet/dump)
      results.edition = 'center_details';
      results.flags = FLAGS_CD;
      results.hub = hub;
      return results;
    }, options.bypassCache === true);
  });
}

function apiGetCentersCD(options) {
  options = options || {};
  var clean = {
    search: String(options.search || '').toLowerCase().slice(0, 80),
    hub: String(options.hub || '').slice(0, 120),
    segment: String(options.segment || '').slice(0, 80),
    sortBy: String(options.sortBy || 'devices'),
    sortDir: options.sortDir === 'asc' ? 'asc' : 'desc',
    page: Math.max(0, parseInt(options.page, 10) || 0),
    pageSize: Math.min(100, Math.max(5, parseInt(options.pageSize, 10) || 15))
  };
  var activeOnly = options.activeOnly === true;
  return respond_(function () {
    var joined = getCenter360RowsCD_(activeOnly);
    var filtered = joined.filter(function (row) {
      if (clean.hub && row.hub !== clean.hub) return false;
      if (clean.segment && row.segment !== clean.segment) return false;
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

function apiGetMapDataCD(options) {
  options = options || {};
  var activeOnly = options.activeOnly === true;
  return respond_(function () {
    var cached = cacheGetLarge('mapcd_v4' + (activeOnly ? '_a' : ''));
    if (cached) return cached;

    var centers = getCenter360RowsCD_(activeOnly);
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
    cachePutLarge('mapcd_v4' + (activeOnly ? '_a' : ''), payload, 600);
    return payload;
  });
}

/** Top-customers rollup over the center_details center universe. */
function computeTopCustomersCD_(activeOnly) {
  var meta = {};
  TOP_CUSTOMERS.forEach(function (c) { meta[c.hub_id] = c; });

  var centers = getCenter360RowsCD_(activeOnly);
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
  // default edition; reuse the shared helper.
  var sla = topCustomerTicketStats_();
  totals.ticket_count = sla.total_tickets;
  totals.sla_breach = sla.sla_breach;
  totals.sla_within_pct = sla.sla_within_pct;

  return { customers: customers, mapCenters: mapCenters, totals: totals,
    edition: 'center_details', flags: FLAGS_CD };
}

function apiGetTopCustomersCD(options) {
  options = options || {};
  var activeOnly = options.activeOnly === true;
  return respond_(function () {
    return withCache('topcustcd_v4' + (activeOnly ? '_a' : ''), function () { return computeTopCustomersCD_(activeOnly); });
  });
}

function apiGetExecOverviewCD(options) {
  options = options || {};
  var activeOnly = options.activeOnly === true;
  return respond_(function () {
    return withCache('execcd_v4' + (activeOnly ? '_a' : ''), function () {
      var centers = getCenter360RowsCD_(activeOnly);
      var top = computeTopCustomersCD_(activeOnly);
      var want = { kpis: 1, fleetStatus: 1, zohoKpis: 1, zohoTrend: 1, geo: 1, reliability: 1, uptimeFleet: 1, slaKpis: 1 };
      var specs = buildDashboardQuerySpecsCD('', activeOnly).filter(function (s) { return want[s.key]; });
      specs.push({
        key: 'deviceAge', maxRows: 1,
        // Center age = days since the center's deploymentdate (center-grain).
        sql: "SELECT ROUND(AVG(age_days), 0) AS avg_age_days, MAX(age_days) AS max_age_days FROM (" +
             " SELECT DATE_DIFF(CURRENT_DATE(), DATE(deploymentdate), DAY) AS age_days" +
             " FROM " + T('center_details') + " WHERE deploymentdate IS NOT NULL AND " + cdFilter_(activeOnly) + ")"
      });
      var r = runQueriesParallel(specs);
      enrichCenterNamesCD_(r.reliability, activeOnly);
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

      var cs = null;
      try { var t = readCsTracker(); cs = t && t.kpis; } catch (e) { cs = null; }

      return {
        kpis: (r.kpis && r.kpis[0]) || {}, zohoKpis: (r.zohoKpis && r.zohoKpis[0]) || {},
        fleetStatus: r.fleetStatus || [], zohoTrend: r.zohoTrend || [], geo: r.geo || [],
        reliability: r.reliability || [], rollup: rollup, worstCenters: worstCenters,
        topCustomers: top.customers.slice(0, 6), topTotals: top.totals,
        avgAgeDays: age.avg_age_days != null ? age.avg_age_days : null,
        uptimeFleet: (r.uptimeFleet && r.uptimeFleet[0]) || null,
        slaKpis: (r.slaKpis && r.slaKpis[0]) || null, cs: cs,
        fleet: jiraDeviceStats_(),
        edition: 'center_details', flags: FLAGS_CD
      };
    });
  });
}

function apiGetCenterDetailCD(options) {
  var centerId = parseInt(options && options.centerId, 10);
  return respond_(function () {
    if (!isFinite(centerId)) throw new Error('centerId is required');
    return withCache('ctrdetcd_v1_' + centerId, function () {
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
        devices: detail.devices || [],
        assets: assets,
        edition: 'center_details', flags: FLAGS_CD
      };
    });
  });
}
