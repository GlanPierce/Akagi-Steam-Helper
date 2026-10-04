param(
    [Parameter(Mandatory=$true)][string]$IconSource,
    [string]$InstallDir = 'D:\MahjongAI\AkagiSteam',
    [string]$LauncherPath = 'D:\MahjongAI\Run-AkagiSteam.cmd',
    [string]$DesktopDir = [Environment]::GetFolderPath('Desktop'),
    [string]$BackupDir
)

$ErrorActionPreference = 'Stop'
$taskHash = (Get-FileHash -LiteralPath $IconSource -Algorithm SHA256).Hash
$taskIconsDir = Join-Path $InstallDir 'icons'
New-Item -ItemType Directory -Path $taskIconsDir -Force | Out-Null
# A content-specific path makes Explorer discard a cached Akagi icon without
# deleting the global icon cache or restarting the user's Explorer session.
$taskIconPath = Join-Path $taskIconsDir ('maka-' + $taskHash.Substring(0,12).ToLowerInvariant() + '.ico')
Copy-Item -LiteralPath $IconSource -Destination $taskIconPath -Force
$taskShell = New-Object -ComObject WScript.Shell
$taskUpdated = @()
foreach ($taskFile in Get-ChildItem -LiteralPath $DesktopDir -Filter '*.lnk' -File) {
    $taskShortcut = $taskShell.CreateShortcut($taskFile.FullName)
    if ($taskShortcut.TargetPath -ine $LauncherPath) { continue }
    if ($BackupDir) {
        New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
        Copy-Item -LiteralPath $taskFile.FullName -Destination (Join-Path $BackupDir $taskFile.Name)
    }
    $taskShortcut.IconLocation = $taskIconPath + ',0'
    $taskShortcut.Description = 'MAKA INGAME - Steam Mahjong Soul'
    $taskShortcut.Save()
    $taskCheck = $taskShell.CreateShortcut($taskFile.FullName)
    if ($taskCheck.IconLocation -ne ($taskIconPath + ',0') -or $taskCheck.TargetPath -ine $LauncherPath) {
        throw 'Desktop shortcut verification failed.'
    }
    $taskUpdated += $taskFile.FullName
}
if (-not $taskUpdated.Count) { throw 'No desktop shortcut targets this Steam launcher.' }
@{ icon_path=$taskIconPath; icon_sha256=$taskHash; shortcuts=$taskUpdated } | ConvertTo-Json
