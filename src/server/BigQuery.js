/**
 * BigQuery.js — thin, safe query layer over the BigQuery REST API.
 *
 * Design decisions:
 *  - Uses jobs.query (synchronous) with a generous timeout; polls
 *    getQueryResults only if the job is still running.
 *  - Named query parameters everywhere user input touches SQL — never
 *    string-concatenate untrusted values.
 *  - runQueriesParallel() fans out with UrlFetchApp.fetchAll so a 12-query
 *    dashboard loads in one round-trip's worth of wall time.
 *  - Result pagination: pass { maxRows } (or spec.maxRows) to page through
 *    pageToken and pull more than one page — used by the Apps Script-level
 *    join layer, which needs full (aggregated) source tables.
 *  - Rows come back as arrays of plain objects with real JS numbers.
 */

/**
 * jobs.query endpoint. A function (not a top-level const) because Apps Script
 * executes files alphabetically — top-level code here would run before
 * Config.gs defines CONFIG.
 * @return {string}
 */
function bqEndpoint_() {
  return 'https://bigquery.googleapis.com/bigquery/v2/projects/' +
    CONFIG.BQ_PROJECT_ID + '/queries';
}

/**
 * Builds the jobs.query request payload.
 * @param {string} sql
 * @param {Object<string,(string|number)>=} params named query parameters
 * @param {number=} maxRows result page size — MUST match the caller's row
 *   target: with the old fixed 1000, a 27k-row query needed ~28 SEQUENTIAL
 *   pageToken fetches (~8-12s); one big page is 1-2 fetches (BQ caps a page
 *   at ~10MB regardless, so large values are safe).
 * @return {Object}
 */
function buildQueryPayload_(sql, params, maxRows) {
  var payload = {
    query: sql,
    useLegacySql: false,
    timeoutMs: 45000,
    maxResults: maxRows || CONFIG.MAX_ROWS
  };
  if (params && Object.keys(params).length) {
    payload.parameterMode = 'NAMED';
    payload.queryParameters = Object.keys(params).map(function (name) {
      var value = params[name];
      var type = (typeof value === 'number')
        ? (value % 1 === 0 ? 'INT64' : 'FLOAT64')
        : 'STRING';
      return {
        name: name,
        parameterType: { type: type },
        parameterValue: { value: String(value) }
      };
    });
  }
  return payload;
}

/**
 * Converts a BigQuery REST response into an array of row objects,
 * coercing INTEGER/FLOAT/BOOLEAN fields to native JS types.
 * @param {Object} data raw jobs.query / getQueryResults response
 * @return {Array<Object>}
 */
function parseRows_(data) {
  if (!data.rows || !data.schema) return [];
  var fields = data.schema.fields;
  return data.rows.map(function (row) {
    var obj = {};
    row.f.forEach(function (cell, i) {
      var field = fields[i];
      var v = cell.v;
      if (v !== null && v !== undefined) {
        if (field.type === 'INTEGER') v = parseInt(v, 10);
        else if (field.type === 'FLOAT' || field.type === 'NUMERIC') v = parseFloat(v);
        else if (field.type === 'BOOLEAN') v = (v === 'true' || v === true);
      }
      obj[field.name] = v;
    });
    return obj;
  });
}

/**
 * Runs one query synchronously. Prefer runQueriesParallel() for batches.
 * @param {string} sql
 * @param {Object=} params
 * @param {{maxRows:(number|undefined)}=} options page past CONFIG.MAX_ROWS
 * @return {Array<Object>} rows
 */
function runQuery(sql, params, options) {
  var maxRows = (options && options.maxRows) || CONFIG.MAX_ROWS;
  var response = UrlFetchApp.fetch(bqEndpoint_(), {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + getBigQueryAccessToken() },
    payload: JSON.stringify(buildQueryPayload_(sql, params, maxRows)),
    muteHttpExceptions: true
  });
  var data = validateResponse_(response);
  return collectRows_(data, maxRows);
}

/**
 * Runs many queries in parallel with fetchAll.
 * @param {Array<{key:string, sql:string, params:(Object|undefined),
 *                maxRows:(number|undefined)}>} specs
 * @return {Object<string, Array<Object>>} map of key → rows
 */
function runQueriesParallel(specs) {
  var token = getBigQueryAccessToken();
  var endpoint = bqEndpoint_();
  var requests = specs.map(function (spec) {
    return {
      url: endpoint,
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify(buildQueryPayload_(spec.sql, spec.params, spec.maxRows)),
      muteHttpExceptions: true
    };
  });
  var responses = UrlFetchApp.fetchAll(requests);
  var out = {};
  responses.forEach(function (response, i) {
    try {
      var data = validateResponse_(response);
      out[specs[i].key] = collectRows_(data, specs[i].maxRows || CONFIG.MAX_ROWS);
    } catch (err) {
      // One failed panel must not sink the whole dashboard.
      console.error('Query "' + specs[i].key + '" failed: ' + err.message);
      out[specs[i].key] = null;
    }
  });
  return out;
}

/**
 * Validates an HTTP response and waits out still-running jobs.
 * @param {GoogleAppsScript.URL_Fetch.HTTPResponse} response
 * @return {Object} completed jobs.query response data
 */
function validateResponse_(response) {
  var code = response.getResponseCode();
  var data = JSON.parse(response.getContentText());
  if (code >= 400) {
    var message = (data.error && data.error.message) || ('HTTP ' + code);
    throw new Error('BigQuery error: ' + message);
  }
  if (data.jobComplete === false) {
    data = pollForResults_(data.jobReference);
  }
  return data;
}

/**
 * Parses the first page and follows pageToken until maxRows or exhaustion.
 * @param {Object} data completed first-page response
 * @param {number} maxRows
 * @return {Array<Object>}
 */
function collectRows_(data, maxRows) {
  var rows = parseRows_(data);
  var pageToken = data.pageToken;
  var token = pageToken ? getBigQueryAccessToken() : null; // one token for all pages
  while (pageToken && rows.length < maxRows) {
    var page = fetchResultsPage_(data.jobReference, pageToken, maxRows, token);
    rows = rows.concat(parseRows_(page));
    pageToken = page.pageToken;
  }
  return rows.length > maxRows ? rows.slice(0, maxRows) : rows;
}

/**
 * getQueryResults for one page (used for pagination and slow-job polling).
 * @param {Object} jobReference
 * @param {?string} pageToken
 * @param {number=} maxRows page size (defaults to CONFIG.MAX_ROWS)
 * @param {string=} token reuse an already-fetched bearer token
 * @return {Object}
 */
function fetchResultsPage_(jobReference, pageToken, maxRows, token) {
  var url = 'https://bigquery.googleapis.com/bigquery/v2/projects/' +
    CONFIG.BQ_PROJECT_ID + '/queries/' + jobReference.jobId +
    '?timeoutMs=30000&maxResults=' + (maxRows || CONFIG.MAX_ROWS) +
    (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '') +
    (jobReference.location ? '&location=' + jobReference.location : '');
  var response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + (token || getBigQueryAccessToken()) },
    muteHttpExceptions: true
  });
  var data = JSON.parse(response.getContentText());
  if (response.getResponseCode() >= 400) {
    throw new Error('BigQuery error: ' +
      ((data.error && data.error.message) || 'page fetch failed'));
  }
  return data;
}

/**
 * Polls getQueryResults for a slow job (rare with 45s timeout).
 * @param {Object} jobReference
 * @return {Object} completed response
 */
function pollForResults_(jobReference) {
  for (var attempt = 0; attempt < 4; attempt++) {
    var data = fetchResultsPage_(jobReference, null);
    if (data.jobComplete !== false) return data;
    Utilities.sleep(1500);
  }
  throw new Error('BigQuery query timed out after polling.');
}

/* ═══════════════════════ caching helpers ════════════════════════════════ */

/**
 * Cache wrapper: returns cached JSON for `key` or computes, stores, returns.
 * CacheService values are capped at 100KB — use withCacheLarge for bigger
 * payloads (e.g. joined source tables).
 * @param {string} key
 * @param {function():*} producer
 * @param {boolean=} bypass force recompute
 * @return {*}
 */
function withCache(key, producer, bypass) {
  var cache = CacheService.getScriptCache();
  if (!bypass) {
    var hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  }
  var value = producer();
  try {
    cache.put(key, JSON.stringify(value), CONFIG.CACHE_TTL_SECONDS);
  } catch (err) {
    console.warn('Cache put skipped (payload too large?): ' + err.message);
  }
  return value;
}

/**
 * Large-object cache: gzip + base64 + chunking around CacheService's 100KB
 * per-key limit. Used for joined source tables (thousands of rows).
 * @param {string} key
 * @param {*} value JSON-serialisable
 * @param {number} ttlSeconds
 */
function cachePutLarge(key, value, ttlSeconds) {
  try {
    var b64 = Utilities.base64Encode(
      Utilities.gzip(Utilities.newBlob(JSON.stringify(value))).getBytes());
    var chunkSize = 90000; // chars, < 100KB per key
    var kv = {};
    var n = 0;
    for (var i = 0; i < b64.length; i += chunkSize, n++) {
      kv[key + '#' + n] = b64.substr(i, chunkSize);
    }
    kv[key + '#meta'] = String(n);
    CacheService.getScriptCache().putAll(kv, ttlSeconds);
  } catch (err) {
    console.warn('cachePutLarge skipped: ' + err.message);
  }
}

/**
 * @param {string} key
 * @return {*} cached value or null
 */
function cacheGetLarge(key) {
  var cache = CacheService.getScriptCache();
  var meta = cache.get(key + '#meta');
  if (!meta) return null;
  var n = parseInt(meta, 10);
  var keys = [];
  for (var i = 0; i < n; i++) keys.push(key + '#' + i);
  var got = cache.getAll(keys);
  var b64 = '';
  for (i = 0; i < n; i++) {
    var chunk = got[key + '#' + i];
    if (!chunk) return null; // a chunk expired — treat as miss
    b64 += chunk;
  }
  try {
    var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip');
    return JSON.parse(Utilities.ungzip(blob).getDataAsString());
  } catch (err) {
    return null;
  }
}

/**
 * Stable short hash for cache keys.
 * @param {string} text
 * @return {string}
 */
function shortHash(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text)
    .map(function (b) { return ((b + 256) % 256).toString(16).slice(-2); })
    .join('')
    .slice(0, 16);
}
