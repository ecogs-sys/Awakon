import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

// The rate-limit menu must be answered while it is on screen, so detection fires
// the response immediately (selecting "Stop and wait for limit to reset") rather
// than scheduling anything for later.
describe('SessionManager auto-resume', () => {
  let manager: SessionManager;
  beforeEach(() => { manager = new SessionManager(); });
  afterEach(async () => { await manager.closeAll(); });

  it('sends the response and fires resumeFired when an enabled session detects the phrase', () => {
    manager.applyAutoResumeConfig({
      enabled: true,
      detectText: 'Stop and wait for limit to reset',
      responseText: '1',
    });
    const fired: string[] = [];
    manager.on('resumeFired', (id) => fired.push(id));
    const session = newSession(manager);
    const writeSpy = vi.spyOn(session, 'write').mockImplementation(() => {});

    session.emit('rateLimitDetected', 'Stop and wait for limit to reset');

    expect(writeSpy).toHaveBeenCalledWith('1\r');
    expect(fired).toEqual([session.id]);
  });

  it('does not respond when auto-resume is disabled', () => {
    manager.applyAutoResumeConfig({ enabled: false, detectText: 'P', responseText: '1' });
    const fired: string[] = [];
    manager.on('resumeFired', (id) => fired.push(id));
    const session = newSession(manager);
    const writeSpy = vi.spyOn(session, 'write').mockImplementation(() => {});

    session.emit('rateLimitDetected', 'P');

    expect(writeSpy).not.toHaveBeenCalled();
    expect(fired).toEqual([]);
  });

  it('does not respond after the session has exited', async () => {
    manager.applyAutoResumeConfig({ enabled: true, detectText: 'P', responseText: '1' });
    const fired: string[] = [];
    manager.on('resumeFired', (id) => fired.push(id));
    const session = newSession(manager);
    const writeSpy = vi.spyOn(session, 'write').mockImplementation(() => {});

    session.kill();
    await new Promise((r) => setTimeout(r, 300));
    session.emit('rateLimitDetected', 'P');

    expect(writeSpy).not.toHaveBeenCalled();
    expect(fired).toEqual([]);
  });
});
