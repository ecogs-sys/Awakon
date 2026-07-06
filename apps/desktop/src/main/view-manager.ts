import { BrowserWindow, WebContentsView } from 'electron';
import type { SessionId } from '@awakon/contracts';

// Chrome lays out as a vertical stack: titlebar above tab strip above the body.
// The WebContentsView overlay must start below BOTH, not just the titlebar, or
// terminal content paints over the tab strip. These match the CSS layout tokens
// --titlebar-h (44px) and --tabbar-h (39px) in styles/tokens.css.
const TITLEBAR_PX = 44;
const TAB_BAR_PX = 39;
const CHROME_TOP_PX = TITLEBAR_PX + TAB_BAR_PX; // 83
const SIDEBAR_OPEN_PX = 260; // matches CSS --sidebar-w
const SIDEBAR_COLLAPSED_PX = 56;

export interface ViewLoadEntry {
  url?: string;
  file?: string;
  query?: Record<string, string>;
}

export interface ViewManagerOptions {
  preloadPath: string;
  onCrash?: (sessionId: SessionId, view: WebContentsView) => void;
}

/**
 * Owns a WebContentsView per session and positions exactly one view at a time inside the
 * chrome window. Sidebar width and tab-strip height are tracked here so we don't have to
 * round-trip layout decisions through the renderer on every resize.
 */
export class ViewManager {
  private readonly views = new Map<SessionId, WebContentsView>();
  /** The id each view is *currently* keyed under — rekey() updates this in place so the
   * render-process-gone listener (registered once, at create time) always resolves the
   * live id instead of the stale one captured in its closure (N2). */
  private readonly liveIdOf = new WeakMap<WebContentsView, SessionId>();
  private parent: BrowserWindow | null = null;
  private currentSessionId: SessionId | null = null;
  private sidebarPx = SIDEBAR_OPEN_PX;
  private viewport: { width: number; height: number } | null = null;

  constructor(private readonly opts: ViewManagerOptions) {}

  attach(window: BrowserWindow): void {
    this.parent = window;
    // The main process drives layout on its own resize/maximize events where it can, but
    // on some Linux WMs neither 'resize' nor 'maximize' fires reliably after maximize, and
    // getContentBounds() can stay at the pre-maximize size. The renderer (which always
    // reflows correctly) is therefore the authoritative size source — see setViewport(),
    // fed by the LayoutViewportSize IPC. These listeners are a harmless fallback.
    window.on('resize', () => this.layout());
    window.on('maximize', () => this.layout());
    window.on('unmaximize', () => this.layout());
  }

  /** Record the renderer's measured viewport (CSS px == DIP) and re-layout. This is the
   * authoritative content-area size; getContentBounds() is only a fallback. */
  setViewport(width: number, height: number): void {
    this.viewport = { width, height };
    this.layout();
  }

  setSidebarWidth(px: number): void {
    this.sidebarPx = Math.max(SIDEBAR_COLLAPSED_PX, px);
    this.layout();
  }

  has(sessionId: SessionId): boolean {
    return this.views.has(sessionId);
  }

  get(sessionId: SessionId): WebContentsView | undefined {
    return this.views.get(sessionId);
  }

  /** Whether `wc` is the webContents of a view this ViewManager currently owns — used to
   * authorize IPC channels legitimately callable from any terminal view (not just chrome),
   * e.g. ChromeOpenExternal for a link clicked in terminal output. */
  ownsWebContents(wc: Electron.WebContents): boolean {
    for (const view of this.views.values()) {
      if (view.webContents === wc) return true;
    }
    return false;
  }

  create(sessionId: SessionId): WebContentsView {
    if (!this.parent) throw new Error('ViewManager.create called before attach');
    const view = new WebContentsView({
      webPreferences: {
        preload: this.opts.preloadPath,
        sandbox: true,
        contextIsolation: true,
      },
    });
    this.parent.contentView.addChildView(view);
    this.views.set(sessionId, view);
    this.liveIdOf.set(view, sessionId);
    this.hideOne(view);

    view.webContents.on('render-process-gone', () => {
      const liveId = this.liveIdOf.get(view);
      if (liveId) this.opts.onCrash?.(liveId, view);
    });

    return view;
  }

  async load(sessionId: SessionId, entry: ViewLoadEntry): Promise<void> {
    const view = this.views.get(sessionId);
    if (!view) throw new Error(`ViewManager.load: unknown sessionId ${sessionId}`);
    if (entry.url) {
      const url = entry.query
        ? `${entry.url}?${new URLSearchParams(entry.query).toString()}`
        : entry.url;
      await view.webContents.loadURL(url);
    } else if (entry.file) {
      const options = entry.query ? { query: entry.query } : undefined;
      await view.webContents.loadFile(entry.file, options);
    }
  }

  show(sessionId: SessionId): void {
    if (!this.parent) return;
    const view = this.views.get(sessionId);
    if (!view) return;
    for (const [otherId, otherView] of this.views) {
      if (otherId !== sessionId) this.hideOne(otherView);
    }
    this.currentSessionId = sessionId;
    this.applyVisibleBounds(view);
    view.webContents.focus();
  }

  destroy(sessionId: SessionId): void {
    const view = this.views.get(sessionId);
    if (!view) return;
    if (this.parent) this.parent.contentView.removeChildView(view);
    // WebContentsView has no destroy(); closing the webContents detaches and frees it.
    view.webContents.close();
    this.views.delete(sessionId);
    if (this.currentSessionId === sessionId) {
      this.currentSessionId = null;
    }
  }

  /** Re-position whichever view is currently visible. Called on parent resize. */
  layout(): void {
    if (!this.parent || !this.currentSessionId) return;
    const view = this.views.get(this.currentSessionId);
    if (view) this.applyVisibleBounds(view);
  }

  /** Move the visible view offscreen so a chrome-level modal is not obscured by the
   * native overlay. `currentSessionId` is preserved so `resume()` restores it. */
  suspend(): void {
    if (!this.currentSessionId) return;
    const view = this.views.get(this.currentSessionId);
    if (view) this.hideOne(view);
  }

  /** Restore the previously-visible view after a modal closes. */
  resume(): void {
    this.layout();
  }

  /** Rekey a view from an old session id to a new one, in place — used when a tab's
   * primary pane closes and a sibling pane is promoted to take over its identity
   * (H2: closing the primary pane must not tear down the tab's view). */
  rekey(oldId: SessionId, newId: SessionId): void {
    const view = this.views.get(oldId);
    if (!view) return;
    this.views.delete(oldId);
    this.views.set(newId, view);
    this.liveIdOf.set(view, newId);
    if (this.currentSessionId === oldId) this.currentSessionId = newId;
  }

  /** Replace the underlying WebContentsView for a session (used during crash recovery). */
  replaceView(sessionId: SessionId): WebContentsView | null {
    const old = this.views.get(sessionId);
    if (!old || !this.parent) return null;
    this.parent.contentView.removeChildView(old);
    try {
      old.webContents.close();
    } catch {
      /* ignore */
    }
    this.views.delete(sessionId);
    const fresh = this.create(sessionId);
    return fresh;
  }

  private applyVisibleBounds(view: WebContentsView): void {
    if (!this.parent) return;
    // Prefer the renderer-reported viewport (reliable across WMs); fall back to
    // getContentBounds() before the first viewport report arrives.
    const { width, height } = this.viewport ?? this.parent.getContentBounds();
    view.setBounds({
      x: this.sidebarPx,
      y: CHROME_TOP_PX,
      width: Math.max(0, width - this.sidebarPx),
      height: Math.max(0, height - CHROME_TOP_PX),
    });
  }

  private hideOne(view: WebContentsView): void {
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }
}
