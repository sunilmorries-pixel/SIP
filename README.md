# SIP Insights — Device Fleet Intelligence Dashboard

A production-ready, **Tricog-branded**, interactive analytics dashboard built on **Google
Apps Script + BigQuery**. It surfaces live insights from the `tricogde-dwh.abi_tables`
dataset (no other data source — see `docs/SOURCES.md`): center reliability, support-ticket
flow (Zoho), SLA compliance, device fleet, and asset reliability.

![stack](https://img.shields.io/badge/stack-Apps%20Script%20%C2%B7%20BigQuery%20%C2%B7%20ECharts-E5344F)
[![GitHub Repo](https://img.shields.io/badge/GitHub-Repository-black?logo=github)](https://github.com/sunilmorries-pixel/SIP)

## What it shows (10 tabs)

There is no standalone Map tab — it was merged into Overview at @79/v5.50; the map now lives
there, plus an FSE (Field Service Engineer) coverage layer added v5.54/@83–84 (see
`docs/ARCHITECTURE.md`).

| Tab | Insights |
|---|---|
| **Overview** | 3 decomposition **treemaps** — Customers, Devices, All tickets (trees as of v5.38/@67, layout iterated through @76/v5.47, treemaps from @77/v5.48 — see `HANDOFF.md`) — each card opens from a KPI total into an ECharts treemap (`Charts.decompTreemap`) built from pure-JS aggregation over one combined endpoint (`apiGetOverviewFlowCD`). Rectangle area = share of the total, so a category's size is visible rather than only printed. Every node is clickable and drills the global filters. Also carries the located-centers map (merged in from the old Map tab, @79) and, since @83–84, an FSE coverage layer (`Fse.js`) |
| **Centers / Customers** | Geo, deployment age, segment breakdown (`hub_master_segment`), top hubs (by spoke count), Center-360 table (MTBF/Failures columns, sticky Center column, swapped-ticket count, clickable rows → drawer) |
| **Support / CS** | Zoho KPIs (with prior-7-day delta chips), ticket flow, **SLA-compliance suite** (within% + Tech/Non-Tech + breach-by-type), **SLA risk card** (breached/at-risk chart + ticket worklist), open-ticket age-bucket chart, backlog, categories, channel, segment |
| **Service** | Field-service ticket analytics from `servicewrk_Tickets` (added v5.29) — deliberately not the Machine Uptime source; see `docs/SOURCES.md` |
| **TOM** | CS-owned issue/escalation tracker from `tom_tickets` (added v5.30); Centre + date-range filter only |
| **Asset** | Jira-sourced device age (executive summary), asset lifecycle/type breakdown, failure-analysis cohort (M-A3/A5). The device-status donut, firmware spread, and device explorer were removed 2026-08-19 — `cloud_devices` telemetry now surfaces only on CDM/Numbers/Raw Data |
| **CDM** | Communicator Device Management (added v5.33) — `cloud_devices` map colored by battery severity, signal/battery/hardware-mix charts, paginated communicator explorer |
| **Top Customers** | Curated 27 "Top LE" hubs: KPIs, map, ranked bars, leaderboard (→ customer drawer) |
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
│   │   ├── OverviewFlow.js   # Overview decomposition treemaps: apiGetOverviewFlowCD + pure-JS tree aggregation
│   │   ├── ServiceWrk.js     # Service page — field-service ticket analytics (servicewrk_Tickets)
│   │   ├── TomTickets.js     # TOM page — CS issue/escalation tracker (tom_tickets)
│   │   ├── ProfileNewSources.js # one-off join-key profiling helpers for new BQ tables (dev/diagnostic only)
│   │   ├── RawData.js        # Raw Data page: all 4 BQ sources, paginated, CSV export
│   │   ├── Api.js            # apiGetCdmDevices/apiHealthCheck + shared asset-index helpers
│   │   ├── TopCustomers.js   # curated 27 "Top LE" hubs + shared SLA-stats helper
│   │   ├── Geo.js            # progressive geocoder
│   │   ├── Join.js           # Apps Script hash-join utils
│   │   ├── WebApp.js         # doGet router + HTML includes
│   │   ├── Setup.js          # one-time key setup + diagnostics
│   │   └── Warm.js           # cache-warming trigger (installWarmTrigger(), every 10 min)
│   └── client/               # HTML-service frontend
│       ├── Index.html        # page shell (10 tabs, shared drawer)
│       ├── Styles.html       # Tricog design tokens + components + motion
│       ├── Charts.html       # all ECharts configs
│       ├── MapView.html      # Leaflet factory (map + top-customers)
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
