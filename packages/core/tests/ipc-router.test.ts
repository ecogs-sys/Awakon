import { describe, expect, it, vi } from 'vitest';
import { IpcRouter } from '../src/ipc-router.js';
import { IpcChannel } from '@awakon/contracts';

type Handler = (e: unknown, raw: unknown) => unknown;

function makeRouter(): { router: IpcRouter; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const ipcMain = {
    handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
  } as unknown as import('electron').IpcMain;
  const manager = { on: vi.fn(), list: vi.fn(() => []), get: vi.fn() } as never;
  const router = new IpcRouter(ipcMain, manager);
  return { router, handlers };
}

describe('IpcRouter — doc.open', () => {
  it('invokes the doc-open callback with sessionId + path', () => {
    const { router, handlers } = makeRouter();
    const cb = vi.fn();
    router.onDocOpen(cb);
    const res = handlers.get(IpcChannel.DocOpen)!({}, { sessionId: 's1', path: 'a.md' });
    expect(cb).toHaveBeenCalledWith('s1', 'a.md');
    expect(res).toEqual({ ok: true });
  });

  it('rejects a malformed doc-open payload', () => {
    const { router, handlers } = makeRouter();
    router.onDocOpen(vi.fn());
    const res = handlers.get(IpcChannel.DocOpen)!({}, { sessionId: 's1' }) as { error: string };
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
    const { router, handlers } = makeRouter();
    const res = handlers.get(IpcChannel.LayoutDocsForTab)!({}, { tabId: 't1' });
    expect(res).toEqual({ docs: [], activeDocIndex: null });
  });
});
