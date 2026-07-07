# Apps Script → BigQuery Connection Setup

## Overview
This document records how the Apps Script project connects to BigQuery using a service account, for the `magnaquest-sand-box` sandbox project.

**Status:** ✅ Working — confirmed successful query against `cloud_devices` table.

---

## Project Details

| Field | Value |
|---|---|
| Project ID | `magnaquest-sand-box` |
| Dataset | `abi_team_sip_devtest_poc` |
| Service Account | `abi-poc-bq-access-sa@magnaquest-sand-box.iam.gserviceaccount.com` |
| Token URI | `https://oauth2.googleapis.com/token` |

### Tables in dataset (6)
- `center_details` — sole center source (added; the dashboard's primary dimension)
- `cloud_devices`
- `device_center_mapping`
- `jira_data`
- `device_metrics`
- `zoho_data`

---

## Setup Steps

### 1. Add OAuth2 library
In Apps Script editor → **Libraries (+)** → add Script ID:
```
1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF
```

### 2. Store service account key (one-time)
Run once, then delete the key block from source code:

```javascript
function setup() {
  var key = {
    "type": "service_account",
    "project_id": "magnaquest-sand-box",
    "private_key_id": "YOUR_PRIVATE_KEY_ID",
    "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
    "client_email": "abi-poc-bq-access-sa@magnaquest-sand-box.iam.gserviceaccount.com",
    "client_id": "YOUR_CLIENT_ID",
    "token_uri": "https://oauth2.googleapis.com/token"
  };

  PropertiesService.getScriptProperties().setProperty('SA_KEY', JSON.stringify(key));
  Logger.log('Saved successfully');
}
```

> ⚠️ **Never leave the real `private_key` value in source code long-term.** Run `setup()` once, confirm "Saved successfully" in the execution log, then delete the key object from the function body.

### 3. Auth + query functions

```javascript
function getService() {
  const key = JSON.parse(PropertiesService.getScriptProperties().getProperty('SA_KEY'));
  return OAuth2.createService('BigQuery')
    .setTokenUrl(key.token_uri)
    .setPrivateKey(key.private_key)
    .setIssuer(key.client_email)
    .setPropertyStore(PropertiesService.getScriptProperties())
    .setScope('https://www.googleapis.com/auth/bigquery.readonly');
}

function runQuery() {
  const service = getService();
  if (!service.hasAccess()) {
    Logger.log(service.getLastError());
    return;
  }
  const projectId = 'magnaquest-sand-box';
  const url = 'https://bigquery.googleapis.com/bigquery/v2/projects/' + projectId + '/queries';
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + service.getAccessToken() },
    payload: JSON.stringify({
      query: 'SELECT CenterID, Centername, DeviceID, LastTimeStamp FROM `magnaquest-sand-box.abi_team_sip_devtest_poc.cloud_devices` LIMIT 10',
      useLegacySql: false
    })
  });
  const data = JSON.parse(response.getContentText());
  data.rows.forEach(row => {
    Logger.log(row.f.map(f => f.v).join(' | '));
  });
}
```

### 4. Run
Select `runQuery` from the function dropdown → **Run** → check **Execution log**.

---

## Issues Encountered & Fixes

| Error | Cause | Fix |
|---|---|---|
| `SyntaxError: Unexpected token ':'` | Raw JSON pasted directly into `.gs` file (not valid as a bare statement) | Wrap in a variable assignment (`var key = {...}`) |
| `property name must not be null or empty` | `setProperty()` called with wrong/missing first argument | Ensure exact string `'SA_KEY'` used as property name, matching in both `setProperty` and `getProperty` |
| `403 Access Denied` | Table name was still placeholder (`YOUR_DATASET.YOUR_TABLE`) and/or missing IAM roles | Replace with real dataset/table path; ensure SA has `BigQuery Data Viewer` + `BigQuery Job User` roles |
| `ReferenceError: getService is not defined` | `getService()` function accidentally deleted during cleanup of `setup()` | Re-add `getService()` above `runQuery()` |
| `Logging output too large. Truncating output` | `Logger.log()` on full raw JSON response | Select specific columns in query; log parsed/mapped fields instead of raw response |

---

## Security Notes

- **`project_id`, `client_email`, `token_uri`** — safe to share/document; these are identifiers, not secrets.
- **`private_key`** — never share, paste into chat, or leave in source code. Store only in Script Properties.
- This service account (`abi-poc-bq-access-sa`) uses a **newly generated key**, separate from the previously exposed `magnaquest-sand-box` credential incident. Confirm old key was rotated/revoked if not already done.
- Scope used: `bigquery.readonly` — read-only access, no write/modify capability from this script.

---

## Required IAM Roles (for admin)
On `magnaquest-sand-box`, grant to `abi-poc-bq-access-sa@magnaquest-sand-box.iam.gserviceaccount.com`:
- `BigQuery Data Viewer`
- `BigQuery Job User`

---

## Next Steps
- [ ] Confirm old exposed service account key (if different from this one) has been rotated
- [ ] Write queries against remaining tables: `device_center_mapping`, `jira_data`, `device_metrics`, `zoho_data`
- [ ] Decide if this needs to run on a time-based trigger (unattended) — if so, confirm this SA-based auth (not user OAuth) is the right long-term approach
