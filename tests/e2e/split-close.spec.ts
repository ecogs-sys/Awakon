import { _electron as electron, expect, test } from '@playwright/test';
import { launchArgs, sessionCount } from './helpers.js';

// R3: closing a tab that has splits from the tab strip's × must tear down the whole
// tab in one action — panes included — not just the primary pane (which would leave
// the sibling pane's session running and require clicking close once per pane).
test('closing a split tab from the tab strip × removes the tab and all its panes in one action', async () => {
  const electronApp = await electron.launch({
    args: launchArgs(),
    env: { ...process.env, NODE_ENV: 'production' },
  });
  const chrome = await electronApp.firstWindow();

  await chrome.locator('#new-tab').click();
  await expect(chrome.locator('#ns-start')).toBeVisible();
  await chrome.locator('#ns-start').click();
  await expect(chrome.locator('#tab-strip .tab')).toHaveCount(1, { timeout: 8_000 });
  await expect.poll(() => sessionCount(chrome), { timeout: 8_000 }).toBe(1);

  const triggerSplit = (): Promise<void> =>
    electronApp.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      const tabs = menu?.items.find((m) => m.label === 'Tabs');
      const split = tabs?.submenu?.items.find((m) => m.label === 'Split Horizontally');
      split?.click();
    });

  // The terminal view's renderer needs a moment to mount its SplitContainer and
  // register the TerminalAction listener before the menu action has anywhere to land.
  // Rather than a blind fixed wait, retry the trigger until the session count actually
  // reflects the split: main.ts's webContents.send() has no queue, so a click sent
  // before the listener registers is simply never received — retrying is safe, it
  // cannot cause a double split once one has already landed (the loop stops there).
  await expect(async () => {
    await triggerSplit();
    expect(await sessionCount(chrome)).toBe(2);
  }).toPass({ timeout: 8_000, intervals: [250] });

  // Tab still owns 1 strip entry with both sessions (primary pane + split pane).
  await expect(chrome.locator('#tab-strip .tab')).toHaveCount(1);

  // Close the tab from the tab strip — the × button, not a pane-level close.
  await chrome.locator('#tab-strip .tab .close').click();

  // One click; the tab is gone AND both its sessions (primary + split pane) are gone —
  // not left requiring a second close for the surviving pane (the R3 regression).
  await expect(chrome.locator('#tab-strip .tab')).toHaveCount(0, { timeout: 8_000 });
  await expect.poll(() => sessionCount(chrome), { timeout: 8_000 }).toBe(0);

  await electronApp.close();
});
