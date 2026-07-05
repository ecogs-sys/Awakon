import { fileURLToPath } from 'node:url';
import { isAbsolute, relative } from 'node:path';

/**
 * R7: decide whether a `will-navigate` target should be allowed. Every `file:` URL has
 * origin `"null"`, so comparing origins alone treats any file: -> file: navigation as
 * same-origin regardless of path — a compromised renderer could navigate the window to
 * an arbitrary local file. file: is only allowed when it resolves inside the app's own
 * packaged renderer output (`rendererDir`).
 */
export function isAllowedNavigation(targetUrl: string, currentUrl: string, rendererDir: string): boolean {
  let target: URL;
  let current: URL;
  try {
    target = new URL(targetUrl);
    current = new URL(currentUrl);
  } catch {
    return false;
  }

  const sameOrigin = target.origin === current.origin && target.origin !== 'null';
  if (sameOrigin) return true;
  if (target.protocol !== 'file:') return false;

  // path.relative() across two Windows drive letters returns the target path unchanged
  // (absolute, no leading ".."), so isAbsolute() must also be checked — otherwise a
  // file: URL on a different drive would wrongly pass as "inside" rendererDir.
  let targetPath: string;
  try {
    targetPath = fileURLToPath(target);
  } catch {
    return false;
  }
  const rel = relative(rendererDir, targetPath);
  return !rel.startsWith('..') && !isAbsolute(rel);
}
