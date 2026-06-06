# Startup Notification Suppression — Design

**Date:** 2026-05-30
**Status:** Approved (awaiting implementation plan)

## Problem

When the app reopens with a persisted split layout, the user receives one OS
notification per restored pane (e.g. exactly 4 notifications for a 4-pane tab).
Notifications during normal interactive use are wanted; the burst at startup is
not.

### Root cause

1. `bootstrapSessions` (`apps/desktop/src/main/session-bootstrap.ts`) restores
   the persisted tab and its `splits` tree.
2. The terminal renderer's `loadSavedLayout()`
   (`apps/desktop/src/renderer/terminal/main.ts:30`) replays the tree via
   `splitFocused`, each call IPC-spawning a fresh pane PTY through
   `onSessionCreateForPane` (`apps/desktop/src/main/index.ts:271`).
3. Every fresh shell prints its initial prompt, then sits quiet.
4. `AttentionDetector.checkIdle()`
   (`packages/core/src/attention-detector.ts:88-103`) matches the
   prompt-pattern tail after 1.5 s of silence and emits an `idle` attention
   event for each pane.
5. `NotificationBridge` — now wired before bootstrap per F14 — receives those
   events and the `windowFocused && tabFocused` guard does not reliably
   suppress them at startup, so all N events surface as OS notifications.

The deeper conceptual problem: an `idle`-at-prompt signal is only meaningful
if the user has already interacted with that shell. A shell that has never
received input cannot be "awaiting *your* input"; it is simply ready.

## Goal

Suppress the burst of startup notifications without losing the legitimate
idle-prompt notification that fires when a user-typed long-running command
finishes.

## Design

### State

Add one boolean to `Session` (`packages/core/src/session.ts`):

- `hasReceivedUserInput: boolean`, default `false`.
- Flipped to `true` on the first call to `Session.write()` with non-empty data.
- Per-session lifetime; never reset.

### Gate

Modify the existing `detector.on('attention', …)` handler in `Session` to
drop **every** attention signal while `hasReceivedUserInput === false`. A
shell the user has never spoken to cannot legitimately be "asking for your
attention" — whatever it emits in that window is either initialization noise
(e.g. a BEL in pwsh's banner, ANSI chatter from a profile script) or an
automated tool talking to an empty seat.

`AttentionDetector` stays untouched. It remains a pure byte-stream scanner; the
"has the user spoken to this session" semantic lives in `Session` where input
arrives.

### Behavior contract

| Signal             | Before first `write()` | After first `write()` |
|--------------------|------------------------|------------------------|
| `bell` (\x07)      | dropped                | fires                  |
| `osc` (Awakon esc) | dropped                | fires                  |
| `idle` (prompt + 1.5 s) | dropped           | fires                  |

When any attention event is dropped, `Session._status` remains `running`. Once
attention is emitted (which can only happen after first input), `_status`
becomes `awaiting-input` as it does today.

### History

The original design gated only `idle`, on the theory that `bell` and `osc`
are deliberate high-confidence intent signals worth surfacing immediately.
Manual verification showed that pwsh on Windows emits a BEL during its banner,
which the bridge still surfaced as one notification per restored pane (just
fewer than the original four idle events). Broadening the gate to all signals
is the right rule: at app boot, any "needs attention" claim from a process
the user has not yet engaged with is not actionable. Tools that intentionally
emit `osc` immediately on startup (rare) will surface the next time they
emit it, after the user has typed.

### Auto-resume

`SessionManager.fireResume()` calls `session.write(responseText + '\r')`. That
counts as input — the flag flips. This is intentional: once auto-resume has
typed a response, subsequent idle-at-prompt is a real "command finished" event
worth surfacing.

## What is unchanged

- `NotificationBridge` — it sees fewer `sessionAttention` events on startup but
  its logic is unchanged.
- `bootstrapSessions`.
- `loadSavedLayout` / `splitFocused` / `SplitContainer.restore()`.
- `AttentionDetector` and its existing tests.
- IPC channels, persisted schemas.

## Edge cases considered

- **Slow shells:** a profile script that delays the prompt past any fixed
  window cannot leak — the gate is event-driven, not time-windowed.
- **Sleep/wake:** the OS suspending the app does not recreate `Session`
  instances, so the flag survives.
- **Crash recovery (`recreateSessionView`):** the PTY and the `Session` are
  preserved (only the WebContentsView is rebuilt), so the flag is preserved.
- **New Tab after startup:** the new `Session` starts with the flag `false`.
  Opening a tab and not typing produces no notification, which is the desired
  behavior. First keystroke flips the flag; subsequent idle fires normally.
- **Resize at startup:** `Session.resize()` does not go through `write()`, so
  the flag is not flipped by window resize events.
- **xterm focus reports (`ESC[I`, `ESC[O`):** xterm.js emits these through
  `term.onData` when its DOM element gains or loses focus, which forwards them
  through `SessionWrite` IPC into `Session.write()`. They must still flow to
  the PTY (vim and similar tools rely on focus events when they enable
  DECSET 1004), but they are **not** user typing — `Session.write()`
  identifies them by exact-byte match and skips the gate-flip in that case.
  Without this carve-out the gate unlocks the moment the pane mounts, because
  the terminal element loses focus as soon as another pane or the chrome
  takes focus, emitting an `ESC[O` write.

## Testing

Add unit tests covering the gate at the `Session` boundary
(`packages/core/tests/session.test.ts`, creating it if it does not exist):

1. A new `Session` emits no `attention` with `signal === 'idle'` when the PTY
   output looks like a prompt and the idle timer expires.
2. After `session.write('x')`, the same prompt-shaped output followed by an
   idle window does emit `idle`.
3. `bell` fires on the very first BEL byte, before any `write()`.
4. `osc` fires for the Awakon escape sequence, before any `write()`.
5. When `idle` is suppressed, `session.info().status` remains `running`
   (not `awaiting-input`).

`AttentionDetector` tests in `packages/core/tests/attention-detector.test.ts`
are not modified.

## Out of scope

- Reworking `NotificationBridge`'s focus checks.
- Changing the 1.5 s idle window or the prompt-pattern regex.
- Adding a user-facing setting to disable startup notifications.
- Suppressing notifications based on app-level "starting up" state.
