import { BrowserWindow, WebContentsView } from 'electron';
import type { SessionId } from '@awakon/contracts';

// Chrome lays out as a vertical stack: titlebar (32px) above tab strip (36px) above
// the body. The WebContentsView overlay must start below BOTH, not just the titlebar,
// or terminal content paints over the tab strip.
const TITLEBAR_PX = 32;
const TAB_BAR_PX = 36;
const CHROME_TOP_PX = TITLEBAR_PX + TAB_BAR_PX; // 68
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
  private parent: BrowserWindow | null = null;
  private currentSessionId: SessionId | null = null;
  private sidebarPx = SIDEBAR_OPEN_PX;

  constructor(private readonly opts: ViewManagerOptions) {}

  attach(window: BrowserWindow): void {
    this.parent = window;
    window.on('resize', () => this.layout());
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

  create(sessionId: SessionId): WebContentsView {
    if (!this.parent) throw new Error('ViewManager.create called before attach');
    const view = new WebContentsView({
      webPreferences: {
        preload: this.opts.preloadPath,
        sandbox: false,
        contextIsolation: true,
      },
    });
    this.parent.contentView.addChildView(view);
    this.views.set(sessionId, view);
    this.hideOne(view);

    view.webContents.on('render-process-gone', () => {
      this.opts.onCrash?.(sessionId, view);
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
    const { width, height } = this.parent.getContentBounds();
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
