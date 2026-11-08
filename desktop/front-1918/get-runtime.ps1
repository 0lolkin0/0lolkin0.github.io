# Downloads the Electron runtime for Front 1918 from the official GitHub release,
# checks its SHA-256 and unpacks it into the install folder.
param([Parameter(Mandatory = $true)][string]$Dest)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
$url = 'https://github.com/electron/electron/releases/download/v33.2.1/electron-v33.2.1-win32-x64.zip'
$sha = 'C325A6D905C67107E166267813EA2151AE7FD316C0A88DE0081DB0B9851A9946'
$zip = Join-Path $env:TEMP 'front1918-runtime.zip'
$tmp = Join-Path $env:TEMP 'front1918-runtime'
try {
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  $h = (Get-FileHash -Path $zip -Algorithm SHA256).Hash
  if ($h -ne $sha) { Write-Output "checksum mismatch: $h"; exit 2 }
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $tmp)
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  Copy-Item -Path (Join-Path $tmp '*') -Destination $Dest -Recurse -Force
  exit 0
} catch {
  Write-Output $_.Exception.Message
  exit 1
} finally {
  if (Test-Path $zip) { Remove-Item $zip -Force -ErrorAction SilentlyContinue }
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
