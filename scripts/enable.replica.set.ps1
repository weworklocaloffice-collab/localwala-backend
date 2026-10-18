# LocalWala — Local Commerce & Delivery Platform
#
# Enables a single-node MongoDB replica set so multi-document transactions work.
#
# Requires Administrator. Idempotent: safe to re-run.
#
# What it does, in order:
#   1. adds `replication: replSetName: rs0` to mongod.cfg if absent
#   2. restarts the MongoDB service (drops live connections briefly)
#   3. runs rs.initiate() if the set is not yet initiated
#   4. waits for the node to become PRIMARY
#
# It does NOT touch the application .env — that is a separate, non-elevated step.

$ErrorActionPreference = 'Stop'
$cfg = 'C:\Program Files\MongoDB\Server\8.3\bin\mongod.cfg'

# ---- 1. config -------------------------------------------------------------
if (Select-String -Path $cfg -Pattern 'replication:' -Quiet) {
    Write-Output 'config: replication block already present, leaving as-is'
} else {
    $text = Get-Content $cfg -Raw
    # Insert before the #sharding marker so the YAML keys stay grouped.
    $block = @"
replication:
  replSetName: rs0

#sharding:
"@
    $text = $text -replace '(?m)^#sharding:\s*$', $block
    Set-Content -Path $cfg -Value $text -NoNewline
    Write-Output 'config: added replication.replSetName = rs0'
}

# ---- 2. restart ------------------------------------------------------------
Write-Output 'service: restarting MongoDB...'
Restart-Service MongoDB -Force

# Wait for the process to answer again before touching the replica set API.
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $null = & mongosh --quiet --eval 'db.adminCommand({ ping: 1 })' 2>$null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    } catch { }
}
if (-not $ready) {
    Write-Output 'service: mongod did not come back within 20s — STOP, check the log'
    exit 1
}
Write-Output 'service: mongod is answering'

# ---- 3. initiate -----------------------------------------------------------
$already = & mongosh --quiet --eval 'try { rs.status().ok } catch (e) { 0 }' 2>$null
if ($already -match '1') {
    Write-Output 'replica set: already initiated, skipping rs.initiate'
} else {
    Write-Output 'replica set: initiating rs0...'
    & mongosh --quiet --eval "rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27017' }] })"
}

# ---- 4. wait for PRIMARY ---------------------------------------------------
$state = ''
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    $state = (& mongosh --quiet --eval 'try { rs.status().myState === 1 ? "PRIMARY" : rs.status().myState } catch (e) { "NOTREADY" }' 2>$null | Select-Object -Last 1)
    if ("$state" -eq 'PRIMARY') { break }
}

Write-Output ''
Write-Output "replica set state : $state"
if ("$state" -eq 'PRIMARY') {
    Write-Output 'RESULT: SUCCESS — transactions are now available'
    Write-Output 'NEXT  : add ?replicaSet=rs0 to MONGODB_URL in the API .env'
} else {
    Write-Output 'RESULT: INCONCLUSIVE — node state is not PRIMARY (see mongod.log)'
    exit 1
}