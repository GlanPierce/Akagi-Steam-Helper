$ErrorActionPreference = 'Stop'
$taskScript = Join-Path $PSScriptRoot 'Run-AkagiSteam.ps1'
$taskTokens = $null
$taskParseErrors = $null
$taskAst = [Management.Automation.Language.Parser]::ParseFile($taskScript, [ref]$taskTokens, [ref]$taskParseErrors)
if ($taskParseErrors.Count) { throw ($taskParseErrors | Out-String) }
$taskFunction = $taskAst.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Start-TaskGameIfNeeded' }, $true)
if (-not $taskFunction) { throw 'Conditional game launch is missing.' }
# Execute the real helper in isolation; no capture, certificate, or relay setup.
. ([scriptblock]::Create($taskFunction.Extent.Text))
$script:taskGamePresent = $true
$script:taskLaunchCount = 0
function Get-Process {
    param($Name, $ErrorAction)
    if ($Name -ne 'Jantama_MahjongSoul') { throw 'Wrong game process queried.' }
    if ($script:taskGamePresent) { [pscustomobject]@{ Id = 42; ProcessName = $Name } }
}
function Start-Process {
    param($FilePath)
    if ($FilePath -ne 'steam://rungameid/1329410') { throw 'Wrong Steam game launched.' }
    $script:taskLaunchCount++
    $script:taskGamePresent = $true
}
Start-TaskGameIfNeeded
if ($script:taskLaunchCount -ne 0) { throw 'Launched Steam while Mahjong Soul was already running.' }
$script:taskGamePresent = $false
Start-TaskGameIfNeeded
if ($script:taskLaunchCount -ne 1) { throw 'Did not start Mahjong Soul when it was absent.' }
Start-TaskGameIfNeeded
if ($script:taskLaunchCount -ne 1) { throw 'Repeated startup launched the running game again.' }
'Game launch checks passed (running, absent, repeated startup).'
