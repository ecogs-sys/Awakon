import { z } from 'zod';
import {
  AttentionEventSchema,
  SessionCreateOptionsSchema,
  SessionIdSchema,
  SessionInfoSchema,
  SessionStatusSchema,
  ShellSchema,
} from './session.js';
import { PersistedSplitNodeSchema, PersistedOpenDocSchema } from './persistence.js';
import { RecentTabSchema } from './recent.js';

/**
 * IPC channel names. Renderer -> Main are "core.*"; Main -> Renderer events are "event.*".
 * Both sides import these strings and the matching schemas — no string literals at call sites.
 */
export const IpcChannel = {
  // Requests (renderer -> main)
  SessionCreate: 'core.session.create',
  SessionCreateDefault: 'core.session.create-default',
  SessionCreateForPane: 'core.session.create-for-pane',
  SessionWrite: 'core.session.write',
  SessionResize: 'core.session.resize',
  SessionClose: 'core.session.close',
  SessionSetTitle: 'core.session.set-title',
  SessionRestartView: 'core.session.restart-view',
  SessionList: 'core.session.list',
  SessionReplay: 'core.session.replay',
  LayoutShow: 'core.layout.show',
  LayoutSetSidebarWidth: 'core.layout.set-sidebar-width',
  LayoutViewportSize: 'core.layout.viewport-size',
  LayoutModal: 'core.layout.modal',
  LayoutReorderTabs: 'core.layout.reorder-tabs',
  LayoutPersistSplits: 'core.layout.persist-splits',
  LayoutSplitsForTab: 'core.layout.splits-for-tab',
  LayoutDefaultCwd: 'core.layout.default-cwd',
  FsPickDirectory: 'core.fs.pick-directory',
  FsPathExists: 'core.fs.path-exists',
  SettingsGet: 'core.settings.get',
  SettingsUpdate: 'core.settings.update',
  ResumeCancel: 'core.resume.cancel',
  ChromeMenuPopup: 'core.chrome.menu-popup',
  ChromeAppMenuPopup: 'core.chrome.app-menu-popup',
  ChromeWindowControl: 'core.chrome.window-control',
  ChromeAppInfo: 'core.chrome.app-info',
  ChromeOpenExternal: 'core.chrome.open-external',
  RecentList: 'core.recent.list',
  RecentAdd:  'core.recent.add',
  FsReadFile: 'core.fs.read-file',
  DocOpen: 'core.doc.open',
  LayoutPersistDocs: 'core.layout.persist-docs',
  LayoutDocsForTab: 'core.layout.docs-for-tab',

  // Events (main -> renderer)
  SessionCreated: 'event.session.created',
  SessionData: 'event.session.data',
  SessionExited: 'event.session.exited',
  SessionTitleChanged: 'event.session.title-changed',
  SessionAttention: 'event.session.attention',
  SessionTabBroken: 'event.session.tab-broken',
  ActionInvoke: 'event.action.invoke',
  TerminalAction: 'event.terminal.action',
  SettingsChanged: 'event.settings.changed',
  ResumeScheduled: 'event.resume.scheduled',
  ResumeCancelled: 'event.resume.cancelled',
  ResumeFired: 'event.resume.fired',
  DocOpenRequest: 'event.doc.open-request',
} as const;

// --- Request payloads ---

export const SessionWritePayloadSchema = z.object({
  sessionId: SessionIdSchema,
  data: z.string(),
});

export const SessionResizePayloadSchema = z.object({
  sessionId: SessionIdSchema,
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

export const SessionClosePayloadSchema = z.object({
  sessionId: SessionIdSchema,
});

export const SessionSetTitlePayloadSchema = z.object({
  sessionId: SessionIdSchema,
  title: z.string().min(1).max(200),
});

export const SessionReplayPayloadSchema = z.object({
  sessionId: SessionIdSchema,
});

/** Recreate a crashed tab's WebContentsView (the PTY session is still alive). */
export const SessionRestartViewPayloadSchema = z.object({
  sessionId: SessionIdSchema,
});

export const SessionReplayResponseSchema = z.object({
  sessionId: SessionIdSchema,
  data: z.string(), // base64 of RingBuffer.snapshot()
});

export type SessionReplayResponse = z.infer<typeof SessionReplayResponseSchema>;

export const LayoutShowPayloadSchema = z.object({
  sessionId: SessionIdSchema,
});

export const LayoutSetSidebarWidthPayloadSchema = z.object({
  widthPx: z.number().int().min(0),
});

/** Sent by the chrome renderer with its measured viewport (window.innerWidth/Height) on
 * every resize. The renderer is the source of truth for the content area size because the
 * main process's getContentBounds() is unreliable on some Linux WMs after maximize. */
export const LayoutViewportSizePayloadSchema = z.object({
  width: z.number().int().min(0),
  height: z.number().int().min(0),
});

/** Sent by the chrome renderer to suspend/restore the terminal WebContentsView so a
 * chrome-level modal (e.g. NewSessionDialog) is not obscured by the native overlay. */
export const LayoutModalPayloadSchema = z.object({
  open: z.boolean(),
});

/** Sent after a drag-reorder so main can persist the authoritative tab order. */
export const LayoutReorderTabsPayloadSchema = z.object({
  order: z.array(SessionIdSchema),
});

/** Renderer reports a tab's serialized split tree so main can persist it.
 * `splits: null` means the tab is back to a single pane and the field should be cleared. */
export const LayoutPersistSplitsPayloadSchema = z.object({
  tabId: SessionIdSchema,
  splits: PersistedSplitNodeSchema.nullable(),
});

/** Renderer asks main for the saved split tree for its tab (called once on startup).
 * Main returns `null` when there is no saved tree. */
export const LayoutSplitsForTabPayloadSchema = z.object({
  tabId: SessionIdSchema,
});

/** Renderer asks main to open a native directory picker. `startPath` (if given) becomes
 * `defaultPath` on showOpenDialog. Response is the picked path or a cancelled marker. */
export const FsPickDirectoryPayloadSchema = z.object({
  startPath: z.string().optional(),
});
export const FsPickDirectoryResponseSchema = z.union([
  z.object({ path: z.string() }),
  z.object({ cancelled: z.literal(true) }),
]);

/** Renderer asks main whether a filesystem path exists and is a directory.
 * On any stat error (ENOENT, EACCES, ENOTDIR) the handler returns
 * `{ exists: false, isDirectory: false }` — never throws. */
export const FsPathExistsPayloadSchema = z.object({
  path: z.string().min(1),
});
export const FsPathExistsResponseSchema = z.object({
  exists: z.boolean(),
  isDirectory: z.boolean(),
});

/** Renderer asks main to popup() one of the named submenus from app-menu.ts at the
 * given screen coordinates. Used by the custom in-window titlebar on Windows/Linux. */
export const ChromeMenuPopupPayloadSchema = z.object({
  menu: z.enum(['File', 'Tabs', 'View', 'Window', 'Help']),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
});

/** Renderer asks main to popup() the full application menu (all top-level menus,
 * each with its submenu) at the given screen coordinates. Backs the top bar's
 * hamburger (⋯) button — the platform-neutral bar has no menu strip. */
export const ChromeAppMenuPopupPayloadSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
});

/** Renderer asks main to drive the BrowserWindow's min/max/close controls.
 * Used by the custom in-window titlebar on Windows/Linux. */
export const ChromeWindowControlPayloadSchema = z.object({
  action: z.enum(['minimize', 'maximize', 'close']),
});

/** Renderer asks main for runtime info to populate the About dialog. */
export const ChromeAppInfoResponseSchema = z.object({
  version:  z.string(),
  electron: z.string(),
  chromium: z.string(),
  node:     z.string(),
  v8:       z.string(),
  os:       z.string(),
});
export type ChromeAppInfoResponse = z.infer<typeof ChromeAppInfoResponseSchema>;

/** Renderer asks main to open a URL in the OS default browser. About dialog links. */
export const ChromeOpenExternalPayloadSchema = z.object({
  url: z.string().url(),
});

export const SessionCreateForPanePayloadSchema = z.object({
  shell: ShellSchema,
  cwd: z.string().min(1),
  cols: z.number().int().positive().default(80),
  rows: z.number().int().positive().default(24),
  /** Primary session id of the tab that owns this pane. Lets main close a tab's panes
   * when the tab closes, without affecting panes in other tabs. */
  tabId: SessionIdSchema,
});

export const RecentAddPayloadSchema = z.object({
  entry: RecentTabSchema,
});

export const RecentListResponseSchema = z.array(RecentTabSchema);
export type RecentListResponse = z.infer<typeof RecentListResponseSchema>;

// --- Event payloads ---

export const SessionCreatedEventSchema = z.object({
  info: SessionInfoSchema,
});

export const SessionDataEventSchema = z.object({
  sessionId: SessionIdSchema,
  data: z.string(),
});

export const SessionExitedEventSchema = z.object({
  sessionId: SessionIdSchema,
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
});

export const SessionTitleChangedEventSchema = z.object({
  sessionId: SessionIdSchema,
  title: z.string(),
});

export const SessionAttentionEventSchema = AttentionEventSchema;

/** Emitted when a tab's renderer crashed twice in 60s and auto-recovery stopped. */
export const SessionTabBrokenEventSchema = z.object({
  sessionId: SessionIdSchema,
});

export const ActionInvokePayloadSchema = z.object({
  action: z.string().min(1),
});

export const TerminalActionPayloadSchema = z.object({
  action: z.enum(['splitHorizontal', 'splitVertical', 'closePane']),
});

// --- Settings + resume payloads ---

export const ResumeCancelPayloadSchema = z.object({
  sessionId: SessionIdSchema,
});

export const ResumeScheduledEventSchema = z.object({
  sessionId: SessionIdSchema,
  resetAt: z.number().int(),
});

export const ResumeCancelledEventSchema = z.object({
  sessionId: SessionIdSchema,
});

export const ResumeFiredEventSchema = z.object({
  sessionId: SessionIdSchema,
});

// --- Doc reader payloads ---

/** Renderer/main reads a .md file's content for the reader. */
export const FsReadFilePayloadSchema = z.object({
  path: z.string().min(1),
});
export const FsReadFileResponseSchema = z.union([
  z.object({
    content: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    mtimeMs: z.number(),
  }),
  z.object({ tooLarge: z.literal(true), sizeBytes: z.number().int().nonnegative() }),
  z.object({ notFound: z.literal(true) }),
  z.object({ error: z.string() }),
]);

/** terminal-host -> main: the user clicked a .md link inside a pane. */
export const DocOpenPayloadSchema = z.object({
  sessionId: SessionIdSchema,
  path: z.string().min(1),
});

/** main -> chrome: open this doc in the owning tab's reader. */
export const DocOpenRequestEventSchema = z.object({
  tabId: SessionIdSchema,
  rawPath: z.string(),
  resolvedPath: z.string(),
  provenanceTitle: z.string(),
  provenanceStatus: SessionStatusSchema,
});

/** chrome -> main: persist a tab's reader docs (content excluded). */
export const LayoutPersistDocsPayloadSchema = z.object({
  tabId: SessionIdSchema,
  docs: z.array(PersistedOpenDocSchema),
  activeDocIndex: z.number().int().nullable(),
});

/** chrome -> main: fetch a tab's persisted reader docs (called on tab restore). */
export const LayoutDocsForTabPayloadSchema = z.object({
  tabId: SessionIdSchema,
});
export const LayoutDocsForTabResponseSchema = z.object({
  docs: z.array(PersistedOpenDocSchema),
  activeDocIndex: z.number().int().nullable(),
});

// Re-export for caller convenience.
export { SessionCreateOptionsSchema, SessionInfoSchema, SessionIdSchema, AttentionEventSchema };
