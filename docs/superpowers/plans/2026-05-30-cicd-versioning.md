# CI/CD Versioning + Release Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up `release-please` so merging Conventional Commit PRs auto-opens a Release PR; merging that PR cuts a `v*` tag that triggers the existing `release.yml`, which builds + uploads signed-or-not installers to a GitHub Release that `electron-updater` can consume.

**Architecture:** Two config files (`release-please-config.json`, `.release-please-manifest.json`) declare the bot's behavior — manifest mode tracking only root + `apps/desktop`, linked-versions plugin keeps them in lockstep. A new workflow (`release-please.yml`) runs the bot on every push to `main`, authenticated with a fine-grained PAT (`RELEASE_PLEASE_TOKEN`) so its tag pushes can trigger the existing `release.yml`. One targeted edit to `release.yml` adds `--publish always` so installers actually upload.

**Tech Stack:** GitHub Actions, `googleapis/release-please-action@v4`, `electron-builder` (`--publish always`), Conventional Commits, pnpm monorepo.

**Spec:** `docs/superpowers/specs/2026-05-30-cicd-versioning-design.md`

---

## File Structure

**Created:**
- `release-please-config.json` — repo root. Declares packages (root + `apps/desktop`), strategy (`node`), `bump-minor-pre-major: true`, changelog sections, and the `linked-versions` plugin that keeps the two packages bumping in lockstep.
- `.release-please-manifest.json` — repo root. Initial content `{ ".": "0.3.0", "apps/desktop": "0.3.0" }`. Bot-managed after first run.
- `.github/workflows/release-please.yml` — runs the bot on push to `main` and on manual `workflow_dispatch`. Permissions: `contents: write`, `pull-requests: write`. Uses `RELEASE_PLEASE_TOKEN`.

**Modified:**
- `.github/workflows/release.yml` — add `--publish always` to the `Build installer` step so electron-builder uploads installers + `latest*.yml` files. No other change.
- `.gitignore` (root) — add `apps/desktop/release/` if not already covered. (Check before edit — may already be there.)

**Manual GitHub setup (no commits):**
- Generate fine-grained PAT and add as repo secret `RELEASE_PLEASE_TOKEN`.

**Unchanged (do not edit):**
- `.github/workflows/ci.yml` — already correct, runs typecheck/test/build on all three OSes per PR.
- `apps/desktop/electron-builder.json` — the publish target (`github`, `ecogs-sys/Awakon`) is already set; `--publish always` consumes it.
- All `packages/*/package.json` — internal packages stay at `0.3.0`, outside release-please's scope.
- `apps/desktop/package.json` `version` field — release-please will manage it; do not hand-edit.
- Root `package.json` `version` field — same; release-please will manage it.

---

## Task 1: Add release-please configuration files

**Files:**
- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`

- [ ] **Step 1.1: Create `release-please-config.json` at repo root**

Write `C:\Work\ecogs\projects\Awakon\release-please-config.json` with this exact content:

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

- [ ] **Step 1.2: Validate JSON syntax**

Run: `node -e "JSON.parse(require('fs').readFileSync('release-please-config.json', 'utf8'))"`
Expected: Command exits silently with code 0. Any syntax error prints a line:column and fails.

- [ ] **Step 1.3: Create `.release-please-manifest.json` at repo root**

Write `C:\Work\ecogs\projects\Awakon\.release-please-manifest.json` with this exact content:

```json
{
  ".": "0.3.0",
  "apps/desktop": "0.3.0"
}
```

(Both paths must match the keys in `packages` from Step 1.1 — `.` for root, `apps/desktop` for the desktop app. The version must match the current `version` field in both `package.json` files, which is `0.3.0` today.)

- [ ] **Step 1.4: Validate JSON syntax**

Run: `node -e "JSON.parse(require('fs').readFileSync('.release-please-manifest.json', 'utf8'))"`
Expected: Exits silently with code 0.

- [ ] **Step 1.5: Sanity-check current package versions match the manifest**

Run: `node -e "console.log(require('./package.json').version, require('./apps/desktop/package.json').version)"`
Expected output: `0.3.0 0.3.0`

If either prints something other than `0.3.0`, **stop and resolve**: the manifest must reflect the actual current version of each package or release-please will bump from the wrong baseline. Either update `.release-please-manifest.json` to match reality, or update the `package.json` `version` fields to `0.3.0` (whichever is correct for the project state).

- [ ] **Step 1.6: Commit**

```bash
git add release-please-config.json .release-please-manifest.json
git commit -m "ci: add release-please configuration

Tracks root + apps/desktop in lockstep via the linked-versions plugin.
bump-minor-pre-major lets feat: produce minor bumps while pre-1.0.
Hidden changelog sections keep docs/chore/ci/test/refactor commits
out of release notes but still trigger Release PR refreshes."
```

---

## Task 2: Add `release-please.yml` workflow

**Files:**
- Create: `.github/workflows/release-please.yml`

- [ ] **Step 2.1: Verify the workflows directory exists**

Run: `node -e "console.log(require('fs').existsSync('.github/workflows'))"`
Expected: `true` (the directory holds `ci.yml` and `release.yml` already).

- [ ] **Step 2.2: Create the workflow file**

Write `C:\Work\ecogs\projects\Awakon\.github\workflows\release-please.yml` with this exact content:

```yaml
name: release-please
on:
  push:
    branches: [main]
  # Allow manual triggering for first-run validation and ad-hoc reruns.
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          # PAT (not GITHUB_TOKEN) so the tag push triggers release.yml.
          # See spec § Token model for the anti-loop rule.
          token: ${{ secrets.RELEASE_PLEASE_TOKEN }}
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
```

- [ ] **Step 2.3: Validate YAML syntax**

Run:
```bash
node -e "const fs=require('fs'); const s=fs.readFileSync('.github/workflows/release-please.yml','utf8'); if(s.includes('\t')) { console.error('TABS FORBIDDEN IN YAML'); process.exit(1); } console.log('OK')"
```
Expected: prints `OK`. If it prints `TABS FORBIDDEN IN YAML` the file must use only spaces for indentation — re-create it with spaces.

(There is no `yamllint` or `actionlint` dependency in the repo; the tab check covers the most common breakage. The structural correctness is also implicitly validated by the existing `ci.yml` and `release.yml` files which use the same indentation conventions.)

- [ ] **Step 2.4: Confirm action version is current**

Run: `node -e "const s=require('fs').readFileSync('.github/workflows/release-please.yml','utf8'); console.log(s.match(/release-please-action@v\d+/)[0])"`
Expected: `release-please-action@v4`

(If you ever update this, check the project's GitHub releases — major versions of `release-please-action` have made breaking config changes historically.)

- [ ] **Step 2.5: Commit**

```bash
git add .github/workflows/release-please.yml
git commit -m "ci(release-please): add bot workflow to open Release PRs

Triggers on push to main and via workflow_dispatch. Uses
RELEASE_PLEASE_TOKEN (a fine-grained PAT) instead of GITHUB_TOKEN so
that the tag it pushes will trigger release.yml — GitHub's anti-loop
rule blocks GITHUB_TOKEN-driven workflows from chaining."
```

---

## Task 3: Update `release.yml` to publish artifacts

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 3.1: Read the current `Build installer` step to identify the exact line**

Run: `node -e "process.stdout.write(require('fs').readFileSync('.github/workflows/release.yml','utf8'))"`

You should see, near the end, exactly these two lines (with surrounding 6-space indentation):
```yaml
      - name: Build installer
        run: pnpm --filter @awakon/desktop dist
```

If those lines look different (e.g. there's already a `--publish` flag, or the indentation differs), **stop and reconcile** — the spec was written assuming the current `release.yml` state and your tooling has either been updated independently or the file was edited.

- [ ] **Step 3.2: Edit the `Build installer` step to add `--publish always`**

Open `.github/workflows/release.yml`. Find the line:
```yaml
        run: pnpm --filter @awakon/desktop dist
```
and replace it with:
```yaml
        run: pnpm --filter @awakon/desktop dist -- --publish always
```

The `--` separator between `dist` and `--publish always` is **mandatory** — without it, pnpm consumes `--publish` itself and the flag never reaches the underlying `electron-builder` script. Installers would build but never upload to the GitHub Release.

Leave the surrounding `name:` and `env:` lines unchanged.

- [ ] **Step 3.3: Verify the change**

Run: `node -e "const s=require('fs').readFileSync('.github/workflows/release.yml','utf8'); if(!s.includes('dist -- --publish always')) { console.error('EDIT MISSING OR MISSING -- SEPARATOR'); process.exit(1); } console.log('OK')"`
Expected: prints `OK`. The check looks for the `--` separator explicitly so a missing separator fails loudly.

- [ ] **Step 3.4: Validate YAML still has no tabs**

Run: `node -e "const s=require('fs').readFileSync('.github/workflows/release.yml','utf8'); if(s.includes('\t')) { console.error('TABS FORBIDDEN'); process.exit(1); } console.log('OK')"`
Expected: prints `OK`.

- [ ] **Step 3.5: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): publish installers to GitHub Release via --publish always

electron-builder dist now uploads .exe / .dmg / .AppImage plus
latest.yml / latest-mac.yml / latest-linux.yml to the GitHub Release
created by release-please. GITHUB_TOKEN already has the contents:write
scope at the workflow level so no secret change is needed."
```

---

## Task 4: Pin release artifacts in `.gitignore`

**Files:**
- Modify: `.gitignore` (root)

- [ ] **Step 4.1: Inspect current ignore rules for `release/`**

Run: `node -e "const s=require('fs').readFileSync('.gitignore','utf8'); console.log(s.split('\n').filter(l=>l.includes('release')).join('\n')||'<no release rules>')"`

Three possible outcomes:
- Output includes `apps/desktop/release` or `release/` — **skip to Step 4.4** (already covered, no edit needed).
- Output is `<no release rules>` — proceed to Step 4.2.
- Output shows something narrower (e.g. `release/0.3.0` only) — proceed to Step 4.2 and tighten it.

- [ ] **Step 4.2: Append the ignore rule**

Open `.gitignore` and append (preserving existing content):

```
# electron-builder output (versioned dirs under apps/desktop/release/)
apps/desktop/release/
```

- [ ] **Step 4.3: Verify**

Run: `node -e "const s=require('fs').readFileSync('.gitignore','utf8'); if(!s.includes('apps/desktop/release/')) { console.error('RULE MISSING'); process.exit(1); } console.log('OK')"`
Expected: prints `OK`.

- [ ] **Step 4.4: Confirm `git status` is clean of release artifacts**

Run: `git status --short apps/desktop/release/`
Expected: empty output. If the command prints any `?? apps/desktop/release/...` entries those files are untracked but no longer staged for accidental inclusion; that's fine — `.gitignore` will prevent future tracking.

- [ ] **Step 4.5: Commit (only if Step 4.2 ran)**

If Step 4.1 reported `<no release rules>` or you tightened a narrower rule:

```bash
git add .gitignore
git commit -m "chore: ignore electron-builder output dir

apps/desktop/release/<version>/ is generated by 'pnpm --filter
@awakon/desktop dist' and should never be committed. CI uploads
installers directly to GitHub Releases via release.yml; the local
dir is dev-only artifact."
```

If Step 4.1 found the rule was already present, skip the commit and note "no .gitignore change needed" in the PR description.

---

## Task 5: Generate `RELEASE_PLEASE_TOKEN` and add to repo secrets

This task is **manual** — it happens in the GitHub web UI, not in code. There are no commits. Run these steps before merging the PR to `main`, otherwise the first `release-please.yml` run will fail.

- [ ] **Step 5.1: Generate a fine-grained PAT**

Open: https://github.com/settings/personal-access-tokens/new

Fill in:
- **Token name:** `Awakon release-please bot`
- **Resource owner:** `ecogs-sys`
- **Expiration:** 1 year (the maximum for fine-grained PATs). Set a calendar reminder for ~11 months out to renew (see spec § Operations).
- **Description:** "Lets the release-please workflow push tags that trigger release.yml. Required because GITHUB_TOKEN cannot trigger chained workflows."
- **Repository access:** _Only select repositories_ → choose `ecogs-sys/Awakon`.
- **Repository permissions:** set exactly these three (leave everything else as "No access"):
  - **Contents:** Read and write
  - **Pull requests:** Read and write
  - **Metadata:** Read-only (auto-set when you grant Contents)

Click **Generate token**. Copy the token (`github_pat_…`) — you will not be able to see it again after leaving the page.

- [ ] **Step 5.2: Add the token as a repo secret**

Open: https://github.com/ecogs-sys/Awakon/settings/secrets/actions

Click **New repository secret**.
- **Name:** `RELEASE_PLEASE_TOKEN` (exact spelling — matches the workflow reference).
- **Secret:** paste the `github_pat_…` value from Step 5.1.

Click **Add secret**.

- [ ] **Step 5.3: Confirm the secret is listed**

Reload https://github.com/ecogs-sys/Awakon/settings/secrets/actions.
Expected: `RELEASE_PLEASE_TOKEN` appears in the **Repository secrets** list. (You can't view the value; only confirm presence.)

- [ ] **Step 5.4: Sanity-check no other secret of that name exists at the org level**

Same page, scroll to **Organization secrets**. If `RELEASE_PLEASE_TOKEN` is also defined at the org level, the repo-level one wins per GitHub's precedence rules — but make a note in the PR description so it's not confusing later.

---

## Task 6: Open PR and merge to `main`

**Files:** none changed in this task.

- [ ] **Step 6.1: Verify all four code commits are present on the current branch**

Run: `git log --oneline origin/main..HEAD`
Expected: between 1 and 4 commits, depending on whether Task 4's `.gitignore` commit ran:
```
<hash> chore: ignore electron-builder output dir       (only if Task 4 ran)
<hash> ci(release): publish installers to GitHub Release via --publish always
<hash> ci(release-please): add bot workflow to open Release PRs
<hash> ci: add release-please configuration
```

(There may also be commits from the brainstorming/planning phase if you're branching off `docs/cicd-versioning-spec`. Those should ride along on the same PR.)

- [ ] **Step 6.2: Push the branch**

Run: `git push -u origin HEAD`
Expected: success, with a `Create a pull request for ...` URL printed.

- [ ] **Step 6.3: Open the PR**

Run (replacing branch name if different):
```bash
gh pr create --base main --title "ci: introduce release-please for automated versioning + releases" --body "$(cat <<'EOF'
## Summary

Implements `docs/superpowers/specs/2026-05-30-cicd-versioning-design.md`.

Adds `release-please` so merging Conventional Commit PRs auto-opens a Release PR; merging that ships installers via the existing `release.yml`.

**New files:** `release-please-config.json`, `.release-please-manifest.json`, `.github/workflows/release-please.yml`
**Edited:** `.github/workflows/release.yml` — adds `--publish always` so installers actually upload. `.gitignore` — pins `apps/desktop/release/`.
**Manual setup:** `RELEASE_PLEASE_TOKEN` secret created on repo (see spec § Token model).

## Test plan

- [ ] `release-please.yml` triggers on push to main after merge.
- [ ] First run opens a "chore: release X.Y.Z" PR. Inspect the diff: should bump both package.json files, create CHANGELOG.md + apps/desktop/CHANGELOG.md, update .release-please-manifest.json.
- [ ] Merging the Release PR pushes the v* tag (proves `RELEASE_PLEASE_TOKEN` works around the anti-loop rule).
- [ ] Tag push triggers release.yml; resulting GitHub Release has all six expected assets: \`.exe\`, \`.dmg\`, \`.AppImage\`, \`latest.yml\`, \`latest-mac.yml\`, \`latest-linux.yml\`.
- [ ] Previously-installed app offers the update via electron-updater within ~1 min of the Release being published.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Expected: prints the PR URL.

- [ ] **Step 6.4: Verify CI runs green on the PR**

Visit the PR URL. The `CI` workflow should run on `ubuntu-latest`, `windows-latest`, `macos-latest`. All three must be green before merging. (The workflow files added in this PR are not consumed by `ci.yml`, so CI should behave identically to any other PR.)

- [ ] **Step 6.5: Merge the PR**

Either merge via the GitHub UI or:
```bash
gh pr merge --merge --delete-branch
```

**Do not squash.** Squash-merging via the GitHub UI rewrites the commit subjects into a single one — release-please reads individual commit subjects to compute the version bump, so squashing would lose the `ci:` / `chore:` types we used here. Use **merge** (creates a merge commit preserving history) or **rebase** (linear history, individual commits preserved). The repo's prior PRs used merge commits (e.g. `89f77c0 Merge pull request #4`); stay consistent.

---

## Task 7: First end-to-end release smoke test

This is the validation run that proves everything wires together. Do this with attention — if it fails midway, you have visibility into which step broke.

**Files:** none changed in this task. The "test" is the live system.

- [ ] **Step 7.1: Confirm `release-please.yml` ran successfully on the merge commit**

Open: https://github.com/ecogs-sys/Awakon/actions/workflows/release-please.yml

Expected: the most recent run (triggered by Task 6's merge to main) is green. Click into it; the action log should report something like `🔖 release: created 1 release` or `📦 created or updated release PR: <PR number>`.

If the run failed:
- **`Error: Resource not accessible by integration`** → the `RELEASE_PLEASE_TOKEN` is missing, mis-scoped, or expired. Recheck Task 5.
- **`No releases necessary`** → no commits matched `feat:` / `fix:` / `perf:` since the manifest version. Push a `fix:` commit (Step 7.3 below) to force a Release PR.
- **Anything else** → read the log; fix; re-run via `workflow_dispatch` from the Actions UI.

- [ ] **Step 7.2: Verify a Release PR was opened**

Open: https://github.com/ecogs-sys/Awakon/pulls?q=is%3Apr+is%3Aopen+author%3Aapp%2Fgithub-actions

Expected: a PR titled "chore(main): release X.Y.Z" (where X.Y.Z is `0.4.0` given existing `feat:` commits + `bump-minor-pre-major: true`).

If no PR appeared but the workflow ran green, the most likely cause is "no version-affecting commits since manifest version." Proceed to Step 7.3.

- [ ] **Step 7.3: (If no Release PR appeared) Push a no-op `fix:` commit to force one**

Skip this step if Step 7.2 already showed a Release PR.

Pick any tiny, safe edit — e.g. add a trailing newline to the root `README.md`. Then:
```bash
git checkout main && git pull
# make the trivial edit
git add README.md
git commit -m "fix(docs): ensure README ends with newline"
git push origin main
```

Wait ~1 min and re-check Step 7.2.

- [ ] **Step 7.4: Inspect the Release PR diff**

Open the Release PR. The diff should be exactly:
- `package.json` — `"version": "0.3.0"` → `"version": "0.4.0"` (or whatever the computed bump is)
- `apps/desktop/package.json` — same bump
- `CHANGELOG.md` — newly created, contains a `## [0.4.0]` heading and bulleted `feat:` / `fix:` entries from history
- `apps/desktop/CHANGELOG.md` — same content as root CHANGELOG (linked-versions plugin)
- `.release-please-manifest.json` — `"."` and `"apps/desktop"` both updated to the new version

If the diff is different — e.g. internal packages (`packages/core` etc.) get bumped, or only one of root/desktop is bumped — **stop and fix the config**. The `linked-versions` plugin or the `packages` block is misconfigured. Re-check Task 1's config against the spec.

- [ ] **Step 7.5: Merge the Release PR**

Use **merge** (not squash, not rebase) — same reasoning as Step 6.5. Merging triggers release-please to push the `v0.4.0` tag.

```bash
gh pr merge <release-pr-number> --merge
```

- [ ] **Step 7.6: Confirm the tag was pushed**

Run: `git fetch --tags && git tag --list "v*"`
Expected: includes `v0.4.0` (or whatever version was cut).

If no `v*` tag appears after ~30 seconds, the tag push step failed. Check the latest `release-please.yml` run log on GitHub. The most common cause is a `RELEASE_PLEASE_TOKEN` that's missing `contents: write` on this repo — re-do Step 5.1's permissions exactly.

- [ ] **Step 7.7: Confirm `release.yml` fired on the tag**

Open: https://github.com/ecogs-sys/Awakon/actions/workflows/release.yml

Expected: a run named after the `v0.4.0` tag is currently in progress or already complete, with the three OS matrix legs visible.

**If no run appears**, the anti-loop rule is biting — release-please pushed the tag using `GITHUB_TOKEN` somehow. Re-check Task 2's `release-please.yml` for the `token: ${{ secrets.RELEASE_PLEASE_TOKEN }}` line. The fix is to update the workflow and push a manual `v0.4.1` patch to retest.

- [ ] **Step 7.8: Wait for `release.yml` to finish (≈10–15 min for all three OSes)**

All three matrix legs must turn green. If any fails, click in:
- **`ENOENT … snapStore` or `ERR_PNPM_BAD_PM_VERSION`** → reconcile against the existing `ci.yml` setup; the `release.yml` was working previously, so any new failure is environmental drift.
- **`401 Unauthorized` from electron-builder uploads** → the auto-provisioned `GITHUB_TOKEN` lost `contents: write`. Check repo Settings → Actions → General → Workflow permissions.

- [ ] **Step 7.9: Verify the GitHub Release assets**

Open: https://github.com/ecogs-sys/Awakon/releases/tag/v0.4.0

Expected six assets attached:
- `Awakon-Setup-0.4.0.exe` (Windows installer)
- `Awakon-0.4.0.dmg` (macOS installer)
- `Awakon-0.4.0.AppImage` (Linux installer)
- `latest.yml`           (electron-updater feed for Windows)
- `latest-mac.yml`       (feed for macOS)
- `latest-linux.yml`     (feed for Linux)

(Exact filenames depend on electron-builder's defaults + the `productName` in `electron-builder.json` which is `Awakon`; the count is the canonical check.)

If `latest*.yml` files are missing, the `--publish always` flag from Task 3 didn't take effect — re-check the diff to `release.yml`.

- [ ] **Step 7.10: Optional — verify auto-update end-to-end**

If you have a previously-built `0.3.0` installer (e.g. from `apps/desktop/release/0.3.0/`), install it on a real machine, launch it, and confirm the in-app updater UI detects and offers `v0.4.0` within ~1 minute. On Windows + Linux this should work transparently. **On macOS, expect the update to download but then fail to launch the new app due to lack of notarization** — this is the known limitation called out in the spec; document it as expected and not a bug to fix in this plan.

- [ ] **Step 7.11: Done. Document the successful first release.**

In the original PR (from Task 6), post a comment summarizing what shipped:
```
First release-please-driven release: v0.4.0 — see https://github.com/ecogs-sys/Awakon/releases/tag/v0.4.0
All 6 expected assets present. Windows + Linux auto-update verified end-to-end.
macOS auto-update unverified (notarization deferred per spec § Known limitations).
```

The system is now self-driving. Subsequent releases require nothing more than merging Conventional Commit PRs and then merging the bot's Release PR when ready.

---

## Self-review notes (run by plan author)

- ✅ **Spec coverage:** Tasks 1–4 implement the spec's *Files added* + *Files changed* sections in full. Task 5 covers *Token model*. Tasks 6–7 cover the *Testing strategy* observational checks. *Operations* PAT-renewal calendar reminder is called out in Task 5.1.
- ✅ **No placeholders:** all file contents are spelled out, all commands have exact strings, all expected outputs are stated.
- ✅ **Type consistency:** secret name `RELEASE_PLEASE_TOKEN` is identical in Task 2 (workflow reference) and Task 5 (UI step). Manifest paths `.` and `apps/desktop` are identical in Task 1.1 (config), Task 1.3 (manifest), and Task 7.4 (diff check). Package names `awakon` and `@awakon/desktop` are identical in config + linked-versions components.
- ✅ **Sequencing:** Task 5 (manual secret creation) is explicitly required *before* merging the PR (Task 6.5), which is required *before* the first release-please run (Task 7).
