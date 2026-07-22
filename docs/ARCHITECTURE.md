# Architecture

## System overview

```
┌────────────────────┐        google.script.run         ┌─────────────────────────┐
│  Browser (client/) │ ───────────────────────────────► │  Apps Script (server/)  │
│                    │                                  │                         │
│  Index.html  shell │  ◄─── { ok, data | error } ───── │  Api.js     endpoints   │
│  Styles.html tokens│                                  │  BigQuery.js runner     │
│  Charts.html viz   │                                  │  Queries.js  SQL        │
│  App.html    state │                                  │  Auth.js     SA OAuth   │
└────────────────────┘                                  └───────────┬─────────────┘
                                                                    │ UrlFetchApp.fetchAll
                                                                    │ (parallel, Bearer token)
                                                        ┌───────────▼─────────────┐
                                                        │  BigQuery REST API      │
                                                        │  tricogde-dwh           │
                                                        │  abi_tables             │
                                                        └─────────────────────────┘
```

## Data sources

See `docs/SOURCES.md` for the full source-of-truth table. Summary of current roles (v5.0):

| Source | Rows | Role in the dashboard |
|---|---|---|
| `center_details` (BQ) | ~55.7k (28,299 F2P-excluded) | **Sole center source** — counts, uptime/MTBF/health, geo, deployment age |
| Jira devices Google Sheet | ~43.8k | **Devices/fleet count**; serial (from `Summary`) → center via `cloud_devices` |
| `cloud_devices` (BQ) | ~11.3k | Fleet-status donut, device explorer, serial→center bridge |
| `zoho_data` (BQ) | ~84.5k | Support tickets, SLA compliance, uptime-downtime proxy. Date strings via `SAFE.PARSE_DATETIME('%d-%b-%Y %I:%M:%S %p', …)` |
| `device_metrics` (BQ) | dup rows | Reliability watchlist — deduped with `GROUP BY deviceid` |
| CS tracker Google Sheet | — | Support/CS field cases (TAT/machine/owner) |
| `device_center_mapping`, `jira_data` (BQ) | — | **Retired as user-facing sources** (legacy serial-linking / asset spec only); still surfaced read-only on the Raw Data page |

**v5.2:** the Jira devices Google Sheet's fleet count is permanently restricted to Issue
Type = Connector or ECG Machine (`CONFIG.JIRA_DEVICE_TYPES`, applied in `jiraDeviceStats_()`).
A **Raw Data** view (`src/server/RawData.js`) exposes all 8 sources unfiltered, paginated,
with full-table CSV export. `swap` tickets are now classified as technical in
`TECH_FALLBACK_REGEX`. The Overview's fleet donut is a Jira lifecycle-status donut
(`Charts.jiraStatus()`).

## Key design decisions

### 1. One payload, parallel queries
`apiGetDashboard()` fans ~14 aggregate queries out through `UrlFetchApp.fetchAll`,
so total latency ≈ the slowest single query rather than the sum. One failed panel
returns `null` and the UI shows an empty state for that card only — a single bad
query never sinks the whole dashboard.

### 2. Aggregate on BigQuery, not in Apps Script
Every chart is fed by a `GROUP BY` that returns ≤ a few dozen rows. Raw rows only
ever leave BigQuery for the device explorer, which is paginated server-side
(`LIMIT @limit OFFSET @offset` + `COUNT(*) OVER()` for total).

### 3. Caching
`CacheService` stores each payload JSON for 5 minutes, keyed by an MD5 of the
filter set (current keys `dashcd_v1`/`execcd_v1`/`numbers_v2`/`topcustcd` + an
`_a` suffix when the Active-centers toggle is on). The Refresh button passes
`bypassCache: true`. Bump the version suffix when changing query shapes to invalidate
everything; `clearDashboardCache()` in `Setup.js` clears the current key set.

### 4. Injection safety
- Untrusted values (search text, hub, status, paging) → **named query parameters**.
- Sort column/direction → validated against a whitelist map (`DEVICE_SORT_COLUMNS`).

### 4b. Joins happen in Apps Script, not SQL
All BigQuery statements are single-table reads. Multi-source views (Center-360,
Sheet ⋈ BQ enrichment) are built by hash-joining pre-aggregated result sets in
`server/Join.js`, with results cached via the chunked large-cache in
`server/BigQuery.js`. See docs/SOURCES.md → "Where joins happen".

### 5. Fleet status buckets
A single shared CASE expression (`FLEET_BUCKET_SQL`) defines heartbeat buckets
(Live <1h → Never seen). The same strings drive the donut, the status chips and
the explorer filter, so a donut-slice click can filter the table 1:1.
Timestamps at epoch (1970) are treated as "Never seen".

### 6. Frontend without a framework
Apps Script HTML-service pages ship as one document; a build step would add
friction for little gain at this size. Discipline instead comes from file
separation (shell / tokens / charts / state) and a small set of conventions:
- all server calls promisified through `gsCall()`,
- all chart configs in `Charts`, staged and applied lazily (hidden tab panels
  have zero size, so options are flushed when a tab becomes visible),
- mock fallback when `google` is undefined → the UI previews locally.

### 7. Design system
Tokens in `Styles.html` are **Tricog-branded** (rebranded v3.0): deep-navy surfaces
(`--bg-0 #04182C`), **red primary** `--primary #E5344F` (brand/CTA/active nav),
blue `--secondary #2E9BD6` + teal `--accent #04E0B8` for data viz, semantic status
colors, **Lato** for headings and body (tabular nums for numerals). Full light + dark
themes; motion tokens + entrance/hover animations respect `prefers-reduced-motion`.
(Note: `design-system/sip-insights/MASTER.md` was the original pre-rebrand brief — the
shipped tokens in `Styles.html` are the source of truth.)

## Request lifecycles

**Dashboard load**
1. `App.init()` → skeletons on, `gsCall('apiGetDashboard', {hub})`
2. `Api.apiGetDashboard` → cache hit? return : build specs → `runQueriesParallel`
3. Client renders KPIs (count-up), stages chart options, flushes visible ones.

**Device explorer**
1. Search input (debounced 400ms) / chip / sort / page → `gsCall('apiGetDevices', query)`
2. Stale responses are dropped via a request-id guard (`devicesRequestId`).

**Auto-refresh**
1-second countdown ticker; at zero → `loadDashboard(bypassCache=true)` + `loadDevices()`.
Toggle state persists in `localStorage`.

## Extending

- **New chart**: add a query spec in `Queries.js` → add a builder in `Charts.html`
  → add a card in `Index.html` → wire it in `renderDashboard()`.
- **New filter**: add a named parameter to the relevant specs, thread it through
  `apiGetDashboard(options)`, include it in the cache key.
- **Per-page design overrides**: create `design-system/sip-insights/pages/<page>.md`;
  it takes precedence over MASTER.md (see design-system README section in MASTER).
