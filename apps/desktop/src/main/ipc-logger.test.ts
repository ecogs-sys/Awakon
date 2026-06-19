import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveLogConfig, IpcLogger } from './ipc-logger.js';

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
