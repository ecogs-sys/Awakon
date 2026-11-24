import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Shell } from '@awakon/contracts';
import { PWSH_SHELL_INTEGRATION } from './shell-integration/pwsh.js';
import { BASH_SHELL_INTEGRATION } from './shell-integration/bash.js';
import { ZSH_SHELL_INTEGRATION } from './shell-integration/zsh.js';

/** Extra spawn arguments/env that install shell integration, or null when the shell
 *  cannot be instrumented. */
export interface ShellIntegrationSpawn {
  args: string[];
  /** Merged over the inherited environment at spawn time. */
  env?: Record<string, string>;
}

/** PowerShell's -EncodedCommand expects base64 of UTF-16LE source. */
export function encodePwshCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/**
 * POSIX shells have no `-EncodedCommand` equivalent — `--init-file` and `ZDOTDIR`
 * both name a path — so the script has to exist on disk. There is no ExecutionPolicy
 * to worry about here, so a temp file is fine.
 *
 * Written once per process and reused: the content never varies, and a file per
 * session would litter temp for long-lived apps. The OS reclaims mkdtemp directories;
 * we deliberately do not unlink at exit, because a crash would then leave running
 * shells pointing at a file that no longer exists.
 */
let cachedDir: string | null = null;
function integrationDir(): string {
  if (cachedDir === null) cachedDir = mkdtempSync(join(tmpdir(), 'awakon-shell-'));
  return cachedDir;
}

const written = new Set<string>();
function ensureFile(name: string, contents: string): string {
  const path = join(integrationDir(), name);
  if (!written.has(path)) {
    writeFileSync(path, contents, 'utf8');
    written.add(path);
  }
  return path;
}

/** Test seam: forget the cached temp dir so a test can assert file creation. */
export function resetShellIntegrationCacheForTest(): void {
  cachedDir = null;
  written.clear();
}

/**
 * Spawn arguments/env that install shell integration for `shell`, or null when the
 * shell has no hook we can use.
 *
 * Unsupported, deliberately:
 *  - `cmd` — no prompt hook and no init-file mechanism. VS Code does not support it
 *    either. Sessions degrade to terminal-mode detection, which still finds apps that
 *    take the alternate screen.
 *  - `wsl` — the inner shell is a Linux process in its own PID namespace; integration
 *    would have to be installed inside the distro, not here.
 */
export function shellIntegrationSpawn(shell: Shell): ShellIntegrationSpawn | null {
  switch (shell) {
    case 'pwsh':
    case 'powershell':
      // -NoExit keeps the session interactive after the injected command runs.
      // Profiles still load (no -NoProfile), so a user's prompt framework is present
      // and our wrapper composes with it.
      return { args: ['-NoExit', '-EncodedCommand', encodePwshCommand(PWSH_SHELL_INTEGRATION)] };

    case 'bash':
    case 'git-bash':
      // --init-file REPLACES ~/.bashrc; the script sources the user's rc itself.
      return { args: ['--init-file', ensureFile('awakon-bash.sh', BASH_SHELL_INTEGRATION)] };

    case 'zsh': {
      // ZDOTDIR redirects zsh to our .zshrc; the original is forwarded so the script
      // can restore it and source the user's own rc.
      const dir = integrationDir();
      ensureFile('.zshrc', ZSH_SHELL_INTEGRATION);
      const env: Record<string, string> = { ZDOTDIR: dir };
      const userZdotdir = process.env['ZDOTDIR'];
      if (userZdotdir) env['AWAKON_USER_ZDOTDIR'] = userZdotdir;
      return { args: [], env };
    }

    case 'cmd':
    case 'wsl':
      return null;
  }
}
