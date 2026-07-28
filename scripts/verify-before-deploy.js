#!/usr/bin/env node
'use strict';

/**
 * Manual pre-deploy gate: run this before `clasp deploy` to catch a
 * data-shape regression before it reaches production.
 *
 * This is NOT wired into any git hook (no pre-commit/pre-push) — it's an
 * opt-in step a person runs by hand (`npm run verify-before-deploy`) as
 * part of the deploy convention documented in HANDOFF.md, right before
 * `clasp push --force` + `clasp deploy -i <stable-deployment-id> -d "..."`.
 *
 * What it does: runs `npm run test:all`, which is the fast unit suite
 * (test/unit/, no network) followed by the live-BigQuery reconciliation
 * suite (test/reconcile/). See
 * docs/superpowers/specs/2026-07-28-testing-harness-design.md for the full
 * design rationale (in particular: why a two-tier suite exists at all, and
 * why reconciliation tests assert independently-computed ground truth
 * rather than loose bounds).
 *
 * Exit codes:
 *   0 — everything passed (or the reconciliation tier legitimately skipped
 *       because no BigQuery credential is configured locally — see the
 *       warning printed below in that case).
 *   1 — `npm run test:all` failed (either tier).
 */

const { spawnSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

function main() {
  const result = spawnSync('npm', ['run', 'test:all'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32', // npm is a .cmd shim on Windows
  });

  if (result.error) {
    console.error('\n[verify-before-deploy] Failed to launch `npm run test:all`: ' + result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(
      '\n[verify-before-deploy] FAILED — one or both test tiers reported failures.\n' +
      '  Do NOT run `clasp deploy` until this passes. Scroll up for the failing test(s).\n'
    );
    process.exit(result.status || 1);
  }

  // Both tiers reported success (jest exits 0 when a suite\'s tests all
  // pass OR all skip — it does not distinguish "ran and passed" from
  // "skipped entirely" in its own exit code). Warn separately when the
  // reconciliation tier didn't actually check anything against live data,
  // since that's the tier a data-shape regression would actually be caught by.
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.warn(
      '\n[verify-before-deploy] WARNING: the reconciliation tier (test/reconcile/) skipped\n' +
      '  every test — GOOGLE_APPLICATION_CREDENTIALS is not set in this shell, so\n' +
      '  test/helpers/bq.js\'s hasCredentials() made every reconcile test describe.skip\n' +
      '  itself. This run only verified the fast unit tier; it did NOT check the app\'s\n' +
      '  queries against live BigQuery.\n' +
      '\n' +
      '  To actually run the reconciliation tier before deploying:\n' +
      '    1. Get the service-account JSON key for the tricogde-dwh project (the one\n' +
      '       Config.js currently points BQ_PROJECT_ID/BQ_DATASET at — NOT the sandbox\n' +
      '       key at credentials/abi_team_sip_bq_access_service_account.json, which only\n' +
      '       has access to the retired magnaquest-sand-box project).\n' +
      '    2. Set GOOGLE_APPLICATION_CREDENTIALS to that file\'s path, e.g. (PowerShell):\n' +
      '         $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\\path\\to\\tricogde-dwh-key.json"\n' +
      '       Note this is the standard Google Node client-library env var — it is a\n' +
      '       DIFFERENT mechanism from this repo\'s existing ad hoc `bq` CLI scripts\n' +
      '       (scripts/explore_bigquery.ps1 etc.), which read\n' +
      '       CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE instead. Setting one does not set\n' +
      '       the other.\n' +
      '    3. Re-run `npm run verify-before-deploy` (or `npm run test:reconcile` directly).\n'
    );
    console.log('[verify-before-deploy] PASSED (unit tier only — reconciliation tier skipped, see warning above).');
    process.exit(0);
  }

  console.log('\n[verify-before-deploy] PASSED — unit tests and live-BigQuery reconciliation both green. Safe to deploy.');
  process.exit(0);
}

main();
