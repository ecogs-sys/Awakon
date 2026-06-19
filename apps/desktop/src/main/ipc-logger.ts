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
