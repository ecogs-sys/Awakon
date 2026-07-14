# Third-Party License Compliance Review — 2026-07-14

**Verdict: nothing in the dependency tree blocks commercial publication or
monetization** (Microsoft Store or direct distribution). Every shipped package
is under a permissive license. There is no GPL, AGPL, or copyleft-only code
anywhere in the production tree. What remains is attribution hygiene: the
existing `THIRD_PARTY_NOTICES.md` is stale (written before the markdown
reader / mermaid work) and is not shipped inside the packaged app.

## How this was verified

- `pnpm licenses list --prod --json` over the workspace (135 packages).
- Cross-checked against the actual shipped artifact: the file listing of
  `apps/desktop/release/0.9.0/win-unpacked/resources/app.asar` matches the
  scan 1:1 — electron-builder packs the full production tree of
  `@awakon/desktop` into the asar, plus `node-pty` unpacked.
- Binaries inspected individually (see below).

## License inventory of the shipped app

| License | Count | Packages (representative) | Obligation when distributing |
|---|---|---|---|
| MIT | 90 | xterm + addons, mermaid, markdown-it, electron-updater, node-pty, luxon, zod, katex, cytoscape, dayjs, uuid, marked, khroma\*, … | Retain copyright + permission notice |
| ISC | 34 | all `d3-*` modules, semver, graceful-fs, internmap, delaunator | Retain copyright + permission notice |
| BSD-3-Clause | 6 | d3-sankey, d3-ease, rw, older d3-array/d3-path/d3-shape copies | Retain notice; non-endorsement clause (no action) |
| BSD-2-Clause | 1 | entities | Retain notice |
| Apache-2.0 | 1 | @chevrotain/types | Retain license text; propagate NOTICE file if present (**verified: it has none**) |
| MPL-2.0 OR Apache-2.0 | 1 | dompurify | Dual-licensed — **elect Apache-2.0** in the notices; then no MPL source-disclosure duties apply |
| Python-2.0 (PSF) | 1 | argparse (via js-yaml) | Retain license text |
| BlueOak-1.0.0 | 1 | sax (via electron-updater) | Recipients must be able to see the license text |
| Unlicense | 1 | robust-predicates | Public domain — nothing required |

\* khroma reports "Unknown" in scanners because its `package.json` has no
`license` field, but its shipped `license` file is standard MIT
(© Fabio Spampinato, Andrew Maney). Include it manually in the notices.

## Bundled binaries (checked individually)

| Binary | Where | License | Status |
|---|---|---|---|
| Electron runtime (Awakon.exe, DLLs) | app root | MIT | `LICENSE.electron.txt` ships ✔ |
| Chromium third-party bundle | app root | BSD-3 + many | `LICENSES.chromium.html` ships ✔ — **never remove in afterPack** |
| ffmpeg.dll | app root | **LGPL-2.1** | OK: distributed unmodified as a separate, dynamically linked DLL (standard for every Electron app). Obligations are met by shipping `LICENSES.chromium.html` and not statically linking. Not a monetization blocker. |
| conpty.dll + OpenConsole.exe | inside asar (node-pty) | MIT (Microsoft) | `node-pty/LICENSE` ships inside asar ✔ |
| winpty | inside asar (node-pty/deps) | MIT | `deps/winpty/LICENSE` ships inside asar ✔ |
| elevate.exe | resources/ (NSIS builds only) | Injected from electron-builder's `nsis-3.0.4.1` bundle; NSIS itself is zlib. Upstream authorship of elevate.exe **not verifiable locally** | Not included in the Store (appx) build, so no Store impact. Add a one-line credit for the NSIS build path. |

## Microsoft Store specifics

- No Store policy prohibits shipping or charging for an app built on
  MIT/ISC/BSD/Apache dependencies. Policy 10.8.7 (pricing of open-source
  software) targets repackaging *other people's* free software — charging
  for your own product is fine.
- The appx build path does not use NSIS or elevate.exe.
- Certification reviewers occasionally check that attribution is reachable
  from within the app — the About dialog currently links to the GitHub blob
  URL, which breaks offline and if the repo goes private (see Gaps).

## ⚠ Business flag (not a legal blocker — a strategy decision)

All workspace `package.json` files declare `"license": "MIT"` and the About
dialog links to the public GitHub repo. If the repo is (or becomes) public
under MIT, **anyone may legally rebuild and redistribute Awakon for free**,
which undercuts paid Store distribution. Options: (a) accept open-core and
monetize convenience/updates, (b) relicense own code as proprietary
(`"license": "UNLICENSED"` + private repo or source-available terms). MIT
dependencies impose no constraint on this choice — they permit commercial,
closed-source use.

## Gaps in the current setup

1. **`THIRD_PARTY_NOTICES.md` is stale.** It lists 7 runtime deps + 16
   transitives; the shipped tree has ~135 packages. Missing entirely:
   markdown-it, mermaid, dompurify and their whole subtrees (d3, cytoscape,
   katex + its bundled fonts, khroma, roughjs, …).
2. **The notices file does not ship in the package.** The About dialog
   links to `github.com/...blob/main/THIRD_PARTY_NOTICES.md`. MIT's notice
   condition applies to distributed copies; a URL that can 404 (private
   repo, renamed branch) is fragile. The file should travel with the app.
3. **Per-package copyright lines are not reproduced.** MIT/ISC require the
   *package's own* copyright notice, not just the generic license text. The
   current file points at `node_modules/`, which end users never receive
   (only the asar does, and Vite-bundled renderer chunks lose their header
   comments in minification).
4. **No CI guard** — a future `pnpm add` of a GPL package would go unnoticed.

## Remediation plan

> **Status 2026-07-15:** items 1–4 implemented. `scripts/generate-third-party-notices.mjs`
> regenerates THIRD_PARTY_NOTICES.md (wired into every `dist*` script and exposed as
> `pnpm notices`); the file ships via `extraResources`; the About dialog's
> Acknowledgements opens the shipped copy through the new chrome-only
> `core.chrome.open-acknowledgements` IPC channel (verified end-to-end via IPC log);
> `scripts/check-licenses.mjs` gates CI. Items 5 (`@types/*` slimming) and the
> own-code licensing decision remain open — the repo has been made private for now.

1. **Generate a complete notices file** — add
   `scripts/generate-third-party-notices.mjs`:
   - source of truth: `pnpm licenses list --prod --json`;
   - for each package, emit name, version, homepage, license id, and the
     full text of its `LICENSE`/`license`/`LICENSE.txt` file (fallback to
     SPDX template text + `author` field when the file is absent);
   - special-case khroma (MIT, license file present but no field) and
     dompurify (add the line "used under the Apache License 2.0 option of
     its dual MPL-2.0 OR Apache-2.0 license");
   - append the static sections: Electron/Chromium/ffmpeg pointer to
     `LICENSES.chromium.html`, node-pty/winpty/conpty note, elevate.exe +
     NSIS (zlib) credit for NSIS builds, KaTeX fonts (covered by KaTeX's
     MIT license), trademark section (keep the existing one);
   - write to `THIRD_PARTY_NOTICES.md`; wire as `pnpm notices` and run it
     as part of `dist*` scripts so it can never go stale.
2. **Ship it**: add to `electron-builder.json` →
   `"extraResources": [{ "from": "../../THIRD_PARTY_NOTICES.md", "to": "THIRD_PARTY_NOTICES.md" }]`
   (inherited by `electron-builder.appx.json` via `extends`).
3. **Surface it in-app**: change the About dialog "Acknowledgements" entry
   to open the local file from `process.resourcesPath` (keep the GitHub
   link as a secondary "view online").
4. **Keep Electron's license files**: verify `afterPack.cjs` never deletes
   `LICENSE.electron.txt` / `LICENSES.chromium.html`.
5. **CI license gate**: a small script (or `license-checker-rseidelsohn`)
   with an allowlist — MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0,
   Python-2.0, BlueOak-1.0.0, Unlicense, CC0-1.0, 0BSD, and the exact
   string `(MPL-2.0 OR Apache-2.0)` — failing the build on anything else
   (including `Unknown`, with a pinned exception for khroma).
6. **Optional slimming**: the asar currently ships `@types/*` packages
   (~37 type-only packages) that mermaid drags in as prod deps. They're MIT
   and harmless, but excluding `**/node_modules/@types/**` in
   electron-builder `files` shrinks the package.
7. **Decide the own-code licensing question** (see Business flag) before
   the Store listing goes live — it affects the repo visibility and the
   `license` fields, not the dependency compliance above.
