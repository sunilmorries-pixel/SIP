/**
 * OverviewFlow.js — the Overview page's decomposition trees.
 *
 * Customers and Devices are pure JS aggregation over data this app already
 * fetches and caches on every page load (getCenter360RowsCD_,
 * filteredJiraDevices_) — no new BigQuery queries for either. Tickets (see
 * the apiGetOverviewFlowCD half of this file) is the only tree that needs
 * new SQL, and it's three small counting queries, not a new engine.
 *
 * Every tree builder returns an ALREADY-NESTED {name, value, children} node,
 * the exact shape ECharts' `tree` series consumes — nesting happens here,
 * not as a separate client-side step (a deliberate simplification over the
 * design spec's original "flat rows, client nests" sketch: once the data is
 * JS objects rather than raw SQL rows, nesting in the same pass is strictly
 * less code, not more).
 *
 * Every non-Others, non-leaf-without-a-filter-dimension node carries
 * filterDim/filterValue so the client's click handler can set the matching
 * global filter without re-deriving it from the node's position in the tree.
 * Nodes for which no global filter dimension exists (age bands, anything on
 * the Tickets tree) carry navTab (+ navDeviceType where relevant) instead —
 * clicking them switches tabs rather than filtering, per the design spec §6.
 */

/**
 * Ranks items by count descending, keeps the top N, sums the remainder into
 * one trailing `{key: othersLabel, cnt: sum}` entry (omitted if there is
 * nothing left over).
 * @param {Array} items
 * @param {number} n
 * @param {function(*): string} keyFn
 * @param {function(*): number} cntFn
 * @return {Array<{key:string, cnt:number}>}
 */
function topNPlusOthers_(items, n, keyFn, cntFn) {
  if (!items || !items.length) return [];
  var sorted = items.slice().sort(function (a, b) { return cntFn(b) - cntFn(a); });
  var top = sorted.slice(0, n).map(function (i) { return { key: keyFn(i), cnt: cntFn(i) }; });
  var rest = sorted.slice(n);
  if (!rest.length) return top;
  var restSum = rest.reduce(function (s, i) { return s + cntFn(i); }, 0);
  top.push({ key: 'Others', cnt: restSum });
  return top;
}

/**
 * The exact five age bands Numbers.js's jiraDeviceStats_ already uses —
 * duplicated here (not imported) because the source bucketing is inline in
 * that function, not its own callable helper. Must stay bit-for-bit
 * identical to Numbers.js's thresholds or the two would silently disagree.
 * @param {?number} days
 * @return {?string} one of '<1y'/'1-2y'/'2-3y'/'3-5y'/'5y+', or null
 */
function ageBandForDays_(days) {
  if (days == null) return null;
  var y = days / 365;
  if (y < 1) return '<1y';
  if (y < 2) return '1-2y';
  if (y < 3) return '2-3y';
  if (y < 5) return '3-5y';
  return '5y+';
}

/**
 * Aggregates an array of Center-360 rows (already filtered) by a key
 * function, returning {devices, openTickets, topCity, uptimePct} — the
 * hover-stat bundle for one tree node.
 * @param {Array<Object>} rows
 * @return {{devices:number, openTickets:number, topCity:string, uptimePct:?number}}
 */
function centerRowStats_(rows) {
  var devices = 0, openTickets = 0, uptimeSum = 0, uptimeN = 0;
  var cityCounts = {};
  rows.forEach(function (r) {
    // Jira fleet count, not cloud_devices — per user, 2026-08-19: devices
    // means Jira everywhere except the CDM page.
    devices += r.jira_devices || 0;
    openTickets += r.open_tickets || 0;
    if (r.uptime_pct != null) { uptimeSum += r.uptime_pct; uptimeN++; }
    var c = r.city || '';
    if (c) cityCounts[c] = (cityCounts[c] || 0) + 1;
  });
  var topCity = '';
  var topCityN = 0;
  Object.keys(cityCounts).forEach(function (c) {
    if (cityCounts[c] > topCityN) { topCity = c; topCityN = cityCounts[c]; }
  });
  return {
    devices: devices, openTickets: openTickets, topCity: topCity,
    uptimePct: uptimeN ? Math.round((uptimeSum / uptimeN) * 10) / 10 : null
  };
}

/**
 * Total customers -> hub_country (top 5 + Others) -> hub_master_segment.
 * @param {Object} filters the global filter drawer's state
 * @return {{name:string, value:number, clearDims:Array<string>, children:Array}}
 */
function buildCustomersTree_(filters) {
  var rows = getCenter360RowsCD_().filter(function (r) { return centerPassesFilters_(r, filters || {}); });

  var byCountry = {};
  rows.forEach(function (r) {
    var c = r.country || '(blank)';
    (byCountry[c] = byCountry[c] || []).push(r);
  });
  var countryItems = Object.keys(byCountry).map(function (c) { return { key: c, cnt: byCountry[c].length }; });
  var topCountries = topNPlusOthers_(countryItems, 5, function (i) { return i.key; }, function (i) { return i.cnt; });

  var children = topCountries.map(function (entry) {
    var isOthers = entry.key === 'Others';
    var countryRows = isOthers
      ? rows.filter(function (r) { return topCountries.slice(0, -1).map(function (t) { return t.key; }).indexOf(r.country || '(blank)') === -1; })
      : byCountry[entry.key];

    var node = { name: entry.key, value: entry.cnt, stats: centerRowStats_(countryRows) };
    if (!isOthers) {
      node.filterDim = 'countries';
      node.filterValue = entry.key;

      var bySegment = {};
      countryRows.forEach(function (r) {
        var s = r.segment || '(blank)';
        (bySegment[s] = bySegment[s] || []).push(r);
      });
      node.children = Object.keys(bySegment).map(function (s) {
        return {
          name: s, value: bySegment[s].length, stats: centerRowStats_(bySegment[s]),
          // Compound payload, not filterDim:'segments' alone — the trees ship
          // fully expanded, so a user can click "SME" under Nepal directly
          // without first clicking Nepal. filterSet ADDS the parent country
          // to the segment filter instead of replacing it (spec §6).
          filterSet: { countries: [entry.key], segments: [s] }
        };
      }).sort(function (a, b) { return b.value - a.value; });
    }
    return node;
  });

  return {
    name: 'Total customers', value: rows.length,
    clearDims: ['countries', 'segments'],
    children: children
  };
}

/**
 * Total devices -> device type -> age band.
 * @param {Object} filters the global filter drawer's state
 * @return {{name:string, value:number, children:Array}}
 */
function buildDevicesTree_(filters) {
  var devices = filteredJiraDevices_(filters || {});

  var byType = {};
  devices.forEach(function (d) {
    (byType[d.type] = byType[d.type] || []).push(d);
  });

  var children = Object.keys(byType).map(function (type) {
    var typeDevices = byType[type];
    var byBand = {};
    typeDevices.forEach(function (d) {
      var band = ageBandForDays_(d.age);
      if (band) (byBand[band] = byBand[band] || []).push(d);
    });
    var AGE_ORDER = ['<1y', '1-2y', '2-3y', '3-5y', '5y+'];
    return {
      name: type, value: typeDevices.length,
      filterDim: 'deviceTypes', filterValue: type,
      children: AGE_ORDER.filter(function (b) { return byBand[b]; }).map(function (b) {
        return { name: b, value: byBand[b].length, navTab: 'tab-asset', navDeviceType: type };
      })
    };
  }).sort(function (a, b) { return b.value - a.value; });

  return {
    name: 'Total devices', value: devices.length,
    // resetSet restores CONFIG.JIRA_DEVICE_TYPE_DEFAULT (empty as of 2026-08-21,
    // i.e. no restriction) rather than hardcoding clearDims:['deviceTypes'], so
    // this stays correct if the default is ever narrowed again. Housekeeping
    // issue types (Task/Epic/Test) are excluded unconditionally upstream by
    // isTrackedJiraDeviceType_ (via filteredJiraDevices_), independent of
    // whatever deviceTypes is set to — an empty include-list here never admits them.
    resetSet: { deviceTypes: CONFIG.JIRA_DEVICE_TYPE_DEFAULT },
    children: children
  };
}

/* ═══════════════ Tickets tree ═══════════════ */

/**
 * Three independent counting queries, one per ticket source. Each source
 * keeps its OWN outcome taxonomy (no shared "status" exists across Zoho/
 * ServiceWRK/TOM) — see the design spec §5.3 for why this isn't unified.
 * @param {Object} filters
 * @return {Array<{key:string, sql:string, maxRows:number}>}
 */
function buildTicketsQuerySpecs(filters) {
  var f = filters || {};
  return [
    {
      key: 'zoho', maxRows: 1,
      sql: 'SELECT COUNT(*) AS total, ' +
        ' COUNTIF(status NOT IN ' + CONFIG.ZOHO_TERMINAL_STATUSES + ') AS open ' +
        'FROM ' + zohoDedupSql_() + ' WHERE TRUE' + centerFilterSubqueryCond_(f) +
        dateRangeCond_('CreatedAt', f.dateFrom, f.dateTo)
    },
    {
      key: 'servicewrk', maxRows: 10,
      sql: 'SELECT IFNULL(NULLIF(TRIM(closure_type), ""), "Unknown") AS label, COUNT(*) AS cnt ' +
        'FROM ' + swTable_() + ' WHERE TRUE' + swFilterCond_(f) + ' GROUP BY label'
    },
    {
      key: 'tom', maxRows: 1,
      sql: 'SELECT COUNTIF(' + tomResolvedCond_() + ') AS resolved, ' +
        ' COUNTIF(' + tomUnresolvedCond_() + ') AS unresolved, ' +
        ' COUNTIF(NOT (' + tomResolvedCond_() + ') AND NOT (' + tomUnresolvedCond_() + ')) AS other ' +
        'FROM ' + tomTable_() + ' WHERE TRUE' + tomFilterCond_(f)
    }
  ];
}

/**
 * Nests the three sources' raw query results into one tree. Pure function —
 * no BigQuery — so it's fully unit-testable against fixture rows.
 * @param {{zoho:{total:number,open:number}, servicewrk:Array<{label:string,cnt:number}>,
 *          tom:{resolved:number,unresolved:number,other:number}}} r
 * @return {{name:string, value:number, children:Array}}
 */
function nestTicketsTree_(r) {
  var zohoTotal = r.zoho.total || 0;
  var zohoOpen = r.zoho.open || 0;
  var swTotal = (r.servicewrk || []).reduce(function (s, x) { return s + (x.cnt || 0); }, 0);
  var tomTotal = (r.tom.resolved || 0) + (r.tom.unresolved || 0) + (r.tom.other || 0);

  // Every node on this tree — source and outcome leaf alike — carries the
  // parent source's navTab: spec §6 says "Tickets tree, any node -> switches
  // to that source's own page", not just the three top-level source nodes.
  var children = [
    {
      name: 'Zoho', value: zohoTotal, navTab: 'tab-support',
      children: [
        { name: 'Open', value: zohoOpen, navTab: 'tab-support' },
        { name: 'Closed', value: zohoTotal - zohoOpen, navTab: 'tab-support' }
      ]
    },
    {
      name: 'ServiceWRK', value: swTotal, navTab: 'tab-service',
      children: (r.servicewrk || []).map(function (x) { return { name: x.label, value: x.cnt, navTab: 'tab-service' }; })
    },
    {
      name: 'TOM', value: tomTotal, navTab: 'tab-tom',
      children: [
        { name: 'Resolved', value: r.tom.resolved || 0, navTab: 'tab-tom' },
        { name: 'Unresolved', value: r.tom.unresolved || 0, navTab: 'tab-tom' },
        { name: 'Visit needed', value: r.tom.other || 0, navTab: 'tab-tom' }
      ]
    }
  ];

  return { name: 'Total tracked records', value: zohoTotal + swTotal + tomTotal, children: children };
}

/**
 * Overview page payload — all three decomposition trees, one cached round trip.
 * @param {{filters:Object, bypassCache:boolean}=} options
 */
function apiGetOverviewFlowCD(options) {
  options = options || {};
  var filters = options.filters || {};
  return respond_(function () {
    return withCache('ovflow_v1_' + getCacheEpoch_() + '_' + filterHash_(filters), function () {
      var ticketRows = runQueriesParallel(buildTicketsQuerySpecs(filters));
      return {
        customers: buildCustomersTree_(filters),
        devices: buildDevicesTree_(filters),
        tickets: nestTicketsTree_({
          zoho: (ticketRows.zoho && ticketRows.zoho[0]) || { total: 0, open: 0 },
          servicewrk: ticketRows.servicewrk || [],
          tom: (ticketRows.tom && ticketRows.tom[0]) || { resolved: 0, unresolved: 0, other: 0 }
        })
      };
    }, options.bypassCache === true);
  });
}
