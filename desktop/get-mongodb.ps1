# Downloads MongoDB Community Server for Windows and keeps only mongod.exe,
# plus the Visual C++ runtime files it needs, so the desktop app does not
# depend on anything being installed on the PC it goes to.
$ErrorActionPreference = "Stop"
$version = "8.0.4"
$url = "https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-$version.zip"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $here "vendor\mongodb"
$tmp = Join-Path $env:TEMP "order-ledger-mongodb"

New-Item -ItemType Directory -Force $dest, $tmp | Out-Null
$zip = Join-Path $tmp "mongodb.zip"
Write-Host "  Downloading MongoDB $version (about 400 MB)..."
$ProgressPreference = "SilentlyContinue"
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
try {
  $entry = $archive.Entries | Where-Object { $_.FullName -like "*/bin/mongod.exe" } | Select-Object -First 1
  if (-not $entry) { throw "mongod.exe was not in the download" }
  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $dest "mongod.exe"), $true)
} finally {
  $archive.Dispose()
}
# mongod.exe is built against the Visual C++ runtime. Microsoft allows
# shipping these next to a program, which saves the PC needing it installed.
foreach ($dll in "msvcp140.dll", "msvcp140_1.dll", "vcruntime140.dll", "vcruntime140_1.dll") {
  $src = Join-Path $env:WINDIR "System32\$dll"
  if (-not (Test-Path $src)) { throw "$dll is missing on this PC - install the Visual C++ Redistributable (x64) from Microsoft, then build again" }
  Copy-Item $src $dest -Force
}
Remove-Item -Recurse -Force $tmp
Write-Host "  [ok] MongoDB ready"
