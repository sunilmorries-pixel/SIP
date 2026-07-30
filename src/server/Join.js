/**
 * Join.js — Apps Script-level join utilities.
 *
 * Why joins live here: every BigQuery statement in Queries.js is a
 * single-table read; multi-source combining happens in JS. This also lets
 * BigQuery results join against non-BigQuery sources (the Jira devices
 * Google Sheet) — something SQL alone can't do.
 *
 * Pattern: keep each side PRE-AGGREGATED in its source query (one row per
 * join key), then hash-join here. Never pull raw fact tables into Apps
 * Script — aggregate first, join small.
 */

/**
 * Indexes rows by key for O(1) lookups. First row per key wins — callers
 * must pre-aggregate so keys are unique.
 * @param {Array<Object>} rows
 * @param {string|function(Object):*} key column name or key extractor
 * @return {Object<string, Object>}
 */
function indexRows(rows, key) {
  var keyFn = (typeof key === 'function') ? key : function (r) { return r[key]; };
  var map = {};
  (rows || []).forEach(function (row) {
    var k = keyFn(row);
    if (k !== null && k !== undefined && !(k in map)) map[String(k)] = row;
  });
  return map;
}

/**
 * Left outer hash join. Every left row survives; matching right columns are
 * merged in via `select`.
 * @param {Array<Object>} left
 * @param {Array<Object>} right
 * @param {{leftKey:(string|function), rightKey:(string|function),
 *          select:function(Object, ?Object):Object}} opts
 *        select(leftRow, rightRowOrNull) → output row
 * @return {Array<Object>}
 */
function leftJoin(left, right, opts) {
  var rightIndex = indexRows(right, opts.rightKey);
  var leftKeyFn = (typeof opts.leftKey === 'function')
    ? opts.leftKey : function (r) { return r[opts.leftKey]; };
  return (left || []).map(function (row) {
    var match = rightIndex[String(leftKeyFn(row))] || null;
    return opts.select(row, match);
  });
}

/**
 * Generic in-memory sort for joined rows.
 * @param {Array<Object>} rows mutated in place, also returned
 * @param {string} column
 * @param {string} direction 'asc' | 'desc'
 * @return {Array<Object>}
 */
function sortRows(rows, column, direction) {
  var sign = direction === 'asc' ? 1 : -1;
  rows.sort(function (a, b) {
    var x = a[column], y = b[column];
    if (x === y) return 0;
    if (x === null || x === undefined || x === '') return 1;  // empties last
    if (y === null || y === undefined || y === '') return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign;
    return String(x).localeCompare(String(y)) * sign;
  });
  return rows;
}
