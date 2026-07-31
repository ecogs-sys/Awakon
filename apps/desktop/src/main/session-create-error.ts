import type { Shell } from '@awakon/contracts';

/** Builds an actionable dialog.showErrorBox payload for a failed user-initiated
 * session spawn (B3) — a shell the user picked (or a stale recent/duplicate entry)
 * that isn't installed must surface as a message, not a silently-dropped tab. */
export function formatSessionCreateError(shell: Shell, err: unknown): { title: string; message: string } {
  const detail = err instanceof Error ? err.message : String(err);
  return {
    title: 'Could not start session',
    message: `The "${shell}" shell could not be started. It may not be installed on this machine.\n\n${detail}`,
  };
}
