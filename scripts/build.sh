#!/usr/bin/env bash
set -euo pipefail

# Anchor to repo root so relative paths work regardless of where the script is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# --- prerequisite: Node.js >= 20 ---
if ! command -v node &>/dev/null; then
  echo "Error: Node.js is not installed. Download from https://nodejs.org/ (v20 LTS or newer)." >&2
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Error: Node.js v$NODE_MAJOR detected. v20 or newer is required. See https://nodejs.org/." >&2
  exit 1
fi

# --- prerequisite: pnpm ---
if ! command -v pnpm &>/dev/null; then
  echo "Error: pnpm is not installed. Run: corepack enable" >&2
  exit 1
fi

# --- dependency install ---
echo "Installing dependencies..."
pnpm install --frozen-lockfile

# --- build ---
echo "Building workspace packages..."
pnpm -r --filter './packages/*' build

echo "Compiling Electron app..."
pnpm --filter @awakon/desktop build

# --- package ---
PLATFORM=$(uname)
if [ "$PLATFORM" = "Darwin" ]; then
  echo "Packaging macOS installer..."
  pnpm --filter @awakon/desktop dist:mac
else
  echo "Packaging Linux installer..."
  pnpm --filter @awakon/desktop dist:linux
fi

# --- done ---
VERSION=$(node --input-type=module -e "import {readFileSync} from 'fs'; process.stdout.write(JSON.parse(readFileSync('apps/desktop/package.json','utf8')).version)")
echo ""
echo "Done. Installer is at: apps/desktop/release/$VERSION/"
