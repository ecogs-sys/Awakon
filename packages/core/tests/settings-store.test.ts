import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_APP_SETTINGS } from '@awakon/contracts';
import { SettingsStore } from '../src/settings-store.js';

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'awakon-settings-'));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

describe('SettingsStore', () => {
  it('returns the defaults when no file exists', async () => {
    const store = new SettingsStore(tempDir());
    expect(await store.load()).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('round-trips a saved value', async () => {
    const dir = tempDir();
    const next = {
      version: 1,
      autoResume: { enabled: false, detectText: 'LIMIT', responseText: 'go', resumeText: 'continue' },
      defaultCwd: '',
      recentTabs: [],
    };
    await new SettingsStore(dir).save(next);
    expect(await new SettingsStore(dir).load()).toEqual(next);
  });

  it('recovers from a corrupt file by backing it up and returning defaults', async () => {
    const dir = tempDir();
    await fs.writeFile(join(dir, 'settings.json'), '{ not json', 'utf8');
    const store = new SettingsStore(dir);
    expect(await store.load()).toEqual(DEFAULT_APP_SETTINGS);
    const entries = await fs.readdir(dir);
    expect(entries.some((e) => e.startsWith('settings.json.broken-'))).toBe(true);
  });

  it('recovers from a schema-mismatched file', async () => {
    const dir = tempDir();
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify({ autoResume: { enabled: 1 } }), 'utf8');
    expect(await new SettingsStore(dir).load()).toEqual(DEFAULT_APP_SETTINGS);
  });

  // --- A2-I3: versioning + migration ---

  it('migrates a pre-versioning settings.json (no version field) instead of wiping it to defaults', async () => {
    const dir = tempDir();
    const legacy = {
      autoResume: { enabled: true, detectText: 'LIMIT', responseText: '1', resumeText: 'continue' },
      defaultCwd: '/home/legacy',
      recentTabs: [],
    };
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(legacy), 'utf8');

    const loaded = await new SettingsStore(dir).load();

    // The user's actual settings survive the migration, not just the defaults.
    expect(loaded.autoResume.detectText).toBe('LIMIT');
    expect(loaded.defaultCwd).toBe('/home/legacy');
    expect(loaded.version).toBe(1);
  });

  it('accepts a settings.json that already carries the current version', async () => {
    const dir = tempDir();
    const current = {
      version: 1,
      autoResume: { enabled: false, detectText: '', responseText: '', resumeText: 'continue' },
      defaultCwd: '/x',
      recentTabs: [],
    };
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(current), 'utf8');
    expect(await new SettingsStore(dir).load()).toEqual(current);
  });

  it('reports write failures through the onError callback', async () => {
    // An empty string is not a valid directory path -> writeAtomic rejects.
    const store = new SettingsStore('');
    let captured: unknown = null;
    store.onError((err) => { captured = err; });
    await store.save(DEFAULT_APP_SETTINGS);
    expect(captured).not.toBeNull();
  });
});
