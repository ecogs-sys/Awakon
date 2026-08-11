import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type CrashKind = 'uncaughtException' | 'unhandledRejection';

/** Persistent crash log filename, appended to under the configured log directory. */
export const CRASH_LOG_FILENAME = 'crash.log';

/** Build a single JSONL crash record. Pure and self-contained so it can be unit-tested and
 *  can never throw (a value that fails to serialize degrades to a placeholder line). */
export function formatCrashRecord(kind: CrashKind, err: unknown, now: Date = new Date()): string {
  const t = now.toISOString();
  try {
    // Reading .message/.stack (and String(err)) happens inside the try: a hostile Error
    // whose message getter throws must still produce the placeholder line, not escape.
    const e = err instanceof Error ? err : undefined;
    return JSON.stringify({ t, kind, message: e ? e.message : String(err), stack: e?.stack ?? null }) + '\n';
  } catch {
    return JSON.stringify({ t, kind, message: '[unserializable error]', stack: null }) + '\n';
  }
}

/** Append a crash record to <logDir>/crash.log. Best-effort — never throws (a failed write
 *  returns null). Uses synchronous appendFileSync so the record is flushed before we hand
 *  control back, in case the app exits or crashes again immediately after. Returns the
 *  absolute log-file path on success, or null if the write failed. */
export function writeCrashRecord(logDir: string, kind: CrashKind, err: unknown): string | null {
  const file = join(logDir, CRASH_LOG_FILENAME);
  try {
    mkdirSync(logDir, { recursive: true });
    appendFileSync(file, formatCrashRecord(kind, err));
    return file;
  } catch {
    return null;
  }
}

export interface CrashHandlersConfig {
  /** Directory the crash.log file is written into (e.g. app.getPath('logs')). */
  logDir: string;
  /** Called after a crash is logged. Must never throw. `logFile` is null if the write failed. */
  notify?: (kind: CrashKind, err: unknown, logFile: string | null) => void;
}

/** Install process-level handlers for uncaughtException + unhandledRejection so an
 *  otherwise-silent crash leaves a diagnosable trace on disk.
 *
 *  Registering an 'uncaughtException' listener also suppresses Node's default
 *  print-stack-and-exit behavior, so the app survives an unexpected throw — for example a
 *  native node-pty teardown error on the async pty-exit callback when a tab is closed after
 *  long uptime, which previously killed the whole app with no error and no log. Continuing
 *  after an uncaught exception is a deliberate tradeoff: for a terminal multiplexer, losing
 *  every open session to one stray throw is worse than running on in a possibly-degraded
 *  state. The notify hook surfaces the error so the user can restart if needed.
 *
 *  Returns a disposer that removes both handlers (used by tests). */
export function installCrashHandlers(config: CrashHandlersConfig): () => void {
  const handle = (kind: CrashKind, err: unknown): void => {
    const logFile = writeCrashRecord(config.logDir, kind, err);
    try {
      console.error(`[crash] ${kind}:`, err instanceof Error ? (err.stack ?? err.message) : err);
    } catch {
      // console can fail if stdout has been torn down mid-crash — ignore.
    }
    if (config.notify) {
      try {
        config.notify(kind, err, logFile);
      } catch {
        // notify must never throw back into the handler (that would re-enter uncaughtException).
      }
    }
  };
  const onException = (err: Error): void => handle('uncaughtException', err);
  const onRejection = (reason: unknown): void => handle('unhandledRejection', reason);
  process.on('uncaughtException', onException);
  process.on('unhandledRejection', onRejection);
  return () => {
    process.off('uncaughtException', onException);
    process.off('unhandledRejection', onRejection);
  };
}
