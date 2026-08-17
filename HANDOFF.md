# SIP Insights — Session Handoff / Start-Here Context

**Last updated:** 2026-08-14 · **Live version:** 5.33 · **Status:** ✅ **Production is deployed
from `main`; git has 1 commit production hasn't picked up yet (see below).** Production
(`AKfycbwV6hHzDT1ZjkH49aFxVfoLF9wcFrBtv9FzrYzdd5RA9R3HAVOMcXrOgzwthI49KK7x`, same URL as always)
serves Apps Script **@62 / v5.33**, built from git `main` @ **`15eca0b`**. `main`'s current tip is
`7d98b69` (a local-tooling-only commit, see below — nothing to redeploy for it). No tag cut for
v5.27–v5.33. v5.21–v5.25 and v5.27–v5.33 were deployed **without** tags; only `v5.16`–`v5.18`,
`v5.20` and `v5.26` are tagged, so tags are not a reliable release index.

**`7d98b69` (2026-08-14, git only, not deployed):** local preview server switched from a
hardcoded port 8765 to `autoPort` (`.claude/launch.json`) + reading `$env:PORT`
(`scripts/build_preview.ps1`) — port 8765 was occupied by an unrelated process on the dev
machine. Dev-tooling only; doesn't touch `src/`, no redeploy needed.

**The Service and TOM pages are no longer placeholders** (v5.29, v5.30). Every page in the nav now
has a real data source; there are no "Data source not yet connected" cards left in `Index.html`.
**CDM (Communicator Device Management) is a new page as of v5.33** — see its own entry below.

⚠️ **`CONFIG.APP_VERSION` / `APP_DEPLOYED_AT` must be set to the version THIS DEPLOY WILL CREATE
— i.e. (current live `@N`) + 1 — in the same change as the `clasp deploy`.** Nothing derives them
(Apps Script cannot read its own deployment version at runtime). **This has gone wrong TWICE so
far** — @54 shipped carrying `'53'` (fixed in v5.26); @56/v5.27 repeated the exact mistake (a
content-identical redeploy with no Config.js change, so nothing got bumped). **Fixed again in
v5.28/@57** (this session, commit `6288f65`): `APP_VERSION: '57'` / `APP_DEPLOYED_AT: 'Aug 14,
2026, 12:23 AM'`, deployed as @57 — footer now correctly matches. Don't copy the "just deploy,
nothing changed" reasoning that caused the repeat — the rule applies even to a content-identical
redeploy, because the NEXT deploy always creates a new `@N` regardless of what changed.

**Two Claude Code sessions have been working this same directory concurrently** (confirmed by the
user). Files were repeatedly modified on disk mid-edit, and one session's change was silently
reverted by the other's save at least once. Consequences to know:
- Some releases below were built by the *other* session and are summarized here from their commit
  messages, **not independently verified** — each entry says which.
- `v5.19`, `v5.21`, `v5.22` and `v5.23` were deployed **without git tags**; only `v5.16`, `v5.17`,
  `v5.18` and `v5.20` are tagged. Don't assume tag coverage is complete.
- **Before editing `src/client/App.html` / `Index.html` / `Styles.html`, re-read the file
  immediately before and after each edit** and grep for your own identifier to confirm the change
  survived. A successful Edit call is not proof the change is still on disk a minute later.

### v5.33 / @62 (2026-08-14) — CDM page, hub_country country filter, Support KPI grid fix

> Commit `54a5962`. **CDM (Communicator Device Management)** — new page next to Asset, sourced
> from existing `cloud_devices` (no new table): map colored by low-battery severity, KPIs
> (total/online/avg signal/low battery/HW-version mismatch), 4 charts (signal quality, battery
> status, hardware model mix, ECG readings), and a paginated communicator explorer surfacing
> Latency/Retries/SpaceAvailable/EcgCounter/hardware-version fields not shown anywhere else in
> the app. `MapView.setData` gained an optional `colorFn`/`tooltipFn` override (backward-compatible)
> so CDM's map reuses the existing clustering/rendering plumbing instead of duplicating it.
>
> **Country filter switched from `Spoke_Country` to `hub_country`** everywhere it's derived
> (`centerAttrCond_`, `countryOptions`, `centerBaseSpecCD_`, the center-detail drawer, Geo.js's
> geocode-key source) — `Spoke_Country` has ~9% NULLs plus data-entry noise (typos, a city name,
> a continent name) that `hub_country` doesn't have. Every cache key that transitively depends on
> the country filter was bumped so no endpoint serves pre-change cached results. `docs/SOURCES.md`
> and `docs/ARCHITECTURE.md` were stale on this (and on `tom_tickets`/`servicewrk_Tickets`/the
> CDM page generally) as of this deploy — **both fixed in this same catch-up pass** (see commit
> after this one).
>
> **Support page**: KPI grid switched to `kpi-grid-4` (was the bare 6-column default rendering
> only 4 tiles with an empty gap) to match Centers/Service/TOM/Map.
>
> **Also bundled in**: the profiling-tooling change from `dffa0fd` (see below) and this session's
> in-progress sidebar redesign (hover-to-expand icon rail with a pin toggle; Tricog mark moved
> from the sidebar into the topbar) — **concurrent work from another active session on this
> repo, bundled in per explicit user instruction rather than surgically separated out.**
>
> **`dffa0fd` (2026-08-14, profiling tooling, no version bump of its own):** `profileJoinKeys()`
> now also collects its output into an array (`profileJoinKeysText_()` returns it as one string)
> instead of `Logger.log`-only — motivated by `clasp run` not being available (project isn't
> deployed as an API executable) and the two new tables (`tom_tickets`/`servicewrk_Tickets`) only
> being readable by this script's service account, so there's no way to run this check from a
> workstation. A `doGet(?diag=joinkeys)` branch was tried to read it back remotely and reverted —
> it rendered, but the browser-automation tool lacks host permission for
> `script.google.com/a/macros/tricog.com/*`, so the output still couldn't be read back, and a
> live diagnostic endpoint risked being swept into a deploy by the concurrent session. **The
> actual join-key question (does `servicewrk_Tickets.customer_id` / `tom_tickets.center_id`
> resolve to `center_details.CenterID`?) is still unanswered** — `profileJoinKeys()` needs to be
> run directly in the Apps Script editor and its log read by hand.

### v5.32 / @61 (2026-08-14) — rankBar chart axis-label fix

> Commit `678496f`. Removed the redundant/overlapping value (x-)axis from every `rankBar` chart
> instance — 12 total: 5 on TOM, 3 on Service, 3 on Top Customers, 1 on Overview. The axis
> duplicated the value already shown as a bar-end label, and the two frequently overlapped.

### v5.31 / @60 (2026-08-14) — redeploy only, no code change

> Commit `c521977` touches only `Config.js` (verified — `git show c521977` has zero diff outside
> the version bump). Commit message says "filter-drawer coverage note deployed to the stable
> URL," but that note was already committed earlier (as part of v5.30/`4630b67` or the `456ed7c`
> docs commit); this deploy just re-cut the version to actually ship whatever had accumulated
> since @59. No functional change to attribute to v5.31 specifically.

### v5.30 / @59 (2026-08-14) — TOM page on `tom_tickets`

> Built and deployed this session. `src/server/TomTickets.js` (new) + `test/unit/tom-helpers.test.js`
> (25 tests). Endpoints `apiGetTomCD` (4 KPIs + 6 charts, one cached batch) and
> `apiGetTomTicketsCD` (paginated issue explorer). Commit `4630b67`.
>
> **What the table is:** a CS-owned issue tracker, 1,325 rows, 2025-12-30 → 2026-08-12, loaded from
> monthly spreadsheet tabs (`source_tab` = "2026 | June 2026"). `remarks` is the OUTCOME column
> despite its name — Issue Resolved / Auto Resolved / Not resolved / No response / Issue
> identified+Service Visit. **This framing is an inference, not confirmed by the CS team** — the
> user was asked twice and did not answer. `comments` hints at machine transfers (swapping, "Sent
> from HQ") but is 98.3% empty, so it can't carry the page. If TOM turns out to mean machine
> movement, the labels change; the queries mostly stand.
>
> **Unusable columns, deliberately not surfaced:** `t_o_m` holds a single value ("Saidha") across
> all 1,325 rows; `comments` is 98.3% null.
>
> **Filter coverage:** Centre (`center_id`, 99.7% populated) + date range ONLY. This table has no
> state/city/segment/hub columns and bridging needs the still-unverified centre join, so those
> dimensions are ignored rather than half-applied.
>
> **Bug caught by a unit test before it reached BigQuery:** the monthly-volume spec first aliased
> its derived month as `month`, which collides with this table's REAL `month` column — one holding
> bare names ("Jan", "Jun") that sort alphabetically. Aliased `ym` instead so GROUP BY/ORDER BY
> can't resolve to the wrong one. Also exported `Charts.verticalBar`, which existed but was only
> used internally by `assetByType`.
>
> **Verified against live BigQuery on the @HEAD test deployment before deploying** — 1,325 issues /
> 342 closed out (25.8%) / 68 unresolved, all matching the profiled table exactly (256+86=342,
> 27+41=68). Live avg TAT 0.7d.
>
> **Deploy hiccup worth knowing:** `clasp deploy` hit `ECONNRESET` *after* creating version 59 but
> *before* repointing the deployment, which still read @58. Recovered with
> `clasp deploy -i <id> -V 59` (deploy an EXISTING version) — re-running plain `clasp deploy` would
> have created a duplicate version 60. Also note `clasp deployments` served a stale @58 for several
> seconds after a successful deploy; re-query before concluding a deploy failed.

### v5.29 / @58 (2026-08-14) — Service page on `servicewrk_Tickets`

> Built and deployed this session. `src/server/ServiceWrk.js` (new) +
> `test/unit/servicewrk-helpers.test.js` (28 tests). Endpoints `apiGetServiceCD` and
> `apiGetServiceTicketsCD`. Commits `78f32b5`, `4728ff0`, `463f7ca`. Design spec at
> `docs/superpowers/specs/2026-08-13-service-tom-pages-design.md`, plan at
> `docs/superpowers/plans/2026-08-13-service-page.md`.
>
> **THE UPTIME ENGINE WAS DELIBERATELY NOT REPOINTED AT SERVICEWRK.** `Config.js:83` and
> `docs/SOURCES.md:81/93` both anticipate this swap ("when ServiceWRK lands, swap the `tix` CTE
> source"). **Do not do it** — the profiled data cannot support it, and this was decided with the
> user after seeing the numbers:
> 1. `created_on`/`closed_date` are DATE-ONLY (886 distinct values across ~947 days, all at
>    00:00:00). M-A1 merges downtime at HOUR grain, so same-day open+close = zero downtime.
> 2. Only **870 of 36,403** rows are `ticket_type = 'BREAKDOWN'`; the rest is core service work,
>    scheduled service, installs, even document collection. Downtime would collapse and uptime
>    would rise toward 100% — a nicer number that is less true.
> 3. Coverage starts 2024-01-08 while `life = today − deploymentdate` reaches years further back,
>    so all pre-2024 downtime would silently vanish.
> 4. The `customer_id` → CenterID join is unverified (7.9% null, ~7,923 distinct vs ~27,410
>    centres).
> Rationale is duplicated in a header comment in `ServiceWrk.js` so nobody "fixes" it later.
>
> **Filter coverage:** ServiceWRK's OWN `state`/`city`/`customer_category` (the last routed through
> `segmentGroupSql_`, per the standing segment-merge rule). Hub/Centre/Status/DeviceType are
> ignored — no counterpart columns.
>
> **Data guards, from profiling the live table:** `tat_days_` runs to −1.5 and `tat_min_` to −2158
> (rows closed before they were created) — every TAT statistic excludes them and the KPI sub-line
> reports the count rather than hiding it. **No dedupe CTE**: `ticket_id` is unique (36,583
> approx-distinct vs 36,403 rows), unlike `zoho_data`. Timestamps formatted in SQL, never in JS
> (`collectRows_` returns epoch strings like `"1.7712E9"` — the bug class fixed in `7bcf2a5`).
>
> **Three bugs found by driving the preview in a browser that the unit tests could not catch:**
> 1. `mockCall()` strips a trailing `"CD"` from `fn` BEFORE matching, so preview branches keyed on
>    `'apiGetServiceCD'` never fire. **Mock branches must match the BASE name.** Every KPI read 0
>    and the table said "Failed to load" until this was found.
> 2. The resolution donut's fallback `STATUS_PALETTE[i]` — index 2 IS `C.warn` — rendered an
>    "Unknown" slice in exactly the same amber as `CENTER_VISIT`. Unmapped slices now use `C.muted`.
>    Same defect class as the earlier `ok`/`teal` collision.
> 3. Four wiring edits were lost to the other session's `git stash push -u` (see v5.28 below) and a
>    partial state got committed before it was noticed.
>
> **Verified against live BigQuery on @HEAD before deploying** — 205 open tickets (profile:
> `Closed=36198, Open=205`) and 14.6% remote resolution (5,259 ÷ 36,081 = 14.57%), both matching
> independently-known ground truth.

### v5.28 / @57 (2026-08-14) — fix footer version drift (this session)

> **Deployed 2026-08-14** from commit `6288f65`, per user request ("next" → confirmed fixing +
> redeploying). Bumped `CONFIG.APP_VERSION`/`APP_DEPLOYED_AT` (see the ⚠️ above) and cut a fresh
> deploy so the footer would actually match. **Isolated from concurrent work** (same pattern as the
> v5.14 Centers-360 deploy): the working tree had the other session's in-progress, uncommitted
> Service-page work sitting in `App.html`/`Charts.html`/`Index.html` plus several new untracked
> files (`ServiceWrk.js`, `ProfileNewSources.js`, two `docs/superpowers/` planning docs, a test
> file) — `git stash push -u` twice (the second stash appeared because the other session kept
> editing `App.html` mid-operation), confirmed a clean tree matching `6288f65` exactly, ran
> `npm test` (69/69), then `clasp push` + `clasp deploy`. **`git stash pop` afterward hit a genuine
> conflict**: the bulk of the Service-page work (first stash, 8 files) restored cleanly, but a
> small second stash — 30 lines of further `App.html` edits made by the other session while the
> first stash was already isolating the file — conflicts with it and is still sitting in the stash
> list (`git stash list` → one entry, "more concurrent Service-page edits to App.html").
> **RESOLVED 2026-08-14 (v5.30 session): that stash has been verified redundant and dropped.** Its
> 30 lines were the Service page's metric-glossary / `KPI_METRIC` / `TITLE_METRIC` entries and the
> `init()` `buildServiceHeader()` call. The session that owned them had already re-applied every one
> by hand after noticing they were missing (commit `4728ff0`), so each added line was confirmed
> present in `HEAD` before `git stash drop`. `git stash list` is now empty. Verified live: `curl -L`
> → `200`; Overview loads
> with real data, 0 console errors. Footer version not re-checked pixel-by-pixel on the live page
> (this session's browser automation couldn't scroll that far down the real production page today)
> but the fix itself is a static string constant — low risk without that last visual confirmation.

### v5.27 / @56 (2026-08-13) — redeploy, no code change (this session)

> **Deployed 2026-08-13** by this session, per user request ("deploy it live"). `clasp push` found
> the Apps Script editor **already up to date** — the other session had already pushed `3b35939`'s
> content while cutting @55/v5.26 below — so this is a fresh deployment version pointing at
> identical code, not a new commit. Description: "v5.27: Customer 360 open-tickets sort + Center/Hub
> ID columns, Customers-by-state to-city switch." **Live-verified directly on production** (not just
> the local preview): Customer 360's header shows CENTERS/CENTER ID/HUB/HUB ID/CITY/STATE with real
> row data; "Customers by state" renders correctly (no single-state filter active); 0 console errors
> on Overview and Customers.
>
> **Correction to the v5.26 entry below**: `3b35939` is this session's OWN commit, not the other
> session's — it was written, sandbox-verified (geoCustomers grouping by State with 0/2+ states
> selected, by City with exactly 1: Karnataka → Bengaluru/Mysuru/Gulbarga/...; a standalone
> `sortRows`/tiebreak comparator test; the `geo` field confirmed unaffected), and live-checked by
> this session throughout. The "other session, NOT independently verified" note on it below was the
> *other* session's honest caveat about *their own* lack of visibility into it — appropriate for
> them to write, but shouldn't be read as "unverified" in an absolute sense.

### v5.26 / @55 (2026-08-13) — inline footer timestamp, corrected footer version, Customer 360 sort

> **Deployed 2026-08-13** from `3b35939`, tagged `v5.26`. Pre-deploy gate run (`npm run
> verify-before-deploy`): 69/69 unit tests pass; the reconciliation tier **skipped** as always —
> no `bigquery.jobs.create` on `tricogde-dwh` from this machine, so nothing in this deploy was
> checked against production data (see the v5.24 entry for why that gap has already bitten once).
> - **`1cd4418`** — corrected `CONFIG.APP_VERSION` 53 → 55 and reworded the field's contract; see
>   the ⚠️ in the header. Production had been advertising "version 53" while running @54.
> - **`0610d27`** — footer's "Updated HH:MM:SS" now sits inline after "Data refreshes every 5 min ·
>   read-only service account" rather than stacked beneath it (per user). The status strip's own
>   pulse-dot serves as the separator. Verified in both themes.
> - **`3b35939` — built by THIS session** (see the v5.27 entry above for the correction — the note
>   just below was written by the other session, about their own lack of visibility into it, not a
>   statement that the work is unverified): Customer 360 default sort by open tickets (tiebroken on
>   uptime so 0-ticket rows surface worst-uptime centers first), renamed/added ID columns, and the
>   Customers-by-state chart switching to city when a single state is filtered. This work was
>   uncommitted in the shared working tree while the deploy was being prepared — the deploy waited
>   for it to be committed
>   rather than `git stash`-ing files another session was actively editing.

### Deployed in v5.25 / @54 (recorded here because the deploy predates this write-up)

> **`4e560b0` — Center filter, Hub/Center id search, floating filter chips, real footer version
> (this session).** Four user-requested changes:
> - **Filter chips moved out of the topbar** into their own floating row beneath it. They had been
>   sharing the topbar's single line with search + Refresh + Filters + theme, so four active
>   filters wrapped the whole bar taller. Button and count badge stay up top; only the removable
>   chips moved. Same width/centering formula as `.topbar`/`.page`; the row collapses to nothing
>   when no filter is active.
> - **Hub search now matches HubName OR HubID.** The returned/stored value is still the hub NAME,
>   because that's the dimension `centerAttrCond_`/`centerPassesFilters_` compare — searching by id
>   is a lookup convenience, NOT a change to what gets filtered.
> - **New Center filter dimension** (`centers`), server-searched like Hub (~28k centers is far too
>   many for a static option list), matching name OR CenterID. **It stores the CenterID, not the
>   name** — center names are not unique in `center_details`, so a name-keyed filter would silently
>   match unrelated centers. `renderFilterCombo_` therefore now accepts `{value, label}` options as
>   well as plain strings, and labels are cached in `state.filterLabels` so a selected center still
>   reads "Demo Center 3 · #10274" after the drawer reopens and in the top chip row, not a bare id.
>   Threaded through `centerAttrCond_` (CAST CenterID to STRING), `centerPassesFilters_`
>   (`String()`-compared, so the SQL and JS paths can't disagree — the finding-I4 failure mode),
>   every endpoint filter object, and `Warm.js`'s default set.
>   **Known limitation:** the default (focus, <2 chars) list is the first 50 by CenterID — arbitrary
>   rather than "most relevant", unlike Hub's default which ranks by center count. Ranking centers
>   would need a device/ticket-count join the lookup deliberately avoids.
> - **Footer**: "Updated HH:MM:SS" moved out from under the topbar into the footer beside the other
>   provenance line (it's passive information, not something to act on), and the version string —
>   a `v1.0.0` placeholder that never moved across 24 releases — now reads "version 53 on
>   Aug 13, 2026, 8:30 PM" from `CONFIG.APP_VERSION`/`APP_DEPLOYED_AT`. See the ⚠️ in the header.
> - **Verified** in the local preview: chips below the topbar in both themes; hub search by name
>   ("mumbai" → 2) and id ("40003" → 1); center search by name ("Center 7") and id ("10274");
>   selection stores the id while showing the name; 0 console errors; 69/69 unit tests.

> **`e2b9cb6` — Filters drawer applied to Numbers + Raw Data (built by THIS session — correcting a
> prior "other session, not independently verified" note; same misattribution pattern as `3b35939`
> above, see the v5.27 entry).** Both pages were deliberately filter-exempt by design; per user
> request they now respect the global filter set like every other page. Numbers narrows
> Centers/Hubs via the same `centerAttrCond_` + deploymentdate chain, bridges Tickets to
> `center_details` via `centerFilterSubqueryCond_`, and its cache key is now filter-aware
> (`numbers_v8`, folding in `getCacheEpoch_` + `filterHash_`). Verified against the sandbox
> (State-filtered centers/tickets counts narrow correctly) and in the local preview, 0 console
> errors. **Note this contradicts older entries below** that describe Numbers/Raw Data as exempt
> from all filtering — those are now historical.

### v5.24 / @53 (2026-08-13) — HOTFIX: live PARSE_DATETIME type-mismatch crash on every zoho_data query

> **Built and deployed by THIS session** (commit `7bcf2a5`) — correcting a prior "other session, not
> independently verified" note; same cross-session misattribution pattern noted on `3b35939` and
> `e2b9cb6` above, all three actually built by whichever session is writing THIS particular
> revision of the file. Root-caused live, from the user pasting the exact production error back at
> this session mid-investigation. A production incident: Overview and the Center list — and
> transitively every zoho_data-touching query (Support KPIs/SLA/charts, Machine Uptime/MTBF, cohort
> reliability, ticket lists) — were failing live with `No matching signature for function
> PARSE_DATETIME (STRING, DATETIME)`.
>
> **Root cause is worth internalizing, because it invalidates an assumption this whole repo has
> been verifying against:** `zoho_data.CreatedAt`/`ClosedAt` are **native DATETIME** columns in
> production (`tricogde-dwh`), not the STRING format every
> `SAFE.PARSE_DATETIME(CONFIG.ZOHO_DT_FORMAT, …)` call assumed. That assumption only ever held for
> the **sandbox** (`magnaquest-sand-box`) — genuine physical schema drift between the two projects.
> Every session's verification, including several documented in this file as "verified against
> BigQuery", could only reach the sandbox (no `bigquery.jobs.create` on `tricogde-dwh`), so the
> assumption was never actually tested against what production runs. **Treat "verified on BigQuery"
> in older entries as "verified on the sandbox" unless it explicitly says otherwise.**

### v5.23 / @52 (2026-08-13) — exclude unassigned Zoho tickets; Centers "Open ticket centers" KPI; Asset Device Type/Status filters

> **Deployed 2026-08-13** — commit `97ca54d`, pushed to `origin/main`, then `clasp push` +
> `clasp deploy -i AKfycbwV6hHzDT1ZjkH49aFxVfoLF9wcFrBtv9FzrYzdd5RA9R3HAVOMcXrOgzwthI49KK7x -d
> "v5.23: exclude unassigned Zoho tickets, Centers Open-ticket-centers KPI, Asset Device Type/
> Status filters"` (this session; user's explicit go-ahead). Cut Apps Script **version 52**.
> Verified live via `curl -L` on the `/exec` URL → `200`. 69/69 unit tests pass. Three
> independent changes, bundled into one commit/deploy because they touch overlapping server
> files (`EditionCD.js`/`Numbers.js`/`Queries.js`/`Setup.js`):
> - **Unassigned Zoho tickets excluded globally.** `zohoDedupSql_()` (`Queries.js`) now also
>   drops rows with a blank `assignee` (Zoho agent field), on top of the existing duplicate-row
>   dedup — applies everywhere Zoho data is read except Raw Data's reconciliation view
>   (deliberately unchanged, shows the true Zoho export). Ticket universe **84,545 → 80,020**
>   (74 dupes + 4,061 unassigned removed). 8 cache keys bumped
>   (`ctr360cd`/`dashcd`/`mapcd`/`topcustcd`/`execcd`/`ctrdetcd`/`supportsearchcd`/`numbers`).
> - **Centers page "States" KPI tile → "Open ticket centers."** Now counts distinct centers with
>   ≥1 non-terminal Zoho ticket, via a `CenterID IN (...)` subquery added to the `centerKpis`
>   spec (`EditionCD.js`). Cross-checked against the sandbox: SQL result and an independent query
>   both return 463 centers unfiltered / 390 under `Status:Active`.
> - **Asset page gains two new global filter dimensions**, threaded through `jiraDeviceStats_` so
>   Overview/Numbers/Asset all respect them, plus the Asset donuts/cohort (computed from the same
>   filtered asset index):
>   - **Device Type** (`issuetype_name`) — normal include-filter, defaults to **Connector + ECG
>     Machine**.
>   - **Device Status in Jira** (`status_name`) — deliberately an **EXCLUDE**-filter (selected =
>     hidden, the opposite of every other filter in the drawer — has its own note in the UI),
>     defaults to **Decommissioned** only. Not modeled as an include-list of the other ~11 real
>     statuses: that would've meant 11 default chips cluttering the filter bar, and any *future*
>     new status would silently default to hidden until a hardcoded list was updated.
>   - Note: "Total devices" was **already** counting all asset types, not just ECG/Connector —
>     that scope was broadened in a past session (`CONFIG.JIRA_NON_DEVICE_TYPES` exclude-list).
>     Only the "Connector + ECG" sub-label was stale; the two new filters are what make that
>     scope genuinely adjustable rather than hardcoded.
>   - New `deviceTypeOptions`/`deviceStatusOptions` option lists (same pattern as
>     `cityOptions`/`countryOptions`) feed the two new drawer comboboxes.

### v5.22 / @51 (2026-08-13) — deploys the 2 releases below, both previously pushed but undeployed

> **Deployed 2026-08-13** — `clasp push` then `clasp deploy -i
> AKfycbwV6hHzDT1ZjkH49aFxVfoLF9wcFrBtv9FzrYzdd5RA9R3HAVOMcXrOgzwthI49KK7x -d "v5.22: City +
> Country global filters, KPI baseline/chart-label fixes, card-grid rebalance"` at git `main` =
> `f7630d3` (this session; user's explicit go-ahead, "deploy it to the live url"). Cut Apps Script
> **version 51**. Verified live via `curl -L` on the `/exec` URL → `200`. Stable deployment ID
> unchanged, per this project's standing convention. The two releases immediately below
> (`f8e8b0d`, `d3c429b`) were sitting committed-and-pushed-but-not-live as of the previous entry —
> **both are now live for the first time**; everything they describe was accurate only for git
> until this deploy.

> **2026-08-13 — `f8e8b0d` · Frontend alignment/spacing pass (this session).** Ran
> `frontend-design` + the `ui-ux-pro-max` checklists as a QA pass over the existing glassmorphism
> identity — deliberately NOT a redesign, since v5.17/v5.18 already committed to a visual
> direction. Every fix below was measured in a real browser, not eyeballed:
> - **KPI rows had no shared baseline (the main bug).** `.kpi` was a plain block, so each tile's
>   value sat wherever its label happened to end — and labels wrap to 1 or 2 lines depending on
>   length. Measured on the wide 6-column Overview strip: `Centers` (1-line label) rendered its
>   value **20px higher** than every 2-line neighbour. Fixed by making `.kpi` a flex column and
>   bottom-anchoring the value+sub block via `margin-top:auto`, which holds regardless of wrap.
>   Re-measured: **0px spread per row at 6, 4 and 3 columns.**
> - **`horizontalBar` clipped its value labels** — `4,979` rendered as `4,97`. `containLabel`
>   reserves room for *axis* labels only, not the series labels these bars draw past their own
>   end, so the longest bar (by definition at the axis max) overflowed. `right: 28 → 44`, matching
>   `rankBar` which already reserved enough.
> - **`zohoTrend` clipped its last x-axis label** — `2026-08` rendered as `2026-0`, because
>   `boundaryGap:false` centres the final label on the chart's right edge.
> - **`.exec-hero` was a near-empty container** — it holds only the 140px device-age ring since
>   the narrative band was removed, and full-width that left ~800px of dead space either side. Now
>   `width: fit-content`.
>
> **Known remaining, NOT fixed:** Overview has 7 KPI tiles in a 6-column grid, so `SLA BREACH`
> sits alone on row 2. Fixing it means dropping/merging/adding a KPI — a product decision, left
> for the user. Also: mobile was never verified (`resize_window` does not work in this
> environment), so the 560px/820px breakpoints are untested by this pass.

> **2026-08-13 — `d3c429b` · City + Country global filters, bundled with 2 layout fixes.** Bundled
> because the two efforts interleave in the same files and `git add` cannot split a file; the user
> explicitly chose bundling over waiting.
> - **City + Country filter dimensions — built by the OTHER session, not this one.** Verified
>   working before committing but **not reviewed line by line.** Threads two new dimensions
>   through the full filter chain: `centerAttrCond_` (`City` / `Spoke_Country`), the
>   `centerPassesFilters_` JS predicate, new `cityOptions`/`countryOptions` specs, every `*CD`
>   endpoint's filter object, and `Warm.js`'s default set (so cache warming still matches a real
>   first load — the finding-I6 trap). Client gains state fields, sticky option lists, chips,
>   drawer sections and combos. Runtime check: drawer opens with all 7 sections, both combos
>   populate, picking a city commits it (badge 1→2, removable `City: Bengaluru` chip), 0 console
>   errors. **The global filter is now 6 dimensions + date range, not 4** — update any mental model
>   that still says Segment/Status/State/Hub.
> - **Card-grid rows packed ragged (this session).** Top Customers' three peer "per customer"
>   charts were `span-6`, packing 2 + 1 with half a row empty; Asset's five `span-4` cards packed
>   3 + 2, leaving a third of a row empty. Now `span-4`×3 and a `span-6` pair. All 10 panels pack
>   to full 12-column rows, verified programmatically.
> - **Center-uptime KPI sub shortened** (`N% of centers ≥ 99%` → `N% at ≥ 99%`): it wrapped to two
>   lines at the narrowest tile and broke the row baseline even after the flex fix above.
>   **Constraint worth keeping: KPI sub copy must fit ONE line at 6-column tile width.**

### Deployed releases not previously written up here

> **v5.21 / @50 (2026-08-12 or later) — dedupe duplicate `zoho_data` rows; add TOM page shell.
> Built and deployed by the OTHER session; summarized from commit `a694b9d`, not independently
> verified.** Root-caused a user report of 3 identical ticket rows (#105435) in the center-detail
> drawer: the Zoho→BigQuery sync writes some tickets more than once (37+ confirmed duplicated in
> the sandbox), so **every** `COUNT(*)`/row-list query reading `zoho_data` directly was inflated —
> not just the drawer. Adds `zohoDedupSql_()` (`Queries.js`), a `QUALIFY ROW_NUMBER()` dedup keyed
> on `ticketNumber` that parses the string `CreatedAt` properly rather than sorting it
> lexicographically, with a NULL-safe partition fallback. Swapped in at all 18 real `zoho_data`
> call sites across `Queries.js`/`EditionCD.js`/`Numbers.js`/`TopCustomers.js`. **Raw Data is
> deliberately left un-deduped** — its documented job is reconciliation against Zoho's true row
> count, duplicates included. 8 cache keys bumped. Also **reverted the v5.19 Support/CS split**
> (below) and added a **TOM page shell**. No git tag was cut.

> **v5.20 / @49 (2026-08-12) — Map page Centers KPI undercounted vs every other page.** Tagged
> `v5.20`, commit `be8b0d1`. `apiGetMapDataCD` drops any center without a geocoded location from
> `payload.centers` (necessary — `MapView.setData` plots every row unconditionally and can't take
> a null lat/lng), but `renderMapKpis` summed that same geocoded-only array, so ungeocoded centers
> were excluded from the **total**, not just from the map. The server already shipped the missing
> count (`unlocatedCenters`) every load; nothing read it. Fix adds it back into the Centers tile
> whenever no local narrowing (ticket-bucket legend / search) is active; with narrowing active the
> KPI still counts only what's plotted, which is correct for "what's shown on this map".

> **v5.19 / @48 — split Support/CS into Support/CS (Non-Tech) + a new Service (Tech) page. Built
> by the OTHER session, and SUBSEQUENTLY REVERTED in v5.21.** Recorded only so the commit
> (`91985b4`) isn't mistaken for live behaviour. The Service tab that exists today is an
> empty-state shell awaiting its own non-Zoho data source. No git tag was cut.

### Earlier releases (git and production were in sync from here down)

> **2026-08-10 — Floating page panel, topbar logo, filter drawer restructure (commit `0fac5dd`,
> tagged `v5.18`, DEPLOYED as Apps Script version 47).** Per user request, using `ui-ux-pro-max`
> for both the build and a follow-up review pass:
> - **Floating page panel**: each page's content (KPI grid + cards) now sits inside one floating
>   glass panel, same width/alignment formula as the topbar (`width: min(100% - gutter, 1440px);
>   margin: auto`) so both line up regardless of viewport width. Inner `.kpi`/`.card` tiles dropped
>   their own `backdrop-filter` — redundant once nested inside an already-frosted panel, and it was
>   costing a blur pass per tile for no visible gain; they're flat `--surface-2` tiles now.
> - **Topbar logo**: the same Tricog heart+pulse mark now also sits in the topbar (left of search),
>   so the brand stays visible even with the sidebar collapsed.
> - **Filters drawer**: Status moved to the top and became a toggle (Active-only vs all statuses —
>   the only two real values) instead of a 2-item checklist; Segment converted to a searchable
>   multi-select dropdown, matching State/Hub instead of being the odd one out as a plain checklist.
> - **Search placeholder copy**: Customers tab said "Search centers by..." (stale — the tab was
>   renamed from Centers in v5.16); Numbers/Raw Data showed "This page shows unfiltered raw data"
>   in the search box, which reads as a non-sequitur rather than explaining why search is disabled.
>   Both now say "Search isn't available on this page" / "Search customers by...".
> - **Mid-build edit conflict**: while implementing, the on-disk files changed twice from a
>   concurrent source — once a legitimate, self-contained removal of the Overview/Asset executive-
>   summary narrative bands (CSS comment there literally says "per user", consistent with earlier
>   sessions retiring the same feature on the Centers page), left untouched; once a direct revert of
>   the Status toggle back to a dropdown, with a comment implying the toggle itself was the thing
>   being replaced. Flagged this to the user rather than resolve it silently — user confirmed to
>   keep the toggle, which was restored across `Index.html`/`App.html`.
> - **3 bugs found and fixed live during the review pass** (none from this session's own new code —
>   all latent, exposed by the width/nesting changes above):
>   1. Sidebar-collapse's resize dispatch fired before `.app-main`'s width transition finished, so
>      ECharts measured a mid-transition container width and never got corrected afterward. Fixed
>      by also firing `resize` on `transitionend` (`margin-left` specifically).
>   2. The new toggle switch's off-state track was `--surface-2`/`--border`, both near-white in
>      light theme — invisible against the filter drawer's opaque white `--surface-solid`
>      background. Recolored with a `color-mix(in srgb, var(--text-3) ...)` fill, which is a real
>      solid color in both themes regardless of what surface it sits on.
>   3. `.num-card` (Numbers page) carries both `card` and `num-card` classes, and silently inherited
>      `grid-column: span 12` from the shared `.card` rule — meant for the unrelated 12-column
>      `.card-grid` system. Inside `.num-grid`'s 3-column layout this collapsed all 4 cards into one
>      overlapping stack and overflowed the page horizontally. Fixed with `grid-column: auto` +
>      `min-width: 0` at each nesting level (`.num-card`/`.num-compare`/`.num-tables`).
> - **Verification**: live-tested in the local preview via browser automation — 0 console errors
>   and 0 horizontal overflow across all 8 tabs, both themes, sidebar collapsed/expanded.

> **2026-08-04 — Glassmorphism redesign: left sidebar nav + real Tricog logo (commits `d9f4ed5`,
> `9b7a74e`, tagged `v5.17`, DEPLOYED as Apps Script version 46).** Full visual redesign per user
> request, using `ui-ux-pro-max` design guidance; two clarifying design decisions confirmed with
> the user up front: **Tricog red-based glass** (not the reference screenshot's purple, since the
> real brand is red/black) and **icon + label, collapsible sidebar** (not icon-only, for
> discoverability of non-obvious tab names like "Numbers"/"Raw Data").
> - **Top tabs → left sidebar**: `Index.html`'s single horizontal `<nav role="tablist">` restructured
>   into `.app-shell > aside.sidebar + div.app-main` (topbar + page content). All 8 tab buttons kept
>   their exact `id`/`role="tab"`/`aria-selected`/`aria-controls`/`tabindex` — only the wrapping
>   markup and orientation changed (`aria-orientation="vertical"`) — each now shows a hand-authored
>   24×24 stroke icon plus its label. `App.html`'s `wireTabs()` keydown handler now primarily
>   answers `ArrowUp`/`ArrowDown` (kept `ArrowLeft`/`ArrowRight` too) to match the vertical layout.
> - **Collapsible, persisted**: new `applySidebarCollapsed()` in `App.html`, mirroring the existing
>   `applyTheme()` persistence pattern (`localStorage['sip.sidebarCollapsed']`), wired to a new
>   `#sidebarCollapseBtn`; toggling fires a `resize` event so ECharts/Leaflet re-size correctly.
>   Below 1180px the sidebar auto-collapses unconditionally (a plain CSS override, not JS-driven —
>   there's no room for a manual toggle at that width).
> - **Glassmorphism**: `Styles.html` tokens reworked — translucent `--surface`/`--surface-2`,
>   `backdrop-filter: blur(22px) saturate(160%)` on KPI/cards, an inset `--glass-highlight` sheen,
>   brighter background blobs to blur into. Done for both themes independently (light theme's glass
>   is a separate, lighter token set, not just dark-theme values with opacity flipped).
> - **Real Tricog logo, corrected mid-session**: first pass embedded the user-supplied PNG directly
>   as a data URI, but the user flagged it as inaccurate against the live brand and pointed at
>   `tricog.com` as the reference. Re-fetched the actual current brand assets straight from
>   Tricog's own CDN (`tricog.com/wp-content/uploads/...`) instead of trusting the earlier
>   attachment: the full navbar lockup is white-text-only (baked-in "Accelerating Cardiac Care"
>   tagline, meant for their dark navbar) with no light-background variant, but their favicon asset
>   is a clean icon-only heart+pulse mark that works on any background. Given a choice, the user
>   picked **icon mark + our own "SIP Insights / Service Insights Platform" text** over trying to
>   recolor/reuse the full lockup — avoids duplicating Tricog's own tagline next to ours. Icon
>   cropped to its tight bounding box via Pillow (72KB reconstruction → 13.8KB authentic asset);
>   `.sidebar-logo` CSS simplified since the old crop-to-corner-for-collapsed trick is no longer
>   needed (the asset is already a compact mark, same size shown in both states).
> - **Verification**: live-tested in the local preview via browser automation — logo renders
>   correctly in dark/light/collapsed states, collapse toggle persists across reload, all 8 tabs
>   verified via both click and `ArrowUp`/`ArrowDown` keyboard nav, 0 console errors on Overview/
>   Numbers/Customers. One gap: the sandboxed test browser's viewport was pinned at 1280×495 and
>   would not resize, so the ≤1180px auto-collapse breakpoint was code-reviewed (matches the
>   existing 820px/560px breakpoint pattern already shipping elsewhere in the file) but not
>   click-tested live.

> **2026-08-04 — Customers page rework (commit `e818958`, tagged `v5.16`, DEPLOYED as Apps
> Script version 45).** Five changes, all per user request:
> - **Tab renamed** "Centers / Customers" → "Customers" (`Index.html`; internal id/hash
>   unchanged — `tab-centers`/`#centers` stay as-is, only the visible label changed).
> - **Deployment age bucketing now matches Device age exactly**: `<1y/1-2y/2-3y/3-5y/5y+`
>   (was day-threshold bands `<3mo/3-6mo/6-12mo/1-2yr/2+yr`) — `EditionCD.js`'s `deploymentAge`
>   spec + `Charts.html`'s `AGE_ORDER`, so the two age distributions are now directly comparable.
> - **Segment variants merged into one canonical name, GLOBALLY** (explicit user scope
>   decision — confirmed "everywhere segment appears," not just one chart): "Private - SME" →
>   **SME**; every "LE - Cath Lab"/"LE - Diagnostic Chain"/"LE - Large Hospital" variant → **LE**;
>   Government/ECHO/Project pass through unchanged. One new shared `segmentGroupSql_()`
>   (`Queries.js`) is the single definition, applied to: `centerAttrCond_` (the filter-condition
>   builder — so selecting "SME" in the Filters drawer matches every raw variant),
>   `centerBaseSpecCD_` (Center-360/JS filter predicate), `segmentOptions` (the Filters drawer's
>   own checklist — now offers the merged names, not the raw ones), `activeVsEnded` ("Centers by
>   segment" chart), `Numbers.js`'s `centersSegment`/`hubsSegment`, `Queries.js`'s `zohoSegment`
>   (Support/CS "Tickets by customer segment"), and the center-detail drawer's segment display.
>   Fixed 4 existing unit tests that asserted the pre-merge SQL shape; added a dedicated test
>   block for `segmentGroupSql_` itself, pinned against the real current segment values.
> - **"Top hubs" chart removed** from the Centers page — card markup, `Charts.hubs()` render
>   function, and the now-dead server query spec are all deleted (not left as unused dead code).
> - **Center-detail drawer pagination**: the Jira-devices table and both ticket tabs (Open/All)
>   are now client-side paginated, 5 per page, Prev/Next shown only when a list has >5 items.
>   Rebuilt the drawer's render flow around one `activeTix` + per-list `listPage` state re-rendered
>   through a single path (`renderInto`), so tab-switch clicks and pager clicks can't drift out of
>   sync — this also keeps the Support/CS ticket-number search's "jump to the right page and
>   highlight the ticket" behavior (`focusTicket_`) correct through the new pagination.
> - **Verification**: 69/69 unit tests pass (was 62 — added `segmentGroupSql_` coverage); full
>   live click-through in the rebuilt local preview (tab label, both age charts, segment chart +
>   Filters drawer checklist showing merged names, Top hubs absent, all 3 drawer pagers tested
>   including cross-page ticket highlighting), 0 console errors.

> **2026-08-04 — Centers 360 / Reliability & Health merge, all 6 tasks, DEPLOYED as v5.14/@43.**
> Built task-by-task per `docs/superpowers/plans/2026-07-30-centers-360-reliability-merge.md`
> (spec: the sibling `-design.md` in `docs/superpowers/specs/`), each task committed and verified
> live before the next started:
> 1. **Server** (`6260e57`): `getCenter360RowsCD_` gains `mtbf_hrs`/`failures` (same CTE the old
>    watchlist used — a projection change, not a formula change); `apiGetDashboardCD` drops the
>    now-unused `assetHealth` spec from its query list (`reliability` stays — Overview's separate
>    endpoint depends on it); cache keys bumped `ctr360cd_v6→v7`, `dashcd_v6→v7`.
> 2. **Client, additive** (`7bfc610`, `2993d82`): retired the Centers-page executive summary and
>    "Center Health" KPI tile (both explicitly out of the original spec's scope — an in-session
>    scope addition, confirmed with the user first); added MTBF/Failures as two new Center 360
>    columns, watchlist left in place for a side-by-side comparison.
> 3. **Manual live cross-check (human checkpoint)** — user confirmed the new Center 360
>    MTBF/Failures values matched the watchlist's exactly, clearing the projection change.
> 4. **Client, destructive** (`9f51347`): deleted the "Reliability & Health" card and
>    `renderCenterWatchlist` entirely; removed Online/Last-heartbeat from Center 360 (14 final
>    columns). **Found and flagged before committing**: the design spec's justification for
>    dropping Online ("still shown in the center-detail drawer") doesn't hold —
>    `renderInto`/`makeCenterDetail` has no Online stat; only the separate hub-level customer
>    drawer does. Per-center online-device count is no longer visible anywhere in the UI (still
>    computed server-side, still visible in aggregate via Map/hub rollups). **User decision:
>    ship anyway** — the drawer gap wasn't worth blocking on.
> 5. **CSS only** (`948f64e`): sticky `#centerTable` first column — verified in both themes via
>    browser automation (computed `background-color` switches from dark navy to white on toggle,
>    clean edge shadow, no bleed-through, hover/click highlight applies to the pinned cell too).
> 6. **Final regression pass** — 62/62 unit tests, full live checklist (exact 14 columns, no
>    watchlist anywhere in the DOM, pagination/search/4-column sort spot-check, sticky column both
>    themes, 0 console errors).
> - **Deploy, isolated from concurrent work**: at deploy time the working tree also had unrelated,
>   not-yet-committed work in progress (the search/ticket-lookup fixes below) sitting in the same
>   files (`App.html`/`Styles.html`/`EditionCD.js`). Rather than ship both together, `git stash -u`
>   → clean tree exactly matched the committed merge → `npm test` → `clasp push` → confirmed the
>   stable deployment ID was still pinned at @42/v5.13 → `clasp deploy` → **@43, tagged v5.14** →
>   `git stash pop` to restore the concurrent work untouched. User explicitly chose this isolated
>   path over deploying everything together.
> - **Still open**: the Online-in-drawer gap above (accepted, not fixed); Task 6 itself performed
>   no new live-BQ check (correctly — nothing after Task 3 touched the MTBF/Failures calculation).

> **2026-08-04 — fixed dead global search on non-list tabs, added Support/CS ticket-number
> lookup (commit `9657431`, deployed as Apps Script version 44, tagged `v5.15`).** Directly
> resolves finding #1 of the 2026-07-31 review below (global search silently doing nothing on 5 of 8 tabs).
> `SEARCH_TAB_INFO` (`App.html`) now disables the search box with an explanatory placeholder on
> Overview/Numbers/Raw Data (no per-row list to filter); Top Customers' leaderboard is now
> actually filtered by the search box (was previously wired but never applied) with a "no
> matches" empty state. Support/CS has no per-row list either, so its box is repurposed as a
> lookup fired on Enter: tries the query as a CenterID, then a Zoho ticket number (new
> `apiSupportSearchCD` endpoint, `EditionCD.js`), opens the existing center-detail drawer either
> way — switching its ticket list to "All" and highlighting the matched ticket
> (`focusTicket_`) when opened via a ticket number. Toasts on no match instead of failing
> silently. New live-BigQuery reconciliation test (`test/reconcile/support-search.test.js`)
> verifies both lookup SQL shapes against real data (IDs discovered live, never hardcoded, per
> this repo's established reconciliation-test convention).

> **2026-07-31 review — full codebase + live first-time-user UX audit (no code changes, no
> deploy).** Requested as a senior-frontend-style gap/optimization pass across server, client and
> GitHub state. Method: 2 parallel code-review passes over `src/server/*.js` and `src/client/*.html`
> + a live click-through of the local mock preview via browser automation, acting as a genuine
> first-time visitor (search, filters, drawer, keyboard-only nav, light/dark theme). Full report
> delivered to the user in-session; the load-bearing, non-obvious findings are kept here (and as
> new items in Section 6) so they survive to the next session. Top 5, ranked:
> 1. **Global search is a false affordance on 5 of 8 tabs.** `reloadActiveList()`
>    (`App.html:2646-2651`) only wires `tab-asset`/`tab-centers`/`tab-map`; on Overview/Support/
>    Top Customers/Numbers/Raw Data, typing in the always-visible search box does nothing — no
>    error, no explanation. **Live-confirmed** (typed on Overview and Support/CS, zero effect;
>    typed on Centers, list re-fetched).
> 2. **Zero onboarding.** The only "what is this app" explanation is a tooltip behind the 16px ⓘ
>    next to the header tagline (`App.html:2385`) — good copy, effectively undiscoverable to a
>    first-time visitor who has no reason to click a tiny dot next to the logo.
> 3. **Drawers have no focus trap/restore** (`#filterDrawer`, `#centerDrawer`, both
>    `aria-modal="true"`, no `.focus()` management anywhere in `App.html` besides tab arrow-nav).
>    **Live-reproduced**: Tab-ing inside an open Center-detail drawer walks keyboard focus straight
>    into the dimmed background page and pops an unrelated chart tooltip open behind the drawer.
>    (Partially known already — the 2026-07-29 fix-wave notes below already parked "filter drawer
>    has `aria-modal` but no real focus trap" as a non-blocking gap; this confirms it's still true
>    AND that the same gap exists on the center-detail drawer, not just the filter drawer.)
> 4. **~900 lines of confirmed dead backend code.** `ep()` (`App.html:73`) always appends `CD`, so
>    the client never calls the non-CD `Api.js`/`ExecOverview.js`/`TopCustomers.js` functions —
>    verified by grep, not inferred (no call site reaches `apiGetCenters`/`apiGetTopCustomers`/
>    `apiGetExecOverview` without going through `ep()`). Section 3's file map already flags
>    `Api.js` as "retained but unused"; this confirms the same is true of the full `ExecOverview.js`
>    and most of `TopCustomers.js`, not just `Api.js`.
> 5. **Auth fails open** (`Auth.js:74-85`) — already a known open item since v5.9 (see that section
>    below: `AUTHORIZED_EMAILS` still unset); reconfirmed still true today and still untested.
>
> Also found, not yet actioned: contradictory KPI numbers on Overview (executive-summary
> "11,331 devices" vs. the "Total Devices" KPI tile's "28,444" — two real, different metrics with
> no on-screen distinction between "cloud-connected" and "total Jira fleet"); the Centers-tab KPI
> strip showing "28,482 all centers" while Overview's KPI shows "18,370" under the identical
> "Status: Active" filter chip (unconfirmed whether this is a new bug or the same class of SQL-vs-
> JS filter-path disagreement the 2026-07-29 fix wave already fixed once for Hub/State — needs
> its own repro); the uptime/MTBF/health CTE still computed 3× per dashboard load (open since v5.9,
> §6 below, still true); `RawData.js`'s full-table `SELECT *, COUNT(*) OVER()` scans; zero unit
> tests for `Auth.js`/`BigQuery.js`/the SQL-builder functions; `Charts.html` hardcoding
> `'Fira Sans'` against the rest of the app's Lato; local `main` sitting 3 commits ahead of
> `origin/main`, unpushed, at review time. **Not done this session** (explicitly a review, not an
> implementation pass) — see Section 6, items 12-16, for the resulting action items.

**v5.13 (2026-07-30, deployed @42):** widened the Jira device-type filter + audited the other
3 live BigQuery sources for similar gaps.
- **Devices count 29,624 → 45,404.** The filter had been an include-list of exactly 2 Jira Issue
  Types (`Connector`, `ECG Machine`) — `CONFIG.JIRA_DEVICE_TYPES` — silently excluding 12 other
  real device/asset categories present in `jira_data`: SIM Card (11,017), UPS (2,453), Printer
  (546), TriCare Assets (405), BP Machine (379), Tab (305), Mobile (237), IV Trolley (218),
  Laptop (152), ECHO MACHINE (30), ECG Device (20), WiFi Dongle (18). Flipped to an exclude-list
  of the 3 actual non-device housekeeping types (`CONFIG.JIRA_NON_DEVICE_TYPES: ['task','epic',
  'test']`, 39 rows total) — every other Issue Type now counts as a device. Changed:
  `Config.js`, `Numbers.js` (`isTrackedJiraDeviceType_`), `Api.js` (`getAssetIndex_`), `Setup.js`
  diagnostics log text, `App.html` METRIC_INFO tooltips, `docs/SOURCES.md`/`docs/ARCHITECTURE.md`,
  and rewrote `test/unit/jira-device-type.test.js` for the new exclude-list semantics (62/62
  tests pass, was 61).
- **Other-sources audit** (`center_details`, `cloud_devices`, `zoho_data`): all 4 BQ tables
  (including `jira_data`) show a table-metadata reload within the same ~13s window on
  2026-07-30 — one daily ETL run touches all of them; `cloud_devices`' most recent heartbeat is
  even more current same-day. `cloud_devices`' 7,246 NULL-`LastTimeStamp` rows (63% of 11,555)
  are correctly bucketed as "Never seen" by `FLEET_BUCKET_SQL` — checked, not a bug. Found one
  more classification gap of the same shape: **"Vcardia Issue" (640 Zoho tickets) is classified
  Non-Tech** by the `SLA_CATALOG`/`TECH_FALLBACK_REGEX` fallback (the regex doesn't match
  "vcardia", unhyphenated, even though V-Cardia is a Tricog device line with 5 hyphenated
  catalog entries) — feeds into the SLA Tech/Non-Tech split and the Machine Uptime downtime
  calc (`techBoolSql_`). **User decision: leave as-is, not fixed.**
- Also fixed 2 stale references found during the audit: a `diagnostics()` log line still
  claimed `center_details` excludes F2P centers (that baseline was removed 2026-07-22, see the
  v5.10 entry below); `EditionCD.js`'s `FLAGS_CD` metadata (returned in the API response, not
  actually rendered client-side) still described Jira as Sheet-sourced (removed in the v5.10/
  jira_data-migration work below).
- Deployed to the stable deployment ID as Apps Script **version 42**, tagged `v5.13`. Committed
  as `3c8e493` — **not yet pushed to `origin/main`** (3 commits ahead locally as of this entry).

**v5.12 (2026-07-30, deployed @41):** 2 UI fixes recovered from the live Apps Script editor —
made directly in the editor in an earlier session (never in git), discovered via a `clasp pull`
and preserved rather than overwritten by a later `clasp push`. Expanded `.info-dot`'s tap target
to the accessibility-minimum 44px via a `::before` overlay (doesn't grow the visible dot) with
the focus ring restored; fixed the Jira-status donut legend color adjacency (`STATUS_PALETTE`
had `ok`/`teal` — both green/turquoise — as neighbors; reordered) and the Numbers-tab compact
tables overflowing their grid track (`.num-table`/`.data-table { min-width: 0; }`). Verified via
`clasp pull` + diff (byte-identical to git HEAD before this fix) and `npm test` (61/61 at the
time). Committed as `5f99e34`.

> **2026-07-29 global nav + universal filter (built via Subagent-Driven Development, all 13
> tasks + preview verification + final whole-branch-review fix wave complete — DEPLOYED to
> production as Apps Script version 40, tagged `v5.11`):**
> - **Nav reorder**: Overview is now the first tab (was after Top Customers); the other 7 tabs
>   keep their prior relative order.
> - **Universal filter**: one global selection (Segment · Status · State · Hub, all multi-select,
>   plus a Date range) replaces the old per-page Segment `<select>`s on Asset/Centers/Support. A
>   single "Filters" button in the topbar opens a drawer; a badge shows the active-filter count
>   and individually-removable chips show exactly what's applied. **Status defaults to `['ACTIVE']`**
>   on load (visible as a chip, not hidden). Date range is page-interpreted: Centers/Map →
>   deployment date, Support → Zoho ticket created date, Asset → Jira created date; Top
>   Customers/Overview get Segment/Status/State/Hub only (no date — an explicit, documented
>   exemption); Numbers/Raw Data are exempt from every dimension (unchanged, diagnostic pages).
> - **⚠️ EXPECTED VISIBLE NUMBER CHANGE — read this before reporting a regression.** Because
>   Status defaults to `ACTIVE`, every center-grain figure now shows the ACTIVE-ONLY universe on
>   first load: **27,410 centers unfiltered → 18,370 with the default filter** (sandbox
>   measurement, 2026-07-29; the ~9,038 DEACTIVATED + 2 OFFBOARDED/blank centers are excluded
>   until the user unticks Active). This is a **drop**, and it moves in the OPPOSITE direction
>   from the "**19,143 → 28,482**" *increase* quoted in the 2026-07-28 deploy note immediately
>   below — those two numbers are unrelated and do not contradict each other: the v5.10 entry
>   describes *removing* a hardcoded Active+Paid baseline (which raised the count), whereas this
>   entry describes *adding back* a user-visible, user-removable Active default (which lowers it
>   again, but only as a filter the user can see in the chip row and clear at will).
> - **Architecture deviation from the original design spec (documented, not silent)**:
>   `getCenter360RowsCD_()` fetches the FULL unfiltered center universe once (a single global
>   cache entry) and every page (Map/Top Customers/Overview/Centers-table) filters that one
>   cached array via a shared JS predicate (`centerFilterMap_`/`centerPassesFilters_`), instead of
>   the design spec's assumed SQL-threaded, per-filter-set cache. The codebase had already moved
>   to this simpler pattern before this feature started; the implementation plan was written to
>   match the real code rather than force the spec's outdated assumption.
> - **Cache-epoch mechanism**: `getCacheEpoch_()` (a Script Properties counter) is now folded
>   into every dashboard/map/exec/top-customers/device cache key
>   (`<name>_v6_<epoch>_<filterHash>_...`) — `clearDashboardCache()` just bumps the epoch instead
>   of enumerating segment values via a live BigQuery query (the old approach didn't scale to a
>   5-dimension filter).
> - **Brand tagline fixed**: "Service Insight Platform" → "Service Insights Platform" (2 spots:
>   header + footer). **New info icon** next to the tagline opens the existing metric-tooltip
>   popover mechanism with a static "about the product" entry.
> - **2 real gaps found and fixed during the Task 12 preview-verification pass** (neither caught
>   by any of the 11 prior task reviews): (1) the new info icon's button had no `data-metric`
>   attribute and no `METRIC_INFO` entry, so it was dead — clicking did nothing; (2) the State/Hub
>   filter comboboxes read their option list from a `data-options` DOM attribute nothing ever
>   populated (only ever written back as `'[]'`), so they were permanently empty and
>   unsearchable — fixed by adding `stateOptions`/`hubOptions` BigQuery specs (analogous to the
>   existing `segmentOptions`) and reading them from `state.lastDashboard`, matching the
>   established `segmentOptions` pattern. **Both halves of that fix were superseded on
>   2026-07-29** by the final-review fix wave below: the `hubOptions` spec is gone entirely (Hub
>   is now server-side-searched) and the option lists are read from sticky `state.*` fields
>   instead of `state.lastDashboard`.
> - **Final whole-branch-review fix wave (2026-07-29, after all 13 tasks passed their own
>   per-task reviews).** A review of the complete branch found 1 critical + 7 important
>   cross-task integration issues that no single task's narrow review could see. All fixed in
>   this wave:
>   - **C1 — Hub/State option lists were silently truncated.** `State` was capped at
>     `maxRows: 200` against **451** real values (list cut off mid-alphabet, dropping
>     Maharashtra/Tamil Nadu/UP); raised to 1000. `Hub` is far worse — **13,721** distinct
>     `HubName` values, where the alphabetically-first 500 are punctuation-heavy junk, so no
>     static cap can work. Per user decision, **Hub is now a server-side search** rather than a
>     shipped list: the `hubOptions` spec was deleted and a new `apiSearchHubsCD` endpoint
>     answers per keystroke (client debounces ~275ms). Empty/1-char query returns the **top 50
>     hubs by center count** (what the combobox shows on focus); 2+ chars returns up to 50 name
>     matches. Same checkbox-multi-select UI and same removable-chip behaviour as State, so the
>     two controls still look and behave identically. Input is `segClean_`'d then `likeEscape_`'d
>     (new helper — `%`/`_` are LIKE wildcards) and passed as a **named query parameter**, never
>     concatenated.
>   - **I2 + I3 — stale numbers after a filter change, and empty drawer option lists.** Same
>     root cause: `commitGlobalFilters_` set `state.lastDashboard = null`, which permanently
>     disarmed `activateTab`'s refetch guard (`state.lastDashboard && !filtersEqual_(...)`) on the
>     4 tabs that never repopulate that payload (Map/Top Customers/Numbers/Raw Data) — so
>     filtering from one of those and tabbing back to Asset/Centers/Support showed **stale
>     pre-filter numbers** until the 300s auto-refresh. Now it clears `state.dashFilters` instead
>     (guard stays armed, mismatch guaranteed). The two paginated tables had no invalidation path
>     at all; they now record the filter set their rows were fetched under
>     (`state.centerFilters`/`state.deviceFilters`) and `activateTab` refetches + resets to page 0
>     on a mismatch. Drawer option lists moved to **sticky** `state.segmentOptions`/
>     `state.stateOptions`, captured by `renderDashboard` and never cleared.
>   - **I4 + I8 — the SQL and JS filter paths could silently disagree.** Filtering happens two
>     ways by design (see the architecture-deviation note above): `multiCond_` SQL fragments, and
>     the `centerPassesFilters_` JS predicate over the cached Center-360 array. `multiCond_`
>     emitted a bare `column IN (...)` while the JS path compared TRIM'd values — and **2,806
>     sandbox rows carry a whitespace-padded `HubName`**, so the same filter could return
>     different counts per path. `multiCond_` now emits `TRIM(IFNULL(col,'')) IN (...)`, and
>     `centerBase`'s SELECT now TRIMs `State`/`HubName` (it already TRIMmed segment/status). The
>     4-condition chain that had been duplicated verbatim at **4** call sites is now one shared
>     `centerAttrCond_(filters)` helper, so a normalization change can't land in only 3 of 4.
>   - **I5 — Top Customers mixed filtered and unfiltered numbers in one tile.**
>     `topCustomerTicketStats_()` took no filters, so `ticket_count`/`sla_breach` were unfiltered
>     headline numbers sitting above a filtered sub-label. It now takes `filters` and threads
>     `centerFilterSubqueryCond_`. (Judgment call: the global **date** range is deliberately still
>     not applied there — its companion number `open_tickets` is date-unaware too, so adding it to
>     only one would re-create the same mixed-scope tile in a new way. Documented in the function.)
>   - **I6 — the cache-warming trigger warmed keys no client would ever request.** `Warm.js`
>     called the 4 filter-aware endpoints with no filters, hashing under `filterHash_({})`, but
>     every real first load hashes `{statuses:['ACTIVE']}` — so warming did nothing for those 4
>     caches and every first load paid the ~40s cold cost. `Warm.js` now passes the client's
>     default explicitly via a new `warmDefaultFilters_()`; that function and App.html's
>     `state.globalFilters` initializer each carry a comment pointing at the other (server `.js`
>     and client `.html` can't share a constant in Apps Script).
>   - Also fixed, found by the fix wave's own preview pass: closing the drawer **while a Hub
>     search was in flight** threw a `TypeError` (the late callback painted against the
>     already-cleared staged state). Late results are now dropped.
>   - **Parked, logged, NOT fixed** (non-load-bearing, from the same review): Status option list
>     is hardcoded to ACTIVE/DEACTIVATED so it misses the 2 OFFBOARDED/blank centers;
>     `renderFilterCombo_` leaks a `document` click listener per drawer open; `apiGetDevices`'s
>     cache key doesn't fold in the epoch (pre-existing); filter-value sanitization is uneven
>     across endpoints (only reachable by hand-crafted calls); dead code (`segSlug_`/`cdSegCond_`/
>     `fillSelect`) still present; the filter drawer has `aria-modal` but no real focus trap
>     (pre-existing pattern, shared with the center drawer); `apiGetExecOverviewCD` still uses
>     `withCache`'s 100KB path for a >1MB payload (pre-existing at `execcd_v5`).
> - **Verification** (updated 2026-07-29 after the fix wave): `npm test` **61/61** unit tests pass
>   (was 49 — the wave added `centerAttrCond_`, `likeEscape_`, Hub-search-SQL and
>   TRIM-normalization coverage, and updated the tests that asserted the old un-TRIMmed SQL
>   shape). `npm run test:reconcile` **16/16** live reconciliation tests pass against the
>   **`magnaquest-sand-box.abi_team_sip_devtest_poc`**
>   sandbox project (the only BigQuery project the local
>   `credentials/abi_team_sip_bq_access_service_account.json` key can access — it does NOT have
>   `bigquery.jobs.create` on `tricogde-dwh`; use `QA_BQ_PROJECT_OVERRIDE=magnaquest-sand-box
>   QA_BQ_DATASET_OVERRIDE=magnaquest-sand-box.abi_team_sip_devtest_poc` to point the harness at
>   it, per `test/helpers/bq.js`'s override mechanism — the app's real `Config.js` still points
>   at `tricogde-dwh` and that is NOT changed by this work). The 2 new reconciliation tests are
>   the permanent guard for I4: they run the SQL path and the JS `centerPassesFilters_` predicate
>   over the same universe and assert identical center counts — once for `Status:['ACTIVE']`, and
>   once for a deliberately **whitespace-padded** `HubName` (asserting `> 0`, since an untrimmed
>   comparison on either side makes a padded hub select nothing at all and would otherwise satisfy
>   equality vacuously).
> - **Preview verification — CORRECTED 2026-07-29.** The original Task-12 pass claimed "drawer
>   open/apply/chip-remove/reopen-state all verified correct", but that pass only exercised tabs
>   that **share the dashboard payload**, which is exactly where bugs I2/I3 do not show. On the
>   other 4 tabs (Map/Top Customers/Numbers/Raw Data) the reopened drawer showed **empty**
>   Segment/State lists after any filter change, and tabbing back to Asset/Centers/Support showed
>   stale numbers — so that claim was wrong for 4 of 8 tabs when it was written. The fix wave
>   fixed both and **re-verified directly** in the local preview (mock-data mode, fresh build):
>   drawer opened on **all 8 tabs** after applying a filter → Segment 7 / State 7 / Hub 12 options
>   present on every one; applying a filter from Map and from Top Customers then tabbing into
>   Centers/Asset visibly refetched all three of the shared dashboard payload, the Center-360 table
>   and the device table (confirmed by the mock's per-call randomized values changing); Hub
>   combobox showed its default set on focus and narrowed to the correct 2 matches while typing,
>   with the debounce verified as suppressing intermediate lookups during rapid typing; select →
>   Apply → chip → chip-remove round-trip updated badge (1→2→1) and chips correctly; **0 console
>   errors** across the whole sequence. Mobile-viewport (375×812) still could not be live-exercised
>   in this session's browser-automation environment (a tooling limitation, not an app issue) —
>   verified instead via static review of `Styles.html`'s 820px/560px responsive rules.
> - **`clasp push --force` done and verified twice**: once at the end of Task 13, and again after
>   the final-review fix wave landed — both times re-pulled into a scratch dir and diffed against
>   `src/`, byte-for-byte identical. The editor matched git HEAD exactly (commit `19830d5` at push
>   time; `043311b` current, a docs-only commit that doesn't touch `src/`).
>   **Deployed to production 2026-07-29 with the user's explicit go-ahead**: `clasp deploy -i
>   AKfycbwV6hHzDT1ZjkH49aFxVfoLF9wcFrBtv9FzrYzdd5RA9R3HAVOMcXrOgzwthI49KK7x -d "v5.11: ..."` cut
>   Apps Script **version 40** and pointed the stable deployment at it. Tagged `v5.11` (annotated,
>   pushed to origin).
> - Plan: `docs/superpowers/plans/2026-07-28-global-nav-and-universal-filter.md` (13 tasks, all
>   complete). Spec: `docs/superpowers/specs/2026-07-28-global-nav-and-universal-filter-design.md`.
> - **Still open**: nothing for this feature — fully shipped. Separately, the
>   `BQ_SERVICE_ACCOUNT_KEY` GitHub secret for CI's reconciliation tier is still missing
>   (pre-existing open item, unrelated to this feature — see item 11 in section 6 below).

> **2026-07-28 deploy note:** this single deploy promotes EVERYTHING that had accumulated since
> v5.9 (@34) in one shot — the connection layer swap to the real `tricogde-dwh.abi_tables`
> warehouse, removal of the Active+Paid center filter (visible center count **19,143 → 28,482**),
> the `centers-tab-kpi-rebuild` Centers KPI grid rebuild (9 reviewed commits), and 2 small
> cleanup fixes. Explicitly confirmed with the user before deploying (this reverses an earlier
> "leave v5.10 pending" decision from earlier the same day — a deliberate reversal, not an
> accident).
>
> **Cache staleness window:** cache keys were NOT bumped for the dataset swap
> (`dashcd_v5_...` etc. are unchanged; `CACHE_TTL_SECONDS` = 900). Any request cached in the
> ~15 minutes before this deploy may still serve OLD sandbox-filtered numbers (19,143 centers)
> for up to 15 minutes post-deploy — self-healing, not permanent, but if you check the live
> site right away and see old numbers, that's why. Run `clearDashboardCache()` in the Apps
> Script editor for an immediate clean cutover (could not be run remotely — `clasp run` isn't
> configured as an API-executable for this project).
>
> A Jest test harness was also added this session (repo-only, never deployed — see
> `docs/superpowers/specs/2026-07-28-testing-harness-design.md`) — `npm test` (36 unit tests)
> and `npm run test:reconcile` (11 live-BigQuery structural-invariant tests). CI's
> reconciliation tier still needs a `BQ_SERVICE_ACCOUNT_KEY` GitHub secret added (for the
> `tricogde-dwh` project specifically) before it runs anything beyond a no-op.

**v5.10 (2026-07-22):** connection-layer migration off the dev/test sandbox onto the real
production warehouse, plus removal of a filter that had silently scoped every center-grain
figure since v5.8. Built from spec
`docs/superpowers/specs/2026-07-22-tricogde-dwh-migration-design.md` and plan
`docs/superpowers/plans/2026-07-22-connection-layer-swap.md` (task 1 of 5; 4 commits
`89e37c0..facd82c`, cut as Apps Script **version 37**, tagged `v5.10`). **Production has NOT
been redeployed** — see below.

- **Dataset swap**: `Config.js` now points at `tricogde-dwh.abi_tables` (was
  `magnaquest-sand-box.abi_team_sip_devtest_poc`) — 3 lines changed (`BQ_PROJECT_ID`,
  `BQ_DATASET`, `SA_PROPERTY_KEY`). `Auth.js`'s OAuth2 service renamed `'BigQuery-SA'` →
  `'BigQuery-DWH-SA'` deliberately, to avoid a stale-token-reuse bug now that a different
  service account backs the new project. Old `SA_KEY` Script Property (sandbox access) is
  untouched/dormant — rollback is just reverting these 2 files, no credential
  re-provisioning needed.
- **Verified live, not assumed**: all 6 tables (`center_details`, `cloud_devices`,
  `device_center_mapping`, `device_metrics`, `jira_data`, `zoho_data`) confirmed present in
  `tricogde-dwh` with byte-identical column schema to the old dataset, via a temporary
  diagnostic script run before cutting over. New warehouse is genuinely live/growing (higher
  row counts than the old frozen snapshot; "created this week" ticket KPIs are now non-zero,
  where the old dataset always read 0 for any time-relative figure).
- **Baseline filter removed**: the "Active + Paid" filter (`Status='ACTIVE' AND
  F2P_Customer=0`), silently applied to every center query since v5.8 (2026-07-10), is gone —
  `cdFilter_()`/`CD_SEG_FILTER` in `EditionCD.js` neutralized to return `'1=1'` rather than
  deleted, so every existing `"WHERE " + cdFilter_()` call site (including `Geo.js`'s
  `distinctLocations_`) stays syntactically valid without a call-site rewrite. Center count:
  **19,143 (filtered) → 28,482 (true universe)**. "Active · Paid centers" UI chip now reads
  "All centers"; fixed 4 stale tooltip/label references (`App.html` `METRIC_INFO`,
  `Index.html` Numbers-page copy) that still described the removed filter. Segment dropdown +
  global search are UNCHANGED this release — full filter-system removal (segment/search/
  status-chip UI) is a separate, not-yet-done follow-up.
- **Verification performed**: `node --check` on every changed file; live round-trip through
  the actual production code path (re-ran the existing `diagServiceAccountEmail`/
  `diagCenterCounts` diagnostics after the `Config.js` change, not just the isolated
  migration-testing credential); clicked through Overview, Centers/Customers, Map, Top
  Customers on the `@HEAD` test deployment
  (`AKfycbyUlvvXqJo0f6z5LdqeSfarj9JnbvmnrcJf70Ciw0o`) — 0 console errors, correct new numbers
  on every tab checked.
- **PRODUCTION NOT REDEPLOYED**: the stable deployment
  (`AKfycbwV6hHzDT1ZjkH49aFxVfoLF9wcFrBtv9FzrYzdd5RA9R3HAVOMcXrOgzwthI49KK7x`) is still pinned
  to an old version, still serving the OLD `magnaquest-sand-box` data under the OLD filter —
  real users see none of this yet. Redeploying to version 37 (Deploy → Manage deployments →
  edit → Version 37 → Deploy) is a manual step for the user, same convention as prior
  releases.
- **Version-number gap**: Apps Script versions 35 ("v1.34") and 36 ("V1") were created by the
  user directly in the editor mid-session, unrelated to this work — noted so a future reader
  isn't confused by 34 → 37 skipping 35/36.
- **Still open**: full filter-system removal (Segment dropdown, global search, status chips)
  — remaining scope from the design doc, not started; native BigQuery asset/device pipeline
  (design doc §6, replacing the Sheet/JIRA_DUMP devices source) — designed, not implemented;
  temporary `server/Diag.js` (new `diagNewDwh`/`diagJiraDataDetail`/
  `setupDwhServiceAccountKey`/`diagServiceAccountEmail` probes) still live on the script,
  excluded from git by design — remove from the editor once no longer needed.

**v5.9 (2026-07-11 → 2026-07-16):** security review + KPI-mismatch investigation + data-load
performance pass. Done in an interactive session (code review → live BigQuery verification via
a temporary `server/Diag.js` → fixes), pushed straight to the live script with `clasp push` as
each fix landed — **this branch is the first time these changes reach git**, ported from the
live `clasp clone` snapshot into `src/`. No spec/plan doc precedes this entry (retrospective).
Since then: redeployed to production as version 34 on 2026-07-16, and the branch was merged to
`main` and tagged `v5.9` — see the release-convention note below.

- **Server-side authorization guard** (`assertAuthorized_()` in `Auth.js`, enforced in
  `Api.js` `respond_()` and `WebApp.js` `doGet()`): previously `access: DOMAIN` +
  `executeAs: USER_DEPLOYING` meant any tricog.com account could read the full fleet/
  customer/ticket data through the deployer's BigQuery access, and every global function
  was reachable via `google.script.run`. Allowlist is the `AUTHORIZED_EMAILS` Script
  Property (comma-separated emails) — **fail-open until set** (logs a warning) so this
  change alone can't lock anyone out. Set the property to actually enforce it.
- **XSS fixes**: Leaflet map tooltip (`MapView.html`) rendered the center name as raw HTML
  via `bindTooltip` — added a local `esc()` escaper. `relTime()` in `App.html`'s device/
  center tables returned the raw server string on unparseable dates and was inserted into
  `<td>` content unescaped — wrapped in `escapeHtml`.
- **Subresource Integrity**: real `sha384-` hashes + `crossorigin` added to all 6 CDN
  assets (echarts, Leaflet, markercluster JS+CSS) in `Index.html` — previously loaded
  with no integrity check.
- **Segment-refresh race fixed**: `loadDashboard` used a `state.loading` drop-on-busy
  guard; a segment change mid-flight was silently dropped, leaving the KPIs/charts on the
  old segment. Replaced with the same latest-wins `requestId` pattern already used by
  `loadDevices`/`loadCenters`.
- **`active_deployments` KPI bug**: `centerKpis` counted `COUNTIF(deactivationdate IS
  NULL)` over `center_details`' duplicated rows (row-grain) instead of `CenterID`
  (center-grain) — live value was **25,648, exceeding the 18,370-center universe**
  (~140%). Fixed to `COUNT(DISTINCT IF(deactivationdate IS NULL, CenterID, NULL))`.
- **Data-load performance** (uncached `apiGetDashboardCD` measured ~40s):
  - BigQuery result page size now matches each query's `maxRows` (was hardcoded 1,000)
    — `buildQueryPayload_`/`fetchResultsPage_`/`collectRows_` in `BigQuery.js`. The
    ~27k-row center dimension went from ~28 **sequential** pageToken fetches (~8–12s) to
    1–2; bearer token reused across pages instead of refetched per page.
  - **Fixed a correctness bug this surfaced**: the per-center uptime query inside
    `getCenter360RowsCD_` had no `maxRows`, so it silently capped at 1,000 of ~18k
    centers — uptime/lifecycle/downtime columns were blank for all but the first 1,000
    centers in the Centers table. Same latent cap in `Numbers.js` `deviceCenterMap_`
    (harmless today since it reads from the Sheets fallback path, but will bite once
    Sheets access is restored).
  - New `server/Warm.js`: `warmCaches()` + `installWarmTrigger()` (10-min time trigger,
    **run once manually from the editor** — needs a new `script.scriptapp` OAuth scope,
    added to `appsscript.json`) pre-warms the dashboard/exec/map/top-customers/numbers
    caches so users never hit a cold ~40s load. `CACHE_TTL_SECONDS` 300 → 900 and the
    Center-360/map large-object cache TTLs 600 → 1800, both intentionally longer than
    the 10-min warm interval so a warmed value never expires before the next warm pass.
  - Client: auto-refresh (`tickCountdown`, every 5 min) no longer passes `bypassCache` —
    it was forcing the full recompute on a timer that matched the server TTL, buying zero
    freshness at ~40s of cost per client per cycle. Only the manual Refresh button still
    bypasses. "Silent refresh" — recurring loads no longer blank all 19 charts to
    skeletons; only the first load (nothing rendered yet) shows loading state.
  - Negative caching for Google Sheets reads (`fetchSheetValues_` in `SheetSource.js`):
    the Sheets API is currently **disabled** in the GCP project, so `readCsTracker`/
    `readJiraSheet` were burning 1–4s of guaranteed-403 calls on every cold dashboard/
    exec load; failures are now remembered for 10 minutes and skipped.
- **Still open** (see `docs/SOURCES.md`/inline TODOs for detail): **`AUTHORIZED_EMAILS`
  Script Property is still UNSET, so the auth guard remains fail-open**; **`installWarmTrigger()`
  has NOT yet been run** (warm caching is inactive — first run will prompt re-authorization
  for the new `script.scriptapp` scope); enable the Google Sheets API in GCP project
  `218180702013` (CS tracker returns null, Jira devices source falls back to the static
  `JIRA_DUMP` snapshot until then); switch `CONFIG.CS_SHEET_ID` to the new field-cases sheet
  `1X33LBKEJx1HNp289TPK750KUnEOBTHYWa-Xdfiejsxg`; consolidate the 4x-per-load uptime CTE
  into one query; merge the Reliability watchlist + Center health score tables (requested,
  not started); merge the exec payload into the dashboard payload (currently duplicates ~8
  of the same BigQuery specs under a separate cache key).
- A temporary `server/Diag.js` (read-only BigQuery/Sheets probes used to verify the KPI
  mismatch and dataset inventory) was pushed to the **live** script during
  investigation and is **not** included in this branch — **still on the live script as of
  2026-07-17** (kept out of git deliberately) — remove it from the live project next time
  it's opened in the editor.

**Release convention (from v5.9 onward):** each release = `clasp push` → `clasp version
"<desc>"` (cuts a new Apps Script version) → redeploy the production deployment to point at
that version → merge the working branch to `main` → annotated git tag `vX.Y` naming the
Apps Script version number it corresponds to.

**v5.8 (2026-07-10, deployed @33):** page-level filters + 13 KPI corrections, built via
subagent-driven development from spec `docs/superpowers/specs/2026-07-10-page-filters-and-kpi-corrections-design.md`
and plan `docs/superpowers/plans/2026-07-10-page-filters-and-kpi-corrections.md`
(9 commits `3e9c049..c53293e`, every task independently reviewed + a final whole-branch
review; every SQL verified live on BQ; full preview pass 0 console errors).

- **FIXED BASELINE, all pages**: every `center_details` read is now permanently scoped to
  `IFNULL(F2P_Customer,0)=0 AND Status='ACTIVE'` (`cdFilter_()`, zero-arg). The topbar
  "Active only" toggle is GONE — the rule shows as a static "Active · Paid centers" chip
  in each page's filter bar. Live: scored/centers universe **27,410 → 18,370**.
  (F2P half still dormant — flag is all-0 until DE populates it.)
- **PER-PAGE SEGMENT FILTER**: topbar Hub dropdown + Segment select REMOVED; Asset,
  Centers and Support/CS each have a filter bar with their own Segment dropdown
  (`assetSegment`/`centersSegment`/`supportSegment`, per-page state
  `state.pageSegment`). Threads server-side through ALL grains: center_details +
  zoho_data (`hub_master_segment = literal`), cloud_devices (`CenterID IN` baseline
  subquery — includes the device explorer table), Jira-sheet JS metrics (center→segment
  map; unmapped devices drop out when a segment is selected). CS-tracker cards are
  exempt (no segment lineage; noted on the page). Shared dashboard payload is fetched
  with the ACTIVE page's segment; tab switch refetches on mismatch
  (`dashSegmentFor`/`state.dashSegment`). Segment values must go to the server
  VERBATIM (server `segClean_` strips quotes but does NOT trim).
- **Page ownership corrected**: Asset is now pure device-grain — Center uptime/health
  KPI tiles + Reliability watchlist + health-score table MOVED to Centers ("Asset
  health score" retitled **"Center health score"**). Asset strip: Total devices ·
  Avg device age · Past 5-yr life · Poor signal · Unsynced ECGs. Centers strip (6):
  Centers · Center uptime · Center health · Active placements · States · Cities
  ("Devices mapped" tile deleted — it was a duplicate center count).
- **Corrections shipped**: geo chart deduped (`COUNT(DISTINCT CenterID)`, card now
  "Centers by state"; Overview geo card relabelled too); `avg_open_age_days` recomputed
  from `NOW − CreatedAt` (was trusting `TicketActiveDays`; live value now ~668d);
  Top-hubs aria-label fixed; segment donut got a deliberate `SEGMENT_COLORS` palette;
  FTF cohort labelled "center-grain proxy"; all Support/CS cards state their window
  (`· last 90 days` / `· all-time` / `· last 12 months`); stale tooltips fixed
  (Jira = Sheet, not jira_data BQ; center_details, not device_center_mapping).
- **Dead code deleted** (grep-gated): legacy `apiGetDashboard` (non-CD), `assets` +
  `cohortReliability` + `hubOptions` spec entries, `cohortReliabilitySql_`,
  `buildAssetSourceSpecs`, `jiraTypeFilterSql_`, client `renderHubOptions`.
- **Caches**: `dashcd_v5_<segslug>_<hubhash>`, `jiradev_v5_<segslug>`, `ctr360cd_v5`,
  `mapcd_v5`, `topcustcd_v5`, `execcd_v5`, `numbers_v4`; all `_a` active-suffix variants
  gone; `clearDashboardCache()` enumerates segment slices via a live segment query.
  Post-deploy cache clear NOT required — v5 keys are new names, so stale v4 entries
  are never read.
- **Verified per-segment on live BQ**: `Private - SME` 10,743 centers / Government
  4,xxx; segment sum + blank == 18,370; Government devices 2,643 vs 11,331 unfiltered;
  exact segment strings (with spaces): `Private - SME`, `Government`, `LE - Cath Lab`,
  `LE - Diagnostic Chain`, `ECHO`, `LE - Large Hospital`, `Project`.
- **Open items**: SLA catalog entries for uncatalogued categories (needs CS input —
  they silently default to 5 days, now disclosed in the tooltip); device-grain
  uptime/health still deferred; Overview/Map/TopCustomers/Numbers have no filter bar
  (Overview alignment = future pass); `segSlug_` would collide if two segment names
  slugify identically (safe with current 7 values). LIVE SMOKE TEST PASSED (user,
  2026-07-10): Private - SME on Centers → 10,743 centers, matching the BQ-verified
  figure exactly.

**v5.7 (2026-07-08, deployed @31):** dropped "Fleet" terminology app-wide; rebuilt the
Asset and Centers pages **page by page, metric by metric** with the user (each formula
confirmed before coding, each change verified live on BigQuery + in preview before commit).

- **Terminology**: "Fleet uptime/health" was always center-grain — relabeled **Center
  uptime / Center health** everywhere (KPI tiles, tooltips, card titles). "Total fleet" →
  **Total devices**. No new metric was introduced by the rename.
- **Tab order**: Overview moved after Top Customers (still lands first); Asset moved
  after Support/CS. Full order: Centers · Support · Asset · Map · Top Customers ·
  Overview · Numbers · Raw Data.
- **Asset page redefined** — Center uptime/health MOVED to Centers (see below); Asset's
  own executive summary is now **average device age**: today − Jira `Created`, Connector +
  ECG only. Live: avg **3.9 years**, **8,105 of 28,444 (28%)** past the 5-year expected
  life. New **"Device age" bar chart** (age bands, 5y+ bar highlighted red). Poor
  signal / Unsynced ECG KPI tiles removed (deferred, not required). **Device
  uptime/health is explicitly DEFERRED** — no per-device downtime source exists yet;
  do not build it without a fresh formula confirmation.
- **Centers page rebuilt**:
  - New executive summary: center uptime + **lifecycle** (today − `deploymentdate`) +
    **downtime** (merged technical-ticket hours, days) + % healthy. Live: **27,370**
    scored centers, avg lifecycle **3.74y**, avg downtime **7.37d**, avg uptime **99.68%**.
  - **Segment source = `hub_master_segment`** everywhere (topbar dropdown, Numbers page,
    Center-360, "Deployment status" donut → repurposed to a segment breakdown). Replaces
    `Spoke_Center_Segment`'s 3-spelling mess.
  - **Deployment-age fixed**: was active-only rows (18,460) vs total centers (27,410) —
    didn't add up. Now counts ALL centers with a `deploymentdate` (27,370, matches).
  - **Top hubs** re-ranked by **spoke count** (`COUNT DISTINCT CenterID`) — the old spec
    read `cloud_devices` online/offline, unrelated to a hub ranking.
  - **Center-360 table**: +5 sortable columns — Jira devices, Lifecycle, Downtime,
    Uptime, Tickets (total) — computed from the same `centerUptimeSqlCD_` "scored" engine
    as the North-Star KPI (verified live, no LIMIT so every scored center gets a row).
  - **Drawer**: ticket list now has an **Open/All toggle** (defaults to Open) — new
    `allTickets` query (up to 50, any status, newest first) + `ticketRowsHtml_` helper.
- Cache keys bumped: `jiradev_v4`, `ctr360cd_v4`, `ctrdetcd_v2_*`/`ctrdet_v2_*` (drawer).
  `clearDashboardCache()` synced.
- All new SQL verified live on BigQuery before commit; client verified in local preview
  (0 console errors across Asset, Centers, drawer toggle).

**v5.6 (2026-07-08, deployed @25):** Jira is now sourced **solely from the Google Sheet**;
the `jira_data` BQ table is **ignored app-wide** (still exists, just unused). Everything Jira
stays restricted to **Connector + ECG Machine** at page level. Changes:
- **`deviceCenterMap_` precedence flipped** (per user): match a device's Summary-serial to
  **cloud_devices.DeviceID first**, then **center_details DeviceID/MacSerialID** as fallback
  for devices not in cloud_devices. Old code early-returned on center_details alone and never
  unioned cloud_devices → serial coverage **11,330 → 27,373**, mapped devices **~9,888 →
  ~17,323** across **12,028** centers (validated vs live BQ + the real Sheet).
- **`getAssetIndex_` rewritten to read the Sheet** (`readJiraSheet`), Connector+ECG only,
  dedupe by Key. Field map per user: Summary = Device ID/serial, Issue Type = device type,
  Status = device status, age = today − Created, center via `deviceCenterMap_`. Same output
  shape (+`status`) → map overlay / drawer / top-customers / exec unchanged.
- **Asset status/type donut + batch cohort (M-A3/M-A5) now computed in JS** from the Sheet
  asset index (`assetsDonutFromIndex_`, `cohortFromIndex_`) + a Zoho-by-center failure
  aggregate. The two `jira_data` BQ specs are dropped from `buildDashboardQuerySpecsCD`.
  Cohort batch = YEAR of Created (approx — flat Sheet has no changelog; user accepted).
- **Raw Data page**: removed the "Jira Issues (legacy BQ)" pill → 5 sources
  (center_details, cloud_devices, zoho_data, jira_sheet, cs_tracker).
- Cache bumped: `assets_v3`, `dashcd_v4`/`mapcd_v4`/`topcustcd_v4`/`execcd_v4`.
- **Devices/Fleet count** is now confirmed = count of ALL Jira-Sheet devices filtered to
  Connector + ECG Machine (~28,444: 18,030 ECG + 10,414 Connector).

**v5.5 (2026-07-08, deployed @24):** removed **device_metrics** as a user-facing Raw
Data source (dropped from `rawSources_` in RawData.js, the source pill in Index.html,
and the preview mock in App.html). `device_metrics` had no other usage in the app — only
a doc-comment mention in Queries.js. The BQ table still exists. Raw Data page now exposes
6 sources: Center Details, Cloud Devices, Zoho Tickets, Jira Issues (legacy BQ), Jira
Devices (Sheet), CS Tracker (Sheet). Same treatment as device_center_mapping in v5.3.
NOTE: device_metrics was reloaded down to 191 rows on 2026-07-07 (was near-empty), which
is why it was pulled from the raw viewer.

**v5.4 (2026-07-08, deployed @23):** geocoding + F2P + segment-filter fixes.
- **Geocoding fixed + active-first**: `distinctLocations_()` (Geo.js) was still
  reading `device_center_mapping` — the WRONG source, since the map plots
  `center_details` centers. Now reads `center_details` (`PinCode`/`City`/`State`/
  `Spoke_Country`), and orders **ACTIVE centers first** (`MAX(IF(Status='ACTIVE',1,0))
  DESC`) so the geocode quota (resets ~every 14h) is spent on active centers before
  deactivated ones. 10,665 distinct locations, 7,879 serve an active center. Centers
  awaiting a geocode simply don't plot until located (`coordsForCD_` → null).
  ⚠️ **Run `runGeocodeBatch()` in the editor** (repeat each ~14h until
  `geoStats().pending = 0`), then `clearDashboardCache()`.
- **F2P filter simplified** to `IFNULL(F2P_Customer,0)=0` only (dropped the dead
  legacy `'F2P_CENTER'` segment guard — that value is 0 rows). All rows are
  `F2P_Customer=0` today → nothing excluded yet; activates when DE sets the flag.
- **Segment filter fixed + dynamic**: a center's `segment` now comes from its own
  `center_details.Spoke_Center_Segment` (was the Zoho-ticket segment, so centers
  with no tickets were wrongly dropped by any segment selection). Topbar dropdown
  is populated from a new `segmentOptions` spec (distinct real segment values).
  All centers kept as-is (no normalization / no blank-segment exclusion).
  **Superseded in v5.7**: segment source switched again, from `Spoke_Center_Segment`
  to `hub_master_segment` (cleaner values, no spelling variants) — see the v5.7 note.
- Cache keys bumped for the changed CD payload shape: `dashcd_v3` / `ctr360cd_v3` /
  `mapcd_v3` / `topcustcd_v3` / `execcd_v3` (clearDashboardCache synced).
- **Deliberately NOT changed**: `Age_In_Months` — verified it matches neither
  `deploymentdate` (0%) nor `AcquiredDate` (6%); semantics unclear, so the
  deployment-age chart stays on `deploymentdate`.
- **Duplicate-row precision** (corrects the v5.3 "exact duplicates" note): 35,804
  rows → 27,778 distinct full rows → 27,410 distinct centers. So 8,026 are exact
  full-row dupes AND 368 centers have genuinely-different multiple rows. `SELECT
  DISTINCT` + `COUNT(DISTINCT centerid)` handle both. Ask DE why any dupes exist.

**v5.3 hotfix (2026-07-08, deployed @22):** the DE team reloaded `center_details`
on 2026-07-07 (35,804 rows / 27,410 distinct centers, 114-col schema) which REMOVED
`pin`/`Country`/`latitude`/`longitude`/`HubStatus`/`HubSegment` and broke the
`centerBase` query → centers vanished from Centers/Map/Top Customers/Overview. Fixed:
- `centerBase` + drawer: `PinCode AS pin`, `Spoke_Country AS country`, `NULL` coords
  (pin-geocode store is now the ONLY coordinate source), `SELECT DISTINCT` (reload
  introduced exact duplicate rows).
- Numbers hubs: `Status` / `hub_master_segment` replace the removed hub columns.
- `CD_SEG_FILTER`: excludes on the new `F2P_Customer` flag ('F2P_CENTER' segment
  value no longer exists; flag is all-0 today so nothing is excluded).
- **Jira type filter extended to legacy BQ paths** (assets lifecycle spec, jiraAssets
  index → map overlay/drawer, cohort) via `jiraTypeFilterSql_()` — assets everywhere
  are now Connector + ECG Machine only (10,231 = 5,728 ECG + 4,503 Connector).
- **Raw Data page: device_center_mapping source removed** (7 sources now; the BQ
  table still exists and Geo.js still reads it internally for geocoding).
- Cache keys bumped: dashcd_v2 / ctr360cd_v2 / mapcd_v2 / topcustcd_v2 / execcd_v2 /
  numbers_v3 / assets_v2 / dash_v7.
- NEW: reload added `DeviceID`/`MacSerialID`/`MachineType` to center_details →
  `deviceCenterMap_()` auto-activates its center_details path (better serial→center
  coverage; `center_source: 'center_details'` in Numbers).

**v5.2 (2026-07-08, deployed @21):** Raw Data tab (all-source raw tables + CSV export) ·
permanent Jira device-type filter (Sheet path) · Overview "Fleet status (Jira)" donut ·
`swap` keyword in TECH_FALLBACK_REGEX · extended `diagnostics()`.

Read this first when resuming. It captures what the project is, where it's deployed,
how to change/deploy it, the non-obvious data facts, the current feature set, and the
open items. Deeper detail lives in `docs/` and `design-system/`. The full version-by-version
changelog lives in the project memory (`~/.claude/projects/.../memory/demo-sip-project.md`),
kept in sync with this file.

---

## 1. What this is

**SIP Insights** — a Tricog-branded, interactive analytics **web app built on Google
Apps Script + BigQuery** (HtmlService frontend, `google.script.run` bridge). It surfaces
insights from the `magnaquest-sand-box.abi_team_sip_devtest_poc` BigQuery dataset, a
**Jira devices Google Sheet**, and a **CS-tracker Google Sheet**, for Tricog's device
fleet / service operations.

**Eight views (tabs), Overview is the landing page:**
1. **Overview** — executive rollup: narrative hero band, avg-device-age ring, KPI strip, **Device status (Jira)** lifecycle donut, ticket-flow, "centers needing attention" + "reliability watchlist" tables, top-customer + geo charts. (Tab order note: Overview sits after Top Customers in the bar, but is still the landing page.)
2. **Asset** (device-focused; tab sits after Support/CS) — device-age executive summary + **"Device age" chart**, device-status donut, firmware, Jira asset lifecycle/types, **asset health-score table (M-A6)**, **failure-analysis cohort (M-A3/M-A5)**, device explorer (search/sort/paginate/CSV). Center uptime/health moved to Centers (below); Device uptime/health is a deferred redefinition — no per-device downtime source yet.
3. **Centers / Customers** (center-focused) — executive summary (center uptime/lifecycle/downtime/health), geo, deployment age (fixed to count all centers), segment breakdown (`hub_master_segment`), top hubs (by spoke count), **Center 360** table (+Jira devices/Lifecycle/Downtime/Uptime/Tickets columns, clickable rows → drawer with Open/All ticket toggle).
4. **Support / CS** — Zoho KPIs, ticket flow, **SLA-compliance suite (within% + Tech/Non-Tech + breach-by-type)**, backlog, categories, priority, channel, segment; CS-sheet TAT/machines/issue-types/owners.
5. **Map** — Leaflet map of all located centers, clustered, colored by open tickets, clickable legend ticket-bucket filter, click a marker → center drawer.
6. **Top Customers** — curated 27 "Top LE" hubs: KPIs, map, ranked bars, leaderboard (clickable → customer drawer).
7. **Numbers** — source-reconciliation / raw counts: KPI cards + **raw `center_details` table** (paginated, Devices + Mapped columns), devices from the Jira sheet.
8. **Raw Data** — every underlying data source (6 BQ tables + 2 Sheets) as a paginated, unfiltered table with pill-selector and full-table CSV export. **No site filters apply** (no F2P exclusion, no Active toggle, no hub/segment/search).

**Cross-cutting UI:** global top-bar search + hub + segment filters (apply to every page);
**"Active centers" toggle** (top bar → `Status='ACTIVE'` on all center_details queries);
light/dark theme toggle (persisted); one shared **center-detail drawer** opened by map markers,
Center-360 rows, reliability rows, exec attention rows, and customer rows — showing center KPIs,
open-ticket links to Zoho Desk, and a **Jira-devices table** (serial-mapped, KEY → Jira browse link);
**metric-explanation tooltips** — a ⓘ next to every KPI tile and card title opens a popover with the
metric's code, formula and data source (catalog `METRIC_INFO` + `setupMetricInfo()` in `App.html`);
flowing entrance/hover animations (motion tokens, reduced-motion guarded); auto-refresh every 5 min.

---

## 2. Where it's deployed + how to change it

- **Source Code Repository:** Hosted on GitHub at [sunilmorries-pixel/SIP](https://github.com/sunilmorries-pixel/SIP).
- **Apps Script project:** name **`sip`**, scriptId **`1AH4QA5XQf4bw0mQCOVL8KXXgBzfd_LXR8EhT5Bzt1KtRqf6ufUrwwOeG`**
  (the other project "demo-sip" is an old mock — ignore it). `.clasp.json` points here, `rootDir: src`.
- **clasp is installed and logged in.** Deploy flow:
  1. Edit files under `src/`.
  2. `cd` to repo, run **`clasp push --force`** (exit code 255 is a harmless clasp stderr quirk — check it lists the pushed files).
  3. In the Apps Script editor: **hard-refresh the tab first** (`Ctrl+Shift+R`), then **Deploy → Manage deployments → ✏️ edit → Version: New version → Deploy**. Web-app URL stays stable.
- ⚠️ **Stale-editor-tab gotcha:** an open editor tab caches its file list; if it saves after a push it can DELETE files it didn't know about. Always hard-refresh the editor tab after `clasp push`. (This bit us once — Geo.js + MapView.html vanished.)
- **Apps Script runs files ALPHABETICALLY** → never reference another file's globals in a top-level statement; wrap in lazy functions (e.g. `bqEndpoint_()`, `nowIstSql_()`).
- **HTML partials must keep their own `<script>…</script>` wrapper** — a missing closing tag makes the next include parse as JS (bit us once with MapView.html).

### Local preview (mock data, no Apps Script)
`powershell -File scripts/build_preview.ps1` → assembles `src/client/*` into one HTML with
mock data (mock kicks in when `google.script` is undefined) and serves on http://localhost:8765/preview.html.
The client mocks live in `App.html` mockCall(). Use a `?v=N` cache-buster when reloading a rebuilt
preview. Read client files with `-Encoding UTF8` in PS 5.1 or you get mojibake.

### Local BigQuery verification (SQL before wiring)
Scratchpad pattern: a node script `eval`s `SlaCatalog.js` + `Queries.js` + `EditionCD.js`, emits the
generated SQL to a `.sql` file, then `bq query --use_legacy_sql=false < file.sql` (stdin avoids the
PowerShell backtick-escaping collision). Auth via
`export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE=<repo>/credentials/abi_team_sip_bq_access_service_account.json`.

---

## 3. File map

**Server (`src/server/*.js` → deploy as `.gs`):**
- `Config.js` — env constants (project, dataset, cache TTL, IST offset=330, `JIRA_SHEET_ID`, `CS_SHEET_ID`, `SLA_DEFAULT_DAYS=5`, `TECH_FALLBACK_REGEX` (includes `swap`), `JIRA_DEVICE_TYPES`, terminal Zoho statuses, Zoho date format).
- `Auth.js` — service-account OAuth for BigQuery (OAuth2 lib, key in Script Properties `SA_KEY`).
- `BigQuery.js` — parallel query runner (`runQueriesParallel`, `runQuery`), pagination, `withCache` + chunked-gzip `cachePutLarge/cacheGetLarge`, `shortHash`.
- `Queries.js` — base SQL statements (single-table reads); `buildDashboardQuerySpecs`, device/center explorer, `centerUptimeSql_` (M-A1/A2/A6, uses `techBoolSql_`), `cohortReliabilitySql_` (M-A3/A5), SLA specs. Lazy `nowIstSql_`/`fleetBucketSql_`.
- **`EditionCD.js`** — **the center_details data layer (SOLE edition).** `CD_SEG_FILTER` (F2P exclusion), `cdFilter_(activeOnly)`, `centerUptimeSqlCD_` (also feeds the Center-360 lifecycle/downtime/uptime columns, no LIMIT), `buildDashboardQuerySpecsCD`, `getCenter360RowsCD_` (+`jira_devices` from `getAssetIndex_`), `assetsDonutFromIndex_`/`cohortFromIndex_` (Jira-sheet-based, replaced the old jira_data BQ specs), and all client endpoints `apiGet{Dashboard,Centers,MapData,TopCustomers,ExecOverview,CenterDetail}CD`. These are what the client actually calls.
- **`SlaCatalog.js`** — `SLA_CATALOG` (117 issue types → {days, tech}), `slaFor`, `techBoolSql_(col)`, `slaDaysCaseSql_(col)`, CD-safe emitters. Tech/Non-Tech classification + per-ticket SLA days.
- **`Numbers.js`** — `apiGetNumbers(options)` (center_details-only counts, F2P/active filtered, segment = `hub_master_segment`), `jiraDeviceStats_()` (cached device totals + `avg_age_days`/`age_bands`/`past_life` from the Jira sheet/dump, **filtered to Connector + ECG Machine only** via `isTrackedJiraDeviceType_()`), `deviceCenterMap_()` (serial→center bridge, **cloud_devices FIRST, center_details fallback**), `apiGetCenterDetailsRaw(options)` (paginated raw center_details + per-center device count + Mapped flag).
- **`SheetSource.js`** — reads BOTH Google Sheets via the **Sheets REST API**: `readJiraSheet()` (devices; tolerant header map Key/Issue Type/Summary/Status/Created/Customer ID), `readCsTracker()` (CS field cases), and `readRawSheetRows_(sheetId, sheetName)` (generic full-fidelity reader for Raw Data page).
- **`RawData.js`** — `rawSources_()` registry (6 BQ tables + 2 Sheets), `apiGetRawPage(options)` (paginated), `apiGetRawExport(options)` (full-table CSV, capped at 100k rows). No site filters.
- **`JiraDump.js`** — `JIRA_DUMP` offline snapshot (43,794 devices, pre-aggregated) used when the Sheets API is disabled; auto-swaps to live once enabled.
- `Join.js` — Apps Script-level hash-join utils (`indexRows`, `leftJoin`, `sortRows`).
- `Api.js` — legacy device_center_mapping endpoints (`apiGetDashboard` etc.) — **retained but unused** (client calls the CD versions); still hosts `getCenter360Rows_`, `getAssetIndex_`, `enrichCenterNames_`.
- `TopCustomers.js` — 27 "Top LE" hub constant + `apiGetTopCustomers` / `computeTopCustomers_` + `topCustomerTicketStats_`.
- `ExecOverview.js` — legacy exec endpoint (CD version in EditionCD.js is the live one).
- `Geo.js` — progressive geocoder (`runGeocodeBatch`, `geoStats`) → chunked Script-Properties store. Sources locations from `center_details` (PinCode/City/State/Spoke_Country), **ACTIVE centers first**.
- `WebApp.js` — `doGet` + `include()` templating.
- `Setup.js` — `setupServiceAccountKey()` (one-time), `diagnostics()` (points at CD endpoints + Jira device-type stats + raw-data row counts for all 8 sources), `clearDashboardCache()`.

**Client (`src/client/*.html`):**
- `Index.html` — page shell: `.app-shell` = collapsible left sidebar nav (**8 tabs** incl. **Raw Data**, icon+label, Tricog brand mark) + `.app-main` (topbar, all panels, shared drawer, script includes). `#activeOnlyBtn` toggle. Uses `<?!= include('...') ?>`.
- `Styles.html` — Tricog design tokens (dark + light), component CSS, motion tokens + entrance/hover animations, `.info-dot`/`.info-pop` (metric tooltips), `.sla-*`, `.num-*`, `.raw-*` (pill selector + actions), `.batch-signal`, responsive breakpoints (320px+).
- `Charts.html` — all ECharts configs (`Charts` module), theme-aware palette, `fleetStatus`/`zohoTrend`/`geo`/`cohort`/`rankBar`/**`jiraStatus`**, lazy render/flush.
- `MapView.html` — **factory** `MapView(containerId)` → Leaflet instance (CARTO tiles, markercluster).
- `App.html` — state (`activeOnly`, `cdRaw`, `rawData`, …), `ep(name)`→`name+'CD'`, data loading, `countUp/countUpText`, `setKpi/setKpiText`, `renderExec`, `renderDashboard`, `renderAssetSummary`/`renderCentersSummary` (per-page executive summaries, built metric-by-metric with the user), `renderNumbers/renderCdRaw`, **`loadRawTable/renderRawTable/exportRawFull`**, center drawer (`makeCenterDetail`, `ticketRowsHtml_` — Open/All ticket toggle), global filters, theme, tabs, **metric-explanation tooltips** (`METRIC_INFO`, `KPI_METRIC`, `TITLE_METRIC`, `setupMetricInfo`), mocks (incl. all 6 raw-data sources post device_metrics/jira_data-BQ removal).

**Docs / data:** `docs/SOURCES.md`, `docs/DATA_LOADING.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`,
`docs/AppsScript_BigQuery_Setup.md`, `sql/*.lineage.sql` (upstream DWH queries — reference only),
`design-system/sip-insights/MASTER.md`.

**Secrets:** `credentials/abi_team_sip_bq_access_service_account.json` (gitignored). Read-only BQ scope.
Private key lives only in Script Properties `SA_KEY`, never in source.

---

## 4. Data model facts (non-obvious — verified against live BQ)

- **Sandbox is a PARTIAL copy of production** with exactly **6 tables** (no `DIM_Centers`). **`center_details` was RELOADED 2026-07-07 12:28 UTC** with a **114-column schema**: now HAS `DeviceID`/`MacSerialID`/`MachineType` (serial→center mapping auto-activated) + `F2P_Customer` flag; REMOVED `pin`→`PinCode`, `Country`→`Spoke_Country`, `latitude`/`longitude` (gone — geocode store is the only coord source), `HubStatus`/`HubSegment` (gone). **Row duplication**: 35,804 rows → 27,778 distinct full rows → **27,410 distinct centers** (8,026 exact full-row dupes + 368 centers with genuinely-different rows) → queries dedupe (`SELECT DISTINCT` / `COUNT(DISTINCT …)`). ⚠️ `Age_In_Months` exists but is UNTRUSTWORTHY — matches neither `deploymentdate` (0%) nor `AcquiredDate` (6%); age charts use `deploymentdate`.
- **`center_details` is the SOLE center source** (the device_center_mapping "edition" was removed; dcm is also no longer a Raw Data source **and no longer used by Geo.js** — geocoding now reads `center_details`). Everywhere: centers = `COUNT(DISTINCT CenterID)`. **F2P exclusion** keys on `IFNULL(F2P_Customer,0)=0` only (old `'F2P_CENTER'` segment value = 0 rows; flag is all-0 today so nothing is excluded — activates when DE sets it). Counts: **27,410** centers (→ fewer with `Status='ACTIVE'` toggle). Segment (`Spoke_Center_Segment`) is free-text hospital/GP/diagnostic categories with 3+ spellings, 23,247 blank — kept as-is (no normalization); topbar segment filter + dropdown both read this field.
- **ALL Jira data comes from the Jira Google Sheet** (`JIRA_SHEET_ID`); the `jira_data` BQ table is **ignored app-wide** (v5.6). **Devices/fleet = count of Sheet rows filtered to Connector + ECG Machine** (~28,444: 18,030 ECG + 10,414 Connector), deduped by Key. Field map: Key = ticket id, Summary = Device ID/serial, Issue Type = device type, Status = device status, age = today − Created. A device's center is resolved by the **serial parsed from Summary** (regex `[A-Za-z0-9]{2}-[A-Za-z0-9]{6,}`) via `deviceCenterMap_()`: **cloud_devices.DeviceID first, then center_details DeviceID/MacSerialID fallback** (union — cloud wins conflicts). Coverage ~**17,323 mapped / 12,028 centers** (serial map = 27,373). Jira "Customer ID" column is **ignored** (per user). `getAssetIndex_` (Api.js) reads the Sheet; the status/type donut + cohort are computed in JS (EditionCD `assetsDonutFromIndex_`/`cohortFromIndex_`).
- `cloud_devices` — 1 row/device (~11.3k). `LastTimeStamp` is **IST wall-time** (+330 min at load) → recency SQL uses `nowIstSql_()`. `BatteryLevel` can be `"Charging"`. Epoch-1970 = never seen.
- `zoho_data` — 1 row/ticket (~84.5k). `CreatedAt`/`ClosedAt` are **strings** `"02-Jul-2026 04:59:16 PM"` → `SAFE.PARSE_DATETIME('%d-%b-%Y %I:%M:%S %p', …)`. Has `TicketLink` (drawer links), `priority` often empty. **Does NOT hold** the SLA-quality fields (Resolution/First-Response in Business Hours, thread counts) → blocks FCR/FRT/CHI.
- `device_metrics` — device rows, **duplicated** → dedupe `GROUP BY deviceid`. `down_time_percentage` is cumulative ticket-time ÷ deployment days (**can exceed 100%** — a service-burden index); `mean_time_between_failures_hrs` is actually in DAYS.
- `device_center_mapping` — still exists as a BQ table; **removed as a user-facing source** but retained internally only for Jira-asset serial linking in the legacy path.
- **CS tracker Google Sheet** `16Q2q9R6GPBOBYVmvImRTZRp8g1kW-G6fio26XDJiULo` — 1 row/field case; TAT/machine/issue/owner. Join `Zoho ID` ↔ `ticketNumber`.
- **Joins are done in Apps Script (Join.js)** on pre-aggregated single-table reads (also the only way to join Sheet ⋈ BigQuery).

---

## 5. Metric catalogue (PRD/TRD status)

TRD: `Downloads\SIP_TRD_v3_0_Metric_Definitions.docx` · PRD: `Documents\Projects\SIP\req\Sip – Service Insight Platform (prd).docx`

**Pillar 1 · Asset** — M-A1 Uptime (North-Star ≥99%) ✅ · M-A2 MTBF ✅ · M-A3 First-Time-Failure ✅ ·
M-A5 Batch Failure ✅ · M-A6 Health Score ✅ · **M-A4 Lifecycle Dwell ⛔** (needs Jira changelog).

**Pillar 2 · Customer** — M-C3 Top-20 ✅ (could gain per-account MRR) · **M-C2 Health Index ⛔** (needs Zoho
quality fields). *M-C1 MRR-at-Risk was built then removed at user request; center_details holds real MRR
(Current_MRR + Device_Rental) so it's re-buildable — see the v5.1 note in project memory.*

**Pillar 3 · Service** — M-S2 TAT ✅ · SLA-compliance suite ✅ (within% + Tech/Non-Tech + breach-by-type) ·
**M-S1 FCR ⛔ · M-S3 FRT ⛔** (need Zoho business-hours fields) · **M-S4 IVR ⛔** (blocked upstream).

Every metric on the dashboard has an in-UI ⓘ tooltip explaining its formula + source (see `METRIC_INFO`
in `App.html`). The blocked metrics auto-unlock when DE loads the missing Zoho quality fields + Jira changelog.

---

## 6. Open items / next steps

1. **Enable the Sheets API** on GCP project **218180702013**:
   https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=218180702013 → Enable → wait ~2 min. Until then **devices fall back to the offline `JiraDump.js` snapshot** and the CS-tracker panels show empty states (both non-blocking). Also share both sheets (Viewer) with the deploying user.
2. **DE reload: PARTIALLY DONE (2026-07-07)** — `center_details` arrived with `DeviceID`/`MacSerialID` ✅ (serial→center auto-activated). Still missing: **Zoho quality fields** (first-response & resolution in business hours, thread/reopen counts → unlock M-C2 Health Index, M-S1 FCR, M-S3 FRT) + **Jira changelog** (status-transition history → M-A4 Lifecycle Dwell). Ask DE to also **dedupe rows** (8,026 exact dupes + 368 centers with genuinely-different rows) and confirm whether `F2P_Customer` all-0 is correct or the flag just isn't populated yet.
3. **Geocoding — REQUIRED for the Map, run it now** — the reload removed lat/long, so pins come only from the pin-geocode store. `runGeocodeBatch()` (server/Geo.js) now sources `center_details` and does **ACTIVE centers first**; the quota resets ~every 14h, so re-run each day until `geoStats().pending` = 0, then `clearDashboardCache()`.
4. **Verify the Jira browse domain** — drawer KEY links use `https://tricog.atlassian.net/browse/` (const `JIRA_BROWSE` in App.html) — confirm this is correct.
5. **Buildable-today enhancement (deferred by user 2026-07-07):** add per-account MRR to the Top-20 leaderboard (M-C3).
6. **Downtime display** — cumulative (>100% possible). Open offer: cap at 100% / relabel "Service burden %", or keep with tooltip.
7. **Device uptime / Device health (deferred, 2026-07-08)** — Asset page currently has no device-grain uptime metric (moved Center uptime/health to Centers page instead). Needs a fresh formula from the user before building — do not guess; the sandbox has no per-device downtime source today (candidate proxy: cloud_devices heartbeat recency, but that's a different definition and would only cover the ~11k devices with telemetry).
8. **Asset KPI tiles still show the OLD tiles** (device-status donut, firmware, asset lifecycle/types, health-score table, cohort) — only the executive summary + a new "Device age" chart were added/changed on this page so far; the KPI strip itself (Poor signal / Unsynced ECG removal was applied, but no full KPI redesign) is not yet revisited metric-by-metric with the user.
9. **Remaining pages not yet worked**: Support/CS, Map, Top Customers, Numbers, Raw Data, Overview — the page-by-page/metric-by-metric pass (started 2026-07-08 with Asset then Centers) has not reached these yet.
10. **Next up (queued, not started):** user has queued a batch of changes around filters and data extraction — requirements gathering (brainstorm/spec) has started but the change inventory has not yet been provided.
11. **Test harness added (2026-07-28)** — a two-tier Jest suite now exists: `npm test` (fast unit tests, no credentials) and `npm run test:reconcile` (live-BigQuery reconciliation, needs `GOOGLE_APPLICATION_CREDENTIALS`); `npm run verify-before-deploy` runs both as a manual pre-deploy gate. CI (`.github/workflows/test.yml`) runs the unit tier on every push and the reconciliation tier on PRs into `main`. **Still open:** the `BQ_SERVICE_ACCOUNT_KEY` repo secret (base64-encoded `tricogde-dwh` service-account key) has not been added to GitHub yet, so the CI reconciliation job currently no-ops on every PR — see `docs/superpowers/specs/2026-07-28-testing-harness-design.md` for the full design and what's still uncovered.
12. ~~**(from 2026-07-31 review) Fix global search's silent no-op**~~ — **DONE 2026-08-04**, commit `9657431` (not yet pushed/deployed): Overview/Numbers/Raw Data now disable the box with an explanation; Top Customers now actually filters; Support/CS is a CenterID/ticket-number lookup instead.
13. **(from 2026-07-31 review) Add first-run onboarding** — a dismissible welcome panel (localStorage-flagged, shown once) surfacing what's currently only in the header ⓘ tooltip (`App.html:2385`), which a first-time visitor has no reason to discover.
14. **(from 2026-07-31 review) Add real focus-trap + focus-restore to both drawers** (`#filterDrawer` AND `#centerDrawer` — live-reproduced escaping into background content on the center-detail drawer, not just the filter drawer already parked above in the 2026-07-29 fix-wave notes).
15. ~~**(from 2026-07-31 review) Decide the fate of the confirmed-dead non-CD code** in `Api.js`/`ExecOverview.js`/`TopCustomers.js`~~ — **DONE (2026-08-17):** deleted the dead entry points (`apiGetCenters`/`apiGetMapData`/`apiGetCenterDetail` from `Api.js`, `apiGetExecOverview`+`execSpecs_` — the whole file — from `ExecOverview.js`, `apiGetTopCustomers`+`computeTopCustomers_` from `TopCustomers.js`) after re-verifying each had zero live callers (the CD endpoints in `EditionCD.js` have their own independent `getCenter360RowsCD_`/`enrichCenterNamesCD_`/`computeTopCustomersCD_`, not these). Kept every helper the CD path actually still calls: `respond_`, `apiGetDevices`, `apiGetCdmDevices`, `apiHealthCheck`, `assetDateStr_`/`assetAgeDays_`/`assetMachineModel_`/`getAssetIndex_` (Api.js), and `TOP_CUSTOMERS`/`topCustomerTicketStats_` (TopCustomers.js).
16. **(from 2026-07-31 review) Investigate the Overview-vs-Centers-tab KPI count mismatch** — Overview shows 18,370 centers, the Centers-tab KPI strip shows 28,482 "all centers", both under the identical default "Status: Active" filter chip. Not yet root-caused; may be a fresh instance of the SQL-vs-JS filter-path disagreement class the 2026-07-29 fix wave already fixed once for Hub/State (item I4/I8 above).
17. **(v5.29/v5.30) Run `profileJoinKeys` in the Apps Script editor** — `src/server/ProfileNewSources.js` is a temporary read-only diagnostic. `profileNewSources()` has been run (its output shaped both new pages); **`profileJoinKeys()` STILL has NOT** (reconfirmed 2026-08-14, commit `dffa0fd`). A `doGet(?diag=joinkeys)` remote-read attempt was tried and reverted — it rendered, but the browser-automation tool lacks host permission for `script.google.com/a/macros/tricog.com/*`, so the output couldn't be read back that way; `profileJoinKeysText_()` now at least returns its output as one string for whoever runs it directly in the editor. It answers whether `servicewrk_Tickets.customer_id` and `tom_tickets.center_id` actually resolve to `center_details.CenterID`, whether the `zoho_ticket`/`zoho_id` cross-references resolve to `zoho_data.ticketNumber`, and whether ANY row carries time-of-day. **If centre coverage is good, Hub/Centre filtering and centre-drawer click-through can be added to both new pages** (they are currently ignored — see each page's filter-coverage note). Delete the whole file once it has served its purpose.
18. **(v5.30) Confirm what TOM actually is.** The page is built as a CS issue tracker because `remarks` records outcomes, but the user was asked twice and did not answer, and `comments` hints at machine transfers. Still unanswered as of 2026-08-14. If it's really machine movement, re-frame the page's labels/KPIs around movements and turnaround — the underlying queries mostly survive.
19. ~~**(v5.29/v5.30) `Charts.rankBar` x-axis labels collide in narrow `span-4` cards`~~ — **DONE, v5.32/@61 (2026-08-14), commit `678496f`.** Removed the redundant/overlapping value axis from all 12 `rankBar` instances (5 TOM, 3 Service, 3 Top Customers, 1 Overview) — the axis duplicated the value already printed as a bar-end label.
20. **(2026-08-14 catch-up pass) `docs/SOURCES.md` and `docs/ARCHITECTURE.md` were 3 versions stale** (last touched at v5.13, missing every v5.14–v5.33 change: `tom_tickets`, `servicewrk_Tickets`, `hub_country`, the CDM page, the 7-dimension filter set, the zoho dedup/native-DATETIME fixes, the reversed ServiceWRK-uptime-swap decision). **Fixed in this pass** — both docs now reflect state through v5.33/@62. Re-verify they're still current before trusting them on anything past this point.

---

## 7. How to verify after changes
- `diagnostics()` in the editor logs row counts for every panel + center360/map/top-customers/exec/SLA/devices lines + **Jira device-type filter stats** + **raw-data row counts for all 4 exposed sources** (`center_details`, `cloud_devices`, `zoho_data`, `jira_data` — `tom_tickets`/`servicewrk_Tickets` are NOT in Raw Data, see `docs/SOURCES.md`). Use it as the health check.
- Local: rebuild + browser-preview (section 2), check console for errors, screenshot each tab + both themes.
- SQL: verify new queries on live BQ via the scratchpad node → `bq query < file.sql` pattern (section 2) before wiring.
- Deliver: hard-refresh editor tab → `clasp push --force` → New version deploy.

Project memory (full changelog v2.0→v5.0) is auto-loaded from
`~/.claude/projects/.../memory/demo-sip-project.md` (kept in sync with this file).
