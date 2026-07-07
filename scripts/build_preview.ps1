# Assembles src/client/* into a single standalone HTML file (mock-data mode)
# and serves it on http://localhost:8765/preview.html for local UI preview.
# The mock kicks in automatically because `google.script` is undefined outside
# Apps Script — no server code required.

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$src  = Join-Path $root 'src\client'
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$out  = Join-Path $dist 'preview.html'

$index  = Get-Content (Join-Path $src 'Index.html')   -Raw -Encoding UTF8
$styles = Get-Content (Join-Path $src 'Styles.html')  -Raw -Encoding UTF8
$charts = Get-Content (Join-Path $src 'Charts.html')  -Raw -Encoding UTF8
$app    = Get-Content (Join-Path $src 'App.html')     -Raw -Encoding UTF8
$mapv   = Get-Content (Join-Path $src 'MapView.html') -Raw -Encoding UTF8

$html = $index.
  Replace("<?!= include('Styles') ?>", $styles).
  Replace("<?!= include('Charts') ?>", $charts).
  Replace("<?!= include('MapView') ?>", $mapv).
  Replace("<?!= include('App') ?>", $app).
  Replace('<?= appName ?>', 'SIP Insights').
  Replace('<?= appVersion ?>', 'preview')

$html = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>SIP Insights preview</title></head><body>' + $html + '</body></html>'

[IO.File]::WriteAllText($out, $html, (New-Object Text.UTF8Encoding $false))
Write-Host "Built $out"
Write-Host "Serving on http://localhost:8765/preview.html  (Ctrl+C to stop)"
python -m http.server 8765 --directory $dist
