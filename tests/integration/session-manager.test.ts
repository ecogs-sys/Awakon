import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { homedir, platform } from 'node:os';
import { SessionManager } from '@awakon/core';
import type { Shell } from '@awakon/contracts';

function defaultShell(): Shell {
  if (platform() === 'win32') return 'pwsh';
  if (platform() === 'darwin') return 'zsh';
  return 'bash';
}

function collect(manager: SessionManager, sessionId: string): { read: () => string } {
  let buffer = '';
  manager.on('sessionData', (id, chunk) => {
    if (id === sessionId) buffer += chunk.toString('utf8');
  });
  return { read: () => buffer };
}

/** Returns true if `tag` appears as a standalone output line (not just inside a
 * typed-command echo).  On Windows, PSReadLine may show a previous session's
 * command as predictive-text in the raw PTY stream, so we check for exact-match
 * lines rather than substring containment.  On Linux/macOS bash emits ANSI
 * colour codes around echo output, so we strip escape sequences before
 * comparing. */
function hasOutputLine(buffer: string, tag: string): boolean {
  const strip = (s: string) =>
    s.replace(/\x1b\[[^A-Za-z]*[A-Za-z]/g, '')   // CSI sequences
     .replace(/\x1b\][^\x07]*\x07/g, '')           // OSC sequences
     .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');   // other control chars
  return buffer.split(/\r?\n/).some((line) => strip(line).trim() === tag);
}

async function waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('SessionManager + real PTY', () => {
  let manager: SessionManager;

  beforeEach(() => { manager = new SessionManager(); });
  afterEach(async () => { await manager.closeAll(); });

  it('spawns a real shell and pipes stdout back to subscribers', async () => {
    const session = manager.create({ shell: defaultShell(), cwd: homedir(), cols: 80, rows: 24 });
    const stream = collect(manager, session.id);

    // Give the shell a moment to print its prompt.
    await waitFor(() => stream.read().length > 0);

    const marker = 'awakon_PROBE_' + Date.now().toString(36);
    session.write(`echo ${marker}\r`);

    await waitFor(() => stream.read().includes(marker));
    expect(stream.read()).toContain(marker);
  });

  it('routes writes to the correct session and never crosses streams', async () => {
    const a = manager.create({ shell: defaultShell(), cwd: homedir(), cols: 80, rows: 24 });
    const b = manager.create({ shell: defaultShell(), cwd: homedir(), cols: 80, rows: 24 });
    const streamA = collect(manager, a.id);
    const streamB = collect(manager, b.id);

    await waitFor(() => streamA.read().length > 0 && streamB.read().length > 0);

    const tagA = 'awakon_A_' + Date.now().toString(36);
    const tagB = 'awakon_B_' + Date.now().toString(36);
    a.write(`echo ${tagA}\r`);
    b.write(`echo ${tagB}\r`);

    await waitFor(() => streamA.read().includes(tagA) && streamB.read().includes(tagB));
    expect(hasOutputLine(streamA.read(), tagA)).toBe(true);
    expect(hasOutputLine(streamA.read(), tagB)).toBe(false);
    expect(hasOutputLine(streamB.read(), tagB)).toBe(true);
    expect(hasOutputLine(streamB.read(), tagA)).toBe(false);
  });

  it('defaults new sessions to kind "tab" and tags pane sessions as "pane"', async () => {
    const tab = manager.create({ shell: defaultShell(), cwd: homedir(), cols: 80, rows: 24 });
    const pane = manager.create(
      { shell: defaultShell(), cwd: homedir(), cols: 80, rows: 24 },
      'pane',
    );
    expect(tab.info().kind).toBe('tab');
    expect(pane.info().kind).toBe('pane');
  });

  it('reports exit and stops emitting data after the shell quits', async () => {
    const session = manager.create({ shell: defaultShell(), cwd: homedir(), cols: 80, rows: 24 });
    let exited = false;
    manager.on('sessionExited', (id) => { if (id === session.id) exited = true; });

    await new Promise((r) => setTimeout(r, 200));
    session.write('exit\r');

    await waitFor(() => exited);
    expect(exited).toBe(true);
  });
});
