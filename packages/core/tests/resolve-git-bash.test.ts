import { describe, expect, it } from 'vitest';
import { resolveGitBashPath } from '../src/resolve-git-bash.js';

describe('resolveGitBashPath()', () => {
  // The bug this exists to prevent: spawning the bare name picked up
  // C:\Windows\System32\bash.exe (the WSL launcher) in the packaged app, so every
  // git-bash session started WSL and exited immediately with code 1.
  it('never returns a System32 path', () => {
    const env = { ProgramFiles: 'C:\\Program Files' };
    const path = resolveGitBashPath(env, (p) => p.includes('Git'));
    expect(path.toLowerCase()).not.toContain('system32');
  });

  it('prefers Git\\bin\\bash.exe under ProgramFiles', () => {
    const env = { ProgramFiles: 'C:\\Program Files' };
    expect(resolveGitBashPath(env, () => true)).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
  });

  it('falls back to usr\\bin when bin is absent', () => {
    const env = { ProgramFiles: 'C:\\Program Files' };
    const exists = (p: string): boolean => p.includes(['usr', 'bin'].join('\\'));
    expect(resolveGitBashPath(env, exists)).toBe('C:\\Program Files\\Git\\usr\\bin\\bash.exe');
  });

  it('searches ProgramW6432 and the x86 root too', () => {
    const env = { 'ProgramFiles(x86)': 'C:\\Program Files (x86)' };
    expect(resolveGitBashPath(env, () => true)).toBe('C:\\Program Files (x86)\\Git\\bin\\bash.exe');
  });

  it('searches a per-user install under LOCALAPPDATA\\Programs', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' };
    expect(resolveGitBashPath(env, () => true)).toBe(
      'C:\\Users\\x\\AppData\\Local\\Programs\\Git\\bin\\bash.exe',
    );
  });

  // Not found anywhere: PATH is worse than an absolute path, but the user may have
  // Git Bash installed somewhere unusual and ahead of System32.
  it('falls back to the bare name when Git Bash is not installed', () => {
    expect(resolveGitBashPath({ ProgramFiles: 'C:\\Program Files' }, () => false)).toBe('bash.exe');
  });

  it('tolerates an environment with none of the roots set', () => {
    expect(resolveGitBashPath({}, () => true)).toBe('bash.exe');
  });
});
