param(
    [ValidateSet('Check', 'Install', 'Rollback')][string]$Mode = 'Check',
    [string]$InstallDir = 'D:\MahjongAI\AkagiSteam',
    [string]$BackupDir
)
$ErrorActionPreference = 'Stop'
$taskTarget = [IO.Path]::GetFullPath($InstallDir)
$taskExe = Join-Path $taskTarget 'akagi.exe'
$taskConfig = Join-Path $taskTarget 'configs\config.toml'
$taskSource = Join-Path $PSScriptRoot 'akagi.exe'
$taskPython = 'D:\MahjongAI\Python313\tools\python.exe'
if (-not (Test-Path -LiteralPath $taskExe) -or -not (Test-Path -LiteralPath $taskConfig)) { throw 'Akagi installation or configuration is missing.' }
if ($Mode -ne 'Rollback') {
    $taskManifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -Raw | ConvertFrom-Json
    if ((Get-FileHash -LiteralPath $taskSource -Algorithm SHA256).Hash -ne $taskManifest.sha256) { throw 'Staged executable hash mismatch.' }
}
$taskActive = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'Jantama_MahjongSoul.exe' -or
    ($_.Name -eq 'akagi.exe' -and (-not $_.ExecutablePath -or $_.ExecutablePath -eq $taskExe))
})
if ($Mode -eq 'Check') {
    [pscustomobject]@{ StagedHashVerified = $true; ActiveGameOrAkagi = ($taskActive.Count -gt 0); ReadyToInstall = ($taskActive.Count -eq 0); InstalledHash = (Get-FileHash -LiteralPath $taskExe -Algorithm SHA256).Hash }
    return
}
if ($taskActive.Count -gt 0) { throw 'Close Mahjong Soul and exit Akagi before changing this installation. No processes have been stopped.' }
if (-not (Test-Path -LiteralPath $taskPython)) { throw 'The existing Python runtime is missing.' }
$taskRestore = $null
if ($Mode -eq 'Rollback') {
    if (-not $BackupDir) { throw 'Rollback requires the exact backup directory printed by Install.' }
    $taskRestore = [IO.Path]::GetFullPath($BackupDir)
    if (-not (Test-Path -LiteralPath (Join-Path $taskRestore 'akagi.exe')) -or -not (Test-Path -LiteralPath (Join-Path $taskRestore 'config.toml'))) { throw 'Incomplete rollback backup.' }
    $taskBackupManifest = Get-Content -LiteralPath (Join-Path $taskRestore 'backup.json') -Raw | ConvertFrom-Json
    if ($taskBackupManifest.install_dir -ne $taskTarget -or (Get-FileHash -LiteralPath (Join-Path $taskRestore 'akagi.exe')).Hash -ne $taskBackupManifest.sha256) { throw 'Rollback backup identity or hash mismatch.' }
}
$taskBackups = Join-Path $taskTarget 'hud-backups'
$taskBackup = Join-Path $taskBackups ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $taskBackup | Out-Null
Copy-Item -LiteralPath $taskExe -Destination (Join-Path $taskBackup 'akagi.exe')
Copy-Item -LiteralPath $taskConfig -Destination (Join-Path $taskBackup 'config.toml')
@{ install_dir = $taskTarget; sha256 = (Get-FileHash -LiteralPath $taskExe).Hash } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskBackup 'backup.json') -Encoding UTF8
$taskCandidate = Join-Path $taskBackup 'candidate.toml'
if ($Mode -eq 'Install') {
    & $taskPython (Join-Path $PSScriptRoot 'config_patch.py') enable $taskConfig $taskCandidate
} else {
    & $taskPython (Join-Path $PSScriptRoot 'config_patch.py') restore $taskConfig $taskCandidate (Join-Path $taskRestore 'config.toml')
    $taskSource = Join-Path $taskRestore 'akagi.exe'
}
if ($LASTEXITCODE -ne 0) { throw 'Configuration candidate failed validation. Installation was not changed.' }
try {
    Copy-Item -LiteralPath $taskSource -Destination $taskExe -Force
    Copy-Item -LiteralPath $taskCandidate -Destination $taskConfig -Force
    if ((Get-FileHash -LiteralPath $taskExe).Hash -ne (Get-FileHash -LiteralPath $taskSource).Hash) { throw 'Installed executable did not match the source.' }
} catch {
    Copy-Item -LiteralPath (Join-Path $taskBackup 'akagi.exe') -Destination $taskExe -Force
    Copy-Item -LiteralPath (Join-Path $taskBackup 'config.toml') -Destination $taskConfig -Force
    throw
}
Write-Output "$Mode complete. Backup: $taskBackup"
Write-Output 'Start the existing desktop shortcut when ready. This script does not start or stop the game.'
