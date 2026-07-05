#!/usr/bin/env node
// Sandboxed preloads (M1) get a polyfilled require() that cannot resolve a
// sibling local chunk file. chrome.ts and terminal.ts both import shared.ts
// and @awakon/contracts, so a single electron-vite pass covering both entries
// always factors that into a shared chunk that throws at runtime. Build each
// entry in its own standalone pass instead (electron.vite.config.ts reads
// PRELOAD_ENTRY to restrict that pass to one entry, with no other entry to
// share code with).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';
import { join } from 'node:path';

const cwd = fileURLToPath(new URL('..', import.meta.url));

// C9: this used to spawn both electron-vite passes unconditionally on every dev/build
// invocation (~seconds each, dominated by cold esbuild/rollup startup) even when neither
// preload entry had changed since the last build. Skip when every output .cjs is newer
// than all three preload sources (a missing output, or a missing/unreadable source,
// forces a rebuild — fail safe, not fast).
const SRC_FILES = ['src/preload/chrome.ts', 'src/preload/terminal.ts', 'src/preload/shared.ts'].map((f) => join(cwd, f));
const OUT_FILES = ['out/preload/chrome.cjs', 'out/preload/terminal.cjs'].map((f) => join(cwd, f));

function mtimeOrNull(path) {
  try { return statSync(path).mtimeMs; } catch { return null; }
}

function preloadBuildIsUpToDate() {
  const outTimes = OUT_FILES.map(mtimeOrNull);
  if (outTimes.some((t) => t === null)) return false;
  const srcTimes = SRC_FILES.map(mtimeOrNull);
  if (srcTimes.some((t) => t === null)) return false;
  return Math.min(...outTimes) > Math.max(...srcTimes);
}

if (preloadBuildIsUpToDate()) {
  console.log('[build-preload] up to date (chrome.ts/terminal.ts/shared.ts unchanged) — skipping');
  process.exit(0);
}

for (const entry of ['chrome', 'terminal']) {
  const result = spawnSync('electron-vite', ['build'], {
    stdio: 'inherit',
    shell: true,
    cwd,
    env: { ...process.env, PRELOAD_ENTRY: entry },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
