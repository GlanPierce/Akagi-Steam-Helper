$ErrorActionPreference = 'Stop'
$taskHelper = Join-Path $PSScriptRoot 'Steam-BridgeHealth.ps1'
if (-not (Test-Path -LiteralPath $taskHelper)) { throw 'Missing recovery: a live game can bypass a running relay indefinitely.' }
. $taskHelper

function Assert-Bridge([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function Sample-Bridge($State, [long]$Now, [int]$Games = 2, [int]$Relays = 0, [bool]$Known = $true) {
    Update-SteamBridgeHealth -State $State -NowMs $Now -GameConnections $Games -RelayConnections $Relays -QuerySucceeded $Known
}

$taskState = New-SteamBridgeHealth -NowMs 0
Assert-Bridge (-not (Sample-Bridge $taskState 12000)) 'A single routing snapshot must not interrupt the game.'
Assert-Bridge (-not (Sample-Bridge $taskState 16000)) 'Allow a transient connection transition.'
Assert-Bridge (Sample-Bridge $taskState 20000) 'Recover when game connections persist while the relay stays empty.'
Assert-Bridge (-not (Sample-Bridge $taskState 24000)) 'Do not restart repeatedly during reconnection.'
Assert-Bridge (-not (Sample-Bridge $taskState 30000)) 'Recovery needs a cooldown.'
Assert-Bridge (-not (Sample-Bridge $taskState 60000)) 'A failed recovery must not create a fast restart loop.'
Assert-Bridge (Sample-Bridge $taskState 80000) 'A still-broken relay may retry after the cooldown.'

$taskState = New-SteamBridgeHealth -NowMs 0
foreach ($taskNow in @(12000,16000,20000)) { Assert-Bridge (-not (Sample-Bridge $taskState $taskNow 0)) 'An idle game must not trigger recovery.' }
foreach ($taskNow in @(24000,28000,32000)) { Assert-Bridge (-not (Sample-Bridge $taskState $taskNow 2 1)) 'Healthy forwarded traffic must not be interrupted.' }
Sample-Bridge $taskState 36000 | Out-Null
Sample-Bridge $taskState 40000 | Out-Null
Assert-Bridge (-not (Sample-Bridge $taskState 44000 2 0 $false)) 'A failed OS query is not proof of lost routing.'
Assert-Bridge (-not (Sample-Bridge $taskState 48000)) 'Unknown data must reset the consecutive failure window.'
Assert-Bridge (-not (Sample-Bridge $taskState 52000 2 1)) 'Healthy traffic clears an accumulated failure.'
Assert-Bridge (-not (Sample-Bridge $taskState 56000)) 'A new failure requires a fresh sustained window.'

$taskState = New-SteamBridgeHealth -NowMs 50000
foreach ($taskNow in @(51000,55000,59000)) { Assert-Bridge (-not (Sample-Bridge $taskState $taskNow)) 'Give a newly started relay time to attach.' }
# Unrelated sockets and listeners cannot conceal a lost route; loopback game
# sockets cannot prove one.
$taskConnections = @(
    [pscustomobject]@{ OwningProcess=10; LocalPort=51000; RemoteAddress='203.0.113.7'; State='Established' }
    [pscustomobject]@{ OwningProcess=10; LocalPort=51001; RemoteAddress='127.0.0.1'; State='Established' }
    [pscustomobject]@{ OwningProcess=10; LocalPort=51002; RemoteAddress='::1'; State='Established' }
    [pscustomobject]@{ OwningProcess=10; LocalPort=51003; RemoteAddress='::ffff:127.0.0.1'; State='Established' }
    [pscustomobject]@{ OwningProcess=20; LocalPort=34010; RemoteAddress='0.0.0.0'; State='Listen' }
    [pscustomobject]@{ OwningProcess=20; LocalPort=52000; RemoteAddress='127.0.0.1'; State='Established' }
    [pscustomobject]@{ OwningProcess=99; LocalPort=34010; RemoteAddress='127.0.0.1'; State='Established' }
)
$taskCounts = Get-SteamBridgeConnectionCounts -Connections $taskConnections -GameProcessIds @(10) -BridgeProcessId 20
Assert-Bridge ($taskCounts.GameConnections -eq 1 -and $taskCounts.RelayConnections -eq 0) 'Count only external game sockets and owned established relay sockets.'
$taskConnections += [pscustomobject]@{ OwningProcess=20; LocalPort=34010; RemoteAddress='127.0.0.1'; State='Established' }
$taskCounts = Get-SteamBridgeConnectionCounts -Connections $taskConnections -GameProcessIds @(10) -BridgeProcessId 20
Assert-Bridge ($taskCounts.RelayConnections -eq 1) 'Recognize a restored relay.'
Write-Output 'Bridge health regression checks passed.'
