# Dependency Vulnerability Remediation

Audit source: `pnpm audit --json` (this repo uses pnpm, not npm — `npm audit` fails with
`ENOLOCK` because there is no `package-lock.json`, only `pnpm-lock.yaml`).

Snapshot taken 2026-11-28, 752 resolved dependencies:

| Severity | Count |
|---|---|
| Critical | 4 |
| High | 86 |
| Moderate | 88 |
| Low | 28 |
| **Total advisories** | **186** |

186 advisories collapse to **29 distinct vulnerable packages**. Most of the volume is a small
number of packages with many CVEs each (`electron` alone accounts for 58 advisories, `undici`
for 34) — fixing the package fixes every advisory under it.

## Documents

- [`remediation-plan.md`](remediation-plan.md) — phased, actionable plan covering 28 of the 29
  packages. Ordered by risk/effort so the safe fixes land first.
- [`zod-v4-migration.md`](zod-v4-migration.md) — the one package (`zod`) that has no in-range
  patched version and needs a deliberate major-version migration, tracked separately so it
  doesn't block the rest of the cleanup.

## Re-running the audit

```sh
pnpm audit --json > audit.json   # full machine-readable report
pnpm audit                       # human-readable summary
pnpm why <package>                # see every path that pulls in a given package
```

After applying any phase below: `pnpm install` to refresh the lockfile, then re-run `pnpm audit`
to confirm the targeted advisories are gone before moving to the next phase.

## Ground rule used throughout this plan

Prefer the smallest version bump that reaches a patched release. Jump to the newest major only
when no patched version exists inside the current major (this was true for `vite`, `vitest`, and
`zod`). This keeps blast radius proportional to the actual security benefit.
