import { _electron as electron, expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Launch args with an isolated, empty userData dir so persisted tabs from a previous
 * run (or another spec) cannot leak in. */
function launchArgs(): string[] {
  const userData = mkdtempSync(join(tmpdir(), 'awakon-e2e-'));
  return [resolve(__dirname, '../../apps/desktop'), `--user-data-dir=${userData}`];
}

/** Query the total session count (tabs + panes) via the chrome IPC bridge. */
async function sessionCount(chrome: import('@playwright/test').Page): Promise<number> {
  return chrome.evaluate(async () => {
    const awakon = (window as unknown as {
      awakon: { send: (c: string, p?: unknown) => Promise<unknown> };
    }).awakon;
    const list = (await awakon.send('core.session.list')) as unknown[];
    return list.length;
  });
}

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

  // Give the terminal view's renderer time to mount its SplitContainer and register
  // the TerminalAction listener before the menu action is dispatched to it.
  await chrome.waitForTimeout(2_500);

  const triggerSplit = (): Promise<void> =>
    electronApp.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      const tabs = menu?.items.find((m) => m.label === 'Tabs');
      const split = tabs?.submenu?.items.find((m) => m.label === 'Split Horizontally');
      split?.click();
    });
  await triggerSplit();

  // Tab now owns 2 sessions (primary pane + split pane), still 1 tab in the strip.
  await expect.poll(() => sessionCount(chrome), { timeout: 8_000 }).toBe(2);
  await expect(chrome.locator('#tab-strip .tab')).toHaveCount(1);

  // Close the tab from the tab strip — the × button, not a pane-level close.
  await chrome.locator('#tab-strip .tab .close').click();

  // One click; the tab is gone AND both its sessions (primary + split pane) are gone —
  // not left requiring a second close for the surviving pane (the R3 regression).
  await expect(chrome.locator('#tab-strip .tab')).toHaveCount(0, { timeout: 8_000 });
  await expect.poll(() => sessionCount(chrome), { timeout: 8_000 }).toBe(0);

  await electronApp.close();
});
