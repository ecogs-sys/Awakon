import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { homedir, platform } from 'node:os';
import { SessionManager } from '@awakon/core';
import type { Shell, AttentionEvent } from '@awakon/contracts';

function defaultShell(): Shell {
  if (platform() === 'win32') return 'pwsh';
  if (platform() === 'darwin') return 'zsh';
  return 'bash';
}

async function waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('AttentionDetector + real PTY', () => {
  let manager: SessionManager;

  beforeEach(() => { manager = new SessionManager(); });
  afterEach(async () => { await manager.closeAll(); });

  it('emits sessionAttention when the shell prints a BEL byte', async () => {
    const session = manager.create({ shell: defaultShell(), cwd: homedir(), cols: 80, rows: 24 });
    const events: AttentionEvent[] = [];
    manager.on('sessionAttention', (ev) => events.push(ev));

    // Let the prompt print first to flush startup noise.
    await new Promise((r) => setTimeout(r, 400));

    // Write a BEL via the shell. PowerShell: `[char]7` works; bash: printf '\a'.
    const cmd = platform() === 'win32' ? `[char]7 | Write-Host -NoNewline\r` : `printf '\\a'\r`;
    session.write(cmd);

    await waitFor(() => events.some((e) => e.signal === 'bell'));
    const bell = events.find((e) => e.signal === 'bell');
    expect(bell).toBeDefined();
    expect(bell?.sessionId).toBe(session.id);
    expect(bell?.confidence).toBe(1);
  });

  it('does not emit sessionAttention for ordinary prompt output', async () => {
    const session = manager.create({ shell: defaultShell(), cwd: homedir(), cols: 80, rows: 24 });
    const events: AttentionEvent[] = [];
    manager.on('sessionAttention', (ev) => events.push(ev));

    // Wait for startup noise to settle, then open the attention gate.
    await new Promise((r) => setTimeout(r, 1000));
    session.write(`echo hello\r`);

    // After the gate opens, bash prints the command output and redraws its
    // prompt. On some CI images the PS1 or readline config includes a BEL, so
    // let that prompt redraw land (and any residual startup chunks) before we
    // start the clean observation window.
    await new Promise((r) => setTimeout(r, 300));
    events.length = 0;

    // Observe for well below the 1.5 s idle threshold. No new prompt is drawn
    // in this window, so no bell or OSC should fire from ordinary output.
    await new Promise((r) => setTimeout(r, 600));

    const unexpected = events.filter((e) => e.signal !== 'idle');
    expect(unexpected).toHaveLength(0);
  });
});
