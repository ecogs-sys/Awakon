# Startup Notification Suppression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the burst of OS notifications that fires once per restored pane when the app reopens with a persisted split layout, without losing the legitimate "long command finished" notification.

**Architecture:** Add a `hasReceivedUserInput` boolean to `Session`. Flip it on the first non-empty `write()`. Inside `Session`'s existing `detector.on('attention', …)` handler, gate `signal === 'idle'` events on that flag — drop them (and the `awaiting-input` status transition) when no input has been received yet. `bell` and `osc` signals are unaffected. `AttentionDetector`, `NotificationBridge`, and bootstrap are not modified.

**Tech Stack:** TypeScript, Node.js, Vitest, node-pty, pnpm monorepo.

**Spec:** `docs/superpowers/specs/2026-05-30-startup-notification-suppression-design.md`

---

## File Structure

**Modified:**
- `packages/core/src/session.ts` — add `hasReceivedUserInput` field; flip it in `write()`; gate `idle` re-emit and the `_status = 'awaiting-input'` transition inside the existing `detector.on('attention', …)` handler.

**Created:**
- `packages/core/tests/session-attention-gate.test.ts` — Vitest spec covering the gate. Uses real `node-pty` (matches the existing `session-rate-limit.test.ts` convention). Three tests: idle suppressed before input, idle fires after input, suppressed idle does not move status to `awaiting-input`.

**Unchanged (do not edit):**
- `packages/core/src/attention-detector.ts`
- `packages/core/tests/attention-detector.test.ts`
- `apps/desktop/src/main/notification-bridge.ts`
- `apps/desktop/src/main/session-bootstrap.ts`

---

## Task 1: Failing test — new session suppresses startup `idle`

**Files:**
- Create: `packages/core/tests/session-attention-gate.test.ts`

- [ ] **Step 1.1: Write the failing test**

Create `packages/core/tests/session-attention-gate.test.ts` with:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { homedir, platform } from 'node:os';
import { Session } from '../src/session.js';
import type { AttentionEvent, Shell } from '@awakon/contracts';

function defaultShell(): Shell {
  if (platform() === 'win32') return 'pwsh';
  if (platform() === 'darwin') return 'zsh';
  return 'bash';
}

function newSession(): Session {
  return new Session('s1', { shell: defaultShell(), cwd: homedir(), cols: 80, rows: 24 });
}

describe('Session attention gate', () => {
  let session: Session | null = null;
  afterEach(() => { session?.kill(); session = null; });

  it('does not emit idle attention before any user input', async () => {
    session = newSession();
    const events: AttentionEvent[] = [];
    session.on('attention', (ev) => events.push(ev));

    // Wait well past the 1.5 s idle window — the shell has printed its prompt
    // and gone quiet, which today would emit idle.
    await new Promise((r) => setTimeout(r, 2500));

    expect(events.filter((e) => e.signal === 'idle')).toHaveLength(0);
  });
});
```

- [ ] **Step 1.2: Run the test to confirm it fails**

Run: `pnpm --filter @awakon/core test session-attention-gate`
Expected: FAIL — at least one `idle` event was collected, so the `toHaveLength(0)` assertion fails.

(If the test happens to pass on a very slow machine where the shell hasn't printed its prompt within 2.5 s, increase the wait to 3500 ms. The test must fail before the fix to prove it pins the regression.)

---

## Task 2: Implement the gate in `Session`

**Files:**
- Modify: `packages/core/src/session.ts`

- [ ] **Step 2.1: Add the `hasReceivedUserInput` field**

In `packages/core/src/session.ts`, add the field next to the existing private fields. Locate the block (around line 42-48):

```ts
private readonly detector = new AttentionDetector();
private readonly rateLimitDetector = new RateLimitDetector('');
private _title: string;
private _status: SessionStatus = 'starting';
private _exitCode: number | null = null;
```

Append one new field:

```ts
private readonly detector = new AttentionDetector();
private readonly rateLimitDetector = new RateLimitDetector('');
private _title: string;
private _status: SessionStatus = 'starting';
private _exitCode: number | null = null;
private hasReceivedUserInput = false;
```

- [ ] **Step 2.2: Gate the `idle` re-emit in the detector handler**

In the same file, locate the existing handler (around lines 66-70):

```ts
this.detector.on('attention', (ev) => {
  // Detector emits with sessionId='__pending__'; rewrite with our real id.
  this._status = 'awaiting-input';
  this.emit('attention', { ...ev, sessionId: this.id });
});
```

Replace it with a version that drops `idle` events (and does not change status)
when no user input has been received yet. `bell` and `osc` keep their original
behavior — they always fire and always set status to `awaiting-input`:

```ts
this.detector.on('attention', (ev) => {
  // An idle prompt only counts as "needs you" if the user has actually used the
  // session. A fresh shell sitting at its first prompt (restored layout, new
  // tab, etc.) would otherwise fire one notification per spawned pane.
  if (ev.signal === 'idle' && !this.hasReceivedUserInput) return;
  // Detector emits with sessionId='__pending__'; rewrite with our real id.
  this._status = 'awaiting-input';
  this.emit('attention', { ...ev, sessionId: this.id });
});
```

- [ ] **Step 2.3: Flip the flag on the first non-empty write**

In the same file, locate the existing `write` method (around lines 95-100):

```ts
write(data: Buffer | string): void {
  if (this._status === 'exited') return;
  // Any user input clears the awaiting-input state.
  if (this._status === 'awaiting-input') this._status = 'running';
  this.pty.write(typeof data === 'string' ? data : data.toString('utf8'));
}
```

Replace with:

```ts
write(data: Buffer | string): void {
  if (this._status === 'exited') return;
  // Any user input clears the awaiting-input state.
  if (this._status === 'awaiting-input') this._status = 'running';
  // Record that this session has been spoken to — gates idle attention so a
  // never-touched shell does not surface as "awaiting your input".
  const length = typeof data === 'string' ? data.length : data.byteLength;
  if (length > 0) this.hasReceivedUserInput = true;
  this.pty.write(typeof data === 'string' ? data : data.toString('utf8'));
}
```

- [ ] **Step 2.4: Run the failing test from Task 1 to confirm it now passes**

Run: `pnpm --filter @awakon/core test session-attention-gate`
Expected: PASS — no `idle` events collected within 2.5 s.

- [ ] **Step 2.5: Run the rest of the core test suite to confirm no regression**

Run: `pnpm --filter @awakon/core test`
Expected: PASS — all existing core tests (including `attention-detector`, `session-rate-limit`, `notification-service`) pass.

- [ ] **Step 2.6: Commit**

```bash
git add packages/core/src/session.ts packages/core/tests/session-attention-gate.test.ts
git commit -m "fix(session): gate idle attention on first user input

Restored panes printed their prompt and triggered the 1.5 s idle
attention heuristic on boot, surfacing one OS notification per pane.
Track per-session input state on Session and drop idle events (and
the awaiting-input status transition) until write() has been called
with non-empty data. bell and osc signals are unchanged."
```

---

## Task 3: Test — `idle` fires after first user input

**Files:**
- Modify: `packages/core/tests/session-attention-gate.test.ts`

- [ ] **Step 3.1: Add the test**

Append inside the existing `describe('Session attention gate', …)` block, after the first `it`:

```ts
  it('emits idle attention after the first user input', async () => {
    session = newSession();
    const events: AttentionEvent[] = [];
    session.on('attention', (ev) => events.push(ev));

    // Let the startup prompt drain past the idle window with the gate in place
    // (no idle should fire yet — that is verified by the previous test).
    await new Promise((r) => setTimeout(r, 2000));
    expect(events.filter((e) => e.signal === 'idle')).toHaveLength(0);

    // Send an empty newline so the shell prints a fresh prompt without running
    // a command. After idle elapses again, idle attention should now fire.
    const before = events.length;
    session.write('\r');

    await new Promise((r) => setTimeout(r, 2500));

    const idleAfterInput = events
      .slice(before)
      .filter((e) => e.signal === 'idle');
    expect(idleAfterInput.length).toBeGreaterThan(0);
  });
```

- [ ] **Step 3.2: Run the test to confirm it passes**

Run: `pnpm --filter @awakon/core test session-attention-gate`
Expected: PASS — both tests green. The flag flipped on `write('\r')`, the new prompt + 1.5 s idle window then emits at least one `idle` event.

---

## Task 4: Test — suppressed `idle` leaves status as `running`

**Files:**
- Modify: `packages/core/tests/session-attention-gate.test.ts`

- [ ] **Step 4.1: Add the test**

Append inside the existing `describe` block, after the second `it`:

```ts
  it("does not change status to 'awaiting-input' when idle is suppressed", async () => {
    session = newSession();
    const events: AttentionEvent[] = [];
    session.on('attention', (ev) => events.push(ev));

    await new Promise((r) => setTimeout(r, 2500));

    expect(events.filter((e) => e.signal === 'idle')).toHaveLength(0);
    expect(session.info().status).toBe('running');
  });
```

- [ ] **Step 4.2: Run the file**

Run: `pnpm --filter @awakon/core test session-attention-gate`
Expected: PASS — all three tests green.

- [ ] **Step 4.3: Run the core suite one more time**

Run: `pnpm --filter @awakon/core test`
Expected: PASS.

- [ ] **Step 4.4: Commit**

```bash
git add packages/core/tests/session-attention-gate.test.ts
git commit -m "test(session): cover idle attention gate after first input and status

Adds the two complementary tests for the gate: idle fires once the
session has been written to, and a suppressed idle leaves status as
'running' instead of 'awaiting-input'."
```

---

## Task 5: Manual verification — no startup notification burst

**Files:** None (manual run).

- [ ] **Step 5.1: Build and launch the desktop app**

Run: `pnpm --filter @awakon/desktop dev`
Expected: the app starts and restores the persisted layout (the tab with 4 split panes the user reported).

- [ ] **Step 5.2: Wait through startup and confirm no OS notifications**

Watch the OS notification area for ~10 s after the splits finish drawing.
Expected: **zero** OS notifications. The 4-pane reopen previously produced exactly 4 — it should now produce 0.

- [ ] **Step 5.3: Confirm interactive `idle` notifications still work**

Click into one pane to focus it. Type any command, press Enter (e.g. on Windows: `Start-Sleep -Seconds 2`; on macOS/Linux: `sleep 2`). Then immediately Alt-Tab to another window. After the command finishes and the prompt returns, wait ~2 s.
Expected: one OS notification surfaces for that pane (because the user has now typed into it, the flag is set, and the post-command idle is a real "awaiting input" signal).

- [ ] **Step 5.4: Close the app**

Quit the app cleanly so the layout is persisted for any later runs. No commit needed for Task 5 — verification only.

---

## Self-Review Notes

**Spec coverage:**
- "State on `Session`, default false, flipped on first non-empty `write()`" → Step 2.1, 2.3.
- "Gate idle in detector handler; do not transition `_status`" → Step 2.2.
- "BEL / OSC unchanged" → confirmed by the unchanged code paths in the rewritten handler; covered by the unchanged `attention-detector.test.ts` suite that Task 2.5 re-runs.
- "Auto-resume `responseText` counts as input" → no extra task needed; `SessionManager.fireResume()` calls `session.write(...)` which now flips the flag.
- Testing items in spec §"Testing":
  - "new Session emits no idle" → Task 1.
  - "after write, idle fires" → Task 3.
  - "BEL fires before any write" → unchanged code path; covered by `attention-detector.test.ts`.
  - "OSC fires before any write" → unchanged code path; covered by `attention-detector.test.ts`.
  - "status stays running when idle is suppressed" → Task 4.

**Placeholders:** none.

**Type / name consistency:**
- `hasReceivedUserInput` used identically in Steps 2.1, 2.2, 2.3.
- `Session.write(data: Buffer | string)` signature unchanged.
- `AttentionEvent['signal']` values (`'idle'`, `'bell'`, `'osc'`) match `packages/contracts/src/session.ts`.
