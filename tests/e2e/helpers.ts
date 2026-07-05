import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { Page } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Launch args with an isolated, empty userData dir so persisted tabs from a previous
 * run (or another spec) cannot leak in. */
export function launchArgs(): string[] {
  const userData = mkdtempSync(join(tmpdir(), 'awakon-e2e-'));
  return [resolve(__dirname, '../../apps/desktop'), `--user-data-dir=${userData}`];
}

/** Query the total session count (tabs + panes) via the chrome IPC bridge. */
export async function sessionCount(chrome: Page): Promise<number> {
  return chrome.evaluate(async () => {
    const awakon = (window as unknown as {
      awakon: { send: (c: string, p?: unknown) => Promise<unknown> };
    }).awakon;
    const list = (await awakon.send('core.session.list')) as unknown[];
    return list.length;
  });
}
