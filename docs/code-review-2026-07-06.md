# Awakon Full Code Review — 2026-07-06

Whole-app review (branch `feat/fable-review`, HEAD `de4cd5e`), run as sequential
reviewer agents — one area at a time. If interrupted (e.g. rate limit), resume
at the first area whose status is not `done`.

## Progress

| # | Area | Files | Status |
|---|------|-------|--------|
| 1 | Main process | `apps/desktop/src/main/**` | done |
| 2 | Preload + IPC contracts | `apps/desktop/src/preload/**`, `packages/contracts/src/**` | done |
| 3 | Core package | `packages/core/src/**` (+ tests sanity) | done |
| 4 | Renderer chrome | `apps/desktop/src/renderer/chrome/**` | done |
| 5 | Renderer terminal + terminal-host + keymap | `apps/desktop/src/renderer/terminal/**`, `packages/terminal-host/src/**`, `packages/keymap/src/**` | done |
| 6 | Build, packaging & scripts | `electron.vite.config.ts`, electron-builder configs, `afterPack`, `scripts/**`, root/package manifests | done |

## Findings

### Area 1: Main process (`apps/desktop/src/main/**`)

**Assessment:** Well-above-average Electron main process — sandboxing, navigation guards, schema-validated IPC, and Store-aware update gating are all correct. Two structural weaknesses: missing sender validation on index.ts-registered handlers, and the untested 726-line index.ts holding the most fragile session-lifecycle logic.

**Strengths:** `sandbox: true` + `contextIsolation` everywhere (index.ts:575-579, view-manager.ts:78-82); global deny window-open + will-navigate guards with the `file:`-origin and Windows cross-drive traps handled and tested (index.ts:54-61, navigation-guard.ts:28-52); `shell.openExternal` schema-gated to http(s); layered path containment for doc reads with real-filesystem tests; keystroke redaction in IPC logs; `process.windowsStore` correctly gates auto-update and AUMID.

**Critical:** none.

**Important:**
1. **No `event.sender` validation** on handlers in index.ts (198, 211, 243, 258, 273, 287, 316) and fs-handlers.ts (39, 52, 65) — inconsistent with core `IpcRouter.isAuthorizedSender` (ipc-router.ts:193-195). Concrete escalation: a compromised terminal view (renders untrusted output) can send `SettingsUpdate` to rewrite `autoResume.responseText`, which auto-resume later **types into a live shell**; `FsReadFile` accepts any `tabId`, allowing cross-tab `.md` reads. Fix: require chrome-window sender for settings/recent/window-control/fs channels; sender-owns-tabId for session-scoped ones.
2. **`setupAutoUpdate` re-runs on every macOS dock-reopen** (called from `createChromeWindow`, index.ts:647; `activate` re-invokes at 705-708) — accumulates `autoUpdater` listeners. Add a once-guard or move to `app.whenReady()`.
3. **No `session.setPermissionRequestHandler`** — Electron default grants permission requests. Add deny-all next to the global guards (index.ts:54-61).
4. **`before-quit` can brick quit** (index.ts:710-717): `preventDefault()` then `await closeAll()`; a rejection/hang means `app.exit(0)` never runs. Wrap in try/finally + timeout.
5. **Symlink escape in `FsReadFile` containment**: `isPathInside` is lexical; no `fs.realpath` (fs-handlers.ts:77). A hostile repo with a symlinked `.md` reads outside the tab cwd. Fix: realpath both sides before the check.
6. **Tab/pane lifecycle in index.ts has zero tests** (closeTab/reparentTab/handleSessionClosePane/paneOwnership, index.ts:78-106, 344-406) — the hardest invariants in the file; extract to a testable module.

**Minor:** dead no-op cleanup branch in `sessionExited` (index.ts:337-339); auto-update doc comment promises a prompt that doesn't exist + no periodic re-check (auto-update.ts:4-25); PTY **output** logged unredacted when IPC logging enabled (only SessionWrite input is redacted, ipc-logger.ts:186-194); synchronous `writeSync` per IPC message can jank the main thread (ipc-logger.ts:117); `second-instance` no-ops when window closed on macOS (index.ts:698-703); hardcoded TITLEBAR_PX/TAB_BAR_PX coupled to CSS by hand (view-manager.ts:8-12); empty-string snippet defeats notification fallback (`''` isn't nullish, notification-bridge.ts:48); view-manager tests cover only crash rekeying; notification-bridge and app-menu untested.


### Area 2: Preload + IPC contracts (`apps/desktop/src/preload/**`, `packages/contracts/src/**`)

**Assessment:** Strong shape — textbook-correct sandboxed contextBridge design, terminal surface meaningfully least-privileged, contracts a real single source of truth. Remaining work is margin hardening: payload caps, strict schemas, dead-surface pruning, allowlist tests that enforce (not just document) the security invariants.

**Strengths:** shared.ts exposes only `send`/`on`, never leaks `ipcRenderer` or Electron event objects, returns working unsubscribes (shared.ts:18-41); terminal allowlist strictly narrower than chrome (terminal.ts:8-18); single source of truth for channel names (ipc.ts:17-70) with Zod validation on every inbound handler; http(s)-only `ChromeOpenExternal`; versioned tab persistence with migration (persistence.ts:77-93); channels.test.ts greps real renderer sources for allowlist coverage.

**Critical:** none.

**Important:**
1. **`SessionWrite.data` unbounded, un-validated base64** (ipc.ts:74-77) on the least-trusted (terminal) surface — memory-spike DoS; `Buffer.from(..., 'base64')` silently accepts garbage (ipc-router.ts:236). Fix: length cap + base64 regex.
2. **No request schema uses `.strict()`** — unknown keys silently stripped, not rejected (ipc.ts:74, 88, 113, 155, 290 etc.). Add `.strict()` to all renderer→main request schemas.
3. **Dead `env` option** in `SessionCreateOptionsSchema` (session.ts:26) flows into PTY spawn but no renderer sends it — arbitrary env injection primitive (PATH etc.) left open. Remove or constrain.
4. **Terminal preload can invoke `ChromeOpenExternal`** (terminal.ts:15) with no gesture/rate constraint — silent repeated browser-opens from the untrusted surface. Broker through chrome or require recent user gesture.
5. **`LayoutShow` is both request and event** (chrome.ts:31+39; main sends it at index.ts:558, notification-bridge.ts:63), breaking the documented `core.*`/`event.*` convention (ipc.ts:14-15). Split into a distinct event channel.
6. **Bridge is stringly typed** — `send(channel: string, payload?: unknown)` (terminal-host.ts:18-21); Zod schemas give zero compile-time safety at renderer call sites; renderers never `safeParse` event payloads. Add a channel→{payload,response} map type.

**Minor:** settings store unversioned unlike tabs (settings.ts:30-33); channels.test.ts blind spots (non-recursive scan, literal-regex only, no negative assertion locking terminal out of chrome-only channels, `exposeScopedBridge` behavior untested); dead channel `SessionCreateDefault` (ipc.ts:20, handler unreachable at main/index.ts:316); `PreloadBridge` lives in terminal-host with stale comment — belongs in contracts; unbounded persisted strings (recent.ts:5-6, settings.ts:25); disallowed `on` only warns while disallowed `send` rejects (shared.ts:25-33); duplicated `declare global` in both preloads.

### Area 3: Core package (`packages/core/src/**`)

**Assessment:** Healthy, unusually well-commented core with strong designs in the hard places (sweep-based scheduler, atomic persistence, ring buffer) and a real, tested authorization model — but that model is enforced inconsistently on newer IPC channels, and the attention detector's OSC handling produces systematic false positives on Windows.

**Strengths:** sweep-based ResumeScheduler survives sleep/clock changes (resume-scheduler.ts:10-14, unref'd timers); RingBuffer wrap-around math correct with byte-exact contract; stores use temp-file+rename atomic writes, serialized write chains, Zod-on-load, corrupt-file quarantine; two-stage auto-resume has pending guard + 5-min cooldown + menu-chrome anchoring + synthetic-write flag; tests use real PTYs and correctly-ordered fake timers.

**Critical:**
1. **Foreign OSC terminators counted as bell attention** (attention-detector.ts:40-74): only the awakon-specific OSC prefix is tracked, so the `\x07` ending any other OSC — notably `\x1b]0;title\x07` emitted by shells/ConPTY on virtually every prompt — fires a confidence-1.0 `bell` attention → `awaiting-input` + notifications on every prompt redraw once the gate is unlocked. Systematically noisy on the primary (Windows) platform. Test at tests/attention-detector.test.ts:63-70 encodes the bug as expected. Fix: track "inside any OSC" state, swallow payload + BEL/ST terminator, emit attention only for the awakon selector.

**Important:**
1. **Sender authorization missing on several scoped channels** (ipc-router.ts): `SessionSetTitle` (274-281), `SessionRestartView` (267-272), `LayoutPersistDocs`/`LayoutDocsForTab` (361-375), and crucially `SessionCreate` (199-210) — no check at all, so the guarded `SessionCreateForPane` (R6) is moot: a compromised terminal renderer spawns a fresh PTY with arbitrary cwd and attacker-controlled `env`. Chrome-only layout channels callable by any renderer. Fix: opt-out guard helper + `sender === chromeWebContents` for chrome-only channels.
2. **Reset-time parser takes the FIRST time-like token in ~800 chars of context, not the one near "resets"** (reset-time-parser.ts:4,19; rate-limit-detector.ts:11,67-70) — a status-bar clock or log timestamp wins, so the stage-2 `continue\r` nudge fires at the wrong wall-clock time. Anchor to `/resets\s+…/i`.
3. **`SessionStore.load()` rethrows non-ENOENT read errors** (session-store.ts:29-32) — transient EACCES/EBUSY (Windows AV locks) kills tab restore via uncaught rejection in bootstrap; `SettingsStore.load()` already degrades gracefully — align them.
4. **`closeAll()` leaves manager silently broken + doesn't wait for SIGKILL** (session-manager.ts:157-179): later sessions schedule into a disposed scheduler (never fires, no error); SIGKILL path resolves immediately so `app.exit(0)` can orphan a wedged ConPTY tree.
5. **Cross-session output broadcast during bind race** (ipc-router.ts:383-393): unbound session data falls back to `broadcast()` to ALL renderers; the pane-creation path (main/index.ts:447-452) can skip bind entirely, leaving a pane's output broadcast permanently. Buffer instead of broadcasting.

**Minor:** `responseText` accepts control chars/embedded `\r` typed verbatim into shell (settings.ts:8-14 — strip C0 controls); just-passed reset time rolls +24h (reset-time-parser.ts:37 — add small tolerance); AttentionDetector splits multibyte chars across chunks (use StringDecoder like RateLimitDetector); no fsync before rename + stale `.tmp` cleanup (both stores); `shellCommand` hardcodes `.exe` on all platforms (session.ts:25-35); dead `'starting'` status (session.ts:54,75); rate-limit window capped on raw ANSI-laden text can evict "resets" header (rate-limit-detector.ts:54); `lastAnsweredAt` not cleared on disable→re-enable (session-manager.ts:128-139).

### Area 4: Renderer chrome (`apps/desktop/src/renderer/chrome/**`)

**Assessment:** Good health — the security-sensitive core (markdown/mermaid/link handling, CSP) is thoughtfully engineered with correct, layered defenses and no injection path found. Weaknesses are UI lifecycle discipline: uncoordinated modal ownership, leaked listeners, a 1 Hz full re-render, and shortcut-label rule violations.

**Strengths:** markdown-it → DOMPurify before any DOM injection (markdown.ts:26-29); mermaid fences HTML-escaped then rendered with `securityLevel: 'strict'` (mermaid.ts:15); current deps past known XSS advisories; doc-reader link interception shares main's `isHttpUrl` predicate; strict CSP (`script-src 'self'`, index.html:12); untrusted strings rendered via textContent everywhere; stale-load guards in doc-reader; real jsdom tests incl. sanitization assertions.

**Critical:** none.

**Important:**
1. **Global shortcuts live while modals open** (keyboard.ts:63-72; dialogs wipe shared `#dialog-mount` via `innerHTML = ''`): Ctrl+T during Settings destroys the settings DOM, orphans its promise + document keydown listener, unbalances `LayoutModal`; Ctrl+W during rename closes the tab being renamed. Gate `wireKeyboard` on a modal-open flag.
2. **`LayoutModal` is a shared boolean with five uncoordinated owners** (main.ts:88; layout-manager.ts:228, 243, 266, 366, 482-486) — a main-pushed `LayoutShow` while a dialog is open un-suspends the terminal view on top of the overlay. Single modal-owner/refcount in LayoutManager.
3. **Listener leak on shared dialog mount**: settings-dialog.ts:206-208, new-session-dialog.ts:184-186, 394-396 add `click` on every open, never removed; stale closures re-wipe the mount. about-dialog.ts:112/118 does it right — copy that.
4. **1 Hz full-DOM rebuild** (layout-manager.ts:205 ticks `render()` for age labels; tab-strip.ts:30, sidebar.ts:111+ rebuild from scratch) — kills hover/transitions, can yank elements mid-drag. Tick only the time-label text nodes.
5. **Hardcoded shortcut labels violate formatAccelerator rule**: empty-state.ts:9-11, 111 (hardcoded ⌘/Ctrl+/T); tab-strip.ts:79, 106 ('Ctrl+W'/'Ctrl+T') — wrong on macOS, drift with Bindings.
6. **Bridge rejections unhandled on mutation paths**: closeTab (layout-manager.ts:333), SessionCreate (277), SessionSetTitle (375), SessionRestartView (396), SettingsGet/Update (231, 237) — rejected promise = silent no-op UI.

**Minor:** keyboard.ts:24 conflates meta/ctrl so both Ctrl+K and ⌘K fire on macOS; platform detection re-derived in four places; path-input widget duplicated between settings-dialog and new-session-dialog; accessibility gaps (no tab roles, no focus trap, div-based menus); restartTab pollutes Recents via closeTab; mermaid orphaned error element on parse failure + no defense-in-depth SVG sanitize + hardcoded dark theme; toggleSidebar hardcodes 260/56px duplicating CSS; restoreDocs casts persisted data `as never`. Test gaps: keyboard.ts and sidebar.ts have zero tests; no regression test pinning `securityLevel: 'strict'` or javascript:-href stripping.

### Area 5: Renderer terminal + terminal-host + keymap

**Assessment:** Security posture for rendered untrusted output is genuinely strong (write-only xterm path, no innerHTML, main-side path/URL validation), but the input direction has a real hole (unsanitized paste) and the interactive layer carries correctness debts — wrong shortcut labels, a tree-corrupting split/close race, no output flow control.

**Strengths:** all output via `term.write()` (terminal-host.ts:150,157,179); context menu built with textContent only; CSP in terminal-host.html; WebLinksAddon rerouted through `isHttpUrl` → `ChromeOpenExternal`; md-link clicks validated in main against tab cwd; replay buffering thought through; tight terminal preload scoping; good split restore/persist tests.

**Critical:**
1. **Unsanitized paste — bracketed-paste escape = command injection** (split-container.ts:230-232 → terminal-host.ts:131-133): `host.paste(text)` forwards clipboard verbatim; xterm 5.5.0 only converts `\n`→`\r` and wraps in `\x1b[200~…\x1b[201~`, never strips ESC. Clipboard copied from a malicious page containing `\x1b[201~command\r` terminates the bracket and executes immediately. Fix must cover BOTH `host.paste` and xterm's native Ctrl+V DOM paste path — one shared sanitizer stripping ESC/C0 (keep \t \r \n).

**Important:**
1. **Context-menu shortcut labels contradict real bindings** (context-menu.ts:37-45 vs keymap index.ts:14,27-29): shows `Mod+W` for Close pane but Ctrl+W actually closes the whole TAB (app-menu.ts:29); Mod+C/V/A shown but not wired (Ctrl+C sends SIGINT). Derive labels from `Bindings.*.accelerator` via formatAccelerator.
2. **platform.ts duplicates keymap's formatter with divergent output** (platform.ts:17,23-36 vs keymap:40-66) — hardcoded ⌘, different modifier order (⌘⇧ vs Apple-convention ⇧⌘), both contradictions locked in by their own tests; `matchShortcut` unused in production. Violates the formatAccelerator project rule. Delete and use @awakon/keymap.
3. **Split-during-close race corrupts pane tree** (split-container.ts:67-113): `oldFocused` captured before await; if removed during await, `replaceInTree(...) ?? branch` replaces the whole root with a detached branch — phantom tree persisted, new PTY renders nowhere. Revalidate after await; make `?? branch` an error path.
4. **Focus desync on split/close** (split-container.ts:117,174-175): close focuses the pane div not the xterm textarea; split never focuses the new terminal so `this.focused` goes stale — later closePane closes the wrong pane. `newHost.focus()` after split; `host.focus()` after close.
5. **OSC 8 hyperlinks fall through to xterm default handler** (terminal-host.ts:59-92, no `linkHandler`): native `confirm()` dialog with attacker-controlled text, then a dead `window.open`. Set `linkHandler` to the same isHttpUrl → ChromeOpenExternal route.
6. **No output flow control/backpressure** (terminal-host.ts:173-181; ipc-router.ts:383-393): flooding output grows xterm write buffer + IPC queue unbounded; `pendingChunks` also unbounded. Use `term.write(chunk, cb)` acks + node-pty pause/resume.
7. **Replay/live duplication window** (terminal-host.ts:143-161,174-181): chunk emitted between listener registration and snapshot is delivered twice on view restart of a streaming session. Carry byte offsets in SessionData/SessionReplay.

**Minor:** unthrottled ResizeObserver fit + resize IPC per tick (terminal-host.ts:220-233); dead trailing-punctuation loop in md-links (md-links.ts:25-28); md-links case-sensitive — `.MD` never links on Windows (md-links.ts:12); link ranges misalign after wide/CJK chars + wrapped lines missed (terminal-host.ts:199-210); fire-and-forget bridge sends produce unhandled rejections (five sites); `restore()` casts root `as LeafNode` without kind check (split-container.ts:298); divider drag lacks preventDefault + pointer capture; unvalidated query-string casts in main.ts:11-16; misleading test name (context-menu.test.ts:231 asserts close only). TerminalHost itself has ZERO tests — highest-risk file in the area.

### Area 6: Build, packaging & scripts

**Assessment:** Healthy, unusually well-documented packaging setup — correct native-module handling, tested afterPack/CSP hooks, clean Store/non-Store split, no secrets or leaked dev artifacts. Gaps are hardening-shaped: missing Electron fuses, unauthenticated auto-update channel pending code signing, half-finished Electron upgrade in packages/core, avoidable asar bloat.

**Strengths:** afterPack.cjs platform-guarded with real filesystem tests; `asarUnpack` for node-pty correct (Node-API based, no ABI rebuild needed); zero sourcemaps leak, tight `files` allowlist; appx config cleanly extends base; auto-update runtime-gated by `process.windowsStore`; dev-CSP plugin serve-only and drift-fails loudly; shell scripts use `set -euo pipefail` / `Invoke-Native`; pnpm@9.12.0 pinned coherently with CI frozen-lockfile; Electron 43.0.0 confirmed resolved for apps/desktop.

**Critical:** none (appx identity placeholders already tracked as B1 in docs/microsoft-store-review-2026-07-05.md).

**Important:**
1. **No Electron fuses flipped anywhere** — packaged builds ship with RunAsNode, NodeCliInspect, NODE_OPTIONS enabled: `ELECTRON_RUN_AS_NODE=1 Awakon.exe` turns the signed binary into a general-purpose Node runtime, bypassing all sandbox work; asar integrity validation off (user-writable %LOCALAPPDATA% install). Add `@electron/fuses` flipFuses() in afterPack (electron-builder 25.1.8 lacks the declarative key; v26 has it). Matters doubly for Store certification.
2. **Electron 43 upgrade (S2) incomplete**: packages/core/package.json:25 still pins `^33.4.11` — lockfile resolves BOTH 33.4.11 (EOL, the CVEs that motivated the upgrade) and 43.0.0; core tests run 10 majors behind production; two Electron binaries downloaded per install. Bump/hoist.
3. **Renderer-only libs are production deps** (apps/desktop/package.json:29-36): @xterm/*, dompurify, markdown-it, mermaid are Vite-bundled yet also packed as node_modules into the asar — everything ships twice; mermaid drags katex/cytoscape/d3. Move to devDependencies (only node-pty + electron-updater are `external`).
4. **build-preload.mjs stale-build blind spot** (scripts/build-preload.mjs:21): mtime check ignores `@awakon/contracts` imports and the vite config — local release builds can ship a preload bundled against old contracts. Include contracts dist mtimes or skip only in dev.
5. **Auto-update without code signing = unauthenticated update channel**: release.yml publishes NSIS with `--publish always`, auto-update installs silently, no win signing config — anyone with GitHub release write pushes arbitrary code to all non-Store users. Resolve before promoting the GitHub channel (cert/Azure Trusted Signing, or autoDownload=false until then).

**Minor:** afterPack wrapper not idempotent (double-run self-exec loop, afterPack.cjs:42); build.ps1 skips install when node_modules/.pnpm exists (stale deps; build.sh always installs); sign-local.ps1 creates Exportable key installed to CurrentUser\Root for 5 years; setup-linux.sh pipes remote script to sudo bash + `pnpm@latest` ignores pin; Actions pinned by mutable tags not SHAs; release.yml publishes without running tests; Linux release/install mismatch (AppImage published, install-linux.sh wants .deb); eslint 8 EOL.

---

## Executive summary

Overall the codebase is in **very good health** for a pre-1.0 Electron app: sandbox/contextIsolation everywhere, schema-validated IPC with a real (tested) authorization model, textbook preload bridges, DOMPurify+strict-mermaid+CSP in the doc reader, atomic persistence, and a sleep-safe resume scheduler. No XSS or renderer→arbitrary-code escape was found. Comments and tests are unusually good

### Area 6: Build, packaging & scripts

**Assessment:** Healthy, unusually well-documented packaging setup — correct native-module handling, tested afterPack/CSP hooks, clean Store/non-Store split, no leaked dev artifacts. Gaps are hardening-shaped, not broken-shaped: missing Electron fuses, unauthenticated auto-update pending signing, half-finished Electron upgrade in core, avoidable asar bloat.

**Strengths:** afterPack.cjs platform-guarded + fails loudly on the deb+AppImage hazard + real filesystem tests; correct `asarUnpack` for node-pty (Node-API, so npmRebuild:false is safe); no source maps leak, tight `files` allowlist; clean appx-extends-base config with runtime `process.windowsStore` update gating; dev-CSP plugin serve-only with drift check; shell scripts use `set -euo pipefail` + Invoke-Native wrapper; coherent toolchain pinning (pnpm@9.12.0, --frozen-lockfile, Electron 43 resolved for desktop).

**Critical:** none. (appx identity/publisher placeholders are intentional scaffolding, tracked as B1 in the Store-readiness doc.)

**Important:**
1. **No Electron fuses flipped anywhere** — packaged builds ship with RunAsNode / EnableNodeCliInspectArguments / EnableNodeOptionsEnvironmentVariable ON, so `Awakon.exe --inspect` or `ELECTRON_RUN_AS_NODE=1` turns the signed binary into a general Node runtime, bypassing all contextIsolation/sandbox work; asar-integrity also off (NSIS installs to user-writable %LOCALAPPDATA%). Add `@electron/fuses` flipFuses() in afterPack. Highest security ROI in this area.
2. **Electron 43 upgrade (S2) incomplete**: packages/core/package.json:25 still pins `^33.4.11`; lockfile resolves BOTH 33 (EOL, the CVEs that motivated the upgrade) and 43 — core tests run 10 majors behind production, two Electron binaries downloaded. Bump core to ^43 or hoist to root.
3. **Renderer libs declared as production deps** (apps/desktop/package.json:29-36): @xterm/*, dompurify, markdown-it, mermaid are Vite-bundled into out/renderer AND packed into the asar as node_modules — everything ships twice (mermaid drags katex/cytoscape/d3). Only node-pty + electron-updater need to stay prod deps. Move the four to devDependencies.
4. **build-preload.mjs up-to-date check has stale-build blind spots** (scripts/build-preload.mjs:21): mtime check watches only the 3 preload .ts files, not `@awakon/contracts` they import — a local release build can ship a preload bundled against old contracts (silently missing renamed channel). Include contracts/dist mtimes or restrict skip to dev.
5. **Auto-update without code signing = unauthenticated update channel** (release.yml:26-28 `--publish always`; auto-update auto-downloads/installs; no Windows signing anywhere, mac `identity: null`) — electron-updater publisher verification is a no-op for unsigned exes, so anyone who can write a GitHub release pushes arbitrary code to every non-Store user on next launch. Acceptable at v0.9.0 pre-release; resolve (cert / Azure Trusted Signing) before promoting the GitHub channel, or set autoDownload=false meanwhile.

**Minor:** afterPack wrapper not idempotent (afterPack.cjs:42 — double-run clobbers real binary); build.ps1 skips install when node_modules/.pnpm exists (stale after lockfile change; build.sh always installs); sign-local.ps1 creates Exportable self-signed key in CurrentUser\Root for 5yr (use NonExportable); setup-linux.sh pipes remote script to `sudo bash` + `corepack prepare pnpm@latest` ignoring the pin; GitHub Actions pinned to mutable tags not SHAs; release.yml publishes without running tests; Linux release builds AppImage but install-linux.sh expects .deb; eslint 8.57.1 EOL.

---

## Executive Summary

Whole-app review across 6 areas. **Awakon is a well-engineered, security-conscious Electron app** — correct sandboxing/contextIsolation everywhere, layered navigation and path-containment guards, schema-validated IPC, atomic persistence, and a thoughtful two-stage auto-resume design. The code is unusually well-commented (findings cite tracked issue IDs) and much of it is genuinely tested against real PTYs and filesystems.

Two **Critical** correctness/security bugs surfaced:

1. **Unsanitized paste → command injection** (terminal renderer): clipboard content containing `\x1b[201~cmd\r` escapes bracketed paste and executes immediately. Must fix both `host.paste` and xterm's native Ctrl+V path. Fix before Store submission.
2. **Foreign-OSC bell false positives** (core attention detector): the `\x07` ending any non-awakon OSC — e.g. the window-title update shells/ConPTY emit on every prompt — fires a bell attention, making the flagship attention feature systematically noisy on Windows (the primary platform). A test currently encodes the bug as expected behavior.

The dominant **cross-cutting theme** is **inconsistent IPC sender authorization**: the core `IpcRouter` has a real, tested per-sender model, but it's applied unevenly. `SessionCreate` (arbitrary cwd + attacker-controlled `env`), `SessionSetTitle`, `SessionRestartView`, the doc channels, and all the index.ts/fs-handlers-registered handlers (`SettingsUpdate` → auto-resume text typed into a shell, `FsReadFile` cross-tab reads) lack the check. A compromised terminal renderer (the surface rendering untrusted output) is the realistic threat. Recommend an opt-out guard helper so every channel gets the sender check by construction.

Other high-value **Important** items: add Electron fuses (RunAsNode etc. currently ON — undermines the sandbox), finish the Electron 43 upgrade in packages/core (still on EOL 33), address the unauthenticated auto-update channel before promoting the GitHub release channel, add `.strict()` + payload caps to IPC schemas, fix the split-during-close race that corrupts the pane tree, add output flow control/backpressure, and align all shortcut labels through `formatAccelerator` (several hardcoded labels, one of which teaches a tab-destroying shortcut).

**Overall verdict:** solid foundation, above-average discipline. No Critical issues in main/preload/contracts/chrome/build. Fix the two Critical bugs and do a focused IPC-authorization + packaging-hardening pass, and this is in genuinely good shape to ship.
