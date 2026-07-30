/**
 * ExecOverview.js — the leadership rollup behind the Executive Overview
 * landing page. Synthesizes fleet health, support load, geography, reliability
 * and top-customer coverage into one cached payload.
 *
 * Reuses the cached Center-360 join and top-customer rollup (no duplicate
 * heavy reads); adds a small focused query batch for the KPI/trend panels
 * (the exact same SQL the dashboard uses, filtered to the keys we need).
 */

/** Subset of the dashboard specs the exec page needs. */
function execSpecs_() {
  var want = { kpis: 1, fleetStatus: 1, zohoKpis: 1, zohoTrend: 1, geo: 1, reliability: 1, uptimeFleet: 1, slaKpis: 1 };
  return buildDashboardQuerySpecs('').filter(function (s) { return want[s.key]; });
}

/**
 * @return {Object} envelope with headline rollup, trends and attention lists.
 */
function apiGetExecOverview() {
  return respond_(function () {
    return withCache('exec_v4', function () {
      var centers = getCenter360Rows_();          // cached
      var top = computeTopCustomers_();            // cached inputs
      var specs = execSpecs_();
      specs.push({
        key: 'deviceAge', maxRows: 1,
        // Device age = days since its first deployment; averaged across devices.
        sql: "SELECT ROUND(AVG(age_days), 0) AS avg_age_days, MAX(age_days) AS max_age_days FROM (" +
             " SELECT DATE_DIFF(CURRENT_DATE(), DATE(MIN(startdatetime)), DAY) AS age_days" +
             " FROM " + T('device_center_mapping') + " WHERE startdatetime IS NOT NULL GROUP BY deviceid)"
      });
      var r = runQueriesParallel(specs);
      enrichCenterNames_(r.reliability);
      var age = (r.deviceAge && r.deviceAge[0]) || {};

      // Fleet-wide rollup straight from the joined center rows.
      var rollup = { centers: centers.length, devices: 0, online: 0,
        open_tickets: 0, attention_centers: 0 };
      centers.forEach(function (c) {
        rollup.devices += c.devices || 0;
        rollup.online += c.online || 0;
        rollup.open_tickets += c.open_tickets || 0;
        if ((c.open_tickets || 0) >= 4) rollup.attention_centers += 1;
      });

      var worstCenters = centers
        .filter(function (c) { return (c.open_tickets || 0) > 0; })
        .sort(function (a, b) { return b.open_tickets - a.open_tickets; })
        .slice(0, 8)
        .map(function (c) {
          return {
            center_id: c.center_id, center: c.center, hub: c.hub,
            state: c.state, devices: c.devices, online: c.online,
            open_tickets: c.open_tickets
          };
        });

      return {
        kpis: (r.kpis && r.kpis[0]) || {},
        zohoKpis: (r.zohoKpis && r.zohoKpis[0]) || {},
        fleetStatus: r.fleetStatus || [],
        zohoTrend: r.zohoTrend || [],
        geo: r.geo || [],
        reliability: r.reliability || [],
        rollup: rollup,
        worstCenters: worstCenters,
        topCustomers: top.customers.slice(0, 6),
        topTotals: top.totals,
        avgAgeDays: age.avg_age_days != null ? age.avg_age_days : null,
        uptimeFleet: (r.uptimeFleet && r.uptimeFleet[0]) || null,
        slaKpis: (r.slaKpis && r.slaKpis[0]) || null
      };
    });
  });
}
