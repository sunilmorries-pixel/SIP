# SIP Insights — Device Fleet Intelligence Dashboard

A production-ready, **Tricog-branded**, interactive analytics dashboard built on **Google
Apps Script + BigQuery**. It surfaces live insights from the `tricogde-dwh.abi_tables`
dataset (no other data source — see `docs/SOURCES.md`): center reliability, support-ticket
flow (Zoho), SLA compliance, device fleet, and asset reliability.

![stack](https://img.shields.io/badge/stack-Apps%20Script%20%C2%B7%20BigQuery%20%C2%B7%20ECharts-E5344F)
[![GitHub Repo](https://img.shields.io/badge/GitHub-Repository-black?logo=github)](https://github.com/sunilmorries-pixel/SIP)

## What it shows (10 tabs)

There is no standalone Map tab — it was merged into Overview at @79/v5.50; the map now lives
there, plus two coverage layers — FSE (Field Service Engineer) added v5.54/@83–84 and CP
(Channel Partner dealer) added v5.60/@89 — bundled country shading (v5.59/@88), and a
zoom-driven country → state → city tier switch (@98–@103, see `docs/ARCHITECTURE.md`). All
three maps (Overview, Top Customers, CDM) come from one `MapView(containerId)` factory (see
`docs/ARCHITECTURE.md`).

| Tab | Insights |
|---|---|
| **Overview** | 3 decomposition **flow diagrams** — Customers, Devices, All tickets (trees as of v5.38/@67, layout iterated through @76/v5.47, treemaps @78/v5.49–@89, flow from @90, top-to-bottom with subbranch-clustered children from @112–@113 — see `HANDOFF.md`) — each card opens from a KPI total into a hand-laid two-rank flow (`Charts.decompFlow`, one ECharts `custom` series) built from pure-JS aggregation over one combined endpoint (`apiGetOverviewFlowCD`): a level-1 band across the top, a level-2 band across the bottom, and one ribbon per parent→child relationship, with each parent's own children clustered directly beneath it (a visible gap separates one parent's cluster from the next, so the row reads as branches, not one strip). Widths are value-driven but floored and compressed rather than ratio-true, so every drawn block also prints its own count (and its share where the width allows), and the tooltip is a full row readout. The flow is read-only as of 2026-08-25 (@108) — clicking a block no longer drills the global filters; the tooltip is the whole interaction now. Also carries the located-centers map (merged in from the old Map tab, @79): full-width at 85vh / 620px min since v5.57/@86, auto-fit restricted to centers inside a service-region box so a far-off bad geocode can't zoom the view out (v5.58/@87 — those markers still render and stay clickable), zoom-gated country/state/city tiers (@98–@103: a count-shaded country choropleth or a binary has-center fill depending on the pass — binary as of @103 — below zoom 5, India state-level proportional circles between zoom 5–6, individual center pins/clusters above that), plus two coverage layers, off by default as of @107 — FSE engineers, computed from tickets actually worked (`Fse.js`, @83–84, real roster live from @89), and CP dealers from a declared roster (`Cp.js`, v5.60/@89) |
| **Centers / Customers** | Geo, deployment age, segment breakdown (`hub_master_segment`), top hubs (by spoke count), Center-360 table (MTBF/Failures columns, sticky Center column, swapped-ticket count, clickable rows → drawer) |
| **Support / CS** | Zoho KPIs (with prior-7-day delta chips), ticket flow, **SLA-compliance suite** (within% + Tech/Non-Tech + breach-by-type), **SLA risk card** (breached/at-risk chart + ticket worklist), open-ticket age-bucket chart, backlog, categories, channel, segment |
| **Service** | Field-service ticket analytics from `servicewrk_Tickets` (added v5.29) — deliberately not the Machine Uptime source; see `docs/SOURCES.md`. KPIs/charts including two swap-specific breakdowns (Replacements/swaps by region — the center's own state via `customer_id`→`CenterID`, not the sales-territory column — and by FSE, added @109), plus a paginated ticket explorer (open tickets only as of @110; State/City columns, not Territory, as of @111) |
| **TOM** | CS-owned issue/escalation tracker from `tom_tickets` (added v5.30); Centre + date-range filter only |
| **Asset** | Jira-sourced device age (executive summary), asset lifecycle/type breakdown, failure-analysis cohort (M-A3/A5). The device-status donut, firmware spread, and device explorer were removed 2026-08-19 — `cloud_devices` telemetry now surfaces only on CDM/Numbers/Raw Data |
| **CDM** | Communicator Device Management (added v5.33) — `cloud_devices` map colored by battery severity, signal/battery/hardware-mix charts, paginated communicator explorer. The map is scoped to centers `cloud_devices` actually reports on (@106) |
| **Top Customers** | Curated "Top LE" account list (22 business groups / 75 HubIDs, `TopCustomers.js`): KPIs, map, ranked bars, leaderboard (→ customer drawer). Leaderboard columns as of @104: MRR/Devices/Assets dropped, **Swapped** count and **oldest open ticket's age bucket** added |
| **Numbers** | Source-reconciliation counts + raw paginated `center_details` table (Devices + Mapped columns) |
| **Raw Data** | All 4 underlying BigQuery sources as paginated, unfiltered tables with pill-selector and full CSV export. No site filters apply |

Interactive everywhere: global search (per-tab behavior — filters a list, looks up a
CenterID/ticket number on Support/CS, or disables itself with an explanation on tabs with no
list to filter), a **Filters** drawer (11 dimensions as of v5.53/@82 — Segment / Status / State /
Hub / City / Country / Center / Billable / Machine Type / Device ID / Mac Serial ID, all
multi-select, plus a date range; Status defaults to `ACTIVE` as a removable chip), light/dark
theme, a shared center-detail drawer (KPIs, Jira-devices table, and — as of v5.55/@84 — two
independent ticket toggles: Zoho Open/All/Swapped and Service Open/Closed/Swapped, see
`docs/ARCHITECTURE.md`), **ⓘ metric-explanation tooltips** on every KPI and card (formula + data
source), flowing animations, auto-refresh every 5 minutes, skeleton loading, graceful error/empty
states. **Responsive** down to 320px (breakpoints in `src/client/Styles.html`).

## Repository layout

```
demo-sip/
├── src/                      # everything that deploys to Apps Script
│   ├── appsscript.json       # manifest: OAuth2 lib, scopes, web-app config
│   ├── server/               # .gs backend (plain JS)
│   │   ├── Config.js         # env constants — single source of truth
│   │   ├── Auth.js           # service-account OAuth (read-only BigQuery)
│   │   ├── BigQuery.js       # parallel query runner + cache + row parsing
│   │   ├── Queries.js        # base SQL statements, parameterised
│   │   ├── EditionCD.js      # center_details data layer — LIVE client endpoints
│   │   ├── SlaCatalog.js     # SLA catalog + Tech/Non-Tech classification
│   │   ├── SlaRisk.js        # SLA risk card: breached/at-risk chart + ticket worklist (Support/CS)
│   │   ├── Numbers.js         # Numbers page + Jira device stats (live jira_data BQ table, exclude-list device-type filter)
│   │   ├── OverviewFlow.js   # Overview decomposition flow diagrams: apiGetOverviewFlowCD + pure-JS tree aggregation
│   │   ├── ServiceWrk.js     # Service page — field-service ticket analytics (servicewrk_Tickets)
│   │   ├── TomTickets.js     # TOM page — CS issue/escalation tracker (tom_tickets)
│   │   ├── ProfileNewSources.js # one-off join-key profiling helpers for new BQ tables (dev/diagnostic only)
│   │   ├── RawData.js        # Raw Data page: all 4 BQ sources, paginated, CSV export
│   │   ├── Api.js            # apiGetCdmDevices/apiHealthCheck + shared asset-index helpers
│   │   ├── TopCustomers.js   # curated "Top LE" list (22 groups / 75 HubIDs) + shared SLA-stats helper
│   │   ├── Fse.js            # FSE roster + engineer coverage computed from ServiceWRK tickets
│   │   ├── Cp.js             # Channel Partner dealer roster + declared coverage (no query)
│   │   ├── Geo.js            # progressive geocoder
│   │   ├── Join.js           # Apps Script hash-join utils
│   │   ├── WebApp.js         # doGet router + HTML includes
│   │   ├── Setup.js          # one-time key setup + diagnostics
│   │   └── Warm.js           # cache-warming trigger (installWarmTrigger(), every 10 min)
│   └── client/               # HTML-service frontend
│       ├── Index.html        # page shell (10 tabs, shared drawer)
│       ├── Styles.html       # Tricog design tokens + components + motion
│       ├── Charts.html       # all ECharts configs
│       ├── MapView.html      # Leaflet factory: 3 instances (Overview/Top Customers/CDM)
│       │                     #   + bundled country polygons (see docs/SOURCES.md)
│       └── App.html          # state, data loading, interactions
├── design-system/            # original design brief (MASTER.md; Styles.html is truth)
├── docs/                     # architecture, deployment, BQ setup notes
├── credentials/              # service-account key (gitignored — never commit)
├── scripts/                  # local helper scripts
└── .clasp.json.example       # copy to .clasp.json to use clasp push
```

## Quick start

1. **Deploy the code** — two options, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md):
   - `clasp push` (recommended), or
   - copy-paste each file into the Apps Script editor.
2. **Store the service-account key** (one time): open `Setup.js` (or `Setup.gs`),
   paste the JSON from `credentials/` into `setupServiceAccountKey()`, run it,
   then **delete the pasted key** from the source.
3. **Verify**: run `diagnostics()` — the log should list row counts for every panel.
4. **Deploy → New deployment → Web app** (execute as you, access: your domain).
5. Open the web-app URL. Done.

## Security model

- BigQuery access is **read-only** (`bigquery.readonly` scope).
- The service-account key lives **only in Script Properties**, never in source.
- All user input (search, hub, paging) goes through **named query parameters** —
  no string-concatenated SQL.
- Sort columns are validated against a whitelist.
- `credentials/` is gitignored; commit history stays clean.

## Local preview

The frontend runs standalone with mock data (no Apps Script needed):

```powershell
powershell -File scripts/build_preview.ps1   # assembles + serves preview
```

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — data flow, caching, query design
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — clasp + manual deployment paths
- [docs/AppsScript_BigQuery_Setup.md](docs/AppsScript_BigQuery_Setup.md) — original BQ connection notes
- [design-system/sip-insights/MASTER.md](design-system/sip-insights/MASTER.md) — Tricog brand tokens (shipped values live in `src/client/Styles.html`)
