import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Absolute path to Git for Windows' bash, or 'bash.exe' if it cannot be found.
 *
 * Spawning the bare name `bash.exe` is not safe on Windows: `C:\Windows\System32\bash.exe`
 * is the WSL launcher, and whether it or Git Bash wins depends entirely on PATH order in
 * the spawning process's environment. In Awakon's packaged environment System32 won, so
 * every "git-bash" session actually started WSL and died immediately with:
 *
 *   <3>WSL (9 - Relay) ERROR: CreateProcessCommon:881: execvpe(/bin/bash) failed
 *   [session exited, code=1]
 *
 * Resolving an absolute path removes the ambiguity. `Git\bin\bash.exe` is the launcher
 * intended for external callers (it sets up MSYS environment); `Git\usr\bin\bash.exe` is
 * the raw binary, used as a fallback.
 */
export function resolveGitBashPath(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
): string {
  const roots = [
    env['ProgramFiles'],
    env['ProgramW6432'],
    env['ProgramFiles(x86)'],
    env['LOCALAPPDATA'] ? join(env['LOCALAPPDATA'], 'Programs') : undefined,
  ].filter((r): r is string => typeof r === 'string' && r.length > 0);

  for (const root of roots) {
    for (const rel of [join('Git', 'bin', 'bash.exe'), join('Git', 'usr', 'bin', 'bash.exe')]) {
      const candidate = join(root, rel);
      if (exists(candidate)) return candidate;
    }
  }

  // Not found: fall back to PATH resolution. Worse than an absolute path, but the
  // user may have Git Bash somewhere unusual and ahead of System32 on their PATH.
  return 'bash.exe';
}
