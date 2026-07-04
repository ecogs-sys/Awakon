// Regenerate Awakon's packaged app icons from the "aperture" brand mark.
//
//   pnpm icons   (→ node scripts/generate-icons.mjs)
//
// The mark is rendered from SVG at every target size (crisper than resizing a
// single raster), then packed into the platform icon containers. The in-app SVG
// (apps/desktop/src/renderer/chrome/icon.ts) references theme CSS vars a
// rasterizer can't resolve, so this master embeds the literal Hot Wax colors
// from the design handoff's canonical thumbnail.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { format as icnsFormat } from 'icns-lib';

const ROOT  = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(ROOT, 'apps', 'desktop', 'build');

const TILE = '#1a1720';
const RING = '#C36BEF';
const CARET = '#f0ecf4';

const R = 27;
const CIRC = 2 * Math.PI * R;
const GAP = CIRC * 0.2;      // notch at the top of the ring
const DASH = CIRC - GAP;

/** The aperture mark as an SVG string sized to `size` px, with literal colors. */
function markSvg(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="rgba(255,255,255,0.09)"/>
        <stop offset="1" stop-color="rgba(255,255,255,0)"/>
      </linearGradient>
    </defs>
    <rect width="100" height="100" rx="22" fill="${TILE}"/>
    <rect width="100" height="100" rx="22" fill="url(#g)"/>
    <circle cx="50" cy="50" r="${R}" fill="none" stroke="${RING}" stroke-width="8"
            stroke-linecap="round" stroke-dasharray="${DASH.toFixed(2)} ${GAP.toFixed(2)}"
            transform="rotate(-72 50 50)"/>
    <path d="M39 56 L50 45 L61 56" fill="none" stroke="${CARET}" stroke-width="7.5"
          stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

// Linux: 8 sizes covering every density the FreeDesktop spec uses
const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];
// Windows ICO: standard multi-resolution set
const ICO_SIZES   = [16, 24, 32, 48, 64, 128, 256];
// macOS ICNS: OSType tag → pixel size
const ICNS_TAGS   = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024 };

async function render(size) {
  return sharp(Buffer.from(markSvg(size))).resize(size, size).png().toBuffer();
}

console.log('Rendering the Awakon aperture mark…\n');

// ── icon.png master (Linux + electron-builder extraResources) ───────────────
writeFileSync(join(BUILD, 'icon.png'), await render(512));
console.log('  build/icon.png');

// ── Linux ───────────────────────────────────────────────────────────────────
const iconsDir = join(BUILD, 'icons');
mkdirSync(iconsDir, { recursive: true });
for (const size of LINUX_SIZES) {
  writeFileSync(join(iconsDir, `${size}x${size}.png`), await render(size));
  console.log(`  build/icons/${size}x${size}.png`);
}

// ── Windows ───────────────────────────────────────────────────────────────
const icoBufs = await Promise.all(ICO_SIZES.map(render));
writeFileSync(join(BUILD, 'icon.ico'), await pngToIco(icoBufs));
console.log('  build/icon.ico');

// ── macOS ─────────────────────────────────────────────────────────────────
const icnsImages = Object.fromEntries(
  await Promise.all(
    Object.entries(ICNS_TAGS).map(async ([tag, size]) => [tag, await render(size)]),
  ),
);
writeFileSync(join(BUILD, 'icon.icns'), icnsFormat(icnsImages));
console.log('  build/icon.icns');

console.log('\nDone.');
