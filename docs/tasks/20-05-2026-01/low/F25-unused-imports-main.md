# F25 — Unused / redundant imports in main

**Severity:** Low
**Status:** Verified clean — no action needed

## Resolution
A full `pnpm lint` pass (eslint `@typescript-eslint/no-unused-vars`) reports **no
unused-import errors** in `apps/desktop/src/main/index.ts` or anywhere else — every
import is used (the audit-fix work added consumers for the borderline ones). The
`IpcChannel` re-export from `@awakon/core` is genuinely used by main.

Note: `pnpm lint` does surface 7 pre-existing errors in `packages/core`
(`no-unsafe-declaration-merging` on the typed-EventEmitter pattern, one
`no-useless-escape` in a regex). These pre-date this audit, are not among F1–F28,
and are left untouched.

## Files
- `apps/desktop/src/main/index.ts:1-11`

## Problem
Several imported symbols are only partially used; `IpcChannel` is re-exported from
`@awakon/core` purely for main's convenience. Minor clutter.

## Impact
Cosmetic; ESLint `no-unused-vars` may or may not flag depending on usage.

## Fix approach
Run a pass with `pnpm lint` / `tsc` and drop genuinely unused imports. Re-verify
after the critical/high fixes (which add imports) so this is done last.

## Test plan
- `pnpm lint` / `pnpm typecheck` clean.
