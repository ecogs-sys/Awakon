import { contextBridge, ipcRenderer } from 'electron';
import type { PreloadBridge } from '@awakon/terminal-host';

// Same shape as terminal-host's PreloadBridge (which describes what window.awakon must
// provide) — re-exported under this name so preload call sites don't need to know about
// terminal-host, and the two can't drift apart (C3).
export type Bridge = PreloadBridge;

/**
 * Exposes window.awakon scoped to an explicit per-renderer channel allowlist.
 *
 * The previous bridge forwarded any channel string straight to ipcRenderer, so any
 * renderer — including a terminal view whose job is only its own session — could
 * invoke every main handler: create sessions anywhere, write into other sessions,
 * read arbitrary files, rewrite settings (M2). Chrome and terminal call exposeScopedBridge
 * with their own distinct lists (see chrome.ts / terminal.ts).
 */
export function exposeScopedBridge(sendChannels: readonly string[], listenChannels: readonly string[]): void {
  const sendSet = new Set(sendChannels);
  const listenSet = new Set(listenChannels);

  const bridge: Bridge = {
    send: (channel, payload) => {
      if (!sendSet.has(channel)) {
        return Promise.reject(new Error(`awakon: channel not allowed from this renderer: ${channel}`));
      }
      return ipcRenderer.invoke(channel, payload);
    },
    on: (channel, handler) => {
      if (!listenSet.has(channel)) {
        console.warn(`awakon: channel not allowed from this renderer: ${channel}`);
        return () => {};
      }
      const listener = (_e: Electron.IpcRendererEvent, payload: unknown): void => handler(payload);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  };

  contextBridge.exposeInMainWorld('awakon', bridge);
}
