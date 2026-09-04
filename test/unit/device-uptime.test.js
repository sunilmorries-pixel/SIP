'use strict';

/**
 * Unit tests for deviceUptimeFromChangelog_ (src/server/EditionCD.js) — the
 * device-grain uptime/downtime/MTBF/MTTR state machine over jira_data's raw
 * status changelog.
 *
 * The primary fixture below is TA-14445's real, independently-verified
 * worked example (all 28 status-change rows, "Fleet Uptime Methodology"
 * write-up, 2026-09-02) — this cross-checks the implementation against
 * numbers computed by a separate script, not numbers derived from this
 * code itself. Expected uptime_pct/downtime_days/mtbf_days/mttr_days are
 * the doc's own stated results; toBeCloseTo(x, 1) accounts for the doc
 * quoting 2 decimals where this function rounds fleet averages to 1.
 */

const { loadGas } = require('../helpers/loadGas');

describe('deviceUptimeFromChangelog_ (EditionCD.js)', function () {
  let sandbox;

  beforeAll(function () {
    sandbox = loadGas(['Config.js', 'SlaCatalog.js', 'Queries.js', 'TopCustomers.js', 'EditionCD.js']);
  });

  test('TA-14445 worked example: pre-deployment Hardware round-trips are ignored, ' +
    'downtime only starts once Deployed has been reached, ongoing incident excluded from MTTR', function () {
    const TICKET_UPDATED = '2026-07-10 18:44:01'; // the export's own snapshot cutoff
    const tx = [
      ['Hardware', 'Store', '2021-10-23 12:18:43'],
      ['Store', 'Hardware', '2022-04-22 15:03:16'],
      ['Hardware', 'Store', '2022-08-12 19:19:38'],
      ['Store', 'Ready to ship', '2022-08-12 19:23:40'],
      ['Ready to ship', 'Transit', '2022-08-12 19:23:50'],
      ['Transit', 'Delivered', '2022-08-12 19:24:01'],
      ['Delivered', 'Field', '2023-01-12 13:32:02'],
      ['Field', 'UNKNOWN', '2023-01-12 13:32:03'],
      ['UNKNOWN', 'Store', '2023-01-12 13:32:05'],
      ['Store', 'Hardware', '2023-01-12 13:32:06'],
      ['Hardware', 'Store', '2023-01-13 12:13:35'],
      ['Store', 'Ready to ship', '2023-01-13 12:17:06'],
      ['Ready to ship', 'Transit', '2023-01-13 12:17:21'],
      ['Transit', 'Delivered', '2023-01-23 11:27:24'],
      ['Delivered', 'Field', '2023-01-25 15:49:09'],
      ['Field', 'Deployed', '2023-01-25 15:49:10'], // first deployed
      ['Deployed', 'Field', '2025-07-21 16:17:29'],
      ['Field', 'Store', '2025-07-21 16:17:32'],
      ['Store', 'Hardware', '2025-07-21 16:17:36'], // downtime start (completed)
      ['Hardware', 'Store', '2025-10-14 11:50:01'], // downtime end
      ['Store', 'Ready to ship', '2025-10-23 15:31:54'],
      ['Ready to ship', 'Transit', '2025-10-23 15:32:00'],
      ['Transit', 'Delivered', '2025-10-23 15:32:04'],
      ['Delivered', 'Field', '2025-11-27 18:52:16'],
      ['Field', 'Deployed', '2025-11-27 18:52:18'],
      ['Deployed', 'Transit', '2026-07-08 15:47:32'],
      ['Transit', 'Store', '2026-07-08 15:47:37'],
      ['Store', 'Hardware', '2026-07-09 16:57:19'], // downtime start (ongoing)
    ];
    const rows = tx.map(function ([from_value, to_value, last_field_updated]) {
      return { issue_key: 'TA-14445', from_value: from_value, to_value: to_value,
        last_field_updated: last_field_updated, ticket_updated: TICKET_UPDATED };
    });

    const result = sandbox.deviceUptimeFromChangelog_(rows);

    expect(result.scored).toBe(1);
    expect(result.avg_uptime_pct).toBeCloseTo(93.2, 1);
    expect(result.avg_downtime_days).toBeCloseTo(85.89, 1);
    expect(result.avg_mtbf_days).toBeCloseTo(588.12, 1);
    expect(result.avg_mttr_days).toBeCloseTo(84.81, 1); // only the completed incident (rows 19-20)
  });

  test('a device that never reaches Deployed contributes nothing (no observation window)', function () {
    const rows = [
      { issue_key: 'X-1', from_value: 'Store', to_value: 'Ready to ship', last_field_updated: '2024-01-01 00:00:00', ticket_updated: '2024-06-01 00:00:00' },
      { issue_key: 'X-1', from_value: 'Ready to ship', to_value: 'Transit', last_field_updated: '2024-01-02 00:00:00', ticket_updated: '2024-06-01 00:00:00' },
    ];
    const result = sandbox.deviceUptimeFromChangelog_(rows);
    expect(result.scored).toBe(0);
    expect(result.avg_uptime_pct).toBeNull();
    expect(result.avg_mtbf_days).toBeNull();
    expect(result.avg_mttr_days).toBeNull();
  });

  test('a device with zero downtime incidents scores 100% uptime and null MTBF/MTTR', function () {
    const rows = [
      { issue_key: 'X-2', from_value: 'Field', to_value: 'Deployed', last_field_updated: '2024-01-01 00:00:00', ticket_updated: '2024-01-11 00:00:00' },
    ];
    const result = sandbox.deviceUptimeFromChangelog_(rows);
    expect(result.scored).toBe(1);
    expect(result.avg_uptime_pct).toBe(100);
    expect(result.avg_downtime_days).toBe(0);
    expect(result.avg_mtbf_days).toBeNull(); // no incidents at all -> undefined MTBF, not 0
    expect(result.avg_mttr_days).toBeNull();
  });

  test('fleet average is a plain AVG() across scored devices, and MTTR excludes an ongoing incident even when averaged with a completed one', function () {
    // Device A: 10-day window, one completed 2-day incident -> uptime 80%, MTBF=8d, MTTR=2d.
    // Device B: 10-day window, one STILL-ONGOING 2-day incident (ends at snapshot) ->
    //   uptime 80%, MTBF=8d, MTTR=null (excluded, not yet repaired).
    const rows = [
      { issue_key: 'A', from_value: 'Field', to_value: 'Deployed', last_field_updated: '2024-01-01 00:00:00', ticket_updated: '2024-01-11 00:00:00' },
      { issue_key: 'A', from_value: 'Store', to_value: 'Hardware', last_field_updated: '2024-01-05 00:00:00', ticket_updated: '2024-01-11 00:00:00' },
      { issue_key: 'A', from_value: 'Hardware', to_value: 'Store', last_field_updated: '2024-01-07 00:00:00', ticket_updated: '2024-01-11 00:00:00' },

      { issue_key: 'B', from_value: 'Field', to_value: 'Deployed', last_field_updated: '2024-02-01 00:00:00', ticket_updated: '2024-02-11 00:00:00' },
      { issue_key: 'B', from_value: 'Store', to_value: 'Hardware', last_field_updated: '2024-02-09 00:00:00', ticket_updated: '2024-02-11 00:00:00' },
    ];
    const result = sandbox.deviceUptimeFromChangelog_(rows);
    expect(result.scored).toBe(2);
    expect(result.avg_uptime_pct).toBeCloseTo(80, 1);
    expect(result.avg_mtbf_days).toBeCloseTo(8, 1);
    expect(result.avg_mttr_days).toBeCloseTo(2, 1); // averaged over A only — B has no completed incident
  });
});
