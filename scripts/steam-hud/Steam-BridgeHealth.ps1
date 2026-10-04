# A listening relay is not sufficient: a lost redirector session can leave
# direct game sockets while both forwarding processes remain alive.
function New-SteamBridgeHealth {
    param([long]$NowMs)
    @{
        ReadyAfterMs = $NowMs + 10000
        LastRecoveryMs = $NowMs - 60000
        FirstFailureMs = $null
        FailureSamples = 0
    }
}

function Update-SteamBridgeHealth {
    param(
        [hashtable]$State,
        [long]$NowMs,
        [int]$GameConnections,
        [int]$RelayConnections,
        [bool]$QuerySucceeded
    )
    if (-not $QuerySucceeded -or $GameConnections -le 0 -or $RelayConnections -gt 0 -or $NowMs -lt $State.ReadyAfterMs) {
        $State.FirstFailureMs = $null
        $State.FailureSamples = 0
        return $false
    }
    if ($null -eq $State.FirstFailureMs) { $State.FirstFailureMs = $NowMs }
    $State.FailureSamples++
    if ($State.FailureSamples -lt 3 -or ($NowMs - $State.FirstFailureMs) -lt 8000 -or ($NowMs - $State.LastRecoveryMs) -lt 60000) {
        return $false
    }
    $State.LastRecoveryMs = $NowMs
    $State.ReadyAfterMs = $NowMs + 10000
    $State.FirstFailureMs = $null
    $State.FailureSamples = 0
    return $true
}

function Get-SteamBridgeConnectionCounts {
    param([object[]]$Connections, [int[]]$GameProcessIds, [int]$BridgeProcessId)
    $taskGameCount = 0
    $taskRelayCount = 0
    foreach ($taskConnection in $Connections) {
        if ([string]$taskConnection.State -ne 'Established') { continue }
        if ($taskConnection.OwningProcess -eq $BridgeProcessId -and $taskConnection.LocalPort -eq 34010) {
            $taskRelayCount++
        }
        if ($GameProcessIds -contains $taskConnection.OwningProcess) {
            $taskAddress = $null
            # Unknown addresses cannot prove that traffic bypasses us.
            if ([Net.IPAddress]::TryParse([string]$taskConnection.RemoteAddress, [ref]$taskAddress) -and
                -not [Net.IPAddress]::IsLoopback($taskAddress)) {
                $taskGameCount++
            }
        }
    }
    @{ GameConnections = $taskGameCount; RelayConnections = $taskRelayCount }
}
