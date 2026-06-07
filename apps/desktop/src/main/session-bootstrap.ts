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
 */
export async function bootstrapSessions(deps: BootstrapDeps): Promise<string | null> {
  const persisted = await deps.loadPersisted();
  if (!persisted) return null;
  let firstId: string | null = null;
  for (const tab of persisted.tabs) {
    const info = await deps.createTabSession({
      shell: tab.shell,
      cwd: tab.cwd,
      cols: 80,
      rows: 24,
      ...(tab.title ? { title: tab.title } : {}),
      ...(tab.splits ? { splits: tab.splits } : {}),
    });
    if (firstId === null) firstId = info.id;
  }
  return persisted.focusedTabId ?? firstId;
}
