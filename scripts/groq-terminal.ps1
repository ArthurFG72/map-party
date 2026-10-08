Write-Host "Groq Scout pronto. Digite uma pergunta curta, ou 'exit' para sair."

while ($true) {
  $prompt = Read-Host "groq"
  if ($prompt -match '^(exit|quit|sair)$') {
    break
  }

  if (-not $prompt.Trim()) {
    continue
  }

  try {
    & "$PSScriptRoot\groq-assist.ps1" $prompt -MaxTokens 256
  } catch {
    Write-Host "Erro Groq: $($_.Exception.Message)"
  }
}
