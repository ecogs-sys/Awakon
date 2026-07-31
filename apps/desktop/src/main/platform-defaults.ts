import { existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import type { Shell } from '@awakon/contracts';

/** True if `exeName` sits directly inside any directory listed in `pathEnv`
 * (`process.env.PATH`-shaped). No shell/process spawn — a plain directory scan. */
export function commandExistsOnPath(exeName: string, pathEnv: string | undefined): boolean {
  if (!pathEnv) return false;
  return pathEnv.split(delimiter).some((dir) => dir.length > 0 && existsSync(join(dir, exeName)));
}

/** Platform default shell. On win32, PowerShell 7 (`pwsh.exe`) is preferred but is not
 * preinstalled on Windows 10/11 — only Windows PowerShell 5.1 (`powershell.exe`) ships
 * on a stock image. Assuming pwsh breaks first-run on a clean machine (B3), so probe
 * PATH and fall back. */
export function probeDefaultShell(platform: NodeJS.Platform, pathEnv: string | undefined): Shell {
  if (platform === 'win32') return commandExistsOnPath('pwsh.exe', pathEnv) ? 'pwsh' : 'powershell';
  if (platform === 'darwin') return 'zsh';
  return 'bash';
}

/** Under MSIX, the AppUserModelID comes from the package manifest and Electron picks
 * it up automatically — an explicit call is only needed (and correct) for the non-Store
 * NSIS build on Windows (R1). */
export function shouldSetAppUserModelId(platform: NodeJS.Platform, windowsStore: boolean | undefined): boolean {
  return platform === 'win32' && !windowsStore;
}
