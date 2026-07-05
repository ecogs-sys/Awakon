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

  // Give the terminal view's renderer time to mount its SplitContainer and register
  // the TerminalAction listener before the menu action is dispatched to it.
  await chrome.waitForTimeout(2_500);

  // Trigger the split via the application menu (electronApp.evaluate runs in main).
  const triggerSplit = (): Promise<void> =>
    electronApp.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      const tabs = menu?.items.find((m) => m.label === 'Tabs');
      const split = tabs?.submenu?.items.find((m) => m.label === 'Split Horizontally');
      split?.click();
    });
  await triggerSplit();

  // The split spawns one pane session — total becomes 2 — and the tab count is unchanged
  // (panes are not tabs).
  await expect.poll(() => sessionCount(chrome), { timeout: 8_000 }).toBe(2);
  await expect(chrome.locator('#tab-strip .tab')).toHaveCount(1);

  await electronApp.close();
});
