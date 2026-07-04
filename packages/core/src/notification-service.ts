import type { SessionId } from '@awakon/contracts';

/**
 * Minimal interface our service consumes from Electron's Notification class. Lets us
 * unit-test with a fake replacement in pure Node.
 */
export interface FakeNotification {
  show(): void;
  on(event: 'click', handler: () => void): void;
}

export type FakeNotificationCtor = new (opts: { title: string; body: string }) => FakeNotification;

export interface NotifyRequest {
  sessionId: SessionId;
  title: string;
  body: string;
}

export interface NotificationServiceOptions {
  /** Minimum milliseconds between notifications for the same session. Default 30_000. */
  coalesceMs?: number;
}

export class NotificationService {
  private readonly Ctor: FakeNotificationCtor;
  private readonly coalesceMs: number;
  private readonly lastShownAt = new Map<SessionId, number>();
  private clickCallback: ((sessionId: SessionId) => void) | null = null;

  constructor(Ctor: FakeNotificationCtor, opts: NotificationServiceOptions = {}) {
    this.Ctor = Ctor;
    this.coalesceMs = opts.coalesceMs ?? 30_000;
  }

  onClick(cb: (sessionId: SessionId) => void): void {
    this.clickCallback = cb;
  }

  /** Drop a closed session's coalescing timestamp (L7) — otherwise lastShownAt grows
   * for the lifetime of the app, one entry per session that ever attention-notified. */
  forget(sessionId: SessionId): void {
    this.lastShownAt.delete(sessionId);
  }

  notify(req: NotifyRequest): void {
    const now = Date.now();
    const last = this.lastShownAt.get(req.sessionId) ?? -Infinity;
    if (now - last < this.coalesceMs) return;
    this.lastShownAt.set(req.sessionId, now);

    const n = new this.Ctor({ title: req.title, body: req.body });
    n.on('click', () => this.clickCallback?.(req.sessionId));
    n.show();
  }
}
