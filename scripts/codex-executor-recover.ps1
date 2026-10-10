[CmdletBinding(SupportsShouldProcess)]
param(
  [switch] $Apply
)

$ErrorActionPreference = 'Stop'

if ($env:CODEX_SESSION_ID) {
  throw 'Execute este script em um PowerShell externo, com todas as sessões Codex fechadas; não execute dentro de uma sessão Codex.'
}

$runtime = 'C:\Users\Arthur\AppData\Local\OpenAI\Codex\runtimes\cua_node\b474a88d5d105afa\bin\node_repl.exe'
$sandboxBin = 'C:\Users\Arthur\.codex\.sandbox-bin'
$processes = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
  $_.ProcessName -match '^codex($|-)|^codex-code-mode-host$|^codex-command-runner'
})

Write-Output '=== Diagnóstico do executor Codex ==='
Write-Output ("Processos Codex encontrados: {0}" -f $processes.Count)
$processes | Select-Object ProcessName, Id, StartTime, Path | Format-Table -AutoSize

foreach ($path in @($runtime, $sandboxBin)) {
  if (-not (Test-Path -LiteralPath $path)) {
    Write-Warning "Caminho ausente: $path"
    continue
  }
  $acl = Get-Acl -LiteralPath $path
  Write-Output ("ACL {0}: owner={1}; regras={2}" -f $path, $acl.Owner, @($acl.Access).Count)
}

if (-not $Apply) {
  Write-Output 'Modo diagnóstico. Para encerrar processos órfãos, feche todas as sessões e execute novamente com -Apply.'
  exit 0
}

if ($processes.Count -gt 0) {
  foreach ($process in $processes) {
    if ($PSCmdlet.ShouldProcess("$($process.ProcessName) [$($process.Id)]", 'encerrar processo Codex órfão')) {
      Stop-Process -Id $process.Id -Force -ErrorAction Stop
    }
  }
  Start-Sleep -Seconds 2
}

$remaining = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
  $_.ProcessName -match '^codex($|-)|^codex-code-mode-host$|^codex-command-runner'
})
if ($remaining.Count -gt 0) {
  Write-Warning ("Ainda existem {0} processos Codex. Reinicie o Windows antes de abrir o Codex novamente." -f $remaining.Count)
  exit 2
}

Write-Output 'Processos Codex encerrados. Abra o Codex novamente somente após o teste de uma sessão vazia.'
Write-Output 'Se o erro continuar, reinicie o Windows; não altere ACL de C:\ nem apague o diretório MAPS.'
