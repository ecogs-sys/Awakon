# Native Build Scripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `scripts/build.sh` (Linux/macOS) and `scripts/build.ps1` (Windows) so contributors can go from a fresh clone to a packaged installer with a single command.

**Architecture:** Two native scripts at `scripts/` — one Bash, one PowerShell — each running the same logical sequence: prerequisite checks → conditional `pnpm install` (skipped when `node_modules/.pnpm` exists) → workspace compile → electron-vite compile → platform-specific `dist:*`. The Bash script auto-detects macOS vs Linux via `uname`.

**Tech Stack:** Bash (Linux/macOS), PowerShell 5+/7+ (Windows), pnpm, electron-vite, electron-builder

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `scripts/build.sh` | Create | Full build + package for Linux and macOS |
| `scripts/build.ps1` | Create | Full build + package for Windows |
| `README.md` | Modify | Add one-command build section above the existing project scripts table |

---

### Task 1: Create `scripts/build.sh`

**Files:**
- Create: `scripts/build.sh`

- [ ] **Step 1: Create the script**

```bash
#!/usr/bin/env bash
set -euo pipefail

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

# --- dependency install (skip if already done) ---
if [ -d "node_modules/.pnpm" ]; then
  echo "deps already installed, skipping"
else
  echo "Installing dependencies..."
  pnpm install --frozen-lockfile
fi

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
VERSION=$(node -p "JSON.parse(require('fs').readFileSync('apps/desktop/package.json','utf8')).version")
echo ""
echo "Done. Installer is at: apps/desktop/release/$VERSION/"
```

Save this to `scripts/build.sh`.

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/build.sh
```

- [ ] **Step 3: Verify the skip-deps message (no full build needed)**

With `node_modules/.pnpm` already present (normal after `pnpm install`), run just the top portion to confirm the skip path works:

```bash
bash -c '
  if [ -d "node_modules/.pnpm" ]; then
    echo "deps already installed, skipping"
  else
    echo "would install"
  fi
'
```

Expected output: `deps already installed, skipping`

- [ ] **Step 4: Commit**

```bash
git add scripts/build.sh
git commit -m "feat(scripts): add build.sh for Linux and macOS"
```

---

### Task 2: Create `scripts/build.ps1`

**Files:**
- Create: `scripts/build.ps1`

- [ ] **Step 1: Create the script**

```powershell
$ErrorActionPreference = 'Stop'

# --- prerequisite: Node.js >= 20 ---
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js is not installed. Download from https://nodejs.org/ (v20 LTS or newer)."
    exit 1
}

$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) {
    Write-Error "Node.js v$nodeMajor detected. v20 or newer is required. See https://nodejs.org/."
    exit 1
}

# --- prerequisite: pnpm ---
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Error "pnpm is not installed. Run: corepack enable"
    exit 1
}

# --- dependency install (skip if already done) ---
if (Test-Path "node_modules/.pnpm") {
    Write-Host "deps already installed, skipping"
} else {
    Write-Host "Installing dependencies..."
    pnpm install --frozen-lockfile
}

# --- build ---
Write-Host "Building workspace packages..."
pnpm -r --filter './packages/*' build

Write-Host "Compiling Electron app..."
pnpm --filter @awakon/desktop build

# --- package ---
Write-Host "Packaging Windows installer..."
pnpm --filter @awakon/desktop dist:win

# --- done ---
$version = node -p "JSON.parse(require('fs').readFileSync('apps/desktop/package.json','utf8')).version"
Write-Host ""
Write-Host "Done. Installer is at: apps/desktop/release/$version/"
```

Save this to `scripts/build.ps1`.

- [ ] **Step 2: Verify the skip-deps message**

```powershell
if (Test-Path "node_modules/.pnpm") { "deps already installed, skipping" } else { "would install" }
```

Expected output: `deps already installed, skipping`

- [ ] **Step 3: Commit**

```bash
git add scripts/build.ps1
git commit -m "feat(scripts): add build.ps1 for Windows"
```

---

### Task 3: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a one-command build section**

In `README.md`, find the `### Project scripts` heading. Insert the following block **immediately before** that heading:

```markdown
### Build an installer (one command)

Clone the repo, then run the script for your OS from the repo root. It installs
dependencies (or skips them if already present), compiles the app, and produces a
platform installer in `apps/desktop/release/<version>/`.

**Windows (PowerShell):**
```powershell
.\scripts\build.ps1
```

**macOS / Linux:**
```bash
bash scripts/build.sh
```

> **Prerequisites:** Node.js ≥ 20 and pnpm (`corepack enable`) must be installed first.
> See the [Prerequisites](#prerequisites) section above for platform-specific build
> toolchain requirements (Visual Studio Build Tools on Windows, Xcode CLT on macOS).

```

- [ ] **Step 2: Verify README renders correctly**

Open `README.md` and confirm:
- The new section appears before `### Project scripts`
- The code fences close properly (no broken markdown)
- The `Prerequisites` anchor link is correct (check the existing heading in the file)

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): add one-command build instructions for all platforms"
```

---

### Task 4: Smoke test on Windows

Run the Windows script end-to-end to confirm both paths work.

- [ ] **Step 1: Test the skip-deps path (deps already present)**

From the repo root in PowerShell:

```powershell
.\scripts\build.ps1
```

Expected:
- First line after prereq checks: `deps already installed, skipping`
- Build steps run
- Final line: `Done. Installer is at: apps/desktop/release/<version>/`
- Installer file exists at that path

- [ ] **Step 2: Test the fresh-install path**

Rename `node_modules/.pnpm` temporarily to force the install branch:

```powershell
Rename-Item node_modules/.pnpm node_modules/.pnpm-bak
.\scripts\build.ps1
Rename-Item node_modules/.pnpm-bak node_modules/.pnpm
```

Expected on second line: `Installing dependencies...` (pnpm install runs)

- [ ] **Step 3: Commit any fixes found during smoke test**

If the smoke test required any corrections to the scripts:

```bash
git add scripts/build.ps1 scripts/build.sh
git commit -m "fix(scripts): correct issues found during smoke test"
```

If no fixes were needed, skip this step.
