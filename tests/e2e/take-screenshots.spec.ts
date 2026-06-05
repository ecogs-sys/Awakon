/**
 * Screenshot capture script — run once, not part of CI.
 *
 * From repo root:
 *   pnpm --filter @awakon/e2e exec playwright test take-screenshots
 */
import { _electron as electron, expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES = resolve(__dirname, '../../docs/images');

function launchArgs(): string[] {
  const userData = mkdtempSync(join(tmpdir(), 'awakon-ss-'));
  return [resolve(__dirname, '../../apps/desktop'), `--user-data-dir=${userData}`];
}

async function resizeWindow(app: Awaited<ReturnType<typeof electron.launch>>) {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(1280, 800);
    win.center();
  });
}

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
async function captureComposite(
  app: Awaited<ReturnType<typeof electron.launch>>,
  chrome: import('@playwright/test').Page,
  outPath: string,
) {
  // Check whether the terminal view is actually visible (not suspended by a modal).
  // When the settings dialog opens, viewManager.suspend() sets the view bounds to 0×0.
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
  const terminalPages: import('@playwright/test').Page[] = [];
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
  // PNG layout: 8-byte signature + chunks. Each chunk: 4-byte length, 4-byte type, data, 4-byte CRC.
  // We only need width/height from IHDR (offset 16 for width, 20 for height in the file).
  // For a quick composite we'll use a trick: return a multi-image APNG or just use
  // the ImageData approach below.
  //
  // Practical approach: decode both PNGs to raw pixels, composite, re-encode.
  // We use the built-in zlib + a hand-rolled PNG encoder so there's no npm dependency.

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
    // Signature (8) + IHDR chunk (4+4+13+4 = 25 bytes)
    if (png.readUInt32BE(0) !== 0x89504e47) return null;
    const w = readU32(png, 16);
    const h = readU32(png, 20);
    const bitDepth = png[24];
    const colorType = png[25]; // 2=RGB, 6=RGBA
    if (bitDepth !== 8) return null;
    const hasAlpha = colorType === 6 || colorType === 4;
    const chPerPx = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : 3;

    // Collect IDAT chunks
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

    // Un-filter
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
  // Build raw (unfiltered) scanlines
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
  const app = await electron.launch({
    args: launchArgs(),
    env: { ...process.env, NODE_ENV: 'production' },
  });
  const chrome = await app.firstWindow();
  await expect(chrome.locator('#tab-strip .tab')).toHaveCount(1, { timeout: 10_000 });
  await resizeWindow(app);
  await chrome.waitForTimeout(2_500);

  const tabId = await chrome.locator('#tab-strip .tab').nth(0).getAttribute('data-session-id');
  const cmd = process.platform === 'win32' ? 'Get-Date\r' : 'date\r';
  await chrome.evaluate(
    async ({ id, cmd }: { id: string; cmd: string }) => {
      const awakon = (window as unknown as { awakon: { send(c: string, p: unknown): Promise<unknown> } }).awakon;
      await awakon.send('core.session.write', { sessionId: id, data: btoa(unescape(encodeURIComponent(cmd))) });
    },
    { id: tabId!, cmd },
  );
  await chrome.waitForTimeout(1_500);

  await captureComposite(app, chrome, join(IMAGES, 'main.png'));
  await app.close();
});

test('screenshot: multi-tab — badges and sidebar', async () => {
  const app = await electron.launch({
    args: launchArgs(),
    env: { ...process.env, NODE_ENV: 'production' },
  });
  const chrome = await app.firstWindow();
  await expect(chrome.locator('#tab-strip .tab')).toHaveCount(1, { timeout: 10_000 });
  await resizeWindow(app);
  await chrome.waitForTimeout(1_500);

  const firstTabId = await chrome.locator('#tab-strip .tab').nth(0).getAttribute('data-session-id');

  await chrome.locator('#new-tab').click();
  await expect(chrome.locator('#ns-start')).toBeVisible();
  await chrome.locator('#ns-start').click();
  await expect(chrome.locator('#tab-strip .tab')).toHaveCount(2, { timeout: 8_000 });
  const secondTabId = await chrome.locator('#tab-strip .tab').nth(1).getAttribute('data-session-id');

  await chrome.locator('#new-tab').click();
  await expect(chrome.locator('#ns-start')).toBeVisible();
  await chrome.locator('#ns-start').click();
  await expect(chrome.locator('#tab-strip .tab')).toHaveCount(3, { timeout: 8_000 });
  const thirdTabId = await chrome.locator('#tab-strip .tab').nth(2).getAttribute('data-session-id');

  await chrome.locator(`#tab-strip .tab[data-session-id="${firstTabId}"]`).click();
  await chrome.waitForTimeout(500);

  const bellCmd = process.platform === 'win32'
    ? '[char]7 | Write-Host -NoNewline\r'
    : "printf '\\a'\r";

  for (const id of [secondTabId!, thirdTabId!]) {
    await chrome.evaluate(
      async ({ id, cmd }: { id: string; cmd: string }) => {
        const awakon = (window as unknown as { awakon: { send(c: string, p: unknown): Promise<unknown> } }).awakon;
        await awakon.send('core.session.write', { sessionId: id, data: btoa(unescape(encodeURIComponent(cmd))) });
      },
      { id, cmd: bellCmd },
    );
  }

  await expect(
    chrome.locator(`#tab-strip .tab[data-session-id="${secondTabId}"] .dot.awaiting`),
  ).toBeVisible({ timeout: 8_000 });
  await expect(
    chrome.locator(`#tab-strip .tab[data-session-id="${thirdTabId}"] .dot.awaiting`),
  ).toBeVisible({ timeout: 8_000 });
  await chrome.waitForTimeout(1_500);

  await captureComposite(app, chrome, join(IMAGES, 'multi-tab.png'));
  await app.close();
});

test('screenshot: splits — horizontal split pane', async () => {
  const app = await electron.launch({
    args: launchArgs(),
    env: { ...process.env, NODE_ENV: 'production' },
  });
  const chrome = await app.firstWindow();
  await expect(chrome.locator('#tab-strip .tab')).toHaveCount(1, { timeout: 10_000 });
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

test('screenshot: settings — auto-resume dialog', async () => {
  const app = await electron.launch({
    args: launchArgs(),
    env: { ...process.env, NODE_ENV: 'production' },
  });
  const chrome = await app.firstWindow();
  await expect(chrome.locator('#tab-strip')).toBeVisible({ timeout: 10_000 });
  await resizeWindow(app);
  await chrome.waitForTimeout(1_500);

  await chrome.evaluate(() => {
    (window as unknown as { __awakonLayout: { openSettings(): void } }).__awakonLayout.openSettings();
  });
  await expect(chrome.locator('#set-response')).toBeVisible({ timeout: 5_000 });
  await chrome.waitForTimeout(400);

  await captureComposite(app, chrome, join(IMAGES, 'settings.png'));
  await app.close();
});
