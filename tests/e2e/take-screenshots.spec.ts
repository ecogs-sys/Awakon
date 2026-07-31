/**
 * Screenshot capture script — run once, not part of CI.
 *
 * From repo root:
 *   pnpm --filter @awakon/e2e exec playwright test take-screenshots
 *
 * Produces every docs/images/*.png used by the README, with current Awakon
 * branding and neutral demo working directories (no real home path leaks in).
 *
 * Demo paths: each session is started in a throwaway project directory under a
 * demo base (C:\dev\… on Windows) so the terminal prompt and sidebar show clean,
 * realistic paths instead of the developer's home directory. No tab is auto-opened
 * on launch, so each test creates its first tab explicitly with a demo cwd. The home
 * directory the app derives its *default* cwd from is also overridden per-launch via
 * env. All demo directories that did not already exist are removed in afterAll.
 */
import { _electron as electron, expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES = resolve(__dirname, '../../docs/images');
const APP_DIR = resolve(__dirname, '../../apps/desktop');

// ── Demo working directories ──────────────────────────────────────────────────
const isWin = process.platform === 'win32';
const DEMO_BASE = isWin ? 'C:\\dev' : join(tmpdir(), 'awakon-demo');
const sep = isWin ? '\\' : '/';
const demo = (name: string): string => `${DEMO_BASE}${sep}${name}`;
const DIRS = {
  web: demo('web-app'),
  api: demo('api'),
  docs: demo('docs'),
  infra: demo('infra'),
};

const createdDirs: string[] = [];
function ensureDir(p: string): void {
  if (!existsSync(p)) {
    mkdirSync(p, { recursive: true });
    createdDirs.push(p);
  }
}

test.beforeAll(() => {
  ensureDir(DEMO_BASE);
  for (const p of Object.values(DIRS)) ensureDir(p);
});

test.afterAll(() => {
  // Remove only the directories we created (deepest first), and only if empty-ish.
  for (const p of [...createdDirs].reverse()) {
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      /* leave it — never fail the run on cleanup */
    }
  }
});

type ElectronApp = Awaited<ReturnType<typeof electron.launch>>;
type Page = import('@playwright/test').Page;

/** Launch the packaged app with an isolated user-data dir and a demo home path. */
async function launch(home: string): Promise<ElectronApp> {
  const userData = mkdtempSync(join(tmpdir(), 'awakon-ss-'));
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    NODE_ENV: 'production',
    USERPROFILE: home,
    HOME: home,
  };
  if (isWin) {
    env['HOMEDRIVE'] = home.slice(0, 2);
    env['HOMEPATH'] = home.slice(2);
  }
  return electron.launch({ args: [APP_DIR, `--user-data-dir=${userData}`], env });
}

async function resizeWindow(app: ElectronApp): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(1280, 800);
    win.center();
  });
}

/**
 * Send raw text to a session's PTY (base64, matching the IPC contract). This must go
 * through that session's OWN terminal webContents, not chrome's: a terminal view is
 * only authorized (both by the preload allowlist and the main process's
 * isAuthorizedSender check) to write into a session it actually hosts. An inactive
 * tab's WebContentsView is hidden but still alive — reachable via Electron's
 * webContents.getAllWebContents(), just not surfaced by Playwright's
 * electronApp.windows()/'window' event (those only track top-level BrowserWindows).
 */
async function writeSession(app: ElectronApp, id: string, cmd: string): Promise<void> {
  const data = Buffer.from(cmd, 'utf8').toString('base64');
  await expect(async () => {
    await app.evaluate(async ({ webContents }, { sessionId, data }) => {
      const target = webContents.getAllWebContents().find((wc) => wc.getURL().includes(`sessionId=${sessionId}`));
      if (!target) throw new Error(`no terminal webContents found yet for session ${sessionId}`);
      await target.executeJavaScript(`
        (async () => {
          await window.awakon.send('core.session.write', ${JSON.stringify({ sessionId, data })});
        })();
      `);
    }, { sessionId: id, data });
  }).toPass({ timeout: 8_000, intervals: [250] });
}

/** Apply app settings (auto-resume config, default cwd) via IPC. */
async function applySettings(
  chrome: Page,
  settings: { autoResume: { enabled: boolean; detectText: string; responseText: string }; defaultCwd: string },
): Promise<void> {
  await chrome.evaluate(async (s) => {
    const awakon = (window as unknown as { awakon: { send(c: string, p: unknown): Promise<unknown> } }).awakon;
    await awakon.send('core.settings.update', s);
  }, settings);
}

/** Open the New Session dialog, set its working directory, and start the tab. */
async function newTab(chrome: Page, cwd: string, expectCount: number): Promise<string> {
  await chrome.locator('#new-tab').click();
  await expect(chrome.locator('#ns-start')).toBeVisible();
  await chrome.locator('#ns-cwd-field input').fill(cwd);
  await chrome.locator('#ns-start').click();
  await expect(chrome.locator('#tab-strip .tab')).toHaveCount(expectCount, { timeout: 8_000 });
  return (await chrome.locator('#tab-strip .tab').nth(expectCount - 1).getAttribute('data-session-id'))!;
}

const bellCmd = isWin ? '[char]7 | Write-Host -NoNewline\r' : "printf '\\a'\r";
const rateLimitCmd = isWin
  ? 'Write-Host "rate limit reached - quota resets at 9:30pm"\r'
  : 'printf "rate limit reached - quota resets at 9:30pm\\n"\r';
const DETECT = 'rate limit reached';

/**
 * Composite screenshot: captures chrome UI + the active terminal WebContentsView.
 *
 * Playwright's page.screenshot() works on any Page object, including those backed
 * by WebContentsViews — so we find the terminal page(s) via app.windows(), screenshot
 * each one, then composite them over the chrome capture.
 *
 * The terminal view always fills from (sidebar_x, tabs_y) to the window's
 * bottom-right corner, so the physical pixel offset is just:
 *   dx = chrome_physical_width  - terminal_physical_width
 *   dy = chrome_physical_height - terminal_physical_height
 * This sidesteps DPI-scale mismatches without needing the scale factor.
 */
async function captureComposite(app: ElectronApp, chrome: Page, outPath: string): Promise<void> {
  // Check whether the terminal view is actually visible (not suspended by a modal).
  // When a dialog opens, viewManager.suspend() sets the view bounds to 0×0.
  // Playwright screenshots the page content regardless of view size, so we must
  // check the real Electron bounds before compositing.
  const termViewVisible = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return (win.contentView.children as { getBounds(): { width: number; height: number } }[])
      .some((v) => { const b = v.getBounds(); return b.width > 10 && b.height > 10; });
  });

  if (!termViewVisible) {
    // Modal is open (settings, new-session dialog, etc.) — chrome screenshot includes it.
    await writeFile(outPath, await chrome.screenshot());
    return;
  }

  // All webContents registered with Playwright — includes chrome + terminal views.
  const allPages = app.windows();

  // Identify terminal pages: not the chrome window (which has #tab-strip in its DOM).
  const terminalPages: Page[] = [];
  for (const p of allPages) {
    const isChrome = await p.locator('#tab-strip').count().catch(() => 0);
    if (!isChrome) terminalPages.push(p);
  }

  const [chromeBuf, termBuf] = await Promise.all([
    chrome.screenshot(),
    terminalPages.length > 0 ? terminalPages[0].screenshot() : Promise.resolve(null as unknown as Buffer),
  ]);

  if (!termBuf) {
    await writeFile(outPath, chromeBuf);
    return;
  }

  // Decode both images to get their physical pixel dimensions.
  const chromeImg = decodePng(chromeBuf);
  const termImg   = decodePng(termBuf);

  if (!chromeImg || !termImg) {
    await writeFile(outPath, chromeBuf);
    return;
  }

  // The terminal fills the bottom-right of the window, so the physical offset
  // equals the difference in dimensions — DPI-scale-agnostic.
  const dx = chromeImg.width  - termImg.width;
  const dy = chromeImg.height - termImg.height;

  const composited = compositePngs(chromeBuf, termBuf, dx, dy);
  await writeFile(outPath, composited);
}

/**
 * Minimal PNG compositing: paste `overlay` into `base` at (dx, dy).
 * Works on 8-bit RGBA PNGs without external deps.
 */
function compositePngs(basePng: Buffer, overlayPng: Buffer, dx: number, dy: number): Buffer {
  const base = decodePng(basePng);
  const over = decodePng(overlayPng);
  if (!base || !over) return basePng; // fallback if decode fails

  // Copy overlay pixels into base at (dx, dy)
  for (let y = 0; y < over.height; y++) {
    const destY = dy + y;
    if (destY < 0 || destY >= base.height) continue;
    for (let x = 0; x < over.width; x++) {
      const destX = dx + x;
      if (destX < 0 || destX >= base.width) continue;
      const si = (y * over.width + x) * 4;
      const di = (destY * base.width + destX) * 4;
      const a = over.pixels[si + 3] / 255;
      if (a === 0) continue;
      base.pixels[di]     = Math.round(over.pixels[si]     * a + base.pixels[di]     * (1 - a));
      base.pixels[di + 1] = Math.round(over.pixels[si + 1] * a + base.pixels[di + 1] * (1 - a));
      base.pixels[di + 2] = Math.round(over.pixels[si + 2] * a + base.pixels[di + 2] * (1 - a));
      base.pixels[di + 3] = 255;
    }
  }

  return encodePng(base.width, base.height, base.pixels);
}

// ── Minimal PNG decoder/encoder ───────────────────────────────────────────────

import { inflateSync, deflateSync, crc32 } from 'node:zlib';

interface RawImage { width: number; height: number; pixels: Uint8Array }

function readU32(buf: Buffer, off: number): number {
  return buf.readUInt32BE(off);
}

function decodePng(png: Buffer): RawImage | null {
  try {
    if (png.readUInt32BE(0) !== 0x89504e47) return null;
    const w = readU32(png, 16);
    const h = readU32(png, 20);
    const bitDepth = png[24];
    const colorType = png[25]; // 2=RGB, 6=RGBA
    if (bitDepth !== 8) return null;
    const hasAlpha = colorType === 6 || colorType === 4;
    const chPerPx = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : 3;

    const idatChunks: Buffer[] = [];
    let pos = 8;
    while (pos < png.length - 12) {
      const len = readU32(png, pos);
      const type = png.toString('ascii', pos + 4, pos + 8);
      if (type === 'IDAT') idatChunks.push(png.subarray(pos + 8, pos + 8 + len));
      if (type === 'IEND') break;
      pos += 12 + len;
    }
    const compressed = Buffer.concat(idatChunks);
    const raw = inflateSync(compressed);

    const stride = w * chPerPx;
    const pixels = new Uint8Array(w * h * 4);
    const prev = new Uint8Array(stride + 1);

    for (let y = 0; y < h; y++) {
      const rowStart = y * (stride + 1);
      const filter = raw[rowStart];
      const row = new Uint8Array(stride);
      for (let x = 0; x < stride; x++) {
        const byte = raw[rowStart + 1 + x];
        const a = x >= chPerPx ? row[x - chPerPx] : 0;
        const b = prev[x + 1];
        const c = x >= chPerPx ? prev[x + 1 - chPerPx] : 0;
        if (filter === 0) row[x] = byte;
        else if (filter === 1) row[x] = (byte + a) & 0xff;
        else if (filter === 2) row[x] = (byte + b) & 0xff;
        else if (filter === 3) row[x] = (byte + Math.floor((a + b) / 2)) & 0xff;
        else if (filter === 4) row[x] = (byte + paethPredictor(a, b, c)) & 0xff;
        else row[x] = byte;
      }
      prev.fill(0);
      prev.set(row, 1);

      for (let x = 0; x < w; x++) {
        const di = (y * w + x) * 4;
        const si = x * chPerPx;
        if (chPerPx >= 3) {
          pixels[di]     = row[si];
          pixels[di + 1] = row[si + 1];
          pixels[di + 2] = row[si + 2];
          pixels[di + 3] = hasAlpha ? row[si + 3] : 255;
        } else {
          pixels[di] = pixels[di + 1] = pixels[di + 2] = row[si];
          pixels[di + 3] = 255;
        }
      }
    }
    return { width: w, height: h, pixels };
  } catch {
    return null;
  }
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function encodePng(w: number, h: number, pixels: Uint8Array): Buffer {
  const stride = w * 4;
  const raw = Buffer.allocUnsafe(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter = None
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = y * (stride + 1) + 1 + x * 4;
      raw[di]     = pixels[si];
      raw[di + 1] = pixels[si + 1];
      raw[di + 2] = pixels[si + 2];
      raw[di + 3] = pixels[si + 3];
    }
  }
  const compressed = deflateSync(raw, { level: 6 });

  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length, 0);
    const typeB = Buffer.from(type, 'ascii');
    const body = Buffer.concat([typeB, data]);
    const crcBuf = Buffer.allocUnsafe(4);
    crcBuf.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crcBuf]);
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('screenshot: main — single session', async () => {
  const app = await launch(DIRS.web);
  const chrome = await app.firstWindow();
  await newTab(chrome, DIRS.web, 1);
  await resizeWindow(app);
  await chrome.waitForTimeout(2_500);

  const tabId = await chrome.locator('#tab-strip .tab').nth(0).getAttribute('data-session-id');
  await writeSession(app, tabId!, isWin ? 'Get-Date\r' : 'date\r');
  await chrome.waitForTimeout(1_500);

  await captureComposite(app, chrome, join(IMAGES, 'main.png'));
  await app.close();
});

test('screenshot: new-session — pick your shell dialog', async () => {
  const app = await launch(DIRS.web);
  const chrome = await app.firstWindow();
  await newTab(chrome, DIRS.web, 1);
  await resizeWindow(app);
  await chrome.waitForTimeout(1_500);

  await chrome.locator('#new-tab').click();
  await expect(chrome.locator('#ns-start')).toBeVisible();
  await chrome.locator('#ns-cwd-field input').fill(DIRS.api);
  // Blur the field so it renders in display (dimmed-head) form, not as a raw input.
  await chrome.locator('.aip-modal__title').click();
  await chrome.waitForTimeout(500);

  await captureComposite(app, chrome, join(IMAGES, 'new-session.png'));
  await app.close();
});

test('screenshot: multi-tab — badges and sidebar', async () => {
  test.setTimeout(60_000);
  const app = await launch(DIRS.web);
  const chrome = await app.firstWindow();
  await newTab(chrome, DIRS.web, 1);
  await resizeWindow(app);
  await chrome.waitForTimeout(1_500);

  const firstTabId = await chrome.locator('#tab-strip .tab').nth(0).getAttribute('data-session-id');
  const secondTabId = await newTab(chrome, DIRS.api, 2);
  const thirdTabId = await newTab(chrome, DIRS.docs, 3);

  await chrome.locator(`#tab-strip .tab[data-session-id="${firstTabId}"]`).click();
  await chrome.waitForTimeout(500);

  for (const id of [secondTabId, thirdTabId]) {
    await writeSession(app, id, bellCmd);
  }

  await expect(chrome.locator(`#tab-strip .tab[data-session-id="${secondTabId}"] .dot.awaiting`)).toBeVisible({ timeout: 8_000 });
  await expect(chrome.locator(`#tab-strip .tab[data-session-id="${thirdTabId}"] .dot.awaiting`)).toBeVisible({ timeout: 8_000 });
  await chrome.waitForTimeout(1_500);

  await captureComposite(app, chrome, join(IMAGES, 'multi-tab.png'));
  await app.close();
});

test('screenshot: auto-resume — rate-limited tab with pending resume', async () => {
  const app = await launch(DIRS.api);
  const chrome = await app.firstWindow();
  await newTab(chrome, DIRS.api, 1);
  await resizeWindow(app);
  // Let the boot shell finish starting before we apply settings + write to it,
  // otherwise the rate-limit line can be written before the PTY is ready.
  await chrome.waitForTimeout(3_000);

  await applySettings(chrome, {
    autoResume: { enabled: true, detectText: DETECT, responseText: 'continue' },
    defaultCwd: '',
  });
  await chrome.waitForTimeout(500);

  const tabId = await chrome.locator('#tab-strip .tab').nth(0).getAttribute('data-session-id');
  await writeSession(app, tabId!, rateLimitCmd);

  // The detector parses "9:30pm" and schedules a resume → sidebar shows the limited pill.
  await expect(chrome.locator('#sidebar-list .sr-pill.limited')).toBeVisible({ timeout: 12_000 });
  await chrome.waitForTimeout(1_000);

  await captureComposite(app, chrome, join(IMAGES, 'auto-resume.png'));
  await app.close();
});

test('screenshot: settings — auto-resume dialog', async () => {
  const app = await launch(DIRS.web);
  const chrome = await app.firstWindow();
  await expect(chrome.locator('#tab-strip')).toBeVisible({ timeout: 10_000 });
  await resizeWindow(app);
  await chrome.waitForTimeout(1_500);

  await applySettings(chrome, {
    autoResume: { enabled: true, detectText: "You've hit your limit", responseText: 'continue' },
    defaultCwd: DEMO_BASE,
  });

  await chrome.evaluate(() => {
    (window as unknown as { __awakonLayout: { openSettings(): void } }).__awakonLayout.openSettings();
  });
  await expect(chrome.locator('#set-response')).toBeVisible({ timeout: 5_000 });
  await chrome.waitForTimeout(400);

  await captureComposite(app, chrome, join(IMAGES, 'settings.png'));
  await app.close();
});

test('screenshot: splits — horizontal split pane', async () => {
  const app = await launch(DIRS.web);
  const chrome = await app.firstWindow();
  await newTab(chrome, DIRS.web, 1);
  await resizeWindow(app);
  await chrome.waitForTimeout(2_500);

  await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const tabs = menu?.items.find((m) => m.label === 'Tabs');
    const split = tabs?.submenu?.items.find((m) => m.label === 'Split Horizontally');
    split?.click();
  });
  await chrome.waitForTimeout(2_500);

  await captureComposite(app, chrome, join(IMAGES, 'splits.png'));
  await app.close();
});

test('screenshot: splits-vertical — vertical split pane', async () => {
  const app = await launch(DIRS.web);
  const chrome = await app.firstWindow();
  await newTab(chrome, DIRS.web, 1);
  await resizeWindow(app);
  await chrome.waitForTimeout(2_500);

  await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const tabs = menu?.items.find((m) => m.label === 'Tabs');
    const split = tabs?.submenu?.items.find((m) => m.label === 'Split Vertically');
    split?.click();
  });
  await chrome.waitForTimeout(2_500);

  await captureComposite(app, chrome, join(IMAGES, 'splits-vertical.png'));
  await app.close();
});

test('screenshot: sidebar — live status close-up', async () => {
  test.setTimeout(60_000);
  const app = await launch(DIRS.web);
  const chrome = await app.firstWindow();
  await newTab(chrome, DIRS.web, 1);
  await resizeWindow(app);
  await chrome.waitForTimeout(1_500);

  await applySettings(chrome, {
    autoResume: { enabled: true, detectText: DETECT, responseText: 'continue' },
    defaultCwd: '',
  });

  const runningId = await chrome.locator('#tab-strip .tab').nth(0).getAttribute('data-session-id');
  const limitedId = await newTab(chrome, DIRS.api, 2);
  const awaitingId = await newTab(chrome, DIRS.docs, 3);
  const idleId = await newTab(chrome, DIRS.infra, 4);

  // Focus the running tab so the others stay "background" (needed for attention badge).
  await chrome.locator(`#tab-strip .tab[data-session-id="${runningId}"]`).click();
  await chrome.waitForTimeout(400);

  await writeSession(app, limitedId, rateLimitCmd);   // → limited
  await writeSession(app, awaitingId, bellCmd);        // → awaiting (background)
  await writeSession(app, idleId, isWin ? 'exit\r' : 'exit\r'); // → exited (idle bucket)

  await expect(chrome.locator('#sidebar-list .sr-pill.limited')).toBeVisible({ timeout: 8_000 });
  await expect(chrome.locator(`#tab-strip .tab[data-session-id="${awaitingId}"] .dot.awaiting`)).toBeVisible({ timeout: 8_000 });
  await chrome.waitForTimeout(1_500);

  // The sidebar is pure chrome DOM, so an element screenshot gives a crisp close-up.
  await chrome.locator('#sidebar').screenshot({ path: join(IMAGES, 'sidebar.png') });
  await app.close();
});
