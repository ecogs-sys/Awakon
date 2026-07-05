import { describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '@awakon/contracts';

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
}));

// Regression for R2: `bridge.send(IpcChannel.LayoutShow, …)` on every tab focus/switch
// (layout-manager.ts) was rejected because chrome's SEND_CHANNELS omitted it, breaking
// tab switching. These lists are grepped from `send(IpcChannel.` / `on(IpcChannel.` in
// each renderer (apps/desktop/src/renderer/chrome, .../terminal, packages/terminal-host)
// — keep them in sync if a renderer starts using a new channel.

describe('chrome preload allowlists', () => {
  it('SEND_CHANNELS is a superset of every channel the chrome renderer sends', async () => {
    const { SEND_CHANNELS } = await import('./chrome');
    const usedByRenderer = [
      IpcChannel.ChromeOpenExternal,
      IpcChannel.FsReadFile,
      IpcChannel.LayoutModal,
      IpcChannel.LayoutViewportSize,
      IpcChannel.FsPickDirectory,
      IpcChannel.FsPathExists,
      IpcChannel.LayoutDefaultCwd,
      IpcChannel.SettingsGet,
      IpcChannel.RecentList,
      IpcChannel.SessionList,
      IpcChannel.SettingsUpdate,
      IpcChannel.ChromeAppInfo,
      IpcChannel.ResumeCancel,
      IpcChannel.SessionCreate,
      IpcChannel.RecentAdd,
      IpcChannel.SessionClose,
      IpcChannel.LayoutShow,
      IpcChannel.LayoutReorderTabs,
      IpcChannel.SessionSetTitle,
      IpcChannel.SessionRestartView,
      IpcChannel.LayoutSetSidebarWidth,
      IpcChannel.LayoutPersistDocs,
      IpcChannel.LayoutDocsForTab,
      IpcChannel.ChromeAppMenuPopup,
      IpcChannel.ChromeWindowControl,
    ];
    for (const channel of usedByRenderer) {
      expect(SEND_CHANNELS, `missing ${channel}`).toContain(channel);
    }
  });

  it('LISTEN_CHANNELS is a superset of every channel the chrome renderer listens for', async () => {
    const { LISTEN_CHANNELS } = await import('./chrome');
    const usedByRenderer = [
      IpcChannel.ActionInvoke,
      IpcChannel.SessionCreated,
      IpcChannel.SessionExited,
      IpcChannel.SessionAttention,
      IpcChannel.LayoutShow,
      IpcChannel.SessionTitleChanged,
      IpcChannel.SessionTabBroken,
      IpcChannel.ResumeScheduled,
      IpcChannel.ResumeCancelled,
      IpcChannel.ResumeFired,
      IpcChannel.SettingsChanged,
      IpcChannel.LayoutTabReparented,
      IpcChannel.DocOpenRequest,
    ];
    for (const channel of usedByRenderer) {
      expect(LISTEN_CHANNELS, `missing ${channel}`).toContain(channel);
    }
  });
});

describe('terminal preload allowlists', () => {
  it('SEND_CHANNELS is a superset of every channel the terminal renderer (+ terminal-host) sends', async () => {
    const { SEND_CHANNELS } = await import('./terminal');
    const usedByRenderer = [
      IpcChannel.SessionCreateForPane,
      IpcChannel.SessionClosePane,
      IpcChannel.LayoutPersistSplits,
      IpcChannel.LayoutSplitsForTab,
      IpcChannel.ChromeOpenExternal,
      IpcChannel.SessionReplay,
      IpcChannel.SessionWrite,
      IpcChannel.DocOpen,
      IpcChannel.SessionResize,
    ];
    for (const channel of usedByRenderer) {
      expect(SEND_CHANNELS, `missing ${channel}`).toContain(channel);
    }
  });

  it('LISTEN_CHANNELS is a superset of every channel the terminal renderer (+ terminal-host) listens for', async () => {
    const { LISTEN_CHANNELS } = await import('./terminal');
    const usedByRenderer = [
      IpcChannel.TerminalAction,
      IpcChannel.LayoutTabReparented,
      IpcChannel.SessionData,
      IpcChannel.SessionExited,
    ];
    for (const channel of usedByRenderer) {
      expect(LISTEN_CHANNELS, `missing ${channel}`).toContain(channel);
    }
  });
});
