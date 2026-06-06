# New Session Dialog V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the existing New Session dialog to the design-handoff `aip-modal--newsession` look with Working directory + Shell sections only, plus the supporting IPC for Browse + cwd validation.

**Architecture:** Two-section modal in the existing `#dialog-mount`. Renderer drives a small state machine (cwd, shell, error); Browse and submit-time validation call new main-process IPC handlers (`FsPickDirectory`, `FsPathExists`). All visual styling is BEM-namespaced (`aip-*`) and lives alongside the existing `.dialog`/`.dlg-*` rules, which keep serving the Settings + Rename dialogs untouched.

**Tech Stack:** TypeScript, Electron 33, electron-vite, zod (schemas), vitest + jsdom (unit tests), Playwright (e2e). Workspace: pnpm @ 9.12.0.

**Spec:** `docs/superpowers/specs/2026-05-25-new-session-dialog-design.md`

---

## File Structure

**Modify:**
- `packages/contracts/src/session.ts` — add `'git-bash'` to `ShellSchema`.
- `packages/contracts/src/ipc.ts` — add `FsPickDirectory` + `FsPathExists` channels and their payload/response schemas.
- `packages/core/src/session.ts` — add `'git-bash'` case to `shellCommand`.
- `apps/desktop/package.json` — add vitest + jsdom devDeps + `test` script.
- `apps/desktop/src/main/index.ts` — register the two new ipcMain handlers from the new factory module.
- `apps/desktop/src/renderer/chrome/new-session-dialog.ts` — rewrite body; keep export signature.
- `apps/desktop/src/renderer/chrome/styles/chrome.css` — append the new `aip-*` rule block.
- `tests/e2e/multi-tab.spec.ts` — update selector from `#ns-open` to the new Start button selector.

**Create:**
- `packages/core/tests/fs-ipc-schema.test.ts` — schema tests for the new IPC contracts.
- `apps/desktop/vitest.config.ts` — vitest config for the desktop package (jsdom for renderer, node for main).
- `apps/desktop/src/main/fs-handlers.ts` — `registerFsHandlers(ipcMain, getWindow)` factory.
- `apps/desktop/src/main/fs-handlers.test.ts` — main-process handler tests.
- `apps/desktop/src/renderer/chrome/new-session-dialog.test.ts` — renderer dialog tests.

Each file has one clear responsibility. The factory pattern in `fs-handlers.ts` exists so the handlers are testable without booting Electron.

---

## Task 1: Add `git-bash` to `ShellSchema`

**Files:**
- Modify: `packages/contracts/src/session.ts`
- Create: `packages/core/tests/shell-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/shell-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ShellSchema } from '@awakon/contracts';

describe('ShellSchema', () => {
  it('accepts existing shells', () => {
    for (const shell of ['pwsh', 'powershell', 'cmd', 'bash', 'zsh', 'wsl'] as const) {
      expect(ShellSchema.safeParse(shell).success).toBe(true);
    }
  });

  it('accepts git-bash', () => {
    expect(ShellSchema.safeParse('git-bash').success).toBe(true);
  });

  it('rejects unknown shells', () => {
    expect(ShellSchema.safeParse('fish').success).toBe(false);
    expect(ShellSchema.safeParse('').success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from repo root:
```
pnpm --filter @awakon/core test shell-schema
```

Expected: FAIL on the `git-bash` case — `safeParse('git-bash').success` is `false` because `ShellSchema` doesn't list it.

- [ ] **Step 3: Add `'git-bash'` to the schema**

Edit `packages/contracts/src/session.ts` line 14:

```ts
export const ShellSchema = z.enum(['pwsh', 'powershell', 'cmd', 'bash', 'zsh', 'wsl', 'git-bash']);
```

- [ ] **Step 4: Rebuild contracts and re-run the test**

```
pnpm --filter @awakon/contracts build
pnpm --filter @awakon/core test shell-schema
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```
git add packages/contracts/src/session.ts packages/core/tests/shell-schema.test.ts
git commit -m "feat(contracts): add 'git-bash' to ShellSchema"
```

---

## Task 2: Add `FsPickDirectory` + `FsPathExists` IPC channels

**Files:**
- Modify: `packages/contracts/src/ipc.ts`
- Create: `packages/core/tests/fs-ipc-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/fs-ipc-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  IpcChannel,
  FsPickDirectoryPayloadSchema,
  FsPickDirectoryResponseSchema,
  FsPathExistsPayloadSchema,
  FsPathExistsResponseSchema,
} from '@awakon/contracts';

describe('fs IPC channels', () => {
  it('exposes the new channel names', () => {
    expect(IpcChannel.FsPickDirectory).toBe('core.fs.pick-directory');
    expect(IpcChannel.FsPathExists).toBe('core.fs.path-exists');
  });
});

describe('FsPickDirectoryPayloadSchema', () => {
  it('accepts an empty object (startPath is optional)', () => {
    expect(FsPickDirectoryPayloadSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a string startPath', () => {
    expect(FsPickDirectoryPayloadSchema.safeParse({ startPath: '/foo' }).success).toBe(true);
  });

  it('rejects a non-string startPath', () => {
    expect(FsPickDirectoryPayloadSchema.safeParse({ startPath: 5 }).success).toBe(false);
  });
});

describe('FsPickDirectoryResponseSchema', () => {
  it('accepts { path: string }', () => {
    expect(FsPickDirectoryResponseSchema.safeParse({ path: '/foo' }).success).toBe(true);
  });

  it('accepts { cancelled: true }', () => {
    expect(FsPickDirectoryResponseSchema.safeParse({ cancelled: true }).success).toBe(true);
  });

  it('rejects other shapes', () => {
    expect(FsPickDirectoryResponseSchema.safeParse({}).success).toBe(false);
    expect(FsPickDirectoryResponseSchema.safeParse({ cancelled: false }).success).toBe(false);
  });
});

describe('FsPathExistsPayloadSchema', () => {
  it('accepts a non-empty path', () => {
    expect(FsPathExistsPayloadSchema.safeParse({ path: '/foo' }).success).toBe(true);
  });

  it('rejects an empty path', () => {
    expect(FsPathExistsPayloadSchema.safeParse({ path: '' }).success).toBe(false);
  });
});

describe('FsPathExistsResponseSchema', () => {
  it('accepts { exists, isDirectory } booleans', () => {
    expect(FsPathExistsResponseSchema.safeParse({ exists: true,  isDirectory: true  }).success).toBe(true);
    expect(FsPathExistsResponseSchema.safeParse({ exists: false, isDirectory: false }).success).toBe(true);
  });

  it('rejects missing keys', () => {
    expect(FsPathExistsResponseSchema.safeParse({ exists: true }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
pnpm --filter @awakon/core test fs-ipc-schema
```

Expected: FAIL — `FsPickDirectoryPayloadSchema` and friends do not exist yet.

- [ ] **Step 3: Add the channels and schemas**

Edit `packages/contracts/src/ipc.ts`.

In the `IpcChannel` object (around line 30, alongside `LayoutDefaultCwd`), add two entries to the **Requests** block:

```ts
  LayoutDefaultCwd: 'core.layout.default-cwd',
  FsPickDirectory: 'core.fs.pick-directory',
  FsPathExists: 'core.fs.path-exists',
```

Then after `LayoutReorderTabsPayloadSchema` (around line 107), add:

```ts
/** Renderer asks main to open a native directory picker. `startPath` (if given) becomes
 * `defaultPath` on showOpenDialog. Response is the picked path or a cancelled marker. */
export const FsPickDirectoryPayloadSchema = z.object({
  startPath: z.string().optional(),
});
export const FsPickDirectoryResponseSchema = z.union([
  z.object({ path: z.string() }),
  z.object({ cancelled: z.literal(true) }),
]);

/** Renderer asks main whether a filesystem path exists and is a directory.
 * On any stat error (ENOENT, EACCES, ENOTDIR) the handler returns
 * `{ exists: false, isDirectory: false }` — never throws. */
export const FsPathExistsPayloadSchema = z.object({
  path: z.string().min(1),
});
export const FsPathExistsResponseSchema = z.object({
  exists: z.boolean(),
  isDirectory: z.boolean(),
});
```

- [ ] **Step 4: Rebuild and re-run the test**

```
pnpm --filter @awakon/contracts build
pnpm --filter @awakon/core test fs-ipc-schema
```

Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```
git add packages/contracts/src/ipc.ts packages/core/tests/fs-ipc-schema.test.ts
git commit -m "feat(contracts): add FsPickDirectory + FsPathExists IPC channels"
```

---

## Task 3: Extend `shellCommand` for `'git-bash'`

**Files:**
- Modify: `packages/core/src/session.ts`
- Create: `packages/core/tests/shell-command.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/shell-command.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { spawn } from 'node-pty';

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({
    onData: () => ({ dispose: () => {} }),
    onExit: () => ({ dispose: () => {} }),
    write: () => {},
    resize: () => {},
    kill: () => {},
    pid: 0,
  })),
}));

import { vi } from 'vitest';
import { Session } from '../src/session.js';

describe('Session shell command resolution', () => {
  it('resolves git-bash to bash.exe', () => {
    new Session('id', { shell: 'git-bash', cwd: '.', cols: 80, rows: 24 });
    expect((spawn as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBe('bash.exe');
  });

  it('still resolves pwsh to pwsh.exe', () => {
    new Session('id', { shell: 'pwsh', cwd: '.', cols: 80, rows: 24 });
    expect((spawn as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBe('pwsh.exe');
  });
});
```

Note: `vi` is imported after `vi.mock` because vitest hoists `vi.mock` calls; the import keeps the linter quiet.

- [ ] **Step 2: Run the test to verify it fails**

```
pnpm --filter @awakon/core test shell-command
```

Expected: FAIL — `'git-bash'` is not a key in the `shellCommand` switch, so TypeScript+zod accept the input but the runtime switch returns `undefined`, and spawn is called with `undefined`.

- [ ] **Step 3: Add the `git-bash` case**

Edit `packages/core/src/session.ts` line 25-35. Replace `shellCommand` with:

```ts
function shellCommand(shell: SessionCreateOptions['shell']): string {
  switch (shell) {
    case 'pwsh': return 'pwsh.exe';
    case 'powershell': return 'powershell.exe';
    case 'cmd': return 'cmd.exe';
    case 'bash': return 'bash';
    case 'zsh': return 'zsh';
    case 'wsl': return 'wsl.exe';
    case 'git-bash': return 'bash.exe';
  }
}
```

`bash.exe` is the Git for Windows bash shim; the standard installer puts it on PATH.

- [ ] **Step 4: Re-run the test**

```
pnpm --filter @awakon/core test shell-command
```

Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```
git add packages/core/src/session.ts packages/core/tests/shell-command.test.ts
git commit -m "feat(core): resolve 'git-bash' shell to bash.exe"
```

---

## Task 4: Set up vitest + jsdom for the desktop package

The desktop package has no test infra today. This task adds vitest with two project configs: one for renderer files (jsdom) and one for main-process files (node).

**Files:**
- Modify: `apps/desktop/package.json`
- Create: `apps/desktop/vitest.config.ts`

- [ ] **Step 1: Add devDependencies and a test script**

Edit `apps/desktop/package.json`. In `scripts`, add a `test` entry next to `typecheck`:

```json
    "test": "vitest run",
```

In `devDependencies`, add (alphabetised) — preserve all existing entries:

```json
    "@types/node": "^20.14.0",
    "@vitest/coverage-v8": "^2.1.0",
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "electron-vite": "^2.3.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
```

(Versions match what `@awakon/core` already pins — same major minor so pnpm reuses the install.)

- [ ] **Step 2: Create the vitest config**

Create `apps/desktop/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Per-file env via `// @vitest-environment jsdom` at the top of a test file.
    // Default to node so main-process tests don't pay the jsdom cost.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
```

- [ ] **Step 3: Install the new deps**

```
pnpm install
```

Expected: pnpm adds `vitest`, `jsdom`, `@vitest/coverage-v8` to `apps/desktop/node_modules`. No errors.

- [ ] **Step 4: Smoke-test vitest with a sanity file**

Create a one-off file `apps/desktop/src/main/_vitest-smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('vitest smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run:
```
pnpm --filter @awakon/desktop test
```

Expected: 1 passing test.

- [ ] **Step 5: Delete the smoke file and commit**

```
git rm apps/desktop/src/main/_vitest-smoke.test.ts
git add apps/desktop/package.json apps/desktop/vitest.config.ts apps/desktop/pnpm-lock.yaml
git add ../../pnpm-lock.yaml  # workspace lockfile change
git commit -m "chore(desktop): add vitest + jsdom test infrastructure"
```

(If the second `git add` complains the path is outside the index, just stage `pnpm-lock.yaml` at repo root via a normal absolute reference.)

---

## Task 5: Main-process `fs-handlers.ts` factory + tests

Extract the two handlers into a testable factory so they can run under vitest with mocked Electron primitives, then wire it from `main/index.ts`.

**Files:**
- Create: `apps/desktop/src/main/fs-handlers.ts`
- Create: `apps/desktop/src/main/fs-handlers.test.ts`
- Modify: `apps/desktop/src/main/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/main/fs-handlers.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerFsHandlers, type IpcLike, type DialogLike } from './fs-handlers.js';

interface RegisteredHandler {
  (event: unknown, payload: unknown): Promise<unknown>;
}

function makeFakeIpc(): { ipc: IpcLike; handlers: Map<string, RegisteredHandler> } {
  const handlers = new Map<string, RegisteredHandler>();
  const ipc: IpcLike = {
    handle: (channel, handler) => { handlers.set(channel, handler as RegisteredHandler); },
  };
  return { ipc, handlers };
}

describe('FsPathExists handler', () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fs-handlers-'));
    tempFile = join(tempDir, 'file.txt');
    await writeFile(tempFile, 'hi');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns exists+isDirectory for a real directory', async () => {
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => null, {} as DialogLike);
    const result = await handlers.get('core.fs.path-exists')!({}, { path: tempDir });
    expect(result).toEqual({ exists: true, isDirectory: true });
  });

  it('returns exists but not directory for a real file', async () => {
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => null, {} as DialogLike);
    const result = await handlers.get('core.fs.path-exists')!({}, { path: tempFile });
    expect(result).toEqual({ exists: true, isDirectory: false });
  });

  it('returns exists=false for a missing path', async () => {
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => null, {} as DialogLike);
    const result = await handlers.get('core.fs.path-exists')!({}, { path: join(tempDir, 'nope') });
    expect(result).toEqual({ exists: false, isDirectory: false });
  });

  it('returns exists=false for an empty string payload', async () => {
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => null, {} as DialogLike);
    const result = await handlers.get('core.fs.path-exists')!({}, { path: '' });
    expect(result).toEqual({ exists: false, isDirectory: false });
  });

  it('returns exists=false for a malformed payload', async () => {
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => null, {} as DialogLike);
    const result = await handlers.get('core.fs.path-exists')!({}, { wrong: 'shape' });
    expect(result).toEqual({ exists: false, isDirectory: false });
  });
});

describe('FsPickDirectory handler', () => {
  it('returns { path } when the user picks a directory', async () => {
    const showOpenDialog = vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/picked'] });
    const dialog: DialogLike = { showOpenDialog };
    const fakeWindow = {} as Electron.BrowserWindow;
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => fakeWindow, dialog);

    const result = await handlers.get('core.fs.pick-directory')!({}, { startPath: '/start' });

    expect(result).toEqual({ path: '/picked' });
    expect(showOpenDialog).toHaveBeenCalledWith(fakeWindow, {
      properties: ['openDirectory'],
      defaultPath: '/start',
    });
  });

  it('omits defaultPath when startPath is absent', async () => {
    const showOpenDialog = vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/picked'] });
    const dialog: DialogLike = { showOpenDialog };
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => ({} as Electron.BrowserWindow), dialog);

    await handlers.get('core.fs.pick-directory')!({}, {});

    expect(showOpenDialog).toHaveBeenCalledWith(expect.anything(), {
      properties: ['openDirectory'],
    });
  });

  it('returns { cancelled: true } when the user cancels', async () => {
    const dialog: DialogLike = {
      showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
    };
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => ({} as Electron.BrowserWindow), dialog);
    const result = await handlers.get('core.fs.pick-directory')!({}, {});
    expect(result).toEqual({ cancelled: true });
  });

  it('returns { cancelled: true } when no window is available', async () => {
    const dialog: DialogLike = { showOpenDialog: vi.fn() };
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => null, dialog);
    const result = await handlers.get('core.fs.pick-directory')!({}, {});
    expect(result).toEqual({ cancelled: true });
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
  });

  it('returns { cancelled: true } when the payload is malformed', async () => {
    const dialog: DialogLike = { showOpenDialog: vi.fn() };
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => ({} as Electron.BrowserWindow), dialog);
    const result = await handlers.get('core.fs.pick-directory')!({}, { startPath: 5 });
    expect(result).toEqual({ cancelled: true });
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
pnpm --filter @awakon/desktop test fs-handlers
```

Expected: FAIL — `./fs-handlers.js` doesn't exist.

- [ ] **Step 3: Create the factory module**

Create `apps/desktop/src/main/fs-handlers.ts`:

```ts
import { stat } from 'node:fs/promises';
import type { BrowserWindow, IpcMain } from 'electron';
import {
  FsPickDirectoryPayloadSchema,
  FsPathExistsPayloadSchema,
  IpcChannel,
} from '@awakon/contracts';

/** Subset of `ipcMain` we depend on — narrows the surface for tests. */
export interface IpcLike {
  handle: (channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown> | unknown) => void;
}

/** Subset of Electron's `dialog` we depend on. */
export interface DialogLike {
  showOpenDialog: (
    window: BrowserWindow,
    options: Electron.OpenDialogOptions,
  ) => Promise<Electron.OpenDialogReturnValue>;
}

/**
 * Register filesystem-IPC handlers used by the New Session dialog:
 *   - FsPickDirectory  → native directory picker
 *   - FsPathExists     → stat-based existence check
 *
 * `getWindow` is a getter (not a value) so the registration order doesn't
 * couple to chromeWindow construction time.
 */
export function registerFsHandlers(
  ipc: IpcLike,
  getWindow: () => BrowserWindow | null,
  dialog: DialogLike,
): void {
  ipc.handle(IpcChannel.FsPickDirectory, async (_e, raw) => {
    const parsed = FsPickDirectoryPayloadSchema.safeParse(raw);
    if (!parsed.success) return { cancelled: true };
    const win = getWindow();
    if (!win) return { cancelled: true };
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      ...(parsed.data.startPath ? { defaultPath: parsed.data.startPath } : {}),
    });
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
    return { path: result.filePaths[0]! };
  });

  ipc.handle(IpcChannel.FsPathExists, async (_e, raw) => {
    const parsed = FsPathExistsPayloadSchema.safeParse(raw);
    if (!parsed.success) return { exists: false, isDirectory: false };
    try {
      const st = await stat(parsed.data.path);
      return { exists: true, isDirectory: st.isDirectory() };
    } catch {
      return { exists: false, isDirectory: false };
    }
  });
}
```

- [ ] **Step 4: Re-run the tests**

```
pnpm --filter @awakon/desktop test fs-handlers
```

Expected: PASS (10 tests).

- [ ] **Step 5: Wire from `main/index.ts`**

Edit `apps/desktop/src/main/index.ts`.

In the imports block (line 1):

```ts
import { app, BrowserWindow, Menu, ipcMain, dialog } from 'electron';
```

(Add `dialog` to the destructure.)

After `// IPC: renderer asks for the platform home directory ...` near line 134, add:

```ts
// IPC: filesystem helpers used by the New Session dialog (Browse + cwd validation).
registerFsHandlers(ipcMain, () => chromeWindow, dialog);
```

And add the import at the top (right after `auto-update`):

```ts
import { registerFsHandlers } from './fs-handlers.js';
```

- [ ] **Step 6: Verify typecheck**

```
pnpm --filter @awakon/desktop typecheck
```

Expected: PASS, no new diagnostics.

- [ ] **Step 7: Commit**

```
git add apps/desktop/src/main/fs-handlers.ts apps/desktop/src/main/fs-handlers.test.ts apps/desktop/src/main/index.ts
git commit -m "feat(main): add FsPickDirectory + FsPathExists IPC handlers"
```

---

## Task 6: Add `aip-modal--newsession` styles to `chrome.css`

**Files:**
- Modify: `apps/desktop/src/renderer/chrome/styles/chrome.css`

- [ ] **Step 1: Append the new style block**

At the end of `apps/desktop/src/renderer/chrome/styles/chrome.css` (after line 548), append:

```css

/* ──────────────────────────────────────────────────────────────────────
   New Session dialog — aip-modal--newsession
   Ported from docs/design_handoff_awakon_redesign/vanilla-ts/components.css
   Coexists with .dialog/.dlg-* (used by Settings + Rename).
   ────────────────────────────────────────────────────────────────────── */

.aip-modal {
  background: var(--bg-2);
  border: 1px solid var(--border-2);
  box-shadow: 0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04);
  overflow: hidden;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-1);
}

.aip-modal--newsession {
  width: 620px;
  max-height: calc(100vh - 80px);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
}
.aip-modal--newsession .aip-modal__body { flex: 1; overflow: auto; }
.aip-modal--newsession .aip-modal__section { padding: 16px 22px; }

.aip-modal__header {
  padding: 14px 22px;
  border-bottom: 1px solid var(--border-1);
  display: flex; align-items: center; justify-content: space-between;
}
.aip-modal__header-left { display: flex; align-items: center; gap: 10px; }
.aip-modal__crumb {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-4);
  text-transform: uppercase;
  letter-spacing: 1.4px;
}
.aip-modal__crumb-dot {
  width: 4px; height: 4px; border-radius: 50%;
  background: var(--text-4);
}
.aip-modal__title { font-size: 13px; color: var(--text-1); }
.aip-modal__close {
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--text-3); font-size: 14px;
  cursor: pointer;
  background: transparent; border: 0;
  border-radius: 4px;
}
.aip-modal__close:hover { background: var(--bg-3); color: var(--text-1); }

.aip-modal__section { padding: 18px 22px; border-bottom: 1px solid var(--border-1); }
.aip-modal__section:last-of-type { border-bottom: 0; }

.aip-modal__footer {
  padding: 14px 22px;
  border-top: 1px solid var(--border-1);
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
}
.aip-modal__footer-hint {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-4);
}
.aip-modal__footer-actions { display: flex; gap: 8px; }

.aip-label {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: 6px;
}

/* ── Path input (Working directory) ── */

.aip-path-input {
  display: flex; align-items: stretch;
  border: 1px solid var(--border-2); border-radius: 6px;
  background: var(--bg-0); overflow: hidden;
}
.aip-path-input:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.aip-path-input--invalid,
.aip-path-input--invalid:focus-within {
  border-color: var(--st-limited);
  box-shadow: none;
}
.aip-path-input__field {
  flex: 1;
  padding: 9px 12px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--text-1);
  cursor: text;
  display: flex; align-items: center;
  min-width: 0;
}
.aip-path-input__field .dim { color: var(--text-4); }
.aip-path-input__field input {
  width: 100%;
  background: transparent;
  border: 0; outline: 0; padding: 0; margin: 0;
  font-family: inherit; font-size: inherit; color: inherit;
}
.aip-path-input__browse {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 0 14px;
  border: 0;
  border-left: 1px solid var(--border-2);
  background: var(--bg-1);
  font-family: var(--font-sans); font-size: 12px;
  color: var(--text-2);
  cursor: pointer;
}
.aip-path-input__browse:hover { background: var(--bg-3); color: var(--text-1); }

.aip-cwd-error {
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--st-limited);
}

/* ── Radio row (Shell) ── */

.aip-radio-row { display: flex; gap: 8px; flex-wrap: wrap; }
.aip-radio {
  display: inline-flex; align-items: center; gap: 8px;
  background: var(--bg-1); border: 1px solid var(--border-1);
  border-radius: 6px; padding: 7px 12px;
  font-family: var(--font-mono); font-size: 12px;
  color: var(--text-2);
  cursor: pointer;
}
.aip-radio:hover { background: var(--bg-2); color: var(--text-1); }
.aip-radio:focus-visible {
  outline: 0;
  box-shadow: 0 0 0 3px var(--accent-soft);
  border-color: var(--accent);
}
.aip-radio--active {
  background: var(--bg-2); border-color: var(--accent); color: var(--text-1);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.aip-radio__dot {
  width: 10px; height: 10px; border-radius: 50%;
  border: 1.5px solid var(--text-4);
  position: relative; flex-shrink: 0;
}
.aip-radio--active .aip-radio__dot { border-color: var(--accent); }
.aip-radio--active .aip-radio__dot::after {
  content: ''; position: absolute; inset: 1px;
  background: var(--accent); border-radius: 50%;
}

/* ── Footer buttons ── */

.aip-btn {
  border-radius: 6px; padding: 7px 14px;
  font-family: var(--font-sans); font-size: 12.5px;
  cursor: pointer; border: none;
}
.aip-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.aip-btn--ghost {
  background: transparent;
  color: var(--text-2);
  border: 1px solid var(--border-2);
}
.aip-btn--ghost:hover:not(:disabled) {
  background: var(--bg-3); color: var(--text-1);
}
.aip-btn--primary {
  background: var(--accent);
  color: #0d1117;
  font-weight: 600;
}
.aip-btn--primary:hover:not(:disabled) { filter: brightness(1.08); }
```

- [ ] **Step 2: Smoke-check via the existing dev build**

(No automated style test exists — we visually verify in Task 8 after the dialog uses the classes.)

Run:
```
pnpm --filter @awakon/desktop typecheck
```

Expected: PASS — CSS-only additions don't affect typechecking, but this confirms nothing else regressed.

- [ ] **Step 3: Commit**

```
git add apps/desktop/src/renderer/chrome/styles/chrome.css
git commit -m "feat(chrome): add aip-modal--newsession styles"
```

---

## Task 7: Rewrite `new-session-dialog.ts` (TDD)

This is the largest task. Each step writes a failing test, then the smallest code to make it pass. The renderer file is rewritten incrementally — start with the bare scaffold, then add behaviors.

**Files:**
- Modify: `apps/desktop/src/renderer/chrome/new-session-dialog.ts`
- Create: `apps/desktop/src/renderer/chrome/new-session-dialog.test.ts`

### 7.1 — Scaffolding & header

- [ ] **Step 1: Write the failing scaffold test**

Create `apps/desktop/src/renderer/chrome/new-session-dialog.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showNewSessionDialog } from './new-session-dialog.js';

interface FakeBridge {
  send: ReturnType<typeof vi.fn>;
}

function mountEl(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'dialog-mount';
  document.body.appendChild(el);
  return el;
}

function freshBridge(): FakeBridge {
  const send = vi.fn();
  (window as unknown as { awakon: FakeBridge }).awakon = { send };
  return { send };
}

function setUserAgent(ua: string): void {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

beforeEach(() => {
  document.body.innerHTML = '';
  freshBridge();
  setUserAgent('Windows NT 10.0; Win64; x64');
});

describe('showNewSessionDialog — structure', () => {
  it('mounts an .aip-modal--newsession with header crumb and Start button', () => {
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'pwsh', defaultCwd: 'C:\\Users\\me\\proj' });

    const root = mount.querySelector('.aip-modal--newsession');
    expect(root).not.toBeNull();

    const crumb = root!.querySelector('.aip-modal__crumb');
    const title = root!.querySelector('.aip-modal__title');
    expect(crumb?.textContent).toBe('New session');
    expect(title?.textContent).toBe('Configure');

    const start = root!.querySelector('.aip-btn--primary');
    expect(start?.textContent).toContain('Start session');
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

```
pnpm --filter @awakon/desktop test new-session-dialog
```

Expected: FAIL — the existing dialog still uses `.dialog.dialog-new-session` and `#ns-open`.

- [ ] **Step 3: Rewrite the dialog with the new scaffold**

Replace the **entire** body of `apps/desktop/src/renderer/chrome/new-session-dialog.ts` with:

```ts
import type { Shell } from '@awakon/contracts';
import { IpcChannel } from '@awakon/contracts';

export interface NewSessionResult {
  shell: Shell;
  cwd: string;
}

export interface NewSessionDialogOptions {
  defaultShell: Shell;
  defaultCwd: string;
}

interface Bridge {
  send: (channel: string, payload?: unknown) => Promise<unknown>;
}

interface State {
  shell: Shell;
  cwd: string;
  error: string | null;
}

/**
 * Show the redesigned New Session dialog. Resolves with the user's choice, or
 * null if they cancel. Re-uses a single mount element — opening twice doesn't
 * stack modals.
 */
export function showNewSessionDialog(
  mount: HTMLElement,
  opts: NewSessionDialogOptions,
): Promise<NewSessionResult | null> {
  return new Promise((resolve) => {
    mount.innerHTML = '';
    mount.classList.add('open');

    const state: State = {
      shell: opts.defaultShell,
      cwd: opts.defaultCwd,
      error: null,
    };

    const root = document.createElement('div');
    root.className = 'aip-modal aip-modal--newsession';
    root.innerHTML = `
      <div class="aip-modal__header">
        <div class="aip-modal__header-left">
          <span class="aip-modal__crumb">New session</span>
          <span class="aip-modal__crumb-dot"></span>
          <span class="aip-modal__title">Configure</span>
        </div>
        <button class="aip-modal__close" id="ns-close" title="Close" type="button">×</button>
      </div>
      <div class="aip-modal__body"></div>
      <div class="aip-modal__footer">
        <div class="aip-modal__footer-hint">Press Enter to start  ·  Esc to cancel</div>
        <div class="aip-modal__footer-actions">
          <button class="aip-btn aip-btn--ghost"   id="ns-cancel" type="button">Cancel</button>
          <button class="aip-btn aip-btn--primary" id="ns-start"  type="button">Start session</button>
        </div>
      </div>
    `;
    mount.appendChild(root);

    const cleanup = (result: NewSessionResult | null): void => {
      mount.classList.remove('open');
      mount.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };

    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') { ev.preventDefault(); cleanup(null); }
    };
    document.addEventListener('keydown', onKey);

    root.querySelector<HTMLButtonElement>('#ns-close')!.addEventListener('click', () => cleanup(null));
    root.querySelector<HTMLButtonElement>('#ns-cancel')!.addEventListener('click', () => cleanup(null));
    mount.addEventListener('click', (ev) => {
      if (ev.target === mount) cleanup(null);
    });

    // Subsequent steps wire body content + Start button.
    void state; void IpcChannel; // suppress unused-warning until later steps fill these in
  });
}
```

- [ ] **Step 4: Re-run the test**

```
pnpm --filter @awakon/desktop test new-session-dialog
```

Expected: PASS (1/1).

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/renderer/chrome/new-session-dialog.ts apps/desktop/src/renderer/chrome/new-session-dialog.test.ts
git commit -m "feat(chrome): new-session dialog scaffold (header + footer)"
```

### 7.2 — Working directory section (display + edit + Browse)

- [ ] **Step 1: Write failing tests for path rendering and edit transition**

Append to `new-session-dialog.test.ts`:

```ts
describe('showNewSessionDialog — working directory', () => {
  it('renders the path with parent muted and tail bright (POSIX)', async () => {
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'bash', defaultCwd: '/home/me/work/foo' });

    // First mount starts in edit state and auto-focuses the input. Blur it to enter display state.
    const input = mount.querySelector<HTMLInputElement>('.aip-path-input__field input');
    expect(input).not.toBeNull();
    input!.blur();

    const dim = mount.querySelector('.aip-path-input__field .dim');
    expect(dim?.textContent).toBe('/home/me/work/');
    const fieldText = mount.querySelector('.aip-path-input__field')!.textContent;
    expect(fieldText).toContain('foo');
  });

  it('renders the path with parent muted and tail bright (Windows)', () => {
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'pwsh', defaultCwd: 'C:\\Users\\me\\proj' });
    const input = mount.querySelector<HTMLInputElement>('.aip-path-input__field input')!;
    input.blur();
    const dim = mount.querySelector('.aip-path-input__field .dim');
    expect(dim?.textContent).toBe('C:\\Users\\me\\');
    expect(mount.querySelector('.aip-path-input__field')!.textContent).toContain('proj');
  });

  it('starts in edit state with the input focused and selected', () => {
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'bash', defaultCwd: '/foo' });
    const input = mount.querySelector<HTMLInputElement>('.aip-path-input__field input');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(input!.selectionStart).toBe(0);
    expect(input!.selectionEnd).toBe('/foo'.length);
  });

  it('clicking the display state swaps to edit state and focuses the input', () => {
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'bash', defaultCwd: '/foo' });
    const input = mount.querySelector<HTMLInputElement>('.aip-path-input__field input')!;
    input.blur(); // enter display state

    const field = mount.querySelector<HTMLDivElement>('.aip-path-input__field')!;
    field.click();

    const newInput = mount.querySelector<HTMLInputElement>('.aip-path-input__field input');
    expect(newInput).not.toBeNull();
    expect(document.activeElement).toBe(newInput);
  });
});

describe('showNewSessionDialog — Browse button', () => {
  it('dispatches FsPickDirectory with the current cwd and updates the field on success', async () => {
    const mount = mountEl();
    const bridge = (window as unknown as { awakon: FakeBridge }).awakon;
    bridge.send.mockResolvedValueOnce({ path: '/picked/dir' });

    void showNewSessionDialog(mount, { defaultShell: 'bash', defaultCwd: '/start' });
    const browse = mount.querySelector<HTMLButtonElement>('.aip-path-input__browse')!;
    browse.click();

    // Wait for the async update.
    await new Promise((r) => setTimeout(r, 0));

    expect(bridge.send).toHaveBeenCalledWith('core.fs.pick-directory', { startPath: '/start' });
    const input = mount.querySelector<HTMLInputElement>('.aip-path-input__field input')!;
    expect(input.value).toBe('/picked/dir');
  });

  it('leaves the field unchanged when the user cancels', async () => {
    const mount = mountEl();
    const bridge = (window as unknown as { awakon: FakeBridge }).awakon;
    bridge.send.mockResolvedValueOnce({ cancelled: true });

    void showNewSessionDialog(mount, { defaultShell: 'bash', defaultCwd: '/start' });
    mount.querySelector<HTMLButtonElement>('.aip-path-input__browse')!.click();
    await new Promise((r) => setTimeout(r, 0));

    const input = mount.querySelector<HTMLInputElement>('.aip-path-input__field input')!;
    expect(input.value).toBe('/start');
  });
});
```

- [ ] **Step 2: Run the tests — confirm they fail**

```
pnpm --filter @awakon/desktop test new-session-dialog
```

Expected: FAIL (the working-directory body doesn't exist yet).

- [ ] **Step 3: Implement the working-directory section**

Edit `apps/desktop/src/renderer/chrome/new-session-dialog.ts`. Inside `showNewSessionDialog`, after `mount.appendChild(root);` and before `const cleanup = ...`, insert:

```ts
    const bridge = (window as unknown as { awakon: Bridge }).awakon;
    const body = root.querySelector<HTMLDivElement>('.aip-modal__body')!;

    // ── Working directory section ───────────────────────────────────
    const wdSection = document.createElement('div');
    wdSection.className = 'aip-modal__section';
    wdSection.innerHTML = `
      <div class="aip-label">Working directory</div>
      <div class="aip-path-input">
        <div class="aip-path-input__field" id="ns-cwd-field"></div>
        <button class="aip-path-input__browse" id="ns-browse" type="button">
          <span>🗁</span><span>Browse…</span>
        </button>
      </div>
      <div class="aip-cwd-error" id="ns-cwd-error" hidden></div>
    `;
    body.appendChild(wdSection);

    const pathInput = wdSection.querySelector<HTMLDivElement>('.aip-path-input')!;
    const pathField = wdSection.querySelector<HTMLDivElement>('#ns-cwd-field')!;
    const errEl = wdSection.querySelector<HTMLDivElement>('#ns-cwd-error')!;

    function clearError(): void {
      if (state.error === null) return;
      state.error = null;
      pathInput.classList.remove('aip-path-input--invalid');
      errEl.hidden = true;
    }

    function showError(msg: string): void {
      state.error = msg;
      pathInput.classList.add('aip-path-input--invalid');
      errEl.textContent = msg;
      errEl.hidden = false;
    }

    function splitPath(p: string): { head: string; tail: string } {
      const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
      if (idx < 0) return { head: '', tail: p };
      return { head: p.slice(0, idx + 1), tail: p.slice(idx + 1) };
    }

    function renderDisplay(): void {
      const { head, tail } = splitPath(state.cwd);
      pathField.replaceChildren();
      if (head) {
        const dim = document.createElement('span');
        dim.className = 'dim';
        dim.textContent = head;
        pathField.appendChild(dim);
      }
      pathField.append(tail);
    }

    function renderEdit(opts: { focus: boolean; select?: boolean }): void {
      pathField.replaceChildren();
      const input = document.createElement('input');
      input.type = 'text';
      input.value = state.cwd;
      input.addEventListener('input', () => {
        state.cwd = input.value;
        clearError();
        startBtn.disabled = state.cwd.trim().length === 0;
      });
      input.addEventListener('blur', () => {
        if (state.cwd.trim().length === 0) {
          // Stay in edit state if empty — display state of "" is jarring.
          return;
        }
        renderDisplay();
      });
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          void submit();
        }
      });
      pathField.appendChild(input);
      if (opts.focus) input.focus();
      if (opts.select) input.select();
    }

    pathField.addEventListener('click', (ev) => {
      // Don't re-mount the input if we clicked inside the existing input.
      if ((ev.target as HTMLElement).tagName === 'INPUT') return;
      renderEdit({ focus: true });
    });

    wdSection.querySelector<HTMLButtonElement>('#ns-browse')!.addEventListener('click', () => {
      void (async () => {
        try {
          const resp = await bridge.send(IpcChannel.FsPickDirectory, { startPath: state.cwd });
          const r = resp as { path?: string; cancelled?: true };
          if (r && typeof r.path === 'string') {
            state.cwd = r.path;
            clearError();
            renderEdit({ focus: false });
            startBtn.disabled = state.cwd.trim().length === 0;
          }
        } catch (err) {
          console.warn('[new-session] Browse failed:', err);
        }
      })();
    });
```

Then near the bottom of `showNewSessionDialog`, before the trailing `void state; void IpcChannel;` (which you'll delete), add forward declarations for the helpers we'll wire in 7.4 and the initial mount step:

```ts
    // ── Start button + submit (filled in by 7.4) ────────────────────
    const startBtn = root.querySelector<HTMLButtonElement>('#ns-start')!;
    startBtn.disabled = state.cwd.trim().length === 0;
    async function submit(): Promise<void> {
      // Filled in by Task 7.4.
    }

    // Initial mount: edit state, focused + selected.
    renderEdit({ focus: true, select: true });
```

Delete the `void state; void IpcChannel;` line — the references are now real uses.

- [ ] **Step 4: Re-run the tests**

```
pnpm --filter @awakon/desktop test new-session-dialog
```

Expected: PASS for the new working-directory tests; the earlier structure test continues to pass.

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/renderer/chrome/new-session-dialog.ts apps/desktop/src/renderer/chrome/new-session-dialog.test.ts
git commit -m "feat(chrome): new-session dialog working-directory section"
```

### 7.3 — Shell radio row (OS-filtered)

- [ ] **Step 1: Write failing tests for the radio row**

Append to `new-session-dialog.test.ts`:

```ts
describe('showNewSessionDialog — shell radio row', () => {
  it('shows pwsh.exe / cmd.exe / git-bash on Windows', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'pwsh', defaultCwd: '/x' });
    const labels = [...mount.querySelectorAll('.aip-radio')].map((r) => r.textContent!.trim());
    expect(labels).toEqual(['pwsh.exe', 'cmd.exe', 'git-bash']);
  });

  it('shows zsh / bash on macOS', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'zsh', defaultCwd: '/x' });
    const labels = [...mount.querySelectorAll('.aip-radio')].map((r) => r.textContent!.trim());
    expect(labels).toEqual(['zsh', 'bash']);
  });

  it('shows bash / zsh on Linux', () => {
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64)');
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'bash', defaultCwd: '/x' });
    const labels = [...mount.querySelectorAll('.aip-radio')].map((r) => r.textContent!.trim());
    expect(labels).toEqual(['bash', 'zsh']);
  });

  it('marks the default shell active', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'cmd', defaultCwd: '/x' });
    const active = mount.querySelector('.aip-radio--active');
    expect(active?.textContent).toContain('cmd.exe');
  });

  it('switches active on click', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'pwsh', defaultCwd: '/x' });
    const radios = mount.querySelectorAll<HTMLElement>('.aip-radio');
    radios[2]!.click();   // git-bash
    expect(radios[0]!.classList.contains('aip-radio--active')).toBe(false);
    expect(radios[2]!.classList.contains('aip-radio--active')).toBe(true);
  });

  it('ArrowRight moves selection forward', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'pwsh', defaultCwd: '/x' });
    const radios = mount.querySelectorAll<HTMLElement>('.aip-radio');
    radios[0]!.focus();
    radios[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(radios[1]!.classList.contains('aip-radio--active')).toBe(true);
    expect(document.activeElement).toBe(radios[1]);
  });

  it('ArrowLeft from first wraps to last', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'pwsh', defaultCwd: '/x' });
    const radios = mount.querySelectorAll<HTMLElement>('.aip-radio');
    radios[0]!.focus();
    radios[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(radios[radios.length - 1]!.classList.contains('aip-radio--active')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests — confirm they fail**

```
pnpm --filter @awakon/desktop test new-session-dialog
```

Expected: FAIL — no shell section is rendered yet.

- [ ] **Step 3: Implement the shell radio row**

In `new-session-dialog.ts`, after the working-directory section block (i.e. after the Browse handler) and before the start-button block, add:

```ts
    // ── Shell section ───────────────────────────────────────────────
    interface ShellOpt { value: Shell; label: string; }
    function detectShells(): ShellOpt[] {
      const ua = navigator.userAgent;
      if (ua.includes('Windows')) return [
        { value: 'pwsh',     label: 'pwsh.exe' },
        { value: 'cmd',      label: 'cmd.exe'  },
        { value: 'git-bash', label: 'git-bash' },
      ];
      if (ua.includes('Mac OS')) return [
        { value: 'zsh',  label: 'zsh'  },
        { value: 'bash', label: 'bash' },
      ];
      return [
        { value: 'bash', label: 'bash' },
        { value: 'zsh',  label: 'zsh'  },
      ];
    }
    const shellOpts = detectShells();

    // If defaultShell isn't available on this OS, fall back to the first option.
    if (!shellOpts.some((o) => o.value === state.shell)) {
      state.shell = shellOpts[0]!.value;
    }

    const shellSection = document.createElement('div');
    shellSection.className = 'aip-modal__section';
    shellSection.innerHTML = `
      <div class="aip-label">Shell</div>
      <div class="aip-radio-row" role="radiogroup" aria-label="Shell"></div>
    `;
    body.appendChild(shellSection);
    const radioRow = shellSection.querySelector<HTMLDivElement>('.aip-radio-row')!;

    function renderRadios(): void {
      radioRow.replaceChildren();
      shellOpts.forEach((opt, i) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'aip-radio' + (state.shell === opt.value ? ' aip-radio--active' : '');
        el.setAttribute('role', 'radio');
        el.setAttribute('aria-checked', state.shell === opt.value ? 'true' : 'false');
        // Single tab stop: only the active radio is tabbable.
        el.tabIndex = state.shell === opt.value ? 0 : -1;
        el.innerHTML = `<span class="aip-radio__dot"></span><span>${opt.label}</span>`;
        el.addEventListener('click', () => selectShell(i));
        el.addEventListener('keydown', (ev) => onRadioKey(ev, i));
        radioRow.appendChild(el);
      });
    }

    function selectShell(index: number): void {
      const opt = shellOpts[index];
      if (!opt) return;
      state.shell = opt.value;
      renderRadios();
      const radios = radioRow.querySelectorAll<HTMLElement>('.aip-radio');
      radios[index]?.focus();
    }

    function onRadioKey(ev: KeyboardEvent, index: number): void {
      const last = shellOpts.length - 1;
      switch (ev.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          ev.preventDefault();
          selectShell(index === last ? 0 : index + 1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          ev.preventDefault();
          selectShell(index === 0 ? last : index - 1);
          break;
        case 'Home':
          ev.preventDefault();
          selectShell(0);
          break;
        case 'End':
          ev.preventDefault();
          selectShell(last);
          break;
        case 'Enter':
          ev.preventDefault();
          void submit();
          break;
      }
    }

    renderRadios();
```

- [ ] **Step 4: Re-run the tests**

```
pnpm --filter @awakon/desktop test new-session-dialog
```

Expected: PASS for all radio-row tests.

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/renderer/chrome/new-session-dialog.ts apps/desktop/src/renderer/chrome/new-session-dialog.test.ts
git commit -m "feat(chrome): new-session dialog shell radio row"
```

### 7.4 — Submit + cwd validation

- [ ] **Step 1: Write failing tests for submit**

Append to `new-session-dialog.test.ts`:

```ts
describe('showNewSessionDialog — submit', () => {
  it('resolves with { shell, cwd } when cwd is a real directory', async () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const mount = mountEl();
    const bridge = (window as unknown as { awakon: FakeBridge }).awakon;
    bridge.send.mockResolvedValueOnce({ exists: true, isDirectory: true });

    const p = showNewSessionDialog(mount, { defaultShell: 'pwsh', defaultCwd: 'C:\\Users\\me' });
    mount.querySelector<HTMLButtonElement>('#ns-start')!.click();
    const result = await p;

    expect(bridge.send).toHaveBeenCalledWith('core.fs.path-exists', { path: 'C:\\Users\\me' });
    expect(result).toEqual({ shell: 'pwsh', cwd: 'C:\\Users\\me' });
  });

  it('stays open and shows "directory not found" when cwd is missing', async () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const mount = mountEl();
    const bridge = (window as unknown as { awakon: FakeBridge }).awakon;
    bridge.send.mockResolvedValueOnce({ exists: false, isDirectory: false });

    void showNewSessionDialog(mount, { defaultShell: 'pwsh', defaultCwd: 'C:\\nope' });
    mount.querySelector<HTMLButtonElement>('#ns-start')!.click();
    await new Promise((r) => setTimeout(r, 0));

    const err = mount.querySelector<HTMLDivElement>('#ns-cwd-error');
    expect(err?.hidden).toBe(false);
    expect(err?.textContent).toBe('directory not found');
    expect(mount.querySelector('.aip-path-input--invalid')).not.toBeNull();
    // Dialog still mounted.
    expect(mount.querySelector('.aip-modal--newsession')).not.toBeNull();
  });

  it('shows "not a directory" when cwd is a file', async () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const mount = mountEl();
    const bridge = (window as unknown as { awakon: FakeBridge }).awakon;
    bridge.send.mockResolvedValueOnce({ exists: true, isDirectory: false });

    void showNewSessionDialog(mount, { defaultShell: 'pwsh', defaultCwd: 'C:\\file.txt' });
    mount.querySelector<HTMLButtonElement>('#ns-start')!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(mount.querySelector<HTMLDivElement>('#ns-cwd-error')?.textContent).toBe('not a directory');
  });

  it('clears the error when the user starts editing', async () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const mount = mountEl();
    const bridge = (window as unknown as { awakon: FakeBridge }).awakon;
    bridge.send.mockResolvedValueOnce({ exists: false, isDirectory: false });

    void showNewSessionDialog(mount, { defaultShell: 'pwsh', defaultCwd: 'C:\\nope' });
    mount.querySelector<HTMLButtonElement>('#ns-start')!.click();
    await new Promise((r) => setTimeout(r, 0));

    const input = mount.querySelector<HTMLInputElement>('.aip-path-input__field input')!;
    input.value = 'C:\\better';
    input.dispatchEvent(new Event('input'));

    expect(mount.querySelector<HTMLDivElement>('#ns-cwd-error')?.hidden).toBe(true);
    expect(mount.querySelector('.aip-path-input--invalid')).toBeNull();
  });

  it('disables Start when cwd is empty', () => {
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'pwsh', defaultCwd: '' });
    expect(mount.querySelector<HTMLButtonElement>('#ns-start')!.disabled).toBe(true);
  });
});

describe('showNewSessionDialog — cancel paths', () => {
  it('resolves null on Escape', async () => {
    const mount = mountEl();
    const p = showNewSessionDialog(mount, { defaultShell: 'bash', defaultCwd: '/x' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(p).resolves.toBeNull();
    expect(mount.querySelector('.aip-modal--newsession')).toBeNull();
  });

  it('resolves null on Cancel button', async () => {
    const mount = mountEl();
    const p = showNewSessionDialog(mount, { defaultShell: 'bash', defaultCwd: '/x' });
    mount.querySelector<HTMLButtonElement>('#ns-cancel')!.click();
    await expect(p).resolves.toBeNull();
  });

  it('resolves null on scrim click', async () => {
    const mount = mountEl();
    const p = showNewSessionDialog(mount, { defaultShell: 'bash', defaultCwd: '/x' });
    mount.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await expect(p).resolves.toBeNull();
  });

  it('resolves null on close ×', async () => {
    const mount = mountEl();
    const p = showNewSessionDialog(mount, { defaultShell: 'bash', defaultCwd: '/x' });
    mount.querySelector<HTMLButtonElement>('#ns-close')!.click();
    await expect(p).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests — confirm they fail**

```
pnpm --filter @awakon/desktop test new-session-dialog
```

Expected: FAIL — `submit()` is still a stub.

- [ ] **Step 3: Implement `submit()` and wire the Start button**

In `new-session-dialog.ts`, replace the placeholder `submit()` and Start-button wiring block with:

```ts
    // ── Start button + submit ───────────────────────────────────────
    const startBtn = root.querySelector<HTMLButtonElement>('#ns-start')!;
    startBtn.disabled = state.cwd.trim().length === 0;
    startBtn.addEventListener('click', () => { void submit(); });

    let submitting = false;
    async function submit(): Promise<void> {
      const cwd = state.cwd.trim();
      if (cwd.length === 0 || submitting) return;
      submitting = true;
      startBtn.disabled = true;
      try {
        const resp = await bridge.send(IpcChannel.FsPathExists, { path: cwd });
        const r = resp as { exists: boolean; isDirectory: boolean };
        if (!r.exists) {
          showError('directory not found');
          return;
        }
        if (!r.isDirectory) {
          showError('not a directory');
          return;
        }
        cleanup({ shell: state.shell, cwd });
      } catch (err) {
        console.warn('[new-session] cwd check failed:', err);
        showError('directory not found');
      } finally {
        submitting = false;
        startBtn.disabled = state.cwd.trim().length === 0;
      }
    }

    // Initial mount: edit state, focused + selected.
    renderEdit({ focus: true, select: true });
```

(Delete the old placeholder `async function submit()` body and the prior `renderEdit({ focus: true, select: true });` line so there's only one of each.)

- [ ] **Step 4: Re-run the tests**

```
pnpm --filter @awakon/desktop test new-session-dialog
```

Expected: PASS for all submit + cancel tests.

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/renderer/chrome/new-session-dialog.ts apps/desktop/src/renderer/chrome/new-session-dialog.test.ts
git commit -m "feat(chrome): new-session dialog submit + cwd validation"
```

---

## Task 8: Update `multi-tab.spec.ts` e2e selector

The existing test uses `#ns-open` — that ID no longer exists after the rewrite.

**Files:**
- Modify: `tests/e2e/multi-tab.spec.ts`

- [ ] **Step 1: Update the selectors**

In `tests/e2e/multi-tab.spec.ts`, replace lines 28–29:

```ts
  // NewSessionDialog appears and must be visible (not covered by the terminal view).
  await expect(chrome.locator('#ns-open')).toBeVisible();
  await chrome.locator('#ns-open').click();
```

with:

```ts
  // NewSessionDialog appears and must be visible (not covered by the terminal view).
  await expect(chrome.locator('#ns-start')).toBeVisible();
  await chrome.locator('#ns-start').click();
```

- [ ] **Step 2: Run the e2e suite**

```
pnpm --filter @awakon/e2e test
```

Expected: All existing tests still pass. The dialog opens, the user clicks Start, the second tab appears. Note: the default cwd is `$HOME` (set by `LayoutDefaultCwd`), which exists, so the cwd-validation check resolves true and the dialog closes successfully.

If e2e cannot run locally (e.g. node-pty native build), run a typecheck and rely on CI:
```
pnpm --filter @awakon/e2e exec tsc --noEmit -p .
```

- [ ] **Step 3: Commit**

```
git add tests/e2e/multi-tab.spec.ts
git commit -m "test(e2e): update new-session selector to #ns-start"
```

---

## Task 9: Final verification

- [ ] **Step 1: Run the full unit-test suite**

```
pnpm test
```

Expected: all packages green (`@awakon/contracts` has no tests; `@awakon/core` runs schema + session tests; `@awakon/desktop` runs fs-handlers + new-session-dialog tests; `@awakon/integration` runs its existing suites).

- [ ] **Step 2: Run typecheck across the workspace**

```
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Run lint**

```
pnpm lint
```

Expected: clean. Fix any warnings introduced by the new files (most likely unused-imports or `any` flags).

- [ ] **Step 4: Manual smoke**

```
pnpm dev
```

In the app: click `+` on the tab bar. Confirm visually that the dialog matches the design — 620px wide, two sections, Browse button on the right of the path input, Cancel/Start session in the footer. Pick a shell with arrow keys, click Browse, pick a folder, hit Start. The new tab should appear with the chosen shell and cwd. Re-open the dialog and type a non-existent path — Start should show the red border + "directory not found".

- [ ] **Step 5: No-op commit (if any cleanup was needed)**

If steps 1–4 surfaced any small fixes, stage and commit them as one cleanup commit:

```
git add -A
git commit -m "chore: post-implementation cleanup"
```

Otherwise skip.

---

## Spec coverage check

Quick map from spec to tasks:

| Spec requirement | Task |
| --- | --- |
| `'git-bash'` in `ShellSchema` | 1 |
| `FsPickDirectory` / `FsPathExists` channels + schemas | 2 |
| `shellCommand` extension | 3 |
| Renderer unit-test infrastructure | 4 |
| Main-process handler factory + tests | 5 |
| `aip-modal--newsession` styles | 6 |
| Modal header + footer + section structure | 7.1 |
| Path input display/edit + Browse + recents-removed | 7.2 |
| Shell radio row (OS-filtered, ARIA keyboard model) | 7.3 |
| Submit + cwd validation + error states + cancel paths | 7.4 |
| E2E selector update | 8 |
| Final typecheck + lint + manual smoke | 9 |

All renderer unit-test scenarios from the spec's Testing section are covered by tests in Tasks 7.1–7.4. All main-process handler scenarios are covered in Task 5. All contract schema scenarios are covered in Tasks 1–2.
