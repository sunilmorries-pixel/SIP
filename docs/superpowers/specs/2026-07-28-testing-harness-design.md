# Two-Tier Test Harness (Unit + Live-BigQuery Reconciliation) — Design

**Date:** 2026-07-28
**Status:** Shipped (harness core + reconciliation suite already existed going into this
pass; this covers CI wiring, the pre-deploy gate script, and this doc)
**Scope:** `test/`, `jest.config.js`, `jest.reconcile.config.js`, `.github/workflows/test.yml`,
`scripts/verify-before-deploy.js`.

## 1. Problem

No test framework existed in this repo before this harness. Every release relied entirely on
manual click-through verification and code review. That was not a hypothetical gap: the
`active_deployments` KPI bug (`centerKpis` counting `COUNTIF(deactivationdate IS NULL)` over
`center_details`' duplicated *rows* instead of `COUNT(DISTINCT IF(..., CenterID, NULL))` —
row-grain instead of center-grain) rendered **"140% of centers"** on the live Centers page and
passed through **nine independent code reviews** before it was caught and fixed on 2026-07-16
(commit `b8f8725`). Reviews read diffs; they don't reconcile a rendered number against its own
source data. Nothing in the toolchain would have caught this class of bug automatically.

## 2. The two-tier design

- **`test/unit/`** — fast, pure-JS, no network, no credentials. Runs on every push. This is
  what `npm test` (`jest --config jest.config.js`) runs.
- **`test/reconcile/`** — hits live BigQuery, running the app's own query-spec builders
  (`buildDashboardQuerySpecsCD` etc.) and asserting **structural invariants** — grain, bounds,
  SQL-shape regression guards, and (where feasible) exact ground truth — **not hardcoded
  business values**, since real data drifts day to day and a hardcoded expected number would
  itself become a maintenance burden or, worse, get "fixed" to match a regression. This is
  `npm run test:reconcile` (`jest --config jest.reconcile.config.js`), and needs
  `GOOGLE_APPLICATION_CREDENTIALS` set. Currently covers `center-grain.test.js` (structural
  invariants) and `known-regressions.test.js` (pinned historical bugs) — both Centers-page
  only; see §5.
- `npm run test:all` runs both tiers sequentially and is what
  `scripts/verify-before-deploy.js` shells out to.

Each `describe` block in `test/reconcile/*.test.js` wraps itself in
`hasCredentials() ? describe : describe.skip` (via `test/helpers/bq.js`), so running
`npm run test:reconcile` with no credentials configured reports every test as skipped, not
failed — safe to run (or to have CI run) in any environment, credentialed or not.

## 3. The credential model — two mechanisms, deliberately not unified

`test/helpers/bq.js` uses the Node `@google-cloud/bigquery` client directly, which reads the
standard client-library env var:

```
GOOGLE_APPLICATION_CREDENTIALS = <path to a service-account JSON key>
```

This is a **different mechanism** from this repo's existing ad hoc verification scripts
(`scripts/explore_bigquery.ps1`, and the "Local BigQuery verification" pattern documented in
`HANDOFF.md` §2), which shell out to the `bq` CLI and read
`CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE` — a gcloud/bq-CLI-specific env var. The two are not
interchangeable and setting one does not set the other: the Node client library has no
knowledge of gcloud's CLI configuration or its env vars, and the `bq` CLI does not read
`GOOGLE_APPLICATION_CREDENTIALS` the way Google's client libraries do. Anyone running this
harness locally needs to set `GOOGLE_APPLICATION_CREDENTIALS` specifically — exporting
`CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE` (as the existing ad hoc scripts document) has no effect
on `npm run test:reconcile`.

`test/helpers/bq.js` reads the actual BigQuery project/dataset to target from the real
`Config.js` (via `loadGas`), so the harness always tests whatever target the app itself is
configured to hit — currently `tricogde-dwh.abi_tables`. Two optional env vars,
`QA_BQ_PROJECT_OVERRIDE` / `QA_BQ_DATASET_OVERRIDE`, let a run point elsewhere without ever
hardcoding a project/dataset into a checked-in test file; these were used during this harness's
own development to self-verify against the sandbox project, since the DWH service-account key
wasn't available in that environment.

## 4. Lesson learned: bounds aren't enough — prefer independently-computed ground truth

`test/reconcile/known-regressions.test.js` documents this directly (quoted, not paraphrased):

> A bound check (`active_deployments <= centers`) is NOT sufficient here: post-v5.10 (baseline
> filter removed, `0c851b1`), `centers` is the full 27,410-row universe, so the historical bug's
> inflated row count (25,863) sits UNDER that ceiling even though it's still wrong versus the
> true distinct-active-center count (18,490) — a bound check alone would silently pass this
> exact regression today. Verified by hand 2026-07-28: `COUNTIF(deactivationdate IS NULL)` =
> 25,863 vs `COUNT(DISTINCT IF(...))` = 18,490 vs `total_centers` = 27,410 — the bug reproduces
> and a `<=` check does not catch it.
>
> So this asserts EXACT equality against ground truth computed by a query written
> independently here, not derived from the app's own `cdFilter_()`/`T()` helpers — a bug shared
> between the app's SQL and this test's "expected" side would otherwise cancel out and prove
> nothing.

`test/reconcile/center-grain.test.js`'s `active_deployments <= centers` check
(`centerKpis: active_deployments <= centers`) was written first, as a structural invariant that
should hold regardless of live data. It is still a useful guard for *some* row-inflation shapes
— but it was written before the v5.10 baseline-filter removal changed what "centers" means in
this codebase, and that later, unrelated change silently widened the ceiling enough that the
original historical bug would no longer trip it. A loose bound's validity can be quietly
invalidated by a change elsewhere in the system that has nothing to do with the bound itself.

**General principle for anyone adding future reconciliation tests:** prefer an
independently-computed expected value over a loose bound wherever it's feasible to write one.
Bounds are still worth keeping as a cheap first line of defense (they catch a wider class of
"obviously wrong" shapes and don't require re-deriving ground truth for every metric), but
don't rely on a bound alone to catch a *specific* known regression — pin that one with an exact,
independently-computed value instead, the way `known-regressions.test.js` does.

## 5. What's NOT covered yet / open follow-ups

- **No GitHub secret yet.** `.github/workflows/test.yml`'s `reconciliation-tests` job looks for
  a repo secret named `BQ_SERVICE_ACCOUNT_KEY` (base64-encoded service-account JSON) and no-ops
  gracefully if it's absent. Someone needs to base64-encode the correct key — the
  **`tricogde-dwh`** service-account key (per `Config.js`, the project this app actually reads
  from today) — and add it as that repo secret. **Do NOT** use the old
  `credentials/abi_team_sip_bq_access_service_account.json` sandbox key: it only has access to
  the retired `magnaquest-sand-box` project and would make every reconciliation test fail (wrong
  project, not "no credentials").
- **Reconciliation coverage is Centers-page only** (`center-grain.test.js` +
  `known-regressions.test.js`). Extending it to other pages' KPIs (Asset, Support/CS, Overview,
  Map, Top Customers, Numbers, Raw Data) is future work, to be done as each page's metrics get
  confirmed via the project's existing page-by-page review process (see `HANDOFF.md` §6) — not
  attempted in this pass.
- `scripts/verify-before-deploy.js` is a manual, opt-in gate (`npm run verify-before-deploy`),
  not wired into any git hook. Whether to add a pre-push hook later is an open question, not
  decided here.
