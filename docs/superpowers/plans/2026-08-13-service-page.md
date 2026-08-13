# Service Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Service tab from a "Data source not yet connected" placeholder into a working field-service operations page over `tricogde-dwh.abi_tables.servicewrk_Tickets`.

**Architecture:** One new server file (`src/server/ServiceWrk.js`) holds every ServiceWRK SQL builder plus two endpoints — `apiGetServiceCD` (KPIs + six charts, one cached payload) and `apiGetServiceTicketsCD` (paginated explorer). The client follows the existing Customers-page shape exactly: markup in `Index.html`, load/render in `App.html`, chart rendering in `Charts.html`. Filtering uses ServiceWRK's own `state`/`city`/`customer_category` columns, so the page never depends on a center join.

**Tech Stack:** Google Apps Script (ES5-style, `var` + `function`), BigQuery Standard SQL, ECharts via `Charts.html`, Jest for unit tests.

## Global Constraints

- ES5 style only in `src/server/*.js` and `src/client/*.html` — `var`, `function`, no arrow functions, no `const`/`let`, no template literals. Apps Script executes server files alphabetically, so a file must never reference another file's globals in a top-level statement.
- Endpoint names end in `CD` — the client's `ep()` (`App.html:86`) appends `CD` to every call.
- All endpoints return through `respond_(...)` and cache through `withCache(key, fn, bypass)`.
- Cache keys include `getCacheEpoch_()` and a filter hash, following `apiSearchCentersCD` in `EditionCD.js`.
- `customer_category` must route through `segmentGroupSql_(column, blankLabel)` — never compared raw. Standing rule from the 2026-08-04 segment merge.
- `TIMESTAMP` columns are formatted **in SQL** (`FORMAT_DATE`/`DATE`), never in JS: `collectRows_` returns them as epoch strings like `"1.7712E9"`.
- No dedupe CTE for ServiceWRK — `ticket_id` is unique (36,583 approx-distinct vs 36,403 rows). Do not copy `zohoDedupSql_`.
- Every TAT statistic excludes `tat_days_ < 0` and reports the excluded count.
- Verified figures the implementation must reproduce: 36,403 rows, 205 Open / 36,198 Closed, `CENTER_VISIT` 30,822, `OVERCALL_RESOLUTION` 5,259, `ticket_type = 'BREAKDOWN'` 870.

## File Structure

| File | Responsibility |
|---|---|
| `src/server/ServiceWrk.js` (create) | Every ServiceWRK SQL builder + both endpoints. One file because these change together. |
| `test/unit/servicewrk-helpers.test.js` (create) | Unit tests for the pure SQL-fragment builders. |
| `src/client/Index.html` (modify, §VIEW 4 at line 521) | Replace the placeholder panel with the KPI grid, six chart cards and the explorer table. |
| `src/client/App.html` (modify) | KPI tile shells, `loadService`/`renderService`, preview mock, tab hook, metric glossary. |
| `src/client/Charts.html` (modify) | Two new chart functions: `svcTatBands`, `svcResolution`. Everything else reuses existing helpers. |
| `src/server/Setup.js` (modify) | Add a ServiceWRK line to `diagnostics()`. |

---

### Task 1: ServiceWRK SQL fragment builders

Pure string builders with no BigQuery access — the testable core everything else composes.

**Files:**
- Create: `src/server/ServiceWrk.js`
- Test: `test/unit/servicewrk-helpers.test.js`

**Interfaces:**
- Consumes: `T(table)`, `multiCond_(column, values)`, `segClean_(s)`, `segmentGroupSql_(column, blankLabel)` — all from `Queries.js`.
- Produces: `swTable_()`, `swDateCond_(dateFrom, dateTo)`, `swFilterCond_(filters)`, `swTatValidCond_()`, `swTatBandSql_()`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/servicewrk-helpers.test.js`:

```javascript
'use strict';

/**
 * Unit tests for the ServiceWRK SQL-fragment builders (src/server/ServiceWrk.js).
 * Pure string transforms — no BigQuery, no network.
 *
 * Loaded with Config.js + SlaCatalog.js + Queries.js because ServiceWrk.js
 * calls T()/multiCond_/segmentGroupSql_/segClean_ at call time.
 */

const { loadGas } = require('../helpers/loadGas');

describe('ServiceWRK SQL helpers (ServiceWrk.js)', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'ServiceWrk.js']);
  });

  describe('swTable_', function () {
    test('resolves to the configured dataset', function () {
      expect(sandbox.swTable_()).toBe('`tricogde-dwh.abi_tables.servicewrk_Tickets`');
    });
  });

  describe('swDateCond_', function () {
    test('returns empty string when neither bound is set', function () {
      expect(sandbox.swDateCond_('', '')).toBe('');
    });

    test('emits a lower bound on created_on', function () {
      expect(sandbox.swDateCond_('2026-01-01', '')).toBe(
        " AND DATE(created_on) >= DATE('2026-01-01')");
    });

    test('emits both bounds when both are set', function () {
      expect(sandbox.swDateCond_('2026-01-01', '2026-06-30')).toBe(
        " AND DATE(created_on) >= DATE('2026-01-01')" +
        " AND DATE(created_on) <= DATE('2026-06-30')");
    });

    test('strips quotes from the date values before inlining them', function () {
      expect(sandbox.swDateCond_("2026-01-01'; DROP", '')).not.toContain("'; DROP");
    });
  });

  describe('swTatValidCond_', function () {
    test('excludes null and negative TAT', function () {
      expect(sandbox.swTatValidCond_()).toBe(
        ' AND tat_days_ IS NOT NULL AND tat_days_ >= 0');
    });
  });

  describe('swFilterCond_', function () {
    test('returns empty string for an empty filter set', function () {
      expect(sandbox.swFilterCond_({})).toBe('');
    });

    test('routes segments through segmentGroupSql_, not a raw comparison', function () {
      const cond = sandbox.swFilterCond_({ segments: ['LE'] });
      expect(cond).toContain('customer_category');
      expect(cond).toContain('CASE');
      expect(cond).toContain("'LE'");
    });

    test('filters state and city on ServiceWRKs own columns', function () {
      const cond = sandbox.swFilterCond_({ states: ['Odisha'], cities: ['Cuttack'] });
      expect(cond).toContain("IN ('Odisha')");
      expect(cond).toContain("IN ('Cuttack')");
    });

    test('ignores dimensions ServiceWRK cannot express', function () {
      const cond = sandbox.swFilterCond_({ hubs: ['H1'], centers: ['123'], statuses: ['ACTIVE'] });
      expect(cond).toBe('');
    });
  });

  describe('swTatBandSql_', function () {
    test('produces the five bands the client orders by', function () {
      const sql = sandbox.swTatBandSql_();
      ['Same day', '1-2d', '3-7d', '8-30d', '30d+'].forEach(function (band) {
        expect(sql).toContain("'" + band + "'");
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/unit/servicewrk-helpers.test.js`
Expected: FAIL — `Cannot find module` / `ServiceWrk.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/server/ServiceWrk.js`:

```javascript
/**
 * ServiceWrk.js — the Service page's data layer, over
 * `servicewrk_Tickets` (ServiceWRK field-service operations).
 *
 * WHY THIS TABLE IS NOT THE UPTIME SOURCE: Config.js and docs/SOURCES.md both
 * anticipated swapping M-A1's downtime CTE onto ServiceWRK once it landed.
 * The profiled data does not support that — created_on/closed_date are
 * date-only (886 distinct values across ~947 days), only 870 of 36,403 rows
 * are ticket_type='BREAKDOWN', and coverage starts 2024-01-08 while center
 * `life` reaches years further back. See
 * docs/superpowers/specs/2026-08-13-service-tom-pages-design.md §4.1.
 * The uptime engine stays on the Zoho proxy. Do not "fix" this.
 *
 * NO DEDUPE CTE: ticket_id is unique (36,583 approx-distinct vs 36,403 rows),
 * unlike zoho_data which needs zohoDedupSql_. Adding one here would be
 * cargo-culting.
 */

/** @return {string} the fully-qualified, backticked ServiceWRK table. */
function swTable_() {
  return T('servicewrk_Tickets');
}

/**
 * Date-range condition on created_on. ServiceWRK's timestamps carry no
 * time-of-day, so DATE() comparison is exact rather than lossy.
 * @param {string=} dateFrom ISO yyyy-mm-dd
 * @param {string=} dateTo ISO yyyy-mm-dd
 * @return {string} '' when neither bound is set
 */
function swDateCond_(dateFrom, dateTo) {
  var cond = '';
  var from = segClean_(String(dateFrom || ''));
  var to = segClean_(String(dateTo || ''));
  if (from) cond += " AND DATE(created_on) >= DATE('" + from + "')";
  if (to) cond += " AND DATE(created_on) <= DATE('" + to + "')";
  return cond;
}

/**
 * TAT sanity guard. tat_days_ runs as low as -1.5 because some rows carry a
 * closed_date earlier than their created_on. Every TAT statistic excludes
 * these; apiGetServiceCD reports how many were excluded rather than hiding it.
 * @return {string}
 */
function swTatValidCond_() {
  return ' AND tat_days_ IS NOT NULL AND tat_days_ >= 0';
}

/**
 * The global filter drawer, expressed in ServiceWRK's OWN columns.
 *
 * Deliberately partial: hub/center/status/deviceType have no counterpart in
 * this table, and bridging them would need a customer_id -> CenterID join that
 * is unverified and at best partial (customer_id is 7.9% null, ~7,923 distinct
 * against ~27,410 centers). Silently ignoring those dimensions is the honest
 * behaviour — the page states its own filter coverage in the UI.
 *
 * @param {Object} filters
 * @return {string} SQL fragment beginning with ' AND', or ''
 */
function swFilterCond_(filters) {
  var f = filters || {};
  return multiCond_(segmentGroupSql_('customer_category'), f.segments) +
    multiCond_('state', f.states) +
    multiCond_('city', f.cities) +
    swDateCond_(f.dateFrom, f.dateTo);
}

/**
 * TAT bucketing expression. Bands are closed-open on whole days; the client
 * orders them with a fixed array (SVC_TAT_ORDER) because SQL returns them
 * alphabetically.
 * @return {string} a CASE expression producing a band label
 */
function swTatBandSql_() {
  return "CASE WHEN tat_days_ < 1 THEN 'Same day' " +
    "WHEN tat_days_ < 3 THEN '1-2d' " +
    "WHEN tat_days_ < 8 THEN '3-7d' " +
    "WHEN tat_days_ <= 30 THEN '8-30d' " +
    "ELSE '30d+' END";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/unit/servicewrk-helpers.test.js`
Expected: PASS, 11 tests.

Then run the whole suite to confirm nothing regressed: `npm test` → 80 passed (69 existing + 11 new).

- [ ] **Step 5: Commit**

```bash
git add src/server/ServiceWrk.js test/unit/servicewrk-helpers.test.js
git commit -m "feat(service): ServiceWRK SQL fragment builders + unit tests"
```

---

### Task 2: `apiGetServiceCD` — KPI and chart payload

**Files:**
- Modify: `src/server/ServiceWrk.js` (append)
- Test: `test/unit/servicewrk-helpers.test.js` (append)

**Interfaces:**
- Consumes: everything from Task 1; `runQueriesParallel(specs)`, `respond_(fn)`, `withCache(key, fn, bypass)`, `getCacheEpoch_()`, `filterHash_(filters)` from `BigQuery.js` / `Queries.js` / `Setup.js`.
- Produces: `buildServiceQuerySpecs(filters)` returning an array of `{key, sql, maxRows}`; `apiGetServiceCD(options)` returning `{kpis, flow, tatBands, resolution, serviceTypes, models, reps, invalidTat}`.

- [ ] **Step 1: Write the failing test**

Append to `test/unit/servicewrk-helpers.test.js`:

```javascript
describe('buildServiceQuerySpecs', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'ServiceWrk.js']);
  });

  test('returns one spec per page component, each with a key and sql', function () {
    const specs = sandbox.buildServiceQuerySpecs({});
    const keys = specs.map(function (s) { return s.key; });
    expect(keys).toEqual(['kpis', 'flow', 'tatBands', 'resolution',
      'serviceTypes', 'models', 'reps']);
    specs.forEach(function (s) {
      expect(typeof s.sql).toBe('string');
      expect(s.sql.length).toBeGreaterThan(0);
    });
  });

  test('every spec queries the ServiceWRK table', function () {
    sandbox.buildServiceQuerySpecs({}).forEach(function (s) {
      expect(s.sql).toContain('servicewrk_Tickets');
    });
  });

  test('no spec contains a dedupe CTE — ticket_id is already unique', function () {
    sandbox.buildServiceQuerySpecs({}).forEach(function (s) {
      expect(s.sql).not.toContain('ROW_NUMBER() OVER');
    });
  });

  test('the active filter reaches every spec', function () {
    sandbox.buildServiceQuerySpecs({ states: ['Odisha'] }).forEach(function (s) {
      expect(s.sql).toContain("IN ('Odisha')");
    });
  });

  test('TAT statistics exclude negative rows', function () {
    const specs = sandbox.buildServiceQuerySpecs({});
    const tat = specs.filter(function (s) { return s.key === 'tatBands'; })[0];
    expect(tat.sql).toContain('tat_days_ >= 0');
  });

  test('kpis spec counts the negative-TAT rows rather than dropping them', function () {
    const kpis = sandbox.buildServiceQuerySpecs({}).filter(
      function (s) { return s.key === 'kpis'; })[0];
    expect(kpis.sql).toContain('invalid_tat');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/unit/servicewrk-helpers.test.js -t buildServiceQuerySpecs`
Expected: FAIL — `sandbox.buildServiceQuerySpecs is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/server/ServiceWrk.js`:

```javascript
/* ═══════════════ Query specs ═══════════════ */

/**
 * Every query the Service page needs, as one parallel batch.
 * @param {Object} filters the global filter drawer's state
 * @return {Array<{key:string, sql:string, maxRows:number}>}
 */
function buildServiceQuerySpecs(filters) {
  var SW = swTable_();
  var F = swFilterCond_(filters);
  var where = ' WHERE TRUE' + F;

  return [
    {
      key: 'kpis', maxRows: 1,
      // bounds gives "30 days before the newest ticket" rather than before
      // today: the feed is a daily file drop and can lag, and anchoring to
      // CURRENT_DATE would silently zero this tile on a missed drop.
      sql: 'WITH bounds AS (SELECT DATE(MAX(created_on)) AS max_day FROM ' + SW + where + ') ' +
        'SELECT COUNTIF(status = "Open") AS open_tickets, ' +
        ' COUNTIF(status = "Closed") AS closed_tickets, ' +
        ' ROUND(APPROX_QUANTILES(IF(tat_days_ >= 0, tat_days_, NULL), 100)[OFFSET(50)], 1) AS median_tat_days, ' +
        ' COUNTIF(tat_days_ < 0) AS invalid_tat, ' +
        ' ROUND(SAFE_DIVIDE(COUNTIF(closure_type = "OVERCALL_RESOLUTION"), ' +
        '   NULLIF(COUNTIF(closure_type IS NOT NULL), 0)) * 100, 1) AS remote_pct, ' +
        ' COUNTIF(closure_type = "CENTER_VISIT" AND ' +
        '   DATE(created_on) >= DATE_SUB(ANY_VALUE(bounds.max_day), INTERVAL 30 DAY)) AS visits_30d ' +
        'FROM ' + SW + ' CROSS JOIN bounds' + where
    },
    {
      key: 'flow', maxRows: 40,
      // Created and closed are counted in separate CTEs and outer-joined: a
      // month can have closures without creations (and vice versa), and an
      // inner join would silently drop those months from the trend.
      sql: 'WITH c AS (SELECT FORMAT_DATE("%Y-%m", DATE(created_on)) AS month, COUNT(*) AS created ' +
        ' FROM ' + SW + where + ' GROUP BY month), ' +
        'x AS (SELECT FORMAT_DATE("%Y-%m", DATE(closed_date)) AS month, COUNT(*) AS closed ' +
        ' FROM ' + SW + where + ' AND closed_date IS NOT NULL GROUP BY month) ' +
        'SELECT month, IFNULL(c.created, 0) AS created, IFNULL(x.closed, 0) AS closed ' +
        'FROM c FULL OUTER JOIN x USING (month) ORDER BY month'
    },
    {
      key: 'tatBands', maxRows: 10,
      sql: 'SELECT ' + swTatBandSql_() + ' AS band, COUNT(*) AS cnt FROM ' + SW +
        where + swTatValidCond_() + ' GROUP BY band'
    },
    {
      key: 'resolution', maxRows: 10,
      sql: 'SELECT IFNULL(NULLIF(TRIM(closure_type), ""), "Unknown") AS label, COUNT(*) AS cnt ' +
        'FROM ' + SW + where + ' GROUP BY label ORDER BY cnt DESC'
    },
    {
      key: 'serviceTypes', maxRows: 12,
      sql: 'SELECT IFNULL(NULLIF(TRIM(service_type), ""), "Unknown") AS label, COUNT(*) AS cnt ' +
        'FROM ' + SW + where + ' GROUP BY label ORDER BY cnt DESC LIMIT 12'
    },
    {
      key: 'models', maxRows: 16,
      sql: 'SELECT IFNULL(NULLIF(TRIM(category), ""), "Unknown") AS label, COUNT(*) AS cnt ' +
        'FROM ' + SW + where + ' GROUP BY label ORDER BY cnt DESC LIMIT 16'
    },
    {
      key: 'reps', maxRows: 12,
      sql: 'SELECT IFNULL(NULLIF(TRIM(representative), ""), "Unassigned") AS label, COUNT(*) AS cnt ' +
        'FROM ' + SW + where + ' AND status = "Closed" GROUP BY label ORDER BY cnt DESC LIMIT 12'
    }
  ];
}

/**
 * Service page payload — KPIs plus all six charts, in one cached round trip.
 * @param {{filters:Object, bypassCache:boolean}=} options
 */
function apiGetServiceCD(options) {
  options = options || {};
  var filters = options.filters || {};
  return respond_(function () {
    return withCache('svc_v1_' + getCacheEpoch_() + '_' + filterHash_(filters), function () {
      var r = runQueriesParallel(buildServiceQuerySpecs(filters));
      var k = (r.kpis && r.kpis[0]) || {};
      return {
        kpis: k,
        flow: r.flow || [],
        tatBands: r.tatBands || [],
        resolution: r.resolution || [],
        serviceTypes: r.serviceTypes || [],
        models: r.models || [],
        reps: r.reps || [],
        invalidTat: Number(k.invalid_tat || 0)
      };
    }, options.bypassCache === true);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/unit/servicewrk-helpers.test.js`
Expected: PASS, 17 tests. Then `npm test` → 86 passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/ServiceWrk.js test/unit/servicewrk-helpers.test.js
git commit -m "feat(service): apiGetServiceCD payload — KPIs and six chart specs"
```

---

### Task 3: `apiGetServiceTicketsCD` — paginated explorer

**Files:**
- Modify: `src/server/ServiceWrk.js` (append)
- Test: `test/unit/servicewrk-helpers.test.js` (append)

**Interfaces:**
- Consumes: `swTable_()`, `swFilterCond_(filters)` from Task 1.
- Produces: `SERVICE_SORT_KEYS` (object), `buildServiceTicketsQuery(options)` returning a SQL string, `apiGetServiceTicketsCD(options)` returning `{rows, totalRows, page, pageSize}`.

- [ ] **Step 1: Write the failing test**

Append to `test/unit/servicewrk-helpers.test.js`:

```javascript
describe('buildServiceTicketsQuery', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'ServiceWrk.js']);
  });

  test('defaults to sorting by created_on descending', function () {
    const sql = sandbox.buildServiceTicketsQuery({});
    expect(sql).toContain('ORDER BY created_on DESC');
  });

  test('accepts a whitelisted sort column', function () {
    const sql = sandbox.buildServiceTicketsQuery({ sortBy: 'tat_days_', sortDir: 'asc' });
    expect(sql).toContain('ORDER BY tat_days_ ASC');
  });

  test('rejects a non-whitelisted sort column instead of inlining it', function () {
    const sql = sandbox.buildServiceTicketsQuery({ sortBy: 'x; DROP TABLE y' });
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).toContain('ORDER BY created_on DESC');
  });

  test('search matches ticket id, contact and representative', function () {
    const sql = sandbox.buildServiceTicketsQuery({ search: 'abhisekh' });
    expect(sql).toContain('ticket_id');
    expect(sql).toContain('contact_person_name');
    expect(sql).toContain('representative');
    expect(sql).toContain('abhisekh');
  });

  test('formats timestamps in SQL, never returning raw epoch values', function () {
    const sql = sandbox.buildServiceTicketsQuery({});
    expect(sql).toContain('FORMAT_DATE');
  });

  test('paginates with LIMIT and OFFSET', function () {
    const sql = sandbox.buildServiceTicketsQuery({ page: 2, pageSize: 50 });
    expect(sql).toContain('LIMIT 50');
    expect(sql).toContain('OFFSET 100');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/unit/servicewrk-helpers.test.js -t buildServiceTicketsQuery`
Expected: FAIL — `sandbox.buildServiceTicketsQuery is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/server/ServiceWrk.js`:

```javascript
/* ═══════════════ Ticket explorer ═══════════════ */

/**
 * Whitelisted sort columns. A map, not an array, so an attacker-supplied
 * sortBy can never reach the SQL string — same guard as CENTER_SORT_KEYS.
 */
var SERVICE_SORT_KEYS = {
  created_on: 'created_on', status: 'status', ticket_territory: 'ticket_territory',
  product: 'product', service_type: 'service_type', representative: 'representative',
  tat_days_: 'tat_days_', closure_type: 'closure_type'
};

/**
 * One page of the service-ticket explorer.
 * @param {{page:number, pageSize:number, sortBy:string, sortDir:string,
 *          search:string, filters:Object}} options
 * @return {string} SQL
 */
function buildServiceTicketsQuery(options) {
  var o = options || {};
  var page = Math.max(0, parseInt(o.page, 10) || 0);
  var pageSize = Math.min(200, Math.max(1, parseInt(o.pageSize, 10) || 50));
  var sortBy = SERVICE_SORT_KEYS[o.sortBy] || 'created_on';
  var sortDir = String(o.sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  var search = segClean_(String(o.search || '')).toLowerCase();
  var searchCond = '';
  if (search.length >= 2) {
    var like = "'%" + likeEscape_(search) + "%'";
    searchCond = ' AND (LOWER(IFNULL(ticket_id, "")) LIKE ' + like +
      ' OR LOWER(IFNULL(contact_person_name, "")) LIKE ' + like +
      ' OR LOWER(IFNULL(representative, "")) LIKE ' + like + ')';
  }

  return 'SELECT ticket_id, ' +
    ' FORMAT_DATE("%Y-%m-%d", DATE(created_on)) AS created, ' +
    ' FORMAT_DATE("%Y-%m-%d", DATE(closed_date)) AS closed, ' +
    ' status, IFNULL(contact_person_name, "") AS contact, ' +
    ' IFNULL(ticket_territory, "") AS territory, IFNULL(product, "") AS product, ' +
    ' IFNULL(service_type, "") AS service_type, IFNULL(representative, "") AS representative, ' +
    ' tat_days_, IFNULL(closure_type, "") AS closure_type, ' +
    ' COUNT(*) OVER() AS total_rows ' +
    'FROM ' + swTable_() + ' WHERE TRUE' + swFilterCond_(o.filters) + searchCond +
    ' ORDER BY ' + sortBy + ' ' + sortDir +
    ' LIMIT ' + pageSize + ' OFFSET ' + (page * pageSize);
}

/**
 * Paginated service-ticket list.
 * @param {Object=} options see buildServiceTicketsQuery
 */
function apiGetServiceTicketsCD(options) {
  options = options || {};
  return respond_(function () {
    var rows = runQuery(buildServiceTicketsQuery(options), null,
      { maxRows: Math.min(200, parseInt(options.pageSize, 10) || 50) }) || [];
    return {
      rows: rows,
      totalRows: rows.length ? Number(rows[0].total_rows || 0) : 0,
      page: Math.max(0, parseInt(options.page, 10) || 0),
      pageSize: Math.min(200, Math.max(1, parseInt(options.pageSize, 10) || 50))
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/unit/servicewrk-helpers.test.js`
Expected: PASS, 23 tests. Then `npm test` → 92 passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/ServiceWrk.js test/unit/servicewrk-helpers.test.js
git commit -m "feat(service): paginated service-ticket explorer endpoint"
```

---

### Task 4: Page markup

**Files:**
- Modify: `src/client/Index.html:521-534` (replace the whole `#panel-service` section)
- Modify: `src/client/App.html` — the `$('serviceKpiGrid').innerHTML` block at line ~547

**Interfaces:**
- Consumes: nothing from earlier tasks (markup only).
- Produces: element ids `chartSvcFlow`, `chartSvcTat`, `chartSvcResolution`, `chartSvcTypes`, `chartSvcModels`, `chartSvcReps`, `serviceTable`, `serviceTableHead`, `serviceTableInfo`, `svcPageIndicator`, `svcPrevBtn`, `svcNextBtn`; KPI tile ids `kpiSvcOpen`, `kpiSvcTat`, `kpiSvcRemote`, `kpiSvcVisits`.

- [ ] **Step 1: Replace the placeholder panel**

In `src/client/Index.html`, replace lines 521-534 entirely:

```html
  <!-- ══════════════ VIEW 4 · SERVICE ══════════════
       ServiceWRK field-service operations. Filters come from this table's own
       state/city/customer_category columns — NOT from a center join, which is
       unverified and at best partial. See the design spec §4.2. -->
  <section id="panel-service" class="panel" role="tabpanel" aria-labelledby="tab-service" hidden>
    <div id="serviceKpiGrid" class="kpi-grid kpi-grid-4"></div>

    <div class="card-grid">
      <article class="card span-12">
        <header class="card-head">
          <h2 class="card-title">Service ticket flow</h2>
          <p class="card-sub">Raised vs closed per month · ServiceWRK</p>
        </header>
        <div id="chartSvcFlow" class="chart chart-tall" role="img"
             aria-label="Line chart of service tickets raised versus closed per month"></div>
      </article>

      <article class="card span-4">
        <header class="card-head">
          <h2 class="card-title">Turnaround time</h2>
          <p class="card-sub">Closed tickets by days to close</p>
        </header>
        <div id="chartSvcTat" class="chart chart-tall" role="img"
             aria-label="Bar chart of closed tickets by turnaround band"></div>
      </article>

      <article class="card span-4">
        <header class="card-head">
          <h2 class="card-title">Resolution mix</h2>
          <p class="card-sub">Site visit vs resolved over the phone</p>
        </header>
        <div id="chartSvcResolution" class="chart chart-tall" role="img"
             aria-label="Donut chart of centre visits versus remote resolutions"></div>
      </article>

      <article class="card span-4">
        <header class="card-head">
          <h2 class="card-title">Top service types</h2>
          <p class="card-sub">Most common work carried out</p>
        </header>
        <div id="chartSvcTypes" class="chart chart-tall" role="img"
             aria-label="Horizontal bar chart of tickets by service type"></div>
      </article>

      <article class="card span-6">
        <header class="card-head">
          <h2 class="card-title">By device model</h2>
          <p class="card-sub">Service load per machine category</p>
        </header>
        <div id="chartSvcModels" class="chart chart-tall" role="img"
             aria-label="Horizontal bar chart of tickets by device model"></div>
      </article>

      <article class="card span-6">
        <header class="card-head">
          <h2 class="card-title">Field force</h2>
          <p class="card-sub">Top engineers by tickets closed</p>
        </header>
        <div id="chartSvcReps" class="chart chart-tall" role="img"
             aria-label="Horizontal bar chart of tickets closed per engineer"></div>
      </article>

      <article class="card span-12">
        <header class="card-head">
          <h2 class="card-title">Service tickets</h2>
          <p class="card-sub">One row per ServiceWRK ticket · newest first</p>
        </header>
        <div class="table-scroll">
          <table class="data-table" id="serviceTable" aria-describedby="serviceTableInfo">
            <caption class="sr-only">Service ticket explorer</caption>
            <thead><tr id="serviceTableHead"></tr></thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="table-footer">
          <span id="serviceTableInfo" class="table-info" aria-live="polite">Loading…</span>
          <div class="pager">
            <button id="svcPrevBtn" class="btn btn-ghost btn-icon" type="button" aria-label="Previous page" disabled>
              <svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m15 18-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <span id="svcPageIndicator" class="page-indicator">–</span>
            <button id="svcNextBtn" class="btn btn-ghost btn-icon" type="button" aria-label="Next page" disabled>
              <svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m9 18 6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      </article>
    </div>
  </section>
```

- [ ] **Step 2: Update the KPI tile shells**

In `src/client/App.html`, replace the `$('serviceKpiGrid').innerHTML` assignment (currently lines 547-551):

```javascript
    $('serviceKpiGrid').innerHTML =
      kpiTile('kpiSvcOpen', 'inbox', 'var(--accent)', 'Open tickets', 'active field backlog') +
      kpiTile('kpiSvcTat', 'clock', 'var(--info)', 'Median TAT', 'days to close') +
      kpiTile('kpiSvcRemote', 'online', 'var(--ok)', 'Remote resolution', 'closed without a visit') +
      kpiTile('kpiSvcVisits', 'fleet', 'var(--violet)', 'Field visits · 30d', 'site visits raised');
```

- [ ] **Step 3: Delete the "data source pending" stubs**

In `src/client/App.html`, delete these four lines (currently ~694-697):

```javascript
    setKpiText('kpiSvcOpen', null, 'data source pending');
    setKpiText('kpiSvcIn', null, 'data source pending');
    setKpiText('kpiSvcOut', null, 'data source pending');
    setKpiText('kpiSvcAge', null, 'data source pending');
```

Then remove the now-dangling `kpiSvcIn`, `kpiSvcOut`, `kpiSvcAge` entries from the `KPI_METRIC` map (~line 2569) — those tile ids no longer exist.

- [ ] **Step 4: Verify the markup renders**

Run: `powershell -File scripts/build_preview.ps1` then open `dist/preview.html` and click the Service tab.
Expected: KPI tiles and seven empty cards render with correct titles; no console errors; charts show their empty state (no data is wired yet).

- [ ] **Step 5: Commit**

```bash
git add src/client/Index.html src/client/App.html
git commit -m "feat(service): page markup, KPI shells, remove data-source-pending stubs"
```

---

### Task 5: Chart functions

**Files:**
- Modify: `src/client/Charts.html` — add two functions before the `return {` block (line ~578), and add both to the exports.

**Interfaces:**
- Consumes: `base(extra)`, `catAxis(overrides)`, `valAxis(overrides)`, `render(id, option)`, `showEmpty(id)`, `horizontalBar(id, rows, labelKey, valueKey, color)`, palette `C`, `STATUS_PALETTE` — all existing in `Charts.html`.
- Produces: `Charts.svcTatBands(rows)`, `Charts.svcResolution(rows)`. The other four Service charts reuse `Charts.zohoTrend(rows, 'chartSvcFlow')` and `horizontalBar` via the render code in Task 6.

- [ ] **Step 1: Add the two chart functions**

Insert into `src/client/Charts.html` immediately before the `return {` block:

```javascript
  /* ── Service page ────────────────────────────────────────────── */

  // SQL returns bands alphabetically; this is the order a human reads them in.
  var SVC_TAT_ORDER = ['Same day', '1-2d', '3-7d', '8-30d', '30d+'];

  function svcTatBands(rows) {
    if (!rows || !rows.length) return showEmpty('chartSvcTat');
    var byBand = {};
    rows.forEach(function (r) { byBand[r.band] = r.cnt; });
    var cats = SVC_TAT_ORDER.filter(function (b) { return byBand[b]; });
    render('chartSvcTat', base({
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: catAxis({ data: cats }),
      yAxis: valAxis(),
      series: [{
        type: 'bar', barMaxWidth: 36,
        data: cats.map(function (b, i) {
          return {
            value: byBand[b],
            // The slowest band is the one that costs money — colour it as a
            // warning rather than leaving the reader to find it.
            itemStyle: {
              borderRadius: [6, 6, 0, 0],
              color: (i === cats.length - 1 && b === '30d+') ? C.danger : C.primary
            }
          };
        })
      }]
    }));
  }

  function svcResolution(rows) {
    if (!rows || !rows.length) return showEmpty('chartSvcResolution');
    var COLORS = { CENTER_VISIT: C.warn, OVERCALL_RESOLUTION: C.ok };
    render('chartSvcResolution', base({
      legend: { bottom: 0, icon: 'circle', textStyle: { color: C.text, fontSize: 12 },
        itemWidth: 9, itemHeight: 9 },
      series: [{
        type: 'pie', radius: ['55%', '78%'], center: ['50%', '44%'],
        itemStyle: { borderColor: C.sliceBorder, borderWidth: 2 },
        label: { show: false },
        data: rows.map(function (r, i) {
          return {
            name: r.label, value: r.cnt,
            itemStyle: { color: COLORS[r.label] || STATUS_PALETTE[i % STATUS_PALETTE.length] }
          };
        })
      }]
    }));
  }
```

- [ ] **Step 2: Export them**

In the `return {` block, add:

```javascript
    svcTatBands: svcTatBands,
    svcResolution: svcResolution,
```

- [ ] **Step 3: Verify**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('src/client/Charts.html','utf8');const m=/<script[^>]*>([\s\S]*?)<\/script>/.exec(s);new Function(m[1]);console.log('Charts.html syntax OK')"`
Expected: `Charts.html syntax OK`

- [ ] **Step 4: Commit**

```bash
git add src/client/Charts.html
git commit -m "feat(service): TAT-band and resolution-mix charts"
```

---

### Task 6: Client data wiring

**Files:**
- Modify: `src/client/App.html` — preview mock, `loadService`/`renderService`, table render, tab hook, pager wiring, search placeholder, metric glossary.

**Interfaces:**
- Consumes: `apiGetServiceCD` / `apiGetServiceTicketsCD` from Tasks 2-3; `Charts.svcTatBands`, `Charts.svcResolution` from Task 5; the element ids from Task 4.
- Produces: `state.serviceLoaded`, `state.serviceFilters`, `state.service` (page state), `loadService()`, `renderService(payload)`.

- [ ] **Step 1: Add the preview mock**

In `src/client/App.html`'s `gsCall` mock branch, alongside the other `if (fn === '...')` blocks, add:

```javascript
    if (fn === 'apiGetServiceCD') {
      var svcMonths = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
      return Promise.resolve({
        kpis: { open_tickets: 205, closed_tickets: 36198, median_tat_days: 1.4,
          invalid_tat: 12, remote_pct: 14.5, visits_30d: 812 },
        flow: svcMonths.map(function (m) {
          return { month: m, created: rnd(900, 1600), closed: rnd(900, 1600) };
        }),
        tatBands: [{ band: 'Same day', cnt: 14320 }, { band: '1-2d', cnt: 9880 },
          { band: '3-7d', cnt: 6410 }, { band: '8-30d', cnt: 4120 }, { band: '30d+', cnt: 1468 }],
        resolution: [{ label: 'CENTER_VISIT', cnt: 30822 },
          { label: 'OVERCALL_RESOLUTION', cnt: 5259 }, { label: 'Unknown', cnt: 322 }],
        serviceTypes: ['Breakdown call', 'Preventive maintenance', 'Installation',
          'Document collection', 'Training', 'Lead cable replacement', 'Battery swap',
          'Printer service'].map(function (s) { return { label: s, cnt: rnd(400, 6000) }; }),
        models: [{ label: 'MAC 600', cnt: 17109 }, { label: 'VCARDIA', cnt: 16994 },
          { label: 'TR 100', cnt: 1312 }, { label: 'TR 200', cnt: 344 },
          { label: 'TR 110', cnt: 182 }, { label: 'ECHO', cnt: 131 }],
        reps: ['Abhisekh Mohapatra', 'Dadapeer Z', 'Saidha Rao', 'Mustaq Ahmed', 'Ravi Kumar',
          'Anil Sharma', 'Prakash N', 'Vinod S'].map(function (s) {
          return { label: s, cnt: rnd(200, 900) };
        }),
        invalidTat: 12
      });
    }
    if (fn === 'apiGetServiceTicketsCD') {
      var svcRows = [];
      for (var si = 0; si < 50; si++) {
        svcRows.push({
          ticket_id: 'TRI-MAC-MC9-' + (16022026 + si), created: '2026-08-' + (1 + (si % 12)),
          closed: '2026-08-' + (2 + (si % 12)), status: si % 20 === 0 ? 'Open' : 'Closed',
          contact: 'Contact ' + si, territory: ['Odisha India', 'Karnataka India', 'Bihar India'][si % 3],
          product: ['Mac 600 - DB9', 'BORON', 'TR 100 GSM'][si % 3],
          service_type: ['Breakdown call', 'Preventive maintenance', 'Training'][si % 3],
          representative: ['Abhisekh Mohapatra', 'Dadapeer Z', 'Saidha Rao'][si % 3],
          tat_days_: Math.round(rnd(0, 40) * 10) / 10,
          closure_type: si % 5 === 0 ? 'OVERCALL_RESOLUTION' : 'CENTER_VISIT'
        });
      }
      return Promise.resolve({ rows: svcRows, totalRows: 36403, page: 0, pageSize: 50 });
    }
```

- [ ] **Step 2: Add page state**

In the `state` initializer, alongside `state.centers`, add:

```javascript
    serviceLoaded: false,
    serviceFilters: null,
    service: { page: 0, pageSize: 50, sortBy: 'created_on', sortDir: 'desc' },
    serviceRows: [],
    serviceTotal: 0,
```

- [ ] **Step 3: Add load and render**

Add near `loadCenters`:

```javascript
  /* ── Service page (ServiceWRK) ────────────────────────────────── */
  var SERVICE_COLUMNS = [
    { key: 'ticket_id', label: 'Ticket', sortable: false },
    { key: 'created_on', label: 'Created', sortable: true },
    { key: 'status', label: 'Status', sortable: true },
    { key: 'contact', label: 'Contact', sortable: false },
    { key: 'ticket_territory', label: 'Territory', sortable: true },
    { key: 'product', label: 'Product', sortable: true },
    { key: 'service_type', label: 'Service type', sortable: true },
    { key: 'representative', label: 'Engineer', sortable: true },
    { key: 'tat_days_', label: 'TAT (days)', sortable: true, num: true },
    { key: 'closure_type', label: 'Closure', sortable: true }
  ];

  var serviceRequestId = 0;
  function loadService() {
    var requestId = ++serviceRequestId;
    var sentFilters = JSON.parse(JSON.stringify(state.globalFilters)); // see loadDevices
    gsCall(ep('apiGetService'), { filters: state.globalFilters })
      .then(function (payload) {
        if (requestId !== serviceRequestId) return;
        state.serviceLoaded = true;
        state.serviceFilters = sentFilters;
        renderService(payload);
      })
      .catch(function (err) {
        if (requestId !== serviceRequestId) return;
        toast('Service page failed: ' + err.message, 'error');
      });
    loadServiceTickets();
  }

  function renderService(d) {
    var k = d.kpis || {};
    setKpi('kpiSvcOpen', k.open_tickets, 'active field backlog');
    setKpiText('kpiSvcTat', k.median_tat_days == null ? '—' : k.median_tat_days + 'd',
      // The excluded count is shown, not hidden: some ServiceWRK rows carry a
      // closed_date earlier than created_on, and a silently-filtered median
      // would be indistinguishable from a clean one.
      d.invalidTat ? d.invalidTat + ' rows had invalid TAT' : 'days to close');
    setKpiText('kpiSvcRemote', k.remote_pct == null ? '—' : k.remote_pct + '%',
      'closed without a visit');
    setKpi('kpiSvcVisits', k.visits_30d, 'site visits raised');

    Charts.zohoTrend(d.flow || [], 'chartSvcFlow');
    Charts.svcTatBands(d.tatBands || []);
    Charts.svcResolution(d.resolution || []);
    // rankBar reads r.label / r.cnt directly (Charts.html:480) — it has no
    // labelKey/valueKey options, which is why every spec in Task 2 aliases its
    // columns to exactly those two names.
    Charts.rankBar('chartSvcTypes', d.serviceTypes || [], { color: '#2E9BD6', empty: 'No service data' });
    Charts.rankBar('chartSvcModels', d.models || [], { color: '#7C5CFF', empty: 'No model data' });
    Charts.rankBar('chartSvcReps', d.reps || [], { color: '#2FD39B', empty: 'No engineer data' });
  }
```

- [ ] **Step 4: Add the table render and pager**

```javascript
  var serviceTicketsRequestId = 0;
  function loadServiceTickets() {
    var requestId = ++serviceTicketsRequestId;
    $('serviceTableInfo').textContent = 'Loading…';
    var query = Object.assign({}, state.service,
      { search: state.search, filters: state.globalFilters });
    gsCall(ep('apiGetServiceTickets'), query)
      .then(function (result) {
        if (requestId !== serviceTicketsRequestId) return;
        state.serviceRows = result.rows;
        state.serviceTotal = result.totalRows;
        renderServiceTable();
      })
      .catch(function (err) {
        if (requestId !== serviceTicketsRequestId) return;
        $('serviceTableInfo').textContent = 'Failed to load service tickets';
        toast('Service tickets failed: ' + err.message, 'error');
      });
  }

  function buildServiceHeader() {
    $('serviceTableHead').innerHTML = SERVICE_COLUMNS.map(function (col) {
      return sortableHeader(col, state.service);
    }).join('');
    Array.prototype.forEach.call($('serviceTableHead').querySelectorAll('.th-sort'), function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-sort');
        if (state.service.sortBy === key) {
          state.service.sortDir = state.service.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.service.sortBy = key;
          state.service.sortDir = 'desc';
        }
        state.service.page = 0;
        buildServiceHeader();
        loadServiceTickets();
      });
    });
  }

  function renderServiceTable() {
    var body = $('serviceTable').querySelector('tbody');
    if (!state.serviceRows.length) {
      body.innerHTML = '<tr><td colspan="' + SERVICE_COLUMNS.length + '">' +
        '<div class="chart-empty" style="padding:32px 0">' +
        '<strong>No service tickets match</strong><span>Try clearing the search</span>' +
        '</div></td></tr>';
    } else {
      body.innerHTML = state.serviceRows.map(function (r) {
        var statusBadge = r.status === 'Open' ? 'warn' : 'ok';
        return '<tr>' +
          '<td><strong>' + escapeHtml(r.ticket_id || '—') + '</strong></td>' +
          '<td>' + escapeHtml(r.created || '—') + '</td>' +
          '<td><span class="badge badge-' + statusBadge + '">' + escapeHtml(r.status || '—') + '</span></td>' +
          '<td>' + escapeHtml(r.contact || '—') + '</td>' +
          '<td>' + escapeHtml(r.territory || '—') + '</td>' +
          '<td>' + escapeHtml(r.product || '—') + '</td>' +
          '<td>' + escapeHtml(r.service_type || '—') + '</td>' +
          '<td>' + escapeHtml(r.representative || '—') + '</td>' +
          '<td class="num">' + (r.tat_days_ == null ? '—' : r.tat_days_) + '</td>' +
          '<td>' + escapeHtml(r.closure_type || '—') + '</td>' +
          '</tr>';
      }).join('');
    }
    renderPager(state.serviceTotal, state.service, 'serviceTableInfo',
      'svcPageIndicator', 'svcPrevBtn', 'svcNextBtn', 'tickets');
  }
```

- [ ] **Step 5: Wire the tab, pager, refresh and search**

In `activateTab`, alongside the other page hooks:

```javascript
    var serviceStale = state.serviceFilters && !filtersEqual_(state.serviceFilters, state.globalFilters);
    if (tabId === 'tab-service' && (!state.serviceLoaded || serviceStale)) {
      state.service.page = 0;
      loadService();
    }
```

In `init()`'s event wiring, alongside `ctrPrevBtn`:

```javascript
    $('svcPrevBtn').addEventListener('click', function () {
      state.service.page = Math.max(0, state.service.page - 1);
      loadServiceTickets();
    });
    $('svcNextBtn').addEventListener('click', function () {
      state.service.page += 1;
      loadServiceTickets();
    });
```

Also call `buildServiceHeader();` in `init()` next to `buildCenterHeader();`.

In `refreshAll`, add `if (state.serviceLoaded) loadService();`.

In `reloadActiveList`, add:

```javascript
    else if (state.activeTab === 'tab-service') { state.service.page = 0; loadServiceTickets(); }
```

In `SEARCH_TAB_INFO`, replace the `tab-service` entry:

```javascript
    'tab-service': { placeholder: 'Search service tickets by id, contact or engineer…' },
```

- [ ] **Step 6: Add glossary entries**

In `METRIC_INFO`, add:

```javascript
    // ── Service (ServiceWRK) ──
    svcOpen: { name: 'Open service tickets', formula: 'ServiceWRK tickets with status = Open.', source: 'servicewrk_Tickets.status.' },
    svcTat: { name: 'Median turnaround', formula: 'Median tat_days_ over closed tickets. Rows with negative TAT (closed_date earlier than created_on) are excluded and counted separately — the sub-line reports how many.', source: 'servicewrk_Tickets.tat_days_.' },
    svcRemote: { name: 'Remote resolution %', formula: 'OVERCALL_RESOLUTION ÷ tickets with any closure type. Every remote fix is an avoided site visit.', source: 'servicewrk_Tickets.closure_type.' },
    svcVisits: { name: 'Field visits · 30d', formula: 'CENTER_VISIT tickets raised in the 30 days before the newest ticket in the table — anchored to the data, not to today, because the feed is a daily file drop that can lag.', source: 'servicewrk_Tickets.closure_type + created_on.' },
```

And in `KPI_METRIC`:

```javascript
    kpiSvcOpen: 'svcOpen', kpiSvcTat: 'svcTat', kpiSvcRemote: 'svcRemote', kpiSvcVisits: 'svcVisits',
```

And in `TITLE_METRIC`:

```javascript
    'service ticket flow': 'svcOpen', 'turnaround time': 'svcTat',
    'resolution mix': 'svcRemote',
```

- [ ] **Step 7: Verify in the preview**

Run: `powershell -File scripts/build_preview.ps1`, open `dist/preview.html`, click Service.
Expected: four KPI tiles with numbers, six charts rendered, a 50-row table paging to "1 / 729", sortable headers, zero console errors.

- [ ] **Step 8: Commit**

```bash
git add src/client/App.html
git commit -m "feat(service): wire Service page to ServiceWRK endpoints"
```

---

### Task 7: Live verification and diagnostics

**Files:**
- Modify: `src/server/Setup.js` — extend `diagnostics()`
- Delete: `src/server/ProfileNewSources.js` (the temporary profiling scaffold)

- [ ] **Step 1: Add a diagnostics line**

In `diagnostics()`, alongside the existing source checks:

```javascript
  var svc = apiGetServiceCD({ filters: {} });
  Logger.log(svc.ok
    ? 'service: ' + svc.data.kpis.open_tickets + ' open, ' +
      svc.data.kpis.closed_tickets + ' closed, median TAT ' +
      svc.data.kpis.median_tat_days + 'd, ' + svc.data.invalidTat + ' invalid-TAT rows'
    : 'service FAILED: ' + JSON.stringify(svc.error));
```

- [ ] **Step 2: Push and run against live BigQuery**

Run: `npx clasp push -f`, then run `diagnostics` in the Apps Script editor.
Expected: `service: 205 open, 36198 closed, median TAT <n>d, <n> invalid-TAT rows`.

The 205/36198 split is the check that matters — it's the independently-profiled ground truth. A mismatch means the filter or the status comparison is wrong, not that the data moved.

- [ ] **Step 3: Verify the two derived percentages by hand**

In the editor, run a one-off query and confirm the page agrees:

```sql
SELECT COUNTIF(closure_type='OVERCALL_RESOLUTION') AS remote,
       COUNTIF(closure_type='CENTER_VISIT') AS visits,
       COUNTIF(closure_type IS NOT NULL) AS with_closure
FROM `tricogde-dwh.abi_tables.servicewrk_Tickets`
```

Expected: remote 5259, visits 30822 → remote % = 5259/36081 = 14.6%. The KPI tile must match to one decimal.

- [ ] **Step 4: Remove the profiling scaffold**

```bash
git rm src/server/ProfileNewSources.js
npx clasp push -f
```

- [ ] **Step 5: Run the full suite and commit**

```bash
npm test
npm run verify-before-deploy
git add src/server/Setup.js
git commit -m "feat(service): diagnostics coverage; drop profiling scaffold"
```

---

## Self-Review

**Spec coverage.** Spec §5.1 KPIs → Task 2 + Task 6 Step 3. §5.2 all six charts → Task 2 (specs), Task 5 (two new chart fns), Task 6 Step 3 (render). §5.3 table → Tasks 3, 4, 6. §5.4 guards: negative TAT → Task 1 `swTatValidCond_` + Task 2 `invalid_tat` + Task 6 sub-line; no dedupe → Task 1 doc comment + Task 2 test; SQL-side date formatting → Task 3 test; `segmentGroupSql_` → Task 1 test. §4.2 native-column filtering → Task 1 `swFilterCond_`. §7 open items are explicitly out of this plan.

`distance_travelled_m_` percentile-capping (spec §5.4) has **no task** — because no chart in §5.2 plots it. The guard was written for a chart that didn't survive design. Nothing to implement; noted here so a reader doesn't read it as a gap.

**Placeholder scan.** No TBD/TODO. Every code step carries real code. One conditional remains in Task 6 Step 3 — the `Charts.rankBar` option names — which is flagged inline with the exact fallback rather than left vague.

**Type consistency.** `swFilterCond_(filters)` takes the filter object in Tasks 1, 2, 3. Chart payload keys (`flow`, `tatBands`, `resolution`, `serviceTypes`, `models`, `reps`) match between Task 2's spec keys, Task 2's return object, and Task 6's render. Element ids match between Task 4's markup and Tasks 5-6's render calls. Sort keys in `SERVICE_SORT_KEYS` (Task 3) match `SERVICE_COLUMNS[].key` (Task 6) — both use `created_on`, `ticket_territory`, `tat_days_`, not the aliased output names.
