# Split-Layout Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each tab's split-pane tree (orientation + ratios) to `sessions.json` and restore it on relaunch so splits survive app restarts.

**Architecture:** `SplitContainer` (renderer, one per tab) stays the authoritative tree owner. After every structural change or divider drag-end it serializes the tree and sends it to main over a new IPC channel. Main stores the tree on `tabMeta` and writes it via the existing `SessionStore` atomic-write path. On bootstrap, main passes the stored tree to the terminal renderer, which replays it by reusing `splitFocused()`. Schema bumps from v1 to v2 with a silent in-place migration.

**Tech Stack:** TypeScript, Zod, Electron (main + renderer), Vitest (+ jsdom for renderer tests). Workspace packages: `@awakon/contracts`, `@awakon/core`, `@awakon/desktop`.

**Spec:** `docs/superpowers/specs/2026-05-27-split-layout-persistence-design.md`

---

## File map

**New files** — none.

**Modified files:**

- `packages/contracts/src/persistence.ts` — add `PersistedSplitNode` recursive schema, add optional `splits` to `PersistedTab`, bump `PERSISTENCE_SCHEMA_VERSION` to `2`, export `migratePersistedTabs(parsed: unknown): unknown | null`.
- `packages/contracts/src/ipc.ts` — add `LayoutPersistSplits` and `LayoutSplitsForTab` channels and their payload schemas.
- `packages/core/src/session-store.ts` — run `migratePersistedTabs` before schema validation in `load()`.
- `packages/core/src/ipc-router.ts` — add `onPersistSplits` / `onSplitsForTab` callback registration + handlers.
- `packages/core/tests/session-store.test.ts` — bump samples to v2, add v1 migration test, add v2-with-splits round-trip test.
- `packages/core/tests/persistence-migration.test.ts` (new) — focused tests for the migration helper + `PersistedSplitNodeSchema` validation. *(Placed in `core/tests` because `contracts` has no Vitest setup; core already imports from `@awakon/contracts`.)*
- `apps/desktop/src/main/index.ts` — extend inline `tabMeta` type with `splits?`, register the new IPC handlers, pass `splits` into `tabMeta` on bootstrap, bump literal `1` to `2` in `snapshotTabs()`.
- `apps/desktop/src/main/session-bootstrap.ts` — pass `splits` from each persisted tab into `createTabSession`.
- `apps/desktop/src/renderer/terminal/split-container.ts` — add `serialize()` and `restore()`; call a new `persist()` helper from `splitFocused()`, `closeFocusedPane()`, and the divider `mouseup` handler; on construction, fetch the saved tree over IPC and call `restore()` if present.
- `apps/desktop/src/renderer/terminal/split-container.test.ts` — serialize/restore round-trip tests.

---

## Task 1: Add `PersistedSplitNode` schema + bump version + migration helper

**Files:**
- Modify: `packages/contracts/src/persistence.ts`
- Test: `packages/core/tests/persistence-migration.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `packages/core/tests/persistence-migration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  PersistedSplitNodeSchema,
  PersistedTabsSchema,
  migratePersistedTabs,
  PERSISTENCE_SCHEMA_VERSION,
} from '@awakon/contracts';

describe('PERSISTENCE_SCHEMA_VERSION', () => {
  it('is 2', () => {
    expect(PERSISTENCE_SCHEMA_VERSION).toBe(2);
  });
});

describe('PersistedSplitNodeSchema', () => {
  it('accepts a leaf', () => {
    expect(PersistedSplitNodeSchema.safeParse({ kind: 'leaf' }).success).toBe(true);
  });

  it('accepts a single horizontal branch', () => {
    const tree = {
      kind: 'branch' as const,
      orientation: 'horizontal' as const,
      ratio: 0.5,
      a: { kind: 'leaf' as const },
      b: { kind: 'leaf' as const },
    };
    expect(PersistedSplitNodeSchema.safeParse(tree).success).toBe(true);
  });

  it('accepts a deeply nested tree', () => {
    const tree = {
      kind: 'branch',
      orientation: 'vertical',
      ratio: 0.3,
      a: {
        kind: 'branch',
        orientation: 'horizontal',
        ratio: 0.7,
        a: { kind: 'leaf' },
        b: { kind: 'leaf' },
      },
      b: { kind: 'leaf' },
    };
    expect(PersistedSplitNodeSchema.safeParse(tree).success).toBe(true);
  });

  it('accepts ratio at the lower bound', () => {
    const tree = { kind: 'branch', orientation: 'horizontal', ratio: 0.1, a: { kind: 'leaf' }, b: { kind: 'leaf' } };
    expect(PersistedSplitNodeSchema.safeParse(tree).success).toBe(true);
  });

  it('accepts ratio at the upper bound', () => {
    const tree = { kind: 'branch', orientation: 'horizontal', ratio: 0.9, a: { kind: 'leaf' }, b: { kind: 'leaf' } };
    expect(PersistedSplitNodeSchema.safeParse(tree).success).toBe(true);
  });

  it('rejects ratio < 0.1', () => {
    const tree = { kind: 'branch', orientation: 'horizontal', ratio: 0.05, a: { kind: 'leaf' }, b: { kind: 'leaf' } };
    expect(PersistedSplitNodeSchema.safeParse(tree).success).toBe(false);
  });

  it('rejects ratio > 0.9', () => {
    const tree = { kind: 'branch', orientation: 'horizontal', ratio: 0.95, a: { kind: 'leaf' }, b: { kind: 'leaf' } };
    expect(PersistedSplitNodeSchema.safeParse(tree).success).toBe(false);
  });

  it('rejects an unknown orientation', () => {
    const tree = { kind: 'branch', orientation: 'diagonal', ratio: 0.5, a: { kind: 'leaf' }, b: { kind: 'leaf' } };
    expect(PersistedSplitNodeSchema.safeParse(tree).success).toBe(false);
  });

  it('rejects a branch missing the b side', () => {
    const tree = { kind: 'branch', orientation: 'horizontal', ratio: 0.5, a: { kind: 'leaf' } };
    expect(PersistedSplitNodeSchema.safeParse(tree).success).toBe(false);
  });
});

describe('migratePersistedTabs', () => {
  it('upgrades a valid v1 payload to v2 with undefined splits', () => {
    const v1 = {
      version: 1,
      tabs: [
        { tabId: 't1', shell: 'pwsh', cwd: 'C:\\Users\\me', title: 'First' },
        { tabId: 't2', shell: 'bash', cwd: '/home/me' },
      ],
      focusedTabId: 't1',
    };
    const migrated = migratePersistedTabs(v1);
    expect(migrated).not.toBeNull();
    const parsed = PersistedTabsSchema.safeParse(migrated);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.version).toBe(2);
      expect(parsed.data.tabs[0]!.splits).toBeUndefined();
      expect(parsed.data.tabs[1]!.splits).toBeUndefined();
    }
  });

  it('passes through a valid v2 payload unchanged', () => {
    const v2 = {
      version: 2,
      tabs: [
        {
          tabId: 't1', shell: 'pwsh', cwd: '/x',
          splits: {
            kind: 'branch', orientation: 'horizontal', ratio: 0.6,
            a: { kind: 'leaf' }, b: { kind: 'leaf' },
          },
        },
      ],
      focusedTabId: 't1',
    };
    const migrated = migratePersistedTabs(v2);
    expect(migrated).toEqual(v2);
    expect(PersistedTabsSchema.safeParse(migrated).success).toBe(true);
  });

  it('returns null for an object with no version', () => {
    expect(migratePersistedTabs({ tabs: [], focusedTabId: null })).toBeNull();
  });

  it('returns null for an unknown version', () => {
    expect(migratePersistedTabs({ version: 3, tabs: [], focusedTabId: null })).toBeNull();
  });

  it('returns null for non-object inputs', () => {
    expect(migratePersistedTabs(null)).toBeNull();
    expect(migratePersistedTabs('hello')).toBeNull();
    expect(migratePersistedTabs(42)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm --filter @awakon/core test -- persistence-migration
```

Expected: FAIL — `migratePersistedTabs is not exported`, `PERSISTENCE_SCHEMA_VERSION` is 1 not 2.

- [ ] **Step 3: Implement the schema + migration**

Replace the contents of `packages/contracts/src/persistence.ts` with:

```ts
import { z } from 'zod';
import { ShellSchema } from './session.js';

export const PERSISTENCE_SCHEMA_VERSION = 2;

export type PersistedSplitNode =
  | { kind: 'leaf' }
  | {
      kind: 'branch';
      orientation: 'horizontal' | 'vertical';
      ratio: number;
      a: PersistedSplitNode;
      b: PersistedSplitNode;
    };

export const PersistedSplitNodeSchema: z.ZodType<PersistedSplitNode> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('leaf') }),
    z.object({
      kind: z.literal('branch'),
      orientation: z.enum(['horizontal', 'vertical']),
      ratio: z.number().min(0.1).max(0.9),
      a: PersistedSplitNodeSchema,
      b: PersistedSplitNodeSchema,
    }),
  ]),
);

export const PersistedTabSchema = z.object({
  tabId: z.string().min(1),
  shell: ShellSchema,
  cwd: z.string().min(1),
  title: z.string().optional(),
  splits: PersistedSplitNodeSchema.optional(),
});
export type PersistedTab = z.infer<typeof PersistedTabSchema>;

export const PersistedTabsSchema = z.object({
  version: z.literal(PERSISTENCE_SCHEMA_VERSION),
  tabs: z.array(PersistedTabSchema),
  focusedTabId: z.string().nullable(),
});
export type PersistedTabs = z.infer<typeof PersistedTabsSchema>;

/**
 * Migrate an unknown payload read from disk into the current schema's shape, *before*
 * `PersistedTabsSchema.safeParse` validates it. Returns the (possibly mutated) payload
 * on success, or null if the version is missing/unknown — in which case callers should
 * treat the file as broken and fall back to a fresh start.
 *
 * v1 -> v2: stamp `version: 2`; leave `splits` undefined on every tab.
 */
export function migratePersistedTabs(parsed: unknown): unknown | null {
  if (parsed === null || typeof parsed !== 'object') return null;
  const obj = parsed as { version?: unknown };
  if (obj.version === 1) {
    return { ...obj, version: 2 };
  }
  if (obj.version === 2) return obj;
  return null;
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
pnpm --filter @awakon/core test -- persistence-migration
```

Expected: PASS, all assertions green.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/persistence.ts packages/core/tests/persistence-migration.test.ts
git commit -m "feat(contracts): add PersistedSplitNode schema and v1->v2 migration"
```

---

## Task 2: Wire `SessionStore.load()` to run the migration

**Files:**
- Modify: `packages/core/src/session-store.ts`
- Test: `packages/core/tests/session-store.test.ts`

- [ ] **Step 1: Update the existing sample fixture and add new tests**

In `packages/core/tests/session-store.test.ts`, update the `sample` constant and add three new tests. Replace the existing `sample` declaration at the top (it currently uses `version: 1`):

```ts
const sample: PersistedTabs = {
  version: 2,
  tabs: [
    { tabId: 't1', shell: 'pwsh', cwd: 'C:\\Users\\me', title: 'First' },
    { tabId: 't2', shell: 'bash', cwd: '/home/me' },
  ],
  focusedTabId: 't1',
};
```

Update the `'overwrites existing file on subsequent save'` test's `next` literal to use `version: 2`:

```ts
const next: PersistedTabs = { version: 2, tabs: [], focusedTabId: null };
```

Update the `'serializes JSON with stable shape ...'` test to expect `parsed.version === 2`:

```ts
expect(parsed.version).toBe(2);
```

Update the `'returns null and backs up when schema does not match'` test — its current input `{ version: 99 }` still belongs to the rejection path (now via `migratePersistedTabs` returning `null`). No body change needed.

Append three new tests inside the `describe('SessionStore', ...)` block:

```ts
it('migrates a v1 file in memory and writes it back as v2', async () => {
  const v1Payload = {
    version: 1,
    tabs: [{ tabId: 't1', shell: 'pwsh', cwd: 'C:\\Users\\me', title: 'First' }],
    focusedTabId: 't1',
  };
  writeFileSync(join(dir, 'sessions.json'), JSON.stringify(v1Payload));
  const store = new SessionStore(dir);
  const loaded = await store.load();
  expect(loaded?.version).toBe(2);
  expect(loaded?.tabs[0]?.splits).toBeUndefined();
});

it('round-trips a v2 payload that contains a split tree', async () => {
  const withSplits: PersistedTabs = {
    version: 2,
    tabs: [
      {
        tabId: 't1',
        shell: 'pwsh',
        cwd: 'C:\\Users\\me',
        splits: {
          kind: 'branch',
          orientation: 'horizontal',
          ratio: 0.6,
          a: { kind: 'leaf' },
          b: {
            kind: 'branch',
            orientation: 'vertical',
            ratio: 0.4,
            a: { kind: 'leaf' },
            b: { kind: 'leaf' },
          },
        },
      },
    ],
    focusedTabId: 't1',
  };
  const store = new SessionStore(dir);
  await store.save(withSplits);
  expect(await store.load()).toEqual(withSplits);
});

it('backs up a v2 file whose ratio is out of range', async () => {
  const bad = {
    version: 2,
    tabs: [{
      tabId: 't1', shell: 'pwsh', cwd: '/x',
      splits: { kind: 'branch', orientation: 'horizontal', ratio: 1.5, a: { kind: 'leaf' }, b: { kind: 'leaf' } },
    }],
    focusedTabId: 't1',
  };
  writeFileSync(join(dir, 'sessions.json'), JSON.stringify(bad));
  const store = new SessionStore(dir);
  expect(await store.load()).toBeNull();
  const broken = readdirSync(dir).filter((f) => f.startsWith('sessions.json.broken-'));
  expect(broken).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests and verify they fail**

```bash
pnpm --filter @awakon/core test -- session-store
```

Expected: FAIL — `loaded?.version` is `1` not `2` (migration not yet wired), and the existing `sample` is rejected because the schema now requires `version: 2`.

- [ ] **Step 3: Wire the migration into `SessionStore.load()`**

In `packages/core/src/session-store.ts`, update the import and the `load()` method:

```ts
import { PersistedTabsSchema, migratePersistedTabs, type PersistedTabs } from '@awakon/contracts';
```

Replace the `load()` method body so it runs migration before validation:

```ts
async load(): Promise<PersistedTabs | null> {
  const path = join(this.dir, FILE_NAME);
  let raw: string;
  try {
    raw = await fs.readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await this.backup(path);
    return null;
  }
  const migrated = migratePersistedTabs(parsed);
  if (migrated === null) {
    await this.backup(path);
    return null;
  }
  const result = PersistedTabsSchema.safeParse(migrated);
  if (!result.success) {
    await this.backup(path);
    return null;
  }
  return result.data;
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
pnpm --filter @awakon/core test -- session-store
```

Expected: PASS — all `session-store` tests green, including the three new ones.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session-store.ts packages/core/tests/session-store.test.ts
git commit -m "feat(core): run migratePersistedTabs in SessionStore.load and bump samples to v2"
```

---

## Task 3: Add IPC channels and payload schemas

**Files:**
- Modify: `packages/contracts/src/ipc.ts`

- [ ] **Step 1: Add the channel names and schemas**

In `packages/contracts/src/ipc.ts`:

(a) Add the import (or extend the existing one) so this file can reference the split-node schema:

```ts
import { PersistedSplitNodeSchema } from './persistence.js';
```

(b) Inside the `IpcChannel` object, add the two new request channels next to the other `LayoutReorderTabs` entry (preserving the existing `as const`):

```ts
  LayoutPersistSplits: 'core.layout.persist-splits',
  LayoutSplitsForTab: 'core.layout.splits-for-tab',
```

(c) After `LayoutReorderTabsPayloadSchema`, append:

```ts
/** Renderer reports a tab's serialized split tree so main can persist it.
 * `splits: null` means the tab is back to a single pane and the field should be cleared. */
export const LayoutPersistSplitsPayloadSchema = z.object({
  tabId: SessionIdSchema,
  splits: PersistedSplitNodeSchema.nullable(),
});

/** Renderer asks main for the saved split tree for its tab (called once on startup).
 * Main returns `null` when there is no saved tree. */
export const LayoutSplitsForTabPayloadSchema = z.object({
  tabId: SessionIdSchema,
});
```

(There is no test for this task on its own — schemas are exercised by Tasks 4 and 5.)

- [ ] **Step 2: Typecheck the contracts package**

```bash
pnpm --filter @awakon/contracts typecheck
```

Expected: PASS — no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/src/ipc.ts
git commit -m "feat(contracts): add LayoutPersistSplits and LayoutSplitsForTab IPC channels"
```

---

## Task 4: `IpcRouter` callbacks + handlers for the two channels

**Files:**
- Modify: `packages/core/src/ipc-router.ts`

- [ ] **Step 1: Add callback type aliases**

Near the existing callback type aliases at the top of `packages/core/src/ipc-router.ts`, add:

```ts
import type { PersistedSplitNode } from '@awakon/contracts';

export type PersistSplitsCallback = (
  tabId: SessionId,
  splits: PersistedSplitNode | null,
) => void;
export type SplitsForTabCallback = (tabId: SessionId) => PersistedSplitNode | null;
```

Also add the two new schemas to the existing import from `@awakon/contracts`:

```ts
  LayoutPersistSplitsPayloadSchema,
  LayoutSplitsForTabPayloadSchema,
```

- [ ] **Step 2: Add private fields + registration methods**

Inside the `IpcRouter` class, near the existing callback fields, add:

```ts
  private persistSplitsCallback: PersistSplitsCallback | null = null;
  private splitsForTabCallback: SplitsForTabCallback | null = null;
```

Near the other `on*` methods, add:

```ts
  onPersistSplits(cb: PersistSplitsCallback): void {
    this.persistSplitsCallback = cb;
  }

  onSplitsForTab(cb: SplitsForTabCallback): void {
    this.splitsForTabCallback = cb;
  }
```

- [ ] **Step 3: Wire the handlers in `bindRequests()`**

After the existing `LayoutReorderTabs` handler in `bindRequests()`, append:

```ts
    this.ipcMain.handle(IpcChannel.LayoutPersistSplits, (_e, raw): { ok: true } | { error: string } => {
      const parsed = LayoutPersistSplitsPayloadSchema.safeParse(raw);
      if (!parsed.success) return { error: parsed.error.message };
      this.persistSplitsCallback?.(parsed.data.tabId, parsed.data.splits);
      return { ok: true };
    });

    this.ipcMain.handle(IpcChannel.LayoutSplitsForTab, (_e, raw): PersistedSplitNode | null | { error: string } => {
      const parsed = LayoutSplitsForTabPayloadSchema.safeParse(raw);
      if (!parsed.success) return { error: parsed.error.message };
      return this.splitsForTabCallback?.(parsed.data.tabId) ?? null;
    });
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @awakon/core typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ipc-router.ts
git commit -m "feat(core): add IpcRouter callbacks/handlers for split persistence"
```

---

## Task 5: Main — extend `tabMeta`, register IPC callbacks, bump version literal

**Files:**
- Modify: `apps/desktop/src/main/index.ts`

- [ ] **Step 1: Extend the `tabMeta` type and `snapshotTabs()`**

In `apps/desktop/src/main/index.ts`, replace the existing `tabMeta` declaration:

```ts
const tabMeta = new Map<string, { tabId: string; shell: Shell; cwd: string; title?: string }>();
```

with:

```ts
import type { PersistedSplitNode, PersistedTab } from '@awakon/contracts';

const tabMeta = new Map<string, PersistedTab>();
```

(Add `PersistedSplitNode, PersistedTab` to the existing `@awakon/contracts` type import if one exists, otherwise add the import shown.)

Replace the `snapshotTabs()` function so it emits `version: 2`:

```ts
function snapshotTabs(): {
  version: 2;
  tabs: PersistedTab[];
  focusedTabId: string | null;
} {
  return {
    version: 2,
    tabs: tabOrder.filter((id) => tabMeta.has(id)).map((id) => tabMeta.get(id)!),
    focusedTabId: focusedSessionId,
  };
}
```

- [ ] **Step 2: Register the two new IPC callbacks**

After the existing `ipcRouter.onReorderTabs(...)` block (~line 284), append:

```ts
// Persist the serialized split tree for a tab. Null clears the field.
ipcRouter.onPersistSplits((tabId, splits) => {
  const meta = tabMeta.get(tabId);
  if (!meta) return;
  if (splits === null) {
    delete meta.splits;
  } else {
    meta.splits = splits;
  }
  persistTabs();
});

// Hand the saved split tree to the terminal renderer when it mounts.
ipcRouter.onSplitsForTab((tabId) => tabMeta.get(tabId)?.splits ?? null);
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @awakon/desktop typecheck
```

Expected: PASS. (You may need to also adjust the `tabMeta.set(...)` call in `createTabSession` to spread its `opts` since `PersistedTab` is the new value type. The existing call already constructs `{ tabId, shell, cwd, ...(opts.title ? { title } : {}) }`, which matches `PersistedTab` shape — no edit needed if so.)

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/index.ts
git commit -m "feat(desktop): persist split trees from main and serve them on demand"
```

---

## Task 6: Bootstrap — carry `splits` from persisted file into `tabMeta`

**Files:**
- Modify: `apps/desktop/src/main/session-bootstrap.ts`
- Modify: `apps/desktop/src/main/index.ts`

- [ ] **Step 1: Extend `BootstrapDeps.createTabSession` to accept `splits`**

Replace the `BootstrapDeps` interface and `bootstrapSessions` body in `apps/desktop/src/main/session-bootstrap.ts`:

```ts
import type { Shell, PersistedTabs, PersistedSplitNode } from '@awakon/contracts';
import type { SessionInfo } from '@awakon/contracts';

export interface BootstrapDeps {
  loadPersisted: () => Promise<PersistedTabs | null>;
  createTabSession: (opts: {
    shell: Shell;
    cwd: string;
    cols: number;
    rows: number;
    title?: string;
    splits?: PersistedSplitNode;
  }) => Promise<SessionInfo>;
  defaultShell: () => Shell;
  defaultCwd: () => string;
}

export async function bootstrapSessions(deps: BootstrapDeps): Promise<string | null> {
  const persisted = await deps.loadPersisted();
  if (persisted && persisted.tabs.length > 0) {
    let firstId: string | null = null;
    for (const tab of persisted.tabs) {
      const info = await deps.createTabSession({
        shell: tab.shell,
        cwd: tab.cwd,
        cols: 80,
        rows: 24,
        ...(tab.title ? { title: tab.title } : {}),
        ...(tab.splits ? { splits: tab.splits } : {}),
      });
      if (firstId === null) firstId = info.id;
    }
    return persisted.focusedTabId ?? firstId;
  }
  const boot = await deps.createTabSession({
    shell: deps.defaultShell(),
    cwd: deps.defaultCwd(),
    cols: 80,
    rows: 24,
  });
  return boot.id;
}
```

- [ ] **Step 2: Store `splits` on `tabMeta` in `createTabSession`**

In `apps/desktop/src/main/index.ts`, update the body of `createTabSession` (~line 120) to forward `opts.splits` onto `tabMeta`:

```ts
async function createTabSession(opts: Parameters<SessionManager['create']>[0] & {
  splits?: PersistedSplitNode;
}): Promise<SessionInfo> {
  const session = sessionManager.create(opts);
  tabMeta.set(session.id, {
    tabId: session.id,
    shell: opts.shell,
    cwd: opts.cwd,
    ...(opts.title ? { title: opts.title } : {}),
    ...(opts.splits ? { splits: opts.splits } : {}),
  });
  tabOrder.push(session.id);
  persistTabs();
  await createSessionView(session.id);
  return session.info();
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @awakon/desktop typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/session-bootstrap.ts apps/desktop/src/main/index.ts
git commit -m "feat(desktop): carry persisted splits from disk into tabMeta on bootstrap"
```

---

## Task 7: `SplitContainer.serialize()` + tests

**Files:**
- Modify: `apps/desktop/src/renderer/terminal/split-container.ts`
- Test: `apps/desktop/src/renderer/terminal/split-container.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to `apps/desktop/src/renderer/terminal/split-container.test.ts`. The existing `beforeEach` already creates a `SplitContainer` but does not retain a reference — refactor the top so tests can grab it:

Replace the existing top-of-file `beforeEach` and add a `splits` reference:

```ts
let rootEl: HTMLElement;
let bridge: FakeBridge;
let splits: SplitContainer;

beforeEach(() => {
  document.body.innerHTML = '';
  rootEl = document.createElement('div');
  document.body.appendChild(rootEl);
  bridge = freshBridge();
  splits = new SplitContainer({
    rootEl,
    bridge: bridge as unknown as ConstructorParameters<typeof SplitContainer>[0]['bridge'],
    initialSessionId: 'tab-1' as SessionId,
    shell: 'pwsh' as Shell,
    cwd: '/tmp',
  });
});
```

Then append (after the existing `describe('SplitContainer pane context menu', ...)` block):

```ts
describe('SplitContainer.serialize()', () => {
  it('returns undefined for a single leaf (no splits)', () => {
    expect(splits.serialize()).toBeUndefined();
  });

  it('returns a single horizontal branch after one horizontal split', async () => {
    bridge.send.mockResolvedValueOnce({ id: 'pane-a' });
    await splits.splitFocused('horizontal');
    expect(splits.serialize()).toEqual({
      kind: 'branch',
      orientation: 'horizontal',
      ratio: 0.5,
      a: { kind: 'leaf' },
      b: { kind: 'leaf' },
    });
  });

  it('returns a nested tree after a horizontal split followed by a vertical split on the new pane', async () => {
    bridge.send.mockResolvedValueOnce({ id: 'pane-a' });
    await splits.splitFocused('horizontal');
    bridge.send.mockResolvedValueOnce({ id: 'pane-b' });
    await splits.splitFocused('vertical');
    expect(splits.serialize()).toEqual({
      kind: 'branch',
      orientation: 'horizontal',
      ratio: 0.5,
      a: { kind: 'leaf' },
      b: {
        kind: 'branch',
        orientation: 'vertical',
        ratio: 0.5,
        a: { kind: 'leaf' },
        b: { kind: 'leaf' },
      },
    });
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
pnpm --filter @awakon/desktop test -- split-container
```

Expected: FAIL — `splits.serialize is not a function`.

- [ ] **Step 3: Implement `serialize()`**

In `apps/desktop/src/renderer/terminal/split-container.ts`, import the `PersistedSplitNode` type at the top:

```ts
import type { PersistedSplitNode } from '@awakon/contracts';
```

Append two methods inside the `SplitContainer` class (just before the closing brace):

```ts
private serializeNode(node: SplitNode): PersistedSplitNode {
  if (node.kind === 'leaf') return { kind: 'leaf' };
  return {
    kind: 'branch',
    orientation: node.orientation,
    ratio: node.ratio,
    a: this.serializeNode(node.a),
    b: this.serializeNode(node.b),
  };
}

serialize(): PersistedSplitNode | undefined {
  return this.root.kind === 'leaf' ? undefined : this.serializeNode(this.root);
}
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
pnpm --filter @awakon/desktop test -- split-container
```

Expected: PASS — all three new serialize tests green plus the pre-existing context-menu tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/terminal/split-container.ts apps/desktop/src/renderer/terminal/split-container.test.ts
git commit -m "feat(terminal): SplitContainer.serialize() captures tree shape and ratios"
```

---

## Task 8: `SplitContainer.restore()` + tests

**Files:**
- Modify: `apps/desktop/src/renderer/terminal/split-container.ts`
- Test: `apps/desktop/src/renderer/terminal/split-container.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `split-container.test.ts`:

```ts
describe('SplitContainer.restore()', () => {
  it('does nothing for a tree with no branches (treats undefined as no-op)', async () => {
    await splits.restore({ kind: 'leaf' });
    expect(splits.serialize()).toBeUndefined();
  });

  it('rebuilds a single horizontal branch and matches via serialize()', async () => {
    bridge.send.mockResolvedValue({ id: 'pane-x' });
    const tree = {
      kind: 'branch' as const,
      orientation: 'horizontal' as const,
      ratio: 0.7,
      a: { kind: 'leaf' as const },
      b: { kind: 'leaf' as const },
    };
    await splits.restore(tree);
    expect(splits.serialize()).toEqual(tree);
  });

  it('rebuilds a nested tree (horizontal then vertical on right leaf)', async () => {
    bridge.send.mockResolvedValue({ id: 'pane-y' });
    const tree = {
      kind: 'branch' as const,
      orientation: 'horizontal' as const,
      ratio: 0.6,
      a: { kind: 'leaf' as const },
      b: {
        kind: 'branch' as const,
        orientation: 'vertical' as const,
        ratio: 0.3,
        a: { kind: 'leaf' as const },
        b: { kind: 'leaf' as const },
      },
    };
    await splits.restore(tree);
    expect(splits.serialize()).toEqual(tree);
  });

  it('stops descending a subtree if a pane create returns an error, leaving the rest intact', async () => {
    // First split succeeds; second (inside the b subtree) fails.
    bridge.send
      .mockResolvedValueOnce({ id: 'pane-ok' })
      .mockResolvedValueOnce({ error: 'spawn failed' });
    const tree = {
      kind: 'branch' as const,
      orientation: 'horizontal' as const,
      ratio: 0.5,
      a: { kind: 'leaf' as const },
      b: {
        kind: 'branch' as const,
        orientation: 'vertical' as const,
        ratio: 0.5,
        a: { kind: 'leaf' as const },
        b: { kind: 'leaf' as const },
      },
    };
    await splits.restore(tree);
    // Outer split exists, inner one was skipped — both leaves of the outer branch are plain leaves.
    expect(splits.serialize()).toEqual({
      kind: 'branch',
      orientation: 'horizontal',
      ratio: 0.5,
      a: { kind: 'leaf' },
      b: { kind: 'leaf' },
    });
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
pnpm --filter @awakon/desktop test -- split-container
```

Expected: FAIL — `splits.restore is not a function`.

- [ ] **Step 3: Implement `restore()`**

In `apps/desktop/src/renderer/terminal/split-container.ts`, append inside the class (after `serialize()`):

```ts
/**
 * Replay a saved tree onto the current single-leaf root by re-driving splitFocused().
 * If any pane create fails, that subtree is abandoned and the rest of the tree
 * still restores (the live tree stays coherent — just smaller than the saved one).
 */
async restore(tree: PersistedSplitNode): Promise<void> {
  if (tree.kind === 'leaf') return;
  await this.restoreBranch(this.root as LeafNode, tree);
}

/**
 * Restore `branch` underneath `target`. After splitFocused, the live branch has
 * `a` = original target (the existing leaf) and `b` = the newly created leaf.
 * We then recurse into both sides if they are themselves branches.
 */
private async restoreBranch(target: LeafNode, branch: Extract<PersistedSplitNode, { kind: 'branch' }>): Promise<void> {
  // Focus the target leaf so splitFocused() splits the right pane.
  this.focused = target;
  await this.splitFocused(branch.orientation);

  // If splitFocused failed (pane create returned an error), the tree is unchanged —
  // `target` still has no parent. findParent === null is our failure signal.
  const newBranch = this.findParent(this.root, target);
  if (!newBranch) return;

  // Apply the saved ratio.
  newBranch.ratio = branch.ratio;
  newBranch.a.el.style.flex = `1 1 ${branch.ratio * 100}%`;
  newBranch.b.el.style.flex = `1 1 ${(1 - branch.ratio) * 100}%`;

  // Recurse into a then b. Each side is a leaf at this point (splitFocused
  // creates a leaf for the new pane and keeps the old leaf intact).
  if (branch.a.kind === 'branch') {
    await this.restoreBranch(newBranch.a as LeafNode, branch.a);
  }
  if (branch.b.kind === 'branch') {
    await this.restoreBranch(newBranch.b as LeafNode, branch.b);
  }
}
```

Note: `splitFocused()` already returns early on pane-create failure without mutating the tree. The `before === this.root` check after `splitFocused` plus the `findParent` guard is what makes failed splits skip cleanly without throwing.

- [ ] **Step 4: Run the tests and verify they pass**

```bash
pnpm --filter @awakon/desktop test -- split-container
```

Expected: PASS — all four new restore tests green; serialize tests still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/terminal/split-container.ts apps/desktop/src/renderer/terminal/split-container.test.ts
git commit -m "feat(terminal): SplitContainer.restore() replays a saved tree via splitFocused"
```

---

## Task 9: Persist on every structural change and after divider drag-end

**Files:**
- Modify: `apps/desktop/src/renderer/terminal/split-container.ts`
- Test: `apps/desktop/src/renderer/terminal/split-container.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `split-container.test.ts`:

```ts
function persistCalls(b: FakeBridge): Array<{ tabId: string; splits: unknown }> {
  return b.send.mock.calls
    .filter((c: unknown[]) => c[0] === 'core.layout.persist-splits')
    .map((c: unknown[]) => c[1] as { tabId: string; splits: unknown });
}

describe('SplitContainer persistence', () => {
  it('sends LayoutPersistSplits after a successful split', async () => {
    bridge.send.mockResolvedValueOnce({ id: 'pane-a' });
    await splits.splitFocused('horizontal');
    const calls = persistCalls(bridge);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1]!.tabId).toBe('tab-1');
    expect(calls[calls.length - 1]!.splits).toEqual({
      kind: 'branch',
      orientation: 'horizontal',
      ratio: 0.5,
      a: { kind: 'leaf' },
      b: { kind: 'leaf' },
    });
  });

  it('sends LayoutPersistSplits with null after closing the last extra pane', async () => {
    bridge.send.mockResolvedValueOnce({ id: 'pane-a' });
    await splits.splitFocused('horizontal');
    splits.closeFocusedPane();
    const calls = persistCalls(bridge);
    expect(calls[calls.length - 1]!.splits).toBeNull();
  });

  it('sends LayoutPersistSplits with the new ratio after a divider drag ends', async () => {
    bridge.send.mockResolvedValueOnce({ id: 'pane-a' });
    await splits.splitFocused('horizontal');
    const divider = rootEl.querySelector('div[style*="col-resize"]') as HTMLElement;
    expect(divider).not.toBeNull();
    divider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    // No mousemove — just end the drag; persist should still fire on mouseup.
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const calls = persistCalls(bridge);
    const last = calls[calls.length - 1]!;
    expect(last.tabId).toBe('tab-1');
    expect((last.splits as { kind: string }).kind).toBe('branch');
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
pnpm --filter @awakon/desktop test -- split-container
```

Expected: FAIL — no `core.layout.persist-splits` calls are recorded yet.

- [ ] **Step 3: Wire the `persist()` helper into the three call sites**

In `apps/desktop/src/renderer/terminal/split-container.ts`, also import `IpcChannel` (already imported) — no new import. Add the helper inside the class:

```ts
private persist(): void {
  void this.bridge.send(IpcChannel.LayoutPersistSplits, {
    tabId: this.tabId,
    splits: this.serialize() ?? null,
  });
}
```

Then update three call sites:

**(a) End of `splitFocused()`** — add `this.persist();` immediately after the existing `newLeafEl.addEventListener(...)` block, just before the closing brace.

**(b) End of `closeFocusedPane()`** — add `this.persist();` immediately after `this.focused.el.focus();`, before the closing brace.

**(c) Divider `mouseup`** — modify the existing `wireDivider()` so the `onUp` handler also persists. Replace the inner `onUp` definition with:

```ts
      const onUp = (): void => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        this.persist();
      };
```

(Note: `restore()` calls `splitFocused()` internally, which will emit persist events during replay. That is harmless — main treats each call idempotently — but if you'd like a quieter restore, add a `private restoring = false` guard around `restore()` and check it in `persist()`. Not required for correctness; skip unless the noise bothers you. If you add the guard, also add one test that calls `restore()` and asserts only **one** persist call fires at the end. See optional sub-step below.)

- [ ] **Step 4: Run the tests and verify they pass**

```bash
pnpm --filter @awakon/desktop test -- split-container
```

Expected: PASS — three new persistence tests green; serialize + restore + context-menu tests still pass.

- [ ] **Step 5 (optional): Add a quiet-restore guard**

Only if you want a single persist at the end of `restore()` rather than one per replayed split:

```ts
private restoring = false;

async restore(tree: PersistedSplitNode): Promise<void> {
  if (tree.kind === 'leaf') return;
  this.restoring = true;
  try {
    await this.restoreBranch(this.root as LeafNode, tree);
  } finally {
    this.restoring = false;
  }
  // No final persist — what we just rebuilt is exactly what was saved.
}

private persist(): void {
  if (this.restoring) return;
  void this.bridge.send(IpcChannel.LayoutPersistSplits, {
    tabId: this.tabId,
    splits: this.serialize() ?? null,
  });
}
```

If you add this, also add a test:

```ts
it('does not call LayoutPersistSplits during restore()', async () => {
  bridge.send.mockResolvedValue({ id: 'pane-z' });
  await splits.restore({
    kind: 'branch', orientation: 'horizontal', ratio: 0.5,
    a: { kind: 'leaf' }, b: { kind: 'leaf' },
  });
  expect(persistCalls(bridge)).toHaveLength(0);
});
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/terminal/split-container.ts apps/desktop/src/renderer/terminal/split-container.test.ts
git commit -m "feat(terminal): persist split tree on structure changes and divider drag-end"
```

---

## Task 10: Fetch saved splits on terminal startup and replay

**Files:**
- Modify: `apps/desktop/src/renderer/terminal/split-container.ts`
- Modify: `apps/desktop/src/renderer/terminal/main.ts`

- [ ] **Step 1: Make `SplitContainer` expose a one-shot `loadSavedLayout()` method**

In `apps/desktop/src/renderer/terminal/split-container.ts`, append:

```ts
/**
 * Called once during terminal mount: asks main for the saved split tree for this
 * tab and replays it. No-op if main returns null/no tree.
 */
async loadSavedLayout(): Promise<void> {
  let saved: PersistedSplitNode | null;
  try {
    saved = (await this.bridge.send(IpcChannel.LayoutSplitsForTab, {
      tabId: this.tabId,
    })) as PersistedSplitNode | null;
  } catch (err) {
    console.warn('[split] could not fetch saved layout:', err);
    return;
  }
  if (!saved) return;
  await this.restore(saved);
}
```

- [ ] **Step 2: Call it from the terminal entry point**

In `apps/desktop/src/renderer/terminal/main.ts`, after the existing `SplitContainer` construction, add:

```ts
void splits.loadSavedLayout();
```

(Place it after the `(window as unknown as { __awakonSplits: SplitContainer }).__awakonSplits = splits;` line.)

- [ ] **Step 3: Add a test for `loadSavedLayout()`**

Append to `apps/desktop/src/renderer/terminal/split-container.test.ts`:

```ts
describe('SplitContainer.loadSavedLayout()', () => {
  it('is a no-op when main returns null', async () => {
    bridge.send.mockImplementation((channel: string) =>
      channel === 'core.layout.splits-for-tab'
        ? Promise.resolve(null)
        : Promise.resolve({ id: 'pane-x' }),
    );
    await splits.loadSavedLayout();
    expect(splits.serialize()).toBeUndefined();
  });

  it('replays a tree returned by main', async () => {
    const saved = {
      kind: 'branch' as const,
      orientation: 'horizontal' as const,
      ratio: 0.4,
      a: { kind: 'leaf' as const },
      b: { kind: 'leaf' as const },
    };
    bridge.send.mockImplementation((channel: string) =>
      channel === 'core.layout.splits-for-tab'
        ? Promise.resolve(saved)
        : Promise.resolve({ id: 'pane-y' }),
    );
    await splits.loadSavedLayout();
    expect(splits.serialize()).toEqual(saved);
  });
});
```

- [ ] **Step 4: Run all SplitContainer tests**

```bash
pnpm --filter @awakon/desktop test -- split-container
```

Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/terminal/split-container.ts apps/desktop/src/renderer/terminal/main.ts apps/desktop/src/renderer/terminal/split-container.test.ts
git commit -m "feat(terminal): replay saved split layout on terminal renderer startup"
```

---

## Task 11: Workspace verification + manual smoke

- [ ] **Step 1: Typecheck the whole workspace**

```bash
pnpm typecheck
```

Expected: PASS for every package.

- [ ] **Step 2: Lint**

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 3: Run the full unit + integration suite**

```bash
pnpm test
```

Expected: PASS — no regressions. Pay attention to `@awakon/contracts`, `@awakon/core`, `@awakon/desktop` test suites.

- [ ] **Step 4: Manual smoke**

1. `pnpm dev` — app launches with the default boot tab.
2. Create a second tab (`Ctrl+T`, accept defaults).
3. In tab 2, `Ctrl+\` to split horizontally, then in the right pane `Ctrl+Shift+\` to split vertically.
4. Drag the outer divider to ~60/40.
5. Close the app (`Ctrl+W` repeatedly, then close the window — or just close the window).
6. Re-run `pnpm dev`.
7. **Expected:** tab 2 reopens with the same nested split shape; the outer divider is at the same ratio. Each pane has a fresh prompt (PTYs are respawned).
8. Inspect `%APPDATA%\Awakon\sessions.json` (Windows) / `~/Library/Application Support/Awakon/sessions.json` (macOS) / `~/.config/Awakon/sessions.json` (Linux) and confirm `version: 2` plus the `splits` field on tab 2.

- [ ] **Step 5: No commit needed for the smoke; if everything passes, the feature is done.**

If the smoke uncovers anything (e.g., dividers don't carry their ratio), fix the matching task's test first, then re-run from Step 1.

---

## Self-review notes (informational)

- **Spec coverage:** every section of the spec maps to a task: §4 schema → T1; §4 migration → T1+T2; §5.1 serialize → T7; §5.2 restore → T8; §5.3 persist on change → T9; §6.1 main handler → T4+T5; §6.2 splits-for-tab → T4+T5+T10; §6.3 bootstrap → T6; §7 IPC channels → T3; §10 testing → tests in T1, T2, T7, T8, T9, T10; §11 manual verification → T11.
- **Type consistency:** `PersistedSplitNode` is defined once in T1 and reused everywhere. `tabMeta` uses `PersistedTab` from T5 onward, so no per-file shape divergence.
- **Placeholder scan:** no TBDs, no "implement later", every code step contains the actual code.
- **Out-of-scope (deferred):** focused-pane memory and per-pane shell/cwd remain non-goals (spec §2 and §11).
