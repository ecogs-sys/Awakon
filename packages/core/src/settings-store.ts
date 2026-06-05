import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { AppSettingsSchema, DEFAULT_APP_SETTINGS, type AppSettings } from '@awakon/contracts';

const FILE_NAME = 'settings.json';

/**
 * Reads and writes the persisted application settings. Writes are atomic via
 * temp-file + rename. A missing, corrupt, or schema-mismatched file yields the
 * defaults (the corrupt file is renamed aside) so the app always boots.
 * Modelled on SessionStore.
 */
export class SettingsStore {
  private writeChain: Promise<void> = Promise.resolve();
  private errorCallback: ((err: unknown) => void) | null = null;

  constructor(private readonly dir: string) {}

  /** Register a callback invoked when an atomic write fails. save() stays
   * non-throwing so callers are not disrupted. */
  onError(cb: (err: unknown) => void): void {
    this.errorCallback = cb;
  }

  /** Load settings, always resolving to a valid AppSettings (defaults on any fault). */
  async load(): Promise<AppSettings> {
    const path = join(this.dir, FILE_NAME);
    let raw: string;
    try {
      raw = await fs.readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[SettingsStore] could not read settings, using defaults:', err);
      }
      return DEFAULT_APP_SETTINGS;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await this.backup(path);
      return DEFAULT_APP_SETTINGS;
    }
    const result = AppSettingsSchema.safeParse(parsed);
    if (!result.success) {
      await this.backup(path);
      return DEFAULT_APP_SETTINGS;
    }
    return result.data;
  }

  /** Save settings atomically. Concurrent calls are serialized via a chained promise. */
  save(payload: AppSettings): Promise<void> {
    this.writeChain = this.writeChain
      .then(() => this.writeAtomic(payload))
      .catch((err) => {
        this.errorCallback?.(err);
      });
    return this.writeChain;
  }

  private async writeAtomic(payload: AppSettings): Promise<void> {
    const path = join(this.dir, FILE_NAME);
    const tmp = `${path}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    const json = JSON.stringify(payload, null, 2);
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(tmp, json, 'utf8');
    await fs.rename(tmp, path);
  }

  private async backup(path: string): Promise<void> {
    const dest = `${path}.broken-${Date.now()}`;
    try {
      await fs.rename(path, dest);
    } catch {
      /* If we can't rename, drop it — the file is broken anyway. */
    }
  }
}
