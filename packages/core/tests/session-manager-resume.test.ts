import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { homedir, platform } from 'node:os';
import { SessionManager } from '../src/session-manager.js';
import { parseResetTime } from '../src/reset-time-parser.js';
import type { Shell } from '@awakon/contracts';

function defaultShell(): Shell {
  if (platform() === 'win32') return 'pwsh';
  if (platform() === 'darwin') return 'zsh';
  return 'bash';
}
function newSession(m: SessionManager) {
  return m.create({ shell: defaultShell(), cwd: homedir(), cols: 80, rows: 24 });
}

const RESET_TEXT = "You've hit your session limit · resets 12:50pm (Pacific/Auckland)";

// M6: two-stage auto-resume. Stage 1 answers the rate-limit menu the instant it's
// detected (responseText, '1' — "Stop and wait for limit to reset"). Stage 2 parses
// the reset time out of the detected text and schedules a resumeText ('continue')
// nudge for after it passes, in case Claude Code did not already resume on its own.
describe('SessionManager auto-resume (M6 two-stage)', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
    manager.applyAutoResumeConfig({
      enabled: true,
      detectText: 'Stop and wait for limit to reset',
      responseText: '1',
      resumeText: 'continue',
    });
  });

  afterEach(async () => {
    await manager.closeAll();
  });

  it('stage 1: writes responseText synthetically the instant the phrase is detected', () => {
    const session = newSession(manager);
    const writeSpy = vi.spyOn(session, 'write').mockImplementation(() => {});

    session.emit('rateLimitDetected', RESET_TEXT);

    // synthetic: true (L1) — the auto-resume write must not count as user input.
    expect(writeSpy).toHaveBeenCalledWith('1\r', { synthetic: true });
  });

  it('unparseable reset text: stage 1 still writes responseText, but nothing is scheduled', () => {
    const scheduled: string[] = [];
    manager.on('resumeScheduled', (id) => scheduled.push(id));
    const session = newSession(manager);
    const writeSpy = vi.spyOn(session, 'write').mockImplementation(() => {});

    session.emit('rateLimitDetected', 'Stop and wait for limit to reset — no time here');

    expect(writeSpy).toHaveBeenCalledWith('1\r', { synthetic: true });
    expect(scheduled).toEqual([]);
  });

  it('does not respond when auto-resume is disabled', () => {
    manager.applyAutoResumeConfig({ enabled: false, detectText: 'P', responseText: '1', resumeText: 'continue' });
    const fired: string[] = [];
    manager.on('resumeFired', (id) => fired.push(id));
    const session = newSession(manager);
    const writeSpy = vi.spyOn(session, 'write').mockImplementation(() => {});

    session.emit('rateLimitDetected', 'P');

    expect(writeSpy).not.toHaveBeenCalled();
    expect(fired).toEqual([]);
  });

  it('does not respond after the session has exited', async () => {
    const session = newSession(manager);
    const writeSpy = vi.spyOn(session, 'write').mockImplementation(() => {});

    session.kill();
    await new Promise((r) => setTimeout(r, 300));
    session.emit('rateLimitDetected', 'P');

    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('N11: a second detection while a resume is already pending does not re-answer', () => {
    const session = newSession(manager);
    const writeSpy = vi.spyOn(session, 'write').mockImplementation(() => {});

    session.emit('rateLimitDetected', RESET_TEXT);
    expect(writeSpy).toHaveBeenCalledTimes(1);

    session.emit('rateLimitDetected', RESET_TEXT);
    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it('N11: a second detection within the cooldown does not re-answer, even without a parsed reset time', () => {
    const session = newSession(manager);
    const writeSpy = vi.spyOn(session, 'write').mockImplementation(() => {});

    // Unparseable text schedules nothing, so the "already pending" guard alone
    // would not catch a repeat — the cooldown timestamp must.
    session.emit('rateLimitDetected', 'Stop and wait for limit to reset — no time here');
    expect(writeSpy).toHaveBeenCalledTimes(1);

    session.emit('rateLimitDetected', 'Stop and wait for limit to reset — no time here');
    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  describe('stage 2: scheduling (fake timers)', () => {
    beforeEach(() => {
      // Fake timers must be enabled BEFORE the SessionManager (and its internal
      // ResumeScheduler setInterval) is constructed — otherwise the sweep interval
      // is a real one that vi.advanceTimersByTime() can never fire.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T10:00:00'));
      manager = new SessionManager();
      manager.applyAutoResumeConfig({
        enabled: true,
        detectText: 'Stop and wait for limit to reset',
        responseText: '1',
        resumeText: 'continue',
      });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('emits resumeScheduled with the epoch parsed from the detected text', () => {
      const scheduled: Array<{ id: string; resetAt: number }> = [];
      manager.on('resumeScheduled', (id, resetAt) => scheduled.push({ id, resetAt }));
      const session = newSession(manager);
      vi.spyOn(session, 'write').mockImplementation(() => {});

      session.emit('rateLimitDetected', RESET_TEXT);

      const expectedResetAt = parseResetTime(RESET_TEXT, new Date());
      expect(expectedResetAt).not.toBeNull();
      expect(scheduled).toEqual([{ id: session.id, resetAt: expectedResetAt }]);
    });

    it('once the sweep crosses resetAt + grace, writes resumeText and emits resumeFired', () => {
      const fired: string[] = [];
      manager.on('resumeFired', (id) => fired.push(id));
      const session = newSession(manager);
      const writeSpy = vi.spyOn(session, 'write').mockImplementation(() => {});

      session.emit('rateLimitDetected', RESET_TEXT);
      writeSpy.mockClear(); // isolate stage-2's write from stage-1's

      // Default sweep 20s / grace 30s — advance well past 12:50pm plus grace.
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);

      expect(writeSpy).toHaveBeenCalledWith('continue\r', { synthetic: true });
      expect(fired).toEqual([session.id]);
    });

    it('N11: re-answers after the cooldown once the prior resume has fired', () => {
      const fired: string[] = [];
      manager.on('resumeFired', (id) => fired.push(id));
      const session = newSession(manager);
      const writeSpy = vi.spyOn(session, 'write').mockImplementation(() => {});

      session.emit('rateLimitDetected', RESET_TEXT);
      expect(writeSpy).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(24 * 60 * 60 * 1000); // clears the pending resume
      expect(fired).toEqual([session.id]);
      writeSpy.mockClear();

      vi.setSystemTime(new Date('2026-01-03T10:00:00')); // past the 5-minute cooldown
      session.emit('rateLimitDetected', RESET_TEXT);
      expect(writeSpy).toHaveBeenCalledTimes(1);
    });

    it('cancelResume before the sweep prevents the write and emits resumeCancelled', () => {
      const fired: string[] = [];
      const cancelled: string[] = [];
      manager.on('resumeFired', (id) => fired.push(id));
      manager.on('resumeCancelled', (id) => cancelled.push(id));
      const session = newSession(manager);
      const writeSpy = vi.spyOn(session, 'write').mockImplementation(() => {});

      session.emit('rateLimitDetected', RESET_TEXT);
      writeSpy.mockClear();
      manager.cancelResume(session.id);

      vi.advanceTimersByTime(24 * 60 * 60 * 1000);

      expect(writeSpy).not.toHaveBeenCalled();
      expect(fired).toEqual([]);
      expect(cancelled).toEqual([session.id]);
    });
  });
});
