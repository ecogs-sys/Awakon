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
  it('forwards persist-docs to the callback', () => {
    const { router, handlers } = makeRouter();
    const cb = vi.fn();
    router.onPersistDocs(cb);
    handlers.get(IpcChannel.LayoutPersistDocs)!({}, { tabId: 't1', docs: [], activeDocIndex: null });
    expect(cb).toHaveBeenCalledWith('t1', [], null);
  });

  it('returns the docs-for-tab callback result', () => {
    const { router, handlers } = makeRouter();
    router.onDocsForTab(() => ({ docs: [], activeDocIndex: 0 }));
    const res = handlers.get(IpcChannel.LayoutDocsForTab)!({}, { tabId: 't1' });
    expect(res).toEqual({ docs: [], activeDocIndex: 0 });
  });

  it('returns an empty default when no docs-for-tab callback is set', () => {
    const { handlers } = makeRouter();
    const res = handlers.get(IpcChannel.LayoutDocsForTab)!({}, { tabId: 't1' });
    expect(res).toEqual({ docs: [], activeDocIndex: null });
  });
});
