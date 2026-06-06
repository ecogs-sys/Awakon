# Cross-Platform Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and commit `build/icon.ico`, `build/icon.icns`, and `build/icons/*.png` from the existing 1024×1024 source PNG so all three platform builds get proper app icons.

**Architecture:** A single Node.js script (`scripts/generate-icons.mjs`) reads `apps/desktop/build/icon.png`, uses `sharp` to resize to every required size, `png-to-ico` to encode a multi-resolution ICO, and `icns-lib` to encode an ICNS. All outputs are committed to `build/` so electron-builder picks them up automatically via `buildResources: "build"`.

**Tech Stack:** Node.js ESM (`"type": "module"` in root workspace), `sharp` ^0.33, `png-to-ico` ^2.1, `icns-lib` ^3.0

---

### Task 1: Add dependencies and `icons` script to root package.json

The script lives at `scripts/generate-icons.mjs` (repo root level), so its dependencies belong in the root `package.json` devDependencies — not in `apps/desktop/package.json`. The `"icons"` script entry also goes in the root so it's invokable as `pnpm icons` from anywhere in the repo.

**Files:**
- Modify: `package.json` (repo root)

- [ ] **Step 1: Add devDependencies and script to root package.json**

Open `package.json` at the repo root. Add three devDependencies and one script entry. The file currently looks like:

```json
{
  "scripts": {
    "dev": "...",
    "build": "...",
    ...
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    ...
  }
}
```

Add `"icons"` to `scripts` and `sharp`, `png-to-ico`, `icns-lib` to `devDependencies`:

```json
{
  "scripts": {
    "dev": "pnpm --filter @awakon/desktop dev",
    "build": "pnpm -r --filter './packages/*' build && pnpm --filter @awakon/desktop build",
    "test": "pnpm -r --if-present --filter=!@awakon/e2e --filter=!@awakon/integration test",
    "test:integration": "pnpm --filter @awakon/integration test",
    "test:e2e": "pnpm --filter @awakon/e2e test",
    "lint": "eslint . --ext .ts,.tsx",
    "typecheck": "pnpm -r typecheck",
    "format": "prettier --write .",
    "icons": "node scripts/generate-icons.mjs"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@typescript-eslint/eslint-plugin": "^7.18.0",
    "@typescript-eslint/parser": "^7.18.0",
    "eslint": "^8.57.0",
    "icns-lib": "^3.0.0",
    "png-to-ico": "^2.1.8",
    "prettier": "^3.3.0",
    "sharp": "^0.33.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run from the repo root:

```bash
pnpm install
```

Expected: pnpm resolves and installs `sharp`, `png-to-ico`, `icns-lib` into `node_modules`. `sharp` will download a prebuilt binary for the current platform.

- [ ] **Step 3: Verify packages are installed**

```bash
node -e "import('sharp').then(m => console.log('sharp ok', m.default.versions))"
node -e "import('png-to-ico').then(() => console.log('png-to-ico ok'))"
node -e "import('icns-lib').then(() => console.log('icns-lib ok'))"
```

Expected: three `ok` lines, no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add sharp, png-to-ico, icns-lib for icon generation"
```

---

### Task 2: Write and run the generate-icons script

**Files:**
- Create: `scripts/generate-icons.mjs`

- [ ] **Step 1: Create `scripts/generate-icons.mjs`**

```javascript
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import icns from 'icns-lib';

const ROOT  = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(ROOT, 'apps', 'desktop', 'build');
const SOURCE = join(BUILD, 'icon.png');

// Linux: 8 sizes covering every density the FreeDesktop spec uses
const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];
// Windows ICO: standard multi-resolution set (256 is stored as PNG inside the ICO)
const ICO_SIZES   = [16, 24, 32, 48, 64, 128, 256];
// macOS ICNS: OSType tag → pixel size (icp4–ic10 covers all Retina and non-Retina slots)
const ICNS_TAGS   = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024 };

async function resize(size) {
  return sharp(SOURCE).resize(size, size).png().toBuffer();
}

console.log(`Source: ${SOURCE}\n`);

// ── Linux ─────────────────────────────────────────────────────────────────
const iconsDir = join(BUILD, 'icons');
mkdirSync(iconsDir, { recursive: true });
for (const size of LINUX_SIZES) {
  writeFileSync(join(iconsDir, `${size}x${size}.png`), await resize(size));
  console.log(`  build/icons/${size}x${size}.png`);
}

// ── Windows ───────────────────────────────────────────────────────────────
const icoBufs = await Promise.all(ICO_SIZES.map(resize));
writeFileSync(join(BUILD, 'icon.ico'), await pngToIco(icoBufs));
console.log('  build/icon.ico');

// ── macOS ─────────────────────────────────────────────────────────────────
const icnsImages = Object.fromEntries(
  await Promise.all(
    Object.entries(ICNS_TAGS).map(async ([tag, size]) => [tag, await resize(size)])
  )
);
writeFileSync(join(BUILD, 'icon.icns'), icns.encode(icnsImages));
console.log('  build/icon.icns');

console.log('\nDone.');
```

- [ ] **Step 2: Run the script**

```bash
pnpm icons
```

Expected output:
```
Source: .../apps/desktop/build/icon.png

  build/icons/16x16.png
  build/icons/32x32.png
  build/icons/48x48.png
  build/icons/64x64.png
  build/icons/128x128.png
  build/icons/256x256.png
  build/icons/512x512.png
  build/icons/1024x1024.png
  build/icon.ico
  build/icon.icns

Done.
```

- [ ] **Step 3: Verify outputs exist and are non-empty**

```bash
node -e "
import { statSync } from 'fs';
const files = [
  'apps/desktop/build/icons/16x16.png',
  'apps/desktop/build/icons/256x256.png',
  'apps/desktop/build/icons/1024x1024.png',
  'apps/desktop/build/icon.ico',
  'apps/desktop/build/icon.icns',
];
for (const f of files) {
  const { size } = statSync(f);
  console.log(f.padEnd(50), size + ' bytes');
  if (size === 0) throw new Error('Empty file: ' + f);
}
console.log('All files present and non-empty.');
"
```

Expected: five lines each showing a non-zero byte count, then `All files present and non-empty.`

- [ ] **Step 4: Commit script and generated assets**

```bash
git add scripts/generate-icons.mjs apps/desktop/build/icons apps/desktop/build/icon.ico apps/desktop/build/icon.icns
git commit -m "feat: add cross-platform icon generation script and generated assets"
```

---

### Task 3: Update electron-builder config and retire the old script

**Files:**
- Modify: `apps/desktop/electron-builder.json`
- Delete: `apps/desktop/build/generate-icon.ps1`

- [ ] **Step 1: Add `"deb"` to the Linux targets in electron-builder.json**

Open `apps/desktop/electron-builder.json`. The current `linux` section is:

```json
"linux": {
  "target": ["AppImage"],
  "category": "Development"
}
```

Change it to:

```json
"linux": {
  "target": ["AppImage", "deb"],
  "category": "Development"
}
```

`.deb` installs icons to `/usr/share/icons/` and creates a `.desktop` file in `/usr/share/applications/`, giving Ubuntu shortcuts a permanent icon path that doesn't depend on the AppImage being mounted.

- [ ] **Step 2: Delete the retired PowerShell icon script**

```bash
git rm apps/desktop/build/generate-icon.ps1
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/electron-builder.json
git commit -m "feat: add deb linux target, retire generate-icon.ps1"
```

---

## Self-Review

**Spec coverage:**
- ✅ `scripts/generate-icons.mjs` — Task 2
- ✅ `build/icons/*.png` (8 Linux sizes) — Task 2
- ✅ `build/icon.ico` (7-size multi-res) — Task 2
- ✅ `build/icon.icns` (7 ICNS tags) — Task 2
- ✅ Root `package.json` `"icons"` script — Task 1
- ✅ `sharp`, `png-to-ico`, `icns-lib` devDeps — Task 1 (placed in root, not `apps/desktop`, because the script runs at repo root level)
- ✅ `electron-builder.json` `"deb"` target — Task 3
- ✅ `generate-icon.ps1` deleted — Task 3

**Note:** Deps go in root `package.json` (not `apps/desktop/package.json` as the spec draft said) because `scripts/generate-icons.mjs` is a repo-root script. Node resolves imports from the root `node_modules` when running `node scripts/...` from the repo root.

**Placeholder scan:** No TBDs. All steps have concrete commands or code.

**Consistency:** `resize(size)` defined once in Task 2, used consistently throughout the script. `ICNS_TAGS`, `LINUX_SIZES`, `ICO_SIZES` are defined at top-level and referenced in the same script — no cross-task drift.
