# Native Build Scripts Design

**Date:** 2026-05-31
**Status:** Approved

## Problem

Contributors who want to build Awakon installers must manually run three pnpm commands in the correct order. There is no single entry point that handles the full flow (install → compile → package). The friction is highest for first-time contributors on any platform.

## Goal

Provide two native scripts — one for Windows, one for Linux/macOS — that take a fresh clone to a ready installer in a single command, while skipping the install step when dependencies are already present.

## Scripts

### Location

```
scripts/
  build.ps1   ← Windows (PowerShell)
  build.sh    ← Linux + macOS (Bash)
```

Both scripts live at the repo root level under `scripts/` and are run from the repo root.

### Usage

**Windows:**
```powershell
.\scripts\build.ps1
```

**Linux / macOS:**
```bash
bash scripts/build.sh
# or after chmod +x:
./scripts/build.sh
```

## Behaviour

### 1. Prerequisite checks

Both scripts verify the environment before doing any work:

| Check | Failure action |
|---|---|
| `node` on PATH and version ≥ 20 | Print error with nodejs.org download link and exit 1 |
| `pnpm` on PATH | Print error suggesting `corepack enable` and exit 1 |

### 2. Dependency install (skip if already done)

Check whether `node_modules/.pnpm` exists at the repo root. pnpm writes this directory only after a successful install, making it a reliable signal.

- **Exists** → print `deps already installed, skipping` and continue
- **Missing** → run `pnpm install --frozen-lockfile`

### 3. Build

Both scripts run the same two-step compile:

```
pnpm -r --filter './packages/*' build   # workspace library packages
pnpm --filter @awakon/desktop build      # electron-vite compile
```

### 4. Package (platform-specific)

| Script | Command |
|---|---|
| `build.ps1` | `pnpm --filter @awakon/desktop dist:win` |
| `build.sh` on macOS (`uname == Darwin`) | `pnpm --filter @awakon/desktop dist:mac` |
| `build.sh` on Linux | `pnpm --filter @awakon/desktop dist:linux` |

### 5. Output message

On success both scripts print the installer location:

```
Done. Installer is at: apps/desktop/release/<version>/
```

## Error handling

- Any step that exits non-zero causes the script to stop immediately (`set -e` in Bash; `$ErrorActionPreference = 'Stop'` in PowerShell).
- Prerequisite failures print a clear, actionable message before exiting.

## Out of scope

- Code signing / notarisation (not yet supported by the project)
- Cross-compilation (each script only packages for the OS it runs on)
- Installing missing prerequisites automatically
