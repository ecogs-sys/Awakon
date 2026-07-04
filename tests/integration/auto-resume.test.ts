import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { homedir, platform } from 'node:os';
import { SessionManager } from '@awakon/core';
import type { Shell } from '@awakon/contracts';

function defaultShell(): Shell {
  if (platform() === 'win32') return 'pwsh';
  if (platform() === 'darwin') return 'zsh';
  return 'bash';
}
async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('auto-resume + real PTY', () => {
  let manager: SessionManager;
  beforeEach(() => { manager = new SessionManager(); });
  afterEach(async () => { await manager.closeAll(); });

  it('detects the phrase and types the response into the PTY', async () => {
    manager.applyAutoResumeConfig({
      enabled: true,
      detectText: 'awakon-LIMIT',
      responseText: 'continue',
    });

    const fired: string[] = [];
    manager.on('resumeFired', (id) => fired.push(id));

    const session = manager.create({ shell: defaultShell(), cwd: homedir(), cols: 80, rows: 24 });
    await new Promise((r) => setTimeout(r, 400)); // flush startup noise

    // Print a line containing the detect phrase. The rate-limit prompt is an
    // interactive menu answered on the spot, so detection fires the response
    // immediately rather than scheduling anything for a later reset time.
    session.write(`echo awakon-LIMIT resets soon\r`);

    await waitFor(() => fired.includes(session.id));
    expect(fired).toContain(session.id);
  });
});
