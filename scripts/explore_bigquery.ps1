# Read-only schema/sample explorer for the SIP dataset.
# Usage:  powershell -File scripts/explore_bigquery.ps1
# Requires: Google Cloud SDK (bq) and the service-account key in credentials/.

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$key  = Join-Path $root 'credentials\abi_team_sip_bq_access_service_account.json'
if (-not (Test-Path $key)) { throw "Service-account key not found at $key" }

$env:CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE = $key
$project = 'magnaquest-sand-box'
$dataset = 'abi_team_sip_devtest_poc'

foreach ($t in @('cloud_devices','device_center_mapping','jira_data','device_metrics','zoho_data')) {
    Write-Host "`n=== $t ===" -ForegroundColor Cyan
    bq show "${project}:${dataset}.$t"
}
