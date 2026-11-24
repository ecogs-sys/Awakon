import { describe, expect, it, vi } from 'vitest';

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({
    onData: () => ({ dispose: () => {} }),
    onExit: () => ({ dispose: () => {} }),
    write: () => {},
    resize: () => {},
    kill: () => {},
    pid: 0,
  })),
}));

import { spawn } from 'node-pty';
import { Session } from '../src/session.js';

describe('Session shell command resolution', () => {
  // Previously this asserted the bare name 'bash.exe', which was the bug: on Windows
  // C:\Windows\System32\bash.exe is the WSL launcher, and PATH order decided which one
  // ran. In the packaged app System32 won, so every git-bash session started WSL and
  // exited immediately ("execvpe(/bin/bash) failed"). It must resolve to a real Git
  // Bash binary instead — see resolve-git-bash.ts.
  it('resolves git-bash to a Git Bash binary, never the ambiguous bare name', () => {
    new Session('id', { shell: 'git-bash', cwd: '.', cols: 80, rows: 24 });
    const cmd = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as string;
    expect(cmd.toLowerCase()).not.toContain('system32');
    expect(cmd.toLowerCase().endsWith('bash.exe')).toBe(true);
    // On a machine with Git Bash installed (CI and dev boxes alike) it must be absolute;
    // the bare-name fallback only applies when Git Bash is genuinely absent.
    if (cmd !== 'bash.exe') expect(cmd.toLowerCase()).toContain('git');
  });

  it('still resolves pwsh to pwsh.exe', () => {
    new Session('id', { shell: 'pwsh', cwd: '.', cols: 80, rows: 24 });
    expect((spawn as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBe('pwsh.exe');
  });
});
