# Split-layout persistence — Design

**Date:** 2026-05-27
**Branch:** `feat/redesign-awakon`
**Status:** Approved for planning
**Scope:** Persist the per-tab split-pane tree (orientation + ratios) so that on relaunch each tab is restored with the same pane layout it had when the app last closed. Pane shells are respawned fresh, matching existing tab-restore behavior.

---

## 1. Goal

Today Awakon restores tabs (shell, cwd, title, order, focused tab) on relaunch but loses any splits inside those tabs — every tab comes back as a single pane regardless of how it was arranged. The README already promises split-layout restore; this design makes that promise true.

After this change, when the user closes the app with, say, tab 2 split horizontally and the right pane split vertically below, the next launch reopens tab 2 with the same nested split shape and the same divider positions. Each pane runs a fresh shell (same caveat as tabs).

## 2. Non-goals

- **Preserving running shell state.** Pane PTYs are respawned fresh, same as tab PTYs today. Scrollback, in-flight commands, and agent conversation state are not restored.
- **Per-pane shell/cwd.** Today every pane inside a tab inherits the tab's `shell` and `cwd`; this design keeps that. We do not introduce per-pane shell overrides.
- **Remembering which pane was focused inside each tab.** On restore, focus lands on the primary leaf. (Future enhancement if asked for.)
- **Cross-tab pane drag / pane move between tabs.** Not in scope.
- **End-to-end Playwright coverage for the round-trip.** The unit/integration layers cover the contract; we don't need a new E2E.

## 3. Architecture

The split tree already lives in `SplitContainer` (renderer-side, one `SplitContainer` per terminal renderer / per tab). The main process owns `sessions.json` via `SessionStore` and the `tabMeta` map. We keep that division of authority:

- **Renderer (`SplitContainer`)** is the single source of truth for the live tree. It gains `serialize()` and `restore()` methods.
- **Main (`index.ts`)** receives split snapshots over IPC, stores them on `tabMeta`, and writes them to disk through the existing `persistTabs()` path. On bootstrap, main hands the saved tree back to the terminal renderer over IPC so `SplitContainer` can replay it.
- **Contracts (`@awakon/contracts`)** define the on-disk schema (`PersistedSplitNode`) and the migration helper. The same Zod schema validates both disk reads and incoming IPC payloads.

No new persistence subsystem is introduced — the change reuses `SessionStore`'s atomic write chain, the `.broken-<ts>` rescue path, and `bootstrapSessions`'s existing tab-replay loop.

```
              (renderer: terminal-host)              (main)                   (disk)
SplitContainer.serialize() ──IPC LayoutPersistSplits──▶ tabMeta[tabId].splits ──▶ sessions.json
                                                          │
SplitContainer.restore(tree) ◀──IPC LayoutSplitsForTab──┘
```

## 4. Schema and migration

`PersistedTab` gains an optional `splits` field; `PERSISTENCE_SCHEMA_VERSION` bumps from `1` to `2`.

```ts
// packages/contracts/src/persistence.ts

export const PERSISTENCE_SCHEMA_VERSION = 2;

export type PersistedSplitNode =
  | { kind: 'leaf' }
  | {
      kind: 'branch';
      orientation: 'horizontal' | 'vertical';
      ratio: number;        // validated to [0.1, 0.9]
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

export const PersistedTabsSchema = z.object({
  version: z.literal(2),
  tabs: z.array(PersistedTabSchema),
  focusedTabId: z.string().nullable(),
});
```

**`splits` is omitted when the tab is a single pane.** A leaf-only tree carries no useful information and storing it would just bloat the JSON.

### Migration

`SessionStore.load()` gains a `migrateToCurrent(parsed: unknown): unknown | null` step run before `PersistedTabsSchema.safeParse`:

- `version: 1` → set `version: 2`, leave `splits` undefined on every tab. Return the mutated object.
- `version: 2` → pass through.
- Anything else → return `null`; existing code path renames the file to `.broken-<ts>` and the app boots fresh.

The next save writes v2, so the file is upgraded in place after the first relaunch.

## 5. Renderer changes — `SplitContainer`

Add three responsibilities to the existing class. None of them duplicate logic that already exists in `splitFocused()` / `closeFocusedPane()`.

### 5.1 `serialize(): PersistedSplitNode | undefined`

Walks the live tree:

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

### 5.2 `restore(tree: PersistedSplitNode): Promise<void>`

Replays the tree top-down by reusing `splitFocused()`. For each saved branch:

1. Focus the leaf that should become the `a` side (the existing root leaf for the top call).
2. Call `await this.splitFocused(orientation)` — this creates the pane PTY, updates the DOM, and inserts a branch with `ratio = 0.5`.
3. Set the new branch's `ratio` to the saved value and update both leaves' `style.flex` via the same `flex-basis` formula `wireDivider` uses.
4. Recurse: restore the `a` subtree (focus the `a` leaf first), then the `b` subtree (focus the `b` leaf).

If any `splitFocused()` call fails (pane spawn error returned `{ error }`), log it and abort that subtree — the rest of the tree is left intact so the user still gets a coherent (smaller) layout.

After restore, focus lands on the primary leaf (first leaf encountered walking the tree).

### 5.3 Persist on change

`SplitContainer` calls a new helper `this.persist()` after every structural change and after a divider drag ends:

- `splitFocused()` — at the end, after the tree is updated.
- `closeFocusedPane()` — at the end, after promotion.
- `wireDivider()` — inside the `onUp` handler (replaces / supplements the existing handler).

```ts
private persist(): void {
  void this.bridge.send(IpcChannel.LayoutPersistSplits, {
    tabId: this.tabId,
    splits: this.serialize() ?? null, // null clears the field on the main side
  });
}
```

A single divider drag emits one save (on `mouseup`), not one per `mousemove`. Structural ops emit one save each.

## 6. Main-process changes — `index.ts`

### 6.1 IPC handler: persist splits

```ts
ipcRouter.onPersistSplits((tabId, splits) => {
  const parsed = PersistedSplitNodeSchema.nullable().safeParse(splits);
  if (!parsed.success) return; // ignore malformed payloads (defensive)
  const meta = tabMeta.get(tabId);
  if (!meta) return;
  if (parsed.data === null) delete meta.splits;
  else meta.splits = parsed.data;
  persistTabs();
});
```

`snapshotTabs()` needs no change — it spreads `tabMeta.get(id)!` per tab, so the new `splits` field is included automatically.

### 6.2 IPC handler: fetch splits for a tab on terminal mount

```ts
ipcRouter.onSplitsForTab((tabId) => tabMeta.get(tabId)?.splits ?? null);
```

The terminal renderer calls this once during `SplitContainer` startup. We use IPC rather than embedding the tree in the `terminal-host.html` query string because a deeply nested tree could exceed URL length limits and URL-encoded JSON is awkward to debug.

### 6.3 Bootstrap

`bootstrapSessions` already calls `createTabSession({ shell, cwd, title? })` per persisted tab. We pass `splits` to `createTabSession`, which stores it on `tabMeta` so `onSplitsForTab` can hand it back when the terminal renderer asks. No change to PTY creation order — pane PTYs are created lazily as `SplitContainer.restore()` replays each split.

## 7. New IPC channels

Both go through the existing `ipcRouter` plumbing.

| Channel | Direction | Payload | Reply |
|---|---|---|---|
| `LayoutPersistSplits` | renderer → main | `{ tabId: string; splits: PersistedSplitNode \| null }` | ack |
| `LayoutSplitsForTab` | renderer → main | `{ tabId: string }` | `PersistedSplitNode \| null` |

Both are validated against `PersistedSplitNodeSchema` on the main side. The renderer trusts what main returns (it's reading from the schema-validated `tabMeta`).

## 8. Data flow

### 8.1 Save

1. User splits / closes a pane / finishes a divider drag.
2. `SplitContainer.persist()` → `serialize()` → IPC `LayoutPersistSplits`.
3. Main validates, updates `tabMeta`, calls `persistTabs()` → `sessionStore.save()` → atomic temp-file + rename.

### 8.2 Restore

1. App starts. `sessionStore.load()` reads `sessions.json`, runs `migrateToCurrent`, returns `PersistedTabs` (v2).
2. `bootstrapSessions` iterates `persisted.tabs`. For each, `createTabSession()` stores `splits` on `tabMeta` and `createSessionView` loads `terminal-host.html` for the primary session.
3. The terminal renderer constructs `SplitContainer` with its primary leaf, then `await bridge.send(LayoutSplitsForTab, { tabId })`.
4. If main returns a tree, `SplitContainer.restore(tree)` rebuilds it by replaying `splitFocused()` and applying saved ratios.
5. Focus lands on the primary leaf.

## 9. Error handling

| Failure | Behavior |
|---|---|
| `sessions.json` missing | First-run path; bootstrap creates default tab. (Unchanged.) |
| `sessions.json` malformed JSON or schema mismatch (after migration) | `SessionStore` renames to `.broken-<ts>`, returns `null`, default tab is created. (Unchanged.) |
| `sessions.json` is v1 | `migrateToCurrent` stamps `version: 2`, splits are undefined for every tab. Next save writes v2. |
| Renderer sends a malformed `LayoutPersistSplits` payload | Main `safeParse` fails; payload ignored. No crash, no save. |
| Pane PTY spawn fails during `restore()` | `splitFocused()` logs and returns. `restore()` stops descending into that subtree; rest of the tree restores. |
| Saved `ratio` outside `[0.1, 0.9]` | Caught by schema validation → whole file goes to `.broken-<ts>`. (Aligned with existing strict-validation behavior.) |
| Save fails (disk full, locked file) | Existing `SessionStore.onError` path logs `[main] layout not saved: …`. No user-visible regression. |

## 10. Testing

Three layers — no new test infrastructure needed.

### 10.1 Contracts (`packages/contracts/tests/persistence.test.ts`)

- `PersistedSplitNodeSchema` round-trip for: leaf, single horizontal branch, single vertical branch, deeply nested branches, ratio at both bounds.
- Reject: ratio < 0.1, ratio > 0.9, unknown orientation, missing `a` or `b`.
- `migrateToCurrent` for: a valid v1 file (returns v2 with undefined splits per tab), a valid v2 file (passthrough), an object with no `version` field (returns null), an object with `version: 3` (returns null).

### 10.2 Core (`packages/core/tests/session-store.test.ts`)

- Load a hand-crafted v1 file → in-memory representation is v2 with undefined splits.
- Load a v2 file containing splits → exact tree comes back.
- Load a v2 file with an out-of-range ratio → `.broken-<ts>` rename, returns `null`.
- Save then reload v2 with splits → bytes-on-disk round-trip.

### 10.3 SplitContainer (`apps/desktop/src/renderer/terminal/split-container.test.ts`)

- `serialize()` on a single-pane tab → `undefined`.
- `serialize()` on each of the shapes constructed by the existing tests → matches a hand-written `PersistedSplitNode`.
- `restore(tree)` with each of those shapes → resulting tree (read back via `serialize()`) is structurally equal to the input, and DOM contains the expected number of leaf elements.
- `restore(tree)` with a `splitFocused` that errors on the second pane → first split is in place; second subtree is skipped; no exception escapes.

## 11. Out-of-scope follow-ups

- Optional: persist the focused pane per tab and refocus on restore.
- Optional: per-pane shell/cwd (currently inherited from tab).
- README: the current Session-persistence section already claims splits are restored; once this lands, that sentence becomes accurate. A one-line clarification that pane PTYs also respawn fresh can land with the implementation.
