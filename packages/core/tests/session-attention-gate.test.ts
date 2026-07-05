import { afterEach, describe, expect, it } from 'vitest';
import { homedir, platform } from 'node:os';
import { Session } from '../src/session.js';
import type { AttentionEvent, Shell } from '@awakon/contracts';

function defaultShell(): Shell {
  if (platform() === 'win32') return 'pwsh';
  if (platform() === 'darwin') return 'zsh';
  return 'bash';
}

// C9: real idle window is 1500ms; using a short override here (with a real-time wait
// just past it) cuts this file's runtime dramatically versus waiting out the real
// window several times per test, without needing fake timers (these tests exercise a
// real PTY subprocess, so the wait is real wall-clock time either way).
const TEST_IDLE_MS = 100;
const PAST_IDLE_MS = 500;

function newSession(): Session {
  return new Session('s1', { shell: defaultShell(), cwd: homedir(), cols: 80, rows: 24 }, 'tab', TEST_IDLE_MS);
}

describe('Session attention gate', () => {
  let session: Session | null = null;
  afterEach(() => { session?.kill(); session = null; });

  it('does not emit any attention before the first user input', async () => {
    session = newSession();
    const events: AttentionEvent[] = [];
    session.on('attention', (ev) => events.push(ev));

    // Wait well past the 1.5 s idle window. The gate suppresses every signal
    // until first input — idle from the startup prompt, any bell the shell
    // banner emits (pwsh on Windows does), and any pre-input osc chatter.
    await new Promise((r) => setTimeout(r, PAST_IDLE_MS));

    expect(events).toHaveLength(0);
  });

  it('emits idle attention after the first user input', async () => {
    session = newSession();
    const events: AttentionEvent[] = [];
    session.on('attention', (ev) => events.push(ev));

    // Let the startup prompt drain past the idle window with the gate in place
    // (no idle should fire yet — that is verified by the previous test).
    await new Promise((r) => setTimeout(r, PAST_IDLE_MS));
    expect(events.filter((e) => e.signal === 'idle')).toHaveLength(0);

    // Send an empty newline so the shell prints a fresh prompt without running
    // a command. After idle elapses again, idle attention should now fire.
    const before = events.length;
    session.write('\r');

    await new Promise((r) => setTimeout(r, PAST_IDLE_MS));

    const idleAfterInput = events
      .slice(before)
      .filter((e) => e.signal === 'idle');
    expect(idleAfterInput.length).toBeGreaterThan(0);
  }, 10_000);

  it("leaves status as 'running' before the first user input", async () => {
    session = newSession();
    const events: AttentionEvent[] = [];
    session.on('attention', (ev) => events.push(ev));

    await new Promise((r) => setTimeout(r, PAST_IDLE_MS));

    // No attention of any kind should have surfaced (covered by the first
    // test too) and the status mutation that the detector handler would have
    // performed must have been suppressed alongside the emit.
    expect(events).toHaveLength(0);
    expect(session.info().status).toBe('running');
  });

  it('does not count xterm focus reports as user input', async () => {
    session = newSession();
    const events: AttentionEvent[] = [];
    session.on('attention', (ev) => events.push(ev));

    // Drain past the initial idle window so the prompt no longer counts.
    await new Promise((r) => setTimeout(r, PAST_IDLE_MS));
    expect(events).toHaveLength(0);

    // xterm.js emits these when the terminal element gains/loses DOM focus.
    // They flow through term.onData -> SessionWrite IPC -> Session.write(),
    // but they must NOT unlock the attention gate — otherwise opening the
    // app and clicking elsewhere would notify on every restored pane.
    session.write('\x1b[O'); // focus out
    session.write('\x1b[I'); // focus in

    await new Promise((r) => setTimeout(r, PAST_IDLE_MS));
    expect(events).toHaveLength(0);

    // Real user input still unlocks the gate.
    session.write('\r');
    await new Promise((r) => setTimeout(r, PAST_IDLE_MS));
    expect(events.filter((e) => e.signal === 'idle').length).toBeGreaterThan(0);
  }, 10_000);

  it('does not count a synthetic write (auto-resume) as user input (L1)', async () => {
    session = newSession();
    const events: AttentionEvent[] = [];
    session.on('attention', (ev) => events.push(ev));

    await new Promise((r) => setTimeout(r, PAST_IDLE_MS));
    expect(events).toHaveLength(0);

    // A restored session the user never touched must not start emitting attention
    // just because auto-resume typed into it on the user's behalf.
    session.write('1\r', { synthetic: true });
    await new Promise((r) => setTimeout(r, PAST_IDLE_MS));
    expect(events).toHaveLength(0);

    // Real user input still unlocks the gate.
    session.write('\r');
    await new Promise((r) => setTimeout(r, PAST_IDLE_MS));
    expect(events.filter((e) => e.signal === 'idle').length).toBeGreaterThan(0);
  }, 10_000);
});
