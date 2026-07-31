import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../src/session-store.js';
import type { PersistedTabs } from '@awakon/contracts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'awakon-store-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const sample: PersistedTabs = {
  version: 4,
  tabs: [
    { tabId: 't1', shell: 'pwsh', cwd: 'C:\\Users\\me', title: 'First' },
    { tabId: 't2', shell: 'bash', cwd: '/home/me' },
  ],
  focusedTabIndex: 0,
};

describe('SessionStore', () => {
  it('returns null when no file exists', async () => {
    const store = new SessionStore(dir);
    expect(await store.load()).toBeNull();
  });

  it('writes and reads back a payload', async () => {
    const store = new SessionStore(dir);
    await store.save(sample);
    expect(await store.load()).toEqual(sample);
  });

  it('writes via temp file then rename (atomic)', async () => {
    const store = new SessionStore(dir);
    await store.save(sample);
    expect(existsSync(join(dir, 'sessions.json'))).toBe(true);
    const remnants = readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    expect(remnants).toHaveLength(0);
  });

  it('overwrites existing file on subsequent save', async () => {
    const store = new SessionStore(dir);
    await store.save(sample);
    const next: PersistedTabs = { version: 4, tabs: [], focusedTabIndex: null };
    await store.save(next);
    expect(await store.load()).toEqual(next);
  });

  it('returns null and backs up a corrupt file', async () => {
    const path = join(dir, 'sessions.json');
    writeFileSync(path, '{ this is not json');
    const store = new SessionStore(dir);
    const result = await store.load();
    expect(result).toBeNull();
    expect(existsSync(path)).toBe(false);
    const broken = readdirSync(dir).filter((f) => f.startsWith('sessions.json.broken-'));
    expect(broken).toHaveLength(1);
  });

  it('returns null and backs up when schema does not match', async () => {
    const path = join(dir, 'sessions.json');
    writeFileSync(path, JSON.stringify({ version: 99, tabs: 'not-an-array' }));
    const store = new SessionStore(dir);
    expect(await store.load()).toBeNull();
    const broken = readdirSync(dir).filter((f) => f.startsWith('sessions.json.broken-'));
    expect(broken).toHaveLength(1);
  });

  it('handles repeated saves without race', async () => {
    const store = new SessionStore(dir);
    await Promise.all([store.save(sample), store.save(sample), store.save(sample)]);
    expect(await store.load()).toEqual(sample);
  });

  it('invokes onError when an atomic write fails', async () => {
    // Point the store at a path that is an existing file, so mkdir/write fails.
    const filePath = join(dir, 'not-a-dir');
    writeFileSync(filePath, 'x');
    const store = new SessionStore(filePath);
    let captured: unknown = null;
    store.onError((err) => { captured = err; });
    await store.save(sample);
    expect(captured).not.toBeNull();
  });

  it('serializes JSON with stable shape (sorted keys not required, but parseable)', async () => {
    const store = new SessionStore(dir);
    await store.save(sample);
    const raw = readFileSync(join(dir, 'sessions.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(4);
    expect(parsed.tabs).toHaveLength(2);
  });

  it('migrates a v1 file in memory and writes it back as the current version', async () => {
    const v1Payload = {
      version: 1,
      tabs: [{ tabId: 't1', shell: 'pwsh', cwd: 'C:\\Users\\me', title: 'First' }],
      focusedTabId: 't1',
    };
    writeFileSync(join(dir, 'sessions.json'), JSON.stringify(v1Payload));
    const store = new SessionStore(dir);
    const loaded = await store.load();
    expect(loaded?.version).toBe(4);
    expect(loaded?.tabs[0]?.splits).toBeUndefined();
    expect(loaded?.focusedTabIndex).toBe(0);
  });

  it('round-trips a payload that contains a split tree', async () => {
    const withSplits: PersistedTabs = {
      version: 4,
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
      focusedTabIndex: 0,
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
});
