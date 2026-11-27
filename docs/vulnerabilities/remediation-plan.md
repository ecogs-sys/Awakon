# Remediation Plan

Covers 28 of the 29 vulnerable packages found by `pnpm audit`. `zod` is excluded — see
[`zod-v4-migration.md`](zod-v4-migration.md).

Phases are ordered so the lowest-risk, highest-value fixes land first. Each phase ends with
`pnpm install && pnpm audit` to confirm progress before moving on.

## Status: Phases 0-4 complete

All four phases below have been applied and verified (typecheck, full test suite, production
build, and a runtime smoke test per the `apps/desktop:verify` skill — see commit messages on
branch `docs/vulnerability-remediation-plan` for the verification detail of each phase).

`pnpm audit` went from **186 advisories / 29 packages → 3 advisories / 2 packages** (0 critical,
0 moderate, 2 high, 0 low):

| Package | Status |
|---|---|
| `builder-util-runtime` | **Accepted residual risk.** The real, shipped instance (`electron-updater`'s runtime dependency) is patched at `9.7.0`. One remaining vulnerable instance (`9.2.10`) is reachable only through electron-builder's own circular `app-builder-lib`/`dmg-builder`/`electron-builder-squirrel-windows` peer dependencies — pnpm (9.12.0) won't resolve the existing `pnpm.overrides` pin for `electron-builder-squirrel-windows` onto that peer slot even after a from-scratch lockfile regen. This project never builds a Squirrel.Windows installer (absent from both `electron-builder.json` and `electron-builder.appx.json`), so it's build-tool-only exposure on an unused code path. |
| `zod` | **Tracked separately** — see [`zod-v4-migration.md`](zod-v4-migration.md). Needs a real code migration, not a version bump. |

One deviation from the original plan below: Phase 4's `minimatch` fix needed **two** scoped
overrides, not one — a second vulnerable instance (`minimatch@10.2.6`, via electron-builder's
`app-builder-lib`) only surfaced once the `minimatch@9` override was already in place and a fresh
audit was run. Both are documented in place below.

---

## Phase 0 — Free fixes (lockfile refresh only, zero code risk)

Some flagged versions are already inside the semver range their parent declares — the lockfile
is just stale. Example: `electron-vite` → `@babel/core@^7.29.7` → `@babel/helper-compilation-targets`
declares `browserslist: ^4.24.0`, which already permits the patched `4.28.7`, but the lockfile
had pinned `4.28.2`.

```sh
pnpm update
pnpm install
pnpm audit
```

No `package.json` edits. Re-run the audit after this and treat everything below against the
*remaining* list — some packages below may already be resolved by this step.

---

## Phase 1 — Direct runtime dependencies (patch/minor bump, shipped to users)

These are packages the built desktop app actually loads at runtime, but every fix is a
minor/patch bump within the current major — no API migration expected.

| Package | Location | Current | Bump to | Advisories cleared |
|---|---|---|---|---|
| `sharp` | `package.json` (root) | `^0.35.1` | `^0.35.5` | libheif/librsvg CVEs (2 high) |
| `markdown-it` | `apps/desktop` | `^14.2.0` | `^14.3.3` | 4 quadratic-complexity DoS (high) + pulls fixed `linkify-it` transitively |
| `dompurify` | `apps/desktop` | `^3.4.9` | `^3.4.17` | 7 XSS/sanitizer-bypass issues (moderate) |
| `mermaid` | `apps/desktop` | `^11.4.1` | `^11.16.1` | prototype pollution, CSS injection, 2 infinite-loop DoS (moderate) |
| `electron` | `apps/desktop`, `tests/e2e` | `^43.0.0` | `^43.8.1` | bulk of the 58 Electron CVEs — same major, in-range patch |
| `electron` | `packages/core` (type-only devDependency) | `^33.4.11` | `^43.8.1` (match desktop) | same CVEs + **removes `extract-zip` entirely** (see note) |

**Note on `extract-zip`:** this package has no patched release (`patched_versions: <0.0.0` —
abandoned). It's pulled in only by `electron@33.4.11`'s old `@electron/get`. Electron 43.x
replaced it internally with `@electron-internal/extract-zip`, so bumping `packages/core`'s
`electron` devDependency to match desktop's version removes the vulnerable package outright
instead of needing a workaround.

**Note on `katex`:** it rides in via `mermaid`'s own dependency (`katex: ^0.16.45` even in
mermaid 11.16.1), and that caret range does *not* reach the patched `0.18.2`. Bumping mermaid
alone does not fix this one — see Phase 3.

### Why `electron` in `packages/core` is low-risk

```
packages/core/src/ipc-router.ts:1: import type { IpcMain, WebContents } from 'electron';
```

It's a type-only import for IPC type definitions — `packages/core` never runs inside an Electron
process. The devDependency only needs to typecheck, not execute.

### Verification
```sh
pnpm --filter @awakon/desktop typecheck
pnpm -r typecheck
pnpm -r --if-present --filter=!@awakon/e2e --filter=!@awakon/integration test
```
Then smoke-test the app per the `run` skill: launch, open a markdown doc with an embedded mermaid
diagram, confirm rendering and sanitization still look right.

---

## Phase 2 — Build/test tooling major bumps (dev-only, needs test-suite verification)

`vitest` and `vite` have **no patched release in their current major** — `vitest 2.x` and
`vite 5.x` are both fully unpatched. The smallest jump that reaches a fix is:

| Package | Location(s) | Current | Bump to | Why this floor |
|---|---|---|---|---|
| `vitest` | `apps/desktop`, `packages/core`, `packages/terminal-host`, `tests/integration` | `^2.1.9` | `^4.1.12` | one advisory fixed at `3.2.6`, the other (in `@vitest/mocker`) not until `4.1.11`/`4.1.12` |
| `@vitest/coverage-v8` | `apps/desktop`, `packages/core` | `^2.1.9` | `^4.1.12` | must stay in lockstep with `vitest` (exact-version peer dep) |
| `vite` | `apps/desktop` | `^5.4.21` | `^6.4.6` | patched only at `6.4.2`+; `vitest@4` also requires `vite ^6\|^7\|^8` as a peer |
| `electron-vite` | `apps/desktop` | `^2.3.0` | `^6.0.0` | peer-requires `vite ^6\|^7\|^8`; current `2.3.0` only supports `vite 4/5` |

This single set of bumps cascades to fix, with no further action:
- `tinypool` (bundled by `vitest`)
- `@vitest/mocker` (bundled by `vitest`)
- `esbuild` → resolves to `^0.25.0` under `vite@6.4.6` (patched floor is exactly `0.25.0`)
- `postcss` → resolves to `^8.5.3` range under `vite@6.4.6`, which reaches patched `8.5.23`
- `nanoid` / `source-map-js` → pulled in by that same `postcss`, both resolve past their patched floors automatically

**Chose `vite 6.x` / `vitest 4.x` over the latest `vite 8` / `vitest 5`** deliberately — they're
the lowest major line with a fix, which keeps the Vite config / Rollup plugin surface closer to
what this repo already uses. A further bump to `vite 8` / `vitest 5` is a reasonable future
cleanup but isn't required for security and would widen the blast radius for this pass.

### Known risk
`electron-vite 2.3.0 → 6.0.0` is a 4-major jump for the one package that drives the dev server
and build (`electron-vite build` / `electron-vite dev` in `apps/desktop/package.json`). Its
internal bundler changed (now uses `rolldown`). This is the one change in this plan that
warrants manual verification beyond automated tests.

### Verification
```sh
pnpm --filter @awakon/desktop test          # vitest run
pnpm --filter @awakon/core test
pnpm --filter @awakon/terminal-host test
pnpm --filter @awakon/desktop typecheck
```
Manual: `pnpm dev` (electron-vite dev server + HMR works), then `pnpm --filter @awakon/desktop build`
followed by `pnpm --filter @awakon/desktop dist:dir` to confirm the production build still
produces a working unpacked app.

---

## Phase 3 — `pnpm.overrides` for packages that can't be bumped directly

Two groups of packages are vulnerable transitive dependencies of a tool that's *already at its
latest release* (`electron-builder@26.18.0` is current on npm), or sit behind a parent whose own
declared range doesn't reach the fix (`katex` via `mermaid`). The root `package.json` already
uses this exact mechanism (`app-builder-lib`, `dmg-builder`, `electron-builder-squirrel-windows`
are pinned this way today) — extend the same block:

```jsonc
// package.json (root) — pnpm.overrides
{
  "pnpm": {
    "overrides": {
      "app-builder-lib": "26.18.0",
      "dmg-builder": "26.18.0",
      "electron-builder-squirrel-windows": "26.18.0",

      "undici": "^7.30.1",
      "fast-uri": "^3.1.9",
      "@xmldom/xmldom": "^0.8.15",
      "tar@>=7": "^7.5.21",
      "builder-util-runtime": "^9.7.0",
      "form-data@4": "^4.0.6",

      "katex": "^0.18.2"
    }
  }
}
```

All of these sit **only in the electron-builder packaging toolchain** (`apps/desktop`'s
`electron-builder`/`@electron/rebuild`/`@electron/osx-sign`/`@electron/universal` dependency
chain used by `pnpm dist*` scripts) — they run on the build machine during packaging/signing and
are never bundled into the shipped app. Real-world exposure is "a malicious npm registry response
during a build," not end-user exposure, which is why these are overrides rather than blocking
upgrades.

`katex` is the exception — it *is* shipped (it renders math blocks inside mermaid diagrams in the
app UI), hence it's listed separately in Phase 1's note above. The patched version (`0.18.2`) is
one major ahead of what mermaid declares (`^0.16.45`), so forcing it via override needs a manual
check that mermaid's math rendering still works, since we're exceeding mermaid's own tested range.

### Verification
```sh
pnpm install
pnpm audit   # undici / fast-uri / xmldom / tar / builder-util-runtime / form-data / katex should be gone
pnpm --filter @awakon/desktop dist:dir   # confirm packaging toolchain still runs end-to-end
```
Manual: open a markdown doc containing a mermaid diagram with a math/KaTeX block, confirm it
still renders correctly (katex override).

---

## Phase 4 — Lint-toolchain-only stragglers (`minimatch`)

`brace-expansion` and `js-yaml` (originally flagged in the ESLint 8 / `@typescript-eslint` 7
dependency tree) were already cleared by Phase 0's lockfile refresh — only `minimatch` survived
to this phase.

**Two separate vulnerable instances existed, not one.** `pnpm why minimatch` after Phase 0-3
showed `minimatch@9.0.9` via `@typescript-eslint/typescript-estree` — lint-only, as expected. But
after overriding *that* instance and re-running the audit, a **second, previously-masked**
instance turned up: `minimatch@10.2.6` via `electron-builder`'s own `app-builder-lib` (declared as
`^10.2.5`) — this one is packaging-toolchain, used by `electron-builder.json`'s file-pattern
matching during `pnpm dist*`. Applied as two scoped overrides, keyed by major version:

```jsonc
"pnpm": {
  "overrides": {
    "minimatch@9": "^11.0.1",
    "minimatch@10": "^11.0.1"
  }
}
```

Both instances are now forced to `11.0.1+` (resolved to `11.0.9`), two majors ahead of what either
consumer declares — the real behavioral risk in this phase, since neither `@typescript-eslint` nor
`electron-builder` has released a version that bumps past `minimatch@11` yet.

### Verification (completed)
- `pnpm -r typecheck`: clean.
- `pnpm lint`: runs to completion — 171 pre-existing rule violations surfaced (escape characters,
  `any` types, control-regex in files unrelated to this change; `lint` isn't a CI gate in this
  repo). The linter matching real files and reporting real per-rule violations (rather than
  matching nothing, or crashing) confirms `typescript-estree`'s glob matching still works.
- `pnpm --filter @awakon/desktop dist:dir`: electron-builder's own file-pattern matching (asar
  packaging, node-pty native binary inclusion) completed successfully under the forced
  `minimatch@11`, and the resulting `win-unpacked/Awakon.exe` launched and booted correctly.

*(Optional future task, not required for this remediation: migrate to ESLint 9 flat config +
`@typescript-eslint@8`, which removes the need for the `minimatch@9` override. The `minimatch@10`
override depends on electron-builder's own upstream release, independent of that migration.)*

---

## Summary — final result (all phases applied)

| Phase | Packages cleared | Outcome |
|---|---|---|
| 0 | `dompurify`, `mermaid`, `markdown-it`, `linkify-it`, `brace-expansion`, `js-yaml`, `@xmldom/xmldom`, `fast-uri`, `undici`, `form-data`, `tar`, `nanoid`, `postcss`, `source-map-js`, `browserslist`, `baseline-browser-mapping`, `sharp` | all cleared by `pnpm update -r` alone — no `package.json` edits |
| 1 | `electron`, `extract-zip` | `packages/core`'s stale `electron@33.4.11` devDependency bumped to match desktop; removed `extract-zip` entirely as a side effect |
| 2 | `vitest`, `vite`, `electron-vite`, `tinypool`, `@vitest/mocker`, `esbuild`, `glob` | 0 critical advisories after this phase (down from 4 at the start) |
| 3 | `katex` | forced via override past mermaid's own declared range; verified by direct API call + build |
| 4 | `minimatch` | two scoped overrides needed (`@9` and `@10` — the second only surfaced after the first was applied) |
| *(separate doc)* | `zod` | tracked in `zod-v4-migration.md` — requires code changes, not just a version bump |

**Residual, accepted risk:** `builder-util-runtime@9.2.10`, reachable only through
electron-builder's circular peer-dependency graph on an installer format (Squirrel.Windows) this
project never builds. See the Status section at the top of this document.

Final `pnpm audit`: **3 advisories** (2 high, 1 — `zod` — moderate), down from 186.
