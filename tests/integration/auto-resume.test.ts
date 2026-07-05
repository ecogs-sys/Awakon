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

/** Format `d` as "h:mmam/pm" — the clock format RateLimitDetector/parseResetTime expect. */
function formatResetTime(d: Date): string {
  let hour = d.getHours() % 12;
  if (hour === 0) hour = 12;
  const minute = d.getMinutes().toString().padStart(2, '0');
  const meridiem = d.getHours() < 12 ? 'am' : 'pm';
  return `${hour}:${minute}${meridiem}`;
}

describe('auto-resume + real PTY (M6 two-stage)', () => {
  let manager: SessionManager;
  afterEach(async () => { await manager.closeAll(); });

  it('stage 1: detects the phrase and types the response into the PTY immediately', async () => {
    manager = new SessionManager();
    manager.applyAutoResumeConfig({
      enabled: true,
      detectText: 'awakon-LIMIT',
      responseText: 'echo awakon-STAGE1-OK',
      resumeText: 'continue',
    });

    const chunks: Buffer[] = [];
    const session = manager.create({ shell: defaultShell(), cwd: homedir(), cols: 80, rows: 24 });
    session.on('data', (chunk) => chunks.push(chunk));
    await new Promise((r) => setTimeout(r, 400)); // flush startup noise

    // No parseable reset time in "resets soon" — stage 1 still fires, nothing is scheduled.
    session.write(`echo awakon-LIMIT resets soon\r`);

    await waitFor(() => Buffer.concat(chunks).toString('utf8').includes('awakon-STAGE1-OK'));
  });

  it('stage 2: real PTY output containing a reset time is parsed and scheduled', async () => {
    // parseResetTime only has minute granularity (Claude's messages never show seconds)
    // and rolls forward a full day once the target minute's :00 has passed — so "now +
    // a few seconds" is not a safe target (echo/detection latency alone can push past
    // it). The actual fire-after-grace behavior (with controlled time) is covered by
    // packages/core/tests/session-manager-resume.test.ts; this integration test's job is
    // just to prove the real detector + parser correctly turn real PTY output into a
    // schedule, not to wait out the real clock.
    manager = new SessionManager();
    manager.applyAutoResumeConfig({
      enabled: true,
      detectText: 'awakon-LIMIT',
      responseText: '1',
      resumeText: 'echo awakon-STAGE2-OK',
    });

    const scheduled: number[] = [];
    manager.on('resumeScheduled', (id, resetAt) => scheduled.push(resetAt));

    const session = manager.create({ shell: defaultShell(), cwd: homedir(), cols: 80, rows: 24 });
    await new Promise((r) => setTimeout(r, 400)); // flush startup noise

    const beforeWrite = Date.now();
    const resetLabel = formatResetTime(new Date(Date.now() + 5 * 60_000));
    // Quoted as a single argument — PowerShell's `echo` (Write-Output) treats each
    // unquoted bareword as a separate pipeline object and prints one per line, which
    // would split the phrase and reset time across chunks and break detection.
    session.write(`echo "awakon-LIMIT resets ${resetLabel}"\r`);

    await waitFor(() => scheduled.length === 1);
    // A sanity bound, not an exact-time assertion: the parsed epoch must be a real
    // near-future timestamp (same-day, ~5 minutes out), not a day-rolled artifact.
    expect(scheduled[0]).toBeGreaterThan(beforeWrite);
    expect(scheduled[0]).toBeLessThan(beforeWrite + 6 * 60_000);
  });

  it('cancelResume prevents the scheduled write from ever happening', async () => {
    manager = new SessionManager();
    manager.applyAutoResumeConfig({
      enabled: true,
      detectText: 'awakon-LIMIT',
      responseText: '1',
      resumeText: 'echo awakon-SHOULD-NOT-RUN',
    });

    const scheduled: string[] = [];
    const cancelled: string[] = [];
    const fired: string[] = [];
    manager.on('resumeScheduled', (id) => scheduled.push(id));
    manager.on('resumeCancelled', (id) => cancelled.push(id));
    manager.on('resumeFired', (id) => fired.push(id));

    const chunks: Buffer[] = [];
    const session = manager.create({ shell: defaultShell(), cwd: homedir(), cols: 80, rows: 24 });
    session.on('data', (chunk) => chunks.push(chunk));
    await new Promise((r) => setTimeout(r, 400));

    // 5 minutes out — see the previous test for why "a few seconds out" is unsafe
    // (parseResetTime's minute granularity). The exact resetAt doesn't matter here:
    // cancelResume must prevent the write regardless of when it was due.
    const resetLabel = formatResetTime(new Date(Date.now() + 5 * 60_000));
    // Quoted as a single argument — PowerShell's `echo` (Write-Output) treats each
    // unquoted bareword as a separate pipeline object and prints one per line, which
    // would split the phrase and reset time across chunks and break detection.
    session.write(`echo "awakon-LIMIT resets ${resetLabel}"\r`);
    await waitFor(() => scheduled.includes(session.id));

    manager.cancelResume(session.id);
    expect(cancelled).toContain(session.id);

    await new Promise((r) => setTimeout(r, 1_000)); // sweep interval (200ms) with nothing pending
    expect(fired).not.toContain(session.id);
    expect(Buffer.concat(chunks).toString('utf8')).not.toContain('awakon-SHOULD-NOT-RUN');
  }, 20_000);
});
