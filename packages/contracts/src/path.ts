/** Last path segment of a cwd, tolerant of both separators and trailing slashes.
 * Shared between core (session default title) and the renderer (tab/sidebar/title-bar
 * labels) so the "which folder is this" convention stays identical everywhere. */
export function cwdBasename(cwd: string): string {
  const parts = cwd.split(/[/\\]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : cwd;
}
