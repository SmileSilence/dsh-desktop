$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$DistDir = Join-Path $ProjectRoot 'dist'
$AppDir = Join-Path $DistDir 'DeepSeek Harness-win32-x64'
$Package = Get-Content (Join-Path $ProjectRoot 'package.json') -Raw | ConvertFrom-Json
$Version = [string]$Package.version
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "package.json version 非法: $Version" }
if (Test-Path $AppDir) { throw "组装目录已存在，公共脚本不负责删除: $AppDir" }
Push-Location $ProjectRoot
try {
  & npm run icons
  if ($LASTEXITCODE -ne 0) { throw '图标生成失败' }
  New-Item -ItemType Directory -Path $AppDir -Force | Out-Null
  Copy-Item (Join-Path $ProjectRoot 'node_modules\electron\dist\*') $AppDir -Recurse -Force
  Rename-Item (Join-Path $AppDir 'electron.exe') 'DeepSeek Harness.exe'
  $ExePath = Join-Path $AppDir 'DeepSeek Harness.exe'
  $RcEdit = Join-Path $ProjectRoot 'node_modules\rcedit\bin\rcedit-x64.exe'
  if (-not (Test-Path $RcEdit)) { throw "rcedit not found: $RcEdit" }
  & $RcEdit $ExePath --set-icon (Join-Path $ProjectRoot 'assets\app.ico') --set-file-version $Version --set-product-version $Version --set-version-string ProductName 'DeepSeek Harness' --set-version-string FileDescription 'DeepSeek Harness Desktop' --set-version-string OriginalFilename 'DeepSeek Harness.exe'
  if ($LASTEXITCODE -ne 0) { throw 'Failed to write EXE icon/version resources' }
  Remove-Item (Join-Path $AppDir 'resources\default_app.asar') -Force -ErrorAction SilentlyContinue
  $Stage = Join-Path ([IO.Path]::GetTempPath()) ("dsh-desktop-asar-" + [guid]::NewGuid().ToString('N'))
  try {
    New-Item -ItemType Directory -Path (Join-Path $Stage 'assets') -Force | Out-Null
    Copy-Item (Join-Path $ProjectRoot 'main.js'), (Join-Path $ProjectRoot 'preload.js'), (Join-Path $ProjectRoot 'package.json') $Stage
    Copy-Item (Join-Path $ProjectRoot 'main') (Join-Path $Stage 'main') -Recurse
    Copy-Item (Join-Path $ProjectRoot 'assets\icon.png'), (Join-Path $ProjectRoot 'assets\icon-32.png'), (Join-Path $ProjectRoot 'assets\icon-256.png') (Join-Path $Stage 'assets')
    & (Join-Path $ProjectRoot 'node_modules\.bin\asar.cmd') pack $Stage (Join-Path $AppDir 'resources\app.asar')
    if ($LASTEXITCODE -ne 0) { throw 'app.asar 组装失败' }
  } finally {
    if (Test-Path $Stage) { [IO.Directory]::Delete($Stage, $true) }
  }
  [IO.File]::WriteAllText((Join-Path $ProjectRoot 'version.nsh'), "!define VERSION `"$Version`"`r`n", [Text.UTF8Encoding]::new($false))
} finally { Pop-Location }
