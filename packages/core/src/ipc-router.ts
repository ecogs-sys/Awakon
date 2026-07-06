import type { IpcMain, WebContents } from 'electron';
import {
  IpcChannel,
  SessionCreateOptionsSchema,
  SessionCreateForPanePayloadSchema,
  SessionWritePayloadSchema,
  SessionResizePayloadSchema,
  SessionClosePayloadSchema,
  SessionSetTitlePayloadSchema,
  SessionRestartViewPayloadSchema,
  SessionReplayPayloadSchema,
  LayoutShowPayloadSchema,
  LayoutSetSidebarWidthPayloadSchema,
  LayoutViewportSizePayloadSchema,
  LayoutModalPayloadSchema,
  LayoutReorderTabsPayloadSchema,
  LayoutPersistSplitsPayloadSchema,
  LayoutSplitsForTabPayloadSchema,
  DocOpenPayloadSchema,
  LayoutPersistDocsPayloadSchema,
  LayoutDocsForTabPayloadSchema,
} from '@awakon/contracts';
import type {
  AttentionEvent,
  PersistedSplitNode,
  PersistedOpenDoc,
  SessionCreateOptions,
  SessionId,
  SessionInfo,
  SessionReplayResponse,
} from '@awakon/contracts';
import type { SessionManager } from './session-manager.js';

/**
 * Wires the SessionManager up to Electron IPC. Validates every inbound payload with Zod;
 * a validation failure (or a SessionManager.create() throw) returns a structured error
 * and never throws into the main loop.
 *
 * Outbound events (created/data/exit/title/attention) are broadcast to all subscribed
 * WebContents. Each WebContents subscribes once at preload time.
 */
export type LayoutShowCallback = (sessionId: SessionId) => void;
export type SetSidebarWidthCallback = (widthPx: number) => void;
export type ViewportSizeCallback = (width: number, height: number) => void;
export type SessionCreateCallback = (opts: SessionCreateOptions) => Promise<SessionInfo>;
export type SessionCreateForPaneCallback = (
  opts: SessionCreateOptions,
  tabId: SessionId,
) => SessionInfo;
export type LayoutModalCallback = (open: boolean) => void;
export type ReorderTabsCallback = (order: SessionId[]) => void;
export type SessionCloseCallback = (sessionId: SessionId) => void;
export type SessionClosePaneCallback = (sessionId: SessionId) => void;
export type RestartViewCallback = (sessionId: SessionId) => void;
export type PersistSplitsCallback = (
  tabId: SessionId,
  splits: PersistedSplitNode | null,
) => void;
export type SplitsForTabCallback = (tabId: SessionId) => PersistedSplitNode | null;
export type DocOpenCallback = (sessionId: SessionId, path: string) => void;
export type PersistDocsCallback = (
  tabId: SessionId,
  docs: PersistedOpenDoc[],
  activeDocIndex: number | null,
) => void;
export type DocsForTabCallback = (
  tabId: SessionId,
) => { docs: PersistedOpenDoc[]; activeDocIndex: number | null };

export class IpcRouter {
  private readonly subscribers = new Set<WebContents>();
  /** sessionId -> the WebContents that hosts it. High-volume session-data events are
   * sent only to the owning view instead of broadcast to every renderer. */
  private readonly sessionViews = new Map<SessionId, WebContents>();
  /** The chrome window's WebContents — trusted for any sessionId (e.g. closing any
   * tab), unlike a terminal view which only owns its own tab's sessions. */
  private chromeWebContents: WebContents | null = null;
  private layoutShowCallback: LayoutShowCallback | null = null;
  private setSidebarWidthCallback: SetSidebarWidthCallback | null = null;
  private viewportSizeCallback: ViewportSizeCallback | null = null;
  private sessionCreateCallback: SessionCreateCallback | null = null;
  private sessionCreateForPaneCallback: SessionCreateForPaneCallback | null = null;
  private layoutModalCallback: LayoutModalCallback | null = null;
  private reorderTabsCallback: ReorderTabsCallback | null = null;
  private sessionCloseCallback: SessionCloseCallback | null = null;
  private sessionClosePaneCallback: SessionClosePaneCallback | null = null;
  private restartViewCallback: RestartViewCallback | null = null;
  private persistSplitsCallback: PersistSplitsCallback | null = null;
  private splitsForTabCallback: SplitsForTabCallback | null = null;
  private docOpenCallback: DocOpenCallback | null = null;
  private persistDocsCallback: PersistDocsCallback | null = null;
  private docsForTabCallback: DocsForTabCallback | null = null;

  constructor(
    private readonly ipcMain: IpcMain,
    private readonly manager: SessionManager,
  ) {
    this.bindRequests();
    this.bindEvents();
  }

  /** Register a callback that the chrome renderer can trigger via core.layout.show. */
  onLayoutShow(cb: LayoutShowCallback): void {
    this.layoutShowCallback = cb;
  }

  onSetSidebarWidth(cb: SetSidebarWidthCallback): void {
    this.setSidebarWidthCallback = cb;
  }

  onViewportSize(cb: ViewportSizeCallback): void {
    this.viewportSizeCallback = cb;
  }

  onSessionCreate(cb: SessionCreateCallback): void {
    this.sessionCreateCallback = cb;
  }

  onSessionCreateForPane(cb: SessionCreateForPaneCallback): void {
    this.sessionCreateForPaneCallback = cb;
  }

  onLayoutModal(cb: LayoutModalCallback): void {
    this.layoutModalCallback = cb;
  }

  onReorderTabs(cb: ReorderTabsCallback): void {
    this.reorderTabsCallback = cb;
  }

  /** When set, core.session.close delegates to this instead of manager.close — lets
   * main run full tab teardown (view destroy, tabMeta + pane cleanup). Sent only by
   * chrome (the tab strip); always tears down the whole tab, panes included (R3). */
  onSessionClose(cb: SessionCloseCallback): void {
    this.sessionCloseCallback = cb;
  }

  /** Sent only by a terminal view closing its own focused pane (R3) — never affects
   * sibling panes or the tab itself. */
  onSessionClosePane(cb: SessionClosePaneCallback): void {
    this.sessionClosePaneCallback = cb;
  }

  onRestartView(cb: RestartViewCallback): void {
    this.restartViewCallback = cb;
  }

  onPersistSplits(cb: PersistSplitsCallback): void {
    this.persistSplitsCallback = cb;
  }

  onSplitsForTab(cb: SplitsForTabCallback): void {
    this.splitsForTabCallback = cb;
  }

  onDocOpen(cb: DocOpenCallback): void {
    this.docOpenCallback = cb;
  }

  onPersistDocs(cb: PersistDocsCallback): void {
    this.persistDocsCallback = cb;
  }

  onDocsForTab(cb: DocsForTabCallback): void {
    this.docsForTabCallback = cb;
  }

  subscribe(wc: WebContents): void {
    this.subscribers.add(wc);
    wc.once('destroyed', () => {
      this.subscribers.delete(wc);
      for (const [sessionId, viewWc] of this.sessionViews) {
        if (viewWc === wc) this.sessionViews.delete(sessionId);
      }
    });
  }

  /** Register which WebContents hosts a session, so its data events are routed there
   * directly. Panes share their owning tab's WebContents. */
  bindSessionView(sessionId: SessionId, wc: WebContents): void {
    this.sessionViews.set(sessionId, wc);
  }

  /** Mark the chrome window's WebContents as trusted for any sessionId (M2: unlike
   * a terminal view, chrome legitimately closes/manages tabs it doesn't "own"). */
  setChromeWebContents(wc: WebContents): void {
    this.chromeWebContents = wc;
  }

  /** M2: a terminal view must only write/resize/replay/close/doc-open sessions it
   * actually hosts (itself or its own panes, which share its WebContents) — never a
   * different tab's session. Chrome is exempt since it legitimately manages every tab. */
  private isAuthorizedSender(sender: WebContents, sessionId: SessionId): boolean {
    if (sender === this.chromeWebContents) return true;
    return this.sessionViews.get(sessionId) === sender;
  }

  /** Chrome-only channels (tab lifecycle, reader persistence): a terminal renderer has
   * no legitimate reason to call these, and none of them are scoped by a sessionId the
   * generic isAuthorizedSender check could key off of. */
  private isChromeSender(sender: WebContents): boolean {
    return sender === this.chromeWebContents;
  }

  private bindRequests(): void {
    this.ipcMain.handle(IpcChannel.SessionCreate, async (e, raw): Promise<SessionInfo | { error: string }> => {
      const parsed = SessionCreateOptionsSchema.safeParse(raw);
      if (!parsed.success) return { error: parsed.error.message };
      if (!this.isChromeSender(e.sender)) return { error: 'not authorized for this session' };
      try {
        if (this.sessionCreateCallback) {
          return await this.sessionCreateCallback(parsed.data);
        }
        return this.manager.create(parsed.data).info();
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    this.ipcMain.handle(IpcChannel.SessionCreateForPane, (e, raw): SessionInfo | { error: string } => {
      const parsed = SessionCreateForPanePayloadSchema.safeParse(raw);
      if (!parsed.success) return { error: parsed.error.message };
      // R6: the pane doesn't exist yet, so scope by the tabId it will belong to instead
      // of a sessionId — otherwise a compromised terminal renderer could spawn PTYs
      // attributed to any tab.
      if (!this.isAuthorizedSender(e.sender, parsed.data.tabId)) return { error: 'not authorized for this session' };
      try {
        // Note: NO view creation — this session lives as a pane inside the calling renderer.
        // kind='pane' so the chrome's SessionCreated handler ignores it (no phantom tab).
        const { tabId, ...opts } = parsed.data;
        if (this.sessionCreateForPaneCallback) {
          return this.sessionCreateForPaneCallback(opts, tabId);
        }
        return this.manager.create(opts, 'pane').info();
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    this.ipcMain.handle(IpcChannel.SessionWrite, (e, raw): { ok: true } | { error: string } => {
      const parsed = SessionWritePayloadSchema.safeParse(raw);
      if (!parsed.success) return { error: parsed.error.message };
      if (!this.isAuthorizedSender(e.sender, parsed.data.sessionId)) return { error: 'not authorized for this session' };
      const buf = Buffer.from(parsed.data.data, 'base64');
      this.manager.write(parsed.data.sessionId, buf);
      return { ok: true };
    });

    this.ipcMain.handle(IpcChannel.SessionResize, (e, raw): { ok: true } | { error: string } => {
      const parsed = SessionResizePayloadSchema.safeParse(raw);
      if (!parsed.success) return { error: parsed.error.message };
      if (!this.isAuthorizedSender(e.sender, parsed.data.sessionId)) return { error: 'not authorized for this session' };
      this.manager.resize(parsed.data.sessionId, parsed.data.cols, parsed.data.rows);
      return { ok: true };
    });

    this.ipcMain.handle(IpcChannel.SessionClose, (e, raw): { ok: true } | { error: string } => {
      const parsed = SessionClosePayloadSchema.safeParse(raw);
      if (!parsed.success) return { error: parsed.error.message };
      if (!this.isAuthorizedSender(e.sender, parsed.data.sessionId)) return { error: 'not authorized for this session' };
      if (this.sessionCloseCallback) this.sessionCloseCallback(parsed.data.sessionId);
      else this.manager.close(parsed.data.sessionId);
      return { ok: true };
    });

    this.ipcMain.handle(IpcChannel.SessionClosePane, (e, raw): { ok: true } | { error: string } => {
      const parsed = SessionClosePayloadSchema.safeParse(raw);
      if (!parsed.success) return { error: parsed.error.message };
      if (!this.isAuthorizedSender(e.sender, parsed.data.sessionId)) return { error: 'not authorized for this session' };
      if (this.sessionClosePaneCallback) this.sessionClosePaneCallback(parsed.data.sessionId);
      else this.manager.close(parsed.data.sessionId);
      return { ok: true };
    });

    this.ipcMain.handle(IpcChannel.SessionRestartView, (e, raw): { ok: true } | { error: string } => {
      const parsed = SessionRestartViewPayloadSchema.safeParse(raw);
      if (!parsed.success) return { error: parsed.error.message };
      if (!this.isChromeSender(e.sender)) return { error: 'not authorized for this session' };
      this.restartViewCallback?.(parsed.data.sessionId);
      return { ok: true };
    });

    this.ipcMain.handle(IpcChannel.SessionSetTitle, (e, raw): { ok: true } | { error: string } => {
      const parsed = SessionSetTitlePayloadSchema.safeParse(raw);
      if (!parsed.success) return { error: parsed.error.message };
      if (!this.isChromeSender(e.sender)) return { error: 'not authorized for this session' };
      // setTitle emits titleChanged -> broadcast as SessionTitleChanged; main also
      // listens to persist the new title into tabMeta.
      this.manager.get(parsed.data.sessionId)?.setTitle(parsed.data.title);
      return { ok: true };
    });

    this.ipcMain.handle(IpcChannel.SessionList, () => this.manager.list());

    this.ipcMain.handle(
      IpcChannel.SessionReplay,
      (e, raw): SessionReplayResponse | { error: string } => {
        const parsed = SessionReplayPayloadSchema.safeParse(raw);
        if (!parsed.success) return { error: parsed.error.message };
        if (!this.isAuthorizedSender(e.sender, parsed.data.sessionId)) return { error: 'not authorized for this session' };
        const session = this.manager.get(parsed.data.sessionId);
        if (!session) return { sessionId: parsed.data.sessionId, data: '' };
        return {
          sessionId: parsed.data.sessionId,
          data: session.ringBuffer.snapshot().toString('base64'),
        };
      },
    );

    this.ipcMain.handle(IpcChannel.LayoutShow, (_e, raw): { ok: true } | { error: string } => {
      const parsed = LayoutShowPayloadSchema.safeParse(raw);
      if (!parsed.success) return { error: parsed.error.message };
      this.layoutShowCallback?.(parsed.data.sessionId);
      return { ok: true };
    });

    this.ipcMain.handle(IpcChannel.LayoutSetSidebarWidth, (_e, raw): { ok: true } | { error: string } => {
      const parsed = LayoutSetSidebarWidthPayloadSchema.safeParse(raw);
      if (!parsed.success) return { error: parsed.error.message };
      this.setSidebarWidthCallback?.(parsed.data.widthPx);
      return { ok: true };
    });

    this.ipcMain.handle(IpcChannel.LayoutViewportSize, (_e, raw): { ok: true } | { error: string } => {
      const parsed = LayoutViewportSizePayloadSchema.safeParse(raw);
      if (!parsed.success) return { error: parsed.error.message };
      this.viewportSizeCallback?.(parsed.data.width, parsed.data.height);
      return { ok: true };
    });

    this.ipcMain.handle(IpcChannel.LayoutModal, (_e, raw): { ok: true } | { error: string } => {
      const parsed = LayoutModalPayloadSchema.safeParse(raw);
      if (!parsed.success) return { error: parsed.error.message };
      this.layoutModalCallback?.(parsed.data.open);
      return { ok: true };
    });

    this.ipcMain.handle(IpcChannel.LayoutReorderTabs, (_e, raw): { ok: true } | { error: string } => {
      const parsed = LayoutReorderTabsPayloadSchema.safeParse(raw);
      if (!parsed.success) return { error: parsed.error.message };
      this.reorderTabsCallback?.(parsed.data.order);
      return { ok: true };
    });

    this.ipcMain.handle(IpcChannel.LayoutPersistSplits, (e, raw): { ok: true } | { error: string } => {
      const parsed = LayoutPersistSplitsPayloadSchema.safeParse(raw);
      if (!parsed.success) return { error: parsed.error.message };
      // R6: without this, a compromised terminal renderer could overwrite another
      // tab's persisted split tree, corrupting its next restore.
      if (!this.isAuthorizedSender(e.sender, parsed.data.tabId)) return { error: 'not authorized for this session' };
      this.persistSplitsCallback?.(parsed.data.tabId, parsed.data.splits);
      return { ok: true };
    });

    this.ipcMain.handle(IpcChannel.LayoutSplitsForTab, (e, raw): PersistedSplitNode | null | { error: string } => {
      const parsed = LayoutSplitsForTabPayloadSchema.safeParse(raw);
      if (!parsed.success) return { error: parsed.error.message };
      // R6: without this, a compromised terminal renderer could read another tab's layout.
      if (!this.isAuthorizedSender(e.sender, parsed.data.tabId)) return { error: 'not authorized for this session' };
      return this.splitsForTabCallback?.(parsed.data.tabId) ?? null;
    });

    this.ipcMain.handle(IpcChannel.DocOpen, (e, raw): { ok: true } | { error: string } => {
      const parsed = DocOpenPayloadSchema.safeParse(raw);
      if (!parsed.success) return { error: parsed.error.message };
      if (!this.isAuthorizedSender(e.sender, parsed.data.sessionId)) return { error: 'not authorized for this session' };
      this.docOpenCallback?.(parsed.data.sessionId, parsed.data.path);
      return { ok: true };
    });

    this.ipcMain.handle(IpcChannel.LayoutPersistDocs, (e, raw): { ok: true } | { error: string } => {
      const parsed = LayoutPersistDocsPayloadSchema.safeParse(raw);
      if (!parsed.success) return { error: parsed.error.message };
      if (!this.isChromeSender(e.sender)) return { error: 'not authorized for this session' };
      this.persistDocsCallback?.(parsed.data.tabId, parsed.data.docs, parsed.data.activeDocIndex);
      return { ok: true };
    });

    this.ipcMain.handle(
      IpcChannel.LayoutDocsForTab,
      (e, raw): { docs: PersistedOpenDoc[]; activeDocIndex: number | null } | { error: string } => {
        const parsed = LayoutDocsForTabPayloadSchema.safeParse(raw);
        if (!parsed.success) return { error: parsed.error.message };
        if (!this.isChromeSender(e.sender)) return { error: 'not authorized for this session' };
        return this.docsForTabCallback?.(parsed.data.tabId) ?? { docs: [], activeDocIndex: null };
      },
    );
  }

  private bindEvents(): void {
    this.manager.on('sessionCreated', (info: SessionInfo) => {
      this.broadcast(IpcChannel.SessionCreated, { info });
    });

    this.manager.on('sessionData', (sessionId: SessionId, chunk: Buffer) => {
      const payload = { sessionId, data: chunk.toString('base64') };
      const wc = this.sessionViews.get(sessionId);
      if (wc) {
        // Route to the owning view only — avoids O(N^2) fan-out across all views.
        if (!wc.isDestroyed()) wc.send(IpcChannel.SessionData, payload);
      } else {
        // No mapping yet (early race) — fall back to broadcast so data is never lost.
        this.broadcast(IpcChannel.SessionData, payload);
      }
    });

    this.manager.on('sessionExited', (sessionId, exitCode, signal) => {
      this.broadcast(IpcChannel.SessionExited, { sessionId, exitCode, signal });
    });

    this.manager.on('sessionTitleChanged', (sessionId, title) => {
      this.broadcast(IpcChannel.SessionTitleChanged, { sessionId, title });
    });

    this.manager.on('sessionAttention', (ev: AttentionEvent) => {
      this.broadcast(IpcChannel.SessionAttention, ev);
    });
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const wc of this.subscribers) {
      if (wc.isDestroyed()) continue;
      wc.send(channel, payload);
    }
  }
}
