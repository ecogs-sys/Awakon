import { contextBridge, ipcRenderer } from 'electron';

const bridge = {
  send: (channel: string, payload?: unknown): Promise<unknown> =>
    ipcRenderer.invoke(channel, payload),
  on: (channel: string, handler: (payload: unknown) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown): void => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld('awakon', bridge);
declare global { interface Window { awakon: typeof bridge } }
