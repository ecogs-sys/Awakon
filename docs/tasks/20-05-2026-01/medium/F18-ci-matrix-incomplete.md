# F18 — CI does not build the desktop app on Windows/macOS

**Severity:** Medium
**Status:** Fixed (commit `fix(F18)`)

## Files
- `.github/workflows/ci.yml`

## Problem
`ci.yml` runs `pnpm test` on all three OSes but only builds the desktop app and runs
E2E on Linux. Spec §8: "E2E on Linux per PR + one rotating other OS per PR; full
matrix on `main`."

## Impact
Windows/macOS desktop build + E2E regressions are not caught until release.

## Fix approach
Add a `pnpm --filter @awakon/desktop build` step on all OSes (catches packaging-time
breakage). Run E2E on `main` pushes for all OSes (gate the E2E step on
`github.event_name == 'push'` for non-Linux).

## Test plan
- Workflow lint / review; verified on next CI run.
