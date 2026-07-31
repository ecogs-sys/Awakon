import { _electron as electron, expect, test } from '@playwright/test';
import { launchArgs } from './helpers.js';

test('opening a 2nd tab and triggering BEL badges the inactive tab', async () => {
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

  // Open a 2nd tab via the chrome's "+" button.
  await chrome.locator('#new-tab').click();
  // NewSessionDialog appears and must be visible (not covered by the terminal view).
  await expect(chrome.locator('#ns-start')).toBeVisible();
  await chrome.locator('#ns-start').click();
  await expect(chrome.locator('#tab-strip .tab')).toHaveCount(2, { timeout: 8_000 });

  // Click back to the first tab so the second is unfocused.
  const firstTabId = await chrome.locator('#tab-strip .tab').nth(0).getAttribute('data-session-id');
  const secondTabId = await chrome.locator('#tab-strip .tab').nth(1).getAttribute('data-session-id');
  expect(firstTabId).toBeTruthy();
  expect(secondTabId).toBeTruthy();
  await chrome.locator(`#tab-strip .tab[data-session-id="${firstTabId}"]`).click();

  // Write a BEL-producing command to the SECOND session's own PTY. This must go through
  // that session's OWN terminal webContents, not chrome's: a terminal view is only
  // authorized (both by the preload allowlist and the main process's isAuthorizedSender
  // check) to write into a session it actually hosts, and the inactive 2nd tab's
  // WebContentsView is hidden (positioned offscreen) but still alive — reachable via
  // Electron's webContents.getAllWebContents(), just not surfaced by Playwright's
  // electronApp.windows()/'window' event (those only track top-level BrowserWindows).
  // PowerShell on Windows: `[char]7 | Write-Host -NoNewline\r`
  const bellCmd = process.platform === 'win32'
    ? '[char]7 | Write-Host -NoNewline\r'
    : `printf '\\a'\r`;
  const data = Buffer.from(bellCmd, 'utf8').toString('base64');

  // The 2nd tab's WebContentsView is still navigating to terminal-host.html at this
  // point (its load() is async and started only just before this), so its webContents
  // may not have committed the sessionId URL yet — retry until it has.
  await expect(async () => {
    await electronApp.evaluate(async ({ webContents }, { sessionId, data }) => {
      const target = webContents.getAllWebContents().find((wc) => wc.getURL().includes(`sessionId=${sessionId}`));
      if (!target) throw new Error(`no terminal webContents found yet for session ${sessionId}`);
      await target.executeJavaScript(`
        (async () => {
          await window.awakon.send('core.session.write', ${JSON.stringify({ sessionId, data })});
        })();
      `);
    }, { sessionId: secondTabId!, data });
  }).toPass({ timeout: 8_000, intervals: [250] });

  // Wait for the attention dot to appear on the second tab.
  await expect(
    chrome.locator(`#tab-strip .tab[data-session-id="${secondTabId}"] .dot.awaiting`),
  ).toBeVisible({ timeout: 6_000 });

  await electronApp.close();
});
