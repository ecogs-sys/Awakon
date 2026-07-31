# Consolidated Code Review — 2026-07-07

Validates and merges two prior review documents against the code at HEAD (`de4cd5e`, branch `feat/fable-review`):

- `docs/code-review-round3-2026-07-06.md` (round-3: N1–N11, C1–C9) — written against `51df7fc`, **before** the fix commit `93b5e1b`
- `docs/independent-code-review-2026-07-06.md` (independent: 7 areas) — written **at** HEAD `de4cd5e`

Every Critical/Important finding below was re-verified by reading the cited code at HEAD. Verdicts: **FIXED** (round-3 item confirmed landed), **CONFIRMED** (defect exists at HEAD, evidence checked), **PARTIAL** (true but materially mitigated), **REFUTED** (does not hold at HEAD), **UNVERIFIED** (reported, not independently re-checked — all such items are labeled).

Apparent contradictions between the two documents (e.g. round-3 N6 "FsReadFile has no containment" vs. the independent review listing containment as a strength) are resolved by the timeline: `93b5e1b` ("fix: address round-3 findings") landed between them.

---

## Part 1 — Round-3 (N1–N11, C1–C9) validation: all fixed at HEAD

| # | Verdict | Evidence at HEAD |
|---|---------|------------------|
| N1 | **FIXED** | `reparentTab` drops the stale splits tree (`apps/desktop/src/main/index.ts:363-367`); renderer `retarget()` re-persists under the new id (`split-container.ts:258-264`) |
| N2 | **FIXED** | `ViewManager` keeps a `liveIdOf` WeakMap; crash listener resolves the live id at fire time; `rekey()` updates it (`view-manager.ts:35,86-92,158-165`) |
| N3 | **FIXED** | `Session.kind` mutable via `promoteToTab()` (`packages/core/src/session.ts:46-48,164-166`); called from `reparentTab` (`index.ts:373`) |
| N4 | **FIXED** | `sessionExited` keeps `paneOwnership` for owned panes (`index.ts:329-340`); `handleSessionClosePane` finds the exited sibling and reparents (`index.ts:392-406`). *Residue: see New-1 below* |
| N5 | **FIXED** | Resume events map pane→tab via `paneOwnership` (`index.ts:302-313`); `ResumeCancel` cancels the tab and every owned pane (`index.ts:287-296`) |
| N6 | **FIXED** | Containment enforced at the read boundary: `FsReadFile` requires `tabId`, resolves against the tab cwd, applies `isPathInside` (`fs-handlers.ts:65-79`); doc-reader sends `tabId` (`doc-reader.ts:163`) |
| N7 | **FIXED** | afterPack wraps `appImage` **or** `dir`, throws on a combined deb invocation (`afterPack.cjs:27-34`) |
| N8 | **FIXED** | Bootstrap retries at `$HOME` with "(cwd unavailable)" title before skipping (`session-bootstrap.ts:60-70`) |
| N9 | **FIXED** | Single shared `isPathInside` with the `..`-segment check (`navigation-guard.ts:16-19`), used by nav guard, DocOpen (`index.ts:498`), and FsReadFile |
| N10 | **FIXED** | Dev-CSP plugin throws when the marker is absent (`electron.vite.config.ts:19-24`); no `onHeadersReceived` comment remains (grep: only in docs) |
| N11 | **FIXED (mechanism)** | Pending-resume guard + 5-min cooldown (`session-manager.ts:39-41,70-74`); menu-chrome anchoring (`rate-limit-detector.ts:21,73`). **But the anchor is too weak — superseded by open finding #2 below** |
| C1–C9 | **FIXED** | C1 test derives channels from source grep (`channels.test.ts:22-44`); C2 `isHttpUrl` in schema + shared helper (`contracts/ipc.ts:203-209`); C3 `Bridge = PreloadBridge` (`preload/shared.ts:7`); C4 field initializer restored + cancel test now waits for the schedule before cancelling (`auto-resume.test.ts:121-124`); C5 `ChromeMenuPopup` gone (grep: only CHANGELOG); C6 one-line reparent listener (`renderer/terminal/main.ts:43-46`); C7 `UserEditableSettingsSchema` (`contracts/settings.ts:23-27`, `index.ts:258-261`); C8 `Promise.all` + `focusAndShow()` (`index.ts:555-559,628-630`); C9 preload mtime skip (`apps/desktop/scripts/build-preload.mjs:28-39`), injectable idle window (`session.ts:59`, `attention-detector.ts:32`), `tests/e2e/helpers.ts` exists. *Residue: `splits.spec.ts:23` still has a blind 2.5 s wait — see Minor list* |

---

## Part 2 — Independent review validation

### Critical findings — all three CONFIRMED

**1. IPC sender authorization is incomplete (Area 1 C1 + Area 3 C1 — same finding, one fix).** CONFIRMED.
`IpcRouter.isAuthorizedSender` (`ipc-router.ts:193-196`) is applied to `SessionWrite`/`Resize`/`Close`/`ClosePane`/`Replay`/`CreateForPane`/`PersistSplits`/`SplitsForTab`/`DocOpen` — but **not** to:

- `SessionCreate` (`ipc-router.ts:199`) — and `SessionCreateOptionsSchema` still carries `env` (`contracts/session.ts:26`) merged over `process.env` (`core/session.ts:73`)
- `SessionRestartView` (`ipc-router.ts:267`), `SessionSetTitle` (`ipc-router.ts:274`)
- `LayoutPersistDocs` / `LayoutDocsForTab` (`ipc-router.ts:361-375`) — inconsistent with `LayoutPersistSplits`, which is guarded three handlers up
- **every** handler in `index.ts` (`SettingsUpdate` at :258, `FsReadFile` via `fs-handlers.ts`, `RecentAdd`, `ChromeAppMenuPopup`, `ChromeWindowControl`, `ChromeOpenExternal`, `ChromeAppInfo`, `ResumeCancel`) — none reads `event.sender`

The escalation chain is real: a compromised (sandboxed) terminal renderer invokes `SettingsUpdate` directly at the process level (preload allowlists only constrain page JS), sets `autoResume` to `{enabled, detectText: <something its own PTY prints>, responseText: <arbitrary shell command>}`, and `SessionManager` types that command + Enter into the un-sandboxed PTY (`session-manager.ts:75`). Sandbox escape to arbitrary user-level command execution.

**2. Auto-resume menu anchor defeated by a bare `❯` (Area 4 C1 — the successor to N11).** CONFIRMED.
`MENU_CHROME_MARKERS = ['❯', 'Enter to confirm']` and the check is `resetText.includes(marker)` over ~800 chars of context (`rate-limit-detector.ts:21,67-73`). `❯` is the prompt glyph of Claude Code itself and of starship/pure/p10k shells, so quoted text (a doc, a transcript, `cat settings.ts`) near an ordinary prompt satisfies the anchor. The N11 cooldown caps the damage at one `1\r` per 5 minutes per session — but that keystroke can select option 1 of whatever menu is actually open. Note the integration test itself fires detection via a plain `echo` that includes "Enter to confirm" (`tests/integration/auto-resume.test.ts:120`) — the false-positive class is even test-encoded. Fix as the review proposes: require a structural menu signature (option-line regex at line start **and** the confirm footer), not a single glyph.

**3. Reader/modal lifecycle desync (Area 5 C1 + C2).** Both CONFIRMED.
- `closeTab()` reassigns focus directly without `this.focus()`/`syncReader()` (`layout-manager.ts:319-343`) — closing a tab with the reader open leaves the dead tab's reader rendered and `LayoutModal` stuck open (terminal view suspended). The `LayoutTabReparented` handler (:155-164) also skips `syncReader()`.
- `LayoutModal` is a stateless boolean → `viewManager.suspend()/resume()` (`index.ts:457-460`). Reader open (modal=true) → open Settings (true again) → close Settings → `finally` sends `{open:false}` (`layout-manager.ts:233-234`) → terminal view un-suspends over the still-visible reader. Needs a refcount or re-derivation after each overlay closes.

### Important findings — verdicts

| Finding | Verdict | Notes |
|---|---|---|
| A1-I1 auto-update: no channel pin, silent `autoDownload`, no Linux signature | **CONFIRMED** | `auto-update.ts:17-25`, `electron-builder.json:35-41` |
| A1-I2 `before-quit` un-quittable if `closeAll()` rejects | **CONFIRMED** | `index.ts:710-717` — `preventDefault()` then bare `await`, no try/finally |
| A1-I3 no `will-frame-navigate` / `will-attach-webview` / permission handler | **CONFIRMED** | grep over `apps/desktop/src`: absent |
| A1-I4 IPC-logger `send`-wrap never unwrapped | **CONFIRMED, negligible** | `ipc-logger.ts:266-279`; patch dies with its WebContents |
| A2-I1 unused `env` in `SessionCreateOptionsSchema` | **CONFIRMED** | schema `session.ts:26`; grep: no renderer sends `env` |
| A2-I2 allowlist test asserts superset only, never exclusion | **CONFIRMED** | `channels.test.ts:46-76` — adding `FsReadFile` to terminal SEND would still pass |
| A2-I3 settings unversioned; schema break silently resets all settings | **CONFIRMED** | `contracts/settings.ts` (no version), `settings-store.ts:44-48` wholesale default fallback |
| A2-I4 stringly-typed bridge | **CONFIRMED** | `terminal-host.ts:18-21`; every call site casts |
| A3-I1 `applyAutoResumeConfig` re-arms detector mid-stream | **PARTIAL → Minor** | Re-arm is real (`rate-limit-detector.ts:45-49`) but the manager-level pending-resume guard + 5-min cooldown (`session-manager.ts:70-74`) still gate any re-fire; note disable *does* cancel pending resumes, re-opening the window only after cooldown expiry |
| A3-I2 `SessionManager.write` drops `synthetic` opt | **CONFIRMED, minor** | `session-manager.ts:97-99`; only affects future internal callers |
| A3-I3 exited sessions never evicted | **PARTIAL → Minor** | True (`session-manager.ts:49-56`), but retention is spec §7 behavior — an exited tab/pane stays visible with readable scrollback until explicitly closed, and `close()`/`closeTab` do delete. Accumulation is bounded by visible UI items, not unbounded |
| A4-I1 idle-prompt heuristic on raw un-stripped bytes | **CONFIRMED** | `attention-detector.ts:10,77,98` |
| A4-I2 foreign OSC terminator BELs counted as bells | **CONFIRMED** | `attention-detector.ts:43-74` — `\x1b]0;title\x07` mismatches the awakon prefix at byte 3, terminating `\x07` hits the bell branch |
| A4-I3 `parseResetTime`: no 24 h, no dates, first-match-wins-then-gives-up | **CONFIRMED** | `reset-time-parser.ts:4,19-27` — single `exec`, 12 h-only regex, invalid first candidate → null |
| A4-I4 first clock time in 600 chars of leading context wins | **CONFIRMED** | `rate-limit-detector.ts:11,67-70` + parser above; not anchored to "resets" |
| A4-I5 resume fires blind, no fire-time re-check | **CONFIRMED** | `session-manager.ts:150-155` — only guards exited |
| A4-I6 Notification instance unreferenced, click callback GC-able | **CONFIRMED code-side; runtime impact UNCONFIRMED** | `notification-service.ts:52-54` |
| A5-I1 global shortcuts live behind modals; Ctrl+T destroys an open dialog + leaks its promise | **CONFIRMED** | `keyboard.ts:63-72` (no suppression) + `new-session-dialog.ts:34` (`mount.innerHTML=''` on open), cleanup at :170-175 never resolves the wiped dialog's promise, its `document` keydown listener leaks |
| A5-I2 every dialog open leaks a backdrop-click listener on the persistent mount | **CONFIRMED** | `new-session-dialog.ts:184-186`, `settings-dialog.ts:206-208` — cleanup removes keydown only |
| A5-I3 mermaid SVG injected via `innerHTML` with no DOMPurify pass | **CONFIRMED** | `mermaid.ts:37-41`; `securityLevel:'strict'` is the sole barrier; CSP is the backstop |
| A5-I4 sanitized markdown can DOM-clobber `#dialog-mount` | **CONFIRMED** | `markdown.ts:28` keeps `id`; dialogs resolve `getElementById('dialog-mount')` at open (`layout-manager.ts:225,241,263,364`) |
| A5-I5 1 s tick full-rebuilds tab strip/sidebar/empty state | **CONFIRMED** | `layout-manager.ts:205` → `tab-strip.ts:30` (`innerHTML=''` rebuild), `empty-state.ts:45` |
| A5-I6 hardcoded shortcut labels bypass `formatAccelerator` | **CONFIRMED** | `tab-strip.ts:79,106` ("Ctrl+W"/"Ctrl+T" literals), `empty-state.ts:9-11,111` (`platformMod()` UA sniff) — violates the standing per-OS labels rule |
| A6-I1 paste not sanitized (`\x1b[201~` bracket-escape) | **CONFIRMED code-side** | `split-container.ts:230-233` → `terminal-host.ts:131-133` pass clipboard text to `term.paste` untouched; the xterm-5.5-doesn't-strip claim is per-review (UNCONFIRMED against xterm source) |
| A6-I2 context-menu shortcut labels contradict real bindings | **CONFIRMED** | `context-menu.ts:37-45` advertises `Mod+D`/`Mod+Shift+D`/`Mod+W`; keymap defines `CmdOrCtrl+\`, `CmdOrCtrl+Shift+\`, `closePane=CmdOrCtrl+Shift+W` (`keymap/index.ts:27-29`); Copy/Paste/Select-all have no keyboard wiring in the terminal renderer |
| A6-I3 split-during-close corrupts the tree | **CONFIRMED** | `split-container.ts:67-121` — if `oldFocused` left the tree during the await, `replaceChild` no-ops (null parent), `replaceInTree` → null, `?? branch` installs an orphaned root never attached to the DOM |
| A7-I1 Electron fuses never applied | **CONFIRMED** | grep: no `@electron/fuses`/`flipFuses` outside docs |
| A7-I2 smoke test can miss early renderer errors | **CONFIRMED** | `smoke.spec.ts:7-17` — `window` handler attached after `launch()`; a first window created before attach gets no listeners at all |
| A7-I3 mac signing disabled | **CONFIRMED** | `electron-builder.json:27` `identity: null`, no afterSign — mac direct-download release blocker |

### Refuted / corrected

- **A5-M2 "Settings Save can clobber recentTabs"** — **REFUTED at HEAD.** The dialog does still send `recentTabs` (`settings-dialog.ts:192`), but `SettingsUpdate` parses with `UserEditableSettingsSchema`, which has no `recentTabs` field — Zod strips it — and main re-attaches its own copy (`index.ts:261`). The C7 fix closed this at the wire. Remaining nit: drop the dead `recentTabs` field from the dialog's cleanup payload and its type.

### Minor findings

Spot-verified as accurate: A1-M1 (`ChromeAppInfo` unauthenticated — folds into Critical #1), A1-M3 (create/recreate view duplication, `index.ts:146-164` vs `654-676`), A1-M4 (no `.catch` on `whenReady().then(...)`, `index.ts:694-696`), A2-M1 (dead `SessionCreateDefault`: handler `index.ts:316`, in no allowlist), A2-M2 (unused `NotificationRequestSchema`/`TabIdSchema`), A2-M3 (`LayoutShow` bidirectional on one channel, `chrome.ts:31,39`), A2-M4 (send rejects / on warns asymmetry, `shared.ts:24-33`), A2-M5 (base64 fields plain `z.string()`), A2-M6 (`readSources` non-recursive, `channels.test.ts:22-27`), A2-M7 (double-cast, `settings.ts:54`), A3-M1 (`Date.now()+Math.random()` temp names, `settings-store.ts:64`), A3-M2 (no fsync before rename), A3-M3 (close/closeAll duplicate kill dance, `session-manager.ts:105-124,157-179`), A3-M4 (`list()` includes exited + panes), A4-M1 (exact `indexOf` match breaks on line wrap), A4-M2 (`setDetectText` re-arms without rescanning the window), A4-M3 (OSC payload built with Latin-1 `fromCharCode`), A4-M4 (DCS/APC payloads survive `ANSI_RE`), A4-M5 (`notify()` stamps before `show()`, no `isSupported`), A4-M6 (`process()` after `dispose()` re-arms the idle timer), A5-M1 (`eventMatches` conflates Ctrl/Cmd + dead `ev.code` branch, `keyboard.ts:24,28`), A5-M5 (drop-at-end unreachable — no drop target off the tabs), A5-M9 (three separate UA sniffs: `layout-manager.ts:302`, `new-session-dialog.ts:191`, `empty-state.ts:10`), A6-M1/M2 (`platform.ts` duplicate formatter hardcoding `⌘`; `matchShortcut`/`MOD` used only by tests), A6-M3 (unhandled clipboard rejections, `split-container.ts:228-232`), A6-M6 (`restore()` casts root, `split-container.ts:298`), A6-M7 (divider drag no `preventDefault`), A7-M1 (`splits.spec.ts:23` blind 2.5 s wait), A7-M2 (appx placeholders — deliberate pre-Partner-Center state).

**UNVERIFIED (reported by the independent review, not independently re-checked):** A3-M5, A4-I6 runtime behavior, A4-M7, A5-M3, A5-M4, A5-M6, A5-M7, A5-M8, A6-I1 xterm-internals claim, A6-M4, A6-M5, A7-M3, A7-M4, A7-M5, and the cross-area note that `SessionExited`/`TitleChanged`/`Attention` broadcast to all subscribed WebContents (`ipc-router.ts:395-405` — code confirmed; leak significance not assessed).

---

## Part 3 — New findings from this validation (in neither document)

1. **Dead no-op in the N4 fix** — `index.ts:337-339`: `if (!tabMeta.has(sessionId) && !paneOwnership.has(sessionId)) paneOwnership.delete(sessionId)` deletes a key it just confirmed absent. Harmless; either delete the block or fix the condition to whatever cleanup was intended.
2. **Settings dialog sends a field the schema strips** — `settings-dialog.ts:192` still includes `recentTabs` in its result payload (see refuted A5-M2). Dead payload; remove for clarity.
3. **`docs/independent-code-review-2026-07-06.md` is itself defective** — after the executive summary it repeats a partial "Area 1" section and ends mid-sentence at line 291. The content before the executive summary is complete; the trailing duplicate should be deleted.
4. **The auto-resume integration test bakes in the false-positive class** — `tests/integration/auto-resume.test.ts:120` triggers detection by `echo`ing the phrase + "Enter to confirm" as ordinary output, i.e. the test passes *because* the anchor accepts non-menu text (Critical #2).

---

## Part 4 — Consolidated action list (deduplicated, ranked)

### Critical
1. **Apply sender authorization uniformly** (A1-C1 ≡ A3-C1, includes A1-M1): guard `SettingsUpdate`, `FsReadFile`, `RecentAdd`/`RecentList`, all `Chrome*`, `ResumeCancel`, `SessionCreate`, `SessionRestartView`, `SessionSetTitle`, `LayoutPersistDocs`/`DocsForTab` (chrome-only for the chrome set; `isAuthorizedSender` for session-scoped ones). Remove `env` from `SessionCreateOptionsSchema` while there (A2-I1).
2. **Replace the `❯`/`includes` menu anchor with a structural menu signature** (A4-C1; supersedes N11's anchor): option-line regex at line start + confirm footer; update the integration test so a plain `echo` no longer fires (New-4). Land before promoting auto-resume.
3. **Fix reader/modal lifecycle** (A5-C1, A5-C2): `syncReader()` in `closeTab()` and the reparent handler; refcount `LayoutModal`.

### Important — security/robustness
4. `before-quit` try/finally so `app.exit(0)` always runs (A1-I2).
5. Electron fuses (RunAsNode / NodeCliInspect / NODE_OPTIONS off, OnlyLoadAppFromAsar on) (A7-I1) + auto-update channel pin / gated download (A1-I1).
6. Nav-guard completeness: `will-frame-navigate`, `will-attach-webview`, deny-all `setPermissionRequestHandler` (A1-I3).
7. DOMPurify pass over mermaid SVG (A5-I3) + `FORBID_ATTR: ['id','name']` in markdown sanitize (A5-I4).
8. Sanitize paste (`\x1b`/`\r` runs) before `term.paste` (A6-I1).
9. Reset-time pipeline: anchor to "resets", 24 h + date handling, iterate candidates, fire-time re-check / drop-on-user-input (A4-I3/I4/I5).
10. Settings versioning + migration (A2-I3).

### Important — UX/correctness
11. Suppress global shortcuts while a dialog is open; make dialogs idempotent; fix the mount-click and promise leaks (A5-I1/I2).
12. Correct all shortcut labels through `formatAccelerator` and delete the duplicate formatters — one cluster: context menu (A6-I2), tab strip/empty state (A5-I6), `renderer/terminal/platform.ts` (A6-M1/M2), three-way UA sniffing (A5-M9).
13. Guard `splitFocused` against the source pane leaving the tree during the await (A6-I3).
14. Tick only time labels instead of full rebuild (A5-I5); attention-detector ANSI stripping + OSC-BEL tracking (A4-I1/I2).
15. Exclusion assertions + scoped-bridge tests for preload allowlists (A2-I2); attach smoke-test error listeners to `firstWindow()` directly (A7-I2).
16. Track mac signing/notarization as a release blocker for the dmg channel (A7-I3).

### Cleanup backlog
Minor items listed in Part 2 (all file:line-verified except those under UNVERIFIED), plus New-1/New-2/New-3, dead `SessionCreateDefault`, and `splits.spec.ts`'s blind wait.

---

*Method note: verification performed by reading every cited file at HEAD; no findings were accepted on the prior documents' authority. Items not re-checked are explicitly labeled UNVERIFIED.*
