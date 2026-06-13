#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# --- platform guard ---
if [ "$(uname)" != "Linux" ]; then
  echo "Error: This script is for Linux only." >&2
  exit 1
fi

if ! command -v dpkg &>/dev/null; then
  echo "Error: dpkg not found. This script targets Debian/Ubuntu." >&2
  exit 1
fi

# --- flags ---
SKIP_BUILD=false
for arg in "$@"; do
  if [ "$arg" = "--skip-build" ]; then
    SKIP_BUILD=true
  fi
done

# --- build ---
if [ "$SKIP_BUILD" = false ]; then
  bash "$SCRIPT_DIR/build.sh"
else
  echo "Skipping build (--skip-build)."
fi

# --- find the deb ---
VERSION=$(node --input-type=module -e "import {readFileSync} from 'fs'; process.stdout.write(JSON.parse(readFileSync('apps/desktop/package.json','utf8')).version)")
DEB=$(find "apps/desktop/release/$VERSION" -maxdepth 1 -name "*.deb" 2>/dev/null | head -1)

if [ -z "$DEB" ]; then
  echo "Error: No .deb found in apps/desktop/release/$VERSION/" >&2
  echo "Run without --skip-build to build first." >&2
  exit 1
fi

# --- install ---
echo "Installing $DEB ..."
sudo dpkg -i "$DEB"

echo ""
echo "Done. Run: awakon"
