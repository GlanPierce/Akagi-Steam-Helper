param(
    [switch]$SkipGameLaunch,
    # Adopt our already-running relay during a launcher update.
    [ValidateRange(0,2147483647)][int]$ResumeBridgeId = 0
)

$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskAkagiDir = Join-Path $taskRoot 'AkagiSteam'
$taskBridgeDir = Join-Path $taskRoot 'ProxyBridge'
$taskIntegrationDir = Join-Path $taskRoot 'steam-integration'
function Start-TaskGameIfNeeded {
    if (-not (Get-Process -Name Jantama_MahjongSoul -ErrorAction SilentlyContinue)) {
        Start-Process -FilePath 'steam://rungameid/1329410'
    }
}
$taskPrincipal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $taskPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $taskArguments = '-NoProfile -WindowStyle Hidden -File "' + $PSCommandPath + '"'
    if ($SkipGameLaunch) { $taskArguments += ' -SkipGameLaunch' }
    if ($ResumeBridgeId) { $taskArguments += ' -ResumeBridgeId ' + $ResumeBridgeId }
    Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList $taskArguments
    exit
}

$taskMutex = New-Object Threading.Mutex($false, 'Local\AkagiSteamLauncher')
if (-not $taskMutex.WaitOne(0)) {
    if (-not $SkipGameLaunch) {
        $taskDuplicateAkagi = Get-Process akagi -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -eq (Join-Path $taskAkagiDir 'akagi.exe') } |
            Select-Object -First 1
        $taskDuplicateBridge = Get-Process ProxyBridge_CLI -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -eq (Join-Path $taskBridgeDir 'ProxyBridge_CLI.exe') } |
            Select-Object -First 1
        if ($taskDuplicateAkagi -and $taskDuplicateBridge) {
            $taskDuplicateCapturePort = Get-NetTCPConnection -LocalPort 23410 -State Listen -ErrorAction SilentlyContinue
            $taskDuplicateRelayPort = Get-NetTCPConnection -LocalPort 34010 -State Listen -ErrorAction SilentlyContinue
            if (@($taskDuplicateCapturePort.OwningProcess) -contains $taskDuplicateAkagi.Id -and
                @($taskDuplicateRelayPort.OwningProcess) -contains $taskDuplicateBridge.Id) {
                Start-TaskGameIfNeeded
            }
        }
    }
    $taskMutex.Dispose()
    exit
}

$taskBridge = $null
$taskAkagi = $null
$taskStartedAkagi = $false
$taskReady = $false
$taskStartupError = $null
try {
    . (Join-Path $taskIntegrationDir 'Steam-BridgeHealth.ps1')
    function Start-TaskBridge {
        $taskSession = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
        $taskNewBridge = Start-Process -FilePath (Join-Path $taskBridgeDir 'ProxyBridge_CLI.exe') -WorkingDirectory $taskBridgeDir -WindowStyle Hidden -PassThru `
            -ArgumentList ('--profile "' + (Join-Path $taskIntegrationDir 'steam-majsoul.pbprofile') + '" --verbose 1') `
            -RedirectStandardOutput (Join-Path $taskIntegrationDir ('bridge-' + $taskSession + '.log')) `
            -RedirectStandardError (Join-Path $taskIntegrationDir ('bridge-' + $taskSession + '.err.log'))
        Start-Sleep -Seconds 2
        if ($taskNewBridge.HasExited) { throw 'Steam traffic forwarding failed to start. Check steam-integration\bridge logs.' }
        return $taskNewBridge
    }
    function Write-TaskBridgeHealth([string]$Message) {
        # A diagnostic write must never interrupt a working game.
        try {
            ('{0:O} {1}' -f [DateTime]::UtcNow, $Message) | Add-Content -LiteralPath (Join-Path $taskIntegrationDir 'bridge-health.log') -Encoding UTF8
        } catch {}
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $taskRoot 'temp') | Out-Null
    $env:TEMP = Join-Path $taskRoot 'temp'
    $env:TMP = $env:TEMP
    $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $taskAkagiDir 'webview-data'
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--lang=zh-CN'
    $taskAkagi = Get-Process akagi -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq (Join-Path $taskAkagiDir 'akagi.exe') } |
        Select-Object -First 1
    if (-not $taskAkagi) {
        $taskAkagi = Start-Process -FilePath (Join-Path $taskAkagiDir 'akagi.exe') -WorkingDirectory $taskAkagiDir -PassThru
        $taskStartedAkagi = $true
    }

    $taskDeadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
        if ($taskAkagi.HasExited) { throw 'Akagi exited before its capture service was ready.' }
        try {
            $taskPing = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:23410/ping' -TimeoutSec 2
            $taskPingText = if ($taskPing.Content -is [byte[]]) {
                [Text.Encoding]::UTF8.GetString($taskPing.Content)
            } else { [string]$taskPing.Content }
            $taskReady = ($taskPingText.Trim() -eq 'pong')
        } catch { $taskReady = $false }
        if (-not $taskReady) { Start-Sleep -Milliseconds 500 }
    } until ($taskReady -or [DateTime]::UtcNow -gt $taskDeadline)
    if (-not $taskReady) { throw 'Akagi capture service did not start. Check AkagiSteam\logs.' }
    $taskListener = Get-NetTCPConnection -LocalPort 23410 -State Listen -ErrorAction Stop
    if (@($taskListener.OwningProcess | Select-Object -Unique) -notcontains $taskAkagi.Id) {
        throw 'Port 23410 is owned by another application.'
    }

    $taskCertFile = Join-Path $taskAkagiDir 'ca\akagi-ca.crt'
    $taskCert = New-Object Security.Cryptography.X509Certificates.X509Certificate2($taskCertFile)
    $taskCertStore = New-Object Security.Cryptography.X509Certificates.X509Store('Root', 'CurrentUser')
    $taskCertStore.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    try {
        if (-not ($taskCertStore.Certificates | Where-Object { $_.Thumbprint -eq $taskCert.Thumbprint })) {
            $taskCertStore.Add($taskCert)
        }
    } finally { $taskCertStore.Close() }
    if (-not (Get-NetFirewallRule -Name 'AkagiSteam.ProxyBridge.TCPRelay' -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -Name 'AkagiSteam.ProxyBridge.TCPRelay' -DisplayName 'Akagi Steam local TCP relay' `
            -Program (Join-Path $taskBridgeDir 'ProxyBridge_CLI.exe') -Direction Inbound -Action Allow `
            -Protocol TCP -LocalPort 34010 -Profile Any | Out-Null
    }

    $taskExistingBridge = @(Get-Process ProxyBridge,ProxyBridge_CLI -ErrorAction SilentlyContinue)
    if ($ResumeBridgeId) {
        $taskResumeProcess = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $ResumeBridgeId) -ErrorAction Stop
        $taskExpectedProfileArgument = '--profile "' + (Join-Path $taskIntegrationDir 'steam-majsoul.pbprofile') + '"'
        $taskResumeListener = @(Get-NetTCPConnection -LocalPort 34010 -State Listen -ErrorAction Stop)
        if ($taskExistingBridge.Count -ne 1 -or $taskExistingBridge[0].Id -ne $ResumeBridgeId -or
            $taskResumeProcess.ExecutablePath -ne (Join-Path $taskBridgeDir 'ProxyBridge_CLI.exe') -or
            -not $taskResumeProcess.CommandLine.Contains($taskExpectedProfileArgument) -or
            @($taskResumeListener.OwningProcess) -notcontains $ResumeBridgeId) {
            throw 'The requested relay does not belong to this Steam assistant.'
        }
        $taskBridge = $taskExistingBridge[0]
    } else {
        if ($taskExistingBridge.Count) { throw 'Another ProxyBridge is running. Close it before starting this assistant.' }
        $taskBridge = Start-TaskBridge
    }
    Remove-Item -LiteralPath (Join-Path $taskIntegrationDir 'startup-error.txt') -ErrorAction SilentlyContinue
    if (-not $SkipGameLaunch) { Start-TaskGameIfNeeded }
    $taskHealthClock = [Diagnostics.Stopwatch]::StartNew()
    $taskHealth = New-SteamBridgeHealth -NowMs 0
    $taskNextHealthCheckMs = 0
    Write-TaskBridgeHealth ('monitor-start relay=' + $taskBridge.Id)
    while (-not $taskAkagi.WaitForExit(1000)) {
        if ($taskBridge.HasExited) { throw 'Steam traffic forwarding stopped. Restart this assistant.' }
        if ($taskHealthClock.ElapsedMilliseconds -lt $taskNextHealthCheckMs) { continue }
        $taskQuerySucceeded = $false
        $taskCounts = @{ GameConnections = 0; RelayConnections = 0 }
        try {
            $taskGameProcesses = @(Get-Process Jantama_MahjongSoul -ErrorAction SilentlyContinue)
            if ($taskGameProcesses.Count) {
                $taskConnections = @(Get-NetTCPConnection -State Established -ErrorAction Stop)
                $taskCounts = Get-SteamBridgeConnectionCounts -Connections $taskConnections -GameProcessIds @($taskGameProcesses.Id) -BridgeProcessId $taskBridge.Id
            }
            $taskQuerySucceeded = $true
        } catch {}
        $taskNowMs = $taskHealthClock.ElapsedMilliseconds
        $taskNextHealthCheckMs = $taskNowMs + 3000
        if (Update-SteamBridgeHealth -State $taskHealth -NowMs $taskNowMs -QuerySucceeded $taskQuerySucceeded @taskCounts) {
            Write-TaskBridgeHealth ('routing-lost relay={0} game-connections={1}; restarting relay' -f $taskBridge.Id, $taskCounts.GameConnections)
            Stop-Process -Id $taskBridge.Id -ErrorAction Stop
            if (-not $taskBridge.WaitForExit(5000)) { throw 'The previous Steam relay did not stop.' }
            $taskBridge = Start-TaskBridge
            Write-TaskBridgeHealth ('relay-restarted relay=' + $taskBridge.Id)
        }
    }
} catch {
    $taskStartupError = $_.Exception.Message
    $_ | Out-String | Set-Content -LiteralPath (Join-Path $taskIntegrationDir 'startup-error.txt') -Encoding UTF8
    if ($taskStartedAkagi -and -not $taskReady -and $taskAkagi -and -not $taskAkagi.HasExited) {
        Stop-Process -Id $taskAkagi.Id -ErrorAction SilentlyContinue
    }
} finally {
    if ($taskBridge -and -not $taskBridge.HasExited) { Stop-Process -Id $taskBridge.Id -ErrorAction SilentlyContinue }
    $taskMutex.ReleaseMutex()
    $taskMutex.Dispose()
}

if ($taskStartupError) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show('Steam 雀魂助手未能启动，请查看 D:\MahjongAI\steam-integration\startup-error.txt。', 'Steam 雀魂助手') | Out-Null
    exit 1
}
