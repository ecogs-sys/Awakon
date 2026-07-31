import { describe, expect, it } from 'vitest';
import {
  PersistedSplitNodeSchema,
  PersistedTabsSchema,
  migratePersistedTabs,
  PERSISTENCE_SCHEMA_VERSION,
} from '@awakon/contracts';

describe('PERSISTENCE_SCHEMA_VERSION', () => {
  it('is 4', () => {
    expect(PERSISTENCE_SCHEMA_VERSION).toBe(4);
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
  it('upgrades a valid v1 payload to v4 with undefined splits', () => {
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
      expect(parsed.data.version).toBe(4);
      expect(parsed.data.tabs[0]!.splits).toBeUndefined();
      expect(parsed.data.tabs[1]!.splits).toBeUndefined();
      expect(parsed.data.focusedTabIndex).toBe(0);
    }
  });

  it('migrates a valid v2 payload through to v4', () => {
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
    expect(PersistedTabsSchema.safeParse(migrated).success).toBe(true);
  });

  it('returns null for an object with no version', () => {
    expect(migratePersistedTabs({ tabs: [], focusedTabId: null })).toBeNull();
  });

  it('returns null for an unknown version', () => {
    expect(migratePersistedTabs({ version: 99, tabs: [], focusedTabId: null })).toBeNull();
  });

  it('returns null for non-object inputs', () => {
    expect(migratePersistedTabs(null)).toBeNull();
    expect(migratePersistedTabs('hello')).toBeNull();
    expect(migratePersistedTabs(42)).toBeNull();
  });
});

describe('migratePersistedTabs — v2 to v4', () => {
  it('upgrades a v2 payload to v4 with undefined docs', () => {
    const v2 = {
      version: 2,
      tabs: [{ tabId: 't1', shell: 'pwsh', cwd: '/x' }],
      focusedTabId: 't1',
    };
    const migrated = migratePersistedTabs(v2);
    const parsed = PersistedTabsSchema.safeParse(migrated);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.version).toBe(4);
      expect(parsed.data.tabs[0]!.docs).toBeUndefined();
    }
  });

  it('chains v1 -> v4', () => {
    const v1 = { version: 1, tabs: [{ tabId: 't1', shell: 'pwsh', cwd: '/x' }], focusedTabId: 't1' };
    const parsed = PersistedTabsSchema.safeParse(migratePersistedTabs(v1));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.version).toBe(4);
  });
});

describe('migratePersistedTabs — v3 to v4', () => {
  it('replaces focusedTabId with the matching focusedTabIndex', () => {
    const v3 = {
      version: 3,
      tabs: [
        { tabId: 't1', shell: 'pwsh', cwd: '/x' },
        { tabId: 't2', shell: 'pwsh', cwd: '/y' },
      ],
      focusedTabId: 't2',
    };
    const migrated = migratePersistedTabs(v3) as { version: number; focusedTabIndex: number | null; focusedTabId?: unknown };
    expect(migrated.version).toBe(4);
    expect(migrated.focusedTabIndex).toBe(1);
    expect(migrated.focusedTabId).toBeUndefined();
  });

  it('sets focusedTabIndex to null when the persisted id has no match', () => {
    const v3 = { version: 3, tabs: [{ tabId: 't1', shell: 'pwsh', cwd: '/x' }], focusedTabId: 'stale-id' };
    const migrated = migratePersistedTabs(v3) as { focusedTabIndex: number | null };
    expect(migrated.focusedTabIndex).toBeNull();
  });

  it('accepts a v4 payload carrying reader docs and focusedTabIndex', () => {
    const v4 = {
      version: 4,
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
      focusedTabIndex: 0,
    };
    expect(PersistedTabsSchema.safeParse(migratePersistedTabs(v4)).success).toBe(true);
  });

  it('returns null for version 5', () => {
    expect(migratePersistedTabs({ version: 5, tabs: [], focusedTabIndex: null })).toBeNull();
  });
});
