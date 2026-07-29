# SIP Insights — Device Fleet Intelligence Dashboard

A production-ready, **Tricog-branded**, interactive analytics dashboard built on **Google
Apps Script + BigQuery**. It surfaces live insights from the `tricogde-dwh.abi_tables`
dataset plus two Google Sheets: center reliability, revenue-at-risk, support-ticket flow
(Zoho), SLA compliance, device fleet, and asset reliability.

![stack](https://img.shields.io/badge/stack-Apps%20Script%20%C2%B7%20BigQuery%20%C2%B7%20ECharts-E5344F)
[![GitHub Repo](https://img.shields.io/badge/GitHub-Repository-black?logo=github)](https://github.com/sunilmorries-pixel/SIP)

## What it shows (8 tabs)

| Tab | Insights |
|---|---|
| **Overview** | Executive rollup: narrative hero, device-age ring, KPI strip, **Device status (Jira)** lifecycle donut, ticket flow, centers-needing-attention + reliability tables |
| **Centers / Customers** | Geo, deployment age, active-vs-ended, top hubs, reliability watchlist (uptime M-A1 / MTBF M-A2 / health M-A6), Center-360 table (clickable rows → drawer) |
| **Support / CS** | Zoho KPIs, ticket flow, **SLA-compliance suite** (within% + Tech/Non-Tech + breach-by-type), backlog, categories; CS-sheet TAT/machines/owners |
| **Asset** | Device age (executive summary), fleet-status donut, firmware spread, asset lifecycle/type breakdown, failure-analysis cohort (M-A3/A5), device explorer (search/sort/paginate/CSV) |
| **Map** | Leaflet map of located centers, clustered, colored by open tickets, clickable ticket-bucket legend |
| **Top Customers** | Curated 27 "Top LE" hubs: KPIs, map, ranked bars, leaderboard (→ customer drawer) |
| **Numbers** | Source-reconciliation counts + raw paginated `center_details` table (Devices + Mapped columns) |
| **Raw Data** | All 5 underlying sources (3 BQ tables + 2 Sheets) as paginated, unfiltered tables with pill-selector and full CSV export. No site filters apply |

Interactive everywhere: global search, a **Filters** drawer (Segment / Status / State / Hub
multi-select + date range, with Status defaulting to `ACTIVE` as a removable chip), light/dark
theme, a shared center-detail drawer (KPIs + Zoho ticket links + Jira-devices table), **ⓘ
metric-explanation tooltips** on every KPI and card (formula + data source), flowing animations,
auto-refresh every 5 minutes, skeleton loading, graceful error/empty states. **Responsive** down
to 320px (breakpoints in `src/client/Styles.html`).

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
│   │   ├── Numbers.js         # Numbers page + Jira-sheet device stats (Connector/ECG Machine only)
│   │   ├── SheetSource.js    # reads Jira + CS Google Sheets (REST API) + raw sheet reader
│   │   ├── RawData.js        # Raw Data page: all 5 sources, paginated, CSV export
│   │   ├── JiraDump.js       # offline device snapshot (Sheets-API fallback)
│   │   ├── Api.js            # legacy endpoints (retained; CD versions are live)
│   │   ├── TopCustomers.js   # curated 27 "Top LE" hubs
│   │   ├── ExecOverview.js   # legacy exec endpoint
│   │   ├── Geo.js            # progressive geocoder
│   │   ├── Join.js           # Apps Script hash-join utils
│   │   ├── WebApp.js         # doGet router + HTML includes
│   │   ├── Setup.js          # one-time key setup + diagnostics
│   │   └── Warm.js           # cache-warming trigger (installWarmTrigger(), every 10 min)
│   └── client/               # HTML-service frontend
│       ├── Index.html        # page shell (8 tabs, shared drawer)
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
