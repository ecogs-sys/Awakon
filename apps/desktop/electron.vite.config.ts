import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import type { Plugin } from 'vite';

// R8: the packaged HTML ships `connect-src 'self'` (no localhost) — a CSP delivered via
// HTTP header can only ever narrow a meta-tag policy, never loosen it (a resource must
// satisfy every applicable policy), so the electron-vite dev server's HMR websocket
// needs the dev-only relaxation applied to the actual served HTML, not bolted on via
// headers. `apply: 'serve'` means this never runs for `electron-vite build`.
function devCspPlugin(): Plugin {
  return {
    name: 'awakon-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        "connect-src 'self';",
        "connect-src 'self' ws://localhost:* http://localhost:*;",
      );
    },
  };
}

const preloadEntries = {
  chrome: resolve(__dirname, 'src/preload/chrome.ts'),
  terminal: resolve(__dirname, 'src/preload/terminal.ts'),
};

// Sandboxed preloads (M1) get a polyfilled require() that cannot resolve a
// sibling local chunk file (see docs/electron sandbox tutorial). Chrome and
// terminal both import shared.ts and @awakon/contracts, so building them in
// one Rollup pass always factors those into a separate shared chunk that
// throws at runtime. PRELOAD_ENTRY forces a standalone single-entry build —
// see the `build:preload`/`dev` scripts in package.json, which invoke this
// config once per entry.
const preloadEntry = process.env.PRELOAD_ENTRY as 'chrome' | 'terminal' | undefined;

export default defineConfig({
  main: preloadEntry
    ? undefined
    : {
        plugins: [
          externalizeDepsPlugin({
            // Bundle @awakon/* workspace packages INTO main so the packaged app
            // doesn't need pnpm's symlinked node_modules at runtime.
            exclude: ['@awakon/contracts', '@awakon/core', '@awakon/keymap'],
          }),
        ],
        build: {
          outDir: 'out/main',
          rollupOptions: {
            input: { index: resolve(__dirname, 'src/main/index.ts') },
            external: ['node-pty', 'electron-updater'],
          },
        },
      },
  preload: preloadEntry
    ? {
        plugins: [externalizeDepsPlugin()],
        build: {
          outDir: 'out/preload',
          // Only clear out/preload on the first of the two standalone passes,
          // so the second pass doesn't delete the first pass's output file.
          emptyOutDir: preloadEntry !== 'terminal',
          rollupOptions: {
            input: { [preloadEntry]: preloadEntries[preloadEntry] },
            output: {
              format: 'cjs',
              entryFileNames: '[name].cjs',
            },
          },
        },
      }
    : undefined,
  renderer: preloadEntry
    ? undefined
    : {
        root: '.',
        plugins: [devCspPlugin()],
        build: {
          outDir: 'out/renderer',
          rollupOptions: {
            input: {
              chrome: resolve(__dirname, 'index.html'),
              terminal: resolve(__dirname, 'terminal-host.html'),
            },
          },
        },
      },
});
