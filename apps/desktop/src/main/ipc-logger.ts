import { closeSync, mkdirSync, openSync, readdirSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { IpcChannel } from '@awakon/contracts';

export interface IpcLogConfig {
  dir: string;
  maxFiles: number;
  maxBytes: number;
}

const DEFAULT_MAX_FILES = 20;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

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
  const n = Number(raw);
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

/** JSON replacer that tolerates circular refs and BigInt so logging never throws on them.
 * Note: the WeakSet tracks all visited objects, not just ancestors, so a value referenced
 * from two sibling keys appears as '[Circular]' on its second occurrence even without a
 * true cycle. Acceptable for a debug log. */
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

/** Append-only, size-rotating JSONL sink with a retention cap. Never throws into callers.
 *
 * Uses synchronous file I/O (openSync/writeSync/closeSync) so that file handles are
 * fully released before enforceRetention runs. On Windows, async stream.end() defers
 * fd.close() to the next event-loop tick; in a tight synchronous log loop we never
 * yield, so unlinkSync would encounter still-open handles and throw EPERM. Sync I/O
 * avoids that race entirely.
 */
export class IpcLogger {
  private readonly stamp = launchStamp();
  private seq = 0;
  private fd: number | null = null;
  private bytes = 0;
  private failed = false;

  constructor(private readonly config: IpcLogConfig) {
    mkdirSync(config.dir, { recursive: true });
    this.openNextFile();
    this.enforceRetention();
  }

  log(entry: IpcLogEntry): void {
    if (this.failed || this.fd === null) return;
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
      if (this.fd === null) { this.failed = true; return; }
      writeSync(this.fd, line);
      this.bytes += size;
    } catch (err) {
      this.failed = true;
      console.warn('[ipc-log] write failed; disabling:', err instanceof Error ? err.message : err);
    }
  }

  close(): Promise<void> {
    if (this.fd !== null) {
      try { closeSync(this.fd); } catch { /* ignore */ }
      this.fd = null;
    }
    return Promise.resolve();
  }

  private rotate(): void {
    if (this.fd !== null) {
      try { closeSync(this.fd); } catch { /* ignore */ }
      this.fd = null;
    }
    this.openNextFile();
    this.enforceRetention();
  }

  private openNextFile(): void {
    this.seq += 1;
    const name = `ipc-${this.stamp}-${String(this.seq).padStart(6, '0')}.jsonl`;
    this.fd = openSync(join(this.config.dir, name), 'a');
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

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown;
}

export interface WebContentsSendLike {
  id?: number;
  send: (channel: string, ...args: unknown[]) => unknown;
}

export interface AppLike {
  on(
    event: 'web-contents-created',
    listener: (event: unknown, contents: WebContentsSendLike) => void,
  ): unknown;
}

interface LoggerLike {
  log(entry: IpcLogEntry): void;
}

const isAppChannel = (channel: string): boolean =>
  channel.startsWith('core.') || channel.startsWith('event.');

function redactPayload(channel: string, payload: unknown): unknown {
  // L4: core.session.write carries everything typed into any terminal, including
  // passwords, base64-encoded. Log its length, never its content. Imported from
  // @awakon/contracts (R9) so a channel rename can't silently disable this redaction.
  if (channel !== IpcChannel.SessionWrite) return payload;
  if (typeof payload !== 'object' || payload === null || !('data' in payload)) return payload;
  const { data, ...rest } = payload as { data: unknown };
  return { ...rest, dataLength: typeof data === 'string' ? data.length : undefined, redacted: true };
}

function senderId(event: unknown): number | undefined {
  const id = (event as { sender?: { id?: number } } | null)?.sender?.id;
  return typeof id === 'number' ? id : undefined;
}

function safeLog(logger: LoggerLike, entry: IpcLogEntry): void {
  try { logger.log(entry); } catch { /* logging must never break IPC */ }
}

/**
 * Capture every application IPC message (channels prefixed `core.`/`event.`).
 *
 * Requests (renderer→main) are caught by monkey-patching `ipcMain.handle`/`.on`.
 * Events (main→renderer) are caught by wrapping each WebContents' `send` as it is
 * created, via `app.on('web-contents-created', …)`. We deliberately do NOT patch
 * `WebContents.prototype.send`: Electron exports `WebContents` only as a type, and the
 * runtime `webContents` namespace object has no usable `.prototype`, so prototype
 * patching silently captures nothing. Per-instance wrapping works regardless of
 * Electron's internal prototype layout and covers the chrome window and every
 * terminal WebContentsView.
 *
 * Must be called BEFORE any handler registers or any window opens. Targets are injected
 * for testability.
 */
export function installIpcInterceptors(
  ipcMain: IpcMainLike,
  app: AppLike,
  logger: LoggerLike,
): void {
  const origHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener): void => {
    if (!isAppChannel(channel)) return origHandle(channel, listener);
    origHandle(channel, async (event: unknown, ...args: unknown[]) => {
      const start = Date.now();
      const payload = redactPayload(channel, args[0]);
      const wcId = senderId(event);
      try {
        const response = await listener(event, ...args);
        safeLog(logger, {
          t: new Date().toISOString(), dir: 'req', channel,
          ...(wcId !== undefined ? { wcId } : {}),
          payload, response, durationMs: Date.now() - start,
        });
        return response;
      } catch (err) {
        safeLog(logger, {
          t: new Date().toISOString(), dir: 'req', channel,
          ...(wcId !== undefined ? { wcId } : {}),
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
      const wcId = senderId(event);
      safeLog(logger, {
        t: new Date().toISOString(), dir: 'req', channel,
        ...(wcId !== undefined ? { wcId } : {}),
        payload: redactPayload(channel, args[0]),
      });
      return listener(event, ...args);
    });
  };

  app.on('web-contents-created', (_event, wc) => {
    const origSend = wc.send.bind(wc);
    wc.send = (channel: string, ...args: unknown[]): unknown => {
      if (isAppChannel(channel)) {
        const wcId = wc.id;
        safeLog(logger, {
          t: new Date().toISOString(), dir: 'event', channel,
          ...(wcId !== undefined ? { wcId } : {}),
          payload: redactPayload(channel, args[0]),
        });
      }
      return origSend(channel, ...args);
    };
  });
}
