# New Session Dialog — V1 Redesign

**Date:** 2026-05-25
**Source design:** `docs/design_handoff_awakon_redesign/` (README §8 "New session dialog", `vanilla-ts/panels.ts:renderNewSessionDialog`, `vanilla-ts/components.css` `aip-modal--newsession` block).

## Goal

Restyle the existing New Session dialog to match the design handoff's `aip-modal--newsession` look while keeping the V1 feature set narrow: **Working directory** + **Shell** sections only. Type (Claude/Codex/Shell), Initial prompt, and Open in (tab/split-right/split-below) are deferred to a follow-up pass.

## Non-goals (V1)

- Type segmented control (Claude Code / Codex CLI / Shell only).
- Initial prompt textarea + post-spawn prompt injection into the agent.
- Open-in radio (New tab / Split right / Split below).
- Recent-dir chips below the path input.
- `localStorage` draft persistence keyed by cwd-hash.
- Converting the Settings or Rename dialogs to the new `aip-modal__*` look — those keep their existing `.dialog`/`.dlg-*` styles until their own redesign passes.

## Scope summary

| Area | Change |
| --- | --- |
| Renderer dialog | Rewrite `apps/desktop/src/renderer/chrome/new-session-dialog.ts` body. Keep public signature. |
| Renderer styles | Add `aip-modal--newsession`, `aip-path-input`, `aip-radio-row`, `aip-label`, `aip-btn--ghost/primary`, etc. to `apps/desktop/src/renderer/chrome/styles/chrome.css`, drawn from `vanilla-ts/components.css`. |
| Contracts | Add `'git-bash'` to `ShellSchema` in `packages/contracts/src/session.ts`. Add `FsPickDirectory` and `FsPathExists` IPC channels + payload schemas in `packages/contracts/src/ipc.ts`. |
| Main process | Add `ipcMain.handle` for `FsPickDirectory` (wraps `dialog.showOpenDialog`) and `FsPathExists` (wraps `fs.promises.stat`) in `apps/desktop/src/main/index.ts`. |
| Core | Extend `shellCommand` in `packages/core/src/session.ts` with a `'git-bash'` case. |
| Tests | New renderer test file + main-process handler tests + contract schema tests. |

## Architecture

### File-by-file

```
apps/desktop/src/renderer/chrome/new-session-dialog.ts   (rewritten body, same export)
apps/desktop/src/renderer/chrome/styles/chrome.css       (+ aip-modal--newsession block)
packages/contracts/src/session.ts                        (+ 'git-bash' in ShellSchema)
packages/contracts/src/ipc.ts                            (+ FsPickDirectory, FsPathExists + schemas)
apps/desktop/src/main/index.ts                           (+ 2 ipcMain.handle handlers)
packages/core/src/session.ts                             (+ 'git-bash' case in shellCommand)
```

### Public contracts (unchanged)

```ts
// renderer/chrome/new-session-dialog.ts
export interface NewSessionResult {
  shell: Shell;
  cwd: string;
}
export function showNewSessionDialog(
  mount: HTMLElement,
  opts: { defaultShell: Shell; defaultCwd: string },
): Promise<NewSessionResult | null>;
```

`LayoutManager.openNewTabDialog()` is unchanged — it still calls `showNewSessionDialog`, awaits a `{ shell, cwd } | null`, and dispatches `SessionCreate` on resolve.

### New IPC channels

```ts
// packages/contracts/src/ipc.ts (additions)
IpcChannel.FsPickDirectory = 'core.fs.pick-directory'
IpcChannel.FsPathExists    = 'core.fs.path-exists'

const FsPickDirectoryPayloadSchema = z.object({
  startPath: z.string().optional(),
});
const FsPickDirectoryResponseSchema = z.union([
  z.object({ path: z.string() }),
  z.object({ cancelled: z.literal(true) }),
]);

const FsPathExistsPayloadSchema = z.object({
  path: z.string().min(1),
});
const FsPathExistsResponseSchema = z.object({
  exists: z.boolean(),
  isDirectory: z.boolean(),
});
```

## Component / DOM structure

The dialog renders into the existing `#dialog-mount` overlay (already styled with `var(--bg-overlay)` + `backdrop-filter: blur(2px)`). The card itself uses the new `aip-modal--newsession` structure:

```
.aip-modal.aip-modal--newsession
├── .aip-modal__header
│   ├── .aip-modal__header-left
│   │   ├── .aip-modal__crumb        "New session"
│   │   ├── .aip-modal__crumb-dot
│   │   └── .aip-modal__title        "Configure"
│   └── .aip-modal__close            ×
├── .aip-modal__body                 (scrolling)
│   ├── .aip-modal__section          [Working directory]
│   │   ├── .aip-label               "Working directory"
│   │   ├── .aip-path-input
│   │   │   ├── .aip-path-input__field   (parent dim + tail bright; click to edit)
│   │   │   └── .aip-path-input__browse  "🗁 Browse…"
│   │   └── .aip-cwd-error           hidden until invalid; "directory not found" / "not a directory"
│   └── .aip-modal__section          [Shell]
│       ├── .aip-label               "Shell"
│       └── .aip-radio-row
│           └── .aip-radio[.aip-radio--active]  × N (filtered by OS)
└── .aip-modal__footer               sticky
    ├── (mono hint: "Press Enter to start · Esc to cancel")
    └── (Cancel · Start session)
```

### Path-input rendering

Two visual states inside `.aip-path-input__field`:

- **Display state:** split `state.cwd` at the last `/` or `\` (whichever appears later). The head renders in `<span class="dim">` (muted); the tail renders as plain text. The whole field is clickable.
- **Edit state:** the field renders as an `<input type="text">` styled to fill the same inner box; the outer `.aip-path-input` keeps the border + focus ring so the visual frame doesn't shift.

Transitions:
- Clicking the display state swaps to edit state and focuses the input.
- Blurring the input swaps back to display state and re-renders the muted/bright split with the new value.
- Pressing Enter inside the input submits the dialog (does not blur first — submit reads the live input value).
- On dialog mount, the field starts in edit state and the input is focused + selected so the user can type immediately. After the first blur, it follows the rules above.

### Shell radio row

Filtered at render time via `navigator.userAgent`:

| OS | Radios (in order) |
| --- | --- |
| Windows | `pwsh` (label `pwsh.exe`), `cmd` (label `cmd.exe`), `git-bash` (label `git-bash`) |
| macOS | `zsh`, `bash` |
| Linux | `bash`, `zsh` |

Each radio is `.aip-radio` with an `.aip-radio__dot`. Active radio gets `.aip-radio--active`. Clicking selects. Keyboard model follows the WAI-ARIA radio-group pattern: `ArrowLeft`/`ArrowUp` selects the previous radio and moves focus to it; `ArrowRight`/`ArrowDown` selects the next; `Home`/`End` jump to first/last. The whole row has a single tab stop — Tab moves to the next dialog control, not between radios.

## Data flow

```
User clicks + or hits Mod+N
  └─ LayoutManager.openNewTabDialog()
       ├─ bridge.send(LayoutModal, { open: true })        (suspend terminal overlay)
       ├─ showNewSessionDialog(mount, { defaultShell, defaultCwd })
       │     ├─ State: { shell: defaultShell, cwd: defaultCwd, error: null }
       │     ├─ User edits cwd / picks shell
       │     ├─ Browse click → bridge.send(FsPickDirectory, { startPath: state.cwd })
       │     │     └─ main: dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath })
       │     │        returns { path } | { cancelled: true }
       │     │        on { path }: state.cwd = path; re-render
       │     ├─ Submit (Enter or Start)
       │     │     └─ bridge.send(FsPathExists, { path: state.cwd })
       │     │        ├─ { exists: true, isDirectory: true }
       │     │        │   → resolve({ shell, cwd }); cleanup
       │     │        ├─ { exists: true, isDirectory: false }
       │     │        │   → state.error = 'not a directory'; render error; stay open
       │     │        └─ { exists: false }
       │     │            → state.error = 'directory not found'; render error; stay open
       │     └─ Cancel / Esc / scrim click → resolve(null); cleanup
       ├─ bridge.send(LayoutModal, { open: false })       (always, finally)
       └─ if result: bridge.send(SessionCreate, { shell, cwd, cols: 80, rows: 24 })
```

### Main-process handlers

```ts
// apps/desktop/src/main/index.ts (additions)
ipcMain.handle(IpcChannel.FsPickDirectory, async (_e, raw) => {
  const parsed = FsPickDirectoryPayloadSchema.safeParse(raw);
  if (!parsed.success) return { cancelled: true };
  if (!chromeWindow) return { cancelled: true };
  const result = await dialog.showOpenDialog(chromeWindow, {
    properties: ['openDirectory'],
    ...(parsed.data.startPath ? { defaultPath: parsed.data.startPath } : {}),
  });
  if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
  return { path: result.filePaths[0]! };
});

ipcMain.handle(IpcChannel.FsPathExists, async (_e, raw) => {
  const parsed = FsPathExistsPayloadSchema.safeParse(raw);
  if (!parsed.success) return { exists: false, isDirectory: false };
  try {
    const st = await stat(parsed.data.path);
    return { exists: true, isDirectory: st.isDirectory() };
  } catch {
    return { exists: false, isDirectory: false };
  }
});
```

### Core `shellCommand` extension

```ts
// packages/core/src/session.ts
function shellCommand(shell: SessionCreateOptions['shell']): string {
  switch (shell) {
    case 'pwsh': return 'pwsh.exe';
    case 'powershell': return 'powershell.exe';
    case 'cmd': return 'cmd.exe';
    case 'bash': return 'bash';
    case 'zsh': return 'zsh';
    case 'wsl': return 'wsl.exe';
    case 'git-bash': return 'bash.exe';  // resolved from PATH; Git for Windows installer adds it
  }
}
```

`bash.exe` from Git for Windows is on the user's PATH when Git is installed via the standard installer. If it isn't on PATH, spawn will fail with ENOENT and the existing error path surfaces it in the terminal pane — same as any other missing-binary case.

## Error handling & edge cases

| Case | Behavior |
| --- | --- |
| `cwd` empty (trimmed) | Start button disabled; no error message shown. |
| `cwd` doesn't exist on submit | `.aip-path-input` gets `.aip-path-input--invalid` (red border, no accent glow). `.aip-cwd-error` shows `directory not found`. Cleared on the next keystroke. Start re-enables once the user edits. |
| `cwd` is a file, not a directory | Same UI as "doesn't exist"; error text is `not a directory`. |
| Browse cancelled | No state change; field keeps prior value. |
| `FsPickDirectory` IPC error (very rare) | Browse no-ops; `console.warn` logs the underlying error. |
| `SessionCreate` returns `{ error }` after submit | Existing path: `console.error` in `LayoutManager.openNewTabDialog`. Dialog already closed; no rollback. Same behavior as today. |
| Dialog opened twice rapidly | Existing single-mount behavior preserved: `mount.innerHTML = ''` clears the prior render before mounting fresh. |
| Scrim click (target === mount) | Dismiss (resolve `null`). |
| `Escape` key | Dismiss. |
| `Enter` inside the path edit input | Submit. |
| `Enter` while an `.aip-radio` is focused | Submit (matches "Enter starts the session" — the user has already committed to a shell via arrow keys). |
| Arrow keys inside `.aip-radio-row` | Cycle selection within the row, moving focus with selection (ARIA radio-group pattern). |

## Styles

A new block in `apps/desktop/src/renderer/chrome/styles/chrome.css`, ported from `vanilla-ts/components.css` lines for the new-session selectors. Class names use the `aip-*` namespace and do not collide with the existing `.dialog`/`.dlg-*` block.

Key selectors (full CSS lives in the design handoff; this is the surface area):
- `.aip-modal`, `.aip-modal--newsession` — card frame (620px wide, max-h `calc(100vh - 80px)`, border-radius 12px, `bg-2` surface, soft shadow).
- `.aip-modal__header`, `.aip-modal__header-left`, `.aip-modal__crumb`, `.aip-modal__crumb-dot`, `.aip-modal__title`, `.aip-modal__close` — top strip.
- `.aip-modal__body`, `.aip-modal__section`, `.aip-label` — scrolling body and section labels.
- `.aip-modal__footer` — sticky footer.
- `.aip-path-input`, `.aip-path-input__field`, `.aip-path-input__browse`, `.aip-path-input--invalid`, `.aip-cwd-error` — working-directory control.
- `.aip-radio-row`, `.aip-radio`, `.aip-radio--active`, `.aip-radio__dot` — shell picker.
- `.aip-btn`, `.aip-btn--ghost`, `.aip-btn--primary` — footer buttons.
- `.aip-path-input__field .dim` — muted parent-dir text.

All colors and spacing reference `var(--token)` from the existing `tokens.css` — no new tokens are introduced.

## Testing

Three layers; all run under existing `pnpm test` / `vitest`.

**Renderer unit tests** — `apps/desktop/src/renderer/chrome/new-session-dialog.test.ts` (new). jsdom; mock `window.awakon` bridge.

- Structure: root has `.aip-modal--newsession`; header crumb reads "New session · Configure"; footer has a "Start session" primary button.
- OS filtering: stub `navigator.userAgent` for Windows → 3 radios (`pwsh.exe`, `cmd.exe`, `git-bash`); macOS → 2 (`zsh`, `bash`); Linux → 2 (`bash`, `zsh`).
- Path rendering: `~/Work/foo` splits to muted `~/Work/` + bright `foo`; `C:\Users\me\proj` splits to muted `C:\Users\me\` + bright `proj`.
- Submit happy-path: with bridge returning `{ exists: true, isDirectory: true }`, the promise resolves to `{ shell: <selected>, cwd: <typed> }`.
- Submit invalid: `{ exists: false }` → dialog stays open, `.aip-cwd-error` visible with text `directory not found`, promise unresolved.
- Submit file-not-dir: `{ exists: true, isDirectory: false }` → `.aip-cwd-error` visible with text `not a directory`.
- Cancel: Escape, Cancel button, and scrim click all resolve `null` and clear the mount.
- Browse: clicking the Browse button dispatches `FsPickDirectory`. On `{ path: '/foo' }` the field re-renders with the new path. On `{ cancelled: true }` no change.

**Main-process handler tests** — `apps/desktop/src/main/fs-handlers.test.ts` (new) or extend the closest existing test.

- `FsPathExists` for a real temp directory → `{ exists: true, isDirectory: true }`.
- `FsPathExists` for a real temp file → `{ exists: true, isDirectory: false }`.
- `FsPathExists` for a non-existent path → `{ exists: false, isDirectory: false }`.
- `FsPathExists` for an empty-string payload → `{ exists: false, isDirectory: false }` (zod rejects, handler returns the safe default).
- `FsPickDirectory` with `dialog.showOpenDialog` mocked to return `{ canceled: false, filePaths: ['/picked'] }` → `{ path: '/picked' }`.
- `FsPickDirectory` with `dialog.showOpenDialog` mocked to return `{ canceled: true, filePaths: [] }` → `{ cancelled: true }`.

**Contract schema tests** — extend `packages/contracts/tests/` (or create a small file).

- `ShellSchema.parse('git-bash')` succeeds.
- `FsPickDirectoryPayloadSchema.parse({ startPath: '/foo' })` succeeds; `.parse({ startPath: 5 })` throws.
- `FsPathExistsPayloadSchema.parse({ path: '/foo' })` succeeds; `.parse({ path: '' })` throws.

No E2E changes — the existing e2e suite covers session creation and is not affected by the dialog's UI restyle.

## Out of scope (to be tracked separately)

- Type segmented control + agent-binary spawning.
- Initial prompt textarea + prompt injection into the spawned agent.
- Open-in radio + split-pane creation from the dialog.
- Recent-dir chips backed by a recents store.
- `localStorage` draft persistence.
- Migrating the Settings and Rename dialogs to the `aip-modal__*` look.
