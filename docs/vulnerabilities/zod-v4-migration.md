# zod v3 → v4 Migration (separate from the rest of the remediation)

## Why this is split out

Every other package in [`remediation-plan.md`](remediation-plan.md) has a patched release inside
(or one safe major bump from) its current line. `zod` doesn't: the advisory

> Zod can exhaust memory while validating oversized constrained collections

has `patched_versions: >=4.6.6` and nothing in the `3.x` line — zod 3 never got a backport. The
only fix is the major version. Unlike the `vite`/`vitest` bump in Phase 2, this one touches
application code directly, so it's tracked as its own task rather than folded into the
mechanical version-bump phases.

## Blast radius

```
packages/contracts/src/ipc.ts          (98 schema call sites)
packages/contracts/src/persistence.ts  (21)
packages/contracts/src/session.ts      (20)
packages/contracts/src/settings.ts     (8)
packages/contracts/src/recent.ts       (4)
```

Both `packages/core` and `apps/desktop` depend on `@awakon/contracts`, so every IPC message,
persisted-settings shape, and session-recovery payload in the app is validated through these
schemas. Consumption pattern in `packages/core/src/ipc-router.ts` is uniform — ~19 call sites, all
`const parsed = Schema.safeParse(input); if (!parsed.success) return { error: parsed.error.message };`
— so the generic case is low-risk. The specific things worth checking by hand:

### 1. `z.string().url()` — `packages/contracts/src/ipc.ts:212`
```ts
url: z.string().url().refine(isHttpUrl, { message: 'only http(s) URLs may be opened externally' }),
```
This is the schema that gates which URLs the app will hand to the OS to open externally — a
security boundary, not just a shape check. Zod v4 replaced the URL validator's internals (prefers
the top-level `z.url()` form, and the accepted/rejected URL set changed in several releases
between v4.0 and v4.6+). Action: after migrating, feed both known-good `http(s)://` URLs and
known-bad ones (`javascript:`, `file:`, malformed hosts) through this schema in a test and confirm
`isHttpUrl`'s behavior is unchanged — don't assume the outer `.url()` call still rejects the same
things it did under v3.

### 2. `.default(...)` combined with `.nullable()` — `session.ts:44`, `settings.ts:14/25/30/43/44`
```ts
foregroundCommand: z.string().nullable().default(null),
```
Default-handling for optional/nullable fields had edge-case changes across v4 minor releases.
Action: round-trip the full `SettingsSchema` and `SessionSchema` through `safeParse` with a
partially-populated object (simulating an older persisted-settings file missing newer fields) and
confirm the same defaults come back.

### 3. Error surface — `ipc-router.ts` (~19 sites)
Every call site reads `parsed.error.message` on failure. `ZodError.message` still exists in v4,
but the formatted string it produces changed. Nothing here breaks at compile time, but if any UI
surfaces these messages to the user verbatim, expect the wording to change — not a functional bug,
just worth a glance.

## Suggested approach

1. Bump `zod` to `^4.6.7` (or current latest `4.x`) in `packages/core/package.json` and
   `packages/contracts/package.json` — both currently pin `^3.25.76`.
2. `pnpm install`, then `pnpm -r typecheck` — zod v4's type inference is close to v3's but not
   identical; expect some `.infer<>` or generic call sites to need adjustment, especially around
   discriminated unions if any appear in `ipc.ts`'s 98 schema definitions.
3. Run the existing test suite (`pnpm --filter @awakon/contracts test`, `pnpm --filter @awakon/core test`
   if present) plus the three manual checks above (URL gate, settings round-trip, error message
   spot-check).
4. Smoke-test the packaged app per the `run` skill: change a setting, restart, confirm it
   persisted; open an external link from a terminal session; recover a session after a crash
   (exercises `session.ts` schemas).

## Do not bundle this with Phase 1–4

The other phases are pure version bumps with no application-code changes expected. This one is
a real migration with a security-relevant validator in scope (#1 above) — give it its own PR and
review pass rather than letting it ride along with the mechanical dependency bumps.
