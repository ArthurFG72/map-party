[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateNotNullOrEmpty()]
  [string] $Command,

  [string] $WorkingDirectory = (Get-Location).Path,
  [ValidateRange(1, 5)] [int] $MaxAttempts = 3,
  [ValidateRange(1, 30)] [int] $RetryDelaySeconds = 2,
  [ValidateRange(5, 900)] [int] $TimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
$resolvedDirectory = (Resolve-Path -LiteralPath $WorkingDirectory -ErrorAction Stop).Path

function Invoke-BoundedPowerShell([string] $Text) {
  $job = Start-Job -ScriptBlock {
    param($InnerCommand, $InnerDirectory)
    Set-Location -LiteralPath $InnerDirectory
    & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $InnerCommand
    [int] $LASTEXITCODE
  } -ArgumentList $Text, $resolvedDirectory
  try {
    if (-not (Wait-Job -Job $job -Timeout $TimeoutSeconds)) {
      Stop-Job -Job $job -ErrorAction SilentlyContinue
      throw "Command exceeded timeout of $TimeoutSeconds seconds."
    }
    $output = Receive-Job -Job $job -ErrorAction Stop
    $exitCode = [int]($output | Select-Object -Last 1)
    $output | Select-Object -SkipLast 1 | ForEach-Object { Write-Output $_ }
    return $exitCode
  } finally {
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
  }
}

for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
  try {
    $probe = Invoke-BoundedPowerShell 'Write-Output executor-ok'
    if ($probe -ne 0) { throw "Executor probe returned exit code $probe." }
    $exitCode = Invoke-BoundedPowerShell $Command
    if ($exitCode -eq 0) { exit 0 }
    throw "Command returned exit code $exitCode."
  } catch {
    $message = $_.Exception.Message
    if ($attempt -eq $MaxAttempts) {
      Write-Error ("Executor guard stopped after {0} attempts: {1}" -f $attempt, $message)
      exit 1
    }
    Write-Warning ("Executor attempt {0}/{1} failed: {2}. Retrying..." -f $attempt, $MaxAttempts, $message)
    Start-Sleep -Seconds $RetryDelaySeconds
  }
}
