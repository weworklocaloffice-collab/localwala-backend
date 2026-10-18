# LocalWala — Local Commerce & Delivery Platform
# Enables a single-node MongoDB replica set (rs0) so multi-document transactions work.
# Requires Administrator. Idempotent.

$ErrorActionPreference = 'Continue'
$cfg = 'C:\Program Files\MongoDB\Server\8.3\bin\mongod.cfg'

# ---- 1. config: make `replication:` ACTIVE ----------------------------------
$text = Get-Content $cfg -Raw
if ($text -match '(?m)^replication:') {
    Write-Output 'config: replication already ACTIVE, leaving as-is'
} else {
    if ($text -match '(?m)^#replication:') {
        $text = $text -replace '(?m)^#replication:\s*$', "replication:`r`n  replSetName: rs0"
        Write-Output 'config: uncommented existing #replication: block'
    } else {
        $text = $text -replace '(?m)^#sharding:\s*$', "replication:`r`n  replSetName: rs0`r`n`r`n#sharding:"
        Write-Output 'config: inserted replication block'
    }
    Set-Content -Path $cfg -Value $text -NoNewline
}

Write-Output '--- active lines in cfg ---'
Get-Content $cfg | Select-String -Pattern 'replication|replSetName|sharding' | ForEach-Object { Write-Output $_.Line }

# ---- 2. restart --------------------------------------------------------------
Write-Output 'service: restarting MongoDB...'
Restart-Service MongoDB -Force
Start-Sleep -Seconds 3

# wait for mongod to answer ping
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
    $out = & node -e "const {MongoClient}=require('mongodb');(async()=>{try{const c=new MongoClient('mongodb://127.0.0.1:27017/?directConnection=true');await c.connect();await c.db('admin').command({ping:1});await c.close();console.log('ok');}catch(e){console.log('no');}})()" 2>$null
    if ("$out" -match 'ok') { $ready = $true; break }
    Start-Sleep -Milliseconds 500
}
Write-Output "service: mongod answering = $ready"
if (-not $ready) { Write-Output 'RESULT: FAIL — mongod not back'; exit 1 }

# ---- 3. rs.initiate (via the Node driver; mongosh is not installed) ----------
Write-Output 'replica set: initiating (directConnection)...'
$init = & node -e "const {MongoClient}=require('mongodb');(async()=>{const c=new MongoClient('mongodb://127.0.0.1:27017/?directConnection=true');await c.connect();try{const r=await c.db('admin').command({replSetInitiate:{_id:'rs0',members:[{_id:0,host:'127.0.0.1:27017'}]}});console.log('ok:'+r.ok);}catch(e){console.log('skip:'+e.message);}await c.close();})()" 2>&1
Write-Output "rs.initiate: $init"

# ---- 4. wait for PRIMARY -----------------------------------------------------
$state = ''
for ($i = 0; $i -lt 60; $i++) {
    $state = & node -e "const {MongoClient}=require('mongodb');(async()=>{const c=new MongoClient('mongodb://127.0.0.1:27017/?directConnection=true');await c.connect();const h=await c.db('admin').command({hello:1});console.log(h.setName ? (h.isWritablePrimary?'PRIMARY':'SECONDARY?') : 'STANDALONE');await c.close();})()" 2>&1
    if ("$state" -match 'PRIMARY') { break }
    Start-Sleep -Milliseconds 750
}

Write-Output "replica set state: $state"
Write-Output $(if ("$state" -match 'PRIMARY') { 'RESULT: SUCCESS' } else { 'RESULT: CHECK mongod.log' })