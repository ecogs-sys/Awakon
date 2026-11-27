# Remediation Plan

Covers 28 of the 29 vulnerable packages found by `pnpm audit`. `zod` is excluded — see
[`zod-v4-migration.md`](zod-v4-migration.md).

Phases are ordered so the lowest-risk, highest-value fixes land first. Each phase ends with
`pnpm install && pnpm audit` to confirm progress before moving on.

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

## Phase 4 — Lint-toolchain-only stragglers

`brace-expansion`, `js-yaml`, and `minimatch` are vulnerable only inside the ESLint 8 /
`@typescript-eslint` 7 dependency tree (`pnpm why brace-expansion` confirms two instances: one via
`@typescript-eslint/typescript-estree`'s `minimatch@9.0.9`, one via `eslint`'s own internal
`minimatch@3.1.5`). These run only for `pnpm lint` / editor integration — never part of the
shipped app, never part of `pnpm build`/`dist`.

A full fix means migrating `eslint@8 → 9` (flat config) and `@typescript-eslint@7 → 8`, which is a
real (if mechanical) migration on its own and not required to close these advisories. Close them
now with scoped overrides instead, keyed by major version so both instances get fixed without
forcing every consumer onto one line:

```jsonc
"pnpm": {
  "overrides": {
    "brace-expansion@1": "^1.1.21",
    "brace-expansion@2": "^2.1.7",
    "js-yaml@4": "^4.3.2",
    "minimatch@9": "^11.0.1"
  }
}
```

`minimatch@9 → ^11.0.1` is the one override here with real behavioral risk: it's used directly by
`@typescript-eslint/typescript-estree` for glob matching (not just a transitive pass-through), and
`9 → 11` is two majors. If `pnpm lint` misbehaves after this override, fall back to leaving this
one advisory open and track the ESLint 9 migration as a separate task rather than forcing it.

### Verification
```sh
pnpm install
pnpm lint
pnpm audit   # brace-expansion / js-yaml / minimatch should be gone (or only minimatch remains open)
```

*(Optional future task, not required for this remediation: migrate to ESLint 9 flat config +
`@typescript-eslint@8`, which removes the need for all three overrides above.)*

---

## Summary after all phases

| Phase | Packages cleared | Residual risk accepted |
|---|---|---|
| 0 | `browserslist`, `baseline-browser-mapping` (if lockfile-stale) | none |
| 1 | `electron`, `extract-zip`, `sharp`, `markdown-it`, `dompurify`, `mermaid` (partial — see katex) | none |
| 2 | `vitest`, `vite`, `tinypool`, `@vitest/mocker`, `esbuild`, `postcss`, `nanoid`, `source-map-js` | `electron-vite` dev-server behavior change, needs manual smoke test |
| 3 | `undici`, `fast-uri`, `@xmldom/xmldom`, `tar`, `builder-util-runtime`, `form-data`, `katex` | none (build-time only, except katex which gets a manual render check) |
| 4 | `brace-expansion`, `js-yaml`, `minimatch` | `minimatch` override may need to be dropped if lint breaks |
| *(separate doc)* | `zod` | tracked in `zod-v4-migration.md` — requires code changes, not just a version bump |

`glob` (moderate, via `@vitest/coverage-v8` → `test-exclude`) is resolved as a side effect of the
`vitest` bump in Phase 2 — `@vitest/coverage-v8@4.1.12` depends on a `test-exclude` version built
against modern `glob`; confirm with `pnpm why glob` after Phase 2 and add a targeted override only
if it's still present.
