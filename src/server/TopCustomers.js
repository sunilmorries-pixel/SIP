/**
 * TopCustomers.js — the curated "Top LE" account list + per-customer rollup.
 *
 * A customer here = a HUB. The list is a business-curated set (provided by the
 * team). It's embedded so the page needs no extra data source; if it starts
 * changing often, move it to its own small BigQuery table (the app has no
 * Google Sheets integration left — see docs/SOURCES.md) and read it in
 * loadTopCustomers_().
 */

var TOP_CUSTOMERS = [
  { hub_id: 13246, name: 'VIJAYA DIAGNOSTIC CENTRE LTD, HYDERABAD', tier: 'Top LE' },
  { hub_id: 40996, name: 'Metropolis Lab@Home (Hub) West', tier: 'Top LE' },
  { hub_id: 2314,  name: 'Metropolis Healthcare Limited, Tamil Nadu', tier: 'Top LE' },
  { hub_id: 10502, name: 'Aarthi Scans and Labs, Tamil Nadu', tier: 'Top LE' },
  { hub_id: 50131, name: 'HEALTHIANS LABS (HUB)', tier: 'Top LE' },
  { hub_id: 36772, name: 'INDIRA IVF HOSPITAL PVT LTD (HUB)', tier: 'Top LE' },
  { hub_id: 2848,  name: 'Chandan Healthcare LTD, Lucknow', tier: 'Top LE' },
  { hub_id: 43727, name: 'DDRC Agilus Pathlabs Ltd', tier: 'Top LE' },
  { hub_id: 1837,  name: 'Hi-Tech Diagnostic Centre, TN', tier: 'Top LE' },
  { hub_id: 46889, name: 'Redcliffe Labs - GTH', tier: 'Top LE' },
  { hub_id: 23360, name: 'DIAGNOPEIN HEALTHCARE PRIVATE LIMITED', tier: 'Top LE' },
  { hub_id: 995,   name: 'Sri Chandra Sekara Hospital, Hosur', tier: 'Top LE' },
  { hub_id: 49494, name: 'Metropolis Lab@Home (Hub) North', tier: 'Top LE' },
  { hub_id: 49118, name: 'Bridge Health (HUB)', tier: 'Top LE' },
  { hub_id: 2453,  name: 'NEUBERG DIAGNOSTICS PVT LTD', tier: 'Top LE' },
  { hub_id: 24777, name: 'Medall Healthcare Pvt Ltd Chennai 2', tier: 'Top LE' },
  { hub_id: 48776, name: 'Prevento Health Tech Solution PVT LTD', tier: 'Top LE' },
  { hub_id: 9572,  name: 'Suburban Diagnostics Pvt Ltd', tier: 'Top LE' },
  { hub_id: 4192,  name: 'Apollo Hospital, Secunderabad', tier: 'Top LE' },
  { hub_id: 38194, name: 'SPARSH HOSPITAL YESHWANTHPUR (HUB)', tier: 'Top LE' },
  { hub_id: 1282,  name: 'Fortis Hospital, CG Road, Bengaluru', tier: 'Top LE' },
  { hub_id: 10845, name: 'SRI KAUVERY MEDICAL CARE (INDIA) LIMITED', tier: 'Top LE' },
  { hub_id: 2710,  name: 'Fortis Hospital, BG Road, Bengaluru', tier: 'Top LE' },
  { hub_id: 48229, name: 'HealthOnUs (HUB)', tier: 'Top LE' },
  { hub_id: 49793, name: 'Agilus Diagnostics Limited', tier: 'Top LE' },
  { hub_id: 3027,  name: 'KMC Hospitals - Mangalore Pvt. Ltd', tier: 'Top LE' },
  { hub_id: 12862, name: 'Balaji Medical Center Chennai', tier: 'Top LE' }
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
      var meta = {};
      TOP_CUSTOMERS.forEach(function (c) { meta[c.hub_id] = c; });

      var centers = getCenter360Rows_();
      var assets = getAssetIndex_();
      var geoStore = loadGeoStore();

      // center_id -> hub_id, for attributing assets to a customer.
      var centerHub = {};
      centers.forEach(function (row) { centerHub[row.center_id] = row.hub_id; });

      var assetByHub = {};
      assets.forEach(function (a) {
        if (a.center_id === null) return;
        var hub = centerHub[a.center_id];
        if (hub != null && meta[hub]) assetByHub[hub] = (assetByHub[hub] || 0) + 1;
      });

      // Aggregate the top-customer hubs, and collect their located centers.
      var agg = {};
      TOP_CUSTOMERS.forEach(function (c) {
        agg[c.hub_id] = {
          hub_id: c.hub_id, hub: c.name, tier: c.tier,
          centers: 0, devices: 0, online: 0, open_tickets: 0,
          located: 0, assets: assetByHub[c.hub_id] || 0
        };
      });

      var mapCenters = [];
      centers.forEach(function (row) {
        var a = agg[row.hub_id];
        if (!a) return;
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
  var ids = TOP_CUSTOMERS.map(function (c) { return c.hub_id; }).join(', ');
  var centerCond = centerFilterSubqueryCond_(filters || {});
  var sql =
    "WITH t AS (SELECT status, " + slaDaysCaseSql_("IFNULL(IssueCategory,'')") + " AS sla_days, " +
    zohoParsedDates_() + " FROM " + T('zoho_data') + " WHERE HubID IN (" + ids + ")" + centerCond + "), " +
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
