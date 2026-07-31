import { BrowserWindow, Notification } from 'electron';
import type { SessionManager } from '@awakon/core';
import { NotificationService } from '@awakon/core';
import type { AttentionEvent, SessionId } from '@awakon/contracts';
import { IpcChannel } from '@awakon/contracts';
import type { ViewManager } from './view-manager.js';

export interface NotificationBridgeDeps {
  sessionManager: SessionManager;
  viewManager: () => ViewManager | null;
  chromeWindow: () => BrowserWindow | null;
  focusedSessionId: () => SessionId | null;
  /** Resolve a session id to the id of the tab that owns it. For a tab session this
   * is the id itself; for a pane session it is the owning tab's primary session id. */
  tabIdForSession: (sessionId: SessionId) => SessionId;
}

/** OS notification titles must stay short; matches NotificationRequestSchema's 120 cap. */
const NOTIFICATION_TITLE_MAX = 120;
function clampTitle(title: string): string {
  return title.length <= NOTIFICATION_TITLE_MAX
    ? title
    : `${title.slice(0, NOTIFICATION_TITLE_MAX - 1)}…`;
}

export class NotificationBridge {
  private readonly service: NotificationService;

  constructor(private readonly deps: NotificationBridgeDeps) {
    this.service = new NotificationService(Notification as unknown as new (opts: { title: string; body: string }) => InstanceType<typeof Notification>);
    this.service.onClick((sessionId) => this.handleClick(sessionId));
    this.deps.sessionManager.on('sessionAttention', (ev) => this.handleAttention(ev));
    this.deps.sessionManager.on('sessionExited', (sessionId) => this.service.forget(sessionId));
  }

  private handleAttention(ev: AttentionEvent): void {
    const win = this.deps.chromeWindow();
    const focused = this.deps.focusedSessionId();
    const windowFocused = win?.isFocused() ?? false;
    // Attention may come from a pane — compare against the owning tab.
    const tabFocused = focused === this.deps.tabIdForSession(ev.sessionId);
    if (windowFocused && tabFocused) return;
    const info = this.deps.sessionManager.list().find((s) => s.id === ev.sessionId);
    const title = clampTitle(`${info?.title ?? 'Awakon session'} needs you`);
    this.service.notify({
      sessionId: ev.sessionId,
      title,
      body: ev.snippet?.trim().slice(0, 240) ?? `Signal: ${ev.signal}`,
    });
  }

  private handleClick(sessionId: SessionId): void {
    const win = this.deps.chromeWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    // A pane has no view of its own — focus the tab that owns it.
    const tabId = this.deps.tabIdForSession(sessionId);
    const vm = this.deps.viewManager();
    vm?.show(tabId);
    // Also tell the chrome renderer to update its focused tab + clear the badge.
    win?.webContents.send(IpcChannel.LayoutShow, { sessionId: tabId });
  }
}
