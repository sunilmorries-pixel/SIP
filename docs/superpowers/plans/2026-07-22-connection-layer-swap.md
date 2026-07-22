# tricogde-dwh Connection Layer Swap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Point every BigQuery read in the app at `tricogde-dwh.abi_tables` instead of
`magnaquest-sand-box.abi_team_sip_devtest_poc`, with zero other behavior changes, so the
live dashboard shows the new warehouse's numbers.

**Architecture:** Three `CONFIG` constants plus one OAuth2 service name. Every query already
reads through `CONFIG.BQ_PROJECT_ID`/`CONFIG.BQ_DATASET` (verified: zero hardcoded project/
dataset strings anywhere else in `src/server` or `src/client`), so no query-file changes are
needed for this plan. The isolated `SA_KEY_DWH` credential (already staged in Script
Properties, verified live-working via a temporary probe) becomes the app's primary
credential; the old `SA_KEY` is left untouched for instant rollback.

**Tech Stack:** Google Apps Script (V8), BigQuery REST API (`jobs.query`), OAuth2 for Apps
Script library, `clasp` for push.

## Global Constraints

- Every query file MUST keep referencing tables via `CONFIG.BQ_DATASET`/`T()` — never
  hardcode `tricogde-dwh` or `abi_tables` in a query file (spec §4: Config.js is the single
  source of truth).
- The `SA_KEY` Script Property and `magnaquest-sand-box` access must NOT be deleted or
  overwritten — it is the rollback path (spec §10).
- No filter/query-logic changes in this plan (that's the next plan). This plan changes ONLY
  the connection layer.
- Production stays on its pinned v34 deployment (`AKfycbwV6hHzDT1ZjkH49aFxVfoLF9wcFrBtv9FzrYzdd5RA9R3HAVOMcXrOgzwthI49KK7x`)
  until a separate, explicit redeploy step — nothing here touches that binding. All
  verification happens on the `@HEAD` test deployment
  (`https://script.google.com/a/macros/tricog.com/s/AKfycbyUlvvXqJo0f6z5LdqeSfarj9JnbvmnrcJf70Ciw0o/exec`).
- No unit-test framework exists in this codebase (plain Apps Script). "Testing" here follows
  the pattern already proven this session: `node --check` for syntax, live BigQuery
  round-trips via the Apps Script editor's Execution Log for behavior, and a manual
  click-through of the `@HEAD` URL for UI correctness.

---

### Task 1: Point Config.js at tricogde-dwh

**Files:**
- Modify: `src/server/Config.js:9,12,15`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CONFIG.BQ_PROJECT_ID = 'tricogde-dwh'`, `CONFIG.BQ_DATASET =
  'tricogde-dwh.abi_tables'`, `CONFIG.SA_PROPERTY_KEY = 'SA_KEY_DWH'` — read by `T()`
  (Queries.js), `bqEndpoint_()` (BigQuery.js), and `getBigQueryService()` (Auth.js).

- [ ] **Step 1: Make the three-line change**

Current (lines 7-15):
```js
var CONFIG = {
  /** GCP project that owns the BigQuery dataset AND is billed for queries. */
  BQ_PROJECT_ID: 'magnaquest-sand-box',

  /** Fully-qualified dataset prefix used in every query. */
  BQ_DATASET: 'magnaquest-sand-box.abi_team_sip_devtest_poc',

  /** Script Property key that holds the service-account JSON. */
  SA_PROPERTY_KEY: 'SA_KEY',
```

New:
```js
var CONFIG = {
  /**
   * GCP project that owns the BigQuery dataset AND is billed for queries.
   * Migrated 2026-07-22 from magnaquest-sand-box (dev/test) to tricogde-dwh
   * (production warehouse) — see docs/superpowers/specs/2026-07-22-tricogde-dwh-migration-design.md.
   * Rollback: revert this file; the old SA_KEY property and magnaquest-sand-box
   * access are untouched.
   */
  BQ_PROJECT_ID: 'tricogde-dwh',

  /** Fully-qualified dataset prefix used in every query. */
  BQ_DATASET: 'tricogde-dwh.abi_tables',

  /** Script Property key that holds the service-account JSON. */
  SA_PROPERTY_KEY: 'SA_KEY_DWH',
```

- [ ] **Step 2: Syntax-check**

Run: `node --check src/server/Config.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/server/Config.js
git commit -m "Point CONFIG at tricogde-dwh.abi_tables (connection layer swap, step 1/2)"
```

---

### Task 2: Rename the OAuth2 service in Auth.js to avoid stale-token reuse

**Why this is its own task and not folded into Task 1:** the OAuth2 library caches its
access token under a key derived from the service name passed to `createService()`. If the
service name stays `'BigQuery-SA'` while the underlying key material changes (Task 1 points
`SA_PROPERTY_KEY` at a different service account), the library could serve a stale cached
token issued for the *old* service account instead of authenticating fresh — a correctness
bug, not a style nit.

**Files:**
- Modify: `src/server/Auth.js:20`

**Interfaces:**
- Consumes: `CONFIG.SA_PROPERTY_KEY` (Task 1) — unchanged interface, just a different value.
- Produces: `getBigQueryService()` now creates/reads its OAuth2 service under the name
  `'BigQuery-DWH-SA'` (matching the naming already used by the verified-working temporary
  probe in `Diag.js`), guaranteeing a fresh token namespace with no collision.

- [ ] **Step 1: Change the service name**

Current (line 20):
```js
  return OAuth2.createService('BigQuery-SA')
```

New:
```js
  // Renamed from 'BigQuery-SA' during the 2026-07-22 tricogde-dwh migration: a
  // different service name guarantees a fresh OAuth2 token cache, so no stale
  // token issued for the old magnaquest-sand-box service account can be reused.
  return OAuth2.createService('BigQuery-DWH-SA')
```

- [ ] **Step 2: Syntax-check**

Run: `node --check src/server/Auth.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/server/Auth.js
git commit -m "Rename OAuth2 service to avoid stale-token reuse (connection layer swap, step 2/2)"
```

---

### Task 3: Push and verify the production auth/query chain end-to-end

**Why this is its own task:** Tasks 1-2 cannot be verified by syntax-checking alone — the
real proof is a live BigQuery round-trip through the actual production code path
(`getBigQueryAccessToken()` → `runQuery()`), not the isolated `Diag.js`-only credential used
during earlier investigation. Because `Auth.js`/`BigQuery.js` are 100% `CONFIG`-driven (no
other file needs to change), the *existing* diagnostic functions `diagServiceAccountEmail()`
and `diagCenterCounts()` (already live on the script) will automatically target the new
warehouse the moment this push lands — no new diagnostic code needed.

**Files:** none (push + live verification only).

- [ ] **Step 1: Push**

Run: `clasp push -f` (from the repo root, with `.clasp.json` pointing at the `sip` project,
`scriptId: 1AH4QA5XQf4bw0mQCOVL8KXXgBzfd_LXR8EhT5Bzt1KtRqf6ufUrwwOeG`).
Expected: file list printed, no error.

- [ ] **Step 2: Verify the credential switched**

In the Apps Script editor, select `diagServiceAccountEmail` in the function dropdown → Run.
Expected Execution Log line:
```
Service account: abi-team-prod-bq-access@tricogde-dwh.iam.gserviceaccount.com
```
(Previously this logged `abi-poc-bq-access-sa@magnaquest-sand-box.iam.gserviceaccount.com`
— any other output means Task 1 or 2 has a mistake; stop and re-check before continuing.)

- [ ] **Step 3: Verify the query chain reads the new warehouse**

Select `diagCenterCounts` → Run. Expected: log lines succeed (no `BigQuery error`/`auth
failed` messages) and `CENTER COUNTS` reports `all_centers` in the ~36,5xx range (the old
dataset reported 27,410 distinct centers as of 2026-07-15 — any value at or near 27,410
means the swap did not take effect; a `tricogde-dwh:abi_tables` name in any error message
is expected and fine, it just means a transient query issue, not a wrong-dataset issue).

- [ ] **Step 4: If either check fails, stop and debug before proceeding**

Do not continue to Task 4 with a failing credential or dataset check — Task 4 clears caches
and is harder to cleanly undo than re-editing two lines of source.

---

### Task 4: Clear caches and visually verify on the `@HEAD` test URL

**Files:** none (operational step + manual verification).

- [ ] **Step 1: Clear stale cached payloads**

In the Apps Script editor, select `clearDashboardCache` → Run. Expected: completes without
error (it internally calls `runQuery`, which now targets `tricogde-dwh`, so the segment
slugs it computes going forward are already the new warehouse's).

- [ ] **Step 2: Open the HEAD test deployment**

Navigate to:
```
https://script.google.com/a/macros/tricog.com/s/AKfycbyUlvvXqJo0f6z5LdqeSfarj9JnbvmnrcJf70Ciw0o/exec
```

- [ ] **Step 3: Click through every tab**

Overview, Asset, Centers/Customers, Support/CS, Map, Top Customers, Numbers, Raw Data.
Expected: 0 browser console errors; every KPI tile and table renders (no "—" placeholders
beyond genuinely-empty fields); the Centers KPI and Numbers-page reconciliation counts read
in the ~36,5xx range, not 18,370 or 27,410.

- [ ] **Step 4: Confirm Raw Data pills still work**

Click through each existing pill (Center Details, Cloud Devices, Zoho Tickets, Jira Devices
(Sheet), CS Tracker (Sheet)) on the Raw Data page. Expected: the three BigQuery-backed pills
(Center Details, Cloud Devices, Zoho Tickets) load and paginate correctly against the new
warehouse; the two Sheet-backed pills behave exactly as before (still blocked on the Sheets
API — unaffected by this plan, expected).

This step is the direct, concrete answer to "I want to see it on the webpage, updated
numbers" — after Task 4, the numbers ARE the new warehouse's numbers, visible in a browser.

---

### Task 5: Sync documentation that names the old project/dataset

**Files:**
- Modify: `README.md:4`
- Modify: `docs/SOURCES.md:4`
- Modify: `docs/DATA_LOADING.md:5,77`
- Modify: `docs/DEPLOYMENT.md:110`
- Modify: `docs/ARCHITECTURE.md:18`

**Out of scope for this task:** `docs/AppsScript_BigQuery_Setup.md` is a full historical
setup runbook for the *old* project (role grants, full key-JSON example, curl examples) —
rewriting it properly is its own documentation task, not a quick line-sync. Leave it as a
historical record for now; do not edit it in this task.

- [ ] **Step 1: README.md**

Current (line 4):
```
dataset plus two Google Sheets: center reliability, revenue-at-risk, support-ticket flow
```
(the reference is on the line above — line 4 itself reads `Apps Script + BigQuery**. It
surfaces live insights from the \`abi_team_sip_devtest_poc\``)

New: replace `` `abi_team_sip_devtest_poc` `` with `` `tricogde-dwh.abi_tables` ``.

- [ ] **Step 2: docs/SOURCES.md**

Current (line 4): `` `magnaquest-sand-box.abi_team_sip_devtest_poc` plus **two Google Sheets** (a Jira ``

New: replace with `` `tricogde-dwh.abi_tables` plus **two Google Sheets** (a Jira ``

- [ ] **Step 3: docs/DATA_LOADING.md**

Current (line 5): `The dashboard reads from \`magnaquest-sand-box.abi_team_sip_devtest_poc\` (BigQuery) plus two`

New: `The dashboard reads from \`tricogde-dwh.abi_tables\` (BigQuery) plus two`

Current (line 77): `(verified: \`tricogde-dwh\` is Access Denied). Everything must land in \`abi_team_sip_devtest_poc\`.`

This line is now factually wrong (access was granted and verified live on 2026-07-22). New:
`(migrated 2026-07-22: tricogde-dwh access granted and verified live — see docs/superpowers/specs/2026-07-22-tricogde-dwh-migration-design.md). This is now the canonical source.`

- [ ] **Step 4: docs/DEPLOYMENT.md**

Current (line 110): `| Banner: *BigQuery auth failed* | SA lacks \`BigQuery Data Viewer\` + \`BigQuery Job User\` on \`magnaquest-sand-box\`, or key was rotated |`

New: `| Banner: *BigQuery auth failed* | SA lacks \`BigQuery Data Viewer\` + \`BigQuery Job User\` on \`tricogde-dwh\`, or key was rotated |`

- [ ] **Step 5: docs/ARCHITECTURE.md**

The diagram box (lines 16-20) is a fixed 25-character-wide inner content area (verified via
exact character count — every content line is 56 leading spaces + `│` + 2 spaces + content
+ padding spaces + `│`). Two lines change:

Current (line 18):
```
                                                        │  magnaquest-sand-box    │
```
New (line 18) — replace with:
```
                                                        │  tricogde-dwh           │
```

Current (line 19, dataset name truncated with an ellipsis because the old name didn't fit):
```
                                                        │  abi_team_sip_devtest…  │
```
New (line 19) — the new dataset name fits without truncation, so no ellipsis needed:
```
                                                        │  abi_tables             │
```
Both replacement lines are exactly 83 characters (matching the existing lines 17/20 —
verified with `Array.from(line).length` in Node, not a byte-count tool, since the original
ellipsis character is multi-byte in UTF-8).

- [ ] **Step 6: Commit**

```bash
git add README.md docs/SOURCES.md docs/DATA_LOADING.md docs/DEPLOYMENT.md docs/ARCHITECTURE.md
git commit -m "Sync docs to tricogde-dwh (connection layer swap)"
```

---

## Self-review (completed by the plan author before handoff)

1. **Spec coverage:** This plan implements spec §4 (Connection layer) in full. Spec §§5-7
   (filter removal, native asset pipeline, Raw Data pill reorder+swap) are explicitly
   deferred to follow-up plans — this plan's Goal statement says so, and Task 4 Step 4
   confirms the Sheet-backed pills are unaffected (§7's pill swap is NOT part of this plan).
2. **Placeholder scan:** no TBD/TODO; every step shows exact before/after code, exact
   commands, exact expected output.
3. **Type/name consistency:** `CONFIG.SA_PROPERTY_KEY` (Task 1) → consumed by
   `getBigQueryService()` (Task 2, unchanged signature) → exercised live by
   `diagServiceAccountEmail()`/`diagCenterCounts()` (Task 3, both pre-existing, unmodified).
   `'BigQuery-DWH-SA'` string is identical to the one already proven working in the
   temporary `Diag.js` probe (`runDwhQuery_`/`getDwhAccessToken_`) earlier this session.
4. **Scope check:** five tasks, each independently committable and verifiable; no task
   depends on unfinished work from a later task. This is appropriately one plan (not
   multiple independent subsystems) — it's a single, small, cohesive change.
