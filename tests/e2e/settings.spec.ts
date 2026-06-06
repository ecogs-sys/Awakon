import { _electron as electron, expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('Settings panel saves the response text and it persists across restart', async () => {
  // A stable userData dir shared by both launches, so settings.json survives.
  const userData = mkdtempSync(join(tmpdir(), 'awakon-e2e-settings-'));
  const args = [resolve(__dirname, '../../apps/desktop'), `--user-data-dir=${userData}`];
  const env = { ...process.env, NODE_ENV: 'production' };

  // --- First launch: open Settings, change the response text, save. ---
  let app = await electron.launch({ args, env });
  let chrome = await app.firstWindow();
  await expect(chrome.locator('#tab-strip')).toBeVisible();

  await chrome.evaluate(() => {
    (window as unknown as { __awakonLayout: { openSettings(): void } }).__awakonLayout.openSettings();
  });
  await expect(chrome.locator('#set-response')).toBeVisible();
  await chrome.fill('#set-response', 'resume-now');
  await chrome.click('#set-save');
  await expect(chrome.locator('#dialog-mount.open')).toHaveCount(0);
  await app.close();

  // --- Second launch: settings.json should still hold the new value. ---
  app = await electron.launch({ args, env });
  chrome = await app.firstWindow();
  await expect(chrome.locator('#tab-strip')).toBeVisible();

  const settings = await chrome.evaluate(async () => {
    return (window as unknown as {
      awakon: { send: (c: string) => Promise<unknown> };
    }).awakon.send('core.settings.get');
  });
  expect((settings as { autoResume: { responseText: string } }).autoResume.responseText).toBe('resume-now');

  await app.close();
});
