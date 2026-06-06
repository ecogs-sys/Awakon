import { _electron as electron, expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Launch args with an isolated, empty userData dir so persisted tabs cannot leak in. */
function launchArgs(): string[] {
  const userData = mkdtempSync(join(tmpdir(), 'awakon-e2e-'));
  return [resolve(__dirname, '../../apps/desktop'), `--user-data-dir=${userData}`];
}

test('app launches; chrome renders; renderer console has no errors', async () => {
  const errors: string[] = [];

  const electronApp = await electron.launch({
    args: launchArgs(),
    env: { ...process.env, NODE_ENV: 'production' },
  });

  electronApp.on('window', (page) => {
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
  });

  const chrome = await electronApp.firstWindow();
  await expect(chrome.locator('#tab-strip')).toBeVisible();
  await expect(chrome.locator('#sidebar')).toBeVisible();

  // Wait briefly for any startup errors to surface.
  await chrome.waitForTimeout(1500);

  expect(errors, errors.join('\n')).toEqual([]);

  await electronApp.close();
});
