param([switch]$FromValidatedPreview)
$ErrorActionPreference = 'Stop'
if (-not $FromValidatedPreview) { throw 'Pass -FromValidatedPreview after Preview validation.' }
$ProjectRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
& (Join-Path $PSScriptRoot 'verify-preview.ps1')
$Before = @(Get-ChildItem (Join-Path $ProjectRoot 'dist') -File -Recurse | Select-Object -ExpandProperty FullName)
$CacheRoot = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache'
$MakeNsis = Get-ChildItem $CacheRoot -Recurse -Filter 'makensis.exe' -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\Bin\\' } | Select-Object -First 1 -ExpandProperty FullName
if (-not $MakeNsis) { throw 'makensis.exe was not found.' }
Push-Location $ProjectRoot
try {
  & $MakeNsis -V3 (Join-Path $ProjectRoot 'installer.nsi')
  if ($LASTEXITCODE -ne 0) { throw 'Setup compilation failed.' }
} finally { Pop-Location }
$After = @(Get-ChildItem (Join-Path $ProjectRoot 'dist') -File -Recurse)
$Added = @($After | Where-Object { $_.FullName -notin $Before })
if ($Added.Count -ne 1 -or $Added[0].Name -notmatch 'Setup\.exe$') { throw 'Setup stage produced unexpected files.' }
Write-Host "Setup: $($Added[0].FullName) SHA256=$((Get-FileHash $Added[0].FullName -Algorithm SHA256).Hash)"
