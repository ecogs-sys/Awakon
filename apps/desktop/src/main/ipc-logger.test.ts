import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveLogConfig, IpcLogger, installIpcInterceptors, type IpcLogEntry } from './ipc-logger.js';

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

  it('returns null for --log-ipc= (empty equals form)', () => {
    expect(resolveLogConfig(['--log-ipc='], {})).toBeNull();
  });
});

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

  it('writes an entry larger than maxBytes without rotating more than once', async () => {
    const logger = new IpcLogger({ dir, maxFiles: 20, maxBytes: 10 });
    logger.log({ t: 't', dir: 'req', channel: 'c', payload: { data: 'x'.repeat(200) } });
    await logger.close();

    const files = await jsonlFiles();
    expect(files).toHaveLength(1);
    const line = (await readFile(join(dir, files[0]!), 'utf8')).trim();
    expect(() => JSON.parse(line)).not.toThrow();
  });
});

function fakeLogger(): { entries: IpcLogEntry[]; log: (e: IpcLogEntry) => void } {
  const entries: IpcLogEntry[] = [];
  return { entries, log: (e) => { entries.push(e); } };
}

type Listener = (event: unknown, ...args: unknown[]) => unknown;

interface WcLike { id?: number; send: (channel: string, ...args: unknown[]) => unknown }

/** A fake Electron `app` that captures the 'web-contents-created' handler so a test can
 * emit a WebContents and assert the interceptor wrapped its `send`. */
function fakeApp(): { on: (e: string, l: (event: unknown, wc: WcLike) => void) => void; emit: (wc: WcLike) => void } {
  let handler: ((event: unknown, wc: WcLike) => void) | null = null;
  return {
    on: (_e, l) => { handler = l; },
    emit: (wc) => handler?.({}, wc),
  };
}

/** No-op `app` for tests that only exercise the ipcMain patches. */
const noopApp = { on: (): void => undefined };

describe('installIpcInterceptors', () => {
  it('logs a request entry with payload, response, and duration', async () => {
    const handlers = new Map<string, Listener>();
    const ipcMain = {
      handle: (c: string, l: Listener) => { handlers.set(c, l); },
      on: (c: string, l: Listener) => { handlers.set(c, l); },
    };
    const logger = fakeLogger();
    installIpcInterceptors(ipcMain, noopApp, logger);

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

  it('redacts core.session.write payload data to a length, never the content (L4)', async () => {
    const handlers = new Map<string, Listener>();
    const ipcMain = {
      handle: (c: string, l: Listener) => { handlers.set(c, l); },
      on: (c: string, l: Listener) => { handlers.set(c, l); },
    };
    const logger = fakeLogger();
    installIpcInterceptors(ipcMain, noopApp, logger);

    ipcMain.handle('core.session.write', async () => ({ ok: true }));
    await handlers.get('core.session.write')!(
      { sender: { id: 1 } },
      { sessionId: 's1', data: Buffer.from('super-secret-password').toString('base64') },
    );

    const entry = logger.entries[0]! as { payload: { sessionId: string; data?: string; dataLength?: number } };
    expect(entry.payload.sessionId).toBe('s1');
    expect(entry.payload.data).toBeUndefined();
    expect(entry.payload.dataLength).toBeGreaterThan(0);
  });

  it('logs an error entry and re-throws when the handler throws', async () => {
    const handlers = new Map<string, Listener>();
    const ipcMain = {
      handle: (c: string, l: Listener) => { handlers.set(c, l); },
      on: vi.fn(),
    };
    const logger = fakeLogger();
    installIpcInterceptors(ipcMain, noopApp, logger);
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
    installIpcInterceptors(ipcMain, noopApp, logger);
    ipcMain.handle('some.internal.channel', async () => 'ok');
    await handlers.get('some.internal.channel')!({}, {});
    expect(logger.entries).toHaveLength(0);
  });

  it('wraps each web-contents-created instance, logging app-channel sends only', () => {
    const app = fakeApp();
    const ipcMain = { handle: vi.fn(), on: vi.fn() };
    const logger = fakeLogger();
    installIpcInterceptors(ipcMain, app, logger);

    // A WebContents born after install — the interceptor must wrap its own `send`.
    const sent: Array<[string, unknown]> = [];
    const wc = {
      id: 42,
      send(channel: string, payload: unknown): void { sent.push([channel, payload]); },
    };
    app.emit(wc);

    wc.send('event.session.data', { sessionId: 's', data: 'AA==' });
    wc.send('devtools-internal', { x: 1 });

    expect(sent).toHaveLength(2); // original send still runs for both channels
    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      dir: 'event', channel: 'event.session.data', wcId: 42,
      payload: { sessionId: 's', data: 'AA==' },
    });
  });

  it('logs a request entry for ipcMain.on listeners and still calls the original', () => {
    const listeners = new Map<string, Listener>();
    let called = false;
    const ipcMain = {
      handle: vi.fn(),
      on: (c: string, l: Listener) => { listeners.set(c, l); },
    };
    const logger = fakeLogger();
    installIpcInterceptors(ipcMain, noopApp, logger);

    ipcMain.on('core.fire', () => { called = true; });
    listeners.get('core.fire')!({ sender: { id: 3 } }, { k: 'v' });

    expect(called).toBe(true);
    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      dir: 'req', channel: 'core.fire', wcId: 3, payload: { k: 'v' },
    });
  });
});
