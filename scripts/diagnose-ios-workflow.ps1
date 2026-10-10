param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+$')]
    [string] $RunId
)

$ErrorActionPreference = 'Stop'
$repository = 'ArthurFG72/map-party'
$credentialInput = "protocol=https`nhost=github.com`npath=$repository.git`n`n"
$credentialLines = $credentialInput | git credential fill 2>$null
$credential = @{}
foreach ($line in $credentialLines) {
    if ($line -match '^([^=]+)=(.*)$') { $credential[$matches[1]] = $matches[2] }
}
if (-not $credential.ContainsKey('password')) {
    throw 'Git Credential Manager has no GitHub credential for this repository.'
}

$headers = @{
    Authorization = "Bearer $($credential['password'])"
    Accept = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
}
$base = "https://api.github.com/repos/$repository/actions/runs/$RunId"
$run = Invoke-RestMethod -Uri $base -Headers $headers
$jobs = Invoke-RestMethod -Uri "$base/jobs?per_page=100" -Headers $headers
$logDirectory = Join-Path ([IO.Path]::GetTempPath()) "maps-ios-run-$RunId"
if (Test-Path -LiteralPath $logDirectory) { Remove-Item -LiteralPath $logDirectory -Recurse -Force }
New-Item -ItemType Directory -Path $logDirectory | Out-Null
$logArchive = Join-Path $logDirectory 'logs.zip'
try {
    Invoke-WebRequest -Uri "$base/logs" -Headers $headers -OutFile $logArchive
    Expand-Archive -LiteralPath $logArchive -DestinationPath $logDirectory -Force
} catch {
    Write-Output "Workflow logs unavailable: $($_.Exception.Message)"
}

Write-Output "Workflow: $($run.name)"
Write-Output "Run: $($run.html_url)"
Write-Output "Commit: $($run.head_sha)"
Write-Output "Status: $($run.status) / $($run.conclusion)"

foreach ($job in $jobs.jobs) {
    Write-Output "`nJob: $($job.name) [$($job.conclusion)]"
    foreach ($step in $job.steps) {
        Write-Output "  $($step.conclusion): $($step.name)"
    }
    $annotations = Invoke-RestMethod -Uri $job.check_run_url.Replace('/check-runs/', '/check-runs/') -Headers $headers
    $annotationUri = $annotations.output.annotations_url
    if ($annotationUri) {
        $details = Invoke-RestMethod -Uri $annotationUri -Headers $headers
        foreach ($detail in $details) {
            if ($detail.annotation_level -eq 'failure' -or $detail.annotation_level -eq 'warning') {
                Write-Output "  [$($detail.annotation_level)] $($detail.message)"
            }
        }
    }
    foreach ($step in ($job.steps | Where-Object { $_.conclusion -eq 'failure' })) {
        $stepLogs = Get-ChildItem -LiteralPath $logDirectory -Recurse -File -Filter '*.txt' |
            Where-Object { $_.BaseName -match [regex]::Escape($step.name) }
        foreach ($log in $stepLogs) {
            $matches = Select-String -LiteralPath $log.FullName -Pattern '##\[error\]|\berror:|\bError:|\bfailed\b|NoMethodError|undefined method|fatal error|not found' |
                Select-Object -Last 30
            if ($matches) {
                Write-Output "  Failure details from $($step.name):"
                $matches | ForEach-Object { Write-Output "    $($_.Line.Trim())" }
            } else {
                Write-Output "  Tail of failed step $($step.name):"
                Get-Content -LiteralPath $log.FullName -Tail 30 | ForEach-Object { Write-Output "    $($_.Trim())" }
            }
        }
    }
}

if ($jobs.jobs.Count -eq 0 -or -not ($jobs.jobs | Where-Object { $_.runner_id -ne 0 })) {
    Write-Output "`nRoot cause: GitHub did not start a runner; no project build step ran. Check the failure annotation above and the repository owner's Actions/Billing limits."
}

$artifacts = Invoke-RestMethod -Uri "$base/artifacts?per_page=100" -Headers $headers
if ($artifacts.artifacts.Count -eq 0) {
    Write-Output 'Artifacts: none uploaded; inspect runner-startup annotations or rerun after resolving that blocker.'
} else {
    Write-Output 'Artifacts:'
    $artifacts.artifacts | ForEach-Object { Write-Output "  $($_.name) ($($_.size_in_bytes) bytes)" }
}
if (Test-Path -LiteralPath $logDirectory) {
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $resolvedLogs = [IO.Path]::GetFullPath($logDirectory)
    if ($resolvedLogs.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -and $resolvedLogs -match "maps-ios-run-$RunId$") {
        Remove-Item -LiteralPath $resolvedLogs -Recurse -Force
    }
}
