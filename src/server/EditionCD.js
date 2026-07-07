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
 * ── Field mapping device_center_mapping → center_details ──────────────────
 *   centerid/CenterName/hubid/hubname/city/state/country/pin → same (BQ is
 *     case-insensitive; center_details uses CenterID/Centername/HubID/… ).
 *   startdatetime  → deploymentdate  (DATE, center-level)
 *   enddatetime    → deactivationdate (active = deactivationdate IS NULL)
 *   (no coords)    → latitude/longitude (direct; pin-geocode store as fallback)
 *
 * ── FLAGS — fields with NO clean equivalent (see FLAGS_CD, surfaced in UI) ──
 *   deviceid        : absent in the sandbox center_details → device-grain
 *                     metrics become CENTER-grain (device counts = center
 *                     counts; "latest per device" collapses to 1 row/center).
 *   MacSerialID /   : defined in the upstream tricogde-dwh derivation but NOT
 *   MachineType /     loaded into the sandbox copy → unavailable here.
 *   AcquiredDate
 *   Asset→center map: still uses device_center_mapping serials (getAssetIndex_)
 *                     because center_details carries no device serial.
 */

/**
 * Business filter: F2P_CENTER (free-to-pilot) centers are excluded from every
 * center_details query — matches the commented-out WHERE in the DIM_Centers
 * derivation. NULL segment is kept (only F2P_CENTER is dropped).
 */
var CD_SEG_FILTER = "(Spoke_Center_Segment != 'F2P_CENTER' OR Spoke_Center_Segment IS NULL)";

/** center_details WHERE fragment: F2P always excluded, + optional Status='ACTIVE'. */
function cdFilter_(activeOnly) {
  return CD_SEG_FILTER + (activeOnly ? " AND Status = 'ACTIVE'" : "");
}

/** Machine-readable flags describing the device→center remap (shown in the UI banner). */
var FLAGS_CD = [
  'Source: center_details (' + '55,682 centers) vs device_center_mapping (11,344).',
  'No device grain: "devices" figures are CENTER counts, not device counts.',
  'startdatetime→deploymentdate, enddatetime→deactivationdate (active = not deactivated).',
  'Coordinates from latitude/longitude (~3.4k centers) with pin-geocode fallback.',
  'Asset→center linking still uses device_center_mapping (center_details has no serial).'
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
  });
  return specs;
}

/* ═══════════════ Center-360 rows from center_details ═════════════════════ */

/** center_details center dimension ⟕ live telemetry ⟕ open tickets (by CenterID). */
function getCenter360RowsCD_(activeOnly) {
  var ckey = 'ctr360cd_v1' + (activeOnly ? '_a' : '');
  var cached = cacheGetLarge(ckey);
  if (cached) return cached;

  var specs = buildCenterSourceSpecs().map(function (s) {
    if (s.key !== 'centerBase') return s; // telemetry + tickets are center-table-agnostic
    return {
      key: 'centerBase', maxRows: 60000,
      sql:
        "SELECT CenterID AS center_id, Centername AS center, HubID AS hub_id, HubName AS hub, " +
        " City AS city, State AS state, pin, Country AS country, " +
        " latitude AS lat, longitude AS lng, CAST(deploymentdate AS STRING) AS deployment_date " +
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
      row.segment = (tickets && tickets.segment) || '';
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
    return withCache('dashcd_v1_' + (activeOnly ? 'a' : '') + shortHash(hub), function () {
      var results = runQueriesParallel(buildDashboardQuerySpecsCD(hub, activeOnly));
      enrichCenterNamesCD_(results.reliability, activeOnly);
      enrichCenterNamesCD_(results.assetHealth, activeOnly);
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
    var cached = cacheGetLarge('mapcd_v1' + (activeOnly ? '_a' : ''));
    if (cached) return cached;

    var centers = getCenter360RowsCD_(activeOnly);
    var assets = getAssetIndex_();               // serial linkage via device_center_mapping (flagged)
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
    cachePutLarge('mapcd_v1' + (activeOnly ? '_a' : ''), payload, 600);
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
    return withCache('topcustcd_v1' + (activeOnly ? '_a' : ''), function () { return computeTopCustomersCD_(activeOnly); });
  });
}

function apiGetExecOverviewCD(options) {
  options = options || {};
  var activeOnly = options.activeOnly === true;
  return respond_(function () {
    return withCache('execcd_v1' + (activeOnly ? '_a' : ''), function () {
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
            " ANY_VALUE(pin) AS pin, ANY_VALUE(Country) AS country, " +
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
