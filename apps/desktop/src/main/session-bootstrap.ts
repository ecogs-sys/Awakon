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
  defaultShell: () => Shell;
  defaultCwd: () => string;
}

/**
 * On app start: try to restore persisted tabs; if none, create the default boot tab.
 * Returns the session id that should be focused (first persisted, or the boot tab).
 */
export async function bootstrapSessions(deps: BootstrapDeps): Promise<string | null> {
  const persisted = await deps.loadPersisted();
  if (persisted && persisted.tabs.length > 0) {
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
  const boot = await deps.createTabSession({
    shell: deps.defaultShell(),
    cwd: deps.defaultCwd(),
    cols: 80,
    rows: 24,
  });
  return boot.id;
}
