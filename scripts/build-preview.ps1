$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent)).TrimEnd('\')
$DistDir = [IO.Path]::GetFullPath((Join-Path $ProjectRoot 'dist')).TrimEnd('\')
if ([IO.Path]::GetDirectoryName($DistDir).TrimEnd('\') -ne $ProjectRoot -or [IO.Path]::GetFileName($DistDir) -ne 'dist') { throw "拒绝操作非预期目录: $DistDir" }
$Processes = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($DistDir + '\', [StringComparison]::OrdinalIgnoreCase) }
foreach ($Process in $Processes) { & taskkill /PID $Process.ProcessId /T /F | Out-Null }
$Remaining = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($DistDir + '\', [StringComparison]::OrdinalIgnoreCase) }
if ($Remaining) { throw 'dist 内仍有运行进程，拒绝删除' }
if (Test-Path -LiteralPath $DistDir) { [IO.Directory]::Delete($DistDir, $true) }
if (Test-Path -LiteralPath $DistDir) { throw "旧 dist 未彻底删除: $DistDir" }
New-Item -ItemType Directory -Path $DistDir | Out-Null
& (Join-Path $PSScriptRoot 'build-common.ps1')
$ManifestPath = Join-Path $DistDir 'preview-manifest.json'
$Files = Get-ChildItem $DistDir -File -Recurse | Where-Object { $_.FullName -ne $ManifestPath -and $_.Name -notmatch 'Setup\.exe$' } | Sort-Object FullName | ForEach-Object {
  [pscustomobject]@{ path = $_.FullName.Substring($DistDir.Length + 1).Replace('\','/'); size = $_.Length; sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$Package = Get-Content (Join-Path $ProjectRoot 'package.json') -Raw | ConvertFrom-Json
[pscustomobject]@{ version = $Package.version; generatedAt = (Get-Date).ToUniversalTime().ToString('o'); files = @($Files) } | ConvertTo-Json -Depth 5 | Set-Content $ManifestPath -Encoding utf8
& (Join-Path $PSScriptRoot 'verify-preview.ps1')
