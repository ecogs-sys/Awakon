import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { homedir, platform } from 'node:os';
import { SessionManager } from '../src/session-manager.js';
import type { Shell } from '@awakon/contracts';

function defaultShell(): Shell {
  if (platform() === 'win32') return 'pwsh';
  if (platform() === 'darwin') return 'zsh';
  return 'bash';
}
function newSession(m: SessionManager) {
  return m.create({ shell: defaultShell(), cwd: homedir(), cols: 80, rows: 24 });
}

describe('SessionManager auto-resume', () => {
  let manager: SessionManager;
  beforeEach(() => { manager = new SessionManager(); });
  afterEach(async () => { await manager.closeAll(); });

  it('schedules a resume when an enabled session detects the phrase', () => {
    manager.applyAutoResumeConfig({ enabled: true, detectText: 'P', responseText: 'continue' });
    const scheduled: Array<{ id: string; at: number }> = [];
    manager.on('resumeScheduled', (id, at) => scheduled.push({ id, at }));
    const session = newSession(manager);

    const future = Date.now() + 60 * 60 * 1000;
    // Drive the detector directly: emit a phrase + a time ~1h out.
    const dt = new Date(future);
    const hh = ((dt.getHours() + 11) % 12) + 1;
    const ampm = dt.getHours() < 12 ? 'am' : 'pm';
    session.emit('rateLimitDetected', `P resets ${hh}:${String(dt.getMinutes()).padStart(2, '0')}${ampm}`);

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.id).toBe(session.id);
  });

  it('does not schedule when auto-resume is disabled', () => {
    manager.applyAutoResumeConfig({ enabled: false, detectText: 'P', responseText: 'continue' });
    const scheduled: string[] = [];
    manager.on('resumeScheduled', (id) => scheduled.push(id));
    const session = newSession(manager);
    session.emit('rateLimitDetected', 'P resets 9:30pm');
    expect(scheduled).toEqual([]);
  });

  it('cancelResume removes a pending resume and emits resumeCancelled', () => {
    manager.applyAutoResumeConfig({ enabled: true, detectText: 'P', responseText: 'continue' });
    const cancelled: string[] = [];
    manager.on('resumeCancelled', (id) => cancelled.push(id));
    const session = newSession(manager);
    session.emit('rateLimitDetected', 'P resets 9:30pm');
    manager.cancelResume(session.id);
    expect(cancelled).toEqual([session.id]);
  });

  it('disabling auto-resume cancels all pending resumes', () => {
    manager.applyAutoResumeConfig({ enabled: true, detectText: 'P', responseText: 'continue' });
    const cancelled: string[] = [];
    manager.on('resumeCancelled', (id) => cancelled.push(id));
    const session = newSession(manager);
    session.emit('rateLimitDetected', 'P resets 9:30pm');
    manager.applyAutoResumeConfig({ enabled: false, detectText: 'P', responseText: 'continue' });
    expect(cancelled).toEqual([session.id]);
  });
});
