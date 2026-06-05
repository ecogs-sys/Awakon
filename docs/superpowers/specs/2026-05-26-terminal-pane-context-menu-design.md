# Terminal-pane context menu — Design

**Date:** 2026-05-26
**Branch:** `feat/redesign-awakon`
**Status:** Approved for planning
**Scope:** Right-click context menu inside every terminal pane (single tab and split panes). No tab, sidebar, or markdown-link surfaces in this round. Find and Clear menu items explicitly excluded.

---

## 1. Goal

Right-clicking inside any terminal pane — whether the tab has a single pane or is split — opens a themed, keyboard-navigable context menu with the standard editing actions and pane-management commands:

```
Copy          Ctrl+C        (disabled when nothing is selected)
Paste         Ctrl+V
Select all    Ctrl+A
────────────────────────────
Split right   Ctrl+D
Split below   Ctrl+Shift+D
────────────────────────────
Close pane    Ctrl+W        (danger / red; disabled when not in split)
```

Look matches the design handoff (`docs/design_handoff_awakon_redesign/`). Shortcut hints auto-translate (`Ctrl+C` on Windows/Linux, `⌘C` on macOS) via the same `kbd()` helper used by the design source.

## 2. Non-goals

- Find action / Find dialog — explicitly excluded by request.
- Clear-terminal action — explicitly excluded by request.
- Tab right-click context menu (handoff section 9) — out of scope.
- Sidebar session-row context menu — the existing ad-hoc menu in `sidebar.ts` stays as-is; not replaced this round.
- Markdown-link right-click — depends on the markdown preview pane which isn't built yet.
- Native (Electron `Menu.popup()`) menus — we use a custom themed HTML menu so it matches the dark UI.

## 3. Architecture

The terminal pane lives in a separate renderer from the chrome (`apps/desktop/src/renderer/terminal/`), one renderer per tab. Split panes are sibling leaves inside a `SplitContainer`. The context menu mounts into the terminal renderer's `document.body` and operates entirely within that renderer — **no IPC, no main-process changes**.

```
┌───────────────────────── chrome renderer ────────────────────────┐
│ titlebar · tabs · sidebar                                        │
│                                                                  │
│  ┌── BrowserView per tab (terminal renderer) ────────────────┐   │
│  │ SplitContainer                                            │   │
│  │ ┌─ pane A (leaf) ───┐   ┌─ pane B (leaf) ─────────────┐   │   │
│  │ │   xterm.js        │   │   xterm.js                  │   │   │
│  │ │   ↑ contextmenu   │   │   ↑ contextmenu             │   │   │
│  │ │   listener        │   │   listener                  │   │   │
│  │ └───────────────────┘   └─────────────────────────────┘   │   │
│  │                                                           │   │
│  │   showContextMenu() ─► document.body (this renderer)      │   │
│  └───────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Responsibility |
|---|---|
| `context-menu.ts` | `showContextMenu({ items, x, y, onClose })` generic floater + `buildTerminalContextMenu(opts)` section factory. Ported from the design source with Find/Clear stripped. |
| `dom.ts` | Minimal `h(tag, attrs, children)` + `setChildren(el, nodes)` helpers. Ported verbatim from the design source. |
| `platform.ts` | `MOD`, `kbd(spec)`, `matchShortcut(e, spec)`. Ported verbatim. |
| `context-menu.css` | The `.aip-ctx-*` BEM rules from the design's `components.css`. Imported by `terminal/main.ts` so it's bundled into the terminal renderer. |
| `split-container.ts` | New `contextmenu` listener on each pane element wires `showContextMenu` with the right action handlers. |
| `TerminalHost` | Gains 5 thin public methods: `hasSelection()`, `getSelection()`, `paste(text)`, `selectAll()`, `focus()`. Each is a 1-line wrapper over the underlying `xterm.js` `Terminal`. |

## 4. Public API

### `showContextMenu(opts: ContextMenuOptions): HTMLElement`

```ts
interface ContextMenuOptions {
  items: ContextMenuSection;   // see below
  x: number;                   // click coords
  y: number;
  onClose?: () => void;
}

type ContextMenuSection = (ContextMenuItem | null)[];   // null = separator

interface ContextMenuItem {
  label: string;
  shortcut?: string;     // e.g. 'Mod+C' — rendered via kbd()
  icon?: string;         // optional 1-char glyph
  disabled?: boolean;
  danger?: boolean;      // styles the row red
  onClick?: () => void;
}
```

Behavior summary:

- Mounts `aip-ctx-backdrop` (full-viewport, invisible) + `aip-ctx-menu` to `document.body`.
- Auto-flips when the menu would overflow the right or bottom viewport edge (min 8px margin).
- ↑/↓ navigate enabled items only; Enter activates; mouse hover moves the highlight.
- Outside-click (on backdrop), Esc, or item activation closes the menu and fires `onClose`.
- A `contextmenu` event on the backdrop is `preventDefault`ed and closes the menu — letting the next right-click reopen at the new position.

### `buildTerminalContextMenu(opts: TerminalMenuOptions): ContextMenuSection`

```ts
interface TerminalMenuOptions {
  hasSelection: boolean;   // gates Copy
  inSplit: boolean;        // gates Close pane
  onCopy:        () => void;
  onPaste:       () => void;
  onSelectAll:   () => void;
  onSplitRight:  () => void;
  onSplitBelow:  () => void;
  onClosePane:   () => void;
}
```

Returns the 7-item section (Copy / Paste / Select all · separator · Split right / Split below · separator · Close pane).

### `TerminalHost` additions

```ts
class TerminalHost {
  // existing constructor, dispose, etc. ...
  hasSelection(): boolean;      // -> this.term.hasSelection()
  getSelection(): string;       // -> this.term.getSelection()
  paste(text: string): void;    // -> this.term.paste(text)
  selectAll(): void;            // -> this.term.selectAll()
  focus(): void;                // -> this.term.focus()
}
```

## 5. Wiring inside `SplitContainer`

`makePaneElement()` (currently at `split-container.ts:190`) attaches a `contextmenu` listener at pane-element creation time. The listener closes over `this` so it can call `splitFocused` / `closeFocusedPane`; it resolves the **current** leaf via `findLeafByElement(el)` because `LeafNode` references can change shape but the DOM element is stable.

```ts
private makePaneElement(): HTMLElement {
  const el = document.createElement('div');
  // ... existing style setup ...
  el.tabIndex = 0;
  this.wirePaneContextMenu(el);
  return el;
}

private wirePaneContextMenu(el: HTMLElement): void {
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const leaf = this.findLeafByElement(el);
    if (!leaf) return;
    const host = leaf.host;
    const inSplit = this.root.kind === 'branch';

    showContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: buildTerminalContextMenu({
        hasSelection: host.hasSelection(),
        inSplit,
        onCopy:       () => void navigator.clipboard.writeText(host.getSelection()),
        onPaste:      async () => {
          const text = await navigator.clipboard.readText();
          host.paste(text);
        },
        onSelectAll:  () => host.selectAll(),
        onSplitRight: () => { host.focus(); void this.splitFocused('horizontal'); },
        onSplitBelow: () => { host.focus(); void this.splitFocused('vertical'); },
        onClosePane:  () => { host.focus(); this.closeFocusedPane(); },
      }),
    });
  });
}
```

### Focus correctness

The `mousedown` portion of the right-click already triggers the existing `focusin` listener, so by the time `contextmenu` fires `this.focused` points at the clicked pane. The explicit `host.focus()` calls in Split / Close handlers are belt-and-suspenders against future event-order changes — they're cheap (single DOM operation) and remove a class of subtle bugs.

## 6. Behavior & edge cases

| Situation | Behavior |
|---|---|
| Right-click in single pane (no splits) | Menu opens. **Close pane** is disabled (greyed danger style). |
| Right-click in a split pane | All items enabled (Copy depends on selection). Close pane removes this leaf and promotes its sibling — the existing `closeFocusedPane()` logic. |
| Nothing selected | **Copy** is disabled. |
| Selection state changes after menu open | Not re-checked. xterm loses focus when the menu is up, so selection can't change. |
| Clipboard empty when Paste fires | `term.paste('')` is a no-op. No async gating, no flicker. |
| Right-click near right viewport edge | Menu's right edge anchors to click x instead of left edge. Same for bottom. |
| Right-click while menu is open | Backdrop's `contextmenu` handler closes the menu; the new event on the underlying pane element opens a fresh menu at the new coords. |
| Esc pressed | Menu closes; the keydown is consumed (capture-phase listener) so it does not reach xterm. |
| Split / window resize while menu is open | Menu stays at its absolute viewport coordinates. Pending action's closure still references the originally clicked pane. |
| Menu item activation | `onClick` fires, then menu auto-closes. |
| Disabled item activation attempted | Skipped during keyboard nav; click is inert. |

## 7. Files

### New

| Path | LOC (approx) | Purpose |
|---|---|---|
| `apps/desktop/src/renderer/terminal/context-menu.ts` | ~170 | Menu component + terminal builder. |
| `apps/desktop/src/renderer/terminal/dom.ts` | ~30 | `h()` / `setChildren()` helpers. |
| `apps/desktop/src/renderer/terminal/platform.ts` | ~50 | `MOD`, `kbd()`, `matchShortcut()`. |
| `apps/desktop/src/renderer/terminal/context-menu.test.ts` | ~150 | Unit + jsdom DOM tests. |
| `apps/desktop/src/renderer/chrome/styles/context-menu.css` | ~80 | `.aip-ctx-*` BEM rules from the design's `components.css`. |

### Edited

| Path | Change |
|---|---|
| `apps/desktop/src/renderer/terminal/split-container.ts` | Add `wirePaneContextMenu(el)` private method; call it from `makePaneElement()`. |
| `apps/desktop/src/renderer/terminal/main.ts` | Add `import '../chrome/styles/context-menu.css'` next to the existing tokens import. |
| `packages/terminal-host/src/terminal-host.ts` | Add 5 public 1-line wrapper methods. |

### Not touched

- Chrome renderer (`tab-strip.ts`, `sidebar.ts`, `layout-manager.ts`, `titlebar.ts`).
- Main process (`apps/desktop/src/main/*`).
- IPC contracts (`packages/contracts/*`).
- App menu / keyboard map.

## 8. Testing

### Unit / DOM (vitest + jsdom)

`apps/desktop/src/renderer/terminal/context-menu.test.ts`:

1. **`buildTerminalContextMenu()` shape** — item count, labels, separator positions, shortcut strings; `disabled` true on Copy when `hasSelection=false`, true on Close pane when `inSplit=false`; `danger=true` on Close pane only.
2. **`kbd()`** — `Mod+C` → `⌘C` on macOS (`navigator.platform` stub) and `Ctrl+C` on Windows/Linux. `Mod+Shift+D` rendering on both.
3. **`matchShortcut()`** — matches `Mod+K` against synthetic events on both platforms; rejects mismatched modifier sets.
4. **`showContextMenu()` mount** — asserts `.aip-ctx-menu` + `.aip-ctx-backdrop` appear in `document.body`.
5. **Esc dismiss** — keydown('Escape') removes both elements and fires `onClose`.
6. **Outside-click dismiss** — `mousedown` on backdrop removes both elements and fires `onClose`.
7. **Keyboard nav** — `ArrowDown` then `Enter` activates the second enabled item; a leading disabled item is skipped.
8. **Disabled click** — clicking an item with `disabled: true` does not fire its `onClick`.
9. **Viewport flip** — with stubbed `getBoundingClientRect` and small `window.innerWidth`, `menu.style.left` is `Math.max(8, x - width)`.

### Integration (one light test)

10. **`SplitContainer` wires the menu** — instantiate with stubbed `bridge` and `TerminalHost`; dispatch a synthetic `contextmenu` event on a pane element; assert `.aip-ctx-menu` appears in `document`.

### Manual verification (in PR checklist)

- Right-click in a single pane: menu opens, Close pane is greyed.
- Split, right-click in the new pane: Close pane is enabled and dismisses the right pane.
- Select text, right-click: Copy is enabled. Click Copy; paste externally; verify content.
- Right-click near the right edge of the window: menu flips left.
- Press Esc while menu is open: menu closes, no keystroke leaks to terminal.
- Right-click in pane A while pane B's menu is open: B's menu closes, A's opens.

### Out of scope for tests

`navigator.clipboard.{readText,writeText}` itself — environment-dependent; treated as a system boundary.

## 9. Rollout

- No feature flag — pure additive UI.
- No schema or IPC changes.
- No new runtime dependencies.
- Revert is a single commit.

## 10. Future work (explicitly deferred)

- Port the same component to the tab strip and sidebar (replacing `sidebar.ts:251`'s ad-hoc menu) so all three surfaces share one implementation. Would justify lifting `context-menu.ts` + helpers into either `apps/desktop/src/renderer/shared/` or a new `@awakon/ui-components` workspace package.
- Markdown-link right-click in terminal (Open in editor / Copy path / Reveal in finder) — pairs with the markdown preview pane work.
- Find action and dialog (excluded from this round by request).
- Clear-terminal action (excluded from this round by request).
