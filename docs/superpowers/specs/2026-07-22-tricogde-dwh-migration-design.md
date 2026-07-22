# tricogde-dwh Migration + Filter Removal + Native Asset Pipeline — Design

**Date:** 2026-07-22
**Status:** Approved by user (scope, connection layer, filter removal, asset-pipeline swap, Raw Data pills)
**Baseline:** live deployment (Apps Script v34) == repo `main` @ `9bb3381` (tag `v5.9`)
**Companion:** temporary `src/server/Diag.js` probes (`diagNewDwh`, `diagJiraDataDetail`) — not part of this repo; live-verified facts below are their output.

## 1. Problem

The app's only data source today, `magnaquest-sand-box.abi_team_sip_devtest_poc`, is a
dev/test dataset — its `center_details` table is a known-stale snapshot (F2P flag dormant,
duplicate rows requiring `DISTINCT`, reload-schema drift has hit it twice before per
HANDOFF.md). A real production warehouse, `tricogde-dwh.abi_tables`, now exists.
Separately, the app carries three overlapping filter mechanisms (Active+Paid baseline,
per-page Segment dropdown, global search/status chips) the user wants removed outright
rather than carried into the new source. Third, the device/asset pipeline depends on the
Sheets API, which is currently **disabled** — `readJiraSheet()` 403s on every call, so the
app has been serving a frozen 43,794-row static snapshot (`JiraDump.js`) for its entire
device/asset picture, with no path to freshness until Sheets access returns.

## 2. Design summary (one sentence)

Rebuild the server-side data-access layer end-to-end against `tricogde-dwh.abi_tables`
with every filter deleted and the device/asset pipeline moved natively into BigQuery
(replacing the Sheet), while leaving the client shell, tabs, auth guard, and performance
work (Warm.js, SRI, XSS fixes) untouched.

## 3. Verified facts (live-probed, not assumed)

| Table | Old (magnaquest-sand-box) rows | New (tricogde-dwh) rows | Column count | Schema |
|---|---|---|---|---|
| `center_details` | 35,804 | 36,501 | 114 | **IDENTICAL** |
| `cloud_devices` | 11,331 | 11,507 | 22 | **IDENTICAL** |
| `device_center_mapping` | 56,306 | 56,929 | 12 | **IDENTICAL** (retiring anyway — §5) |
| `device_metrics` | 191 | 797 | 11 | **IDENTICAL** (stays unused — §5) |
| `jira_data` | 49,137 | 48,616 | 16 | **IDENTICAL** |
| `zoho_data` | 84,545 | 86,091 | 67 | **IDENTICAL** |

New project consistently has slightly higher counts across every table — consistent with an
actively-maintained warehouse rather than a frozen copy.

**Access:** a project-scoped service account
(`abi-team-prod-bq-access@tricogde-dwh.iam.gserviceaccount.com`) has read + job-run access
to `tricogde-dwh` only (not `magnaquest-sand-box`). Its key is stored, isolated, under the
`SA_KEY_DWH` Script Property (never in source/git — paste-run-delete pattern, same as the
existing `SA_KEY`).

**`jira_data` columns** (needed for the native asset pipeline, §6): `project_key, issue_key,
ticket_created, ticket_updated, summary, issuetype_id, issuetype_name, status_name,
customername, customerid, author, field_changed, from_value, to_value, last_field_updated,
load_timestamp`. Fan-out is mild: 48,616 raw rows / 45,290 distinct `issue_key` (~7%,
consistent with only some issues having changelog entries appended — far less than the
historical concern that blocked using this table before). Device serial lives in `summary`
(e.g. `SF715440072PA`, `Tricog-Dongle-B777`), same shape the Sheet-based regex already
parses. `customerid`/`customername` is a hub/customer reference, not a center — center
mapping still goes through the serial, as it does today.

## 4. Connection layer

- `Config.js`: `BQ_PROJECT_ID` → `'tricogde-dwh'`; `BQ_DATASET` → `'tricogde-dwh.abi_tables'`.
- `Auth.js`/`Config.js`: `CONFIG.SA_PROPERTY_KEY` → `'SA_KEY_DWH'` (one line). The old
  `SA_KEY` property and its value are **left untouched** in Script Properties — not deleted,
  not overwritten. This is the rollback path: reverting this one Config.js line plus a git
  revert of the query-layer changes restores the app to `magnaquest-sand-box` with zero
  credential re-provisioning.
- `BigQuery.js`'s job-execution project follows `BQ_PROJECT_ID`, so jobs run in
  `tricogde-dwh` — already proven working live via the temporary `runDwhQuery_` probe.
- No client-visible change; the client never sees project/dataset names.

## 5. Filter removal (applies during the same rewrite)

Per the earlier filter-removal design, folded into this rebuild rather than done as a
separate pass:

- **No Active+Paid baseline.** `cdFilter_()`, `CD_SEG_FILTER`, `cdSegCond_()`, `segClean_()`
  are deleted, not neutralized. Every query keeps only its genuine business conditions
  (e.g. `deploymentdate IS NOT NULL`). Universe becomes the full center count (~36,501
  distinct, per §3 — exact figure re-verified after the rewrite, since it may shift again
  by then given the warehouse is live/growing).
- **No segment/hub filtering.** `HUB_FILTER_SQL`, `@hub` params, `segmentOptions` spec, and
  all segment-slug cache-key suffixes are removed. Segment dropdowns disappear from every
  page's filter bar.
- **No global search, no status chips, no clickable map legend.** Client state
  (`state.search`, `state.pageSegment`, `state.dashSegment`, `state.ticketBucket`,
  `dashSegmentFor()`, `reloadActiveList`'s search paths, `buildStatusChips()`) deleted.
  Chart drill-ins that used to *set* a filter become plain tab navigation. Map legend
  becomes a passive color key (same colors/labels, no `aria-pressed`, not clickable).
- **Retire `device_center_mapping`.** Confirmed present with identical schema in the new
  warehouse, but retired anyway per explicit decision — legacy specs in `Queries.js`/
  `ExecOverview.js` that reference it (already dead/superseded by `center_details`-based
  CD-edition queries) are deleted outright, not ported.
- **`device_metrics` stays unused.** No code references it today; no code will after this
  rewrite either. Docs-only note in `docs/SOURCES.md`.
- **Label correctness:** every "Active · Paid centers" chip, filtered-count subtitle, and
  METRIC_INFO tooltip that describes a now-removed filter gets corrected (mirrors item 4/5
  in the 2026-07-10 corrections ledger, applied to the new set of stale labels this
  produces).

## 6. Native asset/device pipeline (replaces the Google Sheet)

**Deleted:** `JiraDump.js` (static `JIRA_DUMP` snapshot), `readJiraSheet()`,
`getAssetIndex_()`'s Sheet-reading + JS-side dedup/regex path, and `deviceCenterMap_()`'s
role as a Sheet-serial bridge (its `cloud_devices`/`center_details` serial-lookup logic is
reused, folded into the new query rather than deleted).

**Added:** one SQL query (new spec, e.g. `assetIndexSqlCD_()` alongside the other
CD-edition builders in `EditionCD.js`/`Queries.js`) against `jira_data`:

- **Dedup:** `ROW_NUMBER() OVER (PARTITION BY issue_key ORDER BY ticket_updated DESC) = 1`
  — one row per issue, latest known state. (Assumption to spot-check during
  implementation: `ticket_updated` reliably reflects current state even across
  reopen/reactivate cycles — verify against a handful of known devices before relying on
  it broadly.)
- **Type filter:** keep the existing "Connector + ECG Machine only" restriction on
  `issuetype_name` (same allow-list `isTrackedJiraDeviceType_()` already encodes).
- **Center mapping:** `REGEXP_EXTRACT(summary, ...)` (same pattern as the current JS
  `SERIAL_RE`) joined against `cloud_devices`/`center_details` serial columns — moves
  matching from a JS post-processing step into the query itself.
- **Output:** same shape `getAssetIndex_()` produces today (`key, summary, serial, type,
  category, status, birthday, age_days, center_id`), so every consumer
  (`jiraDeviceStats_()`, `assetsDonutFromIndex_()`, `cohortFromIndex_()`, the Map/Exec/
  Center-360/Center-detail asset counts) keeps its existing interface — only the producer
  changes.
- **Net effect:** always-fresh device data (no snapshot, no Sheets-API dependency for this
  pipeline); the CS-tracker sheet is unaffected and remains blocked on the Sheets API
  separately.

## 7. Raw Data page

Pill order/set changes to: **Center Details · Cloud Devices · Zoho Tickets · Jira Data ·
CS Tracker (Sheet)**. The "Jira Data" pill reads `tricogde-dwh.abi_tables.jira_data`
directly (raw, unfiltered, issue×changelog grain as-is — Raw Data's contract is "show the
source as it is," so no dedup applied here, unlike §6's asset pipeline). CS Tracker pill
unchanged (still Sheets-API-gated).

## 8. Component impact map

| File | Changes |
|---|---|
| `src/server/Config.js` | `BQ_PROJECT_ID`, `BQ_DATASET`, `SA_PROPERTY_KEY` |
| `src/server/Auth.js` | no code change — reads `CONFIG.SA_PROPERTY_KEY` already |
| `src/server/BigQuery.js` | no code change — project/dataset are already parameterized via CONFIG |
| `src/server/EditionCD.js` | delete `cdFilter_`, `CD_SEG_FILTER`, `cdSegCond_`; strip segment/hub params from every spec builder and `apiGet*CD` signature; add `assetIndexSqlCD_()`; delete dcm-based dead specs |
| `src/server/Queries.js` | delete `segClean_`, `HUB_FILTER_SQL`, `segmentOptions` spec; strip `@segment`/`@hub` from zoho/device specs; delete dcm-referencing legacy specs |
| `src/server/Numbers.js` | `deviceCenterMap_` reused inside the new asset query instead of standalone; drop segment param |
| `src/server/RawData.js` | pill list/order; new `jira_data` source entry |
| `src/server/ExecOverview.js`, `TopCustomers.js`, `Geo.js`, `SlaCatalog.js` | strip filter params; point at new dataset (inherited via CONFIG, but verify no hardcoded project/dataset strings) |
| `src/server/JiraDump.js` | **deleted** |
| `src/server/Api.js` | strip `segment`/`hub`/`search`/`status` params from `apiGetDevices`/`apiGetCentersCD` etc. signatures |
| `src/client/App.html` | remove search/segment/status-chip state + wiring (§5); update METRIC_INFO tooltips |
| `src/client/Index.html` | remove filter bars, status chips, baseline chips; passive map legend |
| `src/client/Charts.html` | drill-ins become navigation-only, not filter-setting |
| `docs/SOURCES.md` | new project/dataset; `device_center_mapping` marked retired (again, now confirmed present-but-unused in the new warehouse too); `device_metrics` unchanged (already marked unused) |
| `docs/DEPLOYMENT.md` | update project/dataset reference if it names the old one |

## 9. Testing & verification

- `node --check` on every changed file before push.
- Push to HEAD only — production stays on the pinned v34 deployment until an explicit
  redeploy, so nothing user-facing changes mid-implementation.
- Live spot-checks via one-off BQ probes (same pattern as `Diag.js`): total center count,
  a couple of KPI values cross-checked against direct `tricogde-dwh` queries, `jira_data`
  dedup row count sanity (~45,290 expected).
- Click through all 8 tabs on the HEAD test URL; 0 console errors; confirm no page still
  shows a filter control or stale "Active · Paid" label.
- Confirm `Warm.js`'s cache-key list still matches the (now filter-free, so simpler)
  set of keys each endpoint produces.
- Remove the temporary `Diag.js` probes from the live script once verification is complete.

## 10. Rollback

Nothing destructive happens to the old dataset or its credential: `SA_KEY` and
`magnaquest-sand-box` access are left exactly as they are. Rollback is a plain git revert
of the query-layer commits plus reverting the 3-line `Config.js` change — no credential
work, no data loss, no re-provisioning.

## 11. Open items (explicitly out of scope this round)

- CS-tracker sheet remains blocked on the Sheets API being re-enabled — unaffected by this
  migration (it never touched BigQuery).
- Uptime-CTE consolidation and other data-load performance items from the 2026-07-15 perf
  pass — separate backlog, not touched here.
- `AUTHORIZED_EMAILS` Script Property still unset (auth guard fail-open) — unrelated to
  this migration, tracked separately in HANDOFF.md.
- Whether `tricogde-dwh` row counts should be re-verified immediately before cutover
  (given it's evidently a live/growing warehouse, counts will have moved again by
  implementation time) — treated as expected, not a blocker.
