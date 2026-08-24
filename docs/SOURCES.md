# Data Sources — SIP Insights

The dashboard is powered **entirely by BigQuery tables** in `tricogde-dwh.abi_tables`. The
original six tables (migrated 2026-07-22 from the `magnaquest-sand-box.abi_team_sip_devtest_poc`
dev/test dataset — same names, byte-identical schema, live-verified) were joined by two more as
of 2026-08-14: `tom_tickets` (TOM page) and `servicewrk_Tickets` (Service page). **No Google
Sheets remain as data sources** — the CS/Service tracker Sheet was removed 2026-07-29, and the
Jira devices Sheet was removed 2026-07-30 (see below for both). That is a statement about the
**query layer**: no Sheet is read at runtime, but four reference catalogs (three sheet-derived,
one third-party geo dataset) are vendored into `src/` and feed the SLA and map layers — see
*Hand-maintained catalogs in source* below. The `sql/*.lineage.sql` files describe the upstream
DWH queries that produced the original six tables — read them for column semantics (no equivalent
lineage file exists yet for `tom_tickets`/`servicewrk_Tickets`).

## BigQuery tables

| Table | Grain | Powers | Watch out |
|---|---|---|---|
| `center_details` | dup rows per center (~35.8k rows; **27,410** distinct centers) | **SOLE center source** — all center counts, uptime/MTBF/health, geo, deployment age | `COUNT(DISTINCT CenterID)` always; no F2P baseline (`cdFilter_()` unconditionally returns `1=1`, removed 2026-07-22); `Status` is one of the global-filter dimensions (multi-select, defaults to `ACTIVE` as a removable chip), not a toggle; has `Current_MRR`/`Device_Rental`/`Status`/`Spoke_Center_Segment`, and (since the 2026-07-07 reload) `DeviceID`/`MacSerialID`/`MachineType` too — `deviceCenterMap_()` in `Numbers.js` uses them as a fallback serial→center source behind `cloud_devices`. **Country filter source switched from `Spoke_Country` to `hub_country` (v5.33, 2026-08-14)** — `Spoke_Country` had ~9% NULLs plus data-entry noise (typos, a city name, a continent name); `hub_country` is used everywhere the country dimension is derived (`centerAttrCond_`, `countryOptions`, `centerBaseSpecCD_`, the center-detail drawer, and `Geo.js`'s geocode-key source) |
| `cloud_devices` | 1 row / device (~11.3k) | **serial→center bridge**, and (v5.33) the **CDM (Communicator Device Management) page** — its only user-facing surface as of 2026-08-19, when the Asset page's fleet-status donut/firmware spread/device explorer were removed (cloud_devices data is CDM/Numbers/Raw-Data only now) | `LastTimeStamp` is **IST wall-time** (+330 min at load — see `sql/cloud_devices.lineage.sql:9`); `BatteryLevel` can be `"Charging"`; epoch-1970 = never seen |
| `zoho_data` | 1 row / ticket (~80k after dedup + unassigned-ticket exclusion, v5.22/v5.23) | Support view: ticket analytics, SLA compliance, uptime downtime proxy | `CreatedAt`/`ClosedAt` are native **DATETIME in production** (they were strings in the sandbox — `PARSE_DATETIME` on a DATETIME column crashed live until the v5.24 hotfix, 2026-08-13); priority often empty; **lacks** business-hours SLA fields (blocks FCR/FRT/CHI); the raw table has duplicate rows and unassigned (no-CenterID) tickets — deduped/excluded for every consumer except the Raw Data page, which intentionally shows the true raw count |
| `device_metrics` | device rows, duplicated | Reliability watchlist (downtime index) | Dedupe with `GROUP BY deviceid`; AVG/MAX only, never SUM |
| `device_center_mapping` | 1 row / device-center window (~56k) | **Retired as a user-facing source** — retained only for legacy Jira-asset serial linking | Was the old centers/geo source before the center_details migration (v4.4) |
| `jira_data` | issue × changelog rows (~49.9k rows; ~45.4k distinct `issue_key`) | **THE devices/fleet source** (`readJiraData_()` in `Numbers.js`, since 2026-07-30) — devices/fleet count, asset lifecycle, cohort/FTF analysis, map/drawer asset lists | `GROUP BY issue_key` + `ANY_VALUE`/`MIN` — issue-level fields (`summary`/`status_name`/`issuetype_name`/`ticket_created`/`customerid`) come from the issue side of the upstream LEFT JOIN and are constant per `issue_key`, so no "latest changelog row" logic is needed. Device-type filter (`CONFIG.JIRA_NON_DEVICE_TYPES`) excludes only Task/Epic/Test — every other Issue Type counts as a device |
| `tom_tickets` | 1 row / issue (1,325 rows, 2025-12-30 → 2026-08-12) | **TOM page** (`TomTickets.js`, v5.30) — CS-owned issue/escalation tracker | Loaded from monthly spreadsheet tabs (`source_tab`, e.g. "2026 \| June 2026"). `remarks` is the OUTCOME column despite its name (Issue Resolved/Auto Resolved/Not resolved/etc.) — **this framing is inferred from the data, not confirmed by the CS team** (asked twice, no answer as of 2026-08-14). `t_o_m` is a single constant value ("Saidha") across all rows — unusable, deliberately not surfaced. `comments` is 98.3% null — can't carry the page even though it hints at machine-swap/HQ-dispatch activity. Filter coverage is **Centre + date range only** — no state/city/segment/hub columns exist on this table |
| `servicewrk_Tickets` | 1 row / ticket (36,403 rows, `ticket_id` unique — no dedupe needed, unlike `zoho_data`) | **Service page** (`ServiceWrk.js`, v5.29); as of v5.55/@84 also the **center-detail drawer's Service ticket tabs** and the **Overview map's FSE coverage layer** (`Fse.js`) | **Deliberately NOT the Machine Uptime (M-A1) source**, despite earlier docs/Config.js comments anticipating that swap once this table landed: `created_on`/`closed_date` are **date-only** (886 distinct values across ~947 days — no same-day downtime resolution), only 870/36,403 rows are `ticket_type='BREAKDOWN'`, and coverage starts 2024-01-08 while center `life` reaches years further back. See `docs/superpowers/specs/2026-08-13-service-tom-pages-design.md` §4.1. **Do not "fix" this** — the uptime engine stays on the `zoho_data` proxy. The Service page's own filter coverage is the table's own state/city/customer_category columns, not the global center dimensions. **The `servicewrk_Tickets.customer_id` → `center_details.CenterID` join WAS verified 2026-08-23** via `profileJoinKeys()` (run manually in the Apps Script editor — `clasp run` doesn't work on this project, no `executionApi` in the manifest): 87.7% of all 36,620 rows resolve to a real CenterID (32,133/36,620), hitting 7,786 distinct centers — high enough to build on per the decision rule in `docs/superpowers/specs/2026-08-13-service-tom-pages-design.md` §7. That join now backs two features: the center-detail drawer's Open/Closed/Swapped Service ticket tabs (`buildCenterDetailSpecs` in `Queries.js`, `CAST(@cid AS STRING)` against `customer_id`) and `Fse.js`'s coverage layer (`String(r.customer_id)` cast the other direction) — both cast to STRING since `customer_id` is TEXT and `CenterID` is numeric. The non-resolving ~12% is mostly placeholder text (`"New spoke"`, `"NA"`, `"New"`), not malformed real IDs |

## jira_data — the devices/fleet source (switched from a Google Sheet, 2026-07-30)

- **Grain:** issue × changelog rows (~49.9k rows; ~45.4k distinct `issue_key`) — the upstream
  ETL LEFT JOINs a Jira issues table against a changelog table (see
  `sql/jira_data.lineage.sql`), so an issue with N field-change history entries gets N rows.
  Issue-level fields (`summary`, `status_name`, `issuetype_name`, `ticket_created`,
  `customerid`) all come from the issue side of that join and are constant across every row
  for a given `issue_key` — `readJiraData_()` (`Numbers.js`) collapses this correctly with a
  plain `GROUP BY issue_key` + `ANY_VALUE`/`MIN(ticket_created)`, no "pick the latest
  changelog row" logic needed.
- **Powers:** the **fleet/devices count** everywhere (`jiraDeviceStats_()` in `Numbers.js`),
  the Map/drawer asset lists and Asset-lifecycle/cohort analysis (`getAssetIndex_()` in
  `Api.js`). A device's center is resolved by its **serial** parsed from `summary`
  (regex `[A-Za-z0-9]{2}-[A-Za-z0-9]{6,}`) → bridged via `deviceCenterMap_()`
  (`cloud_devices.DeviceID` first, `center_details.DeviceID`/`MacSerialID` fallback). The Jira
  **`customerid` column is ignored** (per user).
- **Device-type filter (widened 2026-07-30):** `jiraDeviceStats_()` excludes rows whose Issue
  Type is `Task`, `Epic`, or `Test` (`CONFIG.JIRA_NON_DEVICE_TYPES`, matched case-insensitively
  via `isTrackedJiraDeviceType_()`) — every other Issue Type counts as a device (ECG Machine,
  Connector, SIM Card, UPS, Printer, BP Machine, Tab, Mobile, IV Trolley, Laptop, WiFi Dongle,
  TriCare Assets, etc.). `getAssetIndex_()` applies the same filter. This replaced an earlier
  restriction to Connector + ECG Machine only (v5.2), which was found to be excluding 12 other
  real device categories once the full `jira_data` issuetype_name breakdown was checked.
- **Why the switch:** the Jira devices Google Sheet depended on the Sheets API, which was
  disabled on the GCP project — the app was silently falling back to a frozen `JiraDump.js`
  snapshot (~3 weeks stale) for the devices count, and getting nothing at all for the asset
  index (no fallback existed there, so those panels were rendering empty). `jira_data` was
  confirmed live and actively loaded (most recent row 2 days old at the time of the switch) —
  fresher than the Sheet ever was for most users, with no functionality lost. `SheetSource.js`
  and `JiraDump.js` were deleted entirely; the `spreadsheets.readonly` OAuth scope was removed.

## CS/Service tracker Sheet (REMOVED 2026-07-29)

This Sheet (a manual field-team log — TAT/machine/issue-type/owner cases) previously powered
Support/CS's TAT trend, machines-in-the-field, field-issue-types, and case-owners panels, plus
Overview's field-TAT KPI. It was removed as a data source: the Sheets API was disabled on the
GCP project, so it was already failing in production, and — unlike the Jira devices Sheet
(which had `jira_data` to fall back to, see above) — there was no BigQuery table for this one.
Those panels have no replacement; they're gone from the UI. `CONFIG.CS_SHEET_ID`,
`readCsTracker()`, and the `cs_tracker` Raw Data source were all deleted.

## Hand-maintained catalogs in source (not BigQuery)

Five reference catalogs ship inside `src/` because the warehouse has no equivalent: there is no
FSE table, no field on any ticket that names a Channel Partner, no SLA-target column on
`zoho_data`, no polygon inside a raster basemap tile, and nothing anywhere that records which
states the dealer network fails to reach. They are edited in place, and every one follows the same
rule — **name the source and the import date in the file's docblock, keep the rows
ordered so diffs read, and never invent a row**. `Fse.js`'s "NEVER PLACEHOLDERS — REAL ROWS ONLY"
is the canonical statement of it, because a placeholder there draws a person who does not exist
onto a production operations map. Three of the five — `FSE_ROSTER`, `CP_ROSTER` and
`GRAY_AREA_STATES` — trace to the same BRM 2026 dealer-network review, whose workbook is **not
tracked in this repo** (`*.xlsx` is gitignored as input data), so for those three the docblocks
*are* the provenance record. `SLA_CATALOG` is the exception on both counts: its docblock embeds the
live Google Sheet URL (`SlaCatalog.js:18`), and a copy of that sheet *is* on disk —
`SLA sheet.xlsx`, untracked but sitting in the repo root. Every count below was measured by
evaluating the literal at HEAD, not taken from a commit message — `c470705`'s body claims `CP_ROSTER` holds 45; it holds 11.

| Catalog | Lives in | Entries | Named source (+ import date) | Owner / update path | Users see it as | Watch out |
|---|---|---|---|---|---|---|
| `SLA_CATALOG` | `src/server/SlaCatalog.js` | **117** ticket types (49 Tech / 68 Non-Tech; `days` 0–30) | the CS team's "SLA sheet" Google Sheet, **SLA-New** tab, column E "SLA by Mustaq in days" — `days` revised **2026-08-17** (61 categories changed, 1 added: International Camp Request) | CS team owns the values; this repo holds the copy, edited in place | per-ticket SLA target/breach columns and the SLA-risk worklist | **It compiles into SQL** — also the live uptime engine's Tech filter, so a "display-only" edit does not exist |
| `FSE_ROSTER` | `src/server/Fse.js` | **26** engineers (11 HQ states, 17 carrying `territory`) | "Progress on the Service Dealer Network - BRM 2026.xlsx", **'direct'** sheet (27 rows), imported **2026-08-24** | Field-service ops supply names; roster edited in place | named engineer pins + coverage fan + Engineers/Coverage-gaps legend (Overview map) | **Real employee names paired with base towns**, in a repo with a GitHub remote; shipped EMPTY @83/@84–@88, so production drew no pins for six deploys |
| `CP_ROSTER` | `src/server/Cp.js` | **11** dealer companies, **77** declared locations (7 HQ states) | the same BRM 2026 workbook, **'CP'** sheet, imported **2026-08-24** | Channel-partner ops supply the sheet; roster edited in place | burnt-orange dealer pins + focus fan + Dealers legend toggle (Overview map) | Coverage is **declared, never verified against tickets**; real trading-partner company names (commercially sensitive, not personal data); a length assertion in `test/unit/cp-coverage.test.js` breaks on any add/remove |
| `COUNTRY_GEOJSON_` | `src/client/MapView.html` (one line) | **135** country features (116 Polygon / 19 MultiPolygon, 6,683 coordinate pairs, 3-decimal precision) | **third-party**: trimmed from `github.com/johan/world.geo.json` — licence and caveats below, and they matter | upstream project, not us; re-trim from upstream to change it | the "Country has centers / No centers" wash on all three maps | ~117 KiB — about four-fifths of `MapView.html`; the licence is **less settled than the in-source comment implies**, and 10 features sit outside the trim window the comment states |
| `GRAY_AREA_STATES` | `src/client/MapView.html` | **7** state centroids (Kerala, Madhya Pradesh, Gujarat, Jammu & Kashmir, Jharkhand, Chhattisgarh, Uttarakhand) | the same BRM 2026 dealer-network review, **"Gray areas"** sheet | same review as the two rosters above; client-side only, no server round-trip | slate warning markers + a non-interactive legend note, Overview map only | Landed in `106f894`, scoped to Overview in `f6ba080`, and **is in production**: it shipped on the deploy `5dbb1d3` bumped for, which landed as `@92` while the embedded footer still read '91', and `e693a78` corrected `APP_VERSION` forward. Read the live version off `src/server/Config.js` (`APP_VERSION`/`APP_DEPLOYED_AT`) rather than any @N written down here. Purely static — never varies with data or filters, unlike FSE/CP |

### `SLA_CATALOG` — the catalog is also SQL

Matching (`slaFor`) is a case-insensitive **exact** match on `zoho_data.IssueCategory`; a category
with no row falls back to `CONFIG.SLA_DEFAULT_DAYS` plus the `CONFIG.TECH_FALLBACK_REGEX` keyword
heuristic for `tech`. The docblock names four high-volume live categories that have no row and so
ride that fallback today (Data Update Query, Report Related Query, MAC 600 Machine Issue, Tricog
Device Network/Hardware Issue). `techBoolSql_` and `slaDaysCaseSql_` compile the literal into SQL
fragments, invoked **12 times across 11 lines** — `EditionCD.js` ×2, `Queries.js` ×6 (`:510`
carries both helpers on one line, which is where 12-invocations-on-11-lines comes from), and
`SlaRisk.js`, `Numbers.js`, `TopCustomers.js`, `ProfileNewSources.js` ×1 each. (`catalogInList_`
is not called from any of those files; its only callers are inside `techBoolSql_` itself,
`SlaCatalog.js:200-201`.) That makes this catalog the authoritative Tech/Non-Tech classifier for
the live uptime engine as well as an SLA lookup (see
the **Live engine note** under *Machine Uptime %* above). Consequence: editing a row changes
generated SQL, so re-test uptime/MTBF/health alongside the SLA surfaces. Privacy: the docblock
embeds the live Sheet URL and names an individual, in a repo with a GitHub remote. A local
`SLA sheet.xlsx` sits in the repo root but is gitignored, not tracked.

### `FSE_ROSTER` — real people, and a six-deploy blind spot

The roster supplies engineers; it never supplies coverage. `territory` is derived from the sheet's
"Segment" column, which is actually the STEMI **program** the engineer works under (KASTEMI →
Karnataka, BIHAR STEMI → Bihar, ODISHA STEMI → Odisha; "Private" carries none) and is
informational only — what the map draws comes from tickets actually worked
(`buildFseCoverageSpec_`, 90-day rolling window). Names therefore have to reconcile with the
free-text `servicewrk_Tickets.representative` through `fseNameKey_` (lowercased, whitespace
collapsed; anything further needs an `aliases` entry); ticket names matching no roster row come
back as `unmatchedReps` rather than being silently dropped, so the layer doubles as a data-quality
surface. Run `fseListRepNames()` from the Apps Script editor to see the names the data actually
carries. On import, four sheet spellings were corrected (Hydrabad, Guwahatti, Nalada,
Bhubaneshwar), one was disambiguated (Baharampur → Berhampur, Odisha), and **one row was
deliberately skipped** — a segment/HQ mismatch (the sheet paired a "MANIPUR
STEMI" segment with an HQ town that is not in Manipur) — which is why the file
holds 26 of the sheet’s 27 rows. The skipped name and town are deliberately NOT reproduced here — this
paragraph is about a privacy-sensitive file, and printing an example name
would repeat the exact exposure the next paragraph warns about; the tool
pointer above (`fseListRepNames()`) is how to find which row, and why. Every
row carries an
explicit lat/lng so pins render without depending on the geo store. Two things to carry forward:
this file is **employee data**, not config (26 real names plus base towns, in a repo with a GitHub
remote); and anything the docs claimed about this layer between @83/@84 and @88 was verified
against the preview mock, not production, because the roster was empty and the guard in
`EditionCD.js` sent `fse: null`.

### `CP_ROSTER` — declared coverage, not computed

No field anywhere in the warehouse names a Channel Partner, so CP coverage cannot be computed the
way FSE coverage is: the roster carries each dealer's declared districts/cities directly. Hence no
coverage query, no name reconciliation and no unmatched bucket — `buildCpLayer_` only resolves
coordinates, and every coordinate in the roster is explicit. **Read a dealer's fan as "declared
here", never as "worked here"**; there is no ticket-level ground truth behind it. Import cleanups
are recorded inline next to the rows they affect: "Sangli"/"Sangali" merged (sheet typo, two rows),
"Chh. Sambajinagar"/Aurangabad normalised to Chhatrapati Sambhajinagar, a bare lowercase "pune"
dropped as a duplicate HQ, and the sheet's "Indore & Bhopal" HQ split (`hqCity` Indore, Bhopal kept
as a covered location). One coordinate is flagged **LOW CONFIDENCE** in place (Campierganj, S S
Medical System). The raw sheet shape it was reduced from — 982 rows with 11 populated, 107 raw
location mentions, 79 distinct strings before dedup — is recorded in
`docs/superpowers/specs/2026-08-24-cp-dealer-layer-design.md`. No `aliases`/`active` fields yet, a
deliberate call at this size; follow `Fse.js` if the roster grows enough to need them.

### `COUNTRY_GEOJSON_` — third-party data bundled into the shipped app

This is the one entry here whose **licence** a reader may have to act on, and until now the comment
at the top of `MapView.html` was the only record of it anywhere: there is **no `LICENSE` file in
this repo**, and **no on-map attribution for the polygons** (the map's
`© OpenStreetMap contributors © CARTO` line covers the basemap tiles only). Why it is bundled at
all: CARTO's tiles are a flat raster image, so there is no polygon in the basemap to recolour for
the "has a center / no center" wash.

- **Confirmed:** the data was trimmed from **`github.com/johan/world.geo.json`**, and that repo
  does ship an **UNLICENSE** — an explicit public-domain dedication.
- **Not confirmed:** the same repo's README describes the dataset's own legal status as
  "dubious?" and points readers at `mbostock/world-atlas` / `us-atlas` as the alternatives with
  attributable sources. It names no upstream dataset at all, so the in-source comment's
  "Natural Earth-derived" is **our inference, unverified**. Treat the provenance as
  *Unlicense-dedicated, from an upstream that itself flags its legal status as uncertain* — and if
  the polygons ever have to be defensible (a customer-facing licence review, say), re-source from
  `world-atlas` rather than leaning on that comment.

Data caveats — the shipped literal was measured directly, the upstream comparison against
the live upstream file:

- The comment claims the trim kept "the 135 countries whose bbox falls within lat -40..55 /
  lng -25..155". The shipped set is reproduced exactly by a bbox **overlap** test, not a
  containment one (containment yields 125 of upstream's 180 features), and **10 shipped features
  breach the stated window**: Australia, Belarus, Denmark, Fiji, Ireland, Kazakhstan, Lithuania,
  Papua New Guinea, Russia, United Kingdom. Fiji has *no* vertex inside the window at all — it
  rides in because it crosses the antimeridian, so its naive min/max bbox degenerates to
  lng −180..180. Russia's does too, which means the bbox precheck in `refreshCountryFill_` can
  never reject either of them.
- "135 countries" is loose: the list includes non-sovereign/disputed entries (Somaliland, West
  Bank, Northern Cyprus, Kosovo).
- The only property left on a feature is `name` (the upstream feature-level ISO-3166 alpha-3 `id`
  was stripped), and `name` is what the shading joins on — an upstream rename silently unshades
  a country.
- The bundle stops at lng −25, so the Americas are not in it: a bad geocode there still renders as
  a marker but shades nothing (see `docs/ARCHITECTURE.md` → *The map*).
- Coordinates are rounded to 3 decimals (~111 m), invisible at any zoom this map reaches, and the
  reason the embedded copy is ~117 KiB against the ~251 KiB upstream file. Every real service
  country is present (India, Nepal, Philippines, Kenya, Malaysia, Nigeria).

### Business-rule literals in `Config.js`

Not catalogs, but the same class of thing — hand-maintained business rules that live in source
because nothing in BigQuery derives them, each carrying a date and a "per user" attribution in its
comment:

- `JIRA_NON_DEVICE_TYPES` — the Task/Epic/Test exclude list behind every devices/fleet count.
- `JIRA_DEVICE_TYPE_DEFAULT` (empty since 2026-08-21) and `JIRA_DEVICE_STATUS_EXCLUDE_DEFAULT`
  (`['Decommissioned']`) — **duplicated once**, in `App.html:18-19`, the unavoidable limit of
  sharing constants across the `.js`/`.html` split. `Config.js`'s own comment reads as if there
  were a third copy server-side in `Warm.js`'s `warmDefaultFilters_()`; there is not — that
  function returns `CONFIG.JIRA_DEVICE_TYPE_DEFAULT` / `CONFIG.JIRA_DEVICE_STATUS_EXCLUDE_DEFAULT`
  by reference (`Warm.js:41`), so it cannot drift. Only the `App.html` copy can.
- `ZOHO_TERMINAL_STATUSES` — a raw SQL tuple *string* spliced straight into SQL, not a JS array.
- `TECH_FALLBACK_REGEX` — the live fallback when `SLA_CATALOG` has no matching row (gained `swap`
  in v5.2).
- `FAILURE_CATEGORY_REGEX` — **dead literal, zero code consumers at HEAD.** It once fed
  `centerUptimeSql_`, but that function now builds its failure filter from
  `techBoolSql_("IFNULL(IssueCategory,'')")` too (`Queries.js:298`), so
  `git grep FAILURE_CATEGORY_REGEX -- src/` returns only the definition (`Config.js:89`) plus one
  prose mention in a `SlaCatalog.js` comment. Editing it changes no behaviour anywhere — the regex
  you actually want is `TECH_FALLBACK_REGEX` above.
- `SLA_DEFAULT_DAYS` — the target used for an unmatched category.
- `FSE_COVERAGE_DAYS` — 90-day rolling window, deliberately **not** the global date filter.
- `APP_VERSION` / `APP_DEPLOYED_AT` — hand-bumped every deploy, to the version the deploy will
  *create*; the rule and its failure modes are spelled out in-file. It has gone wrong twice: @54
  shipped carrying '53', and the gray-area deploy landed as `@92` still carrying '91' after a
  concurrent session consumed 91 between `clasp push` and `clasp deploy` (`e693a78` corrected it
  forward). **These two fields are the only in-repo record of what production runs** — read the
  live version off them, never off a hard-coded @N in `HANDOFF.md` or in this file.

The same duplicated-across-the-JS/SQL-boundary pattern governs several other hand-written
vocabularies that must be changed on both sides at once: `fleetBucketSql_` vs
`FLEET_ORDER`/`FLEET_COLORS`, `segmentGroupSql_`'s "anything containing SME → SME" merge,
`AGE_ORDER` (duplicated in `OverviewFlow.js` and `Charts.html`), and the TOM outcome lists
(`tomUnresolvedCond_` vs `TOM_UNRESOLVED`/`TOM_RESOLVED`). `METRIC_INFO` in `App.html` is a second,
user-facing copy of many of the claims in *this* file — 48 top-level keys, of which **47 are
metric definitions each carrying its own `source:` string**; the 48th is `about`, the app blurb
behind the About popover and the one entry with no `source:` — and it can drift from this file.

### Editing one of these

- **Expect up to 30 minutes of stale layer.** The map payload's cache key
  (`mapcd_v16_<epoch>_<filterHash>`) hashes neither roster, and the entry is written with a
  1800-second TTL while `Warm.js` re-warms the default filter set every 10 minutes. Bump the cache
  epoch (`clearDashboardCache()`) if the edit has to be visible now.
- **Emptying a catalog removes the layer, quietly.** Both map layers are guarded on a non-empty
  roster, so an empty one sends `fse: null` / `cp: null` — the client reads that as "no layer", not
  "no data".
- **Tests.** `test/unit/cp-coverage.test.js` asserts `CP_ROSTER`'s length, so adding or removing a
  dealer fails the suite until it is updated in the same commit. Nothing pins `FSE_ROSTER`'s real
  contents (`test/unit/fse-coverage.test.js` seeds its own roster), so FSE edits are test-free —
  and unreviewed by the suite.
- **`SLA_CATALOG` edits change generated SQL**, so re-test uptime/MTBF/health as well as the SLA
  columns and the risk worklist.
- **Every edit needs a deploy**: `clasp push`, then bump `CONFIG.APP_VERSION` and
  `APP_DEPLOYED_AT`.

Deliberately **not** in this section: the preview-only mock catalogs in `App.html` (`MOCK_HUBS`,
the demo FSE/CP rosters, mock centers/device IDs) — they reach only `scripts/build_preview.ps1`'s
gitignored `dist/` output and never production. One reference dataset belongs nowhere else, so
note it here: per-center **coordinates** are neither in BigQuery nor in source — `Geo.js` keeps
them in Script Properties (chunked under `GEO_STORE_KEY = 'GEO_STORE_V1'`), filled progressively
by `runGeocodeBatch()`, keyed **pincode-first** — `geoKeyFor` returns `'p:' + pin + '|' + country`
whenever the row has a pincode and only falls back to `'c:' + city + '|' + state + '|' + country`
when it does not (`Geo.js:36-44`). Country comes from `hub_country`, with a blank one defaulting to
`India` on the way in.

## Raw Data page

A dedicated "Raw Data" tab exposes **4** live BigQuery sources (`rawSources_()` in
`RawData.js`) — `center_details`, `cloud_devices`, `zoho_data`, `jira_data` — each as its own
paginated, full-column table with a full-table CSV export. `device_metrics` and
`device_center_mapping` are deliberately excluded as user-facing raw sources (the BQ tables
still exist; nothing else in the app queries `device_metrics` at all, and
`device_center_mapping` is only read internally by `Geo.js`). Unlike every other page, **no
site filter applies here** (no global Segment/Status/State/Hub/date-range filter, no search,
and — unlike the rest of the app — the Jira Issue-Type restriction above does *not* apply to
this page's raw `jira_data` table either, so raw asset types outside Connector/ECG Machine are
visible here). It exists purely for source reconciliation and full-table export, straight from
each source, unaggregated (so the raw `jira_data` table here shows its true changelog grain —
multiple rows per device — unlike every other consumer, which collapses it to one row per
device). Server layer: `src/server/RawData.js` (`rawSources_()`, `apiGetRawPage()`,
`apiGetRawExport()`).

## Machine Uptime % (TRD M-A1 — North-Star)

The canonical North-Star KPI. `servicewrk_Tickets` (ServiceWRK) landed 2026-08-14 (v5.29) —
**this section previously said "swap the `tix` CTE source when ServiceWRK lands"; that decision
was reversed once the table was actually profiled.** It's built here as a **ticket-based proxy**
at **center grain** (`centerUptimeSql_` in `Queries.js`), sourced from `zoho_data`, **and stays
that way**:
- **Downtime** = UNION of *merged* device-failure ticket intervals `[CreatedAt, ClosedAt|NOW]`
  from `zoho_data` (overlaps counted once, not summed — unlike the old cumulative %). Failure
  tickets = `IssueCategory` classified Tech by `techBoolSql_()` (`SLA_CATALOG`'s `tech` flag
  first, else `CONFIG.TECH_FALLBACK_REGEX`), which excludes billing/report/recharge/admin — **not**
  `CONFIG.FAILURE_CATEGORY_REGEX`, which this bullet used to name and which nothing reads.
- **Birth** = earliest deployment per center — `center_details.deploymentdate` in the live
  CD edition (`centerUptimeSqlCD_` in `EditionCD.js`); the legacy `centerUptimeSql_` used
  `device_center_mapping.startdatetime`.
- **Uptime %** = `(life − downtime) / life × 100`, clamped 0–100.
- Fleet KPI = AVG(center uptime) + % of centers ≥ 99%. SLA bands: Critical 99.5 / Standard 95 / Dev 90.
- **Why ServiceWRK was NOT swapped in, despite this doc previously saying it would be:**
  `created_on`/`closed_date` on `servicewrk_Tickets` are date-only (886 distinct values across
  ~947 days — no same-day downtime resolution), only 870 of 36,403 rows are
  `ticket_type='BREAKDOWN'`, and its coverage only starts 2024-01-08 while center `life` reaches
  years further back. See `src/server/ServiceWrk.js`'s docblock and
  `docs/superpowers/specs/2026-08-13-service-tom-pages-design.md` §4.1. **Do not "fix" this
  without re-reading that reasoning first** — it was a deliberate, profiled decision, not an
  oversight. (The `customer_id` → `CenterID` join itself WAS since verified, 2026-08-23, at 87.7%
  coverage — see the `servicewrk_Tickets` row above — but that only unblocked the center-drawer
  ticket tabs and the FSE coverage layer, neither of which touches this uptime calculation.)
- Powers: the "Fleet uptime" KPI (Overview + Asset) and the Reliability watchlist.
- **Live engine note:** the live path (`centerUptimeSqlCD_` in `EditionCD.js:115`) and the legacy
  `centerUptimeSql_` (`Queries.js:298`) now filter identically, both through `techBoolSql_()`
  (`SlaCatalog.js` — catalog `tech` flag first, `CONFIG.TECH_FALLBACK_REGEX` fallback).
  `FAILURE_CATEGORY_REGEX` is read by neither, nor by anything else at HEAD. **v5.2:**
  `TECH_FALLBACK_REGEX` gained the keyword `swap`, so any swap-worded ticket category not
  already an exact `SLA_CATALOG` match now counts as technical/downtime — same mechanism
  also feeds M-A2 MTBF, M-A6 health, the batch-cohort analysis, and the SLA Tech/Non-Tech split.

## Grain rules (from the SIP master build plan — apply everywhere)

1. Count entities with `COUNT(DISTINCT …)` — deviceid / ticketNumber / issue_key /
   centerid — never raw row counts on fanned sources.
2. Repeated device-level metrics (`device_metrics`) → `AVG`/`MAX`, never `SUM`.
3. Rates are ratio-of-sums (`SUM(x)/SUM(y)`), never an average of percentages.
4. All heartbeat-recency windows must compare against **IST now**
   (`TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 330 MINUTE)`), because
   `LastTimeStamp` was shifted to IST at load time.

## Where joins happen — Apps Script level

**Every BigQuery statement in `Queries.js` is a single-table read.** Multi-source
combining happens in Apps Script via `src/server/Join.js` (hash-join utilities):

1. Each side is **pre-aggregated in its own query** to one row per join key
   (e.g. `centerDevices`, `centerGeo`, `centerTickets` — each ≤ ~5k rows).
2. The sources are fetched in parallel, then `leftJoin()`-ed in JS
   (see `getCenter360RowsCD_` in `EditionCD.js` — the live path; `Api.js`'s
   `getCenter360Rows_` is the retired legacy equivalent); filtering/sorting/paging
   run over the joined rows, and the result is cached (chunked gzip, 30 min).
3. This is also how a Jira device's center gets resolved — `jira_data`'s `summary` column has
   no shared key with `cloud_devices`/`center_details`, only a serial that must be regex-parsed
   and matched in JS (`deviceCenterMap_`, `Numbers.js`) — a case SQL alone can't express.

Golden rule: **aggregate first, join small.** Never pull raw fact tables into
Apps Script — 84k Zoho rows don't fit the runtime; 5k aggregated center rows do.

> Note for the record: read access IS sufficient to run `JOIN`s inside a
> BigQuery `SELECT` (verified with this project's service account — a join is
> still a read; only `CREATE VIEW`/materialization needs write). App-level
> joins are this project's chosen pattern, not a permission requirement.

## Upstream lineage (reference only — runs in `tricogde-dwh`, not from this app)

- `sql/centers_details.lineage.sql` — the rich centers dimension (DIM_Centers +
  usage stats + billing + configs). **Now materialized in the sandbox as `center_details`
  and wired in as the sole center source (v4.4).** The sandbox copy has 70 columns but is
  missing the derivation's `DeviceID`/`MacSerialID` — `deviceCenterMap_()` is pre-wired to
  use them the moment DE reloads the table with those columns.
- `sql/cloud_devices.lineage.sql` — heartbeat JSON explode + IST shift.
- `sql/zoho_data.lineage.sql` — Zoho tickets enriched with center/hub/segment/manager fields.
- `sql/jira_data.lineage.sql` — jira issues LEFT JOIN changelog (the fan-out source).
