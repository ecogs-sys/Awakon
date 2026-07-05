import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  AttentionEvent,
  AutoResumeSettings,
  SessionCreateOptions,
  SessionId,
  SessionInfo,
  SessionKind,
} from '@awakon/contracts';
import { Session } from './session.js';
import { ResumeScheduler } from './resume-scheduler.js';
import { parseResetTime } from './reset-time-parser.js';

export interface SessionManagerEvents {
  sessionCreated: (info: SessionInfo) => void;
  sessionData: (sessionId: SessionId, chunk: Buffer) => void;
  sessionExited: (sessionId: SessionId, exitCode: number | null, signal: string | null) => void;
  sessionTitleChanged: (sessionId: SessionId, title: string) => void;
  sessionAttention: (ev: AttentionEvent) => void;
  resumeScheduled: (sessionId: SessionId, resetAt: number) => void;
  resumeCancelled: (sessionId: SessionId) => void;
  resumeFired: (sessionId: SessionId) => void;
}

/**
 * Source of truth for all sessions in the main process. Plan 1 supports any number of sessions
 * (the data structures handle N) but the desktop app only ever creates one. Plan 2 adds the
 * tab UI that lets the user open more.
 */
export class SessionManager extends EventEmitter {
  private readonly sessions = new Map<SessionId, Session>();
  private autoResume: AutoResumeSettings = { enabled: false, detectText: '', responseText: '', resumeText: '' };
  private readonly resumeScheduler = new ResumeScheduler({
    onDue: (sessionId) => this.fireResume(sessionId),
  });
  /** sessionId -> epoch ms of the last stage-1 answer. Guards against detector
   * false->true churn (redraw cycles) re-firing the menu-answer write (N11). */
  private readonly lastAnsweredAt = new Map<SessionId, number>();
  /** Real rate-limit hits are hours apart; menu redraw churn is seconds apart. */
  private static readonly RESPONSE_COOLDOWN_MS = 5 * 60_000;

  create(opts: SessionCreateOptions, kind: SessionKind = 'tab'): Session {
    const id: SessionId = randomUUID();
    const session = new Session(id, opts, kind);
    this.sessions.set(id, session);

    session.on('data', (chunk) => this.emit('sessionData', id, chunk));
    session.on('exit', ({ exitCode, signal }) => {
      this.resumeScheduler.cancel(id);
      this.lastAnsweredAt.delete(id);
      this.emit('sessionExited', id, exitCode, signal);
      // Keep the session in the map so its ring buffer is still readable for a moment;
      // callers explicitly call close() to remove. (See Plan 1 success criteria — clean shutdown
      // calls closeAll().)
    });
    session.on('titleChanged', (title) => this.emit('sessionTitleChanged', id, title));
    session.on('attention', (ev) => this.emit('sessionAttention', ev));
    // The rate-limit prompt is an interactive menu ("1. Stop and wait for limit
    // to reset" / "2. Upgrade your plan") that must be answered while it is on
    // screen. Two-stage auto-resume (M6): Stage 1 answers the menu now —
    // responseText ('1') selects "wait for reset", which Claude Code itself
    // waits on. Stage 2 schedules a "continue" nudge for after the parsed reset
    // time, in case Claude Code did not already resume on its own.
    session.on('rateLimitDetected', (resetText) => {
      if (!this.autoResume.enabled) return;
      if (session.info().status === 'exited') return;
      // A resume already pending means stage 1 already answered this hit — a
      // redraw-triggered re-detection must not answer again (N11).
      if (this.resumeScheduler.has(id)) return;
      const now = Date.now();
      const last = this.lastAnsweredAt.get(id);
      if (last !== undefined && now - last < SessionManager.RESPONSE_COOLDOWN_MS) return;
      this.lastAnsweredAt.set(id, now);
      session.write(`${this.autoResume.responseText}\r`, { synthetic: true });
      const resetAt = parseResetTime(resetText, new Date());
      if (resetAt !== null && this.resumeScheduler.schedule(id, resetAt)) {
        this.emit('resumeScheduled', id, resetAt);
      }
      // If parsing fails, stage 1 already answered the menu and Claude Code waits on
      // its own — no schedule, no badge; the cooldown above still guards this path.
    });

    session.setRateLimitDetectText(this.autoResume.enabled ? this.autoResume.detectText : '');
    this.emit('sessionCreated', session.info());
    return session;
  }

  get(id: SessionId): Session | undefined {
    return this.sessions.get(id);
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values(), (s) => s.info());
  }

  write(id: SessionId, data: Buffer | string): void {
    this.sessions.get(id)?.write(data);
  }

  resize(id: SessionId, cols: number, rows: number): void {
    this.sessions.get(id)?.resize(cols, rows);
  }

  close(id: SessionId, timeoutMs = 1500): void {
    const session = this.sessions.get(id);
    if (!session) return;

    // Short-circuit if already exited: remove from map immediately.
    if (session.info().status === 'exited') {
      this.sessions.delete(id);
      return;
    }

    const timer = setTimeout(() => {
      session.kill('SIGKILL');
      this.sessions.delete(id);
    }, timeoutMs);
    session.once('exit', () => {
      clearTimeout(timer);
      this.sessions.delete(id);
    });
    session.kill('SIGHUP');
  }

  /** Apply auto-resume settings: push the detect phrase to every session and,
   * when disabling, cancel every pending resume. */
  applyAutoResumeConfig(config: AutoResumeSettings): void {
    this.autoResume = config;
    const detect = config.enabled ? config.detectText : '';
    for (const session of this.sessions.values()) {
      session.setRateLimitDetectText(detect);
    }
    if (!config.enabled) {
      for (const sessionId of this.resumeScheduler.cancelAll()) {
        this.emit('resumeCancelled', sessionId);
      }
    }
  }

  /** Cancel a pending resume (user clicked the badge's cancel control). */
  cancelResume(sessionId: SessionId): void {
    if (this.resumeScheduler.cancel(sessionId)) {
      this.emit('resumeCancelled', sessionId);
    }
  }

  /** Invoked by the scheduler when a resume is due: type resumeText ('continue') into
   * the tab — a nudge in case Claude Code did not already self-resume after stage 1. */
  private fireResume(sessionId: SessionId): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.info().status === 'exited') return;
    session.write(`${this.autoResume.resumeText}\r`, { synthetic: true });
    this.emit('resumeFired', sessionId);
  }

  async closeAll(timeoutMs = 1500): Promise<void> {
    const closes = Array.from(this.sessions.values()).map(
      (session) =>
        new Promise<void>((resolve) => {
          if (session.info().status === 'exited') {
            resolve();
            return;
          }
          const timer = setTimeout(() => {
            session.kill('SIGKILL');
            resolve();
          }, timeoutMs);
          session.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
          session.kill('SIGHUP');
        }),
    );
    await Promise.all(closes);
    this.sessions.clear();
    this.resumeScheduler.dispose();
  }
}

export interface SessionManager {
  on<K extends keyof SessionManagerEvents>(event: K, listener: SessionManagerEvents[K]): this;
  emit<K extends keyof SessionManagerEvents>(
    event: K,
    ...args: Parameters<SessionManagerEvents[K]>
  ): boolean;
}
