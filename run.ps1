param(
  [switch]$BuildOnly,
  [switch]$Dev
)

$ErrorActionPreference = "Stop"
$Port = 4173

if ($Dev) {
  Write-Host "Starting dev server..." -ForegroundColor Cyan
  npm run dev
  exit
}

# Build if dist doesn't exist or if forcing build
if (!(Test-Path "dist") -or $BuildOnly) {
  Write-Host "Building PocketLedger..." -ForegroundColor Yellow
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Build failed" }
  Write-Host "Build complete!" -ForegroundColor Green
}

if ($BuildOnly) { exit }

Write-Host "Starting PocketLedger at http://localhost:$Port" -ForegroundColor Cyan
Start-Process "http://localhost:$Port"
npm run preview -- --host --port $Port
