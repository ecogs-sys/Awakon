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

const cwd = fileURLToPath(new URL('..', import.meta.url));

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
