import { describe, expect, it, vi } from 'vitest';
import type { PersistedTabs, SessionInfo } from '@awakon/contracts';
import { bootstrapSessions, type BootstrapDeps } from './session-bootstrap.js';

function makeInfo(id: string): SessionInfo {
  return {
    id, title: id, shell: 'bash', cwd: '/home/me',
    status: 'running', kind: 'tab', pid: 1, exitCode: null,
  };
}

function makeDeps(persisted: PersistedTabs | null): {
  deps: BootstrapDeps;
  createTabSession: ReturnType<typeof vi.fn>;
} {
  let n = 0;
  const createTabSession = vi.fn(async () => makeInfo(`sess-${++n}`));
  const deps: BootstrapDeps = {
    loadPersisted: async () => persisted,
    createTabSession,
  };
  return { deps, createTabSession };
}

describe('bootstrapSessions', () => {
  it('does NOT create a tab on first launch (no persisted layout) — shows the welcome screen', async () => {
    const { deps, createTabSession } = makeDeps(null);
    const focus = await bootstrapSessions(deps);
    expect(createTabSession).not.toHaveBeenCalled();
    expect(focus).toBeNull();
  });

  it('restores persisted tabs', async () => {
    const persisted: PersistedTabs = {
      version: 3,
      tabs: [
        { tabId: 'a', shell: 'bash', cwd: '/p/a' },
        { tabId: 'b', shell: 'bash', cwd: '/p/b' },
      ],
      focusedTabId: 'b',
    };
    const { deps, createTabSession } = makeDeps(persisted);
    const focus = await bootstrapSessions(deps);
    expect(createTabSession).toHaveBeenCalledTimes(2);
    expect(focus).toBe(persisted.focusedTabId);
  });

  it('does NOT create a boot tab when the user closed all tabs before quitting', async () => {
    // A persisted layout exists but holds zero tabs — the user deliberately closed
    // everything. The app must boot into the empty state, not spawn a tab at $HOME.
    const persisted: PersistedTabs = { version: 3, tabs: [], focusedTabId: null };
    const { deps, createTabSession } = makeDeps(persisted);
    const focus = await bootstrapSessions(deps);
    expect(createTabSession).not.toHaveBeenCalled();
    expect(focus).toBeNull();
  });
});
