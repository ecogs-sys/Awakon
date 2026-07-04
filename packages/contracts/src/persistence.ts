import { z } from 'zod';
import { ShellSchema, SessionStatusSchema } from './session.js';

export const PERSISTENCE_SCHEMA_VERSION = 4;

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
  /** Position of the focused tab within `tabs`, or null when none was focused.
   * Session ids are regenerated every launch (randomUUID), so a persisted id can
   * never match a freshly restored session — position is the only stable anchor
   * across restarts (M4). */
  focusedTabIndex: z.number().int().nonnegative().nullable(),
});
export type PersistedTabs = z.infer<typeof PersistedTabsSchema>;

/**
 * Migrate an unknown payload read from disk into the current schema shape, *before*
 * `PersistedTabsSchema.safeParse` validates it. Returns the (possibly mutated) payload
 * on success, or null if the version is missing/unknown.
 *
 * v1 -> v2: stamp version 2 (splits left undefined).
 * v2 -> v3: stamp version 3 (docs left undefined).
 * v3 -> v4: replace focusedTabId (a session id, which can never match after restart —
 * see M4) with focusedTabIndex, the matching tab's position in `tabs`.
 */
export function migratePersistedTabs(parsed: unknown): unknown | null {
  if (parsed === null || typeof parsed !== 'object') return null;
  let obj = parsed as {
    version?: unknown; tabs?: unknown; focusedTabId?: unknown; focusedTabIndex?: unknown;
  };
  if (obj.version === 1) obj = { ...obj, version: 2 };
  if (obj.version === 2) obj = { ...obj, version: 3 };
  if (obj.version === 3) {
    const tabs = Array.isArray(obj.tabs) ? (obj.tabs as Array<{ tabId?: unknown }>) : [];
    const idx = tabs.findIndex((t) => t.tabId === obj.focusedTabId);
    const next = { ...obj, version: 4 as const, focusedTabIndex: idx >= 0 ? idx : null };
    delete next.focusedTabId;
    obj = next;
  }
  if (obj.version === 4) return obj;
  return null;
}
