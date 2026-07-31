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

  it('falls back to $HOME (not a permanent skip) when a cwd fails to restore, keeping the tab alive (N8/M5)', async () => {
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
    // tab 'a': first attempt at '/deleted' throws, retry at $HOME succeeds (sess-2);
    // tab 'b': single successful attempt (sess-3, since n keeps incrementing).
    expect(createTabSession).toHaveBeenCalledTimes(3);
    const secondCallCwd = (createTabSession.mock.calls[1]?.[0] as { cwd: string }).cwd;
    expect(secondCallCwd).not.toBe('/deleted');
    // focusedTabIndex 0 -> tab 'a', which is the $HOME-fallback session, not dropped.
    expect(focus).toBe('sess-2');
  });

  it('annotates the title of a $HOME-fallback tab so the user knows the original cwd was unavailable (N8)', async () => {
    const persisted: PersistedTabs = {
      version: 4,
      tabs: [{ tabId: 'a', shell: 'bash', cwd: '/deleted', title: 'my-project' }],
      focusedTabIndex: 0,
    };
    const createTabSession = vi.fn(async (opts: { cwd: string; title?: string }) => {
      if (opts.cwd === '/deleted') throw new Error('ENOENT: no such directory');
      return makeInfo('sess-fallback');
    });
    const deps: BootstrapDeps = { loadPersisted: async () => persisted, createTabSession };
    await bootstrapSessions(deps);
    expect(createTabSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: expect.stringContaining('my-project') }),
    );
    expect(createTabSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: expect.stringContaining('cwd unavailable') }),
    );
  });

  it('only skips a tab if BOTH the original cwd and the $HOME fallback fail, without throwing (M5)', async () => {
    const persisted: PersistedTabs = {
      version: 4,
      tabs: [{ tabId: 'a', shell: 'bash', cwd: '/deleted' }],
      focusedTabIndex: 0,
    };
    const createTabSession = vi.fn(async () => { throw new Error('ENOENT'); });
    const deps: BootstrapDeps = { loadPersisted: async () => persisted, createTabSession };
    await expect(bootstrapSessions(deps)).resolves.toBeNull();
    expect(createTabSession).toHaveBeenCalledTimes(2); // original attempt + $HOME retry
  });
});
