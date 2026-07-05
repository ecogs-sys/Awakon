# Awakon — Whole-App Code Review

**Date:** 2026-07-05 · **Scope:** full Electron app (`apps/desktop`, `packages/*`), packaging, and IPC surface · **Version reviewed:** 0.9.0 (branch `feat/fable-review`, clean tree)

Every finding below was verified by reading the actual code path end-to-end; file:line references point at the evidence. Findings marked **(verify)** have one step I could not confirm statically.

---

## Summary

Awakon is a well-structured Electron monorepo (chrome renderer + one `WebContentsView` per terminal tab, PTYs in main, Zod-validated IPC). The IPC handlers validate every payload, persistence is atomic with corruption fallback, markdown rendering is sanitized with DOMPurify, and mermaid runs at `securityLevel: 'strict'`. That's a solid baseline.

The most important issues found:

| # | Severity | Finding |
|---|----------|---------|
| H1 | High | URLs clicked in terminal output open inside the app (no `setWindowOpenHandler`, default `WebLinksAddon`) |
| H2 | High | Closing the *primary* pane of a split tears down the whole tab |
| H3 | High (macOS) | Reopening the window from the dock duplicates every session and doubles the persisted tab list |
| H4 | High (Linux) | Packaged Linux builds run with `--no-sandbox` for all users |
| M1–M8 | Medium | Sandbox off, generic preload bridge, unrestricted `openExternal`, focused-tab restore broken, bootstrap aborts on one bad cwd, dead auto-resume scheduler pipeline, content-triggered auto-typing on by default, no CSP |
| L1–L7 | Low | Details below |

---

## High severity

### H1. Terminal links open arbitrary remote content inside the app
`apps/desktop/src/renderer/terminal/main.ts` → `packages/terminal-host/src/terminal-host.ts:95` loads `new WebLinksAddon()` with **no custom handler**. The addon's default activation calls `window.open(uri)`. The app never installs `webContents.setWindowOpenHandler` or a `will-navigate` guard anywhere (grep across `apps/desktop/src` finds no occurrence), so Electron's default behavior creates a **new in-app window navigated to the clicked URL**.

Terminal output is untrusted — any command, remote server, or CI log can print a URL. One click puts remote web content inside your Electron process instead of the OS browser. (The doc reader gets this right: `doc-reader.ts:136-144` intercepts clicks and routes http(s) through `ChromeOpenExternal`.)

**Fix:**
1. Pass a handler to `WebLinksAddon` that sends the URL to main and opens it via `shell.openExternal` (after scheme check).
2. Defense in depth: in main, for every `web-contents-created`, call `setWindowOpenHandler(() => ({ action: 'deny' }))` and block `will-navigate` to non-app URLs.

### H2. Closing the primary pane of a split closes the entire tab
`split-container.ts:149-176` (`closeFocusedPane`) disposes the focused pane and sends `SessionClose` for it, expecting only that session to die and the sibling to be promoted. But main routes **every** `SessionClose` to full tab teardown: `index.ts:425` → `closeTab()` (`index.ts:308-318`), which calls `closeTabPanes` (kills *all* panes), `viewManager.destroy(tabId)` (destroys the tab's whole WebContentsView), and removes the tab.

When the focused pane is the tab's **primary session** (`initialSessionId`, which is also the `tabId`), "Close Pane" (Ctrl+Shift+W / context menu) therefore destroys the entire tab including the surviving pane. For non-primary panes it works only by accident (`tabMeta` miss makes `closeTab` degrade to a plain session close).

**Fix:** add a dedicated pane-close path (e.g. check `kind === 'pane'` in main, or a separate `SessionClosePane` channel), and make closing the primary pane re-parent tab ownership instead of tearing down the view.

### H3. macOS dock-reopen duplicates all sessions and doubles the persisted layout
`index.ts:568-571`: on `activate` with no windows, `createChromeWindow()` runs again — and it unconditionally re-runs `bootstrapSessions` (`index.ts:495`). On macOS, closing the window does **not** quit (`window-all-closed` only quits on non-darwin) and does not close sessions: the old PTYs, `tabMeta`, and `tabOrder` entries all survive. The rerun then:

- spawns a **new duplicate PTY for every persisted tab** (old ones keep running, orphaned without views), and
- appends the new ids to `tabMeta`/`tabOrder`, so the next `persistTabs()` writes old + new tabs — the saved layout roughly doubles per reopen.

The `NotificationBridge` comment (`index.ts:436-441`) shows window recreation is an expected flow, so this path is reachable in normal use.

**Fix:** on recreate, re-attach existing sessions to fresh views instead of re-bootstrapping (only call `bootstrapSessions` when `sessionManager.list()` is empty and `tabMeta` is empty).

### H4. Linux builds ship with the Chromium sandbox disabled
`apps/desktop/afterPack.cjs:12-28` renames the binary and installs a wrapper that always passes `--no-sandbox` — on AppImage **and** deb. That removes the renderer sandbox for every Linux user, which matters more here than usual because renderers routinely display untrusted terminal output (and see H1).

**Fix:** keep the SUID `chrome-sandbox` electron-builder ships (deb postinst sets 4755), or rely on unprivileged user namespaces on modern distros; restrict the `--no-sandbox` wrapper to the AppImage target only if it is genuinely required there, and document why.

---

## Medium severity

### M1. `sandbox: false` on every renderer
`index.ts:459-463` (chrome window) and `view-manager.ts:73-78` (every terminal view). The preload (`preload/index.ts`) only uses `contextBridge` + `ipcRenderer`, both available in sandboxed preloads. Nothing in the renderers needs Node. Enable `sandbox: true` to restore Electron's strongest isolation layer.

### M2. Preload exposes a fully generic IPC bridge
`preload/index.ts:3-13` exposes `send(channel, payload)` / `on(channel, handler)` for **any** channel string. There is no channel allowlist and no sender-side scoping, so any renderer (e.g. a terminal view, whose job is only its own session) can invoke *every* handler: create sessions at any cwd (`SessionCreate`), **type keystrokes into any other session** (`SessionWrite` validates the payload shape but never checks the sender owns that `sessionId`), read any `.md` on disk (`FsReadFile`), rewrite settings (`SettingsUpdate`), or open external URLs. Combined with M1/H1 this is the app's main hardening gap.

**Fix:** allowlist channels in the preload (separate lists for chrome vs terminal preloads), and in `IpcRouter` check `event.sender` against `sessionViews`/`chromeWindow` for session-scoped and chrome-only channels.

### M3. `shell.openExternal` accepts any URL scheme
`index.ts:227-232` validates only `z.string().url()` (`ipc.ts:203-205`), which accepts `file://…`, `smb://…`, etc. `shell.openExternal('file://...')` executes/opens local paths. The only current caller sends pre-filtered http(s), but the generic bridge (M2) means the handler itself is the security boundary. **Fix:** allowlist `http:`/`https:` in the handler.

### M4. Focused-tab restore is silently broken (persisted `focusedTabId` can never match)
Session ids are regenerated every launch (`session-manager.ts:38`, `randomUUID()`), but `bootstrapSessions` returns `persisted.focusedTabId ?? firstId` (`session-bootstrap.ts:42`) — an id from the *previous* process. `viewManager.show(staleId)` no-ops (`view-manager.ts:107-108`), and the chrome ignores the `LayoutShow` for an unknown id (`layout-manager.ts:100-103`). Net effect: after restart the **last-created** tab is focused/visible, never the one the user had focused; the `focusedTabId` field is dead weight. **Fix:** persist the focused tab's *index* (or match by position) and return `tabs[index]`'s new id.

### M5. One unrestorable cwd aborts the whole session restore **(verify)**
`session-bootstrap.ts:31-41` awaits `createTabSession` per tab with no per-tab error handling; `Session`'s constructor calls `pty.spawn` synchronously (`session.ts:64-70`). If a persisted `cwd` was deleted since last run, node-pty throws (ConPTY on Windows rejects a bad cwd), the loop dies on that tab, remaining tabs are never restored, and the rejection propagates into `app.whenReady().then(...)` (`index.ts:557-559`) as an unhandled rejection. **Fix:** wrap each tab restore in try/catch (fall back to home dir or skip the tab), and verify node-pty's bad-cwd behavior per platform with a quick test.

### M6. The auto-resume *scheduler* pipeline is dead code
`ResumeScheduler.schedule()` and `parseResetTime()` are never called from production code (grep: only tests and exports). Consequences:

- `ResumeScheduled`/`ResumeCancelled` events never fire → the countdown badge state (`layout-manager.ts:121-134`), the sidebar/badge cancel control, and the `ResumeCancel` IPC (`index.ts:264-269`, `session-manager.ts:122-126`) are unreachable.
- `packages/core` carries the `luxon` dependency solely for the unused parser.

This matches the deliberate pivot to the interactive-menu model (`session-manager.ts:52-63` responds immediately on detection and emits only `resumeFired`). **Fix:** delete `ResumeScheduler`, `parseResetTime`, the two events, the `ResumeCancel` channel, the badge/cancel UI, and the `luxon` dep — or wire the scheduler back in if the countdown UX is still wanted.

**Resolved (2026-07-05):** wired in as a two-stage flow (stage 1 answers the menu immediately, stage 2 schedules a `resumeText` nudge for after the parsed reset time) rather than deleted — see the "M6 — Wire the auto-resume scheduler" design in `docs/code-review-round2-2026-07-05.md`.

### M7. Default-on auto-resume types into the terminal whenever displayed content matches
`DEFAULT_APP_SETTINGS` ships `autoResume.enabled: true` with `detectText: 'Stop and wait for limit to reset'` (`settings.ts:22-36`). `RateLimitDetector` scans **all** PTY output (`session.ts:93`), so *any* text a program prints — `cat` of a file, a log line, output of a remote command — containing that phrase makes the app type `1␍` into that session (`session-manager.ts:57-63`). Both strings are user-configurable up to 200 chars, so a customized `responseText` could be injected at an attacker-chosen moment by getting the detect phrase displayed. **Fix:** ship disabled by default (opt-in), and consider scoping detection to sessions the user marked as agent sessions.

### M8. No Content-Security-Policy on either renderer page
`index.html` and `terminal-host.html` have no CSP meta tag and no `session.defaultSession.webRequest`-based policy. All content is local, so this is hardening, not an active hole — but it is the standard mitigation that would blunt H1/M2-style escalations. **Fix:** add a strict CSP (`default-src 'self'`; mermaid needs `style-src 'unsafe-inline'`).

---

## Low severity

### L1. Auto-resume response unlocks the attention gate without real user input
`Session.write` marks `hasReceivedUserInput = true` for any non-focus-report write (`session.ts:118-120`), and the auto-resume path calls `session.write('1\r')` (`session-manager.ts:61`). A restored session the user never touched starts emitting attention notifications after an auto-resume fires — exactly what the gate (`session.ts:73-82`) exists to prevent. Pass an "synthetic" flag for programmatic writes.

### L2. `FsReadFile` can read any `.md` anywhere on disk
`fs-handlers.ts:62-79` restricts extension and size but not location — no containment to the owning tab's cwd or workspace. Combined with M2, any renderer can exfil-read e.g. `~/.ssh/README.md` or notes anywhere. Consider resolving against and containing to the tab's cwd.

### L3. Settings dialog save can clobber concurrent `recentTabs` updates
`SettingsUpdate` replaces the whole `AppSettings` object (`index.ts:238-246`) with the snapshot the dialog loaded (`layout-manager.ts:203-217`). Closing a tab while the settings dialog is open (`RecentAdd`, `index.ts:253-261`) is silently overwritten on save. Merge `recentTabs` in the handler instead of trusting the client copy.

### L4. IPC logger records terminal keystrokes to disk
With `--log-ipc`/`AWAKON_LOG_IPC` enabled, every `SessionWrite` payload — i.e. everything typed into any terminal, **including passwords** — is written base64-encoded to plaintext JSONL (`ipc-logger.ts:217-238`, installed at `index.ts:29-40`). It's opt-in debug tooling, but deserves a redaction rule for `core.session.write` (log length, not content) or at least a loud warning.

### L5. DevTools and Reload ship in the production menu
`app-menu.ts:54-55` includes `{ role: 'reload' }` and `{ role: 'toggleDevTools' }` unconditionally. Reload of the chrome window re-runs `start()` against live state (mostly recoverable but untested), and DevTools in prod is usually gated. Wrap in `if (!app.isPackaged)`.

### L6. `doc-reader.ts` bypasses the shared accelerator formatter
`doc-reader.ts:204-206` defines its own `mod()` with a hardcoded `⌘`/UA sniff for the prev/next-file hints, while the project convention (and `docs/superpowers/specs/2026-07-04-awakon-direction-1-hot-wax-design.md` §4c) requires all shortcut labels to go through `formatAccelerator` (`packages/keymap/src/index.ts:40`). Same for the hardcoded `Ctrl+T`/`Ctrl+B` strings in `index.html` tooltips (lines 17-18, 29, 34) — wrong on macOS.

### L7. Unbounded per-session maps in long-lived services
`NotificationService.lastShownAt` (`notification-service.ts:28`) and `IpcRouter.sessionViews` entries for panes bound to a destroyed-then-replaced WebContents are cleaned up via `destroyed` (`ipc-router.ts:156-164`), but `lastShownAt` never evicts closed sessions. Trivial leak; prune on `sessionExited`.

---

## Packaging / release notes (informational)

- **Unsigned builds:** no Windows signing config, `"identity": null` on macOS (`electron-builder.json:21-28`) while `electron-updater` auto-downloads updates (`auto-update.ts:13-14`). On macOS, electron-updater *requires* a signed app for updates to install — auto-update is effectively broken there; on Windows users get SmartScreen warnings and no publisher validation of updates. Sign both when distribution matters.
- **`ViewManager` keeps every tab's `WebContentsView` alive** (hidden views are just 0-sized, `view-manager.ts:177-179`). That's a deliberate trade-off for instant tab switching and live scrollback, but memory grows linearly with tab count — worth a cap or view-recycling if users run many tabs.
- `second-instance` (`index.ts:561-566`) focuses the window but doesn't create one if none exists (macOS running-without-window case).

## What's done well

- Every IPC payload is Zod-validated at the boundary, with structured error returns instead of throws (`ipc-router.ts`, `index.ts` handlers).
- Atomic persistence with corruption quarantine (`.broken-<ts>` renames) and serialized write chains in both stores.
- Markdown rendering: DOMPurify sanitization (`markdown.ts:26-29`), mermaid at `securityLevel: 'strict'`, escaped fence content, and click interception that routes links to the OS browser (`doc-reader.ts:136-144`).
- The command palette escapes user strings before `innerHTML` (`command-palette.ts`), and other `innerHTML` uses are static templates with user data set via `textContent`.
- Thoughtful crash recovery (two-strikes-per-60s, scrollback replay from the ring buffer) and a correct, well-commented ring buffer.
- IPC logging interceptor design (per-instance `send` wrapping) is documented and testable; sync I/O rationale for Windows is sound.

## Suggested fix order

1. H1 (link handling + `setWindowOpenHandler` deny-all) — small change, biggest exposure.
2. H2 (pane close) and H3 (macOS reopen) — user-facing data-loss-grade bugs.
3. M1 + M2 (sandbox + channel allowlist) together, since they share the preload work; add M3's scheme check while there.
4. H4 (Linux sandbox) before the next Linux release.
5. M4–M7 as normal backlog; M6 is mostly deletion.
