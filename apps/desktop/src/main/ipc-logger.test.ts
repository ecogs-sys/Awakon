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

  it('returns null for --log-ipc= (empty equals form)', () => {
    expect(resolveLogConfig(['--log-ipc='], {})).toBeNull();
  });
});
