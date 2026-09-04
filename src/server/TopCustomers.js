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
 * available.
 *
 * A group can ALSO claim individual `center_ids` (added 2026-09-04) for a
 * center that has no hub of its own — every entry below still uses hub_ids
 * except Matcare (see its own comment). computeTopCustomersCD_ resolves a
 * center-level claim over a hub-level one, so listing a center_id here always
 * wins even if that center's real HubID also belongs to another group's list.
 *
 * 'Indira IVF' (2026-09-04): the team's export again had no HubID for this
 * account, same gap as 2026-08-17. Rather than keep the old single
 * previously-known hub_id (36772, Udaipur), queried center_details for every
 * self-referencing hub (HubID = CenterID) named "Indira IVF" — 61 ACTIVE hubs,
 * one per city, essentially nationwide (confirmed against the sandbox copy —
 * this machine has no production BigQuery credential, so re-verify against
 * tricogde-dwh if the count ever looks off). Includes 42923 ("Eves Hospital &
 * Indira IVF", a co-branded facility) per user's explicit choice to include it.
 */

var TOP_CUSTOMERS = [
  { group: 'Metropolis', tier: 'Top LE', hub_ids: [1837, 2133, 2314, 8262, 40240, 40996, 49494, 49495] },
  { group: 'VIJAYA DIAGNOSTIC CENTRE', tier: 'Top LE', hub_ids: [13246] },
  { group: 'Aarthi Scans', tier: 'Top LE', hub_ids: [1684, 10502, 17328, 40304] },
  { group: 'HEALTHIANS LABS', tier: 'Top LE', hub_ids: [50131] },
  { group: 'Chandan', tier: 'Top LE', hub_ids: [2848, 40947, 48772] },
  { group: 'Indira IVF', tier: 'Top LE', hub_ids: [
    36772, 36778, 41164, 41351, 41352, 41358, 41368, 41370, 41371, 41373, 41375, 41377,
    41759, 41767, 41779, 41805, 41806, 41811, 41826, 41988, 41989, 41990, 42006, 42007,
    42031, 42046, 42053, 42109, 42230, 42235, 42249, 42263, 42272, 42294, 42304, 42346,
    42362, 42365, 42420, 42457, 42459, 42532, 42535, 42556, 42700, 42778, 42923, 43172,
    43242, 47449, 49195, 50531, 50540, 50618, 50620, 51328, 52268, 52273, 52280, 52438, 52581
  ] },
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
  // Matcare (2026-09-04): the export's 4 "hub" IDs are actually the 4 spoke
  // CenterIDs of this account — confirmed every "Matcare"-named row in
  // center_details is one of these 4, and all 4 have their real HubID set to
  // 36772 (Indira IVF's hub). There is no independent Matcare hub to list, so
  // these are claimed as center_ids instead — without this, these 4 centers
  // silently counted toward Indira IVF (matching on hub_id=36772) and
  // Matcare's own row always showed 0 centers (nothing has hub_id=50590 etc.).
  { group: 'Matcare', tier: 'Top LE', hub_ids: [], center_ids: [50590, 50722, 52270, 54300] },
  { group: 'Jaslok', tier: 'Top LE', hub_ids: [48763] }
];

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
