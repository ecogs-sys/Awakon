# IPC Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in, full-payload logging of all Awakon IPC traffic to rotating JSONL files, enabled by a `--log-ipc <dir>` flag or `AWAKON_LOG_IPC` env var, for long-running troubleshooting.

**Architecture:** A single new main-process module (`ipc-logger.ts`) provides three pieces: a pure config resolver, a size-rotating JSONL sink with a retention cap, and an installer that monkey-patches `ipcMain.handle`/`ipcMain.on` and `webContents.prototype.send`. The installer is wired into `main/index.ts` before the `IpcRouter` is constructed so every channel is captured automatically. All logging is wrapped in try/catch so it can never break or slow an IPC call.

**Tech Stack:** TypeScript, Node `fs` streams, Electron main process, Vitest (node environment).

**Spec:** `docs/superpowers/specs/2026-06-20-ipc-logging-design.md`

---

## File Structure

- **Create `apps/desktop/src/main/ipc-logger.ts`** — all logging logic. Exports:
  - Types `IpcLogConfig`, `IpcLogEntry`, `IpcMainLike`, `WebContentsSendLike`
  - `resolveLogConfig(argv, env): IpcLogConfig | null` (pure; no I/O, no Electron)
  - `class IpcLogger` (rotating sink; no Electron import)
  - `installIpcInterceptors(ipcMain, webContentsProto, logger): void`
- **Create `apps/desktop/src/main/ipc-logger.test.ts`** — unit tests for all three exports, mirroring the fake-injection style of `fs-handlers.test.ts`.
- **Modify `apps/desktop/src/main/index.ts`** — import the module, resolve config + install interceptors before `new IpcRouter(...)` (currently line 25), and close the logger on `app` quit.

**Run commands (used throughout):**
- Single test file: `pnpm --filter "@awakon/desktop" exec vitest run src/main/ipc-logger.test.ts`
- Typecheck: `pnpm --filter "@awakon/desktop" typecheck`

---

## Task 1: Config resolver (`resolveLogConfig`)

**Files:**
- Create: `apps/desktop/src/main/ipc-logger.ts`
- Test: `apps/desktop/src/main/ipc-logger.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/main/ipc-logger.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveLogConfig } from './ipc-logger.js';

describe('resolveLogConfig', () => {
  it('returns null when neither flag nor env is set', () => {
    expect(resolveLogConfig([], {})).toBeNull();
  });

  it('reads --log-ipc <dir> (space form)', () => {
    expect(resolveLogConfig(['--log-ipc', 'c:\\temp\\ipc'], {})?.dir).toBe('c:\\temp\\ipc');
  });

  it('reads --log-ipc=<dir> (equals form)', () => {
    expect(resolveLogConfig(['--log-ipc=c:\\temp\\ipc'], {})?.dir).toBe('c:\\temp\\ipc');
  });

  it('reads the AWAKON_LOG_IPC env var', () => {
    expect(resolveLogConfig([], { AWAKON_LOG_IPC: '/var/log/ipc' })?.dir).toBe('/var/log/ipc');
  });

  it('prefers the CLI flag over the env var', () => {
    expect(resolveLogConfig(['--log-ipc', '/from-flag'], { AWAKON_LOG_IPC: '/from-env' })?.dir)
      .toBe('/from-flag');
  });

  it('applies default maxFiles and maxBytes', () => {
    expect(resolveLogConfig(['--log-ipc', '/d'], {})).toEqual({
      dir: '/d', maxFiles: 20, maxBytes: 52428800,
    });
  });

  it('honors MAX_FILES / MAX_BYTES overrides', () => {
    expect(resolveLogConfig(['--log-ipc', '/d'], {
      AWAKON_LOG_IPC_MAX_FILES: '5', AWAKON_LOG_IPC_MAX_BYTES: '1024',
    })).toEqual({ dir: '/d', maxFiles: 5, maxBytes: 1024 });
  });

  it('falls back to defaults for non-positive override values', () => {
    expect(resolveLogConfig(['--log-ipc', '/d'], {
      AWAKON_LOG_IPC_MAX_FILES: '0', AWAKON_LOG_IPC_MAX_BYTES: 'nope',
    })).toEqual({ dir: '/d', maxFiles: 20, maxBytes: 52428800 });
  });

  it('returns null when --log-ipc has no value', () => {
    expect(resolveLogConfig(['--log-ipc'], {})).toBeNull();
    expect(resolveLogConfig(['--log-ipc', '--other'], {})).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter "@awakon/desktop" exec vitest run src/main/ipc-logger.test.ts`
Expected: FAIL — `Failed to resolve import "./ipc-logger.js"` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `apps/desktop/src/main/ipc-logger.ts`:

```ts
export interface IpcLogConfig {
  dir: string;
  maxFiles: number;
  maxBytes: number;
}

const DEFAULT_MAX_FILES = 20;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024; // 52428800

function dirFromArgv(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--log-ipc') {
      const next = argv[i + 1];
      return next && !next.startsWith('--') ? next : null;
    }
    if (arg.startsWith('--log-ipc=')) {
      const value = arg.slice('--log-ipc='.length);
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

function positiveIntOr(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Resolve IPC-log config from argv/env. Returns null when logging is not enabled. */
export function resolveLogConfig(
  argv: string[],
  env: NodeJS.ProcessEnv,
): IpcLogConfig | null {
  const dir = dirFromArgv(argv) ?? env['AWAKON_LOG_IPC'] ?? null;
  if (!dir) return null;
  return {
    dir,
    maxFiles: positiveIntOr(env['AWAKON_LOG_IPC_MAX_FILES'], DEFAULT_MAX_FILES),
    maxBytes: positiveIntOr(env['AWAKON_LOG_IPC_MAX_BYTES'], DEFAULT_MAX_BYTES),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter "@awakon/desktop" exec vitest run src/main/ipc-logger.test.ts`
Expected: PASS — all `resolveLogConfig` tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/ipc-logger.ts apps/desktop/src/main/ipc-logger.test.ts
git commit -m "feat(ipc-log): add resolveLogConfig argv/env parser"
```

---

## Task 2: Rotating JSONL sink (`IpcLogger`)

**Files:**
- Modify: `apps/desktop/src/main/ipc-logger.ts`
- Test: `apps/desktop/src/main/ipc-logger.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/desktop/src/main/ipc-logger.test.ts` (add the new imports at the top of the file alongside the existing import line):

```ts
import { afterEach, beforeEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IpcLogger } from './ipc-logger.js';

describe('IpcLogger', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ipc-log-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  async function jsonlFiles(): Promise<string[]> {
    return (await readdir(dir)).filter((f) => /^ipc-.*\.jsonl$/.test(f)).sort();
  }

  it('writes one JSON line per entry', async () => {
    const logger = new IpcLogger({ dir, maxFiles: 20, maxBytes: 1_000_000 });
    logger.log({ t: '2026-01-01T00:00:00.000Z', dir: 'req', channel: 'core.x', payload: { a: 1 } });
    await logger.close();

    const files = await jsonlFiles();
    expect(files).toHaveLength(1);
    const lines = (await readFile(join(dir, files[0]!), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ channel: 'core.x', payload: { a: 1 } });
  });

  it('rotates to a new file past maxBytes', async () => {
    const logger = new IpcLogger({ dir, maxFiles: 20, maxBytes: 200 });
    for (let i = 0; i < 20; i++) {
      logger.log({ t: 't', dir: 'event', channel: 'event.session.data', payload: { data: 'x'.repeat(100) } });
    }
    await logger.close();
    expect((await jsonlFiles()).length).toBeGreaterThan(1);
  });

  it('caps retained files at maxFiles, deleting the oldest', async () => {
    const logger = new IpcLogger({ dir, maxFiles: 2, maxBytes: 100 });
    for (let i = 0; i < 30; i++) {
      logger.log({ t: 't', dir: 'event', channel: 'event.x', payload: { data: 'y'.repeat(80) } });
    }
    await logger.close();
    expect((await jsonlFiles()).length).toBeLessThanOrEqual(2);
  });

  it('never deletes non-matching files in the directory', async () => {
    await writeFile(join(dir, 'keep.txt'), 'important');
    const logger = new IpcLogger({ dir, maxFiles: 1, maxBytes: 50 });
    for (let i = 0; i < 10; i++) {
      logger.log({ t: 't', dir: 'event', channel: 'event.x', payload: { data: 'z'.repeat(60) } });
    }
    await logger.close();
    expect(await readdir(dir)).toContain('keep.txt');
  });

  it('tolerates circular references and still writes valid JSON', async () => {
    const logger = new IpcLogger({ dir, maxFiles: 20, maxBytes: 1_000_000 });
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    logger.log({ t: 't', dir: 'req', channel: 'core.x', payload: circular });
    await logger.close();

    const files = await jsonlFiles();
    const content = (await readFile(join(dir, files[0]!), 'utf8')).trim();
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it('writes a serializeError line when serialization throws', async () => {
    const logger = new IpcLogger({ dir, maxFiles: 20, maxBytes: 1_000_000 });
    const payload = { get boom(): never { throw new Error('nope'); } };
    logger.log({ t: 't', dir: 'req', channel: 'core.x', payload });
    await logger.close();

    const files = await jsonlFiles();
    const parsed = JSON.parse((await readFile(join(dir, files[0]!), 'utf8')).trim());
    expect(parsed.serializeError).toBe(true);
    expect(parsed.channel).toBe('core.x');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter "@awakon/desktop" exec vitest run src/main/ipc-logger.test.ts`
Expected: FAIL — `IpcLogger is not a constructor` / export missing (the `resolveLogConfig` tests still pass).

- [ ] **Step 3: Write the minimal implementation**

Add to the **top** of `apps/desktop/src/main/ipc-logger.ts` (imports) and append the class + helpers below `resolveLogConfig`:

```ts
import { createWriteStream, mkdirSync, readdirSync, unlinkSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';

export interface IpcLogEntry {
  t: string;
  dir: 'req' | 'event';
  channel: string;
  wcId?: number;
  payload?: unknown;
  response?: unknown;
  durationMs?: number;
  error?: string;
}

/** JSON replacer that tolerates circular refs and BigInt so logging never throws on them. */
function safeReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();
  return (_key, value) => {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  };
}

function launchStamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Append-only, size-rotating JSONL sink with a retention cap. Never throws into callers. */
export class IpcLogger {
  private readonly stamp = launchStamp();
  private seq = 0;
  private stream: WriteStream | null = null;
  private bytes = 0;
  private failed = false;

  constructor(private readonly config: IpcLogConfig) {
    mkdirSync(config.dir, { recursive: true });
    this.openNextFile();
  }

  log(entry: IpcLogEntry): void {
    if (this.failed || !this.stream) return;
    let line: string;
    try {
      line = JSON.stringify(entry, safeReplacer()) + '\n';
    } catch {
      line = JSON.stringify({
        t: entry.t, dir: entry.dir, channel: entry.channel, serializeError: true,
      }) + '\n';
    }
    try {
      const size = Buffer.byteLength(line);
      if (this.bytes > 0 && this.bytes + size > this.config.maxBytes) this.rotate();
      this.stream!.write(line);
      this.bytes += size;
    } catch (err) {
      this.failed = true;
      console.warn('[ipc-log] write failed; disabling:', err instanceof Error ? err.message : err);
    }
  }

  close(): Promise<void> {
    const s = this.stream;
    this.stream = null;
    if (!s) return Promise.resolve();
    return new Promise((resolve) => s.end(() => resolve()));
  }

  private rotate(): void {
    this.stream?.end();
    this.openNextFile();
    this.enforceRetention();
  }

  private openNextFile(): void {
    this.seq += 1;
    const name = `ipc-${this.stamp}-${String(this.seq).padStart(3, '0')}.jsonl`;
    this.stream = createWriteStream(join(this.config.dir, name), { flags: 'a' });
    this.bytes = 0;
  }

  private enforceRetention(): void {
    try {
      const files = readdirSync(this.config.dir)
        .filter((f) => /^ipc-.*\.jsonl$/.test(f))
        .sort();
      const excess = files.length - this.config.maxFiles;
      for (let i = 0; i < excess; i++) unlinkSync(join(this.config.dir, files[i]!));
    } catch {
      // retention is best-effort; never throw into the IPC path
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter "@awakon/desktop" exec vitest run src/main/ipc-logger.test.ts`
Expected: PASS — all `IpcLogger` and `resolveLogConfig` tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/ipc-logger.ts apps/desktop/src/main/ipc-logger.test.ts
git commit -m "feat(ipc-log): add rotating JSONL sink with retention cap"
```

---

## Task 3: Interceptor installer (`installIpcInterceptors`)

**Files:**
- Modify: `apps/desktop/src/main/ipc-logger.ts`
- Test: `apps/desktop/src/main/ipc-logger.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/desktop/src/main/ipc-logger.test.ts` (add `vi` to the existing `vitest` import, and import the new symbols):

```ts
import { vi } from 'vitest';
import { installIpcInterceptors, type IpcLogEntry } from './ipc-logger.js';

function fakeLogger(): { entries: IpcLogEntry[]; log: (e: IpcLogEntry) => void } {
  const entries: IpcLogEntry[] = [];
  return { entries, log: (e) => { entries.push(e); } };
}

type Listener = (event: unknown, ...args: unknown[]) => unknown;

describe('installIpcInterceptors', () => {
  it('logs a request entry with payload, response, and duration', async () => {
    const handlers = new Map<string, Listener>();
    const ipcMain = {
      handle: (c: string, l: Listener) => { handlers.set(c, l); },
      on: (c: string, l: Listener) => { handlers.set(c, l); },
    };
    const logger = fakeLogger();
    installIpcInterceptors(ipcMain, { send: () => undefined }, logger);

    // App registers its handler AFTER interceptors are installed.
    ipcMain.handle('core.session.create', async () => ({ id: 's1' }));
    const result = await handlers.get('core.session.create')!({ sender: { id: 7 } }, { shell: 'bash' });

    expect(result).toEqual({ id: 's1' });
    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      dir: 'req', channel: 'core.session.create', wcId: 7,
      payload: { shell: 'bash' }, response: { id: 's1' },
    });
    expect(typeof logger.entries[0]!.durationMs).toBe('number');
  });

  it('logs an error entry and re-throws when the handler throws', async () => {
    const handlers = new Map<string, Listener>();
    const ipcMain = {
      handle: (c: string, l: Listener) => { handlers.set(c, l); },
      on: vi.fn(),
    };
    const logger = fakeLogger();
    installIpcInterceptors(ipcMain, { send: () => undefined }, logger);
    ipcMain.handle('core.session.write', async () => { throw new Error('boom'); });

    await expect(handlers.get('core.session.write')!({ sender: { id: 1 } }, { x: 1 }))
      .rejects.toThrow('boom');
    expect(logger.entries[0]).toMatchObject({
      dir: 'req', channel: 'core.session.write', error: 'boom',
    });
  });

  it('ignores non-application channels on handle', async () => {
    const handlers = new Map<string, Listener>();
    const ipcMain = {
      handle: (c: string, l: Listener) => { handlers.set(c, l); },
      on: vi.fn(),
    };
    const logger = fakeLogger();
    installIpcInterceptors(ipcMain, { send: () => undefined }, logger);
    ipcMain.handle('some.internal.channel', async () => 'ok');
    await handlers.get('some.internal.channel')!({}, {});
    expect(logger.entries).toHaveLength(0);
  });

  it('logs an event entry on webContents.send for an app channel only', () => {
    const sent: Array<[string, unknown]> = [];
    const proto = {
      id: 42,
      send(channel: string, payload: unknown): void { sent.push([channel, payload]); },
    };
    const ipcMain = { handle: vi.fn(), on: vi.fn() };
    const logger = fakeLogger();
    installIpcInterceptors(ipcMain, proto, logger);

    proto.send('event.session.data', { sessionId: 's', data: 'AA==' });
    proto.send('devtools-internal', { x: 1 });

    expect(sent).toHaveLength(2); // original send invoked for both
    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      dir: 'event', channel: 'event.session.data', wcId: 42,
      payload: { sessionId: 's', data: 'AA==' },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter "@awakon/desktop" exec vitest run src/main/ipc-logger.test.ts`
Expected: FAIL — `installIpcInterceptors` is not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to `apps/desktop/src/main/ipc-logger.ts`:

```ts
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown;
}

export interface WebContentsSendLike {
  id?: number;
  send: (channel: string, ...args: unknown[]) => unknown;
}

interface LoggerLike {
  log(entry: IpcLogEntry): void;
}

const isAppChannel = (channel: string): boolean =>
  channel.startsWith('core.') || channel.startsWith('event.');

function senderId(event: unknown): number | undefined {
  const id = (event as { sender?: { id?: number } } | null)?.sender?.id;
  return typeof id === 'number' ? id : undefined;
}

function safeLog(logger: LoggerLike, entry: IpcLogEntry): void {
  try { logger.log(entry); } catch { /* logging must never break IPC */ }
}

/**
 * Monkey-patch ipcMain.handle/.on and webContents.prototype.send so every application
 * IPC message (channels prefixed `core.`/`event.`) is captured. Must be called BEFORE any
 * handler registers or any window opens. Targets are injected for testability.
 */
export function installIpcInterceptors(
  ipcMain: IpcMainLike,
  webContentsProto: WebContentsSendLike,
  logger: LoggerLike,
): void {
  const origHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener): void => {
    if (!isAppChannel(channel)) return origHandle(channel, listener);
    origHandle(channel, async (event: unknown, ...args: unknown[]) => {
      const start = Date.now();
      const payload = args[0];
      const wcId = senderId(event);
      try {
        const response = await listener(event, ...args);
        safeLog(logger, {
          t: new Date().toISOString(), dir: 'req', channel, wcId,
          payload, response, durationMs: Date.now() - start,
        });
        return response;
      } catch (err) {
        safeLog(logger, {
          t: new Date().toISOString(), dir: 'req', channel, wcId,
          payload, durationMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    });
  };

  const origOn = ipcMain.on.bind(ipcMain);
  ipcMain.on = (channel, listener): unknown => {
    if (!isAppChannel(channel)) return origOn(channel, listener);
    return origOn(channel, (event: unknown, ...args: unknown[]) => {
      safeLog(logger, {
        t: new Date().toISOString(), dir: 'req', channel,
        wcId: senderId(event), payload: args[0],
      });
      return listener(event, ...args);
    });
  };

  const origSend = webContentsProto.send;
  webContentsProto.send = function (
    this: { id?: number },
    channel: string,
    ...args: unknown[]
  ): unknown {
    if (isAppChannel(channel)) {
      safeLog(logger, {
        t: new Date().toISOString(), dir: 'event', channel,
        wcId: this?.id, payload: args[0],
      });
    }
    return origSend.apply(this, [channel, ...args]);
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter "@awakon/desktop" exec vitest run src/main/ipc-logger.test.ts`
Expected: PASS — all three describe blocks green.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter "@awakon/desktop" typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/ipc-logger.ts apps/desktop/src/main/ipc-logger.test.ts
git commit -m "feat(ipc-log): add ipcMain + webContents.send interceptors"
```

---

## Task 4: Wire the logger into the main process

**Files:**
- Modify: `apps/desktop/src/main/index.ts`

This task has no unit test (it is module-level wiring of Electron singletons); it is verified by typecheck plus a manual dev run.

- [ ] **Step 1: Add the imports**

In `apps/desktop/src/main/index.ts`, change the Electron import on line 1 to add `webContents` (the lowercase runtime value whose `.prototype.send` we patch):

```ts
import { app, BrowserWindow, Menu, ipcMain, dialog, shell, webContents } from 'electron';
```

Add this import next to the other local `./` imports (after the `registerFsHandlers` import, currently line 13):

```ts
import { resolveLogConfig, IpcLogger, installIpcInterceptors } from './ipc-logger.js';
```

- [ ] **Step 2: Install interceptors before the IpcRouter is built**

In `apps/desktop/src/main/index.ts`, find this block (currently lines 19–25):

```ts
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const sessionManager = new SessionManager();
const ipcRouter = new IpcRouter(ipcMain, sessionManager);
```

Insert the logging setup between the single-instance block and `const sessionManager`, so it becomes:

```ts
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// IPC logging (opt-in via --log-ipc <dir> or AWAKON_LOG_IPC). Installed BEFORE the
// IpcRouter and any window so every ipcMain.handle + webContents.send is captured.
const ipcLogConfig = resolveLogConfig(process.argv, process.env);
let ipcLogger: IpcLogger | null = null;
if (ipcLogConfig) {
  try {
    ipcLogger = new IpcLogger(ipcLogConfig);
    installIpcInterceptors(ipcMain, webContents.prototype, ipcLogger);
    console.log(`[ipc-log] enabled -> ${ipcLogConfig.dir}`);
  } catch (err) {
    console.warn('[ipc-log] disabled:', err instanceof Error ? err.message : err);
    ipcLogger = null;
  }
}

const sessionManager = new SessionManager();
const ipcRouter = new IpcRouter(ipcMain, sessionManager);
```

- [ ] **Step 3: Flush the logger on quit**

In `apps/desktop/src/main/index.ts`, find the final app lifecycle handler (currently lines 547–549):

```ts
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

Add a `quit` handler immediately after it:

```ts
app.on('quit', () => {
  void ipcLogger?.close();
});
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter "@awakon/desktop" typecheck`
Expected: no errors. (Confirms `webContents.prototype` is a valid value and the `installIpcInterceptors` argument types line up.)

- [ ] **Step 5: Run the full desktop test suite**

Run: `pnpm --filter "@awakon/desktop" test`
Expected: PASS — existing tests plus the new `ipc-logger.test.ts` all green (wiring did not break other handlers).

- [ ] **Step 6: Manual smoke test (dev)**

Run the app with logging on and confirm a JSONL file appears and fills:

```bash
# from repo root; on Windows PowerShell use the env-var form:
#   $env:AWAKON_LOG_IPC='C:\temp\ipc'; pnpm --filter "@awakon/desktop" dev
pnpm --filter "@awakon/desktop" dev -- --log-ipc /tmp/awakon-ipc
```

Steps:
1. App launches; console prints `[ipc-log] enabled -> ...`.
2. Open a new session/tab and type a few commands.
3. Confirm `ipc-<timestamp>-001.jsonl` exists in the target dir and contains lines with
   `"dir":"req"` (e.g. `core.session.create`) and `"dir":"event"` (e.g.
   `event.session.data`).
4. Quit the app; confirm no crash and the file is flushed.

Expected: log file present and populated; app behaves identically to a non-logging run.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/index.ts
git commit -m "feat(ipc-log): wire IPC logger into main process"
```

---

## Task 5: Document the feature

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a troubleshooting note**

In `README.md`, add a short subsection (under an existing Troubleshooting or Development section — place it where similar operational notes live) describing the feature:

```markdown
### IPC logging (troubleshooting)

Awakon can record all internal IPC traffic to disk for diagnosing issues over long
sessions. Enable it at startup by pointing it at a directory:

- Flag: `Awakon --log-ipc C:\temp\ipc`
- Env var: `AWAKON_LOG_IPC=C:\temp\ipc`

Logs are written as rotating JSON-lines files (`ipc-<timestamp>-NNN.jsonl`, ~50 MB each).
The directory keeps the most recent 20 files by default (override with
`AWAKON_LOG_IPC_MAX_FILES`); the size threshold is overridable with `AWAKON_LOG_IPC_MAX_BYTES`.

> The log contains full payloads, including terminal output and keystrokes — treat the
> directory as sensitive and clear it when you are done.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document IPC logging flag and env vars"
```

---

## Self-Review Notes

- **Spec coverage:** Activation (Task 1 + 4), interception of both directions with channel filter (Task 3 + 4), rotating JSONL sink + retention cap + safe serialization (Task 2), module layout (Tasks 1–3), wiring before IpcRouter + flush on quit (Task 4), security/docs note (Task 5). All spec sections map to a task.
- **Type consistency:** `IpcLogConfig` (`dir`/`maxFiles`/`maxBytes`) and `IpcLogEntry` (`t`/`dir`/`channel`/`wcId`/`payload`/`response`/`durationMs`/`error`) are defined once in Task 1/2 and reused unchanged in Task 3 tests and Task 4 wiring. `installIpcInterceptors(ipcMain, webContentsProto, logger)` signature matches the call site in Task 4 (`installIpcInterceptors(ipcMain, webContents.prototype, ipcLogger)`).
- **Key risk verified during planning:** the runtime value export is the lowercase `webContents` (`typeof WebContents`), so `webContents.prototype.send` is the correct patch target; Task 4 Step 4 typecheck confirms it.
```
