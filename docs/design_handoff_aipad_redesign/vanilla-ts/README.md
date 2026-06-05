# Awakon — vanilla TS/DOM port

Plain-JavaScript / DOM port of the design. **No React, no JSX, no build step required to run the demo.** All components are pure functions that return an `HTMLElement`.

## Quick start

Open **`demo.html`** in any modern browser — it loads Babel-standalone, transforms the TS at runtime, and renders all nine screens stacked vertically.

For production, run `tsc` on the `.ts` files and load the compiled `.js` directly (skip Babel). The demo wires Babel only so the file is double-clickable with no install.

## File layout

```
vanilla-ts/
├── demo.html         ← open this. self-contained runnable preview.
├── bundle.ts         ← GENERATED — concatenation of the modules below,
│                       used only by demo.html. Don't edit; edit the
│                       individual modules and regenerate.
├── tokens.css        ← ★ design tokens (CSS variables) — drop into renderer
├── components.css    ← BEM-ish component styles — drop in alongside
│
├── types.ts          ← Session, Status, BadgeStyle, STATUSES, sortSessions
├── platform.ts       ← MOD, kbd(), matchShortcut() — cross-platform helpers
├── dom.ts            ← h(), s() (SVG), setChildren(), setClass()
├── icons.ts          ← appGlyph(), iconA/B/C(), winCtrlGlyph()
├── status-badge.ts   ← renderStatusBadge({ status, time, style })
├── chrome.ts         ← renderTitleBar(), renderTabBar(), renderSidebar()
├── terminal.ts       ← renderTerminalPane() + Line union (no data here)
├── panels.ts         ← settings modal, command palette, empty state,
│                       markdown preview pane, new session dialog, scrim
├── context-menu.ts   ← showContextMenu() + buildTerminalContextMenu,
│                       buildTabContextMenu builders
└── mocks.ts          ← all sample data — sessions, tabs, terminal line
                        samples, recent dirs, md files
```

## Pattern: render-once + update-in-place

Most renderers are pure: `function renderX(opts): HTMLElement`. The shape is intentionally simple so adapting to whatever module patterns the Awakon codebase already uses is mechanical.

For high-frequency updates (status badges ticking each second, terminal lines streaming in), don't blow away the whole tree — there are dedicated update functions like `updateSessionRow(row, session, opts)` in `chrome.ts` that mutate in place. Use that pattern wherever a sub-section changes frequently.

## Cross-platform shortcuts

⚠ **Don't hardcode `⌘`.** Use the `platform.ts` helpers everywhere shortcuts appear in the UI or are handled.

```ts
import { kbd, matchShortcut } from './platform.ts';

// Display:
kbd('Mod+K')          // → '⌘K'    on macOS · 'Ctrl+K'        on Win/Linux
kbd('Mod+Shift+P')    // → '⌘⇧P'   on macOS · 'Ctrl+Shift+P'  on Win/Linux
kbd('Mod+Enter')      // → '⌘↵'    on macOS · 'Ctrl+Enter'    on Win/Linux

// Event matching:
window.addEventListener('keydown', (e) => {
  if (matchShortcut(e, 'Mod+K')) openPalette();
  if (matchShortcut(e, 'Mod+,')) openSettings();
});
```

The `Mod` token maps to **Cmd on macOS** and **Ctrl on Windows/Linux**. Other tokens supported: `Shift`, `Alt` / `Option`, `Ctrl` (literal control, rarely needed alongside `Mod`), `Enter`, `Esc`. On macOS the joiner (`+`) is dropped because that's the platform convention (`⌘⇧P`, not `⌘+⇧+P`). Win/Linux keeps the joiners.

For Electron main-process accelerator strings, use `CommandOrControl+K` — Electron auto-translates it. The display formatting is purely a renderer concern.

## Context menus

`context-menu.ts` exports `showContextMenu({ items, x, y })`, which mounts a fully-themed dark menu at the click position with auto-flip, keyboard nav, and outside-click dismissal. Two pre-built section builders match the spec:

```ts
import { showContextMenu, buildTerminalContextMenu } from './context-menu.ts';

el.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  showContextMenu({
    x: e.clientX, y: e.clientY,
    items: buildTerminalContextMenu({
      hasSelection: term.hasSelection(),
      hasClipboard: clipboardHasText,
      inSplit: paneIsInSplit,
      onCopy: () => term.copy(),
      onPaste: () => term.paste(),
      // …
    }),
  });
});
```

The same component is reused for tab right-click (`buildTabContextMenu`) and session-row right-click — you just supply different item arrays. See the README spec for the full per-surface item lists.

## What to copy into Awakon

1. **`tokens.css`** — drop into your renderer's global stylesheet verbatim.
2. **`components.css`** — drop in alongside. All class names are prefixed `aip-` so they won't collide.
3. **The TS modules** — read, adapt, and integrate. Don't blindly copy `dom.ts` if your codebase already has a DOM helper or templating layer — keep the structure but replace the calls.

## What NOT to copy

- `bundle.ts` — generated, demo-only.
- `demo.html` — visual reference only; the screen factories at the bottom are mock-data wiring you'll replace with real session state.
- `mocks.ts` — sample data only; real data comes from your session store / PTY stream / clipboard / etc.

## Compile to JS for production

```bash
# from this folder
tsc --target es2020 --module esnext --moduleResolution bundler --strict *.ts
# or, for a single bundle:
esbuild *.ts --bundle --format=esm --outfile=dist/components.js
```

Both produce regular `.js` you can ship in the Electron renderer. The TS surface is intentionally small and free of fancy types — nothing TypeScript-specific that won't compile cleanly under `strict`.
