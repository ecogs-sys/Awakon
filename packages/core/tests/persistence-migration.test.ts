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
