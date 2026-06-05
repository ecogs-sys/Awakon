# Awakon Migration Design

**Date:** 2026-06-06
**Status:** Approved

## Summary

Migrate the Awakon project to a new repository (`ecogs-sys/Awakon`) with full rebranding from `Awakon` / `@awakon/` to `Awakon` / `@awakon/`. Full git history is preserved. The Awakon repository is left untouched.

## Context

- **Source:** `C:\Work\ecogs\projects\Awakon` → `https://github.com/ecogs-sys/Awakon.git`
- **Destination:** `C:\Work\ecogs\projects\Awakon` → `https://github.com/ecogs-sys/Awakon.git`
- **Company:** ecogs
- **App name:** Awakon (formerly Awakon)

## Approach: Push History → Pull → Rebrand

All work happens in two stages. Stage 1 moves git history; Stage 2 applies the rebrand.

### Stage 1: Git History Migration

From the Awakon repo:
```
git remote add awakon https://github.com/ecogs-sys/Awakon.git
git push awakon main
```

From the Awakon repo:
```
git pull origin main --allow-unrelated-histories
```

The Awakon local repo now contains the full Awakon source tree and complete git history.

### Stage 2: Rebranding Commit

A single commit in the Awakon repo applies all substitutions:

| What | From | To |
|------|------|----|
| Package scope | `@awakon/` | `@awakon/` |
| Root package name | `awakon` | `awakon` |
| App product name | `Awakon` | `Awakon` |
| App ID | `com.ecogs.awakon` | `com.ecogs.awakon` |
| Linux executable name | `awakon` | `awakon` |
| GitHub repo references | `ecogs-sys/Awakon` | `ecogs-sys/Awakon` |
| GitHub homepage | `ecogs/Awakon` | `ecogs/Awakon` |

#### Files Changed

**Package manifests:**
- `package.json` (root) — `name: awakon` → `name: awakon`
- `apps/desktop/package.json` — `name: @awakon/desktop` → `@awakon/desktop`, homepage, workspace deps
- `packages/contracts/package.json` — `name: @awakon/contracts` → `@awakon/contracts`
- `packages/core/package.json` — `name: @awakon/core` → `@awakon/core`, dep `@awakon/contracts` → `@awakon/contracts`
- `packages/keymap/package.json` — `name: @awakon/keymap` → `@awakon/keymap`
- `packages/terminal-host/package.json` — `name: @awakon/terminal-host` → `@awakon/terminal-host`, dep `@awakon/contracts` → `@awakon/contracts`
- `tests/e2e/package.json` — `name: @awakon/e2e` → `@awakon/e2e`
- `tests/integration/package.json` — `name: @awakon/integration` → `@awakon/integration`, deps `@awakon/*` → `@awakon/*`

**Build / release config:**
- `apps/desktop/electron-builder.json` — `appId`, `productName`, GitHub publish `repo`
- `release-please-config.json` — package names and group name
- `.release-please-manifest.json` — package keys

**CI/CD workflows:**
- `.github/workflows/ci.yml` — `@awakon/desktop`, `@awakon/e2e` filter references
- `.github/workflows/release.yml` — `@awakon/desktop` filter references
- `.github/workflows/release-please.yml` — any `awakon` references

**Source files (imports + UI strings):**

All `.ts`, `.tsx`, and `.html` files under `apps/desktop/src/` that contain either:
- `@awakon/` import paths (e.g., `import ... from '@awakon/contracts'`) — replaced with `@awakon/`
- `"Awakon"` or `'Awakon'` as a user-visible UI string — replaced with `"Awakon"`

Known files from grep (not exhaustive — implementation uses search-and-replace):
- `apps/desktop/src/main/app-menu.ts` — "About Awakon" menu entry
- `apps/desktop/src/main/index.ts`, `fs-handlers.ts`, `notification-bridge.ts`, `session-bootstrap.ts`, `view-manager.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/renderer/chrome/about-dialog.ts`, `titlebar.ts`, `main.ts`, `keyboard.ts`, `layout-manager.ts`, `new-session-dialog.ts`, `settings-dialog.ts`, `sidebar.ts`, `state.ts`, `tab-strip.ts`
- `apps/desktop/src/renderer/terminal/context-menu.ts`, `main.ts`
- `apps/desktop/index.html`, `terminal-host.html` — `<title>` tags

**Docs:**
- `README.md` — project name, badges, GitHub links
- `CHANGELOG.md` / `apps/desktop/CHANGELOG.md` — any `Awakon` / `@awakon/` references in release notes
- All files under `docs/` — including `docs/design_handoff_awakon_redesign/` and any other docs with `Awakon` references

**Lock file:**
- `pnpm-lock.yaml` — regenerated via `pnpm install` after all package.json edits

#### Files NOT Changed

- `.vs/` IDE artifacts — not tracked in git
- `apps/desktop/release/` — build artifacts, not tracked in git

### Stage 3: Push to Awakon Remote

```
git push origin main
```

## Final State

| | Awakon | Awakon |
|--|--------|--------|
| Local path | `C:\Work\ecogs\projects\Awakon` | `C:\Work\ecogs\projects\Awakon` |
| Remote | `ecogs-sys/Awakon` (unchanged) | `ecogs-sys/Awakon` |
| History | Original | Full Awakon history + rebrand commit |
| Package scope | `@awakon/` | `@awakon/` |
| App name | `Awakon` | `Awakon` |
| App ID | `com.ecogs.awakon` | `com.ecogs.awakon` |
