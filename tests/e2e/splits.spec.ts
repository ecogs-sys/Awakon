import { _electron as electron, expect, test } from '@playwright/test';
import { launchArgs, sessionCount } from './helpers.js';

test('split menu action creates a new pane session', async () => {
  const electronApp = await electron.launch({
    args: launchArgs(),
    env: { ...process.env, NODE_ENV: 'production' },
  });
  const chrome = await electronApp.firstWindow();

  // No tab is auto-opened on launch (isolated userData dir has no saved layout to
  // restore), so create the first tab via the chrome's "+" button.
  await chrome.locator('#new-tab').click();
  await expect(chrome.locator('#ns-start')).toBeVisible();
  await chrome.locator('#ns-start').click();
  await expect(chrome.locator('#tab-strip .tab')).toHaveCount(1, { timeout: 8_000 });

  // One tab session now, no panes yet.
  await expect.poll(() => sessionCount(chrome), { timeout: 8_000 }).toBe(1);

  // Trigger the split via the application menu (electronApp.evaluate runs in main).
  const triggerSplit = (): Promise<void> =>
    electronApp.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      const tabs = menu?.items.find((m) => m.label === 'Tabs');
      const split = tabs?.submenu?.items.find((m) => m.label === 'Split Horizontally');
      split?.click();
    });

  // The terminal view's renderer needs a moment to mount its SplitContainer and
  // register the TerminalAction listener before the menu action has anywhere to land.
  // Rather than a blind fixed wait (A7-M1), retry the trigger until the session count
  // actually reflects the split: main.ts's webContents.send() has no queue, so a click
  // sent before the listener registers is simply never received — retrying is safe, it
  // cannot cause a double split once one has already landed (the loop stops there).
  await expect(async () => {
    await triggerSplit();
    expect(await sessionCount(chrome)).toBe(2);
  }).toPass({ timeout: 8_000, intervals: [250] });

  // The split spawns one pane session — total becomes 2 — and the tab count is unchanged
  // (panes are not tabs).
  await expect(chrome.locator('#tab-strip .tab')).toHaveCount(1);

  await electronApp.close();
});
