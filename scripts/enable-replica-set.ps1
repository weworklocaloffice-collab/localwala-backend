# Convert the local MongoDB to a single-node replica set
#
# WHY
#   Multi-document transactions require a replica set. The API wraps its writes in
#   `withOptionalTransaction`, which degrades gracefully when transactions are
#   unavailable — so the platform runs, but a multi-document write is not atomic.
#   With no replica set, an order that touches an order, a wallet and a can ledger
#   can be left half-applied if the process dies midway.
#
#   The paths that matter are called out in `src/utils/optionalTransaction.js`: the
#   can-ledger reconciliation in `delivery.run.service.completeRun`, where a partial
#   write means cans go missing and the depot gate never balances.
#
#   A single-node replica set is enough to enable transactions. It does NOT give
#   redundancy: there is still one node, so if it dies the data is only as safe as
#   your most recent backup. For development that is the right trade; production
#   wants three or more members, which is a hosting decision, not a config file.
#
# WHAT IT CHANGES
#   One line in `mongod.cfg`:
#       #replication:
#     becomes
#       replication:
#         replSetName: rs0
#
#   Then the set is initiated once. That writes `local.system.replset` and creates
#   the oplog. Existing collections are untouched — this is not a data migration.
#
# WHY YOU HAVE TO RUN THIS
#   Editing `C:\Program Files\...` and controlling a Windows service both need
#   administrator rights.
#
# USAGE
#   1. Open PowerShell as Administrator.
#   2. Run this script.
#   3. Read the output. If it says transactions are confirmed, nothing else to do.
#
# TO REVERT
#   Put the `replication:` block back to `#replication:` in mongod.cfg and restart.
#   `$cfgBackup` inside the script's backup folder holds the original file.

$ErrorActionPreference = 'Stop'

$cfg        = 'C:\Program Files\MongoDB\Server\8.3\bin\mongod.cfg'
$service    = 'MongoDB'
$apiDir     = Split-Path -Parent $PSScriptRoot
$replicaJs  = Join-Path $apiDir 'scripts\mongo.replica-set.js'
$dbPath     = 'C:\Program Files\MongoDB\Server\8.3\data'
$stamp      = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup     = "C:\mongodb-backup\$stamp"

function Say($m) { Write-Host "  $m" }
function Die($m) { Write-Host ''; Write-Host $m -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host 'MongoDB replica set setup' -ForegroundColor Cyan
Write-Host ''

$isAdmin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Write-Host 'This must run as Administrator.' -ForegroundColor Red
  Write-Host '  Right-click PowerShell, "Run as administrator", then run this file again.'
  exit 1
}

if (-not (Test-Path $cfg))            { Die "config not found: $cfg" }
if (-not (Test-Path $dbPath))         { Die "data directory not found: $dbPath" }
if (-not (Get-Service $service -ErrorAction SilentlyContinue)) { Die "the $service service is not installed." }
if (-not (Test-Path $replicaJs))      { Die "helper not found: $replicaJs" }

# ---- 1. Stop the service so the copy is a consistent snapshot ---------------
# Copying a live data directory gives you whatever mongod happened to have half
# written. The files are usually recoverable on replay, but "usually" is not a
# property you want in the one backup protecting a conversion.
Write-Host '1. Stopping the MongoDB service' -ForegroundColor Yellow
Stop-Service $service -Force
$deadline = (Get-Date).AddSeconds(45)
while ((Get-Service $service).Status -ne 'Stopped' -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
}
if ((Get-Service $service).Status -ne 'Stopped') { Die 'the service did not stop; aborting before any changes.' }
Say 'service stopped'

# ---- 2. Back up the data directory AND the config ---------------------------
Write-Host '2. Backing up the data directory and mongod.cfg' -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $backup | Out-Null

robocopy $dbPath (Join-Path $backup 'data') /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
if ($LASTEXITCODE -ge 8) {
  Die "backup reported robocopy code $LASTEXITCODE - stop and check $backup\data"
}
$bytes = (Get-ChildItem (Join-Path $backup 'data') -Recurse -File | Measure-Object Length -Sum).Sum
Say ("backed up {0:N1} MB of data to {1}\data" -f ($bytes/1MB), $backup)

# The config lives in bin\, not in the data directory, so robocopy does not reach it.
# Without this copy the revert instructions would point at a folder that does not
# contain the file you need.
Copy-Item $cfg (Join-Path $backup 'mongod.cfg') -Force
Say ("backed up the original config to {0}\mongod.cfg" -f $backup)

Write-Host '3. Starting the service again' -ForegroundColor Yellow
Start-Service $service
$deadline = (Get-Date).AddSeconds(45)
while ((Get-Service $service).Status -ne 'Running' -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
}
if ((Get-Service $service).Status -ne 'Running') { Die 'the service did not restart; nothing has been changed yet.' }
Say 'service running'

# ---- 4. Edit the config -------------------------------------------------
Write-Host '4. Adding the replication block' -ForegroundColor Yellow
$text = Get-Content $cfg -Raw

if ($text -match '(?m)^\s*replSetName:') {
  Say 'already configured - skipping the edit'
} elseif ($text -match '(?m)^#replication:') {
  $text = $text -replace '(?m)^#replication:', "replication:`r`n  replSetName: rs0"
  [System.IO.File]::WriteAllText($cfg, $text)
  Say 'uncommented replication and set replSetName: rs0'
} else {
  $text = $text.TrimEnd() + "`r`n`r`nreplication:`r`n  replSetName: rs0`r`n"
  [System.IO.File]::WriteAllText($cfg, $text)
  Say 'appended a replication block'
}

# ---- 5. Restart with the new flag --------------------------------------
Write-Host '5. Restarting the MongoDB service' -ForegroundColor Yellow
Restart-Service $service -Force

# Poll instead of sleeping a fixed number of seconds. A fixed wait reports a slow
# but healthy service as a failure.
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Service $service).Status -ne 'Running' -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
}

if ((Get-Service $service).Status -ne 'Running') {
  Write-Host ''
  Write-Host 'The service did not come back up.' -ForegroundColor Red
  Write-Host 'Reverting the config now.'
  Copy-Item (Join-Path $backup 'mongod.cfg') $cfg -Force
  Start-Service $service
  Write-Host ''
  Write-Host "  Original config restored from $backup\mongod.cfg" -ForegroundColor Yellow
  Write-Host '  Tail the log for the reason: C:\Program Files\MongoDB\Server\8.3\log\mongod.log'
  exit 1
}
Say 'service is running with replSetName: rs0'

# ---- 6. Initiate and verify --------------------------------------------
# MongoDB 8.3 installs only mongod.exe and mongos.exe - there is no shell binary to
# run rs.initiate() from. The helper uses the driver the API already depends on, and
# verifies through the application's own MONGODB_URL rather than a separate client.
Write-Host '6. Initiating the set and verifying transactions' -ForegroundColor Yellow
Write-Host '   (this takes a few seconds while the node holds an election)'

Push-Location $apiDir
try {
  & node $replicaJs
  $probeExit = $LASTEXITCODE
} finally {
  Pop-Location
}

if ($probeExit -ne 0) {
  Write-Host ''
  Write-Host 'The set was not confirmed. Nothing else has been changed.' -ForegroundColor Yellow
  Write-Host "  Data backup : $backup\data"
  Write-Host "  Config backup: $backup\mongod.cfg"
  Write-Host ''
  Write-Host '  To revert, stop the service, replace mongod.cfg with the backup copy,'
  Write-Host '  and start it again.'
  exit 1
}

Write-Host ''
Write-Host 'Done. Transactions are confirmed through the application connection.' -ForegroundColor Green
Write-Host ''
Write-Host "  Backups kept at: $backup"
Write-Host ''
Write-Host '  Next: re-run the suites that depend on atomicity.'
Write-Host '    node scripts/verify.all.dairy.js'
Write-Host ''