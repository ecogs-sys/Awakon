# Markdown Doc Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a `.md` path appears in a terminal pane, clicking it slides a right-side modal reader (~90% of the console) that renders the parsed Markdown, owned per-tab, persisted across restart.

**Architecture:** The reader lives entirely in the **chrome** renderer (the only surface not painted over by native terminal `WebContentsView`s). A click in the **terminal-host** xterm sends `core.doc.open` to **main**, which resolves the owning tab + cwd + provenance and emits `event.doc.open-request` to the chrome. The chrome shows the overlay and suspends the terminal view via the existing `core.layout.modal` mechanism. Per-tab reader state is persisted alongside split layout.

**Tech Stack:** TypeScript, Electron, xterm.js (`registerLinkProvider`), zod (contracts/IPC), markdown-it + DOMPurify (render/sanitize), vitest (+ jsdom for DOM tests).

**Design spec:** `docs/superpowers/specs/2026-06-07-md-doc-reader-design.md`

**Conventions in this repo (read before starting):**
- Monorepo with pnpm workspaces: `packages/contracts`, `packages/core`, `packages/terminal-host`, `apps/desktop`.
- IPC channel strings + zod schemas live in `packages/contracts/src/ipc.ts`; the router that binds them is `packages/core/src/ipc-router.ts`.
- Tests are colocated `*.test.ts` (desktop) or under `packages/<pkg>/tests/` (core). DOM tests start with `// @vitest-environment jsdom`.
- Run a single package's tests with its filter, e.g. `pnpm --filter @awakon/desktop test`, `pnpm --filter @awakon/core test`.
- Run typecheck across the repo with `pnpm typecheck`.
- Commit after every task.

---

## File Structure

**Created:**
- `packages/terminal-host/src/md-links.ts` — pure `.md` link matcher (regex over a line).
- `packages/terminal-host/vitest.config.ts` — vitest config for the new package tests.
- `packages/terminal-host/src/md-links.test.ts` — matcher tests.
- `apps/desktop/src/renderer/chrome/doc-state.ts` — per-tab reader state types + pure reducers.
- `apps/desktop/src/renderer/chrome/doc-state.test.ts` — reducer tests.
- `apps/desktop/src/renderer/chrome/markdown.ts` — `renderMarkdown()` (markdown-it + DOMPurify).
- `apps/desktop/src/renderer/chrome/markdown.test.ts` — render/sanitize tests.
- `apps/desktop/src/renderer/chrome/doc-reader.ts` — `DocReader` overlay renderer.
- `apps/desktop/src/renderer/chrome/doc-reader.test.ts` — reader DOM tests.
- `apps/desktop/src/renderer/chrome/layout-manager-doc-reader.test.ts` — orchestration tests.
- `packages/core/tests/doc-ipc-schema.test.ts` — schema tests for the new IPC payloads.

**Modified:**
- `packages/contracts/src/persistence.ts` — reader-doc fields + v2→v3 migration.
- `packages/contracts/src/ipc.ts` — new channels + zod schemas.
- `packages/core/src/ipc-router.ts` — `doc.open` / `persist-docs` / `docs-for-tab` callbacks.
- `packages/core/src/ipc-router.test.ts` — router callback tests (created if absent).
- `packages/core/tests/persistence-migration.test.ts` — v3 migration cases.
- `apps/desktop/src/main/fs-handlers.ts` — `core.fs.read-file` handler.
- `apps/desktop/src/main/fs-handlers.test.ts` — read-file tests.
- `apps/desktop/src/main/index.ts` — doc-open resolution + persist wiring + snapshot version 3.
- `packages/terminal-host/src/terminal-host.ts` — register the `.md` link provider.
- `packages/terminal-host/src/index.ts` — export `findMarkdownLinks`.
- `packages/terminal-host/package.json` — add `test` script + vitest devDep.
- `apps/desktop/package.json` — add `markdown-it`, `dompurify` (+ types).
- `apps/desktop/src/renderer/chrome/state.ts` — attach `docState` to `SessionState`.
- `apps/desktop/src/renderer/chrome/tab-strip.ts` — `M↓` marker variant.
- `apps/desktop/src/renderer/chrome/layout-manager.ts` — reader orchestration.
- `apps/desktop/src/renderer/chrome/main.ts` — construct + wire `DocReader`.
- `apps/desktop/src/renderer/chrome/styles/chrome.css` — reader styles.

---

## Task 1: Add markdown render dependencies

**Files:**
- Modify: `apps/desktop/package.json`

- [ ] **Step 1: Install the runtime + type dependencies**

Run (from repo root):

```bash
pnpm --filter @awakon/desktop add markdown-it dompurify
pnpm --filter @awakon/desktop add -D @types/markdown-it @types/dompurify
```

- [ ] **Step 2: Verify they landed in package.json**

Run: `pnpm --filter @awakon/desktop ls markdown-it dompurify`
Expected: both resolve to a concrete version (no "missing").

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml
git commit -m "build: add markdown-it + dompurify for the doc reader"
```

---

## Task 2: Persistence schema v3 (reader docs + migration)

**Files:**
- Modify: `packages/contracts/src/persistence.ts`
- Test: `packages/core/tests/persistence-migration.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these cases to `packages/core/tests/persistence-migration.test.ts`. Update the existing `PERSISTENCE_SCHEMA_VERSION` test from `2` to `3`, and add a new `describe` block:

```ts
describe('PERSISTENCE_SCHEMA_VERSION', () => {
  it('is 3', () => {
    expect(PERSISTENCE_SCHEMA_VERSION).toBe(3);
  });
});

describe('migratePersistedTabs — v2 to v3', () => {
  it('upgrades a v2 payload to v3 with undefined docs', () => {
    const v2 = {
      version: 2,
      tabs: [{ tabId: 't1', shell: 'pwsh', cwd: '/x' }],
      focusedTabId: 't1',
    };
    const migrated = migratePersistedTabs(v2);
    const parsed = PersistedTabsSchema.safeParse(migrated);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.version).toBe(3);
      expect(parsed.data.tabs[0]!.docs).toBeUndefined();
    }
  });

  it('chains v1 -> v3', () => {
    const v1 = { version: 1, tabs: [{ tabId: 't1', shell: 'pwsh', cwd: '/x' }], focusedTabId: 't1' };
    const parsed = PersistedTabsSchema.safeParse(migratePersistedTabs(v1));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.version).toBe(3);
  });

  it('accepts a v3 payload carrying reader docs', () => {
    const v3 = {
      version: 3,
      tabs: [{
        tabId: 't1', shell: 'pwsh', cwd: '/x',
        docs: [{
          rawPath: 'docs/migration.md',
          resolvedPath: '/x/docs/migration.md',
          provenanceTitle: 'pwsh',
          provenanceStatus: 'running',
          reviewState: 'proposed',
        }],
        activeDocIndex: 0,
      }],
      focusedTabId: 't1',
    };
    expect(PersistedTabsSchema.safeParse(migratePersistedTabs(v3)).success).toBe(true);
  });

  it('returns null for version 4', () => {
    expect(migratePersistedTabs({ version: 4, tabs: [], focusedTabId: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @awakon/core test persistence-migration`
Expected: FAIL — `PERSISTENCE_SCHEMA_VERSION` is still 2; `docs`/`activeDocIndex` unknown.

- [ ] **Step 3: Implement the schema + migration changes**

Replace the contents of `packages/contracts/src/persistence.ts` with:

```ts
import { z } from 'zod';
import { ShellSchema, SessionStatusSchema } from './session.js';

export const PERSISTENCE_SCHEMA_VERSION = 3;

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

/** Per-doc review state shown in the reader's review bar. */
export const ReviewStateSchema = z.enum(['proposed', 'approved', 'changes-requested']);
export type ReviewState = z.infer<typeof ReviewStateSchema>;

/** A markdown doc opened in a tab's reader. Content is never persisted (re-read on open). */
export const PersistedOpenDocSchema = z.object({
  rawPath: z.string().min(1),
  resolvedPath: z.string().min(1),
  provenanceTitle: z.string(),
  provenanceStatus: SessionStatusSchema,
  reviewState: ReviewStateSchema,
});
export type PersistedOpenDoc = z.infer<typeof PersistedOpenDocSchema>;

export const PersistedTabSchema = z.object({
  tabId: z.string().min(1),
  shell: ShellSchema,
  cwd: z.string().min(1),
  title: z.string().optional(),
  splits: PersistedSplitNodeSchema.optional(),
  /** Reader docs opened in this tab (markers survive restart; content does not). */
  docs: z.array(PersistedOpenDocSchema).optional(),
  /** Which doc was active; null/undefined = none. */
  activeDocIndex: z.number().int().nullable().optional(),
});
export type PersistedTab = z.infer<typeof PersistedTabSchema>;

export const PersistedTabsSchema = z.object({
  version: z.literal(PERSISTENCE_SCHEMA_VERSION),
  tabs: z.array(PersistedTabSchema),
  focusedTabId: z.string().nullable(),
});
export type PersistedTabs = z.infer<typeof PersistedTabsSchema>;

/**
 * Migrate an unknown payload read from disk into the current schema shape, *before*
 * `PersistedTabsSchema.safeParse` validates it. Returns the (possibly mutated) payload
 * on success, or null if the version is missing/unknown.
 *
 * v1 -> v2: stamp version 2 (splits left undefined).
 * v2 -> v3: stamp version 3 (docs left undefined).
 */
export function migratePersistedTabs(parsed: unknown): unknown | null {
  if (parsed === null || typeof parsed !== 'object') return null;
  let obj = parsed as { version?: unknown };
  if (obj.version === 1) obj = { ...obj, version: 2 };
  if (obj.version === 2) obj = { ...obj, version: 3 };
  if (obj.version === 3) return obj;
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @awakon/core test persistence-migration`
Expected: PASS (including the existing v1→v2 tests, which still pass since the chain stamps 3).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/persistence.ts packages/core/tests/persistence-migration.test.ts
git commit -m "feat: persist per-tab reader docs (schema v3 + migration)"
```

---

## Task 3: New IPC channels + schemas

**Files:**
- Modify: `packages/contracts/src/ipc.ts`
- Test: `packages/core/tests/doc-ipc-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/doc-ipc-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  FsReadFilePayloadSchema,
  FsReadFileResponseSchema,
  DocOpenPayloadSchema,
  DocOpenRequestEventSchema,
  LayoutPersistDocsPayloadSchema,
  LayoutDocsForTabPayloadSchema,
  IpcChannel,
} from '@awakon/contracts';

describe('IpcChannel — doc reader channels', () => {
  it('defines the new channel strings', () => {
    expect(IpcChannel.FsReadFile).toBe('core.fs.read-file');
    expect(IpcChannel.DocOpen).toBe('core.doc.open');
    expect(IpcChannel.DocOpenRequest).toBe('event.doc.open-request');
    expect(IpcChannel.LayoutPersistDocs).toBe('core.layout.persist-docs');
    expect(IpcChannel.LayoutDocsForTab).toBe('core.layout.docs-for-tab');
  });
});

describe('FsReadFile schemas', () => {
  it('accepts a valid request', () => {
    expect(FsReadFilePayloadSchema.safeParse({ path: '/x/a.md' }).success).toBe(true);
  });
  it('rejects an empty path', () => {
    expect(FsReadFilePayloadSchema.safeParse({ path: '' }).success).toBe(false);
  });
  it('accepts each response variant', () => {
    expect(FsReadFileResponseSchema.safeParse({ content: '# hi', sizeBytes: 4, mtimeMs: 1 }).success).toBe(true);
    expect(FsReadFileResponseSchema.safeParse({ tooLarge: true, sizeBytes: 2_000_000 }).success).toBe(true);
    expect(FsReadFileResponseSchema.safeParse({ notFound: true }).success).toBe(true);
    expect(FsReadFileResponseSchema.safeParse({ error: 'nope' }).success).toBe(true);
  });
});

describe('DocOpen schemas', () => {
  it('accepts a request from a terminal pane', () => {
    expect(DocOpenPayloadSchema.safeParse({ sessionId: 's1', path: 'docs/x.md' }).success).toBe(true);
  });
  it('accepts the open-request event', () => {
    expect(DocOpenRequestEventSchema.safeParse({
      tabId: 't1', rawPath: 'docs/x.md', resolvedPath: '/x/docs/x.md',
      provenanceTitle: 'pwsh', provenanceStatus: 'running',
    }).success).toBe(true);
  });
});

describe('Layout doc persistence schemas', () => {
  it('accepts a persist-docs payload', () => {
    expect(LayoutPersistDocsPayloadSchema.safeParse({
      tabId: 't1',
      docs: [{
        rawPath: 'a.md', resolvedPath: '/x/a.md',
        provenanceTitle: 'pwsh', provenanceStatus: 'running', reviewState: 'proposed',
      }],
      activeDocIndex: 0,
    }).success).toBe(true);
  });
  it('accepts an empty docs list with null index', () => {
    expect(LayoutPersistDocsPayloadSchema.safeParse({ tabId: 't1', docs: [], activeDocIndex: null }).success).toBe(true);
  });
  it('accepts a docs-for-tab request', () => {
    expect(LayoutDocsForTabPayloadSchema.safeParse({ tabId: 't1' }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @awakon/core test doc-ipc-schema`
Expected: FAIL — the new exports do not exist.

- [ ] **Step 3: Implement the channels + schemas**

In `packages/contracts/src/ipc.ts`, add the import for the persisted-doc schema near the top (after the existing persistence import):

```ts
import { PersistedSplitNodeSchema, PersistedOpenDocSchema } from './persistence.js';
```

(Replace the existing `import { PersistedSplitNodeSchema } from './persistence.js';` line.)

Add these entries to the `IpcChannel` object — the requests block:

```ts
  FsReadFile: 'core.fs.read-file',
  DocOpen: 'core.doc.open',
  LayoutPersistDocs: 'core.layout.persist-docs',
  LayoutDocsForTab: 'core.layout.docs-for-tab',
```

…and to the events block:

```ts
  DocOpenRequest: 'event.doc.open-request',
```

Then append these schemas at the end of the file (before the final re-export line):

```ts
// --- Doc reader payloads ---

/** Renderer/main reads a .md file's content for the reader. */
export const FsReadFilePayloadSchema = z.object({
  path: z.string().min(1),
});
export const FsReadFileResponseSchema = z.union([
  z.object({
    content: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    mtimeMs: z.number(),
  }),
  z.object({ tooLarge: z.literal(true), sizeBytes: z.number().int().nonnegative() }),
  z.object({ notFound: z.literal(true) }),
  z.object({ error: z.string() }),
]);

/** terminal-host -> main: the user clicked a .md link inside a pane. */
export const DocOpenPayloadSchema = z.object({
  sessionId: SessionIdSchema,
  path: z.string().min(1),
});

/** main -> chrome: open this doc in the owning tab's reader. */
export const DocOpenRequestEventSchema = z.object({
  tabId: SessionIdSchema,
  rawPath: z.string(),
  resolvedPath: z.string(),
  provenanceTitle: z.string(),
  provenanceStatus: SessionStatusSchema,
});

/** chrome -> main: persist a tab's reader docs (content excluded). */
export const LayoutPersistDocsPayloadSchema = z.object({
  tabId: SessionIdSchema,
  docs: z.array(PersistedOpenDocSchema),
  activeDocIndex: z.number().int().nullable(),
});

/** chrome -> main: fetch a tab's persisted reader docs (called on tab restore). */
export const LayoutDocsForTabPayloadSchema = z.object({
  tabId: SessionIdSchema,
});
export const LayoutDocsForTabResponseSchema = z.object({
  docs: z.array(PersistedOpenDocSchema),
  activeDocIndex: z.number().int().nullable(),
});
```

`SessionStatusSchema` is already imported at the top of `ipc.ts` via the `./session.js` import block — confirm it is listed there; if not, add it to that import.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @awakon/core test doc-ipc-schema`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ipc.ts packages/core/tests/doc-ipc-schema.test.ts
git commit -m "feat: add doc-reader IPC channels + schemas"
```

---

## Task 4: `core.fs.read-file` main handler

**Files:**
- Modify: `apps/desktop/src/main/fs-handlers.ts`
- Test: `apps/desktop/src/main/fs-handlers.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/src/main/fs-handlers.test.ts` (the `makeFakeIpc` helper and imports already exist):

```ts
describe('FsReadFile handler', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fs-read-'));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns content + stat for a real .md file', async () => {
    const md = join(tempDir, 'doc.md');
    await writeFile(md, '# Title');
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => null, {} as DialogLike);
    const result = await handlers.get('core.fs.read-file')!({}, { path: md }) as { content: string; sizeBytes: number };
    expect(result.content).toBe('# Title');
    expect(result.sizeBytes).toBe(7);
  });

  it('returns notFound for a missing file', async () => {
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => null, {} as DialogLike);
    const result = await handlers.get('core.fs.read-file')!({}, { path: join(tempDir, 'nope.md') });
    expect(result).toEqual({ notFound: true });
  });

  it('rejects a non-.md file with an error', async () => {
    const txt = join(tempDir, 'notes.txt');
    await writeFile(txt, 'hi');
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => null, {} as DialogLike);
    const result = await handlers.get('core.fs.read-file')!({}, { path: txt }) as { error: string };
    expect(result.error).toMatch(/\.md/);
  });

  it('returns tooLarge for a file over 1 MB', async () => {
    const big = join(tempDir, 'big.md');
    await writeFile(big, 'x'.repeat(1_048_577));
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => null, {} as DialogLike);
    const result = await handlers.get('core.fs.read-file')!({}, { path: big }) as { tooLarge: true; sizeBytes: number };
    expect(result.tooLarge).toBe(true);
    expect(result.sizeBytes).toBeGreaterThan(1_048_576);
  });

  it('returns an error for a malformed payload', async () => {
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => null, {} as DialogLike);
    const result = await handlers.get('core.fs.read-file')!({}, { wrong: 1 }) as { error: string };
    expect(typeof result.error).toBe('string');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @awakon/desktop test fs-handlers`
Expected: FAIL — `core.fs.read-file` handler not registered.

- [ ] **Step 3: Implement the handler**

In `apps/desktop/src/main/fs-handlers.ts`, extend the imports:

```ts
import { stat, readFile } from 'node:fs/promises';
import type { BrowserWindow } from 'electron';
import {
  FsPickDirectoryPayloadSchema,
  FsPathExistsPayloadSchema,
  FsReadFilePayloadSchema,
  IpcChannel,
} from '@awakon/contracts';
```

Then, inside `registerFsHandlers`, after the existing `FsPathExists` handler, add:

```ts
  const MAX_DOC_BYTES = 1_048_576; // 1 MB

  ipc.handle(IpcChannel.FsReadFile, async (_e, raw) => {
    const parsed = FsReadFilePayloadSchema.safeParse(raw);
    if (!parsed.success) return { error: parsed.error.message };
    const { path } = parsed.data;
    if (!path.toLowerCase().endsWith('.md')) {
      return { error: 'only .md files can be read by the reader' };
    }
    try {
      const st = await stat(path);
      if (st.size > MAX_DOC_BYTES) return { tooLarge: true, sizeBytes: st.size };
      const content = await readFile(path, 'utf8');
      return { content, sizeBytes: st.size, mtimeMs: st.mtimeMs };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return { notFound: true };
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @awakon/desktop test fs-handlers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/fs-handlers.ts apps/desktop/src/main/fs-handlers.test.ts
git commit -m "feat: add core.fs.read-file handler (.md-only, 1MB guard)"
```

---

## Task 5: terminal-host `.md` link matcher (pure)

**Files:**
- Create: `packages/terminal-host/src/md-links.ts`
- Create: `packages/terminal-host/vitest.config.ts`
- Create: `packages/terminal-host/src/md-links.test.ts`
- Modify: `packages/terminal-host/package.json`
- Modify: `packages/terminal-host/src/index.ts`

- [ ] **Step 1: Add a vitest config + test script to the package**

Create `packages/terminal-host/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
```

In `packages/terminal-host/package.json`, add a `test` script and vitest devDep. The `scripts` block should include:

```json
    "test": "vitest run"
```

and `devDependencies` should include:

```json
    "vitest": "^2.1.0"
```

Then install:

```bash
pnpm --filter @awakon/terminal-host install
```

- [ ] **Step 2: Write the failing test**

Create `packages/terminal-host/src/md-links.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findMarkdownLinks } from './md-links.js';

describe('findMarkdownLinks', () => {
  it('finds a simple relative .md path', () => {
    const hits = findMarkdownLinks('see docs/migration.md for details');
    expect(hits).toEqual([{ text: 'docs/migration.md', start: 4, end: 21 }]);
  });

  it('finds multiple links on a line', () => {
    const hits = findMarkdownLinks('a.md and b/c.md');
    expect(hits.map((h) => h.text)).toEqual(['a.md', 'b/c.md']);
  });

  it('matches a bare filename', () => {
    expect(findMarkdownLinks('README.md').map((h) => h.text)).toEqual(['README.md']);
  });

  it('matches ./ and ../ prefixes', () => {
    expect(findMarkdownLinks('./a.md ../b.md').map((h) => h.text)).toEqual(['./a.md', '../b.md']);
  });

  it('strips a trailing paren/period that is not part of the path', () => {
    expect(findMarkdownLinks('(see docs/x.md).').map((h) => h.text)).toEqual(['docs/x.md']);
  });

  it('ignores .markdown and bare "md"', () => {
    expect(findMarkdownLinks('notes.markdown and md alone')).toEqual([]);
  });

  it('returns correct start/end offsets for slicing', () => {
    const line = 'open README.md now';
    const [hit] = findMarkdownLinks(line);
    expect(line.slice(hit!.start, hit!.end)).toBe('README.md');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @awakon/terminal-host test`
Expected: FAIL — `md-links.ts` does not exist.

- [ ] **Step 4: Implement the matcher**

Create `packages/terminal-host/src/md-links.ts`:

```ts
export interface MarkdownLinkHit {
  /** The matched path text (trailing punctuation stripped). */
  text: string;
  /** Inclusive start offset into the line. */
  start: number;
  /** Exclusive end offset into the line. */
  end: number;
}

// A path-like run of characters ending in `.md`, with a word boundary after.
// Allows ./ ../ segments, letters/digits/_/-/. and / separators.
const MD_PATH_RE = /(?:\.{0,2}\/)?(?:[\w.-]+\/)*[\w.-]+\.md\b/g;

/**
 * Find `.md` path references in a single rendered terminal line. Pure string logic —
 * no filesystem access. Trailing `)` `.` `,` characters adjacent to the boundary are
 * excluded from the returned offsets so links inside prose ("(see x.md).") resolve cleanly.
 */
export function findMarkdownLinks(line: string): MarkdownLinkHit[] {
  const hits: MarkdownLinkHit[] = [];
  for (const m of line.matchAll(MD_PATH_RE)) {
    const start = m.index;
    let text = m[0];
    let end = start + text.length;
    // Defensive: \b already prevents trailing punctuation here, but keep the trim
    // in case the regex evolves.
    while (text.length > 3 && /[).,]$/.test(text)) {
      text = text.slice(0, -1);
      end -= 1;
    }
    hits.push({ text, start, end });
  }
  return hits;
}
```

- [ ] **Step 5: Export it from the package index**

In `packages/terminal-host/src/index.ts`, add:

```ts
export { findMarkdownLinks } from './md-links.js';
export type { MarkdownLinkHit } from './md-links.js';
```

(Confirm `index.ts` already re-exports `TerminalHost` / `PreloadBridge`; leave those intact.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @awakon/terminal-host test`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/terminal-host/src/md-links.ts packages/terminal-host/src/md-links.test.ts packages/terminal-host/src/index.ts packages/terminal-host/vitest.config.ts packages/terminal-host/package.json pnpm-lock.yaml
git commit -m "feat: add pure .md link matcher in terminal-host"
```

---

## Task 6: Register the `.md` link provider in TerminalHost

**Files:**
- Modify: `packages/terminal-host/src/terminal-host.ts`

This wires the matcher into xterm's `registerLinkProvider` so `.md` paths become clickable; clicking sends `core.doc.open`. This is DOM/xterm integration — verified by build + manual run, not a unit test (the matcher itself is covered by Task 5).

- [ ] **Step 1: Add the import for the matcher**

At the top of `packages/terminal-host/src/terminal-host.ts`, add:

```ts
import { findMarkdownLinks } from './md-links.js';
import type { ILinkProvider, ILink, IBufferLine } from '@xterm/xterm';
```

(Keep the existing imports. `ILinkProvider`/`ILink`/`IBufferLine` are type-only.)

- [ ] **Step 2: Register the link provider in the constructor**

In the `TerminalHost` constructor, immediately after `this.term.loadAddon(new WebLinksAddon());`, add:

```ts
    this.term.registerLinkProvider(this.markdownLinkProvider());
```

- [ ] **Step 3: Implement the provider method**

Add this private method to the `TerminalHost` class (e.g. after `dispose()`):

```ts
  /** xterm link provider: underlines `.md` paths and opens the reader on click. */
  private markdownLinkProvider(): ILinkProvider {
    const term = this.term;
    const bridge = this.bridge;
    const sessionId = this.sessionId;
    return {
      provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
        const line: IBufferLine | undefined = term.buffer.active.getLine(bufferLineNumber - 1);
        if (!line) { callback(undefined); return; }
        const text = line.translateToString(true);
        const hits = findMarkdownLinks(text);
        if (hits.length === 0) { callback(undefined); return; }
        const links: ILink[] = hits.map((hit) => ({
          // xterm ranges are 1-based, end inclusive.
          range: {
            start: { x: hit.start + 1, y: bufferLineNumber },
            end: { x: hit.end, y: bufferLineNumber },
          },
          text: hit.text,
          activate: (): void => {
            void bridge.send(IpcChannel.DocOpen, { sessionId, path: hit.text });
          },
        }));
        callback(links);
      },
    };
  }
```

- [ ] **Step 4: Verify it compiles**

Run: `pnpm --filter @awakon/terminal-host typecheck`
Expected: PASS (no type errors).

Run: `pnpm --filter @awakon/terminal-host test`
Expected: PASS (matcher tests still green).

- [ ] **Step 5: Commit**

```bash
git add packages/terminal-host/src/terminal-host.ts
git commit -m "feat: clickable .md links in the terminal open the doc reader"
```

---

## Task 7: IpcRouter doc-open / persist-docs / docs-for-tab callbacks

**Files:**
- Modify: `packages/core/src/ipc-router.ts`
- Test: `packages/core/src/ipc-router.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/ipc-router.test.ts` (or append the `describe` block if it exists):

```ts
import { describe, expect, it, vi } from 'vitest';
import { IpcRouter } from './ipc-router.js';
import { IpcChannel } from '@awakon/contracts';

type Handler = (e: unknown, raw: unknown) => unknown;

function makeRouter(): { router: IpcRouter; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const ipcMain = {
    handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
  } as unknown as import('electron').IpcMain;
  // Minimal SessionManager stand-in: only `.on` is touched by the constructor.
  const manager = { on: vi.fn(), list: vi.fn(() => []), get: vi.fn() } as never;
  const router = new IpcRouter(ipcMain, manager);
  return { router, handlers };
}

describe('IpcRouter — doc.open', () => {
  it('invokes the doc-open callback with sessionId + path', () => {
    const { router, handlers } = makeRouter();
    const cb = vi.fn();
    router.onDocOpen(cb);
    const res = handlers.get(IpcChannel.DocOpen)!({}, { sessionId: 's1', path: 'a.md' });
    expect(cb).toHaveBeenCalledWith('s1', 'a.md');
    expect(res).toEqual({ ok: true });
  });

  it('rejects a malformed doc-open payload', () => {
    const { router, handlers } = makeRouter();
    router.onDocOpen(vi.fn());
    const res = handlers.get(IpcChannel.DocOpen)!({}, { sessionId: 's1' }) as { error: string };
    expect(typeof res.error).toBe('string');
  });
});

describe('IpcRouter — persist-docs / docs-for-tab', () => {
  it('forwards persist-docs to the callback', () => {
    const { router, handlers } = makeRouter();
    const cb = vi.fn();
    router.onPersistDocs(cb);
    handlers.get(IpcChannel.LayoutPersistDocs)!({}, { tabId: 't1', docs: [], activeDocIndex: null });
    expect(cb).toHaveBeenCalledWith('t1', [], null);
  });

  it('returns the docs-for-tab callback result', () => {
    const { router, handlers } = makeRouter();
    router.onDocsForTab(() => ({ docs: [], activeDocIndex: 0 }));
    const res = handlers.get(IpcChannel.LayoutDocsForTab)!({}, { tabId: 't1' });
    expect(res).toEqual({ docs: [], activeDocIndex: 0 });
  });

  it('returns an empty default when no docs-for-tab callback is set', () => {
    const { router, handlers } = makeRouter();
    const res = handlers.get(IpcChannel.LayoutDocsForTab)!({}, { tabId: 't1' });
    expect(res).toEqual({ docs: [], activeDocIndex: null });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @awakon/core test ipc-router`
Expected: FAIL — `onDocOpen` / `onPersistDocs` / `onDocsForTab` not defined.

- [ ] **Step 3: Implement the callbacks**

In `packages/core/src/ipc-router.ts`:

Add to the imports from `@awakon/contracts`:

```ts
  DocOpenPayloadSchema,
  LayoutPersistDocsPayloadSchema,
  LayoutDocsForTabPayloadSchema,
```

Add to the type imports from `@awakon/contracts`:

```ts
  PersistedOpenDoc,
```

Add these callback types near the other `export type ...Callback` lines:

```ts
export type DocOpenCallback = (sessionId: SessionId, path: string) => void;
export type PersistDocsCallback = (
  tabId: SessionId,
  docs: PersistedOpenDoc[],
  activeDocIndex: number | null,
) => void;
export type DocsForTabCallback = (
  tabId: SessionId,
) => { docs: PersistedOpenDoc[]; activeDocIndex: number | null };
```

Add the private fields next to the existing `private ...Callback ... = null;` declarations:

```ts
  private docOpenCallback: DocOpenCallback | null = null;
  private persistDocsCallback: PersistDocsCallback | null = null;
  private docsForTabCallback: DocsForTabCallback | null = null;
```

Add the registration methods next to the other `on...` methods:

```ts
  onDocOpen(cb: DocOpenCallback): void {
    this.docOpenCallback = cb;
  }

  onPersistDocs(cb: PersistDocsCallback): void {
    this.persistDocsCallback = cb;
  }

  onDocsForTab(cb: DocsForTabCallback): void {
    this.docsForTabCallback = cb;
  }
```

Add these handlers at the end of `bindRequests()` (before its closing brace):

```ts
    this.ipcMain.handle(IpcChannel.DocOpen, (_e, raw): { ok: true } | { error: string } => {
      const parsed = DocOpenPayloadSchema.safeParse(raw);
      if (!parsed.success) return { error: parsed.error.message };
      this.docOpenCallback?.(parsed.data.sessionId, parsed.data.path);
      return { ok: true };
    });

    this.ipcMain.handle(IpcChannel.LayoutPersistDocs, (_e, raw): { ok: true } | { error: string } => {
      const parsed = LayoutPersistDocsPayloadSchema.safeParse(raw);
      if (!parsed.success) return { error: parsed.error.message };
      this.persistDocsCallback?.(parsed.data.tabId, parsed.data.docs, parsed.data.activeDocIndex);
      return { ok: true };
    });

    this.ipcMain.handle(
      IpcChannel.LayoutDocsForTab,
      (_e, raw): { docs: PersistedOpenDoc[]; activeDocIndex: number | null } | { error: string } => {
        const parsed = LayoutDocsForTabPayloadSchema.safeParse(raw);
        if (!parsed.success) return { error: parsed.error.message };
        return this.docsForTabCallback?.(parsed.data.tabId) ?? { docs: [], activeDocIndex: null };
      },
    );
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @awakon/core test ipc-router`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ipc-router.ts packages/core/src/ipc-router.test.ts
git commit -m "feat: route doc.open + reader-doc persistence in IpcRouter"
```

---

## Task 8: Main — resolve doc-open, persist docs, snapshot v3

**Files:**
- Modify: `apps/desktop/src/main/index.ts`

Module-level wiring; verified by `typecheck`. No new unit test (router + handler are covered).

- [ ] **Step 1: Extend imports**

In `apps/desktop/src/main/index.ts`, add `isAbsolute, join` usage (`join` is already imported from `node:path`; add `isAbsolute`):

```ts
import { dirname, join, isAbsolute } from 'node:path';
```

Add `PersistedOpenDoc` to the contracts type import list:

```ts
import type { Shell, SessionInfo, AppSettings, PersistedTab, PersistedSplitNode, PersistedOpenDoc, ChromeAppInfoResponse, RecentTab } from '@awakon/contracts';
```

Add `IpcChannel` is already imported from `@awakon/core`; `DocOpenRequest` is referenced via `IpcChannel.DocOpenRequest`.

- [ ] **Step 2: Update snapshotTabs to version 3**

Replace the `snapshotTabs` function's return type + literal:

```ts
function snapshotTabs(): {
  version: 3;
  tabs: PersistedTab[];
  focusedTabId: string | null;
} {
  return {
    version: 3,
    tabs: tabOrder.filter((id) => tabMeta.has(id)).map((id) => tabMeta.get(id)!),
    focusedTabId: focusedSessionId,
  };
}
```

- [ ] **Step 3: Wire the doc-open resolver + persistence callbacks**

After the existing `ipcRouter.onSplitsForTab(...)` line, add:

```ts
// terminal-host clicked a .md link → resolve the owning tab + provenance, then ask the
// chrome to open it in that tab's reader.
ipcRouter.onDocOpen((sessionId, path) => {
  const tabId = paneOwnership.get(sessionId) ?? sessionId;
  const meta = tabMeta.get(tabId);
  const cwd = meta?.cwd ?? homedir();
  const resolvedPath = isAbsolute(path) ? path : join(cwd, path);
  const session = sessionManager.get(sessionId) ?? sessionManager.get(tabId);
  const info = session?.info();
  chromeWindow?.webContents.send(IpcChannel.DocOpenRequest, {
    tabId,
    rawPath: path,
    resolvedPath,
    provenanceTitle: info?.title ?? meta?.title ?? meta?.shell ?? 'session',
    provenanceStatus: info?.status ?? 'running',
  });
});

// chrome persists a tab's reader docs (markers survive restart; content does not).
ipcRouter.onPersistDocs((tabId, docs: PersistedOpenDoc[], activeDocIndex) => {
  const meta = tabMeta.get(tabId);
  if (!meta) return;
  if (docs.length === 0) {
    delete meta.docs;
    delete meta.activeDocIndex;
  } else {
    meta.docs = docs;
    meta.activeDocIndex = activeDocIndex;
  }
  persistTabs();
});

// chrome asks for a tab's persisted reader docs when it restores the tab.
ipcRouter.onDocsForTab((tabId) => {
  const meta = tabMeta.get(tabId);
  return { docs: meta?.docs ?? [], activeDocIndex: meta?.activeDocIndex ?? null };
});
```

- [ ] **Step 4: Verify it compiles**

Run: `pnpm --filter @awakon/desktop typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/index.ts
git commit -m "feat: resolve doc-open + persist reader docs in main"
```

---

## Task 9: Chrome doc-state — types + pure reducers

**Files:**
- Create: `apps/desktop/src/renderer/chrome/doc-state.ts`
- Create: `apps/desktop/src/renderer/chrome/doc-state.test.ts`
- Modify: `apps/desktop/src/renderer/chrome/state.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/renderer/chrome/doc-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  emptyDocState,
  openDoc,
  closeDocAt,
  setReview,
  toPersistedDocs,
  fromPersistedDocs,
  type OpenDoc,
} from './doc-state.js';

function sampleDoc(over: Partial<OpenDoc> = {}): OpenDoc {
  return {
    rawPath: 'docs/a.md',
    resolvedPath: '/x/docs/a.md',
    provenanceTitle: 'pwsh',
    provenanceStatus: 'running',
    reviewState: 'proposed',
    ...over,
  };
}

describe('openDoc', () => {
  it('adds a new doc, makes it active + visible', () => {
    const s = openDoc(emptyDocState(), sampleDoc());
    expect(s.openDocs).toHaveLength(1);
    expect(s.activeDocIndex).toBe(0);
    expect(s.readerVisible).toBe(true);
  });

  it('does not duplicate an already-open doc; re-activates it', () => {
    let s = openDoc(emptyDocState(), sampleDoc({ resolvedPath: '/x/a.md' }));
    s = openDoc(s, sampleDoc({ resolvedPath: '/x/b.md' }));
    s = openDoc(s, sampleDoc({ resolvedPath: '/x/a.md' }));
    expect(s.openDocs).toHaveLength(2);
    expect(s.activeDocIndex).toBe(0);
    expect(s.readerVisible).toBe(true);
  });
});

describe('closeDocAt', () => {
  it('removes a doc and clamps the active index', () => {
    let s = openDoc(emptyDocState(), sampleDoc({ resolvedPath: '/x/a.md' }));
    s = openDoc(s, sampleDoc({ resolvedPath: '/x/b.md' }));
    s = closeDocAt(s, 1); // close the active one
    expect(s.openDocs).toHaveLength(1);
    expect(s.activeDocIndex).toBe(0);
  });

  it('closing the last doc clears the reader', () => {
    let s = openDoc(emptyDocState(), sampleDoc());
    s = closeDocAt(s, 0);
    expect(s.openDocs).toHaveLength(0);
    expect(s.activeDocIndex).toBeNull();
    expect(s.readerVisible).toBe(false);
  });
});

describe('setReview', () => {
  it('updates the review state of a doc', () => {
    let s = openDoc(emptyDocState(), sampleDoc());
    s = setReview(s, 0, 'approved');
    expect(s.openDocs[0]!.reviewState).toBe('approved');
  });
});

describe('persistence round-trip', () => {
  it('toPersistedDocs strips nothing structural; fromPersistedDocs restores parked', () => {
    let s = openDoc(emptyDocState(), sampleDoc());
    const persisted = toPersistedDocs(s);
    const restored = fromPersistedDocs(persisted.docs, persisted.activeDocIndex);
    expect(restored.openDocs).toEqual(s.openDocs);
    expect(restored.activeDocIndex).toBe(0);
    expect(restored.readerVisible).toBe(false); // restored docs are parked, not shown
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @awakon/desktop test doc-state`
Expected: FAIL — `doc-state.ts` does not exist.

- [ ] **Step 3: Implement doc-state**

Create `apps/desktop/src/renderer/chrome/doc-state.ts`:

```ts
import type { SessionStatus, PersistedOpenDoc, ReviewState } from '@awakon/contracts';

export type { ReviewState } from '@awakon/contracts';

/** A markdown doc opened in a tab's reader. */
export interface OpenDoc {
  rawPath: string;
  resolvedPath: string;
  provenanceTitle: string;
  provenanceStatus: SessionStatus;
  reviewState: ReviewState;
}

/** Per-tab reader state. */
export interface TabDocState {
  openDocs: OpenDoc[];
  activeDocIndex: number | null; // null = no doc / reader closed
  readerVisible: boolean;        // meaningful on the active tab
}

export function emptyDocState(): TabDocState {
  return { openDocs: [], activeDocIndex: null, readerVisible: false };
}

/** Open (or re-activate) a doc, identified by resolvedPath. Returns a new state. */
export function openDoc(state: TabDocState, doc: OpenDoc): TabDocState {
  const existing = state.openDocs.findIndex((d) => d.resolvedPath === doc.resolvedPath);
  if (existing >= 0) {
    return { ...state, activeDocIndex: existing, readerVisible: true };
  }
  const openDocs = [...state.openDocs, doc];
  return { openDocs, activeDocIndex: openDocs.length - 1, readerVisible: true };
}

/** Close one doc by index. Clears the reader when none remain. */
export function closeDocAt(state: TabDocState, index: number): TabDocState {
  const openDocs = state.openDocs.filter((_, i) => i !== index);
  if (openDocs.length === 0) {
    return { openDocs, activeDocIndex: null, readerVisible: false };
  }
  let activeDocIndex = state.activeDocIndex ?? 0;
  if (index < activeDocIndex) activeDocIndex -= 1;
  else if (index === activeDocIndex) activeDocIndex = Math.min(activeDocIndex, openDocs.length - 1);
  return { ...state, openDocs, activeDocIndex };
}

/** Set a doc's review state. */
export function setReview(state: TabDocState, index: number, review: ReviewState): TabDocState {
  const openDocs = state.openDocs.map((d, i) => (i === index ? { ...d, reviewState: review } : d));
  return { ...state, openDocs };
}

/** Move the active doc by a delta (clamped). */
export function moveActive(state: TabDocState, delta: number): TabDocState {
  if (state.activeDocIndex === null || state.openDocs.length === 0) return state;
  const next = Math.max(0, Math.min(state.openDocs.length - 1, state.activeDocIndex + delta));
  return { ...state, activeDocIndex: next };
}

export function toPersistedDocs(state: TabDocState): {
  docs: PersistedOpenDoc[];
  activeDocIndex: number | null;
} {
  return { docs: state.openDocs.map((d) => ({ ...d })), activeDocIndex: state.activeDocIndex };
}

/** Restore persisted docs as a parked reader (markers visible, panel hidden). */
export function fromPersistedDocs(
  docs: PersistedOpenDoc[],
  activeDocIndex: number | null,
): TabDocState {
  return {
    openDocs: docs.map((d) => ({ ...d })),
    activeDocIndex: docs.length > 0 ? activeDocIndex : null,
    readerVisible: false,
  };
}
```

- [ ] **Step 4: Attach docState to SessionState**

In `apps/desktop/src/renderer/chrome/state.ts`, import the type and extend `SessionState` (import only the **type** — `emptyDocState` is used in `layout-manager.ts`, not here, so importing it in `state.ts` would trip `noUnusedLocals`):

```ts
import type { SessionId, SessionInfo, RecentTab } from '@awakon/contracts';
import type { TabDocState } from './doc-state.js';

export interface SessionState {
  info: SessionInfo;
  attention: boolean;
  broken: boolean;
  statusSinceMs: number;
  resumeAt: number | null;
  /** Per-tab markdown reader state. */
  docState: TabDocState;
}
```

The `ChromeState` / `emptyState()` are unchanged. Any code creating a fresh `SessionState` must include `docState: emptyDocState()` — that is done in Task 14, which imports `emptyDocState` from `doc-state.js` directly.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @awakon/desktop test doc-state`
Expected: PASS.

(`state.ts` won't fully typecheck until Task 14 adds `docState` to the fresh-session literal — that's expected; the unit tests for `doc-state.ts` pass independently.)

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/chrome/doc-state.ts apps/desktop/src/renderer/chrome/doc-state.test.ts apps/desktop/src/renderer/chrome/state.ts
git commit -m "feat: per-tab reader doc-state + pure reducers"
```

---

## Task 10: Chrome markdown renderer

**Files:**
- Create: `apps/desktop/src/renderer/chrome/markdown.ts`
- Create: `apps/desktop/src/renderer/chrome/markdown.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/renderer/chrome/markdown.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown, countLoc } from './markdown.js';

describe('renderMarkdown', () => {
  it('renders headings and paragraphs', () => {
    const html = renderMarkdown('# Title\n\nHello world');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<p>Hello world</p>');
  });

  it('renders fenced code blocks', () => {
    const html = renderMarkdown('```\nconst x = 1;\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('const x = 1;');
  });

  it('sanitizes script tags', () => {
    const html = renderMarkdown('ok <script>alert(1)</script>');
    expect(html).not.toContain('<script>');
  });

  it('strips event-handler attributes', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('onerror');
  });
});

describe('countLoc', () => {
  it('counts lines of the raw source', () => {
    expect(countLoc('a\nb\nc')).toBe(3);
    expect(countLoc('')).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @awakon/desktop test markdown`
Expected: FAIL — `markdown.ts` does not exist.

- [ ] **Step 3: Implement the renderer**

Create `apps/desktop/src/renderer/chrome/markdown.ts`:

```ts
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

const md = new MarkdownIt({
  html: false,      // do not pass through raw HTML by default
  linkify: true,
  breaks: false,
});

/** Render markdown source to sanitized HTML for the reader body. */
export function renderMarkdown(source: string): string {
  const rawHtml = md.render(source);
  return DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
}

/** Lines of source — shown as "N LOC" in the reader footer. */
export function countLoc(source: string): number {
  if (source === '') return 0;
  return source.split('\n').length;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @awakon/desktop test markdown`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/chrome/markdown.ts apps/desktop/src/renderer/chrome/markdown.test.ts
git commit -m "feat: markdown render + sanitize helper for the reader"
```

---

## Task 11: DocReader overlay component

**Files:**
- Create: `apps/desktop/src/renderer/chrome/doc-reader.ts`
- Create: `apps/desktop/src/renderer/chrome/doc-reader.test.ts`

The `DocReader` renders the scrim + sliding panel into a host element (the chrome's `#view-host`). It is driven by `render(state)`; it asynchronously loads the active doc's body via the bridge and emits user intents through callbacks. State lives in the LayoutManager (Task 14).

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/renderer/chrome/doc-reader.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocReader } from './doc-reader.js';
import { emptyDocState, openDoc, type OpenDoc } from './doc-state.js';

function doc(over: Partial<OpenDoc> = {}): OpenDoc {
  return {
    rawPath: 'docs/migration.md',
    resolvedPath: '/x/docs/migration.md',
    provenanceTitle: 'pwsh',
    provenanceStatus: 'running',
    reviewState: 'proposed',
    ...over,
  };
}

const callbacks = () => ({
  onDismiss: vi.fn(),
  onSelectFile: vi.fn(),
  onCloseFile: vi.fn(),
  onReview: vi.fn(),
  onPrevFile: vi.fn(),
  onNextFile: vi.fn(),
});

function fakeBridge(response: unknown) {
  return { send: vi.fn().mockResolvedValue(response) };
}

let host: HTMLElement;
beforeEach(() => { document.body.innerHTML = ''; host = document.createElement('div'); document.body.appendChild(host); });
afterEach(() => { vi.restoreAllMocks(); });

describe('DocReader visibility', () => {
  it('renders nothing when readerVisible is false', () => {
    const r = new DocReader(host, fakeBridge({ notFound: true }), callbacks());
    r.render(emptyDocState());
    expect(host.querySelector('.aip-reader')).toBeNull();
  });

  it('renders the panel + scrim when a doc is active and visible', () => {
    const r = new DocReader(host, fakeBridge({ content: '# Hi', sizeBytes: 4, mtimeMs: 1 }), callbacks());
    r.render(openDoc(emptyDocState(), doc()));
    expect(host.querySelector('.aip-reader')).not.toBeNull();
    expect(host.querySelector('.aip-reader__scrim')).not.toBeNull();
  });
});

describe('DocReader file tabs', () => {
  it('renders one file tab per open doc with the active one marked', () => {
    const r = new DocReader(host, fakeBridge({ notFound: true }), callbacks());
    let s = openDoc(emptyDocState(), doc({ resolvedPath: '/x/a.md', rawPath: 'a.md' }));
    s = openDoc(s, doc({ resolvedPath: '/x/b.md', rawPath: 'b.md' }));
    r.render(s);
    const tabs = host.querySelectorAll('.aip-reader__file');
    expect(tabs).toHaveLength(2);
    expect(host.querySelectorAll('.aip-reader__file.active')).toHaveLength(1);
  });

  it('fires onSelectFile when a non-active file tab is clicked', () => {
    const cb = callbacks();
    const r = new DocReader(host, fakeBridge({ notFound: true }), cb);
    let s = openDoc(emptyDocState(), doc({ resolvedPath: '/x/a.md' }));
    s = openDoc(s, doc({ resolvedPath: '/x/b.md' }));
    r.render(s);
    (host.querySelectorAll('.aip-reader__file')[0] as HTMLElement).click();
    expect(cb.onSelectFile).toHaveBeenCalledWith(0);
  });

  it('fires onCloseFile when a file tab × is clicked', () => {
    const cb = callbacks();
    const r = new DocReader(host, fakeBridge({ notFound: true }), cb);
    r.render(openDoc(emptyDocState(), doc()));
    (host.querySelector('.aip-reader__file-close') as HTMLElement).click();
    expect(cb.onCloseFile).toHaveBeenCalledWith(0);
  });
});

describe('DocReader review actions', () => {
  it('fires onReview("approved") when Approve is clicked', () => {
    const cb = callbacks();
    const r = new DocReader(host, fakeBridge({ notFound: true }), cb);
    r.render(openDoc(emptyDocState(), doc()));
    (host.querySelector('.aip-reader__approve') as HTMLElement).click();
    expect(cb.onReview).toHaveBeenCalledWith(0, 'approved');
  });

  it('fires onReview("changes-requested") when Request changes is clicked', () => {
    const cb = callbacks();
    const r = new DocReader(host, fakeBridge({ notFound: true }), cb);
    r.render(openDoc(emptyDocState(), doc()));
    (host.querySelector('.aip-reader__request') as HTMLElement).click();
    expect(cb.onReview).toHaveBeenCalledWith(0, 'changes-requested');
  });

  it('shows the provenance title', () => {
    const r = new DocReader(host, fakeBridge({ notFound: true }), callbacks());
    r.render(openDoc(emptyDocState(), doc({ provenanceTitle: 'claude · refactor' })));
    expect(host.querySelector('.aip-reader__provenance')?.textContent).toContain('claude · refactor');
  });
});

describe('DocReader dismiss', () => {
  it('fires onDismiss on scrim click', () => {
    const cb = callbacks();
    const r = new DocReader(host, fakeBridge({ notFound: true }), cb);
    r.render(openDoc(emptyDocState(), doc()));
    (host.querySelector('.aip-reader__scrim') as HTMLElement).click();
    expect(cb.onDismiss).toHaveBeenCalled();
  });

  it('fires onDismiss on Escape while visible', () => {
    const cb = callbacks();
    const r = new DocReader(host, fakeBridge({ notFound: true }), cb);
    r.render(openDoc(emptyDocState(), doc()));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cb.onDismiss).toHaveBeenCalled();
  });
});

describe('DocReader body', () => {
  it('renders a "(not yet created)" placeholder for a missing file', async () => {
    const r = new DocReader(host, fakeBridge({ notFound: true }), callbacks());
    r.render(openDoc(emptyDocState(), doc({ rawPath: 'docs/new.md' })));
    await Promise.resolve(); await Promise.resolve();
    expect(host.querySelector('.aip-reader__body')?.textContent).toContain('not yet created');
  });

  it('renders parsed markdown for an existing file', async () => {
    const r = new DocReader(host, fakeBridge({ content: '# Heading', sizeBytes: 9, mtimeMs: 1 }), callbacks());
    r.render(openDoc(emptyDocState(), doc()));
    await Promise.resolve(); await Promise.resolve();
    expect(host.querySelector('.aip-reader__body h1')?.textContent).toBe('Heading');
  });

  it('renders a large-file placeholder', async () => {
    const r = new DocReader(host, fakeBridge({ tooLarge: true, sizeBytes: 2_000_000 }), callbacks());
    r.render(openDoc(emptyDocState(), doc()));
    await Promise.resolve(); await Promise.resolve();
    expect(host.querySelector('.aip-reader__body')?.textContent).toContain('too large');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @awakon/desktop test doc-reader`
Expected: FAIL — `doc-reader.ts` does not exist.

- [ ] **Step 3: Implement DocReader**

Create `apps/desktop/src/renderer/chrome/doc-reader.ts`:

```ts
import { IpcChannel, type FsReadFileResponseSchema } from '@awakon/contracts';
import type { z } from 'zod';
import type { TabDocState, ReviewState } from './doc-state.js';
import { renderMarkdown, countLoc } from './markdown.js';

type ReadFileResponse = z.infer<typeof FsReadFileResponseSchema>;

interface Bridge {
  send: (channel: string, payload?: unknown) => Promise<unknown>;
}

export interface DocReaderCallbacks {
  onDismiss: () => void;
  onSelectFile: (index: number) => void;
  onCloseFile: (index: number) => void;
  onReview: (index: number, review: ReviewState) => void;
  onPrevFile: () => void;
  onNextFile: () => void;
}

/**
 * Renders the right-side modal markdown reader into a host element (the chrome's
 * #view-host). Driven by render(state); loads the active doc body asynchronously.
 * State is owned by the LayoutManager.
 */
export class DocReader {
  private readonly host: HTMLElement;
  private readonly bridge: Bridge;
  private readonly cb: DocReaderCallbacks;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  /** Guards against a stale async body write after the active doc changed. */
  private loadToken = 0;

  constructor(host: HTMLElement, bridge: Bridge, callbacks: DocReaderCallbacks) {
    this.host = host;
    this.bridge = bridge;
    this.cb = callbacks;
  }

  render(state: TabDocState): void {
    this.teardownKeys();
    const existing = this.host.querySelector('.aip-reader');
    if (existing) existing.remove();

    const visible = state.readerVisible && state.activeDocIndex !== null && state.openDocs.length > 0;
    if (!visible) return;

    const activeIndex = state.activeDocIndex!;
    const active = state.openDocs[activeIndex]!;

    const root = document.createElement('div');
    root.className = 'aip-reader';
    root.innerHTML = `
      <div class="aip-reader__scrim">
        <div class="aip-reader__scrim-hint">click or esc to close</div>
      </div>
      <div class="aip-reader__panel" role="dialog" aria-label="Markdown reader">
        <div class="aip-reader__files"></div>
        <div class="aip-reader__review">
          <span class="aip-reader__path"></span>
          <span class="aip-reader__provenance"></span>
          <div class="aip-reader__actions">
            <button type="button" class="aip-reader__approve">✓ Approve</button>
            <button type="button" class="aip-reader__request">✎ Request changes</button>
          </div>
        </div>
        <div class="aip-reader__body"></div>
        <div class="aip-reader__footer">
          <div class="aip-reader__hints">
            <span><span class="k">esc</span> close</span>
            <span><span class="k">${mod()}[</span> prev file</span>
            <span><span class="k">${mod()}]</span> next file</span>
          </div>
          <span class="aip-reader__stats"></span>
        </div>
      </div>
    `;
    this.host.appendChild(root);

    // Scrim dismiss.
    root.querySelector<HTMLElement>('.aip-reader__scrim')!
      .addEventListener('click', () => this.cb.onDismiss());

    // File tabs.
    const filesEl = root.querySelector<HTMLElement>('.aip-reader__files')!;
    state.openDocs.forEach((d, i) => {
      const tab = document.createElement('div');
      tab.className = 'aip-reader__file' + (i === activeIndex ? ' active' : '');
      const glyph = document.createElement('span');
      glyph.className = 'aip-reader__file-glyph';
      glyph.textContent = 'M↓';
      const name = document.createElement('span');
      name.className = 'aip-reader__file-name';
      name.textContent = basename(d.rawPath);
      const close = document.createElement('span');
      close.className = 'aip-reader__file-close';
      close.textContent = '×';
      close.title = 'Close file';
      close.addEventListener('click', (ev) => { ev.stopPropagation(); this.cb.onCloseFile(i); });
      tab.append(glyph, name, close);
      tab.addEventListener('click', () => { if (i !== activeIndex) this.cb.onSelectFile(i); });
      filesEl.appendChild(tab);
    });
    // Right-aligned close cell.
    const closeCell = document.createElement('div');
    closeCell.className = 'aip-reader__close';
    closeCell.title = 'Close (esc)';
    closeCell.textContent = '×';
    closeCell.addEventListener('click', () => this.cb.onDismiss());
    filesEl.appendChild(closeCell);

    // Review bar.
    const pathEl = root.querySelector<HTMLElement>('.aip-reader__path')!;
    pathEl.textContent = active.rawPath;
    const prov = root.querySelector<HTMLElement>('.aip-reader__provenance')!;
    prov.textContent = `proposed by ${active.provenanceTitle}`;
    const approve = root.querySelector<HTMLButtonElement>('.aip-reader__approve')!;
    const request = root.querySelector<HTMLButtonElement>('.aip-reader__request')!;
    approve.classList.toggle('is-on', active.reviewState === 'approved');
    request.classList.toggle('is-on', active.reviewState === 'changes-requested');
    approve.addEventListener('click', () => this.cb.onReview(activeIndex, 'approved'));
    request.addEventListener('click', () => this.cb.onReview(activeIndex, 'changes-requested'));

    // Body (async).
    const bodyEl = root.querySelector<HTMLElement>('.aip-reader__body')!;
    const statsEl = root.querySelector<HTMLElement>('.aip-reader__stats')!;
    void this.loadBody(active.resolvedPath, bodyEl, statsEl);

    // Keyboard while visible.
    this.keyHandler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); this.cb.onDismiss(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === '[') { e.preventDefault(); this.cb.onPrevFile(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === ']') { e.preventDefault(); this.cb.onNextFile(); }
    };
    document.addEventListener('keydown', this.keyHandler);
  }

  private async loadBody(resolvedPath: string, bodyEl: HTMLElement, statsEl: HTMLElement): Promise<void> {
    const token = ++this.loadToken;
    let res: ReadFileResponse;
    try {
      res = (await this.bridge.send(IpcChannel.FsReadFile, { path: resolvedPath })) as ReadFileResponse;
    } catch {
      res = { error: 'failed to read file' };
    }
    if (token !== this.loadToken) return; // a newer render superseded us
    if (!bodyEl.isConnected) return;

    if ('content' in res) {
      bodyEl.innerHTML = `<div class="aip-reader__prose">${renderMarkdown(res.content)}</div>`;
      statsEl.textContent = `${countLoc(res.content)} LOC · ${formatKb(res.sizeBytes)}`;
    } else if ('tooLarge' in res) {
      bodyEl.textContent = `This file is too large to preview (${formatKb(res.sizeBytes)}).`;
      statsEl.textContent = formatKb(res.sizeBytes);
    } else if ('notFound' in res) {
      bodyEl.textContent = `${resolvedPath} (not yet created)`;
      statsEl.textContent = '';
    } else {
      bodyEl.textContent = `Could not read file: ${res.error}`;
      statsEl.textContent = '';
    }
  }

  private teardownKeys(): void {
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
  }
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function formatKb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function mod(): string {
  return navigator.userAgent.includes('Mac OS') ? '⌘' : 'Ctrl+';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @awakon/desktop test doc-reader`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/chrome/doc-reader.ts apps/desktop/src/renderer/chrome/doc-reader.test.ts
git commit -m "feat: DocReader overlay component"
```

---

## Task 12: Tab `M↓` marker

**Files:**
- Modify: `apps/desktop/src/renderer/chrome/tab-strip.ts`
- Test: `apps/desktop/src/renderer/chrome/tab-strip.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/renderer/chrome/tab-strip.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TabStrip, type TabViewModel } from './tab-strip.js';
import type { SessionInfo } from '@awakon/contracts';

function info(id: string): SessionInfo {
  return { id, title: id, shell: 'pwsh', cwd: '/x', status: 'running', kind: 'tab', pid: 1, exitCode: null };
}
function vm(id: string, hasDoc: boolean): TabViewModel {
  return { info: info(id), attention: false, broken: false, resumeAt: null, hasDoc };
}

let root: HTMLElement;
beforeEach(() => { document.body.innerHTML = ''; root = document.createElement('div'); document.body.appendChild(root); });

const callbacks = () => ({ onTabClick: vi.fn(), onTabClose: vi.fn(), onNewTab: vi.fn(), onTabReorder: vi.fn() });

describe('TabStrip M↓ marker', () => {
  it('renders an M↓ marker on a tab that has an open doc', () => {
    new TabStrip(root, callbacks()).render([vm('t1', true)], 't1');
    expect(root.querySelector('.tab .doc-marker')?.textContent).toBe('M↓');
  });

  it('does not render the marker when the tab has no doc', () => {
    new TabStrip(root, callbacks()).render([vm('t1', false)], 't1');
    expect(root.querySelector('.tab .doc-marker')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @awakon/desktop test tab-strip`
Expected: FAIL — `hasDoc` is not on `TabViewModel`, no marker rendered.

- [ ] **Step 3: Implement the marker**

In `apps/desktop/src/renderer/chrome/tab-strip.ts`, add `hasDoc` to the view model:

```ts
export interface TabViewModel {
  info: SessionInfo;
  attention: boolean;
  broken: boolean;
  /** Epoch ms a pending auto-resume will fire, or null when none is scheduled. */
  resumeAt: number | null;
  /** True when this tab has a parked/open markdown doc (shows an M↓ marker). */
  hasDoc: boolean;
}
```

Then, in `render()`, after the `title` element is appended (after `el.appendChild(title);`) and before the resume-badge block, add:

```ts
      if (tab.hasDoc) {
        const marker = document.createElement('span');
        marker.className = 'doc-marker';
        marker.textContent = 'M↓';
        marker.title = 'A document is open on this tab';
        el.appendChild(marker);
      }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @awakon/desktop test tab-strip`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/chrome/tab-strip.ts apps/desktop/src/renderer/chrome/tab-strip.test.ts
git commit -m "feat: M↓ tab marker for parked reader docs"
```

---

## Task 13: Reader styles

**Files:**
- Modify: `apps/desktop/src/renderer/chrome/styles/chrome.css`

Visual-only; no unit test. Verified during the manual run in Task 15.

- [ ] **Step 1: Append the reader styles**

Add to the end of `apps/desktop/src/renderer/chrome/styles/chrome.css`:

```css
/* ───────────────────────── Markdown doc reader ───────────────────────── */
.aip-reader { position: absolute; inset: 0; z-index: 20; }

.aip-reader__scrim {
  position: absolute; inset: 0;
  background: rgba(8, 7, 11, 0.55);
  z-index: 5;
  cursor: pointer;
}
.aip-reader__scrim-hint {
  position: absolute; left: 13px; top: 50%; transform: translateY(-50%);
  writing-mode: vertical-rl;
  font-family: var(--font-mono); font-size: 10px; letter-spacing: 1.5px;
  color: var(--text-3);
}

.aip-reader__panel {
  position: absolute; top: 0; bottom: 0; right: 0; width: 90%;
  display: flex; flex-direction: column;
  background: var(--bg-0);
  border-left: 1px solid var(--border-2);
  box-shadow: -24px 0 60px rgba(0, 0, 0, 0.5);
  z-index: 6;
  animation: aip-reader-in 200ms ease-out;
}
@keyframes aip-reader-in { from { transform: translateX(100%); } to { transform: translateX(0); } }

.aip-reader__files {
  display: flex; align-items: stretch; height: 36px;
  background: var(--bg-1); border-bottom: 1px solid var(--border-1);
  flex-shrink: 0;
}
.aip-reader__file {
  display: flex; align-items: center; gap: 8px; padding: 0 13px;
  border-right: 1px solid var(--border-1);
  font-family: var(--font-mono); font-size: 12px; color: var(--text-3);
  position: relative; cursor: pointer; max-width: 230px;
}
.aip-reader__file.active { background: var(--bg-0); color: var(--text-1); }
.aip-reader__file.active::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: var(--accent);
}
.aip-reader__file-glyph { font-size: 11px; font-weight: 700; color: var(--text-4); }
.aip-reader__file.active .aip-reader__file-glyph { color: var(--accent); }
.aip-reader__file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aip-reader__file-close {
  width: 16px; height: 16px; margin-right: -3px; border-radius: 4px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--text-4); font-size: 13px; transition: background .12s ease, color .12s ease;
}
.aip-reader__file-close:hover { background: var(--bg-3); color: var(--text-1); }
.aip-reader__close {
  width: 40px; margin-left: auto; display: flex; align-items: center; justify-content: center;
  color: var(--text-3); border-left: 1px solid var(--border-1); cursor: pointer; font-size: 15px;
}
.aip-reader__close:hover { color: var(--text-1); }

.aip-reader__review {
  display: flex; align-items: center; gap: 12px; padding: 8px 14px;
  background: var(--bg-1); border-bottom: 1px solid var(--border-1); flex-shrink: 0;
}
.aip-reader__path {
  font-family: var(--font-mono); font-size: 11px; color: var(--text-3);
  flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.aip-reader__provenance {
  font-family: var(--font-mono); font-size: 10.5px; color: var(--text-4);
}
.aip-reader__actions { display: flex; gap: 6px; }
.aip-reader__approve, .aip-reader__request {
  padding: 3px 10px; border-radius: 5px;
  font-family: var(--font-mono); font-size: 11px; cursor: pointer;
  border: 1px solid transparent;
}
.aip-reader__approve { color: var(--st-running); background: var(--st-running-bg); }
.aip-reader__request { color: var(--text-2); background: var(--bg-2); border-color: var(--border-1); }
.aip-reader__approve.is-on { outline: 1px solid var(--st-running); }
.aip-reader__request.is-on { outline: 1px solid var(--accent); }

.aip-reader__body { flex: 1; overflow: auto; background: var(--bg-0); color: var(--text-2); padding: 28px 24px; }
.aip-reader__prose { max-width: 780px; margin: 0 auto; }
.aip-reader__prose h1 { font-family: var(--font-sans); font-size: 20px; font-weight: 600; color: var(--text-1); margin: 0 0 8px; letter-spacing: -0.2px; }
.aip-reader__prose h2 { font-family: var(--font-sans); font-size: 15px; font-weight: 600; color: var(--text-1); margin: 20px 0 8px; }
.aip-reader__prose p, .aip-reader__prose li { font-family: var(--font-sans); font-size: 13.5px; line-height: 1.65; color: var(--text-1); }
.aip-reader__prose p { margin: 0 0 12px; }
.aip-reader__prose code { font-family: var(--font-mono); font-size: 12px; background: var(--bg-3); padding: 1px 5px; border-radius: 3px; color: var(--text-1); }
.aip-reader__prose pre { font-family: var(--font-mono); font-size: 11.5px; line-height: 1.55; background: var(--term-bg); border: 1px solid var(--border-1); border-radius: 6px; padding: 12px 14px; color: var(--text-2); overflow-x: auto; margin: 0 0 16px; }
.aip-reader__prose pre code { background: none; padding: 0; }

.aip-reader__footer {
  border-top: 1px solid var(--border-1); padding: 8px 16px;
  display: flex; align-items: center; justify-content: space-between;
  font-family: var(--font-mono); font-size: 10.5px; color: var(--text-4);
  background: var(--bg-1); flex-shrink: 0;
}
.aip-reader__hints { display: flex; gap: 14px; }
.aip-reader__hints .k { color: var(--text-3); }

/* Tab M↓ marker */
.tab .doc-marker {
  font-family: var(--font-mono); font-size: 9.5px; font-weight: 700;
  color: var(--accent); background: color-mix(in oklch, var(--accent) 14%, transparent);
  border: 1px solid color-mix(in oklch, var(--accent) 28%, transparent);
  border-radius: 4px; padding: 1px 4px; line-height: 1.2;
}
```

- [ ] **Step 2: Verify the build still compiles the CSS**

Run: `pnpm --filter @awakon/desktop typecheck`
Expected: PASS (CSS is not typechecked, but this confirms nothing else broke).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/chrome/styles/chrome.css
git commit -m "feat: doc reader styles"
```

---

## Task 14: LayoutManager orchestration

**Files:**
- Modify: `apps/desktop/src/renderer/chrome/layout-manager.ts`
- Test: `apps/desktop/src/renderer/chrome/layout-manager-doc-reader.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/renderer/chrome/layout-manager-doc-reader.test.ts`. Inspect a sibling test (e.g. `layout-manager-empty-state.test.ts`) for the exact fake-bridge + DOM-host construction pattern used in this repo and mirror it. The test must cover:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannel, type SessionInfo } from '@awakon/contracts';
import { LayoutManager } from './layout-manager.js';
import { TabStrip } from './tab-strip.js';
import { Sidebar } from './sidebar.js';

// A fake bridge that records sends and lets the test fire main->renderer events.
function makeBridge() {
  const listeners = new Map<string, (p: unknown) => void>();
  const sends: Array<{ channel: string; payload: unknown }> = [];
  return {
    bridge: {
      send: vi.fn((channel: string, payload?: unknown) => {
        sends.push({ channel, payload });
        if (channel === IpcChannel.SessionList) return Promise.resolve([]);
        if (channel === IpcChannel.SettingsGet) return Promise.resolve({ autoResume: { enabled: false, detectText: '', responseText: '' }, defaultCwd: '', recentTabs: [] });
        if (channel === IpcChannel.RecentList) return Promise.resolve([]);
        if (channel === IpcChannel.LayoutDefaultCwd) return Promise.resolve('/home');
        if (channel === IpcChannel.LayoutDocsForTab) return Promise.resolve({ docs: [], activeDocIndex: null });
        return Promise.resolve({ ok: true });
      }),
      on: (channel: string, handler: (p: unknown) => void) => { listeners.set(channel, handler); return () => listeners.delete(channel); },
    },
    fire: (channel: string, payload: unknown) => listeners.get(channel)?.(payload),
    sends,
  };
}

function info(id: string): SessionInfo {
  return { id, title: id, shell: 'pwsh', cwd: '/x', status: 'running', kind: 'tab', pid: 1, exitCode: null };
}

function setupDom() {
  document.body.innerHTML = `
    <div id="tab-strip"></div>
    <div id="body"><div id="view-host"></div></div>
    <div id="empty-state-host"></div>
  `;
}

let env: ReturnType<typeof makeBridge>;
let manager: LayoutManager;

beforeEach(async () => {
  setupDom();
  env = makeBridge();
  const tabStrip = new TabStrip(document.getElementById('tab-strip')!, {
    onTabClick: (id) => manager.focus(id), onTabClose: vi.fn(), onNewTab: vi.fn(), onTabReorder: vi.fn(),
  });
  const sidebar = new Sidebar({
    listEl: document.createElement('div'), overviewEl: null, toggleEl: document.createElement('div'),
    newEl: null, sortEl: null, railSummaryEl: null, railListEl: null, railExpandEl: null, railNewEl: null,
    callbacks: { onRowClick: (id) => manager.focus(id), onToggle: vi.fn(), onRename: vi.fn(), onDuplicate: vi.fn(), onRestart: vi.fn(), onClose: vi.fn(), onResumeCancel: vi.fn(), onNewSession: vi.fn() },
  });
  manager = new LayoutManager({
    bridge: env.bridge as never,
    tabStrip,
    sidebar,
    bodyEl: document.getElementById('body')!,
    emptyStateHostEl: document.getElementById('empty-state-host')!,
    viewHostEl: document.getElementById('view-host')!,
  });
  await manager.start();
  env.fire(IpcChannel.SessionCreated, { info: info('t1') });
});

describe('LayoutManager — doc reader', () => {
  it('opens the reader when a DocOpenRequest targets the focused tab', () => {
    env.fire(IpcChannel.DocOpenRequest, {
      tabId: 't1', rawPath: 'docs/a.md', resolvedPath: '/x/docs/a.md',
      provenanceTitle: 'pwsh', provenanceStatus: 'running',
    });
    expect(document.querySelector('.aip-reader')).not.toBeNull();
    // Suspends the terminal view.
    expect(env.sends.some((s) => s.channel === IpcChannel.LayoutModal && (s.payload as { open: boolean }).open)).toBe(true);
  });

  it('persists docs when one is opened', () => {
    env.fire(IpcChannel.DocOpenRequest, {
      tabId: 't1', rawPath: 'docs/a.md', resolvedPath: '/x/docs/a.md',
      provenanceTitle: 'pwsh', provenanceStatus: 'running',
    });
    expect(env.sends.some((s) => s.channel === IpcChannel.LayoutPersistDocs)).toBe(true);
  });

  it('shows the M↓ marker on the tab after opening a doc', () => {
    env.fire(IpcChannel.DocOpenRequest, {
      tabId: 't1', rawPath: 'docs/a.md', resolvedPath: '/x/docs/a.md',
      provenanceTitle: 'pwsh', provenanceStatus: 'running',
    });
    expect(document.querySelector('#tab-strip .tab .doc-marker')).not.toBeNull();
  });

  it('parks the reader when switching to another tab but keeps the marker', () => {
    env.fire(IpcChannel.DocOpenRequest, {
      tabId: 't1', rawPath: 'docs/a.md', resolvedPath: '/x/docs/a.md',
      provenanceTitle: 'pwsh', provenanceStatus: 'running',
    });
    env.fire(IpcChannel.SessionCreated, { info: info('t2') }); // focuses t2
    expect(document.querySelector('.aip-reader')).toBeNull();          // parked
    expect(document.querySelector('#tab-strip .tab .doc-marker')).not.toBeNull(); // marker stays on t1
  });
});
```

> If a sibling test constructs `Sidebar`/`LayoutManager` differently (constructor shape may have evolved), copy that exact shape. The behavioral assertions above are the contract; adapt only the wiring.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @awakon/desktop test layout-manager-doc-reader`
Expected: FAIL — `viewHostEl` dep, `DocOpenRequest` handling, and reader wiring don't exist yet.

- [ ] **Step 3: Implement the orchestration**

In `apps/desktop/src/renderer/chrome/layout-manager.ts`:

Add imports:

```ts
import { DocReader } from './doc-reader.js';
import { emptyDocState, openDoc, closeDocAt, setReview, moveActive, toPersistedDocs, fromPersistedDocs, type ReviewState } from './doc-state.js';
```

Extend `LayoutDeps`:

```ts
export interface LayoutDeps {
  bridge: PreloadBridge;
  tabStrip: TabStrip;
  sidebar: Sidebar;
  bodyEl: HTMLElement;
  emptyStateHostEl: HTMLElement;
  viewHostEl: HTMLElement;
}
```

Add fields + construct the reader in the constructor:

```ts
  private readonly viewHostEl: HTMLElement;
  private readonly docReader: DocReader;
```

In the constructor body (after `this.emptyStateView = ...`):

```ts
    this.viewHostEl = deps.viewHostEl;
    this.docReader = new DocReader(this.viewHostEl, this.bridge, {
      onDismiss:    () => this.dismissReader(),
      onSelectFile: (i) => this.selectDoc(i),
      onCloseFile:  (i) => this.closeDoc(i),
      onReview:     (i, r) => this.reviewDoc(i, r),
      onPrevFile:   () => this.moveDoc(-1),
      onNextFile:   () => this.moveDoc(1),
    });
```

In `start()`, add a subscription alongside the others (e.g. after the `SettingsChanged` subscription):

```ts
    this.bridge.on(IpcChannel.DocOpenRequest, (raw) => {
      const e = raw as {
        tabId: SessionId; rawPath: string; resolvedPath: string;
        provenanceTitle: string; provenanceStatus: SessionInfo['status'];
      };
      const session = this.state.sessions.get(e.tabId);
      if (!session) return;
      session.docState = openDoc(session.docState, {
        rawPath: e.rawPath,
        resolvedPath: e.resolvedPath,
        provenanceTitle: e.provenanceTitle,
        provenanceStatus: e.provenanceStatus,
        reviewState: 'proposed',
      });
      this.persistDocs(e.tabId);
      if (this.state.focusedId === e.tabId) this.syncReader();
      this.render();
    });
```

In `upsertSession`, set a fresh `docState` and restore persisted docs. Change the fresh-session literal to include `docState: emptyDocState()`:

```ts
      const fresh: SessionState = {
        info,
        attention: false,
        broken: false,
        statusSinceMs: Date.now(),
        resumeAt: null,
        docState: emptyDocState(),
      };
      this.state.sessions.set(info.id, fresh);
      this.state.tabOrder.push(info.id);
      void this.restoreDocs(info.id);
```

Add these private methods (anywhere in the class, e.g. before `render()`):

```ts
  private focusedDocState(): SessionState | undefined {
    return this.state.focusedId ? this.state.sessions.get(this.state.focusedId) : undefined;
  }

  /** Show or hide the reader to match the focused tab's doc state. */
  private syncReader(): void {
    const session = this.focusedDocState();
    const ds = session?.docState;
    if (ds && ds.readerVisible && ds.activeDocIndex !== null && ds.openDocs.length > 0) {
      void this.bridge.send(IpcChannel.LayoutModal, { open: true });
      this.docReader.render(ds);
    } else {
      this.docReader.render(emptyDocState()); // hides any existing panel
      void this.bridge.send(IpcChannel.LayoutModal, { open: false });
    }
  }

  private dismissReader(): void {
    const session = this.focusedDocState();
    if (!session) return;
    session.docState = { ...session.docState, readerVisible: false }; // keep activeDocIndex (marker)
    this.persistDocs(session.info.id);
    this.syncReader();
    this.render();
  }

  private selectDoc(index: number): void {
    const session = this.focusedDocState();
    if (!session) return;
    session.docState = { ...session.docState, activeDocIndex: index, readerVisible: true };
    this.persistDocs(session.info.id);
    this.syncReader();
    this.render();
  }

  private closeDoc(index: number): void {
    const session = this.focusedDocState();
    if (!session) return;
    session.docState = closeDocAt(session.docState, index);
    this.persistDocs(session.info.id);
    this.syncReader();
    this.render();
  }

  private reviewDoc(index: number, review: ReviewState): void {
    const session = this.focusedDocState();
    if (!session) return;
    session.docState = setReview(session.docState, index, review);
    this.persistDocs(session.info.id);
    this.syncReader();
  }

  private moveDoc(delta: number): void {
    const session = this.focusedDocState();
    if (!session) return;
    session.docState = moveActive(session.docState, delta);
    this.persistDocs(session.info.id);
    this.syncReader();
    this.render();
  }

  private persistDocs(tabId: SessionId): void {
    const session = this.state.sessions.get(tabId);
    if (!session) return;
    const { docs, activeDocIndex } = toPersistedDocs(session.docState);
    void this.bridge.send(IpcChannel.LayoutPersistDocs, { tabId, docs, activeDocIndex });
  }

  private async restoreDocs(tabId: SessionId): Promise<void> {
    let res: { docs: unknown[]; activeDocIndex: number | null } | { error: string };
    try {
      res = (await this.bridge.send(IpcChannel.LayoutDocsForTab, { tabId })) as typeof res;
    } catch { return; }
    if ('error' in res || !res.docs || res.docs.length === 0) return;
    const session = this.state.sessions.get(tabId);
    if (!session) return;
    session.docState = fromPersistedDocs(res.docs as never, res.activeDocIndex);
    this.render();
  }
```

In `focus()`, after `void this.bridge.send(IpcChannel.LayoutShow, { sessionId });` and before `this.render();`, add:

```ts
    this.syncReader();
```

In `render()`, update the `TabViewModel` mapping to include `hasDoc`:

```ts
      .map((s) => ({
        info: s.info,
        attention: s.attention,
        broken: s.broken,
        resumeAt: s.resumeAt,
        hasDoc: s.docState.activeDocIndex !== null,
      }));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @awakon/desktop test layout-manager-doc-reader`
Expected: PASS.

- [ ] **Step 5: Run the full desktop suite to catch regressions**

Run: `pnpm --filter @awakon/desktop test`
Expected: PASS (existing layout-manager tests may need `viewHostEl` added to their `LayoutManager` construction — if any fail for a missing `viewHostEl`, add `viewHostEl: document.createElement('div')` to those test setups and re-run).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/chrome/layout-manager.ts apps/desktop/src/renderer/chrome/layout-manager-doc-reader.test.ts apps/desktop/src/renderer/chrome/layout-manager-empty-state.test.ts apps/desktop/src/renderer/chrome/layout-manager-defaultcwd.test.ts
git commit -m "feat: wire doc reader orchestration into LayoutManager"
```

---

## Task 15: Wire DocReader host into the chrome entry + final verification

**Files:**
- Modify: `apps/desktop/src/renderer/chrome/main.ts`

- [ ] **Step 1: Pass the view-host element to the LayoutManager**

In `apps/desktop/src/renderer/chrome/main.ts`, after the existing element lookups (e.g. after `const emptyStateHostEl = ...`), add:

```ts
const viewHostEl = document.getElementById('view-host')!;
```

Then add `viewHostEl` to the `new LayoutManager({ ... })` deps object:

```ts
const manager = new LayoutManager({
  bridge,
  bodyEl,
  emptyStateHostEl,
  viewHostEl,
  tabStrip: new TabStrip(tabStripEl, {
    // …unchanged…
  }),
  sidebar: new Sidebar({
    // …unchanged…
  }),
});
```

(`#view-host` already exists in `apps/desktop/index.html` and is `position: relative` in `chrome.css`, so the absolutely-positioned reader fills the console area to the right of the sidebar.)

- [ ] **Step 2: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Run all unit tests**

Run: `pnpm test`
Expected: PASS across contracts/core/desktop/terminal-host.

- [ ] **Step 4: Manual smoke test**

Run: `pnpm dev`

Verify:
1. In a shell pane, run a command that prints a `.md` path that exists (e.g. `echo see README.md`). The path is underlined in the accent color.
2. Click it → the reader slides in from the right, covering ~90%, the terminal disappears behind a dimmed scrim with the vertical "click or esc to close" hint.
3. The review bar shows the path, "proposed by <session title>", and Approve / Request changes pills. Clicking a pill restyles it.
4. `esc` or clicking the scrim closes the reader; the terminal returns; the tab shows an `M↓` marker.
5. Open a second `.md`; both appear as file tabs; `Ctrl+[` / `Ctrl+]` switch between them.
6. Click an `.md` path that does **not** exist → reader shows "(not yet created)".
7. Switch to another tab → reader parks (gone from view), `M↓` stays on the original tab; switch back → returning to that tab keeps the marker (reader stays parked until you click the marker's doc again or it was left visible).
8. Restart the app → tabs with docs still show the `M↓` marker (docs restored, parked).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/chrome/main.ts
git commit -m "feat: mount the doc reader in the chrome renderer"
```

- [ ] **Step 6 (optional): Verify bundled fonts**

The reader uses `--font-sans` (Inter) and `--font-mono` (JetBrains Mono). Confirm these are bundled locally (search the renderer for an `@font-face` or local font import). If they are only referenced by name and not bundled, that is a pre-existing gap shared with the rest of the chrome — note it but do not block this feature on it.

---

## Notes on scope (carried from the spec)

Out of scope for this plan: live file-watching/auto-reload, syntax highlighting, "open in $EDITOR" / copy-path actions, and any real approve/commit side-effects. The Approve / Request changes pills set per-doc review state (visual + persisted) only.
