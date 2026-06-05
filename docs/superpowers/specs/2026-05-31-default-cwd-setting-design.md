# Design: Default Working Directory Setting

**Date:** 2026-05-31
**Status:** Approved

---

## Summary

Add a "Default Working Directory" field to the View → Settings dialog. When set, this path is used as the pre-filled starting folder in the New Session dialog whenever no other sessions are open — replacing the current home-directory fallback. When sessions are already open, the existing behaviour (pre-fill with the last session's cwd) is preserved.

---

## Motivation

Users who always start sessions in a specific project folder currently have to navigate there every time they open a new tab. The setting eliminates that friction while leaving the "inherit last session's cwd" heuristic in place for multi-session workflows.

---

## Behaviour

### New Session dialog pre-fill priority (unchanged except for case 3)

| Priority | Condition | Pre-filled path |
|---|---|---|
| 1 | One or more sessions are open | Last open session's `cwd` |
| 2 | No sessions open AND `defaultCwd` setting is non-empty | `defaultCwd` setting value |
| 3 (was 2) | No sessions open AND `defaultCwd` is empty | Platform home directory |

The setting **does not** affect:
- The boot session created at first launch (always uses `homedir()`).
- Sessions created by restoring a persisted layout (cwd comes from `sessions.json`).
- The "duplicate tab" action (inherits the source session's cwd).

---

## Architecture

### 1. Contract — `packages/contracts/src/settings.ts`

Add `defaultCwd` to `AppSettingsSchema`:

```ts
export const AppSettingsSchema = z.object({
  autoResume: AutoResumeSettingsSchema,
  defaultCwd: z.string().default(''),   // ← new
});
```

- `z.string().default('')` means existing `settings.json` files that pre-date this field parse cleanly — Zod fills in `''` automatically.
- Empty string (`''`) means "not configured."
- No length cap; paths can be long on all platforms.

Update `DEFAULT_APP_SETTINGS`:

```ts
export const DEFAULT_APP_SETTINGS: AppSettings = Object.freeze({
  autoResume: Object.freeze({ ... }),
  defaultCwd: '',                        // ← new
});
```

### 2. Settings dialog — `apps/desktop/src/renderer/chrome/settings-dialog.ts`

Append a new `dlg-section` after the existing Auto-resume sections, matching the existing `dlg-label` / `dlg-input` visual style:

```
┌─ dialog-settings ──────────────────────────────────────────┐
│  [Auto-resume sections — unchanged]                         │
│                                                             │
│  DEFAULT WORKING DIRECTORY                                  │
│  ┌──────────────────────────────────────────┐ [Browse…]    │
│  │ /Users/dines/projects                     │              │
│  └──────────────────────────────────────────┘              │
│  Leave blank to use your home directory.                    │
└─────────────────────────────────────────────────────────────┘
```

**Implementation notes:**
- The input and Browse button sit in a flex row (`dlg-path-row`) to keep them inline.
- Browse calls `FsPickDirectory` IPC via `window.awakon` (same pattern as `new-session-dialog.ts`).
- The field accepts a free-typed path or a browsed one; empty is valid and means "not set."
- The field is **not validated** on save — an invalid path is silently ignored at session-open time (the New Session dialog validates the cwd before spawning).
- `submit()` reads the trimmed value and includes it in the returned `AppSettings`.

### 3. Layout manager — `apps/desktop/src/renderer/chrome/layout-manager.ts`

**New private field:**
```ts
private defaultCwdSetting = '';
```

**In `start()`** — cache the setting at startup alongside the existing `homeCwd` fetch:
```ts
const settings = await this.bridge.send(IpcChannel.SettingsGet) as AppSettings;
this.defaultCwdSetting = settings.defaultCwd ?? '';
```

**New event subscription in `start()`** — keep the cache fresh when the user saves settings:
```ts
this.bridge.on(IpcChannel.SettingsChanged, (raw) => {
  const s = raw as AppSettings;
  this.defaultCwdSetting = s.defaultCwd ?? '';
});
```

**Updated `platformDefaultCwd()`:**
```ts
private platformDefaultCwd(): string {
  // Priority 1: inherit last open session's cwd.
  for (const session of this.state.sessions.values()) {
    if (session.info.cwd) return session.info.cwd;
  }
  // Priority 2: configured default (if set).
  if (this.defaultCwdSetting) return this.defaultCwdSetting;
  // Priority 3: platform home directory.
  return this.homeCwd;
}
```

### 4. Main process — no changes

The main process (`apps/desktop/src/main/index.ts`) already persists `AppSettings` via `settingsStore.save()` and broadcasts `SettingsChanged` to the chrome renderer. No new IPC channels are needed.

---

## Files changed

| File | Change |
|---|---|
| `packages/contracts/src/settings.ts` | Add `defaultCwd` field + update default |
| `apps/desktop/src/renderer/chrome/settings-dialog.ts` | New "Default Working Directory" section |
| `apps/desktop/src/renderer/chrome/layout-manager.ts` | Cache setting, subscribe to changes, update `platformDefaultCwd` |

---

## Out of scope

- Applying `defaultCwd` to the boot session.
- Validating the path at settings-save time.
- Per-shell defaults.
- Any changes to the New Session dialog itself.
