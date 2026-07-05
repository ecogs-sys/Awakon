import { stat, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { BrowserWindow } from 'electron';
import {
  FsPickDirectoryPayloadSchema,
  FsPathExistsPayloadSchema,
  FsReadFilePayloadSchema,
  IpcChannel,
} from '@awakon/contracts';
import { isPathInside } from './navigation-guard.js';

/** Subset of `ipcMain` we depend on — narrows the surface for tests. */
export interface IpcLike {
  handle: (channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown> | unknown) => void;
}

/** Subset of Electron's `dialog` we depend on. */
export interface DialogLike {
  showOpenDialog: (
    window: BrowserWindow,
    options: Electron.OpenDialogOptions,
  ) => Promise<Electron.OpenDialogReturnValue>;
}

/**
 * Register filesystem-IPC handlers used by the New Session dialog:
 *   - FsPickDirectory  → native directory picker
 *   - FsPathExists     → stat-based existence check
 *
 * `getWindow` is a getter (not a value) so the registration order doesn't
 * couple to chromeWindow construction time.
 */
export function registerFsHandlers(
  ipc: IpcLike,
  getWindow: () => BrowserWindow | null,
  dialog: DialogLike,
  getTabCwd: (tabId: string) => string | undefined,
): void {
  ipc.handle(IpcChannel.FsPickDirectory, async (_e, raw) => {
    const parsed = FsPickDirectoryPayloadSchema.safeParse(raw);
    if (!parsed.success) return { cancelled: true };
    const win = getWindow();
    if (!win) return { cancelled: true };
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      ...(parsed.data.startPath ? { defaultPath: parsed.data.startPath } : {}),
    });
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
    return { path: result.filePaths[0]! };
  });

  ipc.handle(IpcChannel.FsPathExists, async (_e, raw) => {
    const parsed = FsPathExistsPayloadSchema.safeParse(raw);
    if (!parsed.success) return { exists: false, isDirectory: false };
    try {
      const st = await stat(parsed.data.path);
      return { exists: true, isDirectory: st.isDirectory() };
    } catch {
      return { exists: false, isDirectory: false };
    }
  });

  const MAX_DOC_BYTES = 1_048_576; // 1 MB

  ipc.handle(IpcChannel.FsReadFile, async (_e, raw) => {
    const parsed = FsReadFilePayloadSchema.safeParse(raw);
    if (!parsed.success) return { error: parsed.error.message };
    const { path, tabId } = parsed.data;
    if (!path.toLowerCase().endsWith('.md')) {
      return { error: 'only .md files can be read by the reader' };
    }
    // N6: this is the actual read boundary — the click-path check in index.ts's
    // DocOpen handler is only an early bail, and the doc-restore path (a persisted
    // tabMeta.docs entry replayed on relaunch) never goes through that handler at all.
    const cwd = getTabCwd(tabId);
    const resolvedPath = isAbsolute(path) ? path : join(cwd ?? '', path);
    if (!cwd || !isPathInside(cwd, resolvedPath)) {
      return { error: 'path is outside the tab\'s working directory' };
    }
    try {
      const st = await stat(resolvedPath);
      if (st.size > MAX_DOC_BYTES) return { tooLarge: true, sizeBytes: st.size };
      const content = await readFile(resolvedPath, 'utf8');
      return { content, sizeBytes: st.size, mtimeMs: st.mtimeMs };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return { notFound: true };
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
