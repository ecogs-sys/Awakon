import { fileURLToPath } from 'node:url';
import { isAbsolute, relative, sep } from 'node:path';

/**
 * Shared path-containment predicate (L2/R7 boundary): is `targetPath` at or inside
 * `baseDir`? Used to gate navigation, doc-open clicks, and doc-restore reads against a
 * tab's own directory.
 *
 * `rel.startsWith('..')` alone (the earlier idiom, copy-pasted at three call sites)
 * false-rejects an in-`baseDir` file literally named e.g. `..plan.md` — `relative()`
 * returns that literal name unchanged, which starts with `..` as a string prefix without
 * being a parent-traversal. Checking for the exact `..` segment (`rel === '..'` or
 * `rel.startsWith('..' + sep)`) avoids that false positive while still rejecting real
 * traversal (N9).
 */
export function isPathInside(baseDir: string, targetPath: string): boolean {
  const rel = relative(baseDir, targetPath);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
}

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
  // (absolute, no leading ".."), so isPathInside's isAbsolute() check matters here —
  // otherwise a file: URL on a different drive would wrongly pass as "inside" rendererDir.
  let targetPath: string;
  try {
    targetPath = fileURLToPath(target);
  } catch {
    return false;
  }
  return isPathInside(rendererDir, targetPath);
}
