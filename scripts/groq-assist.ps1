param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Prompt,

  [string]$Model = "groq/compound-mini",
  [int]$MaxTokens = 256
)

$envPath = Join-Path $PSScriptRoot "..\.env"
if (-not (Test-Path -LiteralPath $envPath)) {
  throw ".env not found at $envPath"
}

$apiKeyLine = Get-Content -LiteralPath $envPath |
  Where-Object { $_ -match '^\s*GROQ_API_KEY\s*=' } |
  Select-Object -Last 1

if (-not $apiKeyLine) {
  throw "GROQ_API_KEY is missing from .env"
}

$apiKey = ($apiKeyLine -replace '^\s*GROQ_API_KEY\s*=\s*', '').Trim().Trim('"').Trim("'")
if (-not $apiKey) {
  throw "GROQ_API_KEY is empty in .env"
}

$body = @{
  model = $Model
  messages = @(
    @{
      role = "system"
      content = "Be concise. Answer only what was asked."
    },
    @{
      role = "user"
      content = $Prompt
    }
  )
  temperature = 0.2
  max_tokens = $MaxTokens
} | ConvertTo-Json -Depth 5

$response = Invoke-RestMethod `
  -Uri "https://api.groq.com/openai/v1/chat/completions" `
  -Method Post `
  -Headers @{ Authorization = "Bearer $apiKey"; "Content-Type" = "application/json" } `
  -Body $body `
  -TimeoutSec 60

$response.choices[0].message.content
