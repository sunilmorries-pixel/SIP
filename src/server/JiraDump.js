/**
 * JiraDump.js — OFFLINE snapshot of the Jira devices export
 * ("TA Live Jira Import (1).xlsx", raw-data sheet, 43,794 rows), used as the
 * Devices source while the Google Sheets API is still disabled on the project.
 *
 * As soon as readJiraSheet() succeeds (Sheets API enabled + sheet shared), the
 * LIVE sheet takes over automatically and this snapshot is ignored.
 *
 * Pre-aggregated (dedup by Key). The device→center link IGNORES the Jira
 * "Customer ID" column; instead the device serial (parsed from Summary) is
 * matched to cloud_devices.DeviceID → CenterID (center_details has no serial
 * column in the sandbox, so cloud_devices is the serial↔center bridge). Hence
 * with_center/in_cd only cover devices present in cloud_devices (~9.9k of 43.8k).
 * To refresh from a newer dump, re-run the aggregation and replace the object.
 */
var JIRA_DUMP = {
  total: 43794,
  with_center: 9888,
  jira_centers: 4621,
  in_cd: 9888,
  by_status: [
    { k: 'Deployed', n: 23165 },
    { k: 'Delivered', n: 6085 },
    { k: 'Hardware', n: 3997 },
    { k: 'Decommissioned', n: 3361 },
    { k: 'Store', n: 2873 },
    { k: 'Field', n: 2089 },
    { k: 'Exported', n: 1734 },
    { k: 'Ownership Transferred', n: 254 },
    { k: 'UNKNOWN', n: 179 },
    { k: 'Misplaced', n: 46 },
    { k: 'Transit', n: 8 },
    { k: 'Ready to ship', n: 3 }
  ]
};
