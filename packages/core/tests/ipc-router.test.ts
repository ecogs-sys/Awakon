import { describe, expect, it, vi } from 'vitest';
import { IpcRouter } from '../src/ipc-router.js';
import { IpcChannel } from '@awakon/contracts';

type Handler = (e: unknown, raw: unknown) => unknown;

function makeRouter(): { router: IpcRouter; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const ipcMain = {
    handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
  } as unknown as import('electron').IpcMain;
  const manager = {
    on: vi.fn(), list: vi.fn(() => []), get: vi.fn(),
    write: vi.fn(), close: vi.fn(), resize: vi.fn(),
  } as never;
  const router = new IpcRouter(ipcMain, manager);
  return { router, handlers };
}

describe('IpcRouter — M2 sender ownership', () => {
  it('rejects SessionWrite when the sender does not own the session', () => {
    const { router, handlers } = makeRouter();
    const ownerWc = { id: 1 };
    const otherWc = { id: 2 };
    router.bindSessionView('s1' as never, ownerWc as never);
    const res = handlers.get(IpcChannel.SessionWrite)!(
      { sender: otherWc },
      { sessionId: 's1', data: 'AA==' },
    ) as { error: string };
    expect(res.error).toMatch(/not authorized/);
  });

  it('allows SessionWrite when the sender owns the session (its own tab/pane view)', () => {
    const { router, handlers } = makeRouter();
    const ownerWc = { id: 1 };
    router.bindSessionView('s1' as never, ownerWc as never);
    const res = handlers.get(IpcChannel.SessionWrite)!(
      { sender: ownerWc },
      { sessionId: 's1', data: 'AA==' },
    );
    expect(res).toEqual({ ok: true });
  });

  it('allows the chrome WebContents to close any session regardless of ownership', () => {
    const { router, handlers } = makeRouter();
    const chromeWc = { id: 1 };
    const terminalWc = { id: 2 };
    router.bindSessionView('s1' as never, terminalWc as never);
    router.setChromeWebContents(chromeWc as never);
    const res = handlers.get(IpcChannel.SessionClose)!({ sender: chromeWc }, { sessionId: 's1' });
    expect(res).toEqual({ ok: true });
  });

  it("rejects one tab's terminal view closing a different tab's session", () => {
    const { router, handlers } = makeRouter();
    const tabAWc = { id: 1 };
    const tabBWc = { id: 2 };
    router.bindSessionView('tab-b' as never, tabBWc as never);
    const res = handlers.get(IpcChannel.SessionClose)!(
      { sender: tabAWc },
      { sessionId: 'tab-b' },
    ) as { error: string };
    expect(res.error).toMatch(/not authorized/);
  });
});

describe('IpcRouter — R6 sender ownership', () => {
  it('rejects SessionCreateForPane when the sender does not own the target tabId', () => {
    const { router, handlers } = makeRouter();
    const tabAWc = { id: 1 };
    const tabBWc = { id: 2 };
    router.bindSessionView('tab-b' as never, tabBWc as never);
    const res = handlers.get(IpcChannel.SessionCreateForPane)!(
      { sender: tabAWc },
      { shell: 'bash', cwd: '/home/me', tabId: 'tab-b' },
    ) as { error: string };
    expect(res.error).toMatch(/not authorized/);
  });

  it('allows SessionCreateForPane when the sender owns the target tabId', () => {
    const { router, handlers } = makeRouter();
    const tabWc = { id: 1 };
    router.bindSessionView('tab-a' as never, tabWc as never);
    router.onSessionCreateForPane((_opts, tabId) => ({
      id: 'pane-1', title: 'pane-1', shell: 'bash', cwd: '/home/me',
      status: 'running', kind: 'pane', pid: 1, exitCode: null, tabId,
    } as never));
    const res = handlers.get(IpcChannel.SessionCreateForPane)!(
      { sender: tabWc },
      { shell: 'bash', cwd: '/home/me', tabId: 'tab-a' },
    );
    expect(res).toMatchObject({ id: 'pane-1' });
  });

  it('allows the chrome WebContents to call SessionCreateForPane for any tabId', () => {
    const { router, handlers } = makeRouter();
    const chromeWc = { id: 1 };
    router.setChromeWebContents(chromeWc as never);
    router.onSessionCreateForPane(() => ({ id: 'pane-1' } as never));
    const res = handlers.get(IpcChannel.SessionCreateForPane)!(
      { sender: chromeWc },
      { shell: 'bash', cwd: '/home/me', tabId: 'tab-z' },
    );
    expect(res).toMatchObject({ id: 'pane-1' });
  });

  it("rejects LayoutPersistSplits when the sender does not own the tabId", () => {
    const { router, handlers } = makeRouter();
    const tabAWc = { id: 1 };
    const tabBWc = { id: 2 };
    router.bindSessionView('tab-b' as never, tabBWc as never);
    const res = handlers.get(IpcChannel.LayoutPersistSplits)!(
      { sender: tabAWc },
      { tabId: 'tab-b', splits: null },
    ) as { error: string };
    expect(res.error).toMatch(/not authorized/);
  });

  it('allows LayoutPersistSplits when the sender owns the tabId', () => {
    const { router, handlers } = makeRouter();
    const tabWc = { id: 1 };
    router.bindSessionView('tab-a' as never, tabWc as never);
    const cb = vi.fn();
    router.onPersistSplits(cb);
    const res = handlers.get(IpcChannel.LayoutPersistSplits)!(
      { sender: tabWc },
      { tabId: 'tab-a', splits: null },
    );
    expect(res).toEqual({ ok: true });
    expect(cb).toHaveBeenCalledWith('tab-a', null);
  });

  it("rejects LayoutSplitsForTab when the sender does not own the tabId", () => {
    const { router, handlers } = makeRouter();
    const tabAWc = { id: 1 };
    const tabBWc = { id: 2 };
    router.bindSessionView('tab-b' as never, tabBWc as never);
    const res = handlers.get(IpcChannel.LayoutSplitsForTab)!(
      { sender: tabAWc },
      { tabId: 'tab-b' },
    ) as { error: string };
    expect(res.error).toMatch(/not authorized/);
  });

  it('allows LayoutSplitsForTab when the sender owns the tabId', () => {
    const { router, handlers } = makeRouter();
    const tabWc = { id: 1 };
    router.bindSessionView('tab-a' as never, tabWc as never);
    router.onSplitsForTab(() => null);
    const res = handlers.get(IpcChannel.LayoutSplitsForTab)!(
      { sender: tabWc },
      { tabId: 'tab-a' },
    );
    expect(res).toBeNull();
  });
});

describe('IpcRouter — R3 SessionClose vs SessionClosePane', () => {
  it('routes SessionClose to the onSessionClose callback, not onSessionClosePane', () => {
    const { router, handlers } = makeRouter();
    const chromeWc = { id: 1 };
    router.setChromeWebContents(chromeWc as never);
    const closeCb = vi.fn();
    const closePaneCb = vi.fn();
    router.onSessionClose(closeCb);
    router.onSessionClosePane(closePaneCb);
    const res = handlers.get(IpcChannel.SessionClose)!({ sender: chromeWc }, { sessionId: 'tab-1' });
    expect(res).toEqual({ ok: true });
    expect(closeCb).toHaveBeenCalledWith('tab-1');
    expect(closePaneCb).not.toHaveBeenCalled();
  });

  it('routes SessionClosePane to the onSessionClosePane callback, not onSessionClose', () => {
    const { router, handlers } = makeRouter();
    const terminalWc = { id: 2 };
    router.bindSessionView('pane-1' as never, terminalWc as never);
    const closeCb = vi.fn();
    const closePaneCb = vi.fn();
    router.onSessionClose(closeCb);
    router.onSessionClosePane(closePaneCb);
    const res = handlers.get(IpcChannel.SessionClosePane)!({ sender: terminalWc }, { sessionId: 'pane-1' });
    expect(res).toEqual({ ok: true });
    expect(closePaneCb).toHaveBeenCalledWith('pane-1');
    expect(closeCb).not.toHaveBeenCalled();
  });

  it("rejects SessionClosePane when the sender doesn't own the pane", () => {
    const { router, handlers } = makeRouter();
    const ownerWc = { id: 1 };
    const otherWc = { id: 2 };
    router.bindSessionView('pane-1' as never, ownerWc as never);
    const res = handlers.get(IpcChannel.SessionClosePane)!(
      { sender: otherWc },
      { sessionId: 'pane-1' },
    ) as { error: string };
    expect(res.error).toMatch(/not authorized/);
  });

  it('allows the chrome WebContents to send SessionClosePane regardless of ownership', () => {
    const { router, handlers } = makeRouter();
    const chromeWc = { id: 1 };
    const terminalWc = { id: 2 };
    router.bindSessionView('pane-1' as never, terminalWc as never);
    router.setChromeWebContents(chromeWc as never);
    const res = handlers.get(IpcChannel.SessionClosePane)!({ sender: chromeWc }, { sessionId: 'pane-1' });
    expect(res).toEqual({ ok: true });
  });
});

describe('IpcRouter — doc.open', () => {
  it('invokes the doc-open callback with sessionId + path', () => {
    const { router, handlers } = makeRouter();
    const wc = { id: 1 };
    router.bindSessionView('s1' as never, wc as never);
    const cb = vi.fn();
    router.onDocOpen(cb);
    const res = handlers.get(IpcChannel.DocOpen)!({ sender: wc }, { sessionId: 's1', path: 'a.md' });
    expect(cb).toHaveBeenCalledWith('s1', 'a.md');
    expect(res).toEqual({ ok: true });
  });

  it('rejects a malformed doc-open payload', () => {
    const { router, handlers } = makeRouter();
    router.onDocOpen(vi.fn());
    const res = handlers.get(IpcChannel.DocOpen)!({ sender: { id: 1 } }, { sessionId: 's1' }) as { error: string };
    expect(typeof res.error).toBe('string');
  });
});

describe('IpcRouter — persist-docs / docs-for-tab', () => {
  it('forwards persist-docs to the callback when sent by chrome', () => {
    const { router, handlers } = makeRouter();
    const chromeWc = { id: 1 };
    router.setChromeWebContents(chromeWc as never);
    const cb = vi.fn();
    router.onPersistDocs(cb);
    handlers.get(IpcChannel.LayoutPersistDocs)!({ sender: chromeWc }, { tabId: 't1', docs: [], activeDocIndex: null });
    expect(cb).toHaveBeenCalledWith('t1', [], null);
  });

  it('rejects persist-docs from a non-chrome sender', () => {
    const { router, handlers } = makeRouter();
    const chromeWc = { id: 1 };
    const otherWc = { id: 2 };
    router.setChromeWebContents(chromeWc as never);
    const cb = vi.fn();
    router.onPersistDocs(cb);
    const res = handlers.get(IpcChannel.LayoutPersistDocs)!(
      { sender: otherWc },
      { tabId: 't1', docs: [], activeDocIndex: null },
    ) as { error: string };
    expect(res.error).toMatch(/not authorized/);
    expect(cb).not.toHaveBeenCalled();
  });

  it('returns the docs-for-tab callback result when sent by chrome', () => {
    const { router, handlers } = makeRouter();
    const chromeWc = { id: 1 };
    router.setChromeWebContents(chromeWc as never);
    router.onDocsForTab(() => ({ docs: [], activeDocIndex: 0 }));
    const res = handlers.get(IpcChannel.LayoutDocsForTab)!({ sender: chromeWc }, { tabId: 't1' });
    expect(res).toEqual({ docs: [], activeDocIndex: 0 });
  });

  it('rejects docs-for-tab from a non-chrome sender', () => {
    const { router, handlers } = makeRouter();
    const chromeWc = { id: 1 };
    const otherWc = { id: 2 };
    router.setChromeWebContents(chromeWc as never);
    router.onDocsForTab(() => ({ docs: [], activeDocIndex: 0 }));
    const res = handlers.get(IpcChannel.LayoutDocsForTab)!({ sender: otherWc }, { tabId: 't1' }) as { error: string };
    expect(res.error).toMatch(/not authorized/);
  });
});
