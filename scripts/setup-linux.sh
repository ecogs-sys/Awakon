#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# --- platform guard ---
if [ "$(uname)" != "Linux" ]; then
  echo "This script is for Linux only. On macOS, install dependencies manually:" >&2
  echo "  brew install node && corepack enable" >&2
  exit 1
fi

if ! command -v apt-get &>/dev/null; then
  echo "Warning: apt-get not found. This script targets Debian/Ubuntu." >&2
  echo "Install the following manually: build-essential, python3, Node.js >= 20, pnpm" >&2
  exit 1
fi

echo "==> Updating package index..."
sudo apt-get update -qq

# --- build tools (required by node-pty native addon) ---
echo "==> Installing build-essential and python3..."
sudo apt-get install -y build-essential python3

# --- Node.js >= 20 ---
if command -v node &>/dev/null; then
  NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
  if [ "$NODE_MAJOR" -ge 20 ]; then
    echo "==> Node.js v$(node -v) already installed. OK."
  else
    echo "Error: Node.js v$NODE_MAJOR is too old (need >= 20)." >&2
    echo "Upgrade via nvm: nvm install 20 && nvm use 20" >&2
    exit 1
  fi
else
  echo "==> Node.js not found. Installing via NodeSource (v20 LTS)..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# --- pnpm (via corepack, bundled with Node.js >= 16) ---
if command -v pnpm &>/dev/null; then
  echo "==> pnpm $(pnpm -v) already installed. OK."
else
  echo "==> Enabling pnpm via corepack..."
  sudo corepack enable
  corepack prepare pnpm@latest --activate
fi

echo ""
echo "All prerequisites installed. You can now run: ./scripts/build.sh"
