# Handoff: three broken features — verified root causes and fix plan (2026-07-09)

Audience: an agent (or human) picking this up cold. Everything below was verified at
runtime on branch `feat/fable-review` (HEAD `414c04d`), Windows 11, dev build, Electron
43.0.0, by launching the real app and reading its own `--log-ipc` JSONL output. No fixes
have been applied yet. Each claim cites file:line as of HEAD `414c04d`.

Reported symptoms:

1. Copy and paste in the terminal no longer work.
2. Keyboard shortcuts no longer work.
3. Rate-limit auto-resume ("schedule task") no longer fires. The user tested it by
   running `Write-Host "You've hit your session limit · resets 12:05pm (Pacific/Auckland)"`
   inside a session.

---

## Issue 1 — Copy/paste: blanket permission denial blocks the async clipboard API

**Regressing commit:** `397683b` ("close remaining nav-guard gaps").

**Root cause.** `apps/desktop/src/main/index.ts:77` registers, for every WebContents:

```ts
contents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
  callback(false);
});
```

The terminal context menu's Copy and Paste (`apps/desktop/src/renderer/terminal/split-container.ts:242-247`)
use `navigator.clipboard.writeText()` / `readText()`. In Chromium those require the
`clipboard-sanitized-write` / `clipboard-read` permissions, which now get denied.

**Runtime proof.** Calling the clipboard API from both the chrome and terminal renderers
of the launched app fails with:

```
NotAllowedError: Failed to execute 'writeText' on 'Clipboard': Write permission denied.
NotAllowedError: Failed to execute 'readText' on 'Clipboard': Read permission denied.
```

**Not the cause:** `sanitizePasteText` from `c010813` is correct and never reached.

**Fix.** In the handler at `index.ts:77`, allow exactly the two clipboard permissions and
keep denying everything else:

```ts
const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write']);
contents.session.setPermissionRequestHandler((_wc, permission, callback) => {
  callback(ALLOWED_PERMISSIONS.has(permission));
});
contents.session.setPermissionCheckHandler((_wc, permission) =>
  ALLOWED_PERMISSIONS.has(permission));
```

Notes:
- Add the check handler too: without one Electron default-allows checks, and leaving the
  two handlers inconsistent invites future bugs. All webContents in this app are our own
  renderers (window.open denied, webviews denied, navigation guarded — same commit), so
  no sender scoping is needed, but `viewManager.ownsWebContents()` / comparison with
  `chromeWindow.webContents` is available if you want it.
- Update the comment above the handler — it currently says nothing in the app needs any
  permission, which is what caused this.
- Keep the rationale of `397683b` intact: everything except the two clipboard permissions
  must stay denied.

**Verify.** Launch the app, right-click in a terminal → Paste inserts clipboard text;
select text → Copy → paste back. Programmatic check: from either renderer devtools,
`await navigator.clipboard.writeText('x')` then `readText()` must round-trip.

---

## Issue 2 — Shortcuts: modal opened from a focused terminal is keyboard-dead

**This is a focus bug, not an accelerator bug, and it is NOT the Electron 33→43 upgrade.**
All of the following was established with real OS keystrokes (see "Native probe" below;
Playwright cannot test this — its CDP key injection bypasses native menu-accelerator
matching entirely):

- With a terminal pane focused, the app-menu accelerators DO dispatch: Ctrl+B, Ctrl+9 and
  Ctrl+T each produced `event.action.invoke` in the IPC log and their effects ran
  (sidebar toggled, dialog opened). Identical behavior on Electron 33.4.11 and 43.0.0.
- But when the accelerator opens a chrome-level overlay — Ctrl+T New Session dialog,
  Ctrl+K command palette, rename, settings — the overlay appears **keyboard-dead**:
  subsequently typed text, Enter and Esc produce zero IPC traffic. They go nowhere.

**Root cause.** When a modal opens, the chrome renderer sends `LayoutModal {open:true}`;
main handles it at `apps/desktop/src/main/index.ts:493`:

```ts
ipcRouter.onLayoutModal((open) => {
  if (open) viewManager?.suspend();
  else viewManager?.resume();
});
```

`suspend()` (`apps/desktop/src/main/view-manager.ts:154`) only resizes the terminal
WebContentsView to 0×0 (`hideOne`, view-manager.ts:205). **Keyboard focus is never moved
to the chrome window**, so it stays on the now-invisible terminal view. The dialog's
`input.focus()` (new-session-dialog.ts) sets DOM focus inside the chrome webContents, but
that webContents doesn't have window-level focus, so keys never reach it.

Compounding UX (why it reads as "all shortcuts broken"): while the dead dialog is up,
`89e850f`'s `isDialogOpen()` guard (`apps/desktop/src/renderer/chrome/keyboard.ts:68`)
suppresses the chrome keydown handler, and the dialog openers are idempotent
(`layout-manager.ts:244,263,288,394`), so re-pressing Ctrl+T does nothing. The only way
out is mouse-clicking the scrim/Cancel. The guard itself is correct — do not remove it.

The hole is longstanding (reproduces on Electron 33; `view.webContents.focus()` in
`show()` and the no-focus `suspend()` both predate the branch) but it is the only
shortcut flow that is actually broken, and it makes every other shortcut appear dead
while the modal is up.

**Confirmed working — do not "fix":** accelerator dispatch (`app-menu.ts`), the chrome
document-keydown path (`keyboard.ts`), the `event.action.invoke` pipe, preload
allowlists, non-modal shortcuts from a terminal (tab switch, sidebar toggle).

**Fix.** Move webContents focus with the modal lifecycle, in main:

```ts
ipcRouter.onLayoutModal((open) => {
  if (open) {
    viewManager?.suspend();
    chromeWindow?.webContents.focus();   // dialog/palette must own the keyboard
  } else {
    viewManager?.resume();               // consider refocusing the visible view here
  }
});
```

For the close side: `resume()` (view-manager.ts:161) just relayouts. Recommended: give
`resume()` the same `view.webContents.focus()` treatment `show()` has (view-manager.ts:130)
so focus returns to the terminal after the modal closes regardless of how it was
dismissed (Esc, Enter-submit, scrim click). Watch one interaction: `LayoutModal` is also
sent by the command palette (`renderer/chrome/main.ts:88`) and by the doc-reader/dialog
combination (`layout-manager.ts:531` sends `open: isReaderVisible() || dialogOpen`) — the
reader is not keyboard-modal, so verify reader-open/close doesn't yank focus surprisingly
(38cf596 touched this lifecycle; read `sendModalState()` before changing semantics).

**Verify (requires native input; see probe script).** With a terminal focused:
Ctrl+T → dialog opens **and** typing a path works, Enter starts the session, Esc closes;
after dismissal, typing lands in the terminal again. Ctrl+K palette likewise usable.
Regression sweep: Ctrl+B / Ctrl+Tab / Ctrl+1..9 / Ctrl+W still work from both chrome and
terminal focus; opening Settings from the hamburger menu still works with mouse.

---

## Issue 3 — Rate-limit auto-resume: menu-signature window too small for the user's detectText

**Regressing commit:** `eea70c9` ("require a structural menu signature ... before
auto-resume fires").

**How detection works now** (`packages/core/src/rate-limit-detector.ts`): after the
configured `detectText` phrase matches, a context window of
`[idx - LEADING_CONTEXT(600), idx + len + TRAILING_CONTEXT(200)]` (lines 6-12, 72-75) is
extracted and must contain BOTH a numbered option line (`OPTION_LINE_RE`, line 21) and an
"Enter to confirm" footer (line 22) — `hasMenuSignature`, line 24 — before
`rateLimitDetected` fires.

**Root cause.** The user's real settings
(`%APPDATA%\@awakon\desktop\settings.json`, verified 2026-07-09) are:

```json
"autoResume": { "enabled": true, "detectText": "You've hit your session limit",
                "responseText": "1", "resumeText": "continue" }
```

`"You've hit your session limit"` anchors at the **header** of the real menu frame. Per
the detector's own comment (rate-limit-detector.ts:9-11), the option-1 label sits
**~250–300 chars after the header** (status + ruler lines in between). That is beyond
`TRAILING_CONTEXT = 200`, so the option line (and the footer, further still) fall outside
the window → `hasMenuSignature` is false → **even a genuine Claude Code rate-limit menu
never fires** with this detectText. Detection currently only works when `detectText` is
the option-1 label itself (the shipped default `"Stop and wait for limit to reset"`,
`packages/contracts/src/settings.ts:43`), because then LEADING 600 reaches back to the
header and TRAILING 200 reaches the footer.

**Also, by design (not a bug):** the user's bare
`Write-Host "You've hit your session limit · resets 12:05pm (Pacific/Auckland)"` no
longer triggers and must not — a printed/quoted phrase with no live menu is exactly the
false positive `eea70c9` eliminates. Test with `tools/simulate-rate-limit.ps1` instead
(untracked in the working tree; prints the full menu frame incl. option lines + footer,
and logs each hit→resume cycle to `tools/rate-limit-logs/`).

**Confirmed working — do not touch:** `parseResetTime`
(`packages/core/src/reset-time-parser.ts`) handles `12:05pm (Pacific/Auckland)` correctly
(12h/24h scanning, "resets"-proximity choice, IANA zone, next-day rollover); the
synthetic-write exclusions in `session.ts:121-137` correctly keep the auto-typed "1"/
"continue" from tripping the fire-time user-input re-check in
`session-manager.ts:160-171`.

**Fix.** In `packages/core/src/rate-limit-detector.ts:8`, raise
`TRAILING_CONTEXT` from `200` to `600` (symmetric with `LEADING_CONTEXT`), so the
signature is found whether `detectText` anchors at the frame's header or at the option
label. Update the constant's comment to say why (header-anchored detectText needs to
reach ~250-300 chars forward to the option line, plus footer, plus wide-terminal margin).
`WINDOW_MAX` (4096) is comfortably larger; no other change needed. Add a unit test in
`packages/core/tests/rate-limit-detector.test.ts` with
`detectText = "You've hit your session limit"` against a realistic full frame where the
option line sits ~300 chars after the phrase (mimic the real spacing — status line +
ruler between header and options; see the LEADING_CONTEXT comment).

**Verify.** `pnpm --filter @awakon/core test`. End-to-end: enable auto-resume in
Settings, run `tools\simulate-rate-limit.ps1 -MaxCycles 1 -RenewDelaySeconds 45` in a
session tab; expect the app to type `1` (simulator logs the hit), show the countdown
badge, then type `continue` after ~45-105s (simulator logs CONTINUED). Two pitfalls when
testing repeatedly: (a) `SessionManager.RESPONSE_COOLDOWN_MS` = 5 min per session
(`session-manager.ts:44`) — only the first hit in any 5-minute span is answered, so use
`-MaxCycles 1` or wait between cycles; (b) typing anything into that session after the
badge appears cancels the scheduled resume by design (fire-time re-check, A4-I5).

---

## Execution notes for the fixing agent

- Order doesn't matter; the three fixes touch disjoint files. Suggested: 1 → 3 → 2
  (2 needs the most careful manual verification).
- After each fix run `pnpm -r --if-present test`. Known pre-existing failure, NOT yours
  to fix here: `tests/e2e/multi-tab.spec.ts` fails with "channel not allowed ...
  core.session.write" — documented as out of scope in commit `ed98f5a`'s message.
- All verification above was on the dev build. The branch also flips Electron fuses on
  pack (`0efcf32`, `ccb7c51`); after fixing, smoke-test a packaged build too.
- e2e `--user-data-dir` isolation was verified real (fresh dirs get
  `DEFAULT_APP_SETTINGS` from `packages/contracts/src/settings.ts:43`); e2e runs do not
  touch the user's real settings.

### Native probe (for Issue 2 verification)

Playwright **cannot** drive menu accelerators (CDP injection bypasses native key
handling) — false negatives guaranteed. Use real input + the app's IPC log:

```powershell
# 1. Isolated userData pre-seeded with one tab so the terminal takes focus on boot:
$ud  = "$env:TEMP\awakon-probe-ud";  $log = "$env:TEMP\awakon-probe-log"
Remove-Item -Recurse -Force $ud,$log -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $ud,$log | Out-Null
'{"version":4,"tabs":[{"tabId":"seed","shell":"pwsh","cwd":"C:\\Users\\dines"}],"focusedTabIndex":0}' |
  Set-Content "$ud\sessions.json" -Encoding utf8

# 2. Launch the dev build with IPC logging (electron exe: resolve from tests/e2e):
$electron = (node -p "require('electron')")  # run inside tests\e2e
$env:NODE_ENV = 'production'
$p = Start-Process $electron -ArgumentList @("<repo>\apps\desktop","--user-data-dir=$ud","--log-ipc=$log") -PassThru
Start-Sleep 15   # boot can take ~10s

# 3. Foreground (user32 SetForegroundWindow on $p.MainWindowHandle), then send real keys:
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('^t')   # etc. — sleep ~2s between keys

# 4. Read $log\ipc-*.jsonl:
#    accelerator fired            -> {"dir":"event","channel":"event.action.invoke",...}
#    dialog opened/closed         -> core.layout.modal {"open":true/false}
#    keys leaked into terminal    -> core.session.write (dataLength only; redacted)
#    session actually created     -> core.session.create
# Keyboard-dead bug signature: action.invoke newTab + modal open:true, then NOTHING for
# subsequent typed keys. After the fix, typing + Enter must produce core.session.create.
```

### Runtime evidence collected 2026-07-09 (summary)

| Probe | Result |
|---|---|
| `navigator.clipboard` write/read, both renderers | `NotAllowedError` (Issue 1) |
| Ctrl+T, chrome focused, native keys | dialog opens via chrome keydown ✓ |
| Ctrl+B ×2, Ctrl+9, Ctrl+T from focused terminal, native keys, Electron 43 | 4/4 `event.action.invoke` dispatched ✓ |
| same on Electron 33.4.11 | identical — upgrade not at fault |
| type + Enter + Esc after Ctrl+T dialog over terminal | zero IPC traffic — keyboard black hole (Issue 2) |
| user's real `settings.json` | autoResume enabled, header-anchored detectText (Issue 3) |
| `pnpm -r test` at HEAD | all unit tests pass; only known multi-tab e2e failure |
