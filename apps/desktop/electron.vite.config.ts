import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
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
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        // Chrome and terminal each get their own preload with its own channel
        // allowlist (M2) — no shared generic bridge.
        input: {
          chrome: resolve(__dirname, 'src/preload/chrome.ts'),
          terminal: resolve(__dirname, 'src/preload/terminal.ts'),
        },
      },
    },
  },
  renderer: {
    root: '.',
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
