// Phase 3: shell integration through git-bash, which uses a completely different
// injection mechanism from pwsh — `--init-file` (a real file that REPLACES ~/.bashrc)
// versus `-EncodedCommand` (no file at all). Unit tests check the script text; only a
// real session proves the hooks fire and that the user's rc still got sourced.
import { _electron as electron, expect, test } from '@playwright/test';
import { launchArgs } from './helpers.js';

const CR = 13;
const typeLine = (s: string): string =>
  Buffer.from([...Array.from(s, (c) => c.charCodeAt(0)), CR]).toString('base64');

test('git-bash session reports its foreground command', async () => {
  test.setTimeout(120_000);
  const electronApp = await electron.launch({
    args: launchArgs(),
    env: { ...process.env, NODE_ENV: 'production' },
  });
  const chrome = await electronApp.firstWindow();

  await chrome.locator('#new-tab').click();
  await expect(chrome.locator('#ns-start')).toBeVisible();

  // The shell picker is a radio row of buttons labelled by shell name.
  await chrome.locator('.aip-radio', { hasText: 'git-bash' }).click();
  await chrome.locator('#ns-start').click();
  await expect(chrome.locator('#tab-strip .tab')).toHaveCount(1, { timeout: 10_000 });

  const session = await chrome.evaluate(async () => {
    const awakon = (window as any).awakon;
    const list = (await awakon.send('core.session.list')) as any[];
    return { id: list[0].id as string, shell: list[0].shell as string };
  });
  console.log('SESSION:', JSON.stringify(session));
  expect(session.shell).toBe('git-bash');

  const inTerm = async (script: string): Promise<any> =>
    electronApp.evaluate(
      async ({ webContents }, args) => {
        const target = webContents
          .getAllWebContents()
          .find((wc) => wc.getURL().includes('sessionId=' + args.sessionId));
        if (!target) return { __error: 'terminal webContents not found' };
        return target.executeJavaScript(args.script);
      },
      { sessionId: session.id, script },
    );

  await expect.poll(async () => inTerm('!!window.__awakonSplits'), { timeout: 15_000 }).toBe(true);

  const send = async (data: string): Promise<any> =>
    inTerm(
      'window.awakon.send("core.session.write", { sessionId: ' +
        JSON.stringify(session.id) +
        ', data: ' +
        JSON.stringify(data) +
        ' })',
    );

  const foreground = async (): Promise<unknown> =>
    inTerm('window.__awakonSplits.focused.host.foregroundCommand');

  // Idle at the prompt first — proves the precmd hook ran and reported nothing running.
  await expect.poll(foreground, { timeout: 25_000 }).toBeNull();

  // A long-running command stays in the foreground long enough to observe.
  await send(typeLine('sleep 20'));
  await expect.poll(foreground, { timeout: 25_000 }).toBe('sleep');
  console.log('DURING sleep: foregroundCommand = sleep');

  // ...and clears again once it finishes, via the next prompt.
  await send(typeLine(''));
  await expect.poll(foreground, { timeout: 40_000 }).toBeNull();
  console.log('AFTER: foregroundCommand = null');

  await electronApp.close();
});
