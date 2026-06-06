import { app, BrowserWindow, Menu, ipcMain, dialog, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir, release as osRelease } from 'node:os';
import { IpcChannel, IpcRouter, SessionManager, SessionStore, SettingsStore } from '@awakon/core';
import type { Shell, SessionInfo, AppSettings, PersistedTab, PersistedSplitNode, ChromeAppInfoResponse } from '@awakon/contracts';
import { AppSettingsSchema, ResumeCancelPayloadSchema, ChromeMenuPopupPayloadSchema, ChromeWindowControlPayloadSchema, ChromeOpenExternalPayloadSchema } from '@awakon/contracts';
import { ViewManager } from './view-manager.js';
import { NotificationBridge } from './notification-bridge.js';
import { buildAppMenu, buildSubmenu, type MenuName } from './app-menu.js';
import { bootstrapSessions } from './session-bootstrap.js';
import { setupAutoUpdate } from './auto-update.js';
import { registerFsHandlers } from './fs-handlers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const isDev = !app.isPackaged && process.env['NODE_ENV'] !== 'production';

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const sessionManager = new SessionManager();
const ipcRouter = new IpcRouter(ipcMain, sessionManager);
const sessionStore = new SessionStore(app.getPath('userData'));
const settingsStore = new SettingsStore(app.getPath('userData'));
settingsStore.onError((err) => {
  console.warn('[main] settings not saved:', err instanceof Error ? err.message : err);
});
let appSettings: AppSettings = { autoResume: { enabled: false, detectText: '', responseText: '' }, defaultCwd: '' };
const tabMeta = new Map<string, PersistedTab>();
/** Authoritative tab order (persisted). Updated on create, close, and drag-reorder. */
let tabOrder: string[] = [];
/** pane session id -> owning tab's primary session id. */
const paneOwnership = new Map<string, string>();

/** Close every pane session owned by the given tab. */
function closeTabPanes(tabId: string): void {
  for (const [paneId, owner] of paneOwnership) {
    if (owner === tabId) {
      sessionManager.close(paneId);
      paneOwnership.delete(paneId);
    }
  }
}

function snapshotTabs(): {
  version: 2;
  tabs: PersistedTab[];
  focusedTabId: string | null;
} {
  return {
    version: 2,
    // Emit tabs in the authoritative order so a drag-reorder survives restart.
    tabs: tabOrder.filter((id) => tabMeta.has(id)).map((id) => tabMeta.get(id)!),
    focusedTabId: focusedSessionId,
  };
}

function persistTabs(): void {
  void sessionStore.save(snapshotTabs());
}

// Surface persistence failures instead of swallowing them (F19).
sessionStore.onError((err) => {
  console.warn('[main] layout not saved:', err instanceof Error ? err.message : err);
});

let chromeWindow: BrowserWindow | null = null;
let viewManager: ViewManager | null = null;

function defaultShell(): Shell {
  if (process.platform === 'win32') return 'pwsh';
  if (process.platform === 'darwin') return 'zsh';
  return 'bash';
}

function preloadPath(): string {
  return join(__dirname, '../preload/index.mjs');
}

function iconPath(): string {
  // In dev, __dirname is apps/desktop/out/main; back two levels reaches apps/desktop/build/icon.png.
  // When packaged, electron-builder copies the icon to resources/icon.png via extraResources.
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../build/icon.png');
}

function rendererEntry(name: 'chrome' | 'terminal'): { url?: string; file?: string } {
  if (isDev) {
    const port = process.env['ELECTRON_RENDERER_URL'];
    if (!port) throw new Error('ELECTRON_RENDERER_URL is required in dev (set by electron-vite)');
    return { url: name === 'chrome' ? `${port}/index.html` : `${port}/terminal-host.html` };
  }
  return { file: join(__dirname, `../renderer/${name === 'chrome' ? 'index' : 'terminal-host'}.html`) };
}

async function createSessionView(sessionId: string): Promise<void> {
  if (!viewManager) return;
  viewManager.create(sessionId);
  const wc = viewManager.get(sessionId)!.webContents;
  ipcRouter.subscribe(wc);
  ipcRouter.bindSessionView(sessionId, wc);
  const entry = rendererEntry('terminal');
  const meta = tabMeta.get(sessionId);
  await viewManager.load(sessionId, {
    ...(entry.url ? { url: entry.url } : {}),
    ...(entry.file ? { file: entry.file } : {}),
    query: {
      sessionId,
      shell: meta?.shell ?? defaultShell(),
      cwd: meta?.cwd ?? homedir(),
    },
  });
  viewManager.show(sessionId);
}

async function createTabSession(opts: Parameters<SessionManager['create']>[0] & {
  splits?: PersistedSplitNode;
}): Promise<SessionInfo> {
  const session = sessionManager.create(opts);
  tabMeta.set(session.id, {
    tabId: session.id,
    shell: opts.shell,
    cwd: opts.cwd,
    ...(opts.title ? { title: opts.title } : {}),
    ...(opts.splits ? { splits: opts.splits } : {}),
  });
  tabOrder.push(session.id);
  persistTabs();
  await createSessionView(session.id);
  return session.info();
}

// IPC: renderer asks for the platform home directory (the chrome cannot read it).
ipcMain.handle(IpcChannel.LayoutDefaultCwd, (): string => homedir());

// IPC: filesystem helpers used by the New Session dialog (Browse + cwd validation).
registerFsHandlers(ipcMain, () => chromeWindow, dialog);

// IPC: custom titlebar in the chrome renderer asks main to pop one of the named
// submenus from app-menu.ts at the given screen coordinates. This lets the in-window
// menu bar share a single source of truth with the OS application menu — no item
// duplication, accelerators stay correct.
ipcMain.handle(IpcChannel.ChromeMenuPopup, (_e, raw): { ok: true } | { error: string } => {
  const parsed = ChromeMenuPopupPayloadSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.message };
  if (!chromeWindow) return { error: 'no chrome window' };
  const submenu = buildSubmenu(
    parsed.data.menu as MenuName,
    () => chromeWindow,
    () => focusedSessionId ? (viewManager?.get(focusedSessionId) ?? null) : null,
  );
  submenu.popup({
    window: chromeWindow,
    x: parsed.data.x,
    y: parsed.data.y,
  });
  return { ok: true };
});

// IPC: custom titlebar's min/max/close buttons drive the BrowserWindow.
ipcMain.handle(IpcChannel.ChromeWindowControl, (_e, raw): { ok: true } | { error: string } => {
  const parsed = ChromeWindowControlPayloadSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.message };
  if (!chromeWindow) return { error: 'no chrome window' };
  if (parsed.data.action === 'minimize') chromeWindow.minimize();
  else if (parsed.data.action === 'maximize') {
    if (chromeWindow.isMaximized()) chromeWindow.unmaximize();
    else chromeWindow.maximize();
  } else if (parsed.data.action === 'close') chromeWindow.close();
  return { ok: true };
});

// IPC: About dialog asks for runtime info — versions + OS string.
ipcMain.handle(IpcChannel.ChromeAppInfo, (): ChromeAppInfoResponse => {
  const platformLabel = process.platform === 'win32' ? 'Windows'
                     : process.platform === 'darwin' ? 'macOS'
                     : process.platform === 'linux' ? 'Linux'
                     : process.platform;
  return {
    version:  app.getVersion(),
    electron: process.versions['electron'] ?? '',
    chromium: process.versions['chrome'] ?? '',
    node:     process.versions['node'] ?? '',
    v8:       process.versions['v8'] ?? '',
    os:       `${platformLabel} · ${osRelease()} (${process.arch})`,
  };
});

// IPC: About dialog opens a link in the OS default browser via shell.openExternal.
ipcMain.handle(IpcChannel.ChromeOpenExternal, (_e, raw): { ok: true } | { error: string } => {
  const parsed = ChromeOpenExternalPayloadSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.message };
  void shell.openExternal(parsed.data.url);
  return { ok: true };
});

// IPC: chrome renderer reads the current settings.
ipcMain.handle(IpcChannel.SettingsGet, (): AppSettings => appSettings);

// IPC: chrome renderer saves settings — persist, apply, and echo to renderers.
ipcMain.handle(IpcChannel.SettingsUpdate, (_e, raw): { ok: true } | { error: string } => {
  const parsed = AppSettingsSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.message };
  appSettings = parsed.data;
  void settingsStore.save(appSettings);
  sessionManager.applyAutoResumeConfig(appSettings.autoResume);
  chromeWindow?.webContents.send(IpcChannel.SettingsChanged, appSettings);
  return { ok: true };
});

// IPC: chrome renderer cancels a pending resume (badge cancel control).
ipcMain.handle(IpcChannel.ResumeCancel, (_e, raw): { ok: true } | { error: string } => {
  const parsed = ResumeCancelPayloadSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.message };
  sessionManager.cancelResume(parsed.data.sessionId);
  return { ok: true };
});

// Forward resume lifecycle events to the chrome renderer for the countdown badge.
sessionManager.on('resumeScheduled', (sessionId, resetAt) => {
  chromeWindow?.webContents.send(IpcChannel.ResumeScheduled, { sessionId, resetAt });
});
sessionManager.on('resumeCancelled', (sessionId) => {
  chromeWindow?.webContents.send(IpcChannel.ResumeCancelled, { sessionId });
});
sessionManager.on('resumeFired', (sessionId) => {
  chromeWindow?.webContents.send(IpcChannel.ResumeFired, { sessionId });
});

// IPC: renderer asks main to spawn the platform default shell at $HOME.
ipcMain.handle(IpcChannel.SessionCreateDefault, async (): Promise<SessionInfo | { error: string }> => {
  try {
    return await createTabSession({
      shell: defaultShell(),
      cwd: homedir(),
      cols: 80,
      rows: 24,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

sessionManager.on('sessionExited', (sessionId) => {
  crashCounters.delete(sessionId);
  // Spec §7: a tab whose shell exits on its own becomes a read-only 'exited' tab —
  // the WebContentsView is kept so scrollback stays readable and the user can
  // Restart or Close it. Teardown happens only via an explicit core.session.close.
  if (!tabMeta.has(sessionId)) {
    paneOwnership.delete(sessionId);
  }
});

/** Full teardown of a tab: destroy its view, its panes, persist, then kill the PTY.
 * Invoked only on an explicit user close (core.session.close). */
function closeTab(tabId: string): void {
  closeTabPanes(tabId);
  viewManager?.destroy(tabId);
  crashCounters.delete(tabId);
  if (tabMeta.has(tabId)) {
    tabMeta.delete(tabId);
    tabOrder = tabOrder.filter((id) => id !== tabId);
    persistTabs();
  }
  sessionManager.close(tabId);
}

// Persist tab renames: when a session's title changes, update tabMeta and re-save.
sessionManager.on('sessionTitleChanged', (sessionId, title) => {
  const meta = tabMeta.get(sessionId);
  if (meta) {
    meta.title = title;
    persistTabs();
  }
});

let focusedSessionId: string | null = null;
ipcRouter.onLayoutShow((sessionId) => {
  focusedSessionId = sessionId;
  viewManager?.show(sessionId);
});

ipcRouter.onSetSidebarWidth((widthPx) => {
  viewManager?.setSidebarWidth(widthPx);
});

ipcRouter.onSessionCreate((opts) => createTabSession(opts));

// Pane creation: spawn a pane session and record which tab owns it (no view).
// The pane's data is routed to the owning tab's WebContents.
ipcRouter.onSessionCreateForPane((opts, tabId) => {
  const session = sessionManager.create(opts, 'pane');
  paneOwnership.set(session.id, tabId);
  const wc = viewManager?.get(tabId)?.webContents;
  if (wc) ipcRouter.bindSessionView(session.id, wc);
  return session.info();
});

// While a chrome-level modal (NewSessionDialog, rename) is open, move the terminal
// WebContentsView offscreen so the native overlay does not cover the modal.
ipcRouter.onLayoutModal((open) => {
  if (open) viewManager?.suspend();
  else viewManager?.resume();
});

// Persist drag-reordered tab order (ignoring ids that are no longer tabs).
ipcRouter.onReorderTabs((order) => {
  const known = order.filter((id) => tabMeta.has(id));
  // Keep any tabs the renderer did not mention (defensive) at the end.
  for (const id of tabOrder) if (!known.includes(id) && tabMeta.has(id)) known.push(id);
  tabOrder = known;
  persistTabs();
});

// Persist the serialized split tree for a tab. Null clears the field.
ipcRouter.onPersistSplits((tabId, splits) => {
  const meta = tabMeta.get(tabId);
  if (!meta) return;
  if (splits === null) {
    delete meta.splits;
  } else {
    meta.splits = splits;
  }
  persistTabs();
});

// Hand the saved split tree to the terminal renderer when it mounts.
ipcRouter.onSplitsForTab((tabId) => tabMeta.get(tabId)?.splits ?? null);

// Explicit user close → full tab teardown.
ipcRouter.onSessionClose((sessionId) => closeTab(sessionId));

// Restart a broken tab's renderer (PTY is still alive — recreate just the view).
ipcRouter.onRestartView((sessionId) => {
  crashCounters.delete(sessionId);
  void recreateSessionView(sessionId);
});

// Construct the NotificationBridge exactly once, at module scope, before any session
// exists. It reads chromeWindow/viewManager/focusedSessionId via lazy getters, so it
// survives window recreation on macOS without re-registering its sessionAttention
// listener (which previously leaked + duplicated notifications on every reopen).
new NotificationBridge({
  sessionManager,
  viewManager: () => viewManager,
  chromeWindow: () => chromeWindow,
  focusedSessionId: () => focusedSessionId,
  tabIdForSession: (id) => (paneOwnership.get(id) ?? id),
});

async function createChromeWindow(): Promise<void> {
  const isMac = process.platform === 'darwin';
  chromeWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#1c1f25',
    icon: iconPath(),
    // Win/Linux: frameless so the in-window <div id="titlebar"> can render the menu
    // and window controls. macOS: keep the platform traffic lights but inset them so
    // they overlay our titlebar area; the in-window titlebar shows glyph + title only.
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const }
      : { frame: false }
    ),
    webPreferences: {
      preload: preloadPath(),
      sandbox: false,
      contextIsolation: true,
    },
  });

  viewManager = new ViewManager({
    preloadPath: preloadPath(),
    onCrash: (sessionId) => handleRendererCrash(sessionId),
  });
  viewManager.attach(chromeWindow);
  Menu.setApplicationMenu(buildAppMenu(
    () => chromeWindow,
    () => focusedSessionId ? (viewManager?.get(focusedSessionId) ?? null) : null,
  ));

  await (() => {
    const entry = rendererEntry('chrome');
    if (entry.url) return chromeWindow!.webContents.loadURL(entry.url);
    return chromeWindow!.webContents.loadFile(entry.file!);
  })();
  ipcRouter.subscribe(chromeWindow.webContents);

  // Load persisted settings and apply them before any session is created.
  appSettings = await settingsStore.load();
  sessionManager.applyAutoResumeConfig(appSettings.autoResume);

  // Create the initial session so the app boots with something visible.
  const restoredFocus = await bootstrapSessions({
    loadPersisted: () => sessionStore.load(),
    createTabSession: (opts) => createTabSession(opts),
    defaultShell,
    defaultCwd: () => homedir(),
  });
  if (restoredFocus) {
    focusedSessionId = restoredFocus;
    viewManager?.show(restoredFocus);
    chromeWindow?.webContents.send(IpcChannel.LayoutShow, { sessionId: restoredFocus });
  }

  chromeWindow.on('closed', () => {
    chromeWindow = null;
    viewManager = null;
  });

  void setupAutoUpdate();
}

const crashCounters = new Map<string, number[]>(); // sessionId → recent crash timestamps

/** Replace a tab's WebContentsView with a fresh one. The PTY session is untouched;
 * TerminalHost.replay() reloads scrollback from the ring buffer. */
async function recreateSessionView(sessionId: string): Promise<void> {
  if (!viewManager) return;
  const fresh = viewManager.replaceView(sessionId);
  if (!fresh) return;
  ipcRouter.subscribe(fresh.webContents);
  // Rebind the tab and all its panes to the new WebContents.
  ipcRouter.bindSessionView(sessionId, fresh.webContents);
  for (const [paneId, owner] of paneOwnership) {
    if (owner === sessionId) ipcRouter.bindSessionView(paneId, fresh.webContents);
  }
  const entry = rendererEntry('terminal');
  const meta = tabMeta.get(sessionId);
  await viewManager.load(sessionId, {
    ...(entry.url ? { url: entry.url } : {}),
    ...(entry.file ? { file: entry.file } : {}),
    query: {
      sessionId,
      shell: meta?.shell ?? defaultShell(),
      cwd: meta?.cwd ?? homedir(),
    },
  });
  viewManager.show(sessionId);
}

function handleRendererCrash(sessionId: string): void {
  if (!viewManager) return;
  const now = Date.now();
  const recent = (crashCounters.get(sessionId) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  crashCounters.set(sessionId, recent);
  if (recent.length >= 2) {
    // Spec §7: two crashes in 60s → stop auto-recovering, surface a broken state.
    console.warn(`[main] tab ${sessionId} crashed twice in 60s; surfacing "needs restart".`);
    chromeWindow?.webContents.send(IpcChannel.SessionTabBroken, { sessionId });
    return;
  }
  console.warn(`[main] tab ${sessionId} crashed; recreating view + replaying scrollback.`);
  void recreateSessionView(sessionId);
}

app.whenReady().then(async () => {
  await createChromeWindow();
});

app.on('second-instance', () => {
  if (chromeWindow) {
    if (chromeWindow.isMinimized()) chromeWindow.restore();
    chromeWindow.focus();
  }
});

app.on('activate', () => {
  // macOS: re-create the window when the dock icon is clicked and no windows are open.
  if (BrowserWindow.getAllWindows().length === 0) void createChromeWindow();
});

app.on('before-quit', async (event) => {
  if (sessionManager.list().length === 0) return;
  event.preventDefault();
  await sessionManager.closeAll();
  app.exit(0);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
