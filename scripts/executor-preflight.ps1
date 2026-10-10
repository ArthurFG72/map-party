[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$CleanStaleCua
)

$ErrorActionPreference = 'Stop'

$processes = foreach ($process in Get-Process -Name node,node_repl -ErrorAction SilentlyContinue) {
    try {
        $path = $process.Path
    } catch {
        $path = $null
    }

    if ($path -and $path -match '[\\/]runtimes[\\/]cua_node[\\/]') {
        [pscustomobject]@{
            ProcessId = $process.Id
            Name = "$($process.Name).exe"
            ExecutablePath = $path
        }
    }
}

if (-not $processes) {
    Write-Output 'executor-preflight: no CUA runtime processes found'
    exit 0
}

Write-Output ('executor-preflight: found {0} CUA runtime process(es)' -f $processes.Count)
$processes | Select-Object ProcessId, Name, ExecutablePath | Format-Table -AutoSize

if (-not $CleanStaleCua) {
    Write-Output 'executor-preflight: no cleanup performed; close unused CUA sessions or rerun with -CleanStaleCua'
    exit 2
}

foreach ($process in $processes) {
    if ($PSCmdlet.ShouldProcess("$($process.Name) [$($process.ProcessId)]", 'Stop stale CUA runtime process')) {
        Stop-Process -Id $process.ProcessId -Force
    }
}

Write-Output 'executor-preflight: CUA runtime processes stopped; rerun Write-Output executor-ok'
