// Shell integration end-to-end, against the real app and the real agent CLIs.
//
// This is the case unit tests cannot cover: Codex renders its UI inline in the normal
// buffer without taking the alternate screen or the mouse, and sets no OSC title, so
// terminal-mode detection is blind to it by construction. Only shell integration sees
// it — which means only a real run proves the feature works.
import { _electron as electron, expect, test } from '@playwright/test';
import { launchArgs } from './helpers.js';

const CR = 13;
const b64 = (bytes: number[]): string => Buffer.from(bytes).toString('base64');
const typeLine = (s: string): string => b64([...Array.from(s, (c) => c.charCodeAt(0)), CR]);

test('shell integration reports the foreground command for codex', async () => {
  test.setTimeout(180_000);
  const electronApp = await electron.launch({
    args: launchArgs(),
    env: { ...process.env, NODE_ENV: 'production' },
  });
  const chrome = await electronApp.firstWindow();

  await chrome.locator('#new-tab').click();
  await expect(chrome.locator('#ns-start')).toBeVisible();
  await chrome.locator('#ns-start').click();
  await expect(chrome.locator('#tab-strip .tab')).toHaveCount(1, { timeout: 10_000 });

  const sessionId = await chrome.evaluate(async () => {
    const awakon = (window as any).awakon;
    const list = (await awakon.send('core.session.list')) as any[];
    return list[0].id as string;
  });

  const inTerm = async (script: string): Promise<any> =>
    electronApp.evaluate(
      async ({ webContents }, { sessionId, script }) => {
        const target = webContents
          .getAllWebContents()
          .find((wc) => wc.getURL().includes(`sessionId=${sessionId}`));
        if (!target) return { __error: 'terminal webContents not found' };
        return target.executeJavaScript(script);
      },
      { sessionId, script },
    );

  await expect.poll(async () => inTerm('!!window.__awakonSplits'), { timeout: 15_000 }).toBe(true);

  const send = async (data: string): Promise<any> =>
    inTerm(
      `window.awakon.send(${JSON.stringify('core.session.write')}, { sessionId: ${JSON.stringify(sessionId)}, data: ${JSON.stringify(data)} })`,
    );

  /** What main thinks is running, and what the pane will do on right-click. */
  const state = async (): Promise<any> =>
    inTerm(`
      (() => {
        const host = window.__awakonSplits.focused.host;
        return {
          foregroundCommand: host.foregroundCommand,
          action: host.resolveRightClickAction(),
          bufferType: host.term.buffer.active.type,
          mouseTrackingMode: host.term.modes.mouseTrackingMode,
        };
      })()
    `);

  // The shell must report itself idle at the prompt before anything is run.
  await expect.poll(async () => (await state()).action, { timeout: 20_000 }).toBe('menu');
  const atPrompt = await state();
  console.log('AT PROMPT:', JSON.stringify(atPrompt));
  expect(atPrompt.foregroundCommand).toBeNull();

  // Run the real codex CLI.
  await send(typeLine('codex'));

  await expect
    .poll(async () => (await state()).foregroundCommand, { timeout: 60_000 })
    .toBe('codex');

  const running = await state();
  console.log('CODEX RUNNING:', JSON.stringify(running));

  // The point of the exercise: codex is invisible to terminal-mode detection, yet the
  // policy still resolves to paste because the shell told us what it launched.
  expect(running.bufferType).toBe('normal');
  expect(running.mouseTrackingMode).toBe('none');
  expect(running.action).toBe('paste');

  // And the menu really does not open.
  const click = await inTerm(`
    (() => {
      const pane = document.querySelector('#term-root').firstElementChild;
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 40 });
      pane.dispatchEvent(down);
      const ctx = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 });
      pane.dispatchEvent(ctx);
      return { mousedownPrevented: down.defaultPrevented, menuPresent: !!document.querySelector('.aip-ctx-menu') };
    })()
  `);
  console.log('RIGHT-CLICK:', JSON.stringify(click));
  expect(click.menuPresent).toBe(false);
  expect(click.mousedownPrevented).toBe(true);

  await electronApp.close();
});

