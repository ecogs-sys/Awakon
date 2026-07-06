import { app, BrowserWindow, Menu, ipcMain, dialog, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';
import { homedir, release as osRelease } from 'node:os';
import { IpcChannel, IpcRouter, SessionManager, SessionStore, SettingsStore } from '@awakon/core';
import type { Shell, SessionInfo, AppSettings, PersistedTab, PersistedSplitNode, ChromeAppInfoResponse, RecentTab, PersistedOpenDoc } from '@awakon/contracts';
import { UserEditableSettingsSchema, ResumeCancelPayloadSchema, ChromeAppMenuPopupPayloadSchema, ChromeWindowControlPayloadSchema, ChromeOpenExternalPayloadSchema, RecentAddPayloadSchema, SETTINGS_SCHEMA_VERSION } from '@awakon/contracts';
import { ViewManager } from './view-manager.js';
import { NotificationBridge } from './notification-bridge.js';
import { buildAppMenu } from './app-menu.js';
import { bootstrapSessions } from './session-bootstrap.js';
import { setupAutoUpdate } from './auto-update.js';
import { registerFsHandlers } from './fs-handlers.js';
import { resolveLogConfig, IpcLogger, installIpcInterceptors } from './ipc-logger.js';
import { isAllowedNavigation, isPathInside } from './navigation-guard.js';
import { probeDefaultShell, shouldSetAppUserModelId } from './platform-defaults.js';
import { formatSessionCreateError } from './session-create-error.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const isDev = !app.isPackaged && process.env['NODE_ENV'] !== 'production';

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// R1: notifications/taskbar grouping need an explicit AUMID on the non-Store (NSIS)
// build. A Store MSIX build gets its AUMID from the package manifest automatically.
if (shouldSetAppUserModelId(process.platform, process.windowsStore)) {
  app.setAppUserModelId('com.ecogs.awakon');
}

// IPC logging (opt-in via --log-ipc <dir> or AWAKON_LOG_IPC). Installed BEFORE the
// IpcRouter and any window so every ipcMain.handle request and every main→renderer
// webContents.send event is captured. Event capture wraps each WebContents as it is
// created (app.on('web-contents-created')), so this must run before any window opens.
const ipcLogConfig = resolveLogConfig(process.argv, process.env);
let ipcLogger: IpcLogger | null = null;
if (ipcLogConfig) {
  try {
    ipcLogger = new IpcLogger(ipcLogConfig);
    installIpcInterceptors(ipcMain, app, ipcLogger);
    console.log(`[ipc-log] enabled -> ${ipcLogConfig.dir}`);
  } catch (err) {
    console.warn('[ipc-log] disabled:', err instanceof Error ? err.message : err);
    ipcLogger = null;
  }
}

// Defense in depth against H1 (terminal links / any renderer navigating to remote
// content): deny every window.open() and block in-place navigation away from the
// app's own packaged pages or the electron-vite dev server.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (navEvent, url) => {
    if (!isAllowedNavigation(url, contents.getURL(), join(__dirname, '../renderer'))) {
      navEvent.preventDefault();
    }
  });
  // will-navigate only fires for main-frame navigations — will-frame-navigate covers
  // subframes too, closing the gap a compromised/embedded frame could otherwise use to
  // navigate without tripping the check above (this app has no legitimate subframes).
  contents.on('will-frame-navigate', (details) => {
    if (!isAllowedNavigation(details.url, contents.getURL(), join(__dirname, '../renderer'))) {
      details.preventDefault();
    }
  });
  // This app never uses <webview>; deny attaching one outright rather than trusting a
  // renderer not to try.
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  // Nothing in this app (chrome or terminal) needs camera/mic/geolocation/notifications/
  // etc. — deny every permission request instead of falling back to Electron's default
  // (which grants some permissions unprompted for file:// origins).
  contents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
});

const sessionManager = new SessionManager();
const ipcRouter = new IpcRouter(ipcMain, sessionManager);
const sessionStore = new SessionStore(app.getPath('userData'));
const settingsStore = new SettingsStore(app.getPath('userData'));
settingsStore.onError((err) => {
  console.warn('[main] settings not saved:', err instanceof Error ? err.message : err);
});
let appSettings: AppSettings = { version: SETTINGS_SCHEMA_VERSION, autoResume: { enabled: false, detectText: '', responseText: '', resumeText: '' }, defaultCwd: '', recentTabs: [] };
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
  version: 4;
  tabs: PersistedTab[];
  focusedTabIndex: number | null;
} {
  // Emit tabs in the authoritative order so a drag-reorder survives restart.
  const orderedIds = tabOrder.filter((id) => tabMeta.has(id));
  const focusedIndex = focusedSessionId ? orderedIds.indexOf(focusedSessionId) : -1;
  return {
    version: 4,
    tabs: orderedIds.map((id) => tabMeta.get(id)!),
    // Session ids are regenerated every launch, so position is the only anchor that
    // survives a restart (M4) — never persist focusedSessionId itself.
    focusedTabIndex: focusedIndex >= 0 ? focusedIndex : null,
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

// Probed once at startup (a directory scan over PATH, cheap but no need to repeat it
// on every session-create call).
const probedDefaultShell = probeDefaultShell(process.platform, process.env['PATH']);
function defaultShell(): Shell {
  return probedDefaultShell;
}

/** Chrome and terminal views load distinct preloads with distinct channel
 * allowlists (M2) — never the same generic bridge. */
function preloadPath(kind: 'chrome' | 'terminal'): string {
  return join(__dirname, `../preload/${kind}.cjs`);
}

/** Chrome-only IPC guard for the handlers registered directly in this file (settings,
 * recents, the Chrome* control channels, resume cancel, doc reads). None of these are
 * scoped by a sessionId IpcRouter's isAuthorizedSender could key off of, and no terminal
 * view has any legitimate reason to invoke them — a compromised terminal renderer must
 * not be able to reach them just because ipcMain.handle has no sender check by default. */
function isChromeSender(sender: Electron.WebContents): boolean {
  return sender === chromeWindow?.webContents;
}

/** ChromeOpenExternal is legitimately called from a terminal view too (a link clicked in
 * a pane's output), not just chrome — scope it to "one of our own renderers" instead of
 * chrome-only. */
function isChromeOrTerminalSender(sender: Electron.WebContents): boolean {
  return isChromeSender(sender) || (viewManager?.ownsWebContents(sender) ?? false);
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

// IPC: renderer asks for the platform default shell (B3) — the New Session dialog's
// prefill must reflect main's PATH probe (pwsh vs. powershell), not a UA-based guess
// that assumes PowerShell 7 is installed.
ipcMain.handle(IpcChannel.LayoutDefaultShell, (): Shell => defaultShell());

// IPC: filesystem helpers used by the New Session dialog (Browse + cwd validation).
// FsReadFile (N6) resolves a tab's cwd here to enforce containment at the read boundary.
registerFsHandlers(
  ipcMain,
  () => chromeWindow,
  dialog,
  (tabId) => tabMeta.get(tabId)?.cwd,
  (sender) => isChromeSender(sender as Electron.WebContents),
);

// IPC: the top bar's hamburger (⋯) pops the whole application menu at a point.
// The platform-neutral bar drops the menu strip, so this is the single entry to
// File/Tabs/View/Window/Help on Windows/Linux. Same templates as the OS menu.
ipcMain.handle(IpcChannel.ChromeAppMenuPopup, (e, raw): { ok: true } | { error: string } => {
  const parsed = ChromeAppMenuPopupPayloadSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.message };
  if (!isChromeSender(e.sender)) return { error: 'not authorized for this session' };
  if (!chromeWindow) return { error: 'no chrome window' };
  const menu = buildAppMenu(
    () => chromeWindow,
    () => focusedSessionId ? (viewManager?.get(focusedSessionId) ?? null) : null,
  );
  menu.popup({ window: chromeWindow, x: parsed.data.x, y: parsed.data.y });
  return { ok: true };
});

// IPC: custom titlebar's min/max/close buttons drive the BrowserWindow.
ipcMain.handle(IpcChannel.ChromeWindowControl, (e, raw): { ok: true } | { error: string } => {
  const parsed = ChromeWindowControlPayloadSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.message };
  if (!isChromeSender(e.sender)) return { error: 'not authorized for this session' };
  if (!chromeWindow) return { error: 'no chrome window' };
  if (parsed.data.action === 'minimize') chromeWindow.minimize();
  else if (parsed.data.action === 'maximize') {
    if (chromeWindow.isMaximized()) chromeWindow.unmaximize();
    else chromeWindow.maximize();
  } else if (parsed.data.action === 'close') chromeWindow.close();
  return { ok: true };
});

// IPC: About dialog asks for runtime info — versions + OS string.
ipcMain.handle(IpcChannel.ChromeAppInfo, (e): ChromeAppInfoResponse | { error: string } => {
  if (!isChromeSender(e.sender)) return { error: 'not authorized for this session' };
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

// IPC: open a link in the OS default browser via shell.openExternal (About dialog,
// doc-reader links, terminal web links). The http(s)-only refinement lives in
// ChromeOpenExternalPayloadSchema itself (M3/C2) — z.string().url() alone would accept
// file:/smb:/etc, and shell.openExternal('file://...') would open/execute local paths.
ipcMain.handle(IpcChannel.ChromeOpenExternal, (e, raw): { ok: true } | { error: string } => {
  const parsed = ChromeOpenExternalPayloadSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.message };
  if (!isChromeOrTerminalSender(e.sender)) return { error: 'not authorized for this session' };
  void shell.openExternal(parsed.data.url);
  return { ok: true };
});

// IPC: chrome renderer reads the current settings.
ipcMain.handle(IpcChannel.SettingsGet, (e): AppSettings | { error: string } => {
  if (!isChromeSender(e.sender)) return { error: 'not authorized for this session' };
  return appSettings;
});

// IPC: chrome renderer saves settings — persist, apply, and echo to renderers.
// L3/C7: the payload schema (UserEditableSettingsSchema) has no recentTabs field at
// all, so a dialog echoing a stale snapshot it loaded when opened cannot clobber the
// app-owned recentTabs list even at the wire level — it's not a merge the handler has
// to remember to do, the client structurally cannot send that field.
ipcMain.handle(IpcChannel.SettingsUpdate, (e, raw): { ok: true } | { error: string } => {
  const parsed = UserEditableSettingsSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.message };
  if (!isChromeSender(e.sender)) return { error: 'not authorized for this session' };
  appSettings = { ...parsed.data, recentTabs: appSettings.recentTabs, version: appSettings.version };
  void settingsStore.save(appSettings);
  sessionManager.applyAutoResumeConfig(appSettings.autoResume);
  chromeWindow?.webContents.send(IpcChannel.SettingsChanged, appSettings);
  return { ok: true };
});

// IPC: chrome renderer reads the recent tabs list.
ipcMain.handle(IpcChannel.RecentList, (e): RecentTab[] | { error: string } => {
  if (!isChromeSender(e.sender)) return { error: 'not authorized for this session' };
  return appSettings.recentTabs ?? [];
});

// IPC: chrome renderer adds a closed tab to the recent list.
// Deduplicates by cwd (same directory = same project) and caps at 10.
ipcMain.handle(IpcChannel.RecentAdd, (e, raw): RecentTab[] | { error: string } => {
  const parsed = RecentAddPayloadSchema.safeParse(raw);
  if (!parsed.success) return appSettings.recentTabs ?? [];
  if (!isChromeSender(e.sender)) return { error: 'not authorized for this session' };
  const { entry } = parsed.data;
  const existing = (appSettings.recentTabs ?? []).filter((r: RecentTab) => r.cwd !== entry.cwd);
  appSettings = { ...appSettings, recentTabs: [entry, ...existing].slice(0, 10) };
  void settingsStore.save(appSettings);
  return appSettings.recentTabs;
});

// IPC: chrome renderer cancels a pending resume (badge cancel control). The badge is
// keyed by the owning tab id (see forwarding below), but the actual pending resume may
// belong to a non-primary pane forwarded onto that tab (N5) — cancel whichever session
// under this tab id actually has one scheduled.
ipcMain.handle(IpcChannel.ResumeCancel, (e, raw): { ok: true } | { error: string } => {
  const parsed = ResumeCancelPayloadSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.message };
  if (!isChromeSender(e.sender)) return { error: 'not authorized for this session' };
  const tabId = parsed.data.sessionId;
  sessionManager.cancelResume(tabId);
  for (const [paneId, owner] of paneOwnership) {
    if (owner === tabId) sessionManager.cancelResume(paneId);
  }
  return { ok: true };
});

// Forward resume lifecycle events to the chrome renderer for the countdown badge.
// sessionManager emits with the *raw* session id, which may be a non-primary pane —
// chrome only tracks tab-level sessions, so an unmapped pane id is silently dropped
// (N5). Map through paneOwnership, mirroring attention's tabIdForSession.
sessionManager.on('resumeScheduled', (sessionId, resetAt) => {
  const tabId = paneOwnership.get(sessionId) ?? sessionId;
  chromeWindow?.webContents.send(IpcChannel.ResumeScheduled, { sessionId: tabId, resetAt });
});
sessionManager.on('resumeCancelled', (sessionId) => {
  const tabId = paneOwnership.get(sessionId) ?? sessionId;
  chromeWindow?.webContents.send(IpcChannel.ResumeCancelled, { sessionId: tabId });
});
sessionManager.on('resumeFired', (sessionId) => {
  const tabId = paneOwnership.get(sessionId) ?? sessionId;
  chromeWindow?.webContents.send(IpcChannel.ResumeFired, { sessionId: tabId });
});

sessionManager.on('sessionExited', (sessionId) => {
  crashCounters.delete(sessionId);
  // Spec §7: a tab (or pane) whose shell exits on its own stays visible, read-only —
  // the WebContentsView/leaf is kept so scrollback stays readable and the user can
  // Restart or Close it. Teardown happens only via an explicit close (core.session.close
  // or core.session.close-pane). A pane still owned by a tab must keep its paneOwnership
  // entry so a later close-pane on its primary can find and reparent onto it (N4).
});

/** Full teardown of a tab: destroy its view, its panes, persist, then kill the PTY.
 * Invoked only when the tab's last pane closes. */
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

/** A tab's primary pane closed while sibling panes are still alive: promote one
 * sibling to be the tab's new primary/tabId instead of tearing the whole tab down
 * (H2 — "Close Pane" on the primary pane must not kill the surviving siblings). */
function reparentTab(oldTabId: string, newTabId: string): void {
  const meta = tabMeta.get(oldTabId);
  if (!meta) return;
  tabMeta.delete(oldTabId);
  // meta.splits describes the tree as it stood *before* the closed primary's leaf was
  // removed — copying it verbatim would resurrect that pane on next restore. Drop it;
  // the renderer's retarget() always sends a corrected persist right after this (N1).
  const metaWithoutSplits = { ...meta, tabId: newTabId };
  delete metaWithoutSplits.splits;
  tabMeta.set(newTabId, metaWithoutSplits);
  tabOrder = tabOrder.map((id) => (id === oldTabId ? newTabId : id));
  // The promoted session was created with kind 'pane' — relabel it 'tab' so a fresh
  // chrome bootstrap (or any other SessionManager.list() consumer) doesn't filter it
  // out as a pane (N3).
  sessionManager.get(newTabId)?.promoteToTab();
  paneOwnership.delete(newTabId);
  for (const [paneId, owner] of paneOwnership) {
    if (owner === oldTabId) paneOwnership.set(paneId, newTabId);
  }
  viewManager?.rekey(oldTabId, newTabId);
  if (focusedSessionId === oldTabId) focusedSessionId = newTabId;
  const wc = viewManager?.get(newTabId)?.webContents;
  wc?.send(IpcChannel.LayoutTabReparented, { oldTabId, newTabId });
  chromeWindow?.webContents.send(IpcChannel.LayoutTabReparented, { oldTabId, newTabId });
  persistTabs();
}

/** Routes a terminal's pane close (core.session.close-pane) to the right teardown
 *  (R3 — distinct from core.session.close, which is chrome's whole-tab close):
 *  - a non-primary pane just ends its own session, the tab is untouched;
 *  - a tab's primary pane with surviving siblings triggers a reparent, not teardown;
 *  - a tab's primary pane with no other panes (or an unknown id) gets the full
 *    tab teardown. */
function handleSessionClosePane(sessionId: string): void {
  if (tabMeta.has(sessionId)) {
    const siblingPaneId = Array.from(paneOwnership.entries())
      .find(([, owner]) => owner === sessionId)?.[0];
    if (siblingPaneId) {
      reparentTab(sessionId, siblingPaneId);
      sessionManager.close(sessionId);
      return;
    }
    closeTab(sessionId);
    return;
  }
  paneOwnership.delete(sessionId);
  sessionManager.close(sessionId);
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

ipcRouter.onViewportSize((width, height) => {
  viewManager?.setViewport(width, height);
});

ipcRouter.onSetSidebarWidth((widthPx) => {
  viewManager?.setSidebarWidth(widthPx);
});

// B3: unlike bootstrapSessions' restore path (which already degrades gracefully with
// a $HOME retry + console.warn), this is always a live user action — New Session
// dialog, "open recent", or "duplicate tab" — so a spawn failure must reach the user,
// not just devtools.
ipcRouter.onSessionCreate(async (opts) => {
  try {
    return await createTabSession(opts);
  } catch (err) {
    const { title, message } = formatSessionCreateError(opts.shell, err);
    dialog.showErrorBox(title, message);
    throw err;
  }
});

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

// terminal-host clicked a .md link → resolve the owning tab + provenance, then ask the
// chrome to open it in that tab's reader.
ipcRouter.onDocOpen((sessionId, path) => {
  const tabId = paneOwnership.get(sessionId) ?? sessionId;
  const meta = tabMeta.get(tabId);
  const cwd = meta?.cwd ?? homedir();
  const resolvedPath = isAbsolute(path) ? path : join(cwd, path);
  // L2: only open docs that live under the tab's cwd. Terminal output is untrusted —
  // a printed absolute path pointing elsewhere on disk (e.g. ~/.ssh/README.md) must
  // not let a click read arbitrary files, regardless of size/extension checks. This is
  // only an early bail for the click path — FsReadFile (N6) is the actual boundary,
  // since the doc-restore path bypasses this handler entirely.
  if (!isPathInside(cwd, resolvedPath)) return;
  const session = sessionManager.get(sessionId) ?? sessionManager.get(tabId);
  const info = session?.info();
  chromeWindow?.webContents.send(IpcChannel.DocOpenRequest, {
    tabId,
    rawPath: path,
    resolvedPath,
    provenanceTitle: info?.title ?? meta?.title ?? meta?.shell ?? 'session',
    provenanceStatus: info?.status ?? 'running',
  });
});

// chrome persists a tab's reader docs (markers survive restart; content does not).
ipcRouter.onPersistDocs((tabId, docs: PersistedOpenDoc[], activeDocIndex) => {
  const meta = tabMeta.get(tabId);
  if (!meta) return;
  if (docs.length === 0) {
    delete meta.docs;
    delete meta.activeDocIndex;
  } else {
    meta.docs = docs;
    meta.activeDocIndex = activeDocIndex;
  }
  persistTabs();
});

// chrome asks for a tab's persisted reader docs when it restores the tab.
ipcRouter.onDocsForTab((tabId) => {
  const meta = tabMeta.get(tabId);
  return { docs: meta?.docs ?? [], activeDocIndex: meta?.activeDocIndex ?? null };
});

// Chrome's tab-strip close: always full teardown, panes included (R3).
ipcRouter.onSessionClose((sessionId) => closeTab(sessionId));

// A terminal's own pane close → routed to pane-close, reparent, or full tab teardown.
ipcRouter.onSessionClosePane((sessionId) => handleSessionClosePane(sessionId));

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

/** Focus a session and show its view, telling the chrome renderer to follow (C8). */
function focusAndShow(sessionId: string): void {
  focusedSessionId = sessionId;
  viewManager?.show(sessionId);
  chromeWindow?.webContents.send(IpcChannel.LayoutShow, { sessionId });
}

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
      preload: preloadPath('chrome'),
      sandbox: true,
      contextIsolation: true,
    },
  });

  viewManager = new ViewManager({
    preloadPath: preloadPath('terminal'),
    onCrash: (sessionId) => handleRendererCrash(sessionId),
  });
  viewManager.attach(chromeWindow);
  Menu.setApplicationMenu(buildAppMenu(
    () => chromeWindow,
    () => focusedSessionId ? (viewManager?.get(focusedSessionId) ?? null) : null,
  ));

  // Load persisted settings BEFORE the renderer loads. The chrome renderer's start()
  // fires SettingsGet/RecentList the instant its page loads; if we loaded settings after
  // loadURL, the async file read would yield the event loop and those IPC calls would be
  // answered with the empty in-memory default (defaultCwd: '', recentTabs: []) — which
  // never self-corrects (SettingsChanged only fires on user update). Loading here
  // guarantees appSettings is populated before the renderer can query it.
  appSettings = await settingsStore.load();
  sessionManager.applyAutoResumeConfig(appSettings.autoResume);

  await (() => {
    const entry = rendererEntry('chrome');
    if (entry.url) return chromeWindow!.webContents.loadURL(entry.url);
    return chromeWindow!.webContents.loadFile(entry.file!);
  })();
  ipcRouter.subscribe(chromeWindow.webContents);
  ipcRouter.setChromeWebContents(chromeWindow.webContents);

  if (tabOrder.length > 0) {
    // H3: sessions already exist from a previous window in this run (macOS dock-reopen
    // after the window closed without quitting — window-all-closed doesn't quit on
    // darwin and closing the window never tears down sessions). Re-bootstrapping here
    // would spawn a duplicate PTY per persisted tab and double the saved layout on the
    // next persist. Instead, reattach fresh views to the surviving primary sessions.
    //
    // R5: persisted split leaves carry no session ids (split-container.ts serializeNode
    // only stores {kind:'leaf'}), so the fresh renderer's restoreFromSaved() always
    // rebuilds the split tree via splitFocused -> SessionCreateForPane, creating brand
    // new pane PTYs regardless of what we rebind here. Rebinding the old pane sessions
    // (as before) left them alive but unused — a PTY + paneOwnership leak on every
    // dock-reopen of a split tab. Close them first so nothing is orphaned; the renderer
    // recreates the same shape from the persisted tree. Trade-off: pane scrollback is
    // lost on dock-reopen — acceptable, and strictly better than leaking.
    // C8: close every tab's panes (cheap, synchronous) before creating any view, then
    // create all views concurrently — createSessionView's loadURL/loadFile await was
    // serializing every tab's page load (~100-300ms each) for no reason; nothing here
    // depends on another tab's view existing first.
    for (const tabId of tabOrder) closeTabPanes(tabId);
    await Promise.all(tabOrder.map((tabId) => createSessionView(tabId)));
    focusAndShow(focusedSessionId && tabMeta.has(focusedSessionId) ? focusedSessionId : tabOrder[0]!);
  } else {
    // Restore the persisted layout. Returns null when there is nothing to restore (first
    // launch, or the user closed every tab before quitting) — the app then boots into the
    // welcome/empty state and never auto-opens a tab.
    const restoredFocus = await bootstrapSessions({
      loadPersisted: () => sessionStore.load(),
      createTabSession: (opts) => createTabSession(opts),
    });
    if (restoredFocus) focusAndShow(restoredFocus);
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
  try {
    await sessionManager.closeAll();
  } finally {
    // A rejection from closeAll() must not leave the app un-quittable — always reach
    // exit. app.exit() does not emit 'quit', so flush the IPC log here before exiting.
    void ipcLogger?.close();
    app.exit(0);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Safety net for the no-open-sessions quit path (before-quit returns early there).
app.on('quit', () => {
  void ipcLogger?.close();
});
