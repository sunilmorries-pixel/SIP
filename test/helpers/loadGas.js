'use strict';

/**
 * Evaluates a set of Apps Script source files (from src/server/*.js) into an
 * isolated sandbox and returns their combined global scope. This is how the
 * project's ad hoc BQ-verification scripts have worked all along (eval
 * Config.js + Queries.js + ... in Node, then call the exposed functions) —
 * this just formalizes that pattern into a reusable, testable helper.
 *
 * Apps Script files declare functions/vars as bare top-level statements (no
 * module.exports, no require) and execute alphabetically in the real
 * runtime — so a file must never depend on another file's globals in its
 * own top-level statements. That constraint is exactly what makes this
 * eval-based loading safe: load order here only needs to satisfy runtime
 * (function-call-time) dependencies, not top-level ones.
 *
 * None of Config.js / Queries.js / EditionCD.js / SlaCatalog.js / Numbers.js
 * (the SQL-generating + pure-logic files) call any Apps Script service
 * (CacheService, PropertiesService, UrlFetchApp, SpreadsheetApp) at the
 * paths this harness exercises — verified by grep before writing this
 * helper. The stubs below exist only as a defensive backstop in case a
 * future file addition needs them; if a real test starts throwing on a
 * missing service, extend the stub rather than widen what gets eval'd.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SERVER_DIR = path.join(__dirname, '..', '..', 'src', 'server');

/**
 * @param {string[]} fileNames e.g. ['Config.js', 'Queries.js', 'EditionCD.js']
 * @returns {Object} the sandbox's global scope — every top-level function/var
 *   the loaded files declared, callable directly (e.g. sandbox.cdFilter_()).
 */
function loadGas(fileNames) {
  const sandbox = {
    // Defensive no-op stubs — see file header. Extend here, not by eval'ing
    // more files, if a genuinely-needed service call surfaces.
    Logger: { log: function () {} },
    CacheService: { getScriptCache: function () { return null; } },
    PropertiesService: { getScriptProperties: function () { return { getProperty: function () { return null; } }; } },
    console: console,
  };
  vm.createContext(sandbox);

  fileNames.forEach(function (fileName) {
    const filePath = path.join(SERVER_DIR, fileName);
    const source = fs.readFileSync(filePath, 'utf8');
    try {
      vm.runInContext(source, sandbox, { filename: filePath });
    } catch (err) {
      err.message = 'loadGas: failed evaluating ' + fileName + ' — ' + err.message;
      throw err;
    }
  });

  // Applied HERE (not in test/helpers/bq.js) so every sandbox that includes
  // Config.js gets a consistent override — a test file's own loadGas() call
  // and bq.js's internal one would otherwise disagree on which BQ
  // project/dataset is "real", generating SQL for one project while the
  // client connects to another. See docs/superpowers/specs/
  // 2026-07-28-testing-harness-design.md for why this override exists at
  // all (self-verifying against the sandbox project pre-DWH-credential).
  if (sandbox.CONFIG) {
    if (process.env.QA_BQ_PROJECT_OVERRIDE) sandbox.CONFIG.BQ_PROJECT_ID = process.env.QA_BQ_PROJECT_OVERRIDE;
    if (process.env.QA_BQ_DATASET_OVERRIDE) sandbox.CONFIG.BQ_DATASET = process.env.QA_BQ_DATASET_OVERRIDE;
  }

  return sandbox;
}

module.exports = { loadGas: loadGas, SERVER_DIR: SERVER_DIR };
