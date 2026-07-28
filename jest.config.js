'use strict';

/**
 * Default config: fast unit tests only, no network, no credentials needed.
 * Runs on every push. See jest.reconcile.config.js for the live-BigQuery
 * reconciliation suite (separate config so `npm test` never accidentally
 * tries to hit BigQuery).
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test/unit'],
  testMatch: ['**/*.test.js'],
};
