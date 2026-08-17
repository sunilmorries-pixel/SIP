/**
 * TopCustomers.js — the curated "Top LE" account list + per-customer rollup.
 *
 * A customer here = a business GROUP (a corporate account), which can span
 * MULTIPLE hubs — e.g. "Metropolis" is 8 separate HubIDs. The list is a
 * business-curated set (provided by the team, ranked by active-unit count).
 * It's embedded so the page needs no extra data source; if it starts
 * changing often, move it to its own small BigQuery table (the app has no
 * Google Sheets integration left — see docs/SOURCES.md) and read it in
 * loadTopCustomers_().
 *
 * Replaced wholesale 2026-08-17 (per user) from the team's ranked group/HubID
 * export — every group below carries the FULL HubID list from that export,
 * not just one representative hub per group as the old one-row-per-hub list
 * did. Six additional groups from that export (MH Stemi, Odisha Stemi, Bihar
 * Stemi, KA Stemi, TSMISDC, Manipur Stemi — together ~2,900 of the ~4,350
 * total active units, MH Stemi alone larger than every group below combined)
 * were NOT carried over: the export gave no HubIDs for them, and this page's
 * whole aggregation pipeline joins on HubID — there is nothing to attribute
 * their centers/devices/tickets to without one. Add them once HubIDs are
 * available. 'Indira IVF' is the one exception where the new export also had
 * no HubID: kept its previously-known hub_id (36772) rather than dropping a
 * ranked, named account for an incomplete paste.
 */

var TOP_CUSTOMERS = [
  { group: 'Metropolis', tier: 'Top LE', hub_ids: [1837, 2133, 2314, 8262, 40240, 40996, 49494, 49495] },
  { group: 'VIJAYA DIAGNOSTIC CENTRE', tier: 'Top LE', hub_ids: [13246] },
  { group: 'Aarthi Scans', tier: 'Top LE', hub_ids: [1684, 10502, 17328, 40304] },
  { group: 'HEALTHIANS LABS', tier: 'Top LE', hub_ids: [50131] },
  { group: 'Chandan', tier: 'Top LE', hub_ids: [2848, 40947, 48772] },
  { group: 'Indira IVF', tier: 'Top LE', hub_ids: [36772] },
  { group: 'Manipal', tier: 'Top LE', hub_ids: [3027, 3499, 42717, 47153, 48199, 51265, 51643, 54533, 55775] },
  { group: 'Fortis', tier: 'Top LE', hub_ids: [1282, 2710, 14949, 41195, 41880] },
  { group: 'Apollo', tier: 'Top LE', hub_ids: [2667, 3102, 3253, 3959, 4008, 4192, 31154, 42251, 52230, 52705] },
  { group: 'Sparsh', tier: 'Top LE', hub_ids: [38194, 40327, 48356, 51288, 52769] },
  { group: 'Agilus', tier: 'Top LE', hub_ids: [43727, 49793] },
  { group: 'BridgeHealth', tier: 'Top LE', hub_ids: [49118] },
  { group: 'Kauvery', tier: 'Top LE', hub_ids: [1162, 10845, 43996] },
  { group: 'MAX', tier: 'Top LE', hub_ids: [2529, 2701, 3103, 12243, 16088, 51600, 52256] },
  { group: 'Dr.B.Lal Clinical Laboratory', tier: 'Top LE', hub_ids: [2546, 3558, 36979, 40540] },
  { group: 'Reliance Jio', tier: 'Top LE', hub_ids: [54884] },
  { group: 'NEUBERG DIAGNOSTICS PVT LTD', tier: 'Top LE', hub_ids: [2453, 53247] },
  { group: 'Sri Chandra Sekara Hospital, Hosur', tier: 'Top LE', hub_ids: [995] },
  { group: 'Anderson Diagnostics', tier: 'Top LE', hub_ids: [41419] },
  { group: 'Suburban Diagnostics Pvt Ltd', tier: 'Top LE', hub_ids: [9572] },
  { group: 'Matcare', tier: 'Top LE', hub_ids: [50590, 50722, 52270, 54300] },
  { group: 'Jaslok', tier: 'Top LE', hub_ids: [48763] }
];

/**
 * Per-customer rollup for the Top Customers page. Reuses the already-cached
 * Center-360 rows and asset index — no new BigQuery reads — and keeps the
 * curated names/tier authoritative.
 * @return {Object} envelope: { customers, mapCenters, totals }
 */
function apiGetTopCustomers() {
  return respond_(function () {
    return withCache('topcust_v1', computeTopCustomers_);
  });
}

/** Pure rollup used by apiGetTopCustomers and the Executive Overview. */
function computeTopCustomers_() {
      // hub_id -> owning group (a group can list several hub_ids).
      var hubToGroup = {};
      TOP_CUSTOMERS.forEach(function (c) {
        c.hub_ids.forEach(function (hid) { hubToGroup[hid] = c; });
      });

      var centers = getCenter360Rows_();
      var assets = getAssetIndex_();
      var geoStore = loadGeoStore();

      // center_id -> hub_id, for attributing assets to a customer.
      var centerHub = {};
      centers.forEach(function (row) { centerHub[row.center_id] = row.hub_id; });

      var assetByGroup = {};
      assets.forEach(function (a) {
        if (a.center_id === null) return;
        var hub = centerHub[a.center_id];
        var grp = hub != null ? hubToGroup[hub] : null;
        if (grp) assetByGroup[grp.group] = (assetByGroup[grp.group] || 0) + 1;
      });

      // Aggregate by GROUP (summed across every hub_id it lists), and collect
      // their located centers.
      var agg = {};
      TOP_CUSTOMERS.forEach(function (c) {
        agg[c.group] = {
          hub: c.group, hub_ids: c.hub_ids.slice(), tier: c.tier,
          centers: 0, devices: 0, online: 0, open_tickets: 0,
          located: 0, assets: assetByGroup[c.group] || 0
        };
      });

      var mapCenters = [];
      centers.forEach(function (row) {
        var grp = hubToGroup[row.hub_id];
        if (!grp) return;
        var a = agg[grp.group];
        a.centers += 1;
        a.devices += row.devices || 0;
        a.online += row.online || 0;
        a.open_tickets += row.open_tickets || 0;
        var coords = geoStore[geoKeyFor(row)];
        if (coords && coords !== 'x') {
          a.located += 1;
          var p = coords.split(',');
          mapCenters.push([
            row.center_id, row.center, parseFloat(p[0]), parseFloat(p[1]),
            row.devices, row.online, row.open_tickets, 0,
            row.hub || a.hub, row.hub_id, row.segment || '', row.state || ''
          ]);
        }
      });

      var customers = Object.keys(agg).map(function (k) { return agg[k]; })
        .sort(function (x, y) { return y.devices - x.devices; });

      var totals = { customers: customers.length, centers: 0, devices: 0,
        online: 0, open_tickets: 0, assets: 0, withData: 0 };
      customers.forEach(function (c) {
        totals.centers += c.centers; totals.devices += c.devices;
        totals.online += c.online; totals.open_tickets += c.open_tickets;
        totals.assets += c.assets;
        if (c.centers > 0) totals.withData += 1;
      });

      // Ticket count + SLA breach scoped to the curated top-customer hubs. No
      // `filters` argument on purpose: this is the legacy (device_center_mapping)
      // edition, which predates the global filter — computeTopCustomersCD_ is
      // the one that threads it.
      var sla = topCustomerTicketStats_();
      totals.ticket_count = sla.total_tickets;
      totals.sla_breach = sla.sla_breach;
      totals.sla_within_pct = sla.sla_within_pct;

      return { customers: customers, mapCenters: mapCenters, totals: totals };
}

/**
 * Total Zoho tickets and SLA breach for the curated top-customer hubs only.
 * Breach = open tickets whose age exceeds the per-type SLA (SlaCatalog).
 *
 * The curated HubID list is the page's own scope and always applies. On top of
 * that, `filters` narrows to tickets whose CENTER passes the global filter
 * (segment/status/state/hub) via centerFilterSubqueryCond_ — without it this
 * helper returned unfiltered totals into an otherwise fully-filtered payload,
 * so one tile showed an unfiltered headline above a filtered sub-label
 * (whole-branch review finding I5, 2026-07-29).
 *
 * The global DATE range is deliberately NOT applied here: the companion number
 * in that tile (open_tickets, summed from the Center-360 rows) counts a center's
 * open tickets regardless of when they were raised, so date-filtering only the
 * headline would re-create the same mixed-scope tile in a new way. Date
 * narrowing of ticket metrics lives on the Support page, where it applies to
 * every ticket number on screen at once.
 * @param {{segments:Array,statuses:Array,states:Array,hubs:Array}=} filters
 * @return {{total_tickets:number, sla_breach:number, sla_within_pct:(number|null)}}
 */
function topCustomerTicketStats_(filters) {
  var ids = TOP_CUSTOMERS.reduce(function (acc, c) { return acc.concat(c.hub_ids); }, []).join(', ');
  var centerCond = centerFilterSubqueryCond_(filters || {});
  var sql =
    "WITH t AS (SELECT status, " + slaDaysCaseSql_("IFNULL(IssueCategory,'')") + " AS sla_days, " +
    zohoParsedDates_() + " FROM " + zohoDedupSql_() + " WHERE HubID IN (" + ids + ")" + centerCond + "), " +
    "s AS (SELECT sla_days, " +
    " (status = 'Closed' AND created IS NOT NULL AND closed IS NOT NULL) AS resolved, " +
    " CASE WHEN status = 'Closed' AND created IS NOT NULL AND closed IS NOT NULL " +
    "   THEN DATETIME_DIFF(closed, created, HOUR) / 24.0 END AS res_days, " +
    " (status NOT IN " + CONFIG.ZOHO_TERMINAL_STATUSES + ") AS is_open, " +
    " CASE WHEN created IS NOT NULL THEN DATETIME_DIFF(CURRENT_DATETIME(), created, HOUR) / 24.0 END AS age_days " +
    " FROM t) " +
    "SELECT COUNT(*) AS total_tickets, " +
    " COUNTIF(is_open AND age_days > sla_days) AS sla_breach, " +
    " ROUND(COUNTIF(resolved AND res_days <= sla_days) / NULLIF(COUNTIF(resolved), 0) * 100, 1) AS sla_within_pct " +
    "FROM s";
  var rows = runQuery(sql);
  var r = (rows && rows[0]) || {};
  return { total_tickets: r.total_tickets || 0, sla_breach: r.sla_breach || 0,
    sla_within_pct: r.sla_within_pct != null ? r.sla_within_pct : null };
}
