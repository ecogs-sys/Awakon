import { homedir } from 'node:os';
import type { Shell, PersistedTabs, PersistedSplitNode } from '@awakon/contracts';
import type { SessionInfo } from '@awakon/contracts';

export interface BootstrapDeps {
  loadPersisted: () => Promise<PersistedTabs | null>;
  createTabSession: (opts: {
    shell: Shell;
    cwd: string;
    cols: number;
    rows: number;
    title?: string;
    splits?: PersistedSplitNode;
  }) => Promise<SessionInfo>;
}

/**
 * On app start, restore exactly what was saved — and never auto-open a tab:
 *  - A saved layout with tabs → restore them (returns the focused tab id).
 *  - A saved layout with no tabs (user closed everything before quitting) → restore
 *    nothing, returning null so the app boots into the welcome/empty state.
 *  - No saved layout at all (first launch / unreadable file) → also restore nothing;
 *    the user picks New Session or a recent from the welcome screen.
 *
 * The app must never spawn a tab the user didn't ask for, so there is deliberately no
 * fallback that creates a default boot tab.
 *
 * Each tab is restored independently (M5): a tab whose cwd no longer exists (deleted
 * since last run) throws inside createTabSession, but that must not abort the whole
 * restore — the remaining tabs still need to come back.
 *
 * N8: a failed spawn must not erase the tab from the persisted layout. The original
 * failure is often transient (a network/USB volume not yet mounted at login), and
 * every *successful* restore re-snapshots and overwrites sessions.json — a tab that
 * was simply skipped here would be permanently gone from that file before the volume
 * even has a chance to mount. Retry once at $HOME (which always exists) so the tab
 * comes back as a normal, persisted tab; the user can cd back once the volume returns.
 * Only a tab that fails even the $HOME retry (a genuinely broken shell) is skipped.
 */
export async function bootstrapSessions(deps: BootstrapDeps): Promise<string | null> {
  const persisted = await deps.loadPersisted();
  if (!persisted) return null;
  const createdIds: Array<string | null> = [];
  for (const tab of persisted.tabs) {
    const opts = {
      shell: tab.shell,
      cwd: tab.cwd,
      cols: 80,
      rows: 24,
      ...(tab.title ? { title: tab.title } : {}),
      ...(tab.splits ? { splits: tab.splits } : {}),
    };
    try {
      const info = await deps.createTabSession(opts);
      createdIds.push(info.id);
      continue;
    } catch (err) {
      console.warn(`[bootstrap] could not restore tab at ${tab.cwd}:`, err instanceof Error ? err.message : err);
    }
    try {
      const info = await deps.createTabSession({
        ...opts,
        cwd: homedir(),
        title: `${tab.title ?? tab.cwd} (cwd unavailable)`,
      });
      createdIds.push(info.id);
    } catch (err) {
      console.warn(`[bootstrap] fallback spawn at $HOME also failed for tab originally at ${tab.cwd}:`, err instanceof Error ? err.message : err);
      createdIds.push(null);
    }
  }
  // M4: session ids are regenerated every launch, so the persisted focus can only be
  // recovered by position, not by the old id.
  const idx = persisted.focusedTabIndex;
  const atIndex = idx !== null ? createdIds[idx] : undefined;
  if (atIndex) return atIndex;
  return createdIds.find((id): id is string => id !== null) ?? null;
}
