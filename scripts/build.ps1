$ErrorActionPreference = 'Stop'

# Anchor to repo root so relative paths work regardless of where the script is invoked from.
Set-Location (Join-Path $PSScriptRoot '..')

function Invoke-Native {
    $cmd = $args[0]
    $cmdArgs = $args[1..($args.Length - 1)]
    & $cmd @cmdArgs
    if ($LASTEXITCODE -ne 0) { throw "Command failed (exit $LASTEXITCODE): $($args -join ' ')" }
}

# --- prerequisite: Node.js >= 20 ---
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Node.js is not installed. Download from https://nodejs.org/ (v20 LTS or newer)." -ForegroundColor Red
    exit 1
}

$nodeMajor = [int](Invoke-Native node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) {
    Write-Host "Error: Node.js v$nodeMajor detected. v20 or newer is required. See https://nodejs.org/." -ForegroundColor Red
    exit 1
}

# --- prerequisite: pnpm ---
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "Error: pnpm is not installed. Run: corepack enable" -ForegroundColor Red
    exit 1
}

# --- dependency install (skip if already done) ---
if (Test-Path "node_modules/.pnpm") {
    Write-Host "deps already installed, skipping"
} else {
    Write-Host "Installing dependencies..."
    Invoke-Native pnpm install --frozen-lockfile
}

# --- build ---
Write-Host "Building workspace packages..."
Invoke-Native pnpm -r --filter './packages/*' build

Write-Host "Compiling Electron app..."
Invoke-Native pnpm --filter @awakon/desktop build

# --- package ---
Write-Host "Packaging Windows installer..."
Invoke-Native pnpm --filter @awakon/desktop dist:win

# --- done ---
$version = (Get-Content (Join-Path $PSScriptRoot '..\apps\desktop\package.json') | ConvertFrom-Json).version
Write-Host ""
Write-Host "Done. Installer is at: apps/desktop/release/$version/"
