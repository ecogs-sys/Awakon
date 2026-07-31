import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { commandExistsOnPath, probeDefaultShell, shouldSetAppUserModelId } from './platform-defaults.js';

describe('commandExistsOnPath', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function makeDirWithFile(fileName: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'awakon-path-test-'));
    writeFileSync(join(dir, fileName), '');
    dirs.push(dir);
    return dir;
  }

  it('finds an executable that sits in one of the PATH directories', () => {
    const dir = makeDirWithFile('pwsh.exe');
    expect(commandExistsOnPath('pwsh.exe', dir)).toBe(true);
  });

  it('returns false when the executable is in none of the PATH directories', () => {
    const dir = makeDirWithFile('cmd.exe');
    expect(commandExistsOnPath('pwsh.exe', dir)).toBe(false);
  });

  it('searches every directory in a multi-entry PATH', () => {
    const empty = mkdtempSync(join(tmpdir(), 'awakon-path-test-'));
    dirs.push(empty);
    const withFile = makeDirWithFile('pwsh.exe');
    expect(commandExistsOnPath('pwsh.exe', [empty, withFile].join(delimiter))).toBe(true);
  });

  it('returns false when PATH is undefined', () => {
    expect(commandExistsOnPath('pwsh.exe', undefined)).toBe(false);
  });
});

describe('probeDefaultShell', () => {
  it('picks pwsh on win32 when pwsh.exe is on PATH', () => {
    const dir = mkdtempSync(join(tmpdir(), 'awakon-path-test-'));
    writeFileSync(join(dir, 'pwsh.exe'), '');
    try {
      expect(probeDefaultShell('win32', dir)).toBe('pwsh');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to powershell on win32 when pwsh.exe is not on PATH (B3)', () => {
    // Windows PowerShell 5.1 (powershell.exe) ships on every stock Windows image;
    // PowerShell 7 (pwsh.exe) does not. A certification tester's clean machine has
    // only the former, so the default must not assume pwsh is present.
    const dir = mkdtempSync(join(tmpdir(), 'awakon-path-test-'));
    try {
      expect(probeDefaultShell('win32', dir)).toBe('powershell');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('always picks zsh on darwin, regardless of PATH', () => {
    expect(probeDefaultShell('darwin', undefined)).toBe('zsh');
  });

  it('always picks bash on linux, regardless of PATH', () => {
    expect(probeDefaultShell('linux', undefined)).toBe('bash');
  });
});

describe('shouldSetAppUserModelId', () => {
  it('is true on win32 outside the Store container (NSIS build)', () => {
    expect(shouldSetAppUserModelId('win32', false)).toBe(true);
    expect(shouldSetAppUserModelId('win32', undefined)).toBe(true);
  });

  it('is false on win32 inside the Store container (MSIX picks up AUMID from the package manifest)', () => {
    expect(shouldSetAppUserModelId('win32', true)).toBe(false);
  });

  it('is false on non-Windows platforms', () => {
    expect(shouldSetAppUserModelId('darwin', false)).toBe(false);
    expect(shouldSetAppUserModelId('linux', false)).toBe(false);
  });
});
