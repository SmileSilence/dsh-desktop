param([switch]$Launch)
$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$DistDir = Join-Path $ProjectRoot 'dist'
$ManifestPath = Join-Path $DistDir 'preview-manifest.json'
if (-not (Test-Path $ManifestPath)) { throw 'preview-manifest.json is missing' }
$Manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$Package = Get-Content (Join-Path $ProjectRoot 'package.json') -Raw | ConvertFrom-Json
if ($Manifest.version -ne $Package.version) { throw "Version mismatch: manifest=$($Manifest.version), package=$($Package.version)" }
if (Get-ChildItem $DistDir -File -Recurse | Where-Object Name -match 'Setup\.exe$') { throw 'Setup is forbidden during Preview' }
foreach ($Entry in $Manifest.files) {
  $File = Join-Path $DistDir $Entry.path
  if (-not (Test-Path $File)) { throw "Manifest file missing: $($Entry.path)" }
  $Item = Get-Item $File
  if ($Item.Length -ne $Entry.size) { throw "File size changed: $($Entry.path)" }
  if ((Get-FileHash $File -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Entry.sha256) { throw "File hash changed: $($Entry.path)" }
}
$Actual = @(Get-ChildItem $DistDir -File -Recurse | Where-Object { $_.FullName -ne $ManifestPath -and $_.Name -notmatch 'Setup\.exe$' })
if ($Actual.Count -ne @($Manifest.files).Count) { throw 'Preview file count differs from manifest' }
$Portable = @(Get-ChildItem $DistDir -File -Recurse | Where-Object Name -match 'Portable.*\.exe$')
if ($Portable.Count -gt 0) { throw 'Portable is forbidden' }
$Payload = Join-Path $DistDir 'DeepSeek Harness-win32-x64\resources\dsh-settings-plugin'
if (Test-Path $Payload) { throw 'Obsolete mirrored plugin payload must not be packaged' }
Write-Host "Preview verified: v$($Manifest.version), $($Actual.Count) files, no Setup/Portable/plugin mirror"
if ($Launch) { Start-Process (Join-Path $DistDir 'DeepSeek Harness-win32-x64\DeepSeek Harness.exe') -WindowStyle Hidden }
