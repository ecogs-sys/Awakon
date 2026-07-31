import { afterEach, describe, expect, it } from 'vitest';
import { homedir, platform } from 'node:os';
import { Session } from '../src/session.js';
import type { Shell } from '@awakon/contracts';

function defaultShell(): Shell {
  if (platform() === 'win32') return 'pwsh';
  if (platform() === 'darwin') return 'zsh';
  return 'bash';
}

describe('Session rate-limit detection', () => {
  let session: Session | null = null;
  afterEach(() => { session?.kill(); session = null; });

  it('re-emits rateLimitDetected when the configured phrase is set and seen', async () => {
    session = new Session('s1', { shell: defaultShell(), cwd: homedir(), cols: 80, rows: 24 });
    session.setRateLimitDetectText('awakon-LIMIT-MARKER');
    const seen: string[] = [];
    session.on('rateLimitDetected', (resetText) => seen.push(resetText));

    await new Promise((r) => setTimeout(r, 400)); // flush startup noise
    // Include a structural menu signature (numbered option line + confirm footer,
    // Critical #2 anchoring) so this round-trip is recognized as a real prompt.
    session.write('echo "  1. awakon-LIMIT-MARKER resets 9:30pm" && echo "Enter to confirm"\r');

    await new Promise((r) => setTimeout(r, 1500));
    expect(seen.some((t) => t.includes('awakon-LIMIT-MARKER'))).toBe(true);
  });
});

describe('Session.promoteToTab (N3)', () => {
  let session: Session | null = null;
  afterEach(() => { session?.kill(); session = null; });

  it('flips kind from pane to tab, reflected in info()', () => {
    session = new Session('s2', { shell: defaultShell(), cwd: homedir(), cols: 80, rows: 24 }, 'pane');
    expect(session.info().kind).toBe('pane');

    session.promoteToTab();

    expect(session.kind).toBe('tab');
    expect(session.info().kind).toBe('tab');
  });
});
