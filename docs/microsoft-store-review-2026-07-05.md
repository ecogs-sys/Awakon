# Awakon — Microsoft Store Readiness Review

**Date:** 2026-07-05 · **Scope:** what Microsoft's certification pipeline (malware/security scan, Windows App Certification Kit, and manual policy testing) is likely to flag when this app is submitted to the Microsoft Store · **Version reviewed:** 0.9.0 (branch `feat/fable-review`)

Every finding is traced to file:line evidence in this repo. Items marked **(verify)** have a step that could not be confirmed statically. This review builds on the general code review in [`code-review-2026-07-05.md`](code-review-2026-07-05.md); findings from there are cross-referenced rather than repeated in full.

> **Status update (2026-07-06, after round-2/round-3 fixes `51df7fc` + `93b5e1b`):** each finding below now carries a **Status** line verified against the current code. Resolved: S1, S3, S4 (all five flags), R4. Partially addressed: B3. Still open: B1, B2, B4, S2, R1, R2, R3.
>
> **Status update (2026-07-06, second pass):** B2, B3, R1, and R3 are now resolved (code + tests, see below). B1 is scaffolded but not submission-ready — the `appx` block holds placeholder Partner Center values that must be replaced before a build can be signed/submitted. Still open: S2 (Electron major upgrade — deferred, high blast radius, needs its own testing pass), B4 (Partner Center account work), R2 (needs a smoke test in a packaged MSIX, which needs B1's real identity values first).

**Context on what Microsoft actually checks:** a Store submission goes through (1) an automated malware/security scan of every binary, (2) packaging validation (MSIX manifest, identity, capabilities), and (3) certification testing against the Microsoft Store Policies — including installing the app on a clean Windows machine and exercising its primary features. Desktop apps can be submitted as **MSIX** (recommended, Store handles signing and updates) or as a signed **EXE/MSI** (Win32 flow). Awakon is currently set up for neither.

---

## Blockers — the submission cannot pass as-is

### B1. No Store-compatible packaging target
**Status (2026-07-06): scaffolded, not submission-ready** — `apps/desktop/electron-builder.json` now has `win.target: ["nsis", "appx"]` and an `appx` block, but `identityName`/`publisher` are placeholder strings (`REPLACE_WITH_PARTNER_CENTER_IDENTITY_NAME` / `REPLACE_WITH_PARTNER_CENTER_PUBLISHER_GUID`). An MSIX build will not succeed until those are swapped for the real values reserved in Partner Center (see B4). No Windows code-signing config exists yet either way.

`apps/desktop/electron-builder.json:21-23` builds Windows only as `nsis`. The Store accepts MSIX (electron-builder target `appx`) or a signed EXE/MSI; an unsigned NSIS installer fails both paths:

- **MSIX path:** no `appx` target, and none of the required identity fields are configured (`identityName`, `publisher` CN GUID, `publisherDisplayName`, `applicationId` — all must match the app identity reserved in Partner Center).
- **EXE/MSI path:** there is no Windows code-signing configuration at all (no `win.certificateFile` / signing hook in `electron-builder.json`; the only signing script is `scripts/sign-local.ps1` for local use). The Win32 submission flow requires the installer to be Authenticode-signed with a cert matching the Partner Center publisher, and to support silent install.

**Fix:** add an `appx` target with the Partner Center identity values, e.g.:

```jsonc
"win": {
  "target": ["nsis", "appx"]
},
"appx": {
  "identityName": "<from Partner Center>",
  "publisher": "CN=<GUID from Partner Center>",
  "publisherDisplayName": "ecogs",
  "applicationId": "Awakon",
  "backgroundColor": "#1c1f25"
}
```

### B2. Auto-updater runs in Store builds and tries to self-update from GitHub
**Status (2026-07-06): resolved.** `apps/desktop/src/main/auto-update.ts` now also returns early when `process.windowsStore` is set, in addition to the `!app.isPackaged` dev/test gate (covered by `auto-update.test.ts`).

`apps/desktop/src/main/auto-update.ts:10-21` — the only gate is `if (!app.isPackaged) return;`. A Store MSIX build **is** packaged, so on every launch the app contacts GitHub Releases (`electron-builder.json:35-41`), auto-downloads (`autoDownload = true`, line 13) and arms install-on-quit (`autoInstallOnAppQuit = true`, line 14).

This is a certification problem twice over: Store policy prohibits apps from distributing/installing software from outside the Store, and mechanically it cannot work anyway — MSIX apps install to the read-only `C:\Program Files\WindowsApps`, so an NSIS-style update either fails or (worse, from a reviewer's perspective) looks like an app trying to replace its own binaries. Certification testers specifically probe for out-of-band update mechanisms in packaged apps.

**Fix:** skip the updater when running from the Store package:

```ts
if (!app.isPackaged || process.windowsStore) return;
```

(`process.windowsStore` is set by Electron when running inside an AppX/MSIX container.)

### B3. Primary feature fails on a clean Windows machine — default shell is `pwsh.exe`
**Status (2026-07-06): resolved.** `apps/desktop/src/main/platform-defaults.ts` (`probeDefaultShell`) now scans `PATH` for `pwsh.exe` and falls back to `powershell.exe` when it's absent — exactly the case on a stock Windows 10/11 image. Main's `defaultShell()` (`index.ts`) uses the probed value, and a new `LayoutDefaultShell` IPC channel feeds the same value to the renderer's New Session dialog (`layout-manager.ts`'s `platformDefaultShell()`), so the dialog no longer prefills `pwsh` on a machine that doesn't have it. Separately, a failed user-initiated spawn (New Session dialog, "open recent", "duplicate tab" — the `core.session.create` path) now shows a native `dialog.showErrorBox` naming the shell and the underlying error (`session-create-error.ts`), instead of only a devtools `console.error`. Covered by `platform-defaults.test.ts`, `session-create-error.test.ts`, and `layout-manager-default-shell.test.ts`.

`apps/desktop/src/main/index.ts:108-112` picks `pwsh` as the Windows default, which `packages/core/src/session.ts:27` resolves to `pwsh.exe`. PowerShell 7 is **not** preinstalled on Windows 10/11 — only Windows PowerShell 5.1 (`powershell.exe`) is. Certification testers run the app on a stock Windows image: they'll launch Awakon, hit "New session", and the PTY spawn fails (the session throws or dies instantly). The app's core function being broken on first run is a failure of Store Policy 10.1 (the app must be fully functional and testable).

The same applies to `wsl` / `git-bash` entries in the shell picker (`packages/contracts/src/session.ts:14`) — those may legitimately be absent, but the failure must surface as a friendly message, not a dead tab.

**Fix (remaining):** probe for `pwsh.exe` on PATH and fall back to `powershell.exe`; show an actionable error when a user-selected shell isn't installed.

### B4. Submission prerequisites that don't exist yet (Partner Center, not code)
**Status (2026-07-06): open** — external to the repo; nothing to verify in code.

- **Privacy policy URL** — required because the app accesses the internet (auto-updater; the MSIX manifest gets the `internetClient` capability by default **(verify once B1's `appx` target is configured and built — this is electron-builder's default behavior, not yet exercised in this repo)**). The app collects no telemetry (no `fetch`/analytics calls anywhere in `apps/desktop/src` — verified by grep), so the policy can be short, but the URL field is mandatory.
- **`runFullTrust` restricted capability justification** — an Electron MSIX is a full-trust desktop-bridge app. Expect to justify why the app spawns arbitrary shell processes (`pwsh`, `cmd`, `wsl`, `bash` via node-pty). "Developer terminal/session manager" is an accepted category (Windows Terminal ships this way), but write the justification honestly.
- **Age rating questionnaire, screenshots, store listing.**

---

## High risk — likely flagged by the security scan or manual review

### S1. Clicked terminal links open remote web content *inside the app*
**Status (2026-07-06): resolved.** `WebLinksAddon` now takes an explicit handler that routes only `http(s)` URLs through main's `ChromeOpenExternal` IPC (`packages/terminal-host/src/terminal-host.ts:98-102`); every created web-contents gets a deny-all `setWindowOpenHandler` (`apps/desktop/src/main/index.ts:47`); and a `will-navigate` guard was added (`apps/desktop/src/main/navigation-guard.ts`).

Original finding (H1 of the general review): `WebLinksAddon` was loaded with no handler and no `setWindowOpenHandler`/`will-navigate` guard existed anywhere in `apps/desktop/src`. A tester who clicked a URL in terminal output got a bare Electron window hosting an arbitrary remote site — no address bar, no browser controls, full preload bridge reachable. Manual certification testing treats in-app rendering of arbitrary web content in a non-browser app as a security failure (Policy 10.2).

### S2. End-of-life Electron with known Chromium CVEs
**Status (2026-07-06): open** — still `electron: ^33.4.11` (`apps/desktop/package.json:45`). The compounding factor is gone, though: the sandbox is now **on** in every renderer (`index.ts:551`, `view-manager.ts:80` — `sandbox: true`), so an old-Chromium renderer exploit no longer lands unmitigated.

`apps/desktop/package.json:45` pins `electron: ^33.4.11`. Electron 33 (Chromium 130, released Oct 2024) left the supported window in 2025; as of mid-2026 it carries a long tail of publicly known, unpatched Chromium CVEs. Microsoft's binary scan fingerprints bundled runtimes, and a framework with known vulnerabilities is grounds for rejection under Policy 10.2 — and even if the automated scan passes, it is the first thing a manual security review checks in an Electron app.

**Fix (remaining):** upgrade to a currently supported Electron major before submitting.

### S3. Simulated keystroke injection is on by default
**Status (2026-07-06): resolved.** Auto-resume now ships **off by default** (`packages/contracts/src/settings.ts:48` — `enabled: false`, with an M7 comment explaining the trade-off); users opt in from Settings.

Original finding (general review M7): default settings shipped `autoResume.enabled: true`, and any PTY output containing the detect phrase caused the app to *type into the terminal by itself*. Two Store-specific angles:

- The malware scan's behavioral analysis looks for software that synthesizes input without user action. An app that writes keystrokes into shells based on screen content pattern-matches "auto-clicker / injection" heuristics.
- Policy-wise, features that act on the user's behalf must be consented to; a certification tester who `cat`s a file containing the phrase and watches the app type `1↵` into their shell will file that as unexpected behavior.

### S4. Static-analysis red flags in the Electron configuration
**Status (2026-07-06): resolved — all five flags fixed** (general review M1, M2, M3, M8, L2 plus round-3 N6):

| Flag (as originally found) | Resolution |
|---|---|
| `sandbox: false` on all renderers | Now `sandbox: true` everywhere — `index.ts:551`, `view-manager.ts:80` |
| Fully generic IPC bridge (`send`/`on` for any channel, no allowlist) | Replaced by per-renderer scoped bridges with explicit channel allowlists — `src/preload/shared.ts:18-41` (`exposeScopedBridge`), distinct lists in `chrome.ts` / `terminal.ts`; the old generic `src/preload/index.ts` no longer exists |
| No Content-Security-Policy on either page | CSP meta on both pages — `index.html:12`, `terminal-host.html:6` (`default-src 'self'; connect-src 'self'; …`) |
| `shell.openExternal` accepts any URL scheme (`file:`, `smb:`, …) | Schema now enforces http(s)-only at the wire — `packages/contracts/src/ipc.ts:207-209` (`.refine(isHttpUrl)`) |
| Unscoped file read IPC (any `.md` anywhere on disk) | `FsReadFile` handler enforces tab-cwd containment at the read boundary — `apps/desktop/src/main/fs-handlers.ts:69-79` |

---

## Medium — MSIX runtime behavior to fix or verify

### R1. No `app.setAppUserModelId`, and notifications must match package identity **(verify)**
**Status (2026-07-06): resolved for the NSIS build.** `apps/desktop/src/main/index.ts` now calls `app.setAppUserModelId('com.ecogs.awakon')`, guarded by `shouldSetAppUserModelId()` (`platform-defaults.ts`) so it only fires on win32 outside a Store/MSIX container — under MSIX the AUMID still comes from the package manifest automatically. The **(verify)** flag itself (real notification attribution inside a packaged MSIX) remains open until B1 produces a signed MSIX to test.

Grep across `apps/` and `packages/` finds no `setAppUserModelId` call. The app shows OS notifications (`apps/desktop/src/main/notification-bridge.ts:30` via Electron `Notification`). Under MSIX the AppUserModelID comes from the package manifest and Electron picks it up automatically, so notifications *should* attribute correctly in the Store build — but this needs a real test in the packaged MSIX, because in the current NSIS build (no explicit AUMID) Windows notification attribution/settings grouping is already unreliable. If you keep shipping NSIS alongside the Store build, call `app.setAppUserModelId('com.ecogs.awakon')` for the non-Store build only.

### R2. Filesystem writes under MSIX virtualization **(verify)**
**Status (2026-07-06): open** — unchanged; still needs a smoke test in the packaged MSIX once B1 lands.

Settings, session layout, and IPC logs write under `app.getPath('userData')` (`index.ts:44-45`) — safe, MSIX redirects AppData writes transparently. Things to smoke-test in the packaged build: node-pty's unpacked native binaries load from the read-only install dir (`electron-builder.json:12-14` asarUnpack — reads are fine, but confirm ConPTY spawn works from `WindowsApps`), and spawning `wsl.exe` from inside the app container.

### R3. Store listing metadata must match what the app is
**Status (2026-07-06): resolved (package.json).** `apps/desktop/package.json`'s `description` now reads "Terminal session manager with a markdown reader and agent auto-resume". The actual Partner Center store-listing copy (title, screenshots, longer description) is still a B4 prerequisite — this only fixes the field in the repo that a build/manifest pipeline would read from.

### R4. DevTools and Reload in the production menu
**Status (2026-07-06): resolved.** Reload and Toggle DevTools are now dev-only, gated on `!app.isPackaged` (`apps/desktop/src/main/app-menu.ts:53-57`).

Original finding (general review L5): `toggleDevTools` and `reload` shipped unconditionally. Not a hard policy violation, but certification testers press every menu item; DevTools opening in a shipped Store app reads as an unfinished product and occasionally draws a 10.1 "beta/test app" objection.

---

## Not an issue for the Store (checked, fine)

- **Third-party licensing** — `THIRD_PARTY_NOTICES.md` is present and current (all MIT/permissive); `LICENSE` is MIT. Store has no objection to OSS licensing as long as you have redistribution rights, which MIT grants.
- **No telemetry / data collection** — no network calls besides the updater (grep across `apps/desktop/src` for `fetch(`/`https://` finds only static GitHub link constants in `about-dialog.ts:10`). Privacy declaration is trivially clean now that B2 removes the updater from Store builds.
- **Packaged file set is clean** — `electron-builder.json:8-11` ships only `out/**` + `package.json`; dev tooling (`tools/ipc-log-viewer.html`, `temp/`, docs) is not in the package.
- **Icons** — `build/icons/` has 16–1024px PNGs; electron-builder can generate the MSIX tile assets from these. Visually check the generated 44×44/150×150 tiles for padding once B1's placeholder identity values are replaced and a real MSIX is built.
- **Single-instance, frameless window, custom titlebar** — all fine for Store apps.
- **The Linux `--no-sandbox` wrapper** (`afterPack.cjs:25`) exits early for non-Linux platforms and does not touch Windows builds. (General review H4 has since been fixed for Linux too — the wrapper now covers AppImage/`--dir` builds and fails loudly if deb is packed in the same invocation, N7.)

---

## Recommended order of work

Struck-through items are completed and verified (tests passing, `pnpm typecheck` clean) as of 2026-07-06.

1. ~~**B2** — gate the updater on `process.windowsStore`.~~ **Done.**
2. ~~**B3** — `powershell.exe` fallback for the default shell + friendly missing-shell error.~~ **Done.**
3. ~~**S1 + S4** — the Electron hardening batch from the general review (deny-all window-open handler, scheme allowlist, sandbox on, channel allowlist, CSP).~~ **Done.**
4. **S2** — Electron upgrade to a supported major. Deliberately deferred: current is `33.4.11`, latest is `43.0.0` — a 10-major jump with real breaking-API risk that needs its own dedicated testing pass, not bundled with the fixes above.
5. ~~**S3** — flip auto-resume to opt-in.~~ **Done** (off by default).
6. ~~**R1** — `app.setAppUserModelId` for the NSIS build.~~ **Done.**
7. ~~**R3** — accurate `package.json` description.~~ **Done.**
8. **B1** — replace the placeholder `identityName`/`publisher` in `electron-builder.json`'s `appx` block with real Partner Center values (the target + block themselves are already scaffolded); then build the MSIX and run the Windows App Certification Kit against it locally before submitting.
9. **R2** — smoke-test ConPTY spawn and WSL spawn in the installed MSIX (needs B1's real identity first).
10. **B4** — Partner Center: reserve the name, privacy policy URL, `runFullTrust` justification, accurate listing copy, age rating.
