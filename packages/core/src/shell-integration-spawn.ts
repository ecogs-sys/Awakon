import type { Shell } from '@awakon/contracts';
import { PWSH_SHELL_INTEGRATION } from './shell-integration/pwsh.js';

/** Extra spawn arguments that install shell integration, or null when the shell
 *  cannot be instrumented. Pure so it is testable without spawning anything. */
export interface ShellIntegrationSpawn {
  args: string[];
}

/** PowerShell's -EncodedCommand expects base64 of UTF-16LE source. */
export function encodePwshCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/**
 * Spawn arguments that install shell integration for `shell`, or null when the shell
 * has no hook we can use.
 *
 * Unsupported, deliberately:
 *  - `cmd` — no prompt hook and no init-file mechanism. VS Code does not support it
 *    either. Sessions degrade to terminal-mode detection, which still finds apps that
 *    take the alternate screen.
 *  - `wsl` — the inner shell is a Linux process in its own PID namespace; integration
 *    would have to be installed inside the distro, not here.
 *  - `bash`/`zsh`/`git-bash` — Phase 3; return null until their scripts land so the
 *    feature is simply absent rather than half-working.
 */
export function shellIntegrationSpawn(shell: Shell): ShellIntegrationSpawn | null {
  switch (shell) {
    case 'pwsh':
    case 'powershell':
      // -NoExit keeps the session interactive after the injected command runs.
      // Profiles still load (no -NoProfile), so a user's prompt framework is present
      // and our wrapper composes with it.
      return { args: ['-NoExit', '-EncodedCommand', encodePwshCommand(PWSH_SHELL_INTEGRATION)] };
    case 'cmd':
    case 'wsl':
    case 'bash':
    case 'zsh':
    case 'git-bash':
      return null;
  }
}
