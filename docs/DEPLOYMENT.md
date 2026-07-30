# Deployment Guide

Two paths: **clasp** (recommended — keeps this repo as the source of truth) or
**manual copy-paste** into the Apps Script editor.

---

## Path A — clasp (recommended)

### One-time setup

```powershell
npm install -g @google/clasp      # already installed if `clasp -v` works
clasp login                        # opens browser; use your Google account
```

Link this folder to your existing Apps Script project:

```powershell
# find the script ID: Apps Script editor → Project Settings → Script ID
Copy-Item .clasp.json.example .clasp.json
# then edit .clasp.json and paste your scriptId
```

### Push

```powershell
clasp push        # uploads src/ (server/*.js, client/*.html, appsscript.json)
```

> clasp preserves the folder prefix: files arrive as `server/Config`,
> `client/Index`, … The `include()` helper in `WebApp.js` resolves both
> `client/Styles` and flat `Styles`, so either layout works.

> **Note:** `clasp push` overwrites the remote project with the contents of
> `src/`. Any code that exists only in the online editor will be replaced —
> keep this repo as the single source of truth.

---

## Path B — manual copy-paste

In the Apps Script editor create **every** file under `src/server` and `src/client` and paste
contents 1:1 (clasp Path A does this automatically — prefer it). Current file set (v5.0):

| Editor file (type) | Source in this repo |
|---|---|
| `Config` (script) | `src/server/Config.js` |
| `Auth` (script) | `src/server/Auth.js` |
| `BigQuery` (script) | `src/server/BigQuery.js` |
| `Queries` (script) | `src/server/Queries.js` |
| `EditionCD` (script) | `src/server/EditionCD.js` — **live center_details data layer** |
| `SlaCatalog` (script) | `src/server/SlaCatalog.js` |
| `Numbers` (script) | `src/server/Numbers.js` |
| `RawData` (script) | `src/server/RawData.js` — **Raw Data page server layer (v5.2)** |
| `Api` (script) | `src/server/Api.js` |
| `TopCustomers` (script) | `src/server/TopCustomers.js` |
| `ExecOverview` (script) | `src/server/ExecOverview.js` |
| `Geo` (script) | `src/server/Geo.js` |
| `Join` (script) | `src/server/Join.js` |
| `WebApp` (script) | `src/server/WebApp.js` |
| `Setup` (script) | `src/server/Setup.js` |
| `Warm` (script) | `src/server/Warm.js` — **cache-warming trigger (`installWarmTrigger()`, every 10 min)** |
| `Index` (HTML) | `src/client/Index.html` |
| `Styles` (HTML) | `src/client/Styles.html` |
| `Charts` (HTML) | `src/client/Charts.html` |
| `MapView` (HTML) | `src/client/MapView.html` |
| `App` (HTML) | `src/client/App.html` |

Also mirror `src/appsscript.json` (editor → Project Settings → check
*Show "appsscript.json" manifest file*), or add manually:
- **Library**: OAuth2 — script ID `1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF`, latest version, identifier `OAuth2`.

---

## After the code is in (both paths)

### 1. Store the service-account key (one time)
1. Open `Setup` → `setupServiceAccountKey()`.
2. Replace `var key = null;` with the full JSON from
   `credentials/abi_team_sip_bq_access_service_account.json`.
3. Run the function once → log should say *saved*.
4. **Delete the pasted JSON** from the file and save again. The key now lives
   only in Script Properties (`SA_KEY_DWH`).

### 2. Verify
Run `diagnostics()` in the editor. Expected log output: `Health check: {"ok":true…}`
followed by row counts per panel (`kpis: 1 rows`, `fleetStatus: 6 rows`, …).

### 3. Deploy the web app
1. **Deploy → New deployment → Web app**
2. *Execute as*: **Me** (the deploying account owns the SA key)
3. *Who has access*: **Anyone within your organisation** (or as needed)
4. Open the deployment URL.

### 4. Redeploying after changes
- `clasp push` (or paste changes), then **Deploy → Manage deployments →
  ✏️ edit → Version: New version → Deploy**. The URL stays stable.
- If you changed queries, either wait 15 minutes (`CONFIG.CACHE_TTL_SECONDS`, cache TTL)
  or hit Refresh in the UI (it bypasses the cache).

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Banner: *Service-account key not found* | `setupServiceAccountKey()` never ran — do step 1 |
| Banner: *BigQuery auth failed* | SA lacks `BigQuery Data Viewer` + `BigQuery Job User` on `tricogde-dwh`, or key was rotated |
| Panels empty, log shows `Query "x" failed` | Run the SQL from `Queries.js` in the BigQuery console to see the real error |
| Charts blank on a tab | Hard-refresh; charts flush when a tab first becomes visible — a JS error earlier in the console is the usual culprit |
| `Logging output too large` in editor | Expected for big payloads — use `diagnostics()` which logs row counts only |
| Stale numbers | Cache is 15 min; Refresh button forces bypass |
