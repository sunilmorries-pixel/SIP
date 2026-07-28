'use strict';

/**
 * Reconciliation suite: runs the app's own query-spec builders against
 * live BigQuery and checks structural invariants (grain, sums, bounds) —
 * NOT hardcoded business values, which drift as real data changes.
 * Needs GOOGLE_APPLICATION_CREDENTIALS set; tests skip (not fail) when it
 * isn't, so this is safe to run in environments without that key.
 * --runInBand (see package.json) because BigQuery billing/quota is
 * per-project, not per-worker — no benefit to parallelizing these.
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test/reconcile'],
  testMatch: ['**/*.test.js'],
  testTimeout: 30000,
};
