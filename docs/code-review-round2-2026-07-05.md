# Awakon — Round-2 Review: Fixes for the 2026-07-05 Fix Commit + M6 Wiring Plan

**Date:** 2026-07-05 · **Scope:** re-review of the fix commit for `docs/code-review-2026-07-05.md` (diff `main...feat/fable-review`) · **Audience:** the agent implementing these fixes.

Round 1 findings H1, M3, M4, M5, M7, M8, L1, L3, L4, L5, L6, L7 were fixed correctly — do not touch them. This document lists (a) regressions/gaps the fix commit introduced, ranked by severity, and (b) the agreed design for M6, which was deliberately left unfixed and must be implemented as specified in the last section (wire the scheduler in — do **not** delete it, which was round 1's alternative suggestion).

Every finding was verified by reading the code at the cited file:line. Work top to bottom — R1 and R2 make the app unusable and mask everything else.

---

## R1 (critical): `sandbox: true` + ESM `.mjs` preloads — the bridge never loads

**Evidence:**
- `apps/desktop/package.json:12` — `"type": "module"`, so electron-vite (2.3) emits ESM preloads.
- `apps/desktop/out/preload/chrome.mjs` begins with `import { e as exposeScopedBridge, I as IpcChannel } from "./shared-Bro2MgTd.mjs"; import "electron";` — pure ESM, plus a separate shared chunk.
- `apps/desktop/src/main/index.ts:537` (chrome window) and `apps/desktop/src/main/view-manager.ts:76` (every terminal view) now set `sandbox: true`.

**Problem:** Electron (33) runs *sandboxed* preload scripts as plain scripts without ESM support. Both preloads throw on their `import` statements, `window.awakon` is never exposed, and every renderer is dead. Nothing else in the app can work.

**Fix (keep the sandbox — it is the point of M1):**
1. In `apps/desktop/electron.vite.config.ts`, force the preload build to CJS single-file output:
   ```ts
   preload: {
     build: {
       outDir: 'out/preload',
       rollupOptions: {
         input: {
           chrome: resolve(__dirname, 'src/preload/chrome.ts'),
           terminal: resolve(__dirname, 'src/preload/terminal.ts'),
         },
         output: {
           format: 'cjs',
           entryFileNames: '[name].cjs',
           // No shared chunks — each preload must be one self-contained file.
           manualChunks: undefined,
           inlineDynamicImports: false,
         },
       },
     },
   },
   ```
   (If rollup still emits a shared chunk for `shared.ts`, set `output.preserveModules: false` and check the output; a sandboxed preload must be a single CJS file per entry. Building each entry standalone is acceptable if needed.)
2. Update `preloadPath()` in `apps/desktop/src/main/index.ts` (~line 195) to load the new extension: `join(__dirname, `../preload/${kind}.cjs`)`.
3. **Verify by launching the app** (`pnpm dev` and a packaged/preview build): the window must render tabs and a working terminal. Check the console for "Unable to load preload script" — there must be none. Nobody launched the app after the fix commit; assume nothing works until you see it work.

## R2 (high): chrome preload send-allowlist is missing `LayoutShow`

**Evidence:** `apps/desktop/src/renderer/chrome/layout-manager.ts:332` and `:404` call `bridge.send(IpcChannel.LayoutShow, …)` on every tab focus/switch. `apps/desktop/src/preload/chrome.ts` SEND_CHANNELS does not include `IpcChannel.LayoutShow` (it is only in LISTEN_CHANNELS).

**Problem:** every tab click is rejected with `awakon: channel not allowed from this renderer` — main never shows the terminal view. Tab switching is completely broken even after R1 is fixed.

**Fix:** add `IpcChannel.LayoutShow` to SEND_CHANNELS in `apps/desktop/src/preload/chrome.ts`. Then re-audit: for each renderer, grep `send(IpcChannel.` / `on(IpcChannel.` under `apps/desktop/src/renderer/chrome`, `apps/desktop/src/renderer/terminal`, and `packages/terminal-host/src`, and confirm every channel used appears in the matching allowlist. (As of this review, `LayoutShow` was the only miss — but re-check after your own changes.)

**Prevent regression:** add a unit test that imports the allowlists and asserts they are a superset of the channels grepped/registered by each renderer, or at minimum a test pinning the current lists including `LayoutShow`.

## R3 (high): closing a split tab from the tab strip no longer closes the tab

**Evidence:** `apps/desktop/src/main/index.ts:374` (`handleSessionClose`) treats *any* `SessionClose` for a primary id with surviving panes as a pane-close and reparents. Chrome's tab-close X sends exactly that (`layout-manager.ts:325` → `SessionClose(tabId)`). `IpcRouter` drops `event.sender` before the callback (`packages/core/src/ipc-router.ts:236-243`), so main cannot tell chrome-tab-close from terminal-pane-close.

**Problem:** closing a tab that has splits closes only the primary pane and promotes a sibling; the user must click close once per pane. This is the H2 fix implemented at the wrong altitude.

**Fix (proper depth):** make the intent explicit instead of inferring it:
1. Add `SessionClosePane: 'core.session.close-pane'` to `IpcChannel` in `packages/contracts/src/ipc.ts` (payload = same `SessionClosePayloadSchema`).
2. In `packages/core/src/ipc-router.ts`, handle it with the same `isAuthorizedSender` check and a new `onSessionClosePane` callback.
3. `apps/desktop/src/renderer/terminal/split-container.ts` `closeFocusedPane` (~line 149) sends `SessionClosePane` instead of `SessionClose`.
4. Add `SessionClosePane` to the **terminal** preload SEND_CHANNELS and remove `SessionClose` from it (a terminal view only ever closes panes). Chrome keeps `SessionClose`.
5. In `apps/desktop/src/main/index.ts`: `ipcRouter.onSessionClose(...)` → always `closeTab(sessionId)` (full teardown, panes included, as before the fix commit); `ipcRouter.onSessionClosePane(...)` → the current `handleSessionClose` reparent/pane logic.
6. Tests: (a) tab with 2 panes, chrome sends `SessionClose(tabId)` → whole tab gone including panes; (b) terminal sends `SessionClosePane(primaryId)` with a sibling → reparent, tab survives; (c) `SessionClosePane` on a non-primary pane → only that pane's session closes.

## R4 (high, Linux release): the H4 fix ships a broken AppImage

**Evidence:** `apps/desktop/electron-builder.json:30` builds `"target": ["AppImage", "deb"]` in one invocation. `apps/desktop/afterPack.cjs:39` returns early whenever `deb` is among the targets, so the `--no-sandbox` wrapper is *never* applied in the standard release build — yet the file's own comment explains the AppImage genuinely needs it (SUID bit doesn't survive the AppImage mount). Target-name casing is correct (`app-builder-lib` uses `super("appImage")`) — that is not the issue.

**Problem:** the released AppImage has neither a working SUID sandbox nor `--no-sandbox`, and fails to launch on distros restricting unprivileged user namespaces (e.g. Ubuntu 23.10+).

**Fix:** split the Linux build into two electron-builder invocations so each target gets the right treatment:
- In `apps/desktop/package.json` / CI workflow: `electron-builder --linux deb` (no wrapper, SUID sandbox via postinst) then `electron-builder --linux AppImage` (wrapper applied, since `deb` is absent from that pack).
- Change `electron-builder.json` `linux.target` accordingly (or drive targets purely from CLI flags).
- Keep the `afterPack.cjs` guard as-is — it becomes correct once the invocations are separate. Update its comment to state the two-invocation requirement.
- Verify: run both builds; confirm the deb's binary is unwrapped and the AppImage's binary is wrapped (the wrapper script passes `--no-sandbox`).

## R5 (medium, macOS): dock-reopen reattach duplicates pane sessions / leaks PTYs

**Evidence:** the H3 reattach path (`apps/desktop/src/main/index.ts:574-582`) rebinds the *old* pane session ids to the fresh view's WebContents. But persisted split leaves carry no session ids (`split-container.ts` `serializeNode`: `{ kind: 'leaf' }`), so the fresh terminal renderer's `restoreFromSaved()` (`apps/desktop/src/renderer/terminal/split-container.ts:344-357`) rebuilds the tree via `splitFocused` → `SessionCreateForPane`, creating brand-new pane PTYs. The old pane sessions are never closed.

**Problem:** every macOS dock-reopen of a split tab leaks the previous pane PTYs (still running, invisible) and grows `paneOwnership`. H3 is fixed for tabs but not panes.

**Fix (smallest correct):** in the reattach branch, before (or instead of) rebinding old panes, close them and let the renderer rebuild from the persisted split tree:
```ts
for (const tabId of tabOrder) {
  closeTabPanes(tabId);          // kill surviving pane PTYs; splits restore recreates them
  await createSessionView(tabId);
}
```
and delete the now-dead `bindSessionView(paneId, …)` rebinding loop. Trade-off: pane scrollback is lost on dock-reopen (pane PTYs are recreated) — acceptable and strictly better than leaking; note it in the comment. A future improvement (out of scope) would persist pane session ids and reattach them like the primary.
Test: simulate the reattach branch with a tab owning 2 panes; assert `sessionManager.list()` contains no orphaned pane sessions after reattach + splits restore.

## R6 (medium, security): sender-scoping (M2) gaps contradicting the code's own comments

**Evidence:** `packages/core/src/ipc-router.ts` — `SessionCreateForPane` (line 203), `LayoutPersistSplits` (line 313), `LayoutSplitsForTab` (line 320) have no `isAuthorizedSender` check, yet all three are in the terminal preload's SEND allowlist. `apps/desktop/src/preload/terminal.ts` explicitly claims "SessionCreateForPane, which main scopes to the caller's own tabId" — untrue: `apps/desktop/src/main/index.ts:417` never sees the sender.

**Problem:** a compromised terminal renderer can (a) spawn PTYs at any cwd/shell attributed to any tab, (b) overwrite another tab's persisted split tree (corrupting its next restore), (c) read another tab's layout.

**Fix:** apply the same pattern used for `SessionWrite`: in each of the three handlers, validate the payload's `tabId` with `isAuthorizedSender(e.sender, tabId)` (for `SessionCreateForPane`, check the *tabId* field — the pane doesn't exist yet). Chrome remains exempt via `chromeWebContents`. Add router tests mirroring the existing "M2 sender ownership" describe block for all three channels.

## R7 (low): `will-navigate` guard allows `file://` → `file://` navigation

**Evidence:** `apps/desktop/src/main/index.ts:~47-56` compares `new URL(url).origin !== new URL(contents.getURL()).origin`. Every `file:` URL has origin `"null"`, so `"null" !== "null"` is false and any local-file navigation is allowed in packaged builds.

**Fix:** treat `file:` specially — allow only the app's own packaged pages:
```ts
contents.on('will-navigate', (navEvent, url) => {
  try {
    const target = new URL(url);
    const current = new URL(contents.getURL());
    const sameOrigin = target.origin === current.origin && target.origin !== 'null';
    const appFile = target.protocol === 'file:' &&
      !relative(join(__dirname, '../renderer'), fileURLToPath(target)).startsWith('..');
    if (!sameOrigin && !appFile) navEvent.preventDefault();
  } catch { navEvent.preventDefault(); }
});
```

## R8 (low): production CSP ships the dev-only localhost `connect-src`

**Evidence:** `apps/desktop/index.html:9` and `apps/desktop/terminal-host.html:6` include `connect-src 'self' ws://localhost:* http://localhost:*` — needed only for the dev server's HMR websocket, but present in packaged pages.

**Fix:** tighten the meta tags to `connect-src 'self'` and allow localhost in dev via main instead (electron-vite dev pages come from the dev server anyway; if the meta must differ per mode, inject the dev policy with `session.defaultSession.webRequest.onHeadersReceived` when `!app.isPackaged`).

## R9 (cleanup): IPC-logger redaction keys on a hardcoded string

**Evidence:** `apps/desktop/src/main/ipc-logger.ts:187` — `const SESSION_WRITE_CHANNEL = 'core.session.write';`.

**Fix:** import `IpcChannel` from `@awakon/contracts` (already a workspace dependency) and use `IpcChannel.SessionWrite`, so a channel rename can't silently disable the L4 keystroke redaction.

## Non-finding, for awareness

Flipping `autoResume.enabled` to `false` (M7) only affects fresh installs; existing users' persisted settings keep `true`. That is accepted behavior — do not "fix" it.

---

# M6 — Wire the auto-resume scheduler (implement exactly this)

**Requirement:** two-stage auto-resume. Stage 1: when the rate-limit menu appears, immediately type `responseText` (`1` + Enter) so Claude Code selects "stop and wait for limit to reset". Stage 2: parse the renew time out of the rate-limit message (e.g. `You've hit your session limit · resets 12:50pm (Pacific/Auckland)`), schedule it, and when it passes, type `resumeText` (`continue` + Enter) into the session.

**Do not delete anything.** Round 1 offered deletion as an alternative; the decision is to wire it in. Almost everything already exists and is live:

| Piece | Where | Status |
|---|---|---|
| Detector emits matched text + trailing context | `packages/core/src/rate-limit-detector.ts:60` | live, but context capture needs one change (step 1) |
| `parseResetTime` (luxon, handles `12:50pm (Pacific/Auckland)`) | `packages/core/src/reset-time-parser.ts` | exists, unused |
| `ResumeScheduler` (sweep-based, sleep-robust, 30s grace, dedups per session) | `packages/core/src/resume-scheduler.ts` | exists, unused |
| `resumeScheduled/Cancelled/Fired` forwarding to chrome | `apps/desktop/src/main/index.ts:300-307` | live |
| Countdown badge + cancel UI + `ResumeCancel` IPC | `layout-manager.ts` / `sidebar.ts` / `index.ts:292` | live, currently unreachable |
| Pending resume cancelled on session close | `packages/core/src/session-manager.ts:116` | live |

The only missing wire is in `SessionManager`'s `rateLimitDetected` handler, plus one detector tweak and one settings field.

### Verified against a real session (IPC log)

`C:\temp\ipc-logs\ipc-20260621-095615-000001 - end session.jsonl` captures a real rate-limit hit (2026-06-21, Claude Code v2.1.166). Decoded frames confirm:

1. **Exact on-screen text** (frame #86314): `You've hit your session limit · resets 9:10pm (Pacific/Auckland)` … `/rate-limit-options` … a ~150-char ruler line … `What do you want to do?` … `❯ 1. Stop and wait for limit to reset` / `2. Upgrade your plan` / `Enter to confirm · Esc to cancel`. The reset time appears **before** the menu option, separated by roughly 250-300 chars of status text and ruler lines — hence the leading-context capture below, sized generously.
2. **Option 1 is default-highlighted**; the user confirmed it with arrows + Enter (frames #86333-86338: `ESC[B`, `ESC[A`, `\r`). Claude Code's select menus also accept the number key, so `responseText: '1'` + `\r` confirms option 1 whether `1` jump-selects or is a no-op on the already-highlighted row — the trailing `\r` confirms either way.
3. **After confirming option 1 the CLI returns to the normal idle prompt** (frames #86339-86343). This validates stage 2: at renew time the session is sitting at a regular prompt, so typing `resumeText` (`continue`) + Enter is exactly the right nudge and is harmless if Claude already resumed.
4. The percent-usage warnings (`You've used 9x% of your session limit · resets …`) appear many times **before** the hit — the detect phrase (the option-1 label) correctly ignores them. Menu redraws during arrow navigation repeat the phrase; the detector's `present` flag already dedups those.
5. The only writes while the menu sat open for 2h were xterm focus reports (`ESC[I`/`ESC[O`) — confirming the `isXtermFocusReport` exclusion in the attention gate must stay.

### Step 1 — `packages/core/src/rate-limit-detector.ts`: capture leading context

The reset time precedes the matched phrase (see above), and the current capture starts *at* the phrase, so the time is missed. Change line ~60:

```ts
// The 'resets 9:10pm (Pacific/Auckland)' header sits ~250-300 chars before the
// option-1 label (status line + ruler lines in between) — verified from a real
// IPC log. 600 gives comfortable margin for wider terminals.
const LEADING_CONTEXT = 600;

const resetText = stripped.slice(
  Math.max(0, idx - LEADING_CONTEXT),
  idx + this.detectText.length + TRAILING_CONTEXT,
);
```

Add a detector test using the real layout: `You've hit your session limit · resets 9:10pm (Pacific/Auckland)`, ~280 chars of filler/ruler, then the detect phrase — assert the emitted `resetText` includes the reset time. (`parseResetTime`'s `TIME_RE` requires an am/pm marker, so surrounding spinner text like `Worked for 11m 47s` cannot false-match.)

### Step 2 — `packages/contracts/src/settings.ts`: add `resumeText`

Add to `AutoResumeSettingsSchema`: `resumeText: z.string().max(200).default('continue')` — the zod `.default` keeps existing users' persisted settings parsing without a migration. Add `resumeText: 'continue'` to `DEFAULT_APP_SETTINGS.autoResume`. Expose the field in the settings dialog (`apps/desktop/src/renderer/chrome/settings-dialog.ts`) next to `responseText`.

### Step 3 — `packages/core/src/session-manager.ts`: the missing wire

Replace the handler at lines 57-62:

```ts
session.on('rateLimitDetected', (resetText) => {
  if (!this.autoResume.enabled) return;
  if (session.info().status === 'exited') return;
  // Stage 1: answer the menu now — responseText ('1') selects "wait for reset".
  session.write(`${this.autoResume.responseText}\r`, { synthetic: true });
  // Stage 2: schedule the post-renewal nudge. schedule() returns false when one
  // is already pending, which dedups repeated detections from TUI redraws.
  const resetAt = parseResetTime(resetText, new Date());
  if (resetAt !== null && this.resumeScheduler.schedule(id, resetAt)) {
    this.emit('resumeScheduled', id, resetAt);
  }
});
```

Semantics change: `resumeFired` now means "the scheduled continue was typed" — remove the `emit('resumeFired', id)` from this handler; it stays only in `fireResume` (line 133). In `fireResume` (line 132), change the write to `` session.write(`${this.autoResume.resumeText}\r`, { synthetic: true }) ``.

If parsing fails (`resetAt === null`), stage 1 already answered the menu and Claude Code waits on its own — no schedule, no badge; that is the correct fallback.

### Step 4 — tests

- `packages/core/tests/session-manager-resume.test.ts`: emit `rateLimitDetected` with a realistic message containing `resets 12:50pm (Pacific/Auckland)`; assert (a) `'1\r'` written synthetically immediately, (b) `resumeScheduled` emitted with the parsed epoch, (c) after forcing the scheduler sweep past `resetAt + grace`, `'continue\r'` is written synthetically and `resumeFired` is emitted, (d) `cancelResume` before the sweep prevents the write and emits `resumeCancelled`, (e) unparseable text → `'1\r'` written, nothing scheduled.
- Update `packages/core/tests/settings-schema.test.ts` for `resumeText` (default `'continue'`, and that a persisted settings object *without* `resumeText` still parses).
- `tests/integration/auto-resume.test.ts`: extend to the two-stage flow.

### Behavior notes (for comments/docs, not code changes)

- The scheduler's 30s grace means "continue" lands ~30-50s after renewal — intended.
- If Claude Code already self-resumed (option 1 does that), the extra `continue` is a harmless nudge.
- `synthetic: true` keeps both writes from unlocking the attention gate (L1 stays fixed).
- luxon remains a real dependency of `packages/core` — ignore round 1's "remove luxon" suggestion.
- Future (out of scope, tracked in memory): extend detection/response to other coding CLIs.

---

## Definition of done

1. All of R1-R9 fixed with the tests listed; M6 implemented per the steps above.
2. Full test suite green (`pnpm test` at repo root).
3. **App smoke-launched** (dev *and* packaged/preview): window renders, tabs create/switch/close (including a split tab closed from the tab strip in one action), terminal echoes keystrokes, a doc opens in the reader. R1/R2 were only catchable by launching — do not skip this.
4. Update `docs/code-review-2026-07-05.md`'s M6 section with a one-line pointer to this file's M6 design.
