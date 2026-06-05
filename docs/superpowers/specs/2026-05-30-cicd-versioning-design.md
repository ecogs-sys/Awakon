# CI/CD Versioning + Release Automation — Design

**Date:** 2026-05-30
**Status:** Approved (awaiting implementation plan)

## Problem

Awakon has functioning CI and a tag-driven `release.yml`, but no automation
between "merge a PR" and "ship an installer." Versions are hand-edited across
five `package.json` files, no `CHANGELOG.md` exists, no `v*` tag has ever
been cut, and `electron-builder dist` builds installers without uploading
them to GitHub Releases. The result: cutting a release today requires
remembering the exact sequence (bump 5 files, write changelog, push tag,
manually upload artifacts, generate `latest*.yml`), and one missed step
breaks the auto-updater.

### Current state (verified 2026-05-30)

- pnpm monorepo. All 5 packages pinned at `0.3.0`. Only `@awakon/desktop`
  ships to users; the other four (`contracts`, `core`, `keymap`,
  `terminal-host`) are `private: true` workspace deps.
- `apps/desktop/electron-builder.json` publishes to GitHub Releases
  (provider: `github`, repo `ecogs-sys/Awakon`). `electron-updater` is in
  deps, so auto-update is wired or intended.
- `.github/workflows/ci.yml` — typecheck/test/build on Win/Mac/Linux per
  PR + push to main. Healthy; no change planned.
- `.github/workflows/release.yml` — triggered by `v*` tag push. Runs
  `pnpm --filter @awakon/desktop dist` on all three OSes using the default
  `GITHUB_TOKEN`. **Does not pass `--publish always`, so installers are
  built but never uploaded.**
- No `v*` tag exists. No `CHANGELOG.md`. No release-management bot.
- Commit history already follows Conventional Commits (`feat:`, `fix:`,
  `docs:`, `chore:`, `ci:`).
- `apps/desktop/electron-builder.json` has `mac.identity: null` — macOS
  dmg is unsigned.

## Goal

A push-button release flow: contributors merge Conventional Commit PRs;
a bot maintains version + CHANGELOG; merging the bot's "Release vX.Y.Z" PR
ships installers to a GitHub Release that the auto-updater can read.
Zero cost beyond what the repo already uses (free GitHub Actions minutes
on a public repo, no third-party services, no code-signing certs in this
phase).

## Non-goals

- Code signing (Windows or macOS). Annual cost; deferred to a follow-up
  spec when certs are acquired. macOS auto-update will remain
  unreliable until then — called out as a known limitation.
- Beta / pre-release channels. Single `latest` channel only. Adding a
  beta channel later is a config edit + branch convention.
- Versioning the four internal workspace packages
  (`@awakon/contracts`, `@awakon/core`, `@awakon/keymap`,
  `@awakon/terminal-host`). They stay at `0.3.0` indefinitely; consumers
  use `workspace:*` which resolves to local source regardless of the
  declared version.
- Editorialized / hand-curated release notes templates. Auto-generated
  notes from commit subjects are sufficient; the Release PR can always
  be edited before merge if a specific release needs polish.
- Backfilling release notes for commits already on `main`. The first
  release-please run sweeps the entire commit history (no prior `v*`
  tag exists) into one Release PR. No manual backfill step needed;
  verify the auto-generated CHANGELOG before merging.

## Design

### Tool selection

**[`googleapis/release-please-action@v4`](https://github.com/googleapis/release-please-action)**
running on push to `main`.

Rationale (alternatives considered, see *Alternatives* section):

- Reads Conventional Commits directly (matches existing commit style).
- Opens a "Release PR" rather than auto-tagging on every merge → keeps a
  human gate before installers ship.
- Maintains `CHANGELOG.md` and bumps versions across declared packages
  in one commit.
- Free, MIT-licensed, Google-maintained, broad adoption in Electron repos.
- Works with the default `GITHUB_TOKEN` for opening the PR; only needs
  a PAT for the tag-push step (see *Token model*).

### Bump scope — root + desktop only

release-please runs in **manifest mode** tracking exactly two packages:

| Path             | release-please name | Strategy      |
| ---------------- | ------------------- | ------------- |
| `.`              | root                | `release-type: node` |
| `apps/desktop`   | `@awakon/desktop`    | `release-type: node` |

The two are linked (same version, single Release PR, single tag) via
release-please's `linked-versions` plugin. Both `package.json` files
bump in lockstep on every release.

The four internal packages are intentionally **not** tracked. They stay
at `0.3.0` forever; their version is irrelevant because `workspace:*`
resolves to local source. Adding them to release-please would create
noise (separate CHANGELOG entries, version files churned on every
release) for no consumer benefit.

If internal packages are ever published to npm, that's a separate spec
that converts this to a different release-please config (independent
versioning per package) — not a one-way door.

### Files added

- **`release-please-config.json`** at repo root:
  ```json
  {
    "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
    "packages": {
      ".": {
        "release-type": "node",
        "package-name": "awakon",
        "bump-minor-pre-major": true,
        "draft": false,
        "prerelease": false
      },
      "apps/desktop": {
        "release-type": "node",
        "package-name": "@awakon/desktop",
        "bump-minor-pre-major": true,
        "draft": false,
        "prerelease": false
      }
    },
    "plugins": [
      { "type": "linked-versions", "groupName": "awakon", "components": ["awakon", "@awakon/desktop"] }
    ],
    "changelog-sections": [
      { "type": "feat",     "section": "Features" },
      { "type": "fix",      "section": "Bug Fixes" },
      { "type": "perf",     "section": "Performance Improvements" },
      { "type": "revert",   "section": "Reverts" },
      { "type": "docs",     "section": "Documentation", "hidden": true },
      { "type": "chore",    "section": "Miscellaneous", "hidden": true },
      { "type": "ci",       "section": "Continuous Integration", "hidden": true },
      { "type": "test",     "section": "Tests", "hidden": true },
      { "type": "refactor", "section": "Refactors", "hidden": true }
    ]
  }
  ```
  - `bump-minor-pre-major: true` is the standard pre-1.0 convention —
    `feat:` still produces a minor bump while the project is at `0.x.y`,
    rather than always being treated as a patch. (Without this, you'd
    sit on `0.3.x` indefinitely until a manual jump to 1.0.)
  - `draft: false` + `prerelease: false` make every release a published,
    public GA release on the single `latest` channel.

- **`.release-please-manifest.json`** at repo root, initial content:
  ```json
  {
    ".": "0.3.0",
    "apps/desktop": "0.3.0"
  }
  ```
  Bot-managed after first run.

- **`.github/workflows/release-please.yml`** — runs the bot:
  ```yaml
  name: release-please
  on:
    push:
      branches: [main]
  permissions:
    contents: write
    pull-requests: write
  jobs:
    release-please:
      runs-on: ubuntu-latest
      steps:
        - uses: googleapis/release-please-action@v4
          with:
            token: ${{ secrets.RELEASE_PLEASE_TOKEN }}
            config-file: release-please-config.json
            manifest-file: .release-please-manifest.json
  ```
  The `RELEASE_PLEASE_TOKEN` (not the default `GITHUB_TOKEN`) is
  intentional — see *Token model*.

- **`CHANGELOG.md`** at repo root — created on the first run, maintained
  by the bot.

- **`apps/desktop/CHANGELOG.md`** — created on the first run, maintained
  by the bot.

### Files changed

- **`.github/workflows/release.yml`** — one targeted change. The
  `Build installer` step adds `--publish always` so electron-builder
  uploads `.exe` / `.dmg` / `.AppImage` plus `latest.yml` /
  `latest-mac.yml` / `latest-linux.yml` to the GitHub Release that
  release-please created:
  ```yaml
  - name: Build installer
    run: pnpm --filter @awakon/desktop dist --publish always
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  ```
  No other change. The `v*` tag trigger, the three-OS matrix, and the
  `GITHUB_TOKEN` for upload are all unchanged.

- **`apps/desktop/.gitignore`** (or root `.gitignore`) — ensure
  `apps/desktop/release/` is ignored. The current `release/0.3.0/`
  directory in the working tree is a leftover from local `pnpm dist`
  runs; not tracked, but worth pinning.

### Token model

GitHub has an anti-loop rule: a workflow triggered by `GITHUB_TOKEN`
cannot trigger *other* workflows. If release-please pushed the
`v0.4.0` tag using the default token, our `release.yml` (`on: push:
tags: ['v*']`) would not fire.

Fix: release-please uses **`RELEASE_PLEASE_TOKEN`** — a fine-grained
Personal Access Token created on the maintainer's account, scoped to
**`ecogs-sys/Awakon`** only, with permissions:

| Permission     | Access |
| -------------- | ------ |
| Contents       | Read and write |
| Pull requests  | Read and write |
| Metadata       | Read |

The PAT is added as the repo secret `RELEASE_PLEASE_TOKEN`. Fine-grained
PATs expire (GitHub maximum: 1 year). A calendar reminder for renewal
is part of the operational checklist (see *Operations*).

`release.yml` keeps using the default `GITHUB_TOKEN` for the artifact
upload (`GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`) — no second secret
needed.

### CHANGELOG behavior

- One `CHANGELOG.md` at repo root + one at `apps/desktop/CHANGELOG.md`.
  Both are auto-maintained by release-please and have the same content
  (linked versions). The root one is the canonical reference; the
  desktop one exists because `release-type: node` always emits a
  per-package CHANGELOG and removing it requires a release-please
  extension.
- Sections follow `changelog-sections` config above. `docs:`, `chore:`,
  `ci:`, `test:`, `refactor:` are hidden from the changelog but still
  trigger a Release PR refresh (they don't bump the version).
- The GitHub Release body is auto-populated from the same content.

### Day-in-the-life flow

```
1. Merge a PR with a Conventional Commit message (feat:, fix:, …).
2. release-please.yml fires on push to main:
   - Walks commits since the last release tag (or repo start for run 1).
   - Computes the next version per commit-type rules.
   - Opens or updates a single "chore: release 0.4.0" PR. The PR diff:
       * package.json                        (root, version field)
       * apps/desktop/package.json           (desktop, version field)
       * CHANGELOG.md                        (root)
       * apps/desktop/CHANGELOG.md
       * .release-please-manifest.json
3. Maintainer reviews the Release PR. Edits CHANGELOG.md inline if
   needed; release-please respects manual edits.
4. Maintainer merges the Release PR.
5. release-please pushes tag `v0.4.0` using RELEASE_PLEASE_TOKEN.
6. release.yml fires on the v0.4.0 tag:
   - Builds installers on win/mac/linux runners.
   - Uploads .exe / .dmg / .AppImage + latest*.yml files to the
     v0.4.0 GitHub Release.
7. Users on prior versions auto-update via electron-updater reading
   the latest*.yml from the new Release.
```

### First-run / bootstrap

- `.release-please-manifest.json` starts at `{ ".": "0.3.0", "apps/desktop": "0.3.0" }`.
- On first push to `main` after the bot is installed, release-please
  reads all commits *since the start of the repo* (no prior release tag
  exists) and computes the next version. With existing `feat:` commits
  in history plus the `bump-minor-pre-major` flag, the first release
  will be **`v0.4.0`**.
- No special bootstrap step required.
- Pre-existing `0.3.0` references in code (e.g. `apps/desktop/release/0.3.0/`
  directory, version literals if any) are unaffected — release-please
  only edits `package.json` files declared in its manifest.

### Hotfix + rollback flow

- **Hotfix:** PR a `fix:` commit → merge → release-please immediately
  opens or refreshes the Release PR with a patch bump
  (`v0.4.0` → `v0.4.1`). Same merge → tag → installer flow.
- **Rollback (bad release that already shipped):** two options.
  1. Mark the bad GitHub Release as a draft (electron-updater stops
     offering it via `latest.yml`).
  2. Push a `revert:` commit on `main`; release-please cuts the next
     patch including the revert.
- **Withdrawn release (caught before installers complete):** delete the
  `v*` tag + GitHub Release before `release.yml` finishes uploading.
  `latest*.yml` will not be written and no user is offered the update.

### Operations

- **PAT renewal:** maintainer creates a calendar reminder ~11 months
  out to regenerate `RELEASE_PLEASE_TOKEN`. Renewal is a 5-minute
  task: generate new PAT, replace the secret value, delete old PAT.
- **Release verification:** after a release, confirm the GitHub
  Release page lists installer assets *and* `latest*.yml` for all
  three OSes before announcing.
- **Failed installer build:** the tag exists but the Release has no
  artifacts. Re-run `release.yml` from the Actions UI; the workflow
  is idempotent (uploads overwrite existing assets of the same name).

## Alternatives

Three patterns considered for bump + release triggering:

| Pattern                | How it works | Why not chosen |
| ---------------------- | ------------ | -------------- |
| **Manual `pnpm version`** | Maintainer runs `pnpm version minor && git push --follow-tags` locally; hand-writes CHANGELOG | Too much remembered ceremony per release; CHANGELOG drift inevitable. |
| **semantic-release**   | Bot auto-tags + releases on every merge to `main` (no human gate) | Removes the maintainer review step before installers ship to users. Inappropriate for desktop apps where a bad release reaches every installed client. |
| **release-please** ✅  | Bot opens a Release PR; maintainer merges to ship | Keeps the human gate, fully automates the busywork, well-supported. |

Two patterns considered for monorepo versioning:

| Pattern                          | Why not chosen |
| -------------------------------- | -------------- |
| **Lockstep all 5 packages**      | Adds noise — internal packages get CHANGELOG entries no one reads, version files churn on every release. No consumer benefit because `workspace:*` ignores declared versions. |
| **Independent per-package versioning** (e.g. Changesets) | Overkill until the internal packages publish to npm independently. Would be the right pivot if Awakon ever extracts `@awakon/contracts` as a public library. |
| **Root + desktop only** ✅       | Matches actual ship surface (one installer). Cleanest CHANGELOG. |

Two token approaches considered for the bot:

| Approach                  | Why not chosen for now |
| ------------------------- | ---------------------- |
| **GitHub App**            | No expiry, but ~10 min more setup (create/install app, manage app-id + private-key secrets). PAT chosen as the lower-friction starting point; can migrate to a GitHub App later if PAT renewal becomes friction. |
| **Default `GITHUB_TOKEN`** | Blocked by GitHub's anti-loop rule — won't trigger `release.yml`. Non-starter. |
| **Fine-grained PAT** ✅   | Free, 5-min setup, scoped to one repo. Renewal once per year. |

## Known limitations (called out for follow-up specs)

1. **macOS auto-update is unreliable until notarization.** Apple's
   Gatekeeper quarantines updated `.app` bundles that aren't
   signed + notarized. `electron-updater` can still download the new
   dmg, but launching it triggers the "unidentified developer" block
   for the user. Apple Developer ($99/yr) + a notarization step in
   `release.yml` is the fix — a separate spec.
2. **Windows installer triggers SmartScreen warning.** Until signed
   with a code-signing cert (~$200–$400/yr standard, more for EV),
   first-install users see "Windows protected your PC."
   Auto-update *does* work without signing on Windows, so it's
   user-friction only, not a functional break.
3. **Single `latest` channel.** No beta/RC pathway. When that's
   needed: add a `prerelease: true` config for a `beta` branch and
   the `autoUpdater.channel = 'beta'` opt-in for testers.

## Testing strategy

This spec is infrastructure; it has no production code paths to unit-test.
Validation is observational, done in this order on a real first release:

1. **Pre-merge:** validate `release-please-config.json` syntax with the
   action's own `--dry-run` mode (or push to a throwaway branch first
   and inspect the Release PR diff before merging to `main`).
2. **First Release PR:** verify the PR bumps both `package.json` files
   and creates both `CHANGELOG.md` files. Inspect computed version
   matches expectation (`v0.4.0`).
3. **First tag push:** verify `release.yml` fires automatically
   (proves `RELEASE_PLEASE_TOKEN` works around the anti-loop rule).
4. **First GitHub Release:** verify all 6 expected assets are present
   — `.exe`, `.dmg`, `.AppImage`, `latest.yml`, `latest-mac.yml`,
   `latest-linux.yml`.
5. **First auto-update:** install the previous local `0.3.0` build,
   leave it running, push a no-op `fix:` commit, complete the release
   flow, and confirm the installed app offers the update via the
   in-app updater UI.

The PAT renewal flow can't be tested without waiting a year; it's
documented under *Operations* as a calendar item instead.

## Acceptance criteria

- A `feat:` PR merged to `main` causes a "chore: release X.Y.Z" PR to
  appear within 2 minutes.
- Merging the Release PR causes a `v*` tag to be created and pushed.
- The tag push triggers `release.yml` and a GitHub Release is published
  with `.exe`, `.dmg`, `.AppImage`, and all three `latest*.yml` files.
- A previously-installed build offers the update via `electron-updater`
  within ~1 minute of the Release being published.
- No code-signing config is added, no third-party paid services are
  introduced, and the only new repo secret is `RELEASE_PLEASE_TOKEN`.
