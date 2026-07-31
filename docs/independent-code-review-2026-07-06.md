# Independent Code Review — 2026-07-06

Full-codebase review of Awakon (Electron terminal app for coding CLIs), conducted independently
of any prior review documents. Reviewed at commit `de4cd5e` on branch `feat/fable-review`.

Method: one reviewer agent per area, run sequentially. Findings are appended to this document
as each area completes, so the review is resumable if interrupted.

## Progress

- [x] Area 1: Main process (`apps/desktop/src/main`) — security, window/IPC wiring, updater entry points
- [x] Area 2: Preload scripts + IPC contracts (`apps/desktop/src/preload`, `packages/contracts`)
- [x] Area 3: Core session/state management (`packages/core`: session-manager, session-store, session, settings-store, ipc-router, ring-buffer)
- [x] Area 4: Attention/rate-limit/auto-resume subsystem (`packages/core`: attention-detector, rate-limit-detector, reset-time-parser, resume-scheduler, notification-service)
- [x] Area 5: Renderer chrome UI (`apps/desktop/src/renderer/chrome`)
- [x] Area 6: Renderer terminal + terminal-host + keymap (`apps/desktop/src/renderer/terminal`, `packages/terminal-host`, `packages/keymap`)
- [x] Area 7: Build/packaging/scripts/dependencies + test-suite quality (`electron-builder*.json`, `afterPack.cjs`, `scripts/`, `tests/`)

## Findings

### Area 1: Main process

#### Strengths
- Correct core webPreferences everywhere: `sandbox: true, contextIsolation: true` on the chrome BrowserWindow (index.ts:575-579) and every terminal WebContentsView (view-manager.ts:77-83).
- App-wide navigation/window-open guard installed before any window exists: `setWindowOpenHandler(() => deny)` + `will-navigate` on every `web-contents-created` (index.ts:54-61). Guard handles the `file:` null-origin trap and Windows cross-drive `path.relative` (navigation-guard.ts:16-52).
- `shell.openExternal` schema-gated to http(s) (contracts/ipc.ts:203-209, index.ts:243-248).
- Every renderer payload Zod-validated; `FsReadFile` enforces `.md`-only + tab-cwd containment + 1 MB cap (fs-handlers.ts:65-90).
- Two preloads with per-renderer channel allowlists + CSP `default-src 'self'` on both pages.
- IPC logger redacts terminal keystrokes (ipc-logger.ts:186-194); tests exercise real filesystems/rotation.

#### Critical (Must Fix)
- **C1 — Privileged main handlers do not validate IPC sender; `SettingsUpdate` → shell command injection** — index.ts:258-266 (also 198, 211, 243, 273, 287) and fs-handlers.ts:39-90. The codebase's own threat model treats a compromised terminal renderer as in scope (`IpcRouter.isAuthorizedSender`, core/ipc-router.ts:190-196), but none of the handlers in index.ts/fs-handlers.ts check `event.sender`. A compromised renderer can `ipcRenderer.invoke('SettingsUpdate', …)` to set `autoResume.resumeText`, which SessionManager writes verbatim into a live PTY with `\r` (core/session-manager.ts:75,153) → arbitrary command execution. Fix: gate `SettingsUpdate`, `FsReadFile`, `RecentAdd`, `Chrome*` handlers on the chrome WebContents, reusing the existing IpcRouter authorization pattern.

#### Important (Should Fix)
- **I1 — Auto-update: no channel/downgrade pinning, no Linux signature guarantee** — auto-update.ts:17-25, electron-builder.json:35-41. `autoDownload=true` + `autoInstallOnAppQuit=true` against GitHub provider with no channel pin; AppImage path has no OS signature check. Repo/release compromise = silent code execution. Pin channel, document per-target signing, consider gating auto-download.
- **I2 — `before-quit` can leave app un-quittable if `closeAll()` rejects** — index.ts:710-717. `preventDefault()` then `await sessionManager.closeAll()`; if it throws, `app.exit(0)` never runs. Wrap in try/finally so `ipcLogger?.close()` + `app.exit(0)` always run.
- **I3 — Navigation guard omits `will-frame-navigate`, `will-attach-webview`, permission handler** — index.ts:54-61. Subframe navigations don't fire `will-navigate`; no `setPermissionRequestHandler` deny-all. Defense-in-depth gaps for an app rendering untrusted terminal output.
- **I4 — IPC-logger `send`-wrapping never unwraps per WebContents** — ipc-logger.ts:266-279. Low severity (opt-in gate), noted for completeness.

#### Minor (Nice to Have)
- **M1** — `ChromeAppInfo` unauthenticated (index.ts:224-237); fold into C1 pass.
- **M2** — `iconPath()` relative-path fragility (index.ts:129-135).
- **M3** — `recreateSessionView`/`createSessionView` duplicate load/query/show block (index.ts:146-164 vs 654-676).
- **M4** — No `.catch` on `app.whenReady().then(createChromeWindow)` (index.ts:694-696).
- **M5** — `ChromeAppMenuPopup` rebuilds menu each popup (index.ts:198-208); fine.

#### Assessment
Good shape with deliberate security engineering (correct webPreferences, app-wide nav guard, http(s)-only openExternal, preload allowlists, CSP, real path-containment, behavior-real tests). The one serious gap is architectural inconsistency: IpcRouter rigorously authorizes senders for session ops, but the handlers in index.ts/fs-handlers.ts — including `SettingsUpdate`, which feeds strings into a live PTY — do no sender check, so a compromised renderer can execute arbitrary commands. Fix C1 + I2/I1 for production-ready posture.

### Area 2: Preload + contracts

#### Strengths
- Minimal non-leaky bridge: `shared.ts:22-40` exposes only `send`/`on`; `ipcRenderer` never exposed; listener wrapper discards raw `IpcRendererEvent` (no `sender` leak).
- Real per-renderer allowlists, correctly asymmetric: terminal (terminal.ts:8-26) strictly narrower than chrome (chrome.ts:5-49); Set-checked, no wildcard.
- Defense in depth: preload allowlist is not the only boundary — IpcRouter pins session channels to owning WebContents + zod-validates (core/ipc-router.ts:193-196).
- Persistence versioning migrates v1→v4, corruption-tolerant (persistence.ts:77-93).
- Drift-guard test greps renderer sources for channel usage (channels.test.ts:22-44).

#### Critical (Must Fix)
None survived verification.

#### Important (Should Fix)
- **I1 — `env` in `SessionCreateOptionsSchema` is an unused env-injection surface** — session.ts:26, merged over process env at core/session.ts:73. No renderer sends it; a compromised chrome renderer could set PATH/LD_PRELOAD-class vars for spawned shells. Remove `env` from the IPC schema (keep main-only), or allowlist keys.
- **I2 — Allowlist test asserts sufficiency, never the boundary** — channels.test.ts:46-76. A regression adding `FsReadFile`/`SettingsUpdate`/`SessionCreate` to terminal's SEND_CHANNELS still passes. `exposeScopedBridge` reject/no-op/unsubscribe behavior is untested. Add expected-set/exclusion assertions + scoped-bridge unit tests.
- **I3 — Settings have no version/migration; schema break silently wipes all settings** — settings.ts:30-33 (no version, unlike persistence.ts); settings-store.ts:44-47 falls back to DEFAULT_APP_SETTINGS wholesale. Add version + migrateAppSettings, or per-field salvage.
- **I4 — Bridge is stringly-typed, defeating contracts at compile time** — shared.ts:7 / terminal-host.ts:18-21 (`send(channel: string, payload?: unknown)`). Every call site casts (`as Promise<AppSettings>` etc.); responses never validated. Add a channel→{request,response} type map generic over `Bridge.send`.

#### Minor (Nice to Have)
- **M1** — Dead channel `SessionCreateDefault` (ipc.ts:20; handler index.ts:316, not in any allowlist).
- **M2** — Dead exports: `NotificationRequestSchema` (notification.ts:4-9), `TabIdSchema` (session.ts:61-62); duplicate re-exports (ipc.ts:345).
- **M3** — `LayoutShow` violates the `core.*`=renderer→main / `event.*`=main→renderer convention (chrome both sends and listens on `core.layout.show`).
- **M4** — Asymmetric bridge failure: disallowed `send` rejects, disallowed `on` only warns + no-op unsubscribe (silent dead listener).
- **M5** — Base64 fields unvalidated (`SessionWritePayloadSchema.data` ipc.ts:76); use `z.string().base64()`.
- **M6** — `readSources` non-recursive (channels.test.ts:22-27); first subdir added escapes the drift scan.
- **M7** — Double-cast in defaults (settings.ts:54).

Cross-area note: IpcRouter broadcasts `SessionExited`/`TitleChanged`/`Attention` to every subscribed WebContents (ipc-router.ts:395-405), so terminal views receive other tabs' session metadata; the listen allowlist can't filter payloads.

#### Assessment
Well-above-average preload/IPC layer: minimal two-function bridge, distinct per-renderer allowlists with the untrusted terminal correctly narrower, no event-object leak, main-side sender auth + zod so preload isn't the sole boundary. Nothing critical. Work items are hardening: the `env` passthrough (I1), a boundary test that would actually fail on terminal-allowlist regression (I2), settings versioning before the next schema change forces a silent reset (I3), and a typed bridge (I4).

### Area 3: Core session & state

#### Strengths
- Shell command is an enum whitelist mapped to fixed executables with no args (session.ts:25-35,68-74) — no injection surface.
- Every IPC handler zod-validates first and returns `{ error }` instead of throwing; deny-by-default `isAuthorizedSender` (ipc-router.ts:193-196).
- Close escalation correct: SIGHUP → SIGKILL after 1.5s, timer cleared on exit; Windows `pty.kill()` path; `before-quit` awaits `closeAll()`.
- RingBuffer bounded, byte-exact wrap arithmetic verified; tests cover boundary + mid-UTF-8 splits.
- Persistence atomic (temp+rename), serialized, backs up corrupt files, real v1→v4 migration with tests.
- Session data routed to owning WebContents only (not broadcast); `destroyed`-hook cleanup of subscribers + sessionViews.

#### Critical (Must Fix)
- **C1 — Sender authorization incomplete; several channels skip `isAuthorizedSender`** — ipc-router.ts:199 (`SessionCreate`, spreads attacker `env` over process.env at session.ts:73), :267-281 (`SessionRestartView`/`SessionSetTitle` mutate any session by id), :361-375 (`LayoutPersistDocs`/`LayoutDocsForTab` read/overwrite any tab's docs — inconsistent with `LayoutPersistSplits` which guards at :340). The router advertises itself as the M2/R6 confinement boundary but leaves confinement resting solely on the two preload allowlists with no defense in depth. Apply `isAuthorizedSender` / chrome-only guard to every sensitive channel. (Currently mitigated by preload split, so "must fix for the stated model" rather than live exploit.)

#### Important (Should Fix)
- **I1 — `applyAutoResumeConfig` re-arms rate-limit detection mid-stream** — session-manager.ts:128-139 → rate-limit-detector.ts:45-49. Toggling auto-resume / editing detectText while a prompt is on screen sets `present=false`, so the next chunk re-detects and can re-fire past the 5-min cooldown. Guard the toggle-during-prompt case.
- **I2 — Public `SessionManager.write` drops the `synthetic` opt** — session-manager.ts:97-99. Not renderer-reachable for foreign sessions (IPC path is authorized), but any internal caller bypasses the attention-gate flag session.ts depends on.
- **I3 — Exited sessions never evicted from the map** — session-manager.ts:49-56. Self-exiting shells leave the Session + RingBuffer (≤256 KB) + detectors alive until the tab is closed; unbounded accumulation across many transient tabs. Evict after a grace period or cap retained exited sessions.

#### Minor (Nice to Have)
- **M1** — Temp-file names use `Date.now()`+`Math.random()` (session-store.ts:70, settings-store.ts:64); prefer `randomUUID`/`mkstemp`.
- **M2** — `writeAtomic` doesn't `fsync` before rename; hard power loss can yield zero-length json (backup path recovers).
- **M3** — `close()`/`closeAll()` duplicate the kill dance (session-manager.ts:105-124 vs 157-179); extract shared helper.
- **M4** — `list()` returns exited sessions + panes; grows with I3.
- **M5** — Rate-limit markers tuned to observed Claude Code output; brittle to CLI UI changes.

#### Assessment
Core is well-engineered — PTY lifecycle, kill escalation, atomic persistence, migration, ring buffer all correct and meaningfully tested against real PTYs. The one genuine must-fix is incomplete IPC sender authorization (C1): the router claims to be the confinement boundary but several sensitive channels (env-carrying `SessionCreate`, title/restart, doc-persistence pair) skip the check, so confinement rests only on preload allowlists. Rest is hardening/cleanup.

### Area 4: Attention / rate-limit / auto-resume

#### Strengths
- Sweep-based scheduler (20s `setInterval` against epoch-ms deadlines, resume-scheduler.ts:11-67): sidesteps 32-bit setTimeout overflow, survives OS sleep, immune to clock jumps; delete-before-fire makes double-fire impossible; timers `unref()`d.
- Layered answer-storm defense: edge-triggered detection + pending-resume guard + 5-min cooldown, all tested.
- Chunk-boundary correctness in RateLimitDetector: `StringDecoder` keeps UTF-8 intact, ANSI stripped over whole sliding window.
- Sensible risk posture: off by default; synthetic writes don't unlock attention gate; resumes cancel on exit/disable; parse failure degrades to stage-1-only.
- `parseResetTime` zone-aware, rolls to tomorrow when past, returns null on garbage; tests cover DST/day-rollover/unknown-zone.

#### Critical (Must Fix)
- **C1 — Menu-chrome anchor defeated by `❯`; quoted text can type into a live shell** — rate-limit-detector.ts:21,73. The only guard between "phrase seen" and typing `1\r` into the PTY is that `❯` or `Enter to confirm` appears within ~800 chars. But `❯` is the prompt glyph of the hosted CLIs and popular shell prompts (starship/pure/p10k). So asking Claude Code to read this repo's `settings.ts`, or viewing any doc quoting the phrase, puts it near an on-screen `❯` → app submits "1" into the live session. Require a structural menu signature (option-line `/❯?\s*1\.\s*Stop and wait/` at line start AND `Enter to confirm` after), not a single glyph. Land before encouraging users to enable auto-resume.

#### Important (Should Fix)
- **I1 — Idle-prompt heuristic runs on raw un-stripped bytes** — attention-detector.ts:10,77,98. `/[\$#%>:]\s*$/` tested against raw chunk incl. escape sequences; modern prompts emit trailing `\x1b[?2004h`/`\x1b[0m` so idle never fires for colored prompts, and lines ending in `:`/`>` fire spuriously. Notification-level only. Strip ANSI before matching; tighten pattern.
- **I2 — BEL terminators of foreign OSC counted as bells** — attention-detector.ts:43-73. Window-title OSC `\x1b]0;title\x07` on every prompt redraw raises a spurious bell/attention. Track "inside any OSC/DCS" generically.
- **I3 — `parseResetTime` can't handle date-bearing or 24h messages, gives up on first malformed candidate** — reset-time-parser.ts:4,19-27. 24h "resets 21:30" → null (silent); date-bearing message (UNCONFIRMED exact wording) mis-scheduled days early; first regex match wins even if invalid. Iterate matches; refuse to schedule on date token.
- **I4 — Reset time parsed from 600 chars of arbitrary leading context; first clock-time wins** — rate-limit-detector.ts:11,67-70. An unrelated earlier time ("meet at 3pm") beats the real "resets 9:10pm". Anchor parsing to the word "resets".
- **I5 — Scheduled resume fires blind; no re-check that session is still rate-limited** — resume-scheduler.ts:59-67, session-manager.ts:150-155. If user resumed manually or is mid-typing, injects `continue\r` submitting partial input. Add a fire-time veto / drop pending resume on non-synthetic user input.
- **I6 — Electron Notification immediately unreferenced; click callback can be GC'd** — notification-service.ts:52-54. Well-known Electron caveat (UNCONFIRMED at runtime). Retain instance until close/click.

#### Minor (Nice to Have)
- **M1** — Exact-substring match defeated by line wrapping in narrow/split panes (rate-limit-detector.ts:61); use whitespace-tolerant regex.
- **M2** — `setDetectText` re-arms but never rescans existing window (rate-limit-detector.ts:45-54).
- **M3** — Attention detector decodes OSC payload lossily (Latin-1 `fromCharCode`, per-chunk `toString`).
- **M4** — `ANSI_RE` leaves DCS/APC/PM payloads in the match window.
- **M5** — `notify()` records coalescing timestamp before `show()`; no `isSupported()`/try-catch.
- **M6** — `process()` after `dispose()` re-arms idle timer (latent).
- **M7** — Test gaps: colored/bracketed-paste prompt, quoted phrase with `❯` elsewhere, 24h/date/multi-candidate reset, wrapped phrase — all dangerous cases currently untested.

#### Assessment
Scheduling half is genuinely well engineered (sweep scheduler, edge-triggered detection, three re-fire layers, sleep/clock-drift aware). Detection half is weaker: the single-glyph `❯` anchor is inadequate for an action that types into a live shell (C1), the idle heuristic ignores ANSI and misses the prompts it targets (I1), and the reset-time pipeline can schedule from the wrong time (I3/I4). Fixes are localized, but C1 should land before promoting auto-resume.

### Area 5: Renderer chrome UI

#### Strengths
- Markdown XSS boundary sound: markdown-it output through `DOMPurify.sanitize` (markdown.ts:26-29), tested for `<script>`/`onerror=` stripping; strict CSP as second layer.
- Untrusted strings consistently rendered via `textContent` (tab titles, sidebar cwd, palette rows, doc paths, breadcrumb, recents) — no innerHTML injection of user data found.
- Link handling careful: anchors `preventDefault`d, only `isHttpUrl` links → `shell.openExternal`, sharing main's predicate; tested both ways.
- Async body-load race handled with monotonic `loadToken` + `isConnected` checks (doc-reader.ts:159-178).

#### Critical (Must Fix)
- **C1 — Closing a tab never closes its doc reader; stale reader + stuck `LayoutModal`** — layout-manager.ts:319-343. `closeTab()` never calls `syncReader()`, so Ctrl+W on a tab with the reader open leaves the dead tab's reader rendered, terminal view suspended, and a later Escape mutates/persists the *new* focused tab's doc state. Call `syncReader()` after focus reassignment (and in `LayoutTabReparented`).
- **C2 — `LayoutModal` is a boolean not a refcount; stacked overlays desync it** — layout-manager.ts:224-250,478-488. Opening Settings over the reader sends `{open:false}` while the reader is still on-screen, so the terminal WebContentsView un-suspends and covers open UI. Refcount modal opens (single `modalDepth` gate) or re-derive state after each overlay closes.

#### Important (Should Fix)
- **I1 — Global shortcuts stay live behind modals; Ctrl+T in New Session dialog destroys it + leaks its promise** — keyboard.ts:63-72 + new-session-dialog.ts:33-34. Second dialog does `mount.innerHTML=''` wiping dialog #1 without cleanup; its promise never resolves, keydown listener leaks. Suppress `wireKeyboard` while `#dialog-mount` is open and/or make `show*Dialog` idempotent.
- **I2 — Every dialog open leaks a backdrop-click listener on the persistent `#dialog-mount`** — new-session-dialog.ts:184-186,394-396, settings-dialog.ts:206-208. `cleanup` removes keydown but not the mount click listener. Copy about-dialog.ts's correct pattern.
- **I3 — Mermaid SVG injected via `innerHTML` with no DOMPurify pass** — mermaid.ts:37-41. `securityLevel:'strict'` delegates entirely to mermaid (history of bypass CVEs); source is attacker-controlled repo markdown. Add a DOMPurify svg-profile pass. (CSP blocks inline script → Important not Critical.)
- **I4 — Sanitized markdown can DOM-clobber `#dialog-mount`** — markdown.ts:28 + index.html:45/48. DOMPurify keeps `id`; `<div id="dialog-mount">` in markdown makes `getElementById('dialog-mount')` return the attacker element, so dialogs render inside attacker markdown (spoofing). Add `FORBID_ATTR:['id','name']` or hold direct mount references.
- **I5 — 1s tick fully rebuilds tab strip/sidebar/empty state, breaking drag/hover/flyouts** — layout-manager.ts:205, tab-strip.ts:30. Tab drag cancelled within a second; hover states reset. Tick only time-labels in place or diff-render.
- **I6 — Hardcoded shortcut labels bypass `formatAccelerator` (known per-OS rule)** — tab-strip.ts:79,106, empty-state.ts:9-11,111 (`platformMod()` UA sniff returning `⌘`). Wrong on macOS today. Pass pre-formatted labels from `formatAccelerator(Bindings.*, platform)`; delete `platformMod`.

#### Minor (Nice to Have)
- **M1** — `eventMatches` conflates Cmd/Ctrl on macOS; dead `ev.code` branch (keyboard.ts:24,28).
- **M2** — Settings Save can clobber concurrently-updated `recentTabs` (settings-dialog.ts:192); main should own the merge.
- **M3** — Persisted doc state trusted without validation/clamping (layout-manager.ts:549, doc-state.ts:68-77).
- **M4** — Type/logic warts: `focusedId ?? ''` as SessionId; restart-then-recent; dead `__awakonLayout`; 0 bytes → "1 KB".
- **M5** — Tab reorder "drop at end" unreachable (tab-strip.ts:92-98).
- **M6** — No focus trap / focus restoration in any overlay.
- **M7** — Sidebar context-menu leaves stale document listeners when replaced.
- **M8** — Test gaps at risky seams: no sidebar.ts / keyboard.ts tests; mermaid-SVG sanitization boundary never exercised (render mocked); no `javascript:` href test.
- **M9** — Platform detected three separate ways via UA sniff; thread `platform` from `LayoutDeps`.

#### Assessment
Security posture better than typical for a hand-rolled DOM UI: untrusted text uses `textContent`, markdown goes through DOMPurify with tests, links are scheme-filtered, CSP is strict. Residual XSS-adjacent risks are second-order (unsanitized mermaid SVG, id-based clobbering) and cheap to close. Real weaknesses are lifecycle/state discipline: `LayoutModal` and reader visibility desync on ordinary flows, global shortcuts run behind modals and can destroy an open dialog while leaking its promise/listeners, and the 1 Hz full rebuild breaks drag/hover. Tests cluster on happy paths of the simplest components while the exact failure modes above are untested.

### Area 6: Terminal renderer + host + keymap

#### Strengths
- Untrusted web-link path locked down: `WebLinksAddon` handler gates on `isHttpUrl` before `ChromeOpenExternal`, main re-validates + `setWindowOpenHandler` deny closes the OSC-8 path (terminal-host.ts:98-102).
- `.md` link → DocOpen safe against traversal: path resolved against tab cwd + `isPathInside` in main, re-checked at the read boundary.
- TerminalHost disposal thorough: unsubscribes IPC, disconnects ResizeObserver, `term.dispose()`; divider drag listeners attached to document only during drag.
- Replay ordering race-safe: live chunks buffered in `pendingChunks` and drained after snapshot.

#### Critical (Must Fix)
None. The two highest-risk paths (untrusted output → clickable link, pane disposal) are handled correctly.

#### Important (Should Fix)
- **I1 — Paste is bracketed but not sanitized; embedded `\x1b[201~` breaks out of bracketed paste** — split-container.ts:230-233, terminal-host.ts:131-133. xterm 5.5.0 doesn't strip an embedded `\x1b[201~`, so clipboard content `...\x1b[201~<cmd>\r...` closes bracketed paste early and executes without Enter. Requires attacker-controlled clipboard → hardening, not live RCE. Strip `\x1b`/`\r` runs before `term.paste`.
- **I2 — Context-menu shortcut labels contradict the real keybindings** — context-menu.ts:37-45. Advertises `Mod+C/V/A/D`, `Mod+W` etc. but keymap defines `splitHorizontal=CmdOrCtrl+\`, `closePane=CmdOrCtrl+Shift+W`, and Copy/Paste/Select-all aren't wired in the terminal renderer at all (Mod+C sends SIGINT). Derive labels from `Bindings.*.accelerator` via `formatAccelerator`; drop hints for unwired actions.
- **I3 — Split creation can corrupt the tree if source pane closes during async pane-create** — split-container.ts:67-121. If `oldFocused` is closed during the `await`, `replaceChild` no-ops, `replaceInTree` returns null, and `this.root = ... ?? branch` sets root to an orphan branch not in the DOM → frozen terminal + leaked PTY. Guard after await: tear down the new session and abort if `oldFocused` left the tree. Low likelihood, total corruption.

#### Minor (Nice to Have)
- **M1** — Duplicate divergent shortcut formatters; `platform.ts` hardcodes `⌘` (platform.ts:17,23-36 vs keymap `formatAccelerator`). Collapse onto keymap formatter.
- **M2** — `matchShortcut`/`MOD` dead in production (platform.ts:14-17,42-62); only used by tests.
- **M3** — Unhandled promise rejections on clipboard access (split-container.ts:227-232).
- **M4** — `detectPlatform` relies on deprecated `navigator.platform`.
- **M5** — Test gaps: md-links traversal/absolute-path cases; disposal assertion on `closeFocusedPane`; no OSC-8/paste-injection regression test.
- **M6** — `restore()` casts `this.root as LeafNode` unconditionally (split-container.ts:298).
- **M7** — Divider drag doesn't `preventDefault` (text-selects terminal content).

#### Assessment
Security-critical surfaces handled well: both link paths validate scheme/containment on renderer + main, OSC-8 neutralized by window-open deny, terminal/PTY teardown complete with no observer/listener leaks. No Critical issues. Most worthwhile fixes: paste hardening (I1) and misleading context-menu labels (I2, also violates the per-OS accelerator rule); split-during-close race (I3) is real but low-likelihood, worth a cheap guard. Overall in good shape.

### Area 7: Build / packaging / scripts / tests

#### Strengths
- `afterPack.cjs` well-engineered: Linux `--no-sandbox` wrapper scoped to appImage/dir only, excludes deb, throws on combined invocation; backed by a real test exercising every branch.
- Dev-CSP relaxation applied only at `apply:'serve'`, never ships, throws if the CSP marker drifts (electron.vite.config.ts:12-28).
- Security defaults on (sandbox + contextIsolation, no webSecurity override); `pnpm-lock.yaml` present + `--frozen-lockfile`; no secrets committed (test cert is gitignored, generated at runtime).
- e2e specs assert real behavior (session counts via IPC, BEL badging, settings persistence across restart) with isolated per-test user-data-dir.

#### Critical (Must Fix)
None. Signing/supply-chain and CSP posture are deliberate and defensible; no committed secrets, no `curl|bash` to root in the primary build path, strict CSP.

#### Important (Should Fix)
- **I1 — Electron fuses never applied** — afterPack.cjs (no `@electron/fuses` anywhere). Packaged app ships with `RunAsNode`/`EnableNodeCliInspectArguments`/`EnableNodeOptionsEnvironmentVariable` enabled; an attacker setting `ELECTRON_RUN_AS_NODE` relaunches the signed binary as plain Node, bypassing sandbox/contextIsolation. Add a fuse-flip step disabling those + enabling `OnlyLoadAppFromAsar`.
- **I2 — Smoke test can miss early renderer errors** — smoke.spec.ts:7-17. `pageerror`/`console.error` listeners attached inside the `window` handler registered after `electron.launch()`, so errors during initial load are never collected and `expect(errors).toEqual([])` passes vacuously. Attach to the page from `firstWindow()` directly.
- **I3 — mac signing/notarization fully disabled** — electron-builder.json:27 (`identity:null`, no afterSign). `.dmg` is Gatekeeper-blocked; track as a release blocker for the mac direct-download channel (Store/Windows unaffected).

#### Minor (Nice to Have)
- **M1** — `splits.spec.ts:23-33` uses a blind `waitForTimeout(2500)` + single `triggerSplit()`; reuse the `expect(...).toPass()` retry from split-close.spec.ts.
- **M2** — appx config ships `PLACEHOLDER-` identityName/publisher (electron-builder.appx.json:7-8); `dist:win:store` yields an unsubmittable package until edited.
- **M3** — `setup-linux.sh:50` pipes NodeSource script to root shell (documented method, classic curl-pipe-to-root).
- **M4** — pnpm version drift: `setup-linux.sh:60` uses `pnpm@latest`, repo pins `pnpm@9.12.0`.
- **M5** — eslint ^8.57.1 is EOL (dev-only); schedule v9 flat-config upgrade. Rest of deps current (electron ^43, electron-updater ^6.8.9, vite ^5, vitest ^2, dompurify ^3.4.9, playwright ^1.60).

#### Assessment
Strong shape. Packaging minimal and correct (asar on, node-pty unpacked, GitHub publish provider matches electron-updater, security defaults on), build scripts careful (repo-root anchored, frozen lockfile, non-zero-exit guards), no secrets, strict CSP (single `style-src 'unsafe-inline'` documented as mermaid requirement). `afterPack.cjs` + its test and the fail-loud dev-CSP plugin show real judgment. Most valuable next steps: apply Electron fuses (I1), tighten smoke error capture (I2); mac-signing gap (I3) is a distribution constraint to track.

---
