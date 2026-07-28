'use strict';

/**
 * Thin wrapper around @google-cloud/bigquery for the reconciliation suite.
 * This is a DIFFERENT credential mechanism from the rest of the repo's ad
 * hoc verification scripts, which shell out to the `bq` CLI and read
 * CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE (a gcloud/bq-CLI-specific env var
 * the npm client does not know about). This wrapper uses the Node client
 * library directly, which reads the STANDARD env var:
 *
 *   GOOGLE_APPLICATION_CREDENTIALS = <path to a service-account JSON key>
 *
 * Project + dataset are read from the real Config.js (via loadGas) by
 * default — so this harness always tests whatever BigQuery target the app
 * is actually configured to hit. Two env vars let a run override that,
 * without ever hardcoding a project/dataset into a checked-in test file:
 *
 *   QA_BQ_PROJECT_OVERRIDE, QA_BQ_DATASET_OVERRIDE
 *
 * (Used during this harness's own development to self-verify against the
 * sandbox project, since the DWH service-account key wasn't available in
 * that environment — see docs/superpowers/specs/2026-07-28-testing-harness-design.md.)
 *
 * If GOOGLE_APPLICATION_CREDENTIALS isn't set, hasCredentials() returns
 * false and callers should skip (not fail) — most local/CI runs won't have
 * this key until someone deliberately adds it.
 */

const { BigQuery } = require('@google-cloud/bigquery');
const { loadGas } = require('./loadGas');

function hasCredentials() {
  return !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
}

/**
 * Reads BQ_PROJECT_ID/BQ_DATASET via loadGas (which applies the
 * QA_BQ_*_OVERRIDE env vars itself — see loadGas.js) so this always agrees
 * with whatever project/dataset a test file's own loadGas(['Config.js', ...])
 * call generated SQL against.
 */
function resolveTarget() {
  const sandbox = loadGas(['Config.js']);
  return { project: sandbox.CONFIG.BQ_PROJECT_ID, dataset: sandbox.CONFIG.BQ_DATASET };
}

let client = null;
function getClient() {
  if (!client) {
    const target = resolveTarget();
    client = new BigQuery({ projectId: target.project });
  }
  return client;
}

/**
 * Runs a SQL string (as produced by the app's own query-spec builders) and
 * returns the row array. Rejects if GOOGLE_APPLICATION_CREDENTIALS is unset
 * — callers should check hasCredentials() first and skip gracefully.
 * @param {string} sql
 * @returns {Promise<Array<Object>>}
 */
async function runQuery(sql) {
  if (!hasCredentials()) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS not set — call hasCredentials() first and skip.');
  }
  const [rows] = await getClient().query({ query: sql, useLegacySql: false });
  return rows;
}

module.exports = { hasCredentials: hasCredentials, resolveTarget: resolveTarget, runQuery: runQuery };
