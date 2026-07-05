# Awakon — Round-3 Review: New Findings After the R1-R9 + M6 Fix Commit

**Date:** 2026-07-06 · **Scope:** whole-branch re-review (diff `main...feat/fable-review`, commits `65a001d` + `51df7fc`) · **Audience:** the agent implementing these fixes.

Round-2 findings R1-R9 and the M6 two-stage auto-resume wiring were all implemented correctly as specified — do not touch them. This round found **11 new defects (N1-N11)** plus a cleanup list (C1-C9). Every finding below was independently verified by reading the code at the cited file:line; all verdicts are CONFIRMED. N11 was additionally **observed live** during this review (see its evidence).

**Theme:** N1-N4 are all consequences of the R3/H2 *reparent* machinery. `reparentTab` swaps a tab's identity (old primary session id → promoted pane id) in `tabMeta`, `tabOrder`, `paneOwnership`, the `ViewManager` map, and chrome's renderer state — but four other places that hold or infer that identity were missed: the crash-handler closure, the immutable `Session.kind`, the renderer's persist ordering, and `paneOwnership`'s lifecycle for exited panes. Fix each individually (below), but note the design smell: tab identity lives in ~6 mutable mirrors. A durable fix (out of scope, future work) would be a stable tab id distinct from any session id.

Work top to bottom.

---

## N1 (high): closing the primary pane persists a stale split tree — the closed pane resurrects on next launch

**Evidence:**
- `apps/desktop/src/renderer/terminal/split-container.ts:159` sends `SessionClosePane`, then `:176` synchronously calls `persist()` with the still-old `this.tabId` (retarget only happens later, on the `LayoutTabReparented` event, `:258`).
- Both messages are `ipcRenderer.invoke` (`preload/shared.ts:26`), so FIFO holds: main runs the fully synchronous `handleSessionClosePane` → `reparentTab` first. `reparentTab` (`apps/desktop/src/main/index.ts:353-354`) does `tabMeta.delete(oldTabId)` and `tabMeta.set(newTabId, { ...meta, ... })` — the spread copies the **stale** `meta.splits` (still containing the closed pane's leaf) and `persistTabs()` writes it.
- The renderer's corrected persist then arrives at `onPersistSplits` (`index.ts:442-444`), where `tabMeta.get(oldTabId)` is undefined → silently dropped.

**Failure:** split a tab (2 panes), "Close Pane" on the primary, quit, relaunch (or macOS dock-reopen): the 2-leaf tree restores via `SessionCreateForPane` (leaves carry no session ids, `split-container.ts:263`) — the pane the user closed comes back as a fresh shell.

**Fix (main-side, smallest correct):** in `reparentTab`, reconcile the splits tree at the moment of reparent instead of copying it blindly — remove the closed primary's leaf and collapse the branch (mirror of the renderer's `removeLeaf` logic), or simplest: `delete meta.splits` on the copied meta and let the renderer's next persist (it always sends one after retarget — verify; if it only persists pre-retarget, make `retarget()` call `persist()`) write the corrected tree. Alternatively, main-side: have `onPersistSplits` map a missed `oldTabId` through a short-lived reparent alias map. Prefer the `retarget()`-persists approach: renderer stays the single owner of the tree shape.
**Test:** 2-pane tab → close primary → assert persisted `splits` for the new tabId is `null`/single-leaf (not 2 leaves); restart-simulation asserts one pane.

## N2 (high): crash recovery is dead for any reparented tab

**Evidence:** `apps/desktop/src/main/view-manager.ts:84-86` registers `render-process-gone` with the create-time `sessionId` captured in the closure. `rekey()` (`view-manager.ts:152-158`) moves only the map entry and never rebinds the listener. After a reparent (`index.ts:360`), a renderer crash fires `handleRendererCrash(oldId)` → `recreateSessionView(oldId)` → `replaceView(oldId)` → `views.get(oldId)` is empty → returns null (`view-manager.ts:163`) — silent no-op. A second crash sends `SessionTabBroken {sessionId: oldId}`, which chrome drops (`layout-manager.ts:117-119` — its state was already rekeyed by `LayoutTabReparented`).

**Failure:** split → close primary pane → renderer crash: dead blank tab, no auto-recovery, no "Restart" affordance.

**Fix:** make the crash listener resolve the *current* id at fire time: store the id on the view entry and have `create()` register `(_e) => this.opts.onCrash?.(this.idOf(view), view)` where `idOf` reverse-looks-up the views map (or keep a `WeakMap<WebContentsView, string>` that `rekey()` updates).
**Test:** create view, `rekey(a, b)`, emit `render-process-gone` → `onCrash` receives `b`.

## N3 (high, macOS): a reparented tab vanishes from any freshly created chrome window

**Evidence:** `Session.kind` is `readonly` (`packages/core/src/session.ts:46`); panes are created with kind `'pane'` (`index.ts:418`) and `reparentTab` (`index.ts:350`) never re-labels the promoted session. A fresh chrome renderer's bootstrap loop skips it: `layout-manager.ts:194` `if (info.kind === 'pane') continue;`, and the follow-up `LayoutShow` push is dropped at `layout-manager.ts:105` (`sessions.has` fails).

**Failure:** split → close primary (tab now keyed by a pane-kind session) → close the window without quitting (macOS) → dock-reopen: the H3 reattach branch (`index.ts:586-597`) recreates the view, but the tab never appears in the tab strip or sidebar. Its PTY and view live on in main — an orphaned, un-closeable session that `persistTabs()` keeps resurrecting.

**Fix:** kind describes *role*, and the role changes at promotion — make it mutable through a controlled path: add `Session.promoteToTab()` (sets `kind = 'tab'`, or make SessionManager re-wrap) and call it from `reparentTab`. Broadcast the updated info (`SessionTitleChanged`-style or rely on the existing `LayoutTabReparented`) so live chromes stay consistent; the fresh-window bootstrap then lists it naturally.
**Test:** reparent, then assert `sessionManager.get(newTabId)!.info().kind === 'tab'`; simulate fresh-chrome bootstrap and assert the tab is listed.

## N4 (medium): closing the primary pane after a sibling's shell exited tears down the whole tab

**Evidence:** `index.ts:328-330` deletes an exited pane from `paneOwnership` (spec-§7 keeps it *visible* read-only: `terminal-host.ts:183-187` writes an exit banner; `SplitContainer` never removes the leaf). `handleSessionClosePane` (`index.ts:374-383`) then finds no sibling in `paneOwnership` and falls through to `closeTab()` — destroying the view including the exited pane's readable scrollback, while the renderer had just promoted that pane in its DOM.

**Failure:** 2-pane tab → `exit` in pane 2 → "Close Pane" on the primary → the entire tab vanishes from one click. H2 resurfaces in this state.

**Fix:** don't drop exited panes from `paneOwnership` on `sessionExited` (keep the mapping until the pane is explicitly closed or the tab is torn down) — the `sessionExited` cleanup at `index.ts:328-330` was for sessions with no tab at all; scope it to sessions that are *not* in `paneOwnership`, or track exited-but-visible panes separately. Then `handleSessionClosePane` finds the exited sibling and reparents onto it (a read-only tab is valid — spec §7).
**Test:** 2 panes, exit the sibling, close primary → tab survives keyed by the exited sibling, scrollback intact.

## N5 (medium): rate-limit auto-resume in a split pane gets no badge and no cancel path

**Evidence:** the M6 wiring registers `rateLimitDetected` for every session including panes (`session-manager.ts:46-79`; panes created at `index.ts:418`). `index.ts:299-307` forwards `resumeScheduled/Cancelled/Fired` with the **raw** session id — no `paneOwnership` mapping, unlike attention's `tabIdForSession` (`index.ts:520`). Chrome drops unknown ids (`layout-manager.ts:126-127`; pane sessions are never in its map).

**Failure:** Claude Code hits its limit in a non-primary pane: stage 1 answers the menu and a resume is scheduled, but no countdown badge appears and `ResumeCancel` is unreachable — `continue\r` lands in the pane at reset time with no prior indication. (Meta note: this exact flow ran against this very session during the review — the badge would have been the only visible signal.)

**Fix:** map at the forwarding boundary, mirroring attention: send `{ sessionId: paneOwnership.get(id) ?? id, targetSessionId: id }` — badge on the owning tab. `ResumeCancel` must then cancel by the *scheduled* id: either include `targetSessionId` in the badge payload for the cancel round-trip, or (simpler) have `SessionManager.cancelResume` accept the tab id and cancel any pending resume whose session belongs to that tab (main resolves via `paneOwnership`).
**Test:** schedule via a pane session id → chrome payload carries the tab id; cancel from the badge cancels the pane's pending resume.

## N6 (medium, security): `FsReadFile` has no path containment — persisted-doc restore bypasses the L2 guard

**Evidence:** `apps/desktop/src/main/fs-handlers.ts:62-79` validates only a case-insensitive `.md` suffix (`:66`) and a 1 MB cap (`:71`). The L2 containment lives only at the DocOpen click path (`index.ts:466-467`). The restore chain bypasses it: main returns stored `tabMeta.docs` verbatim (`index.ts:494-497`) → chrome's `restoreDocs` (`layout-manager.ts:533-542`) → `doc-reader.ts:162` sends the stored `resolvedPath` straight to `FsReadFile`.

**Failure:** a tampered/stale `sessions.json` doc entry (or any compromised-chrome `FsReadFile` call) reads any `.md` under 1 MB anywhere on disk (e.g. `~/.ssh/notes.md`) on restart.

**Fix (right altitude — the read is the boundary):** enforce containment inside the `FsReadFile` handler: main knows each tab's cwd (`tabMeta`), so require the payload to carry `tabId`, resolve against that tab's cwd, and apply the same `isPathInside` predicate (see N9's shared helper). The click-path check at `index.ts:466` can stay as an early bail but is no longer the boundary.
**Test:** FsReadFile with a path outside the tab's cwd → error; persisted doc inside cwd still restores.

## N7 (medium, Linux): `--dir` builds lost the `--no-sandbox` wrapper; combined `AppImage deb` packs still silently skip it

**Evidence:**
- Old afterPack wrapped **every** Linux pack (its deleted comment: needed "for AppImage and linux-unpacked builds alike"). New guard `apps/desktop/afterPack.cjs:30` `if (!targetNames.includes('appImage')) return;` skips `--dir` builds — a dir build's target name is `"dir"` (`app-builder-lib` `out/core.js:62`, `DIR_TARGET = "dir"`). `dist:dir` exists (`apps/desktop/package.json:19`). (E2e is unaffected — Playwright launches the dev electron binary, `tests/e2e/take-screenshots.spec.ts:80`.)
- `afterPack.cjs:31` silently returns when `deb` is among the targets; the file's own comment (`:24-25`) admits a combined invocation "silently reproduces H4". Nothing enforces the two-invocation convention (`dist:linux`, `package.json:20`) at build time.

**Failure:** `pnpm dist:dir` output fails to launch on distros restricting unprivileged user namespaces (unpacked output has no root-SUID `chrome-sandbox`); and any revert of `dist:linux` to one invocation ships a broken AppImage with zero signal.

**Fix:** wrap when the pack contains `appImage` **or** `dir`; and replace the deb early-return with `throw new Error('AppImage and deb must be built in separate electron-builder invocations — see dist:linux')` when `appImage`/`dir` co-occur with `deb` (a deb-only pack still returns silently, which is correct). Shrink the prose comment accordingly.
**Test/verify:** run `dist:dir` and `dist:linux`; assert the dir + AppImage binaries are wrapped, the deb binary is not, and a combined `--linux AppImage deb` invocation fails the build.

## N8 (medium): a transient cwd failure at startup permanently deletes the tab from the persisted layout

**Evidence:** `apps/desktop/src/main/session-bootstrap.ts:46-49` catches a failed `createTabSession` and skips the tab (never added to `tabMeta`). Every *successful* restore calls `persistTabs()` (`index.ts:169`), and `snapshotTabs()` emits only `tabOrder.filter(id => tabMeta.has(id))` (`index.ts:85-89`) — `sessions.json` is rewritten without the failed tab during the same boot.

**Failure:** a tab's cwd is on a network/USB volume not yet mounted at login → PTY spawn throws → tab is gone from the saved layout forever, even though the drive mounts a minute later.

**Fix:** don't let a failed spawn erase the persisted record. Options, in order of preference: (a) fall back to spawning at `homedir()` with the tab's title annotated (keeps the tab alive; user re-`cd`s), or (b) keep the failed tab's `PersistedTab` in `tabMeta`/`tabOrder` in an `unspawned` state that snapshotting preserves and the UI shows as "failed to restore — retry". The M5 skip-and-continue stays for genuinely unrestorable tabs only if the record survives.
**Test:** bootstrap with one tab whose cwd spawn throws → persisted snapshot after boot still contains that tab.

## N9 (low): the L2 containment predicate false-rejects in-cwd files named `..*` — and is duplicated

**Evidence:** `index.ts:467` — `if (rel.startsWith('..') || isAbsolute(rel)) return;`. For a file literally named `..plan.md` in the cwd, `relative()` returns `..plan.md` → rejected (fail-closed, so functional not security). The same idiom lives in `navigation-guard.ts:35` (unreachable-in-practice there, but same shape), and the reuse review flagged the two as copy-paste of one security predicate.

**Fix:** export a single `isPathInside(baseDir, targetPath)` from `navigation-guard.ts` (it already has the unit-test harness, incl. the Windows cross-drive case) implementing `rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))`, and call it from `isAllowedNavigation`, the DocOpen handler, and N6's `FsReadFile` fix.
**Test:** `..plan.md` inside cwd → allowed; `../escape.md` → rejected; `D:\other` vs `C:\cwd` → rejected.

## N11 (high, observed live): stage-1 auto-resume re-fires on every detector re-arm — spams `responseText` into the CLI

*(The detect phrase is written as "Stop and wait for limit to re·set" throughout this section — deliberately broken with an interpunct so that displaying this document inside an Awakon terminal cannot itself trigger the detector. Remove the `·` when reading.)*

**Observed evidence (2026-07-06):** during this review, run inside Awakon with auto-resume enabled, the reviewing Claude Code session received **10+ stray `1` inputs submitted as messages** over several minutes — long after the original rate-limit menu had been answered and the limit had reset. Each is a stage-1 `${responseText}\r` write.

**Mechanism (all three parts required, all present):**
1. `packages/core/src/session-manager.ts:70` writes `responseText\r` on **every** `rateLimitDetected` event. Only stage 2's `schedule()` is deduped (`:74`) — the write itself has no guard.
2. The detector's `present` flag is the only rate limiter, and it is unstable by design: `packages/core/src/rate-limit-detector.ts:57-59` resets `present = false` whenever the phrase is absent from the current 4096-char sliding window (`WINDOW_MAX`, `:5`). Any TUI redraw cycle that scrolls the phrase out of the last 4 KB of output and back in produces a fresh false→true transition → another `1\r`.
3. The detector matches the phrase **anywhere** in output with no menu-context anchoring. The configured detectText (the option-1 label, "Stop and wait for limit to re·set") also appears in ordinary content: Claude Code *transcripts* replaying the answered menu, and — as happened here — *review documents and chat output discussing the auto-resume feature itself*. Rendering `docs/code-review-round2-2026-07-05.md` (which quotes the label at line 163) in an Awakon terminal is sufficient to fire stage 1.

**Failure:** a self-sustaining input storm. Each stray `1` submitted to the CLI produces new output; if the phrase is still being redrawn in scrollback/status regions, the loop continues indefinitely. Worse than noise: if any *other* interactive menu happens to be open (a package-manager prompt, a git menu, Claude Code's own dialogs), `1\r` **selects option 1 of that menu** — an unintended, potentially destructive action taken on the user's behalf. This runs unbounded until the user disables auto-resume in settings.

**Fix (both layers):**
1. **One-shot gating in `SessionManager` (`session-manager.ts:67-79`):** before the stage-1 write, bail if a resume is already pending — `if (this.resumeScheduler.has(id)) return;` — and record a per-session `lastAnsweredAt`; suppress further stage-1 writes for a cooldown (suggest 5 minutes — real limit hits are hours apart, menu redraws are seconds apart). The cooldown also covers the parse-failure path, which schedules nothing and is otherwise unguarded.
2. **Context anchoring in the detector (deeper, kills the false-positive class):** require menu chrome near the match before emitting — e.g. the `❯` selector glyph or the `Enter to confirm` footer within the trailing-context span (both confirmed present in the real IPC log per the round-2 M6 analysis, frame #86314). A quoted label in a doc or transcript has neither. Keep the phrase match as the cheap first-pass filter.

**Tests:** (a) two false→true transitions within the cooldown → exactly one write; (b) transition while a resume is pending → no write; (c) phrase present *without* menu chrome (plain quoted text) → no event at all; (d) the real menu layout (phrase + `❯` + `Enter to confirm`) → fires once.

## N10 (low): dev-CSP relaxation is an exact-string replace, and `index.html`'s comment describes a mechanism that doesn't exist

**Evidence:** `electron.vite.config.ts:15-17` does `html.replace("connect-src 'self';", ...)` — a silent no-op if the CSP meta in `index.html:12` or `terminal-host.html:6` ever drifts (works today; drift breaks dev HMR with no build error). `index.html:10`'s comment claims main injects the dev policy via `onHeadersReceived` — grep finds `onHeadersReceived` nowhere in `apps/desktop/src`; the vite `transformIndexHtml` plugin is the real mechanism (and header CSP could not loosen a meta CSP anyway, as the config's own R8 comment notes).

**Fix:** make the plugin throw when the marker string is absent from the HTML it transforms (build-time guarantee), and rewrite the `index.html` comment to point at `electron.vite.config.ts`.

---

# Cleanup (C1-C9) — verified, apply after N1-N10

- **C1 — `apps/desktop/src/preload/channels.test.ts:18`:** the R2 regression test pins ~38 hand-copied channel literals ("keep them in sync") — it cannot catch the failure class it exists for (a renderer using a channel absent from both the allowlist and the copy). Derive `usedByRenderer` in the test by scanning the renderer sources for `\b(?:send|on)\(IpcChannel\.(\w+)` (the comment says the lists came from exactly that grep).
- **C2 — http(s)-scheme rule ×3:** `index.ts:252`, `terminal-host.ts:99`, `doc-reader.ts:144` each inline `/^https?:\/\//i` while `ChromeOpenExternalPayloadSchema` (`contracts/src/ipc.ts:209`) still advertises `z.string().url()` (any scheme). Put the refinement in the Zod schema and export one `isHttpUrl` helper from contracts for the renderer-side filters.
- **C3 — `apps/desktop/src/preload/shared.ts:3`:** new `Bridge` interface duplicates the already-exported `PreloadBridge` (`packages/terminal-host/src/terminal-host.ts:18-21`) shape-for-shape. Use one type (type-only import) so they can't drift.
- **C4 — dead scheduler test hook + misleading test:** `session-manager.ts:38`'s `resumeSchedulerOptions` param is never passed by any caller (unit tests use `vi.useFakeTimers`) — delete it and revert to the field initializer. Relatedly, `tests/integration/auto-resume.test.ts:122`'s cancel test waits 1 s under a real 20 s sweep + 30 s grace with resetAt 5 min out — the negative assertion is vacuous (it would pass even without cancelling) and its "(200ms)" comment is wrong. Point the test at the fake-timer unit coverage or make the wait meaningful.
- **C5 — dead channel grant:** `IpcChannel.ChromeMenuPopup` is in chrome's SEND allowlist (`chrome.ts:28`) and has a main handler (`index.ts:184`) but no sender anywhere (titlebar uses `ChromeAppMenuPopup` only). Drop the allowlist entry; remove or wire the handler.
- **C6 — `apps/desktop/src/renderer/terminal/main.ts:41-44`:** the module-level `currentTabId` mirror + `e.oldTabId === currentTabId` guard are redundant — `LayoutTabReparented` is sent targeted to the promoted view only (`index.ts:362-364`), so the guard is always true; `SplitContainer.retarget()` already owns the state. Collapse to a one-line listener.
- **C7 — `index.ts:268` (L3):** the `recentTabs` carve-out is a per-field special case; the next app-owned field added to `AppSettings` reintroduces the clobber. Split a `UserEditableSettings` schema (autoResume + defaultCwd) as the `SettingsUpdate` payload so the dialog can't send state it doesn't own.
- **C8 — `index.ts:586-593`:** the dock-reopen reattach loop awaits `createSessionView` per tab sequentially (~100-300 ms each); run `closeTabPanes` for all tabs then `Promise.all` the view creations. While there, hoist the focus/show/LayoutShow triple duplicated at `:591-593` and `:603-605` into a local `focusAndShow()`.
- **C9 — build/test time:** `scripts/build-preload.mjs` spawns two full electron-vite builds unconditionally before every dev/build (add a 3-file mtime skip); `session-attention-gate.test.ts:95` burns ~7.5 s of fixed real-PTY sleeps (make idle timing injectable); `tests/e2e/split-close.spec.ts:40` uses `waitForTimeout(2500)` (poll or wait for a readiness signal, and lift the `sessionCount`/`launchArgs` helpers duplicated across 4-5 spec files into `tests/e2e/helpers.ts`).

---

## Definition of done

1. N1-N11 fixed with the tests listed; C1-C9 applied. N11 first — it is actively firing in any Awakon install that has auto-resume enabled while rate-limit-related text is on screen.
2. Full test suite green (`pnpm test` at repo root).
3. **App smoke-launched** (dev *and* packaged/preview) with the reparent flows exercised by hand: split → close primary → (a) relaunch shows one pane (N1), (b) tab strip still shows the tab after a simulated fresh chrome window (N3), (c) close-primary-after-sibling-exit keeps the tab (N4). Rate-limit badge check per N5 needs only the unit tests plus the forwarded-payload assertion.
4. Round-2's R1-R9 and M6 behaviors must not regress — rerun their tests.
