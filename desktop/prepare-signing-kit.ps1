# electron-builder needs its Windows kit (rcedit) to put the icon on the
# program. The kit's archive also holds macOS symlinks, which Windows refuses
# to create without Developer Mode, so electron-builder's own unpacking fails
# and the whole build stops. This unpacks it once, skipping those links -
# they are only used when building for a Mac.
$ErrorActionPreference = "Stop"
$cache = Join-Path $env:LOCALAPPDATA "electron-builder\Cache\winCodeSign"
$kit = Join-Path $cache "winCodeSign-2.6.0"
if (Test-Path (Join-Path $kit "rcedit-x64.exe")) { Write-Host "  [ok] Build kit ready"; exit 0 }
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$7z = Join-Path $here "node_modules\7zip-bin\win\x64\7za.exe"
New-Item -ItemType Directory -Force $cache | Out-Null
$archive = Join-Path $cache "winCodeSign-2.6.0.7z"
Write-Host "  Downloading the build kit (about 6 MB)..."
$ProgressPreference = "SilentlyContinue"
Invoke-WebRequest -UseBasicParsing -OutFile $archive `
  -Uri "https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z"
& $7z x -bd -y $archive "-o$kit" | Out-Null
if (-not (Test-Path (Join-Path $kit "rcedit-x64.exe"))) { throw "Could not unpack the build kit" }
Remove-Item $archive
Write-Host "  [ok] Build kit ready"
