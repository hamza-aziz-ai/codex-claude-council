# Codex–Claude Council installer for Windows PowerShell.
#   irm https://raw.githubusercontent.com/hamza-aziz-ai/codex-claude-council/main/install.ps1 | iex
# With options:
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/hamza-aziz-ai/codex-claude-council/main/install.ps1))) --claude-desktop
$ErrorActionPreference = 'Stop'
$repo = 'hamza-aziz-ai/codex-claude-council'
$missing = $false

function Test-Cli([string]$name, [string[]]$fallbacks) {
  if (Get-Command $name -ErrorAction SilentlyContinue) { return $true }
  foreach ($path in $fallbacks) { if (Test-Path $path) { return $true } }
  return $false
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '[x]  Node.js 20+ is required: https://nodejs.org' -ForegroundColor Red; $missing = $true
} elseif ([int](& node -p "process.versions.node.split('.')[0]") -lt 20) {
  Write-Host "[x]  Node.js $(& node --version) found; version 20 or newer is required: https://nodejs.org" -ForegroundColor Red; $missing = $true
}
if (-not (Test-Cli 'claude' @("$env:USERPROFILE\.local\bin\claude.exe"))) {
  Write-Host '[x]  Claude Code CLI not found. Install:  irm https://claude.ai/install.ps1 | iex   then: claude auth login' -ForegroundColor Red; $missing = $true
}
if (-not (Test-Cli 'codex' @("$env:LOCALAPPDATA\Programs\OpenAI\Codex\bin\codex.exe"))) {
  Write-Host '[x]  Codex CLI not found. Install:  npm install -g @openai/codex   then: codex login' -ForegroundColor Red; $missing = $true
}
if ($missing) {
  Write-Host ''
  Write-Host 'codex-claude-council needs Node.js 20+, the Claude Code CLI and the Codex CLI. Install what is missing and run this again.'
  return
}

$extra = @($args)
if ($env:COUNCIL_INSTALL_ARGS) { $extra += $env:COUNCIL_INSTALL_ARGS -split '\s+' }
& npx --yes "github:$repo" install @extra
