import { _electron as electron, expect, test } from '@playwright/test';
import { launchArgs } from './helpers.js';

test('app launches; chrome renders; renderer console has no errors', async () => {
  const errors: string[] = [];

  const electronApp = await electron.launch({
    args: launchArgs(),
    env: { ...process.env, NODE_ENV: 'production' },
  });

  // A7-I2: the app's first window is created as an immediate consequence of
  // app.whenReady() inside launch() — by the time launch() resolves, that window may
  // already exist, so an `electronApp.on('window', ...)` listener registered only now
  // can miss it entirely (no listeners are ever attached to it, not just an early
  // sliver of its errors). Attach directly to the window firstWindow() actually hands
  // back instead of relying on the event having not fired yet.
  const chrome = await electronApp.firstWindow();
  chrome.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  chrome.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  // Defense in depth for any window created after this point.
  electronApp.on('window', (page) => {
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
  });

  await expect(chrome.locator('#tab-strip')).toBeVisible();
  await expect(chrome.locator('#sidebar')).toBeVisible();

  // Wait briefly for any startup errors to surface.
  await chrome.waitForTimeout(1500);

  expect(errors, errors.join('\n')).toEqual([]);

  await electronApp.close();
});
