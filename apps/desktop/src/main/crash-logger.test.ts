import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CRASH_LOG_FILENAME,
  formatCrashRecord,
  writeCrashRecord,
  installCrashHandlers,
  type CrashKind,
} from './crash-logger.js';

describe('formatCrashRecord', () => {
  it('captures kind, message, and stack for an Error', () => {
    const err = new Error('boom');
    const rec = JSON.parse(formatCrashRecord('uncaughtException', err, new Date('2026-01-01T00:00:00.000Z')));
    expect(rec).toMatchObject({ t: '2026-01-01T00:00:00.000Z', kind: 'uncaughtException', message: 'boom' });
    expect(rec.stack).toContain('boom');
  });

  it('stringifies non-Error rejection reasons with a null stack', () => {
    const rec = JSON.parse(formatCrashRecord('unhandledRejection', 'just a string'));
    expect(rec).toMatchObject({ kind: 'unhandledRejection', message: 'just a string', stack: null });
  });

  it('ends every record with a newline (JSONL)', () => {
    expect(formatCrashRecord('uncaughtException', new Error('x')).endsWith('\n')).toBe(true);
  });

  it('degrades to a placeholder line when the message will not serialize', () => {
    const evil = new Error('bad');
    Object.defineProperty(evil, 'message', { get() { throw new Error('nope'); } });
    const rec = JSON.parse(formatCrashRecord('uncaughtException', evil));
    expect(rec.message).toBe('[unserializable error]');
  });
});

describe('writeCrashRecord', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'crash-log-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('appends a JSONL record and returns the log-file path', async () => {
    const file = writeCrashRecord(dir, 'uncaughtException', new Error('first'));
    expect(file).toBe(join(dir, CRASH_LOG_FILENAME));
    const content = await readFile(file!, 'utf8');
    expect(JSON.parse(content.trim())).toMatchObject({ kind: 'uncaughtException', message: 'first' });
  });

  it('appends (does not overwrite) across multiple crashes', async () => {
    writeCrashRecord(dir, 'uncaughtException', new Error('one'));
    writeCrashRecord(dir, 'unhandledRejection', new Error('two'));
    const lines = (await readFile(join(dir, CRASH_LOG_FILENAME), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!)).toMatchObject({ kind: 'unhandledRejection', message: 'two' });
  });

  it('creates the log directory if it does not exist', async () => {
    const nested = join(dir, 'does', 'not', 'exist');
    const file = writeCrashRecord(nested, 'uncaughtException', new Error('x'));
    expect(file).not.toBeNull();
    await expect(readFile(file!, 'utf8')).resolves.toContain('"x"');
  });

  it('returns null instead of throwing when the write fails', () => {
    // A NUL byte in the path is rejected by the OS on every platform → write fails.
    expect(writeCrashRecord(join(dir, 'bad\0dir'), 'uncaughtException', new Error('x'))).toBeNull();
  });
});

describe('installCrashHandlers', () => {
  let dir: string;
  let dispose: (() => void) | null = null;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'crash-h-')); });
  afterEach(async () => {
    dispose?.();
    dispose = null;
    await rm(dir, { recursive: true, force: true });
  });

  function emit(event: 'uncaughtException' | 'unhandledRejection', arg: unknown): void {
    // Drive the handler directly rather than via a real throw so the test runner's own
    // uncaughtException net is not tripped.
    (process.emit as (name: string, arg: unknown) => boolean)(event, arg);
  }

  it('logs an uncaughtException and invokes notify with the log path', () => {
    const notify = vi.fn();
    dispose = installCrashHandlers({ logDir: dir, notify });
    const err = new Error('kaboom');
    emit('uncaughtException', err);
    expect(notify).toHaveBeenCalledOnce();
    const [kind, reason, logFile] = notify.mock.calls[0] as [CrashKind, unknown, string | null];
    expect(kind).toBe('uncaughtException');
    expect(reason).toBe(err);
    expect(logFile).toBe(join(dir, CRASH_LOG_FILENAME));
  });

  it('logs an unhandledRejection', () => {
    const notify = vi.fn();
    dispose = installCrashHandlers({ logDir: dir, notify });
    emit('unhandledRejection', new Error('async-boom'));
    expect(notify).toHaveBeenCalledWith('unhandledRejection', expect.any(Error), join(dir, CRASH_LOG_FILENAME));
  });

  it('swallows a throwing notify so the handler never re-crashes', () => {
    const notify = vi.fn(() => { throw new Error('notify blew up'); });
    dispose = installCrashHandlers({ logDir: dir, notify });
    expect(() => emit('uncaughtException', new Error('x'))).not.toThrow();
  });

  it('disposer removes both listeners', () => {
    const before = process.listenerCount('uncaughtException');
    const d = installCrashHandlers({ logDir: dir });
    expect(process.listenerCount('uncaughtException')).toBe(before + 1);
    d();
    expect(process.listenerCount('uncaughtException')).toBe(before);
  });
});
