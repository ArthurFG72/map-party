param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Prompt,

  [string]$Model = "fable",
  [decimal]$MaxBudgetUsd = 0.03
)

$envPath = Join-Path $PSScriptRoot "..\.env"
if (-not (Test-Path -LiteralPath $envPath)) {
  throw ".env not found at $envPath"
}

$apiKeyLine = Get-Content -LiteralPath $envPath |
  Where-Object { $_ -match '^\s*ANTHROPIC_API_KEY\s*=' } |
  Select-Object -Last 1

if (-not $apiKeyLine) {
  throw "ANTHROPIC_API_KEY is missing from .env"
}

$apiKey = ($apiKeyLine -replace '^\s*ANTHROPIC_API_KEY\s*=\s*', '').Trim().Trim('"').Trim("'")
if (-not $apiKey) {
  throw "ANTHROPIC_API_KEY is empty in .env"
}

$env:ANTHROPIC_API_KEY = $apiKey
Remove-Item Env:\ANTHROPIC_BASE_URL -ErrorAction SilentlyContinue

claude -p --bare --restricted --model $Model --max-budget-usd $MaxBudgetUsd --permission-prompts none $Prompt
