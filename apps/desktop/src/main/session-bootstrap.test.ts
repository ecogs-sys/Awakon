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

  it('restores persisted tabs, resolving focus by position (ids are regenerated)', async () => {
    const persisted: PersistedTabs = {
      version: 4,
      tabs: [
        { tabId: 'a', shell: 'bash', cwd: '/p/a' },
        { tabId: 'b', shell: 'bash', cwd: '/p/b' },
      ],
      focusedTabIndex: 1,
    };
    const { deps, createTabSession } = makeDeps(persisted);
    const focus = await bootstrapSessions(deps);
    expect(createTabSession).toHaveBeenCalledTimes(2);
    expect(focus).toBe('sess-2');
  });

  it('does NOT create a boot tab when the user closed all tabs before quitting', async () => {
    // A persisted layout exists but holds zero tabs — the user deliberately closed
    // everything. The app must boot into the empty state, not spawn a tab at $HOME.
    const persisted: PersistedTabs = { version: 4, tabs: [], focusedTabIndex: null };
    const { deps, createTabSession } = makeDeps(persisted);
    const focus = await bootstrapSessions(deps);
    expect(createTabSession).not.toHaveBeenCalled();
    expect(focus).toBeNull();
  });

  it('falls back to the first successfully restored tab when a cwd fails to restore (M5)', async () => {
    const persisted: PersistedTabs = {
      version: 4,
      tabs: [
        { tabId: 'a', shell: 'bash', cwd: '/deleted' },
        { tabId: 'b', shell: 'bash', cwd: '/p/b' },
      ],
      focusedTabIndex: 0,
    };
    let n = 0;
    const createTabSession = vi.fn(async (opts: { cwd: string }) => {
      n += 1;
      if (opts.cwd === '/deleted') throw new Error('ENOENT: no such directory');
      return makeInfo(`sess-${n}`);
    });
    const deps: BootstrapDeps = { loadPersisted: async () => persisted, createTabSession };
    const focus = await bootstrapSessions(deps);
    expect(createTabSession).toHaveBeenCalledTimes(2);
    expect(focus).toBe('sess-2');
  });

  it('restores no tabs if all cwds fail, without throwing (M5)', async () => {
    const persisted: PersistedTabs = {
      version: 4,
      tabs: [{ tabId: 'a', shell: 'bash', cwd: '/deleted' }],
      focusedTabIndex: 0,
    };
    const createTabSession = vi.fn(async () => { throw new Error('ENOENT'); });
    const deps: BootstrapDeps = { loadPersisted: async () => persisted, createTabSession };
    await expect(bootstrapSessions(deps)).resolves.toBeNull();
  });
});
