# Terminal-pane Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire a themed right-click context menu (Copy / Paste / Select all · Split right / Split below · Close pane) into every terminal pane, including each pane of a split.

**Architecture:** Port the design handoff's `context-menu.ts` component into the **terminal renderer** (`apps/desktop/src/renderer/terminal/`). The renderer is per-tab; each leaf in `SplitContainer` gets a `contextmenu` listener. No IPC. No main-process changes. Find and Clear items are excluded.

**Tech Stack:** TypeScript, Vite, Vitest + jsdom, xterm.js, Electron renderer process.

**Spec:** `docs/superpowers/specs/2026-05-26-terminal-pane-context-menu-design.md`

---

## File map

**New files** (all under `apps/desktop/src/renderer/terminal/` unless noted):

- `dom.ts` — `h()` / `setChildren()` / `appendChildren()`. Ported verbatim from `docs/design_handoff_awakon_redesign/vanilla-ts/dom.ts`.
- `platform.ts` — `MOD`, `detectPlatform()`, `kbd()`, `matchShortcut()`. Ported verbatim.
- `context-menu.ts` — `showContextMenu()` + `buildTerminalContextMenu()`. Ported from design source with `onFind` / `onClear` and the Find / Clear items dropped.
- `context-menu.test.ts` — vitest + jsdom tests for the menu component and the builder.
- `split-container.test.ts` — one jsdom integration test that asserts the menu mounts when right-clicking a pane.
- `apps/desktop/src/renderer/chrome/styles/context-menu.css` — the `.aip-ctx-*` BEM rules from the design source's `components.css`.

**Edited files:**

- `packages/terminal-host/src/terminal-host.ts` — add 5 public 1-line wrapper methods.
- `apps/desktop/src/renderer/terminal/split-container.ts` — wire the `contextmenu` listener in `makePaneElement()`.
- `apps/desktop/src/renderer/terminal/main.ts` — import the new CSS.

---

## Task 1: Port `dom.ts` helpers

**Files:**
- Create: `apps/desktop/src/renderer/terminal/dom.ts`
- Test: `apps/desktop/src/renderer/terminal/context-menu.test.ts` (created in this task, expanded later)

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/renderer/terminal/context-menu.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { h, setChildren } from './dom.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('dom.h()', () => {
  it('creates an element with class, text, and attrs', () => {
    const el = h('div', { class: 'foo bar', text: 'hello', attrs: { 'data-x': '1' } });
    expect(el.tagName).toBe('DIV');
    expect(el.className).toBe('foo bar');
    expect(el.textContent).toBe('hello');
    expect(el.getAttribute('data-x')).toBe('1');
  });

  it('appends string and element children', () => {
    const child = h('span', { text: 'inner' });
    const el = h('div', {}, ['text-', child, null, false, 'tail']);
    expect(el.childNodes.length).toBe(3);
    expect(el.textContent).toBe('text-innertail');
  });

  it('wires event listeners via on', () => {
    let clicked = 0;
    const el = h('button', { on: { click: () => { clicked += 1; } } });
    el.dispatchEvent(new MouseEvent('click'));
    expect(clicked).toBe(1);
  });
});

describe('dom.setChildren()', () => {
  it('replaces existing children', () => {
    const parent = document.createElement('div');
    parent.appendChild(document.createElement('span'));
    parent.appendChild(document.createElement('span'));
    setChildren(parent, [h('p', { text: 'only' })]);
    expect(parent.children.length).toBe(1);
    expect(parent.firstElementChild?.tagName).toBe('P');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @awakon/desktop test -- context-menu.test.ts`
Expected: FAIL — `Cannot find module './dom.js'` (or `./dom`).

- [ ] **Step 3: Create `dom.ts` by porting from the design source**

Create `apps/desktop/src/renderer/terminal/dom.ts` with this content (verbatim port of `docs/design_handoff_awakon_redesign/vanilla-ts/dom.ts`, minus the SVG helper `s()` which we don't need):

```ts
// Tiny DOM helpers. Ported from the design handoff's vanilla-ts/dom.ts so
// the context-menu component matches the design source 1:1.

type Child = Node | string | number | null | undefined | false;

interface HProps {
  /** Space-separated class names. */
  class?: string;
  /** Text content shortcut (set last, after children). */
  text?: string;
  /** Inline style as cssText string or object. */
  style?: string | Partial<CSSStyleDeclaration>;
  /** Arbitrary attributes (data-*, aria-*, title, etc.) */
  attrs?: Record<string, string | number | boolean>;
  /** Event listeners. */
  on?: Partial<Record<keyof HTMLElementEventMap, EventListener>>;
  /** Child nodes / strings / falsy (skipped). */
  children?: Child[];
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: HProps = {},
  children?: Child[],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.style) {
    if (typeof props.style === 'string') el.style.cssText = props.style;
    else Object.assign(el.style, props.style);
  }
  if (props.attrs) {
    for (const [k, v] of Object.entries(props.attrs)) {
      if (v === false) continue;
      el.setAttribute(k, String(v));
    }
  }
  if (props.on) {
    for (const [k, fn] of Object.entries(props.on)) {
      if (fn) el.addEventListener(k, fn as EventListener);
    }
  }
  const kids = children ?? props.children;
  if (kids) appendChildren(el, kids);
  if (props.text !== undefined) el.textContent = props.text;
  return el;
}

export function appendChildren(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (typeof c === 'string' || typeof c === 'number') {
      parent.appendChild(document.createTextNode(String(c)));
    } else {
      parent.appendChild(c);
    }
  }
}

/** Replace `parent`'s children with `children`. */
export function setChildren(parent: Node, children: Child[]): void {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
  appendChildren(parent, children);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @awakon/desktop test -- context-menu.test.ts`
Expected: PASS — 4 tests in the `dom.*` describes.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/terminal/dom.ts apps/desktop/src/renderer/terminal/context-menu.test.ts
git commit -m "feat(terminal): port dom.ts helpers from design handoff"
```

---

## Task 2: Port `platform.ts` helpers

**Files:**
- Create: `apps/desktop/src/renderer/terminal/platform.ts`
- Modify: `apps/desktop/src/renderer/terminal/context-menu.test.ts`

- [ ] **Step 1: Write the failing tests**

`platform.ts` captures `PLATFORM` at module load via a `const`, so each test must call `vi.resetModules()` and re-`import()` the module after stubbing `navigator.platform`. Append to `apps/desktop/src/renderer/terminal/context-menu.test.ts`:

```ts
import { vi } from 'vitest';

describe('platform.kbd()', () => {
  it('renders Mod+C as Ctrl+C on Windows/Linux', async () => {
    vi.resetModules();
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    const { kbd } = await import('./platform.js');
    expect(kbd('Mod+C')).toBe('Ctrl+C');
    expect(kbd('Mod+Shift+P')).toBe('Ctrl+Shift+P');
  });

  it('renders Mod+C as ⌘C on macOS (no separator)', async () => {
    vi.resetModules();
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    const { kbd } = await import('./platform.js');
    expect(kbd('Mod+C')).toBe('⌘C');
    expect(kbd('Mod+Shift+P')).toBe('⌘⇧P');
    expect(kbd('Mod+Enter')).toBe('⌘↵');
  });
});

describe('platform.matchShortcut()', () => {
  it('matches Mod+K on Windows (ctrlKey)', async () => {
    vi.resetModules();
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    const { matchShortcut } = await import('./platform.js');
    const ev = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true });
    expect(matchShortcut(ev, 'Mod+K')).toBe(true);
  });

  it('matches Mod+K on macOS (metaKey)', async () => {
    vi.resetModules();
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    const { matchShortcut } = await import('./platform.js');
    const ev = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
    expect(matchShortcut(ev, 'Mod+K')).toBe(true);
  });

  it('rejects when wrong modifier is held', async () => {
    vi.resetModules();
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    const { matchShortcut } = await import('./platform.js');
    const ev = new KeyboardEvent('keydown', { key: 'k', shiftKey: true });
    expect(matchShortcut(ev, 'Mod+K')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm --filter @awakon/desktop test -- context-menu.test.ts`
Expected: FAIL — `Cannot find module './platform.js'`.

- [ ] **Step 3: Create `platform.ts` by porting from the design source**

Create `apps/desktop/src/renderer/terminal/platform.ts` with this content (verbatim port of `docs/design_handoff_awakon_redesign/vanilla-ts/platform.ts`):

```ts
// Cross-platform shortcut helpers. Ported from the design handoff's
// vanilla-ts/platform.ts.

export type Platform = 'mac' | 'windows' | 'linux';

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'linux';
  const p = (navigator.platform || navigator.userAgent || '').toLowerCase();
  if (p.includes('mac')) return 'mac';
  if (p.includes('win')) return 'windows';
  return 'linux';
}

export const PLATFORM: Platform = detectPlatform();

/** Bare modifier symbol — '⌘' on macOS, 'Ctrl' elsewhere. */
export const MOD: string = PLATFORM === 'mac' ? '⌘' : 'Ctrl';

/**
 * Format a keyboard shortcut for display. Use 'Mod' as a stand-in for
 * Cmd-or-Ctrl, and 'Shift'/'Alt'/'Enter'/'Esc' as their respective tokens.
 */
export function kbd(combo: string): string {
  if (PLATFORM === 'mac') {
    return combo
      .replace(/\bMod\b/g,                 '⌘')
      .replace(/\bShift\b/g,               '⇧')
      .replace(/\bAlt\b|\bOption\b/g,      '⌥')
      .replace(/\bCtrl\b/g,                '⌃')
      .replace(/\bEnter\b/g,               '↵')
      .replace(/\bEscape\b/gi,             'esc')
      .replace(/\bEsc\b/g,                 'esc')
      .replace(/\+/g,                      '');
  }
  return combo.replace(/\bMod\b/g, 'Ctrl');
}

/**
 * Check whether a KeyboardEvent matches a given combo string. Use 'Mod'
 * to mean Cmd on macOS and Ctrl elsewhere.
 */
export function matchShortcut(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+').map((p) => p.trim());
  const key   = parts[parts.length - 1];
  const mods  = new Set(parts.slice(0, -1));

  const wantMod   = mods.has('mod');
  const wantShift = mods.has('shift');
  const wantAlt   = mods.has('alt') || mods.has('option');
  const isMac     = PLATFORM === 'mac';
  const ctrlOrMeta = isMac ? e.metaKey : e.ctrlKey;
  const otherSide  = isMac ? e.ctrlKey : e.metaKey;

  if (wantMod && !ctrlOrMeta) return false;
  if (!wantMod && (e.ctrlKey || e.metaKey)) return false;
  if (otherSide) return false;
  if (wantShift !== e.shiftKey) return false;
  if (wantAlt   !== e.altKey)   return false;

  return e.key.toLowerCase() === key.toLowerCase();
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm --filter @awakon/desktop test -- context-menu.test.ts`
Expected: PASS — all `platform.kbd()` and `platform.matchShortcut()` tests green, plus the existing `dom.*` tests still green.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/terminal/platform.ts apps/desktop/src/renderer/terminal/context-menu.test.ts
git commit -m "feat(terminal): port platform.ts helpers from design handoff"
```

---

## Task 3: Build `buildTerminalContextMenu()` (pure builder)

**Files:**
- Create: `apps/desktop/src/renderer/terminal/context-menu.ts` (skeleton — `showContextMenu` added next task)
- Modify: `apps/desktop/src/renderer/terminal/context-menu.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/src/renderer/terminal/context-menu.test.ts`:

```ts
import { buildTerminalContextMenu } from './context-menu.js';

describe('buildTerminalContextMenu()', () => {
  const baseOpts = {
    hasSelection: true,
    inSplit: true,
    onCopy: () => {},
    onPaste: () => {},
    onSelectAll: () => {},
    onSplitRight: () => {},
    onSplitBelow: () => {},
    onClosePane: () => {},
  };

  it('returns Copy / Paste / Select all + 2 sections of Split + Close pane', () => {
    const items = buildTerminalContextMenu(baseOpts);
    // 3 editing + null + 2 split + null + 1 close = 8 entries (2 separators)
    expect(items.length).toBe(8);
    expect(items[0]?.label).toBe('Copy');
    expect(items[1]?.label).toBe('Paste');
    expect(items[2]?.label).toBe('Select all');
    expect(items[3]).toBeNull();
    expect(items[4]?.label).toBe('Split right');
    expect(items[5]?.label).toBe('Split below');
    expect(items[6]).toBeNull();
    expect(items[7]?.label).toBe('Close pane');
  });

  it('does NOT include Find or Clear items', () => {
    const items = buildTerminalContextMenu(baseOpts);
    const labels = items.filter((i) => i !== null).map((i) => i!.label);
    expect(labels).not.toContain('Find…');
    expect(labels).not.toContain('Clear');
    expect(labels.length).toBe(6);
  });

  it('disables Copy when hasSelection=false', () => {
    const items = buildTerminalContextMenu({ ...baseOpts, hasSelection: false });
    expect(items[0]?.disabled).toBe(true);
  });

  it('enables Copy when hasSelection=true', () => {
    const items = buildTerminalContextMenu({ ...baseOpts, hasSelection: true });
    expect(items[0]?.disabled).toBeFalsy();
  });

  it('disables Close pane when inSplit=false', () => {
    const items = buildTerminalContextMenu({ ...baseOpts, inSplit: false });
    expect(items[7]?.disabled).toBe(true);
  });

  it('marks only Close pane as danger', () => {
    const items = buildTerminalContextMenu(baseOpts);
    const dangerLabels = items.filter((i) => i !== null && i.danger).map((i) => i!.label);
    expect(dangerLabels).toEqual(['Close pane']);
  });

  it('wires each onClick to the matching callback', () => {
    const calls: string[] = [];
    const items = buildTerminalContextMenu({
      hasSelection: true,
      inSplit: true,
      onCopy:       () => calls.push('copy'),
      onPaste:      () => calls.push('paste'),
      onSelectAll:  () => calls.push('selectAll'),
      onSplitRight: () => calls.push('splitRight'),
      onSplitBelow: () => calls.push('splitBelow'),
      onClosePane:  () => calls.push('closePane'),
    });
    items[0]?.onClick?.();
    items[1]?.onClick?.();
    items[2]?.onClick?.();
    items[4]?.onClick?.();
    items[5]?.onClick?.();
    items[7]?.onClick?.();
    expect(calls).toEqual(['copy', 'paste', 'selectAll', 'splitRight', 'splitBelow', 'closePane']);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm --filter @awakon/desktop test -- context-menu.test.ts`
Expected: FAIL — `Cannot find module './context-menu.js'`.

- [ ] **Step 3: Create `context-menu.ts` with just the builder (skeleton for `showContextMenu` added next task)**

Create `apps/desktop/src/renderer/terminal/context-menu.ts`:

```ts
// Awakon terminal-pane context menu.
//
// Ported from docs/design_handoff_awakon_redesign/vanilla-ts/context-menu.ts
// with Find and Clear items removed per the 2026-05-26 spec.

export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  icon?: string;
  disabled?: boolean;
  /** Styles the item in red — use for destructive actions like Close pane. */
  danger?: boolean;
  onClick?: () => void;
}

/** Pass a `null` between items to insert a separator line. */
export type ContextMenuSection = (ContextMenuItem | null)[];

export interface TerminalMenuOptions {
  /** True when text is selected in the terminal — gates Copy. */
  hasSelection: boolean;
  /** True when this pane is part of a split — gates Close pane. */
  inSplit: boolean;
  onCopy:        () => void;
  onPaste:       () => void;
  onSelectAll:   () => void;
  onSplitRight:  () => void;
  onSplitBelow:  () => void;
  onClosePane:   () => void;
}

export function buildTerminalContextMenu(opts: TerminalMenuOptions): ContextMenuSection {
  return [
    { label: 'Copy',        shortcut: 'Mod+C', icon: '⎘', disabled: !opts.hasSelection, onClick: opts.onCopy },
    { label: 'Paste',       shortcut: 'Mod+V', icon: '⎙', onClick: opts.onPaste },
    { label: 'Select all',  shortcut: 'Mod+A',            onClick: opts.onSelectAll },
    null,
    { label: 'Split right', shortcut: 'Mod+D',            onClick: opts.onSplitRight },
    { label: 'Split below', shortcut: 'Mod+Shift+D',      onClick: opts.onSplitBelow },
    null,
    { label: 'Close pane',  shortcut: 'Mod+W', icon: '×', danger: true, onClick: opts.onClosePane,
      disabled: !opts.inSplit },
  ];
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm --filter @awakon/desktop test -- context-menu.test.ts`
Expected: PASS — all 7 `buildTerminalContextMenu` tests plus prior tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/terminal/context-menu.ts apps/desktop/src/renderer/terminal/context-menu.test.ts
git commit -m "feat(terminal): add buildTerminalContextMenu section factory"
```

---

## Task 4: Implement `showContextMenu()` (DOM component)

**Files:**
- Modify: `apps/desktop/src/renderer/terminal/context-menu.ts`
- Modify: `apps/desktop/src/renderer/terminal/context-menu.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/src/renderer/terminal/context-menu.test.ts`:

```ts
import { showContextMenu } from './context-menu.js';
import type { ContextMenuSection } from './context-menu.js';

function basicItems(opts: { onA?: () => void; onB?: () => void; disabledA?: boolean } = {}): ContextMenuSection {
  return [
    { label: 'A', disabled: opts.disabledA, onClick: opts.onA },
    { label: 'B', onClick: opts.onB },
  ];
}

describe('showContextMenu() — mounting', () => {
  it('mounts a backdrop and menu to document.body', () => {
    showContextMenu({ x: 10, y: 10, items: basicItems() });
    expect(document.querySelector('.aip-ctx-menu')).not.toBeNull();
    expect(document.querySelector('.aip-ctx-backdrop')).not.toBeNull();
  });

  it('renders each item with its label and disabled state', () => {
    showContextMenu({ x: 10, y: 10, items: basicItems({ disabledA: true }) });
    const items = document.querySelectorAll('.aip-ctx-menu__item');
    expect(items.length).toBe(2);
    expect(items[0]?.classList.contains('aip-ctx-menu__item--disabled')).toBe(true);
    expect(items[1]?.classList.contains('aip-ctx-menu__item--disabled')).toBe(false);
  });

  it('renders danger style on items flagged danger', () => {
    showContextMenu({
      x: 10, y: 10,
      items: [{ label: 'Boom', danger: true }],
    });
    const item = document.querySelector('.aip-ctx-menu__item');
    expect(item?.classList.contains('aip-ctx-menu__item--danger')).toBe(true);
  });

  it('renders separators for null entries', () => {
    showContextMenu({
      x: 10, y: 10,
      items: [{ label: 'A' }, null, { label: 'B' }],
    });
    expect(document.querySelectorAll('.aip-ctx-menu__sep').length).toBe(1);
  });
});

describe('showContextMenu() — dismissal', () => {
  it('closes and fires onClose when Esc is pressed', () => {
    let closed = 0;
    showContextMenu({ x: 10, y: 10, items: basicItems(), onClose: () => { closed += 1; } });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.aip-ctx-menu')).toBeNull();
    expect(document.querySelector('.aip-ctx-backdrop')).toBeNull();
    expect(closed).toBe(1);
  });

  it('closes when backdrop is clicked', () => {
    let closed = 0;
    showContextMenu({ x: 10, y: 10, items: basicItems(), onClose: () => { closed += 1; } });
    const backdrop = document.querySelector('.aip-ctx-backdrop') as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(document.querySelector('.aip-ctx-menu')).toBeNull();
    expect(closed).toBe(1);
  });

  it('closes and reopens on backdrop right-click', () => {
    showContextMenu({ x: 10, y: 10, items: basicItems() });
    const backdrop = document.querySelector('.aip-ctx-backdrop') as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    expect(document.querySelector('.aip-ctx-menu')).toBeNull();
  });
});

describe('showContextMenu() — activation', () => {
  it('fires the clicked item onClick and closes the menu', () => {
    let aCount = 0;
    showContextMenu({ x: 10, y: 10, items: basicItems({ onA: () => { aCount += 1; } }) });
    const items = document.querySelectorAll('.aip-ctx-menu__item');
    (items[0] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(aCount).toBe(1);
    expect(document.querySelector('.aip-ctx-menu')).toBeNull();
  });

  it('does not fire onClick when a disabled item is clicked', () => {
    let aCount = 0;
    showContextMenu({
      x: 10, y: 10,
      items: basicItems({ onA: () => { aCount += 1; }, disabledA: true }),
    });
    const items = document.querySelectorAll('.aip-ctx-menu__item');
    (items[0] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(aCount).toBe(0);
  });
});

describe('showContextMenu() — keyboard nav', () => {
  it('Enter activates the active item', () => {
    let bCount = 0;
    showContextMenu({
      x: 10, y: 10,
      items: [{ label: 'A', disabled: true }, { label: 'B', onClick: () => { bCount += 1; } }],
    });
    // Active starts at first ENABLED item (B at index 1).
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(bCount).toBe(1);
  });

  it('ArrowDown moves the active item past disabled entries', () => {
    let aCount = 0, cCount = 0;
    showContextMenu({
      x: 10, y: 10,
      items: [
        { label: 'A', onClick: () => { aCount += 1; } },
        { label: 'B', disabled: true },
        { label: 'C', onClick: () => { cCount += 1; } },
      ],
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(aCount).toBe(0);
    expect(cCount).toBe(1);
  });
});

describe('showContextMenu() — viewport flip', () => {
  it('flips to the left when click would overflow the right edge', () => {
    // Force a measurable menu width via stubbed getBoundingClientRect.
    const origInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 100, configurable: true });
    const origProto = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      return { width: 80, height: 60, top: 0, left: 0, right: 80, bottom: 60, x: 0, y: 0, toJSON: () => {} } as DOMRect;
    };
    try {
      showContextMenu({ x: 80, y: 10, items: basicItems() });
      const menu = document.querySelector('.aip-ctx-menu') as HTMLElement;
      // x + width = 160; viewport - 8 = 92. So we flip: left = max(8, 80 - 80) = 8.
      expect(menu.style.left).toBe('8px');
    } finally {
      HTMLElement.prototype.getBoundingClientRect = origProto;
      Object.defineProperty(window, 'innerWidth', { value: origInnerWidth, configurable: true });
    }
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm --filter @awakon/desktop test -- context-menu.test.ts`
Expected: FAIL — `showContextMenu is not exported by './context-menu.js'`.

- [ ] **Step 3: Implement `showContextMenu()` in `context-menu.ts`**

Append to `apps/desktop/src/renderer/terminal/context-menu.ts`:

```ts
import { h, setChildren } from './dom.js';
import { kbd } from './platform.js';

export interface ContextMenuOptions {
  items: ContextMenuSection;
  /** Pixel coords of the click. Auto-flipped if it would go off-screen. */
  x: number;
  y: number;
  /** Called when the menu dismisses (outside click, Esc, item activation). */
  onClose?: () => void;
}

/**
 * Render a context menu and mount it to `document.body`. Auto-handles:
 *   • outside-click dismissal (via an invisible backdrop layer)
 *   • Esc dismissal
 *   • arrow-key navigation between enabled items
 *   • viewport flipping if click is near the edge
 */
export function showContextMenu({ items, x, y, onClose }: ContextMenuOptions): HTMLElement {
  const realItems = items.filter((i): i is ContextMenuItem => i !== null);
  const enabledIndices: number[] = [];
  realItems.forEach((it, i) => { if (!it.disabled) enabledIndices.push(i); });
  let activeIdx = enabledIndices[0] ?? 0;

  const backdrop = h('div', { class: 'aip-ctx-backdrop' });
  const menu = h('div', { class: 'aip-ctx-menu' });

  function close(): void {
    backdrop.remove();
    menu.remove();
    window.removeEventListener('keydown', onKey, true);
    onClose?.();
  }

  function activate(it: ContextMenuItem): void {
    if (it.disabled) return;
    close();
    it.onClick?.();
  }

  function renderItems(): void {
    let realIdx = 0;
    setChildren(menu, items.map((it) => {
      if (it === null) return h('div', { class: 'aip-ctx-menu__sep' });
      const i = realIdx++;
      const cls = ['aip-ctx-menu__item'];
      if (it.disabled)             cls.push('aip-ctx-menu__item--disabled');
      if (it.danger)               cls.push('aip-ctx-menu__item--danger');
      if (i === activeIdx && !it.disabled) cls.push('aip-ctx-menu__item--active');
      return h('div', {
        class: cls.join(' '),
        on: {
          click: () => activate(it),
          mouseenter: () => { if (!it.disabled) { activeIdx = i; renderItems(); } },
        },
      }, [
        h('span', { class: 'aip-ctx-menu__icon', text: it.icon ?? '' }),
        h('span', { class: 'aip-ctx-menu__label', text: it.label }),
        it.shortcut ? h('span', { class: 'aip-ctx-menu__kbd', text: kbd(it.shortcut) }) : null,
      ]);
    }));
  }
  renderItems();

  document.body.append(backdrop, menu);
  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const px = (x + rect.width  > vw - 8) ? Math.max(8, x - rect.width)  : x;
  const py = (y + rect.height > vh - 8) ? Math.max(8, y - rect.height) : y;
  menu.style.left = px + 'px';
  menu.style.top  = py + 'px';

  backdrop.addEventListener('mousedown', close);
  backdrop.addEventListener('contextmenu', (e) => { e.preventDefault(); close(); });

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Enter')  {
      e.preventDefault();
      const item = realItems[activeIdx];
      if (item) activate(item);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (enabledIndices.length === 0) return;
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const pos = enabledIndices.indexOf(activeIdx);
      const startPos = pos < 0 ? 0 : pos;
      const next = enabledIndices[(startPos + dir + enabledIndices.length) % enabledIndices.length]!;
      activeIdx = next;
      renderItems();
    }
  }
  window.addEventListener('keydown', onKey, true);

  return menu;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm --filter @awakon/desktop test -- context-menu.test.ts`
Expected: PASS — all `showContextMenu()` describes green plus the existing builder/helper tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/terminal/context-menu.ts apps/desktop/src/renderer/terminal/context-menu.test.ts
git commit -m "feat(terminal): add showContextMenu() floater component"
```

---

## Task 5: Add public wrapper methods to `TerminalHost`

These are 1-line passthroughs over `xterm.js` — we don't unit-test them in isolation (no signal). They get exercised by the SplitContainer integration test in Task 7.

**Files:**
- Modify: `packages/terminal-host/src/terminal-host.ts`

- [ ] **Step 1: Edit `terminal-host.ts`**

In `packages/terminal-host/src/terminal-host.ts`, after the `dispose()` method (currently at line 102), add these public methods:

```ts
  // ── Public terminal actions used by the context menu wiring ──────────

  hasSelection(): boolean {
    return this.term.hasSelection();
  }

  getSelection(): string {
    return this.term.getSelection();
  }

  paste(text: string): void {
    this.term.paste(text);
  }

  selectAll(): void {
    this.term.selectAll();
  }

  focus(): void {
    this.term.focus();
  }
```

- [ ] **Step 2: Typecheck the package**

Run: `pnpm --filter @awakon/terminal-host typecheck`
Expected: PASS — no type errors.

- [ ] **Step 3: Rebuild the package so the desktop build sees the new exports**

Run: `pnpm --filter @awakon/terminal-host build`
Expected: PASS — `dist/terminal-host.d.ts` regenerated with the new public methods.

- [ ] **Step 4: Commit**

```bash
git add packages/terminal-host/src/terminal-host.ts packages/terminal-host/dist
git commit -m "feat(terminal-host): expose hasSelection/getSelection/paste/selectAll/focus"
```

---

## Task 6: Port `context-menu.css` and import it from the terminal renderer

**Files:**
- Create: `apps/desktop/src/renderer/chrome/styles/context-menu.css`
- Modify: `apps/desktop/src/renderer/terminal/main.ts`

- [ ] **Step 1: Create the CSS file**

Create `apps/desktop/src/renderer/chrome/styles/context-menu.css` with this content (ported from `docs/design_handoff_awakon_redesign/vanilla-ts/components.css`, lines beginning at `.aip-ctx-menu`):

```css
/* Awakon context menu — ported from the design handoff's components.css.
   Depends on the design tokens defined in ./tokens.css. */

.aip-ctx-menu {
  position: fixed;
  min-width: 220px;
  background: var(--bg-2);
  border: 1px solid var(--border-2);
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04);
  z-index: 1000;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-1);
  user-select: none;
  animation: aip-ctx-in 100ms ease-out;
}
@keyframes aip-ctx-in {
  from { transform: translateY(-3px); }
  to   { transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .aip-ctx-menu { animation: none; }
}

.aip-ctx-menu__sep {
  height: 1px;
  background: var(--border-1);
  margin: 4px 0;
}

.aip-ctx-menu__item {
  display: flex; align-items: center; gap: 12px;
  padding: 7px 10px;
  border-radius: 5px;
  color: var(--text-1);
  font-family: var(--font-sans); font-size: 13px;
  cursor: pointer;
}
.aip-ctx-menu__item:hover:not(.aip-ctx-menu__item--disabled) {
  background: var(--bg-3);
}
.aip-ctx-menu__item--active:not(.aip-ctx-menu__item--disabled) {
  background: var(--accent-soft);
  color: var(--text-1);
}
.aip-ctx-menu__item--active:not(.aip-ctx-menu__item--disabled) .aip-ctx-menu__kbd {
  color: var(--text-2);
}
.aip-ctx-menu__item--disabled {
  color: var(--text-4);
  cursor: default;
}
.aip-ctx-menu__item--disabled .aip-ctx-menu__kbd {
  color: var(--text-4);
}
.aip-ctx-menu__item--danger { color: var(--st-limited); }
.aip-ctx-menu__item--danger:hover { background: oklch(0.70 0.18 25 / 0.12); }

.aip-ctx-menu__icon {
  width: 14px;
  display: inline-flex; align-items: center; justify-content: center;
  font-family: var(--font-mono); font-size: 11px;
  color: var(--text-3);
  flex-shrink: 0;
}
.aip-ctx-menu__item--danger .aip-ctx-menu__icon { color: var(--st-limited); }

.aip-ctx-menu__label { flex: 1; }
.aip-ctx-menu__kbd {
  font-family: var(--font-mono); font-size: 10.5px;
  color: var(--text-3);
  letter-spacing: 0.2px;
}

/* Invisible full-screen layer that closes the menu on outside click. */
.aip-ctx-backdrop {
  position: fixed; inset: 0; z-index: 999;
}
```

- [ ] **Step 2: Add the CSS import to `terminal/main.ts`**

Modify `apps/desktop/src/renderer/terminal/main.ts` — add the new import next to the existing `tokens.css` import at line 1:

Current line 1:
```ts
import '../chrome/styles/tokens.css';
```

Replace with:
```ts
import '../chrome/styles/tokens.css';
import '../chrome/styles/context-menu.css';
```

- [ ] **Step 3: Verify the terminal renderer still builds**

Run: `pnpm --filter @awakon/desktop typecheck`
Expected: PASS — no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/chrome/styles/context-menu.css apps/desktop/src/renderer/terminal/main.ts
git commit -m "feat(terminal): add context-menu.css and import from terminal renderer"
```

---

## Task 7: Wire `contextmenu` listener into `SplitContainer` (+ integration test)

**Files:**
- Modify: `apps/desktop/src/renderer/terminal/split-container.ts`
- Create: `apps/desktop/src/renderer/terminal/split-container.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `apps/desktop/src/renderer/terminal/split-container.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stub @awakon/terminal-host BEFORE importing SplitContainer so the test
// doesn't pull in xterm.js (which doesn't run cleanly under jsdom).
vi.mock('@awakon/terminal-host', () => {
  class StubTerminalHost {
    public selection = '';
    private _hasSel = false;
    constructor(_opts: unknown) {}
    setSelectionForTest(text: string): void {
      this.selection = text;
      this._hasSel = text.length > 0;
    }
    hasSelection(): boolean { return this._hasSel; }
    getSelection(): string { return this.selection; }
    paste(_: string): void {}
    selectAll(): void { this._hasSel = true; }
    focus(): void {}
    dispose(): void {}
  }
  return { TerminalHost: StubTerminalHost };
});

import { SplitContainer } from './split-container.js';
import type { SessionId, Shell } from '@awakon/contracts';

interface FakeBridge {
  send: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

function freshBridge(): FakeBridge {
  return {
    send: vi.fn().mockResolvedValue({ id: 'pane-1' }),
    on: vi.fn().mockReturnValue(() => {}),
  };
}

let rootEl: HTMLElement;
let bridge: FakeBridge;
let splits: SplitContainer;

beforeEach(() => {
  document.body.innerHTML = '';
  rootEl = document.createElement('div');
  document.body.appendChild(rootEl);
  bridge = freshBridge();
  splits = new SplitContainer({
    rootEl,
    bridge: bridge as unknown as Parameters<typeof SplitContainer>[0]['bridge'],
    initialSessionId: 'tab-1' as SessionId,
    shell: 'pwsh' as Shell,
    cwd: '/tmp',
  });
});

describe('SplitContainer pane context menu', () => {
  it('opens the menu on right-click in a pane', () => {
    const pane = rootEl.firstElementChild as HTMLElement;
    pane.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(document.querySelector('.aip-ctx-menu')).not.toBeNull();
  });

  it('disables Close pane in a single-leaf tree', () => {
    const pane = rootEl.firstElementChild as HTMLElement;
    pane.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    const items = document.querySelectorAll('.aip-ctx-menu__item');
    const closeItem = Array.from(items).find((i) => i.textContent?.includes('Close pane'));
    expect(closeItem?.classList.contains('aip-ctx-menu__item--disabled')).toBe(true);
  });

  it('prevents the browser default context menu', () => {
    const pane = rootEl.firstElementChild as HTMLElement;
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
    pane.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @awakon/desktop test -- split-container.test.ts`
Expected: FAIL — no `.aip-ctx-menu` appears because the listener isn't wired yet.

- [ ] **Step 3: Wire the `contextmenu` listener in `split-container.ts`**

Modify `apps/desktop/src/renderer/terminal/split-container.ts`:

**3a.** Add these imports at the top (after the existing imports at line 1-3):

```ts
import { showContextMenu } from './context-menu.js';
import { buildTerminalContextMenu } from './context-menu.js';
```

**3b.** Find `makePaneElement()` (currently at line 190). Replace its body with:

Current:
```ts
  private makePaneElement(): HTMLElement {
    const el = document.createElement('div');
    el.style.flex = '1 1 100%';
    el.style.minWidth = '0';
    el.style.minHeight = '0';
    el.style.height = '100%';
    el.tabIndex = 0;
    return el;
  }
```

Replace with:
```ts
  private makePaneElement(): HTMLElement {
    const el = document.createElement('div');
    el.style.flex = '1 1 100%';
    el.style.minWidth = '0';
    el.style.minHeight = '0';
    el.style.height = '100%';
    el.tabIndex = 0;
    this.wirePaneContextMenu(el);
    return el;
  }

  /** Right-click on a pane opens the themed context menu. The leaf is resolved
   * fresh from the DOM element on every event so it remains correct after
   * splits reshape the tree. */
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
          onCopy: () => {
            void navigator.clipboard.writeText(host.getSelection());
          },
          onPaste: async () => {
            const text = await navigator.clipboard.readText();
            host.paste(text);
          },
          onSelectAll: () => host.selectAll(),
          onSplitRight: () => { host.focus(); void this.splitFocused('horizontal'); },
          onSplitBelow: () => { host.focus(); void this.splitFocused('vertical'); },
          onClosePane:  () => { host.focus(); this.closeFocusedPane(); },
        }),
      });
    });
  }
```

- [ ] **Step 4: Run the integration test and confirm it passes**

Run: `pnpm --filter @awakon/desktop test -- split-container.test.ts`
Expected: PASS — all 3 cases green.

- [ ] **Step 5: Run the full desktop test suite to make sure nothing regressed**

Run: `pnpm --filter @awakon/desktop test`
Expected: PASS — every existing test still green; new tests for `context-menu.test.ts` and `split-container.test.ts` included.

- [ ] **Step 6: Run the full typecheck**

Run: `pnpm typecheck`
Expected: PASS across all packages.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/terminal/split-container.ts apps/desktop/src/renderer/terminal/split-container.test.ts
git commit -m "feat(terminal): wire context menu into split-container panes"
```

---

## Task 8: Manual verification in the running app

This task is **not** automated. After Tasks 1–7 land, exercise the feature in the dev app and check off the cases below before opening a PR.

**Files:** none (verification only).

- [ ] **Step 1: Start the dev app**

Run: `pnpm dev`
Expected: app window opens with a single terminal pane.

- [ ] **Step 2: Verify single-pane menu state**

1. Right-click anywhere in the terminal pane.
2. Confirm the menu appears at the click position with these rows:
   - Copy (greyed, because no selection)
   - Paste
   - Select all
   - ─────
   - Split right
   - Split below
   - ─────
   - Close pane (greyed, red text, because not in a split)
3. Confirm the keyboard hints on the right show `Ctrl+C`, `Ctrl+V`, `Ctrl+A`, `Ctrl+D`, `Ctrl+Shift+D`, `Ctrl+W` (Windows/Linux) or `⌘C` / `⌘V` / `⌘A` / `⌘D` / `⌘⇧D` / `⌘W` (macOS).

- [ ] **Step 3: Verify Copy gating**

1. Click-and-drag to select some terminal text.
2. Right-click. Confirm **Copy** is now enabled (full-strength color).
3. Click **Copy**. Menu closes.
4. Open a text editor and paste — confirm the selected text appears.

- [ ] **Step 4: Verify Split → enabled Close pane**

1. Right-click → **Split right**. Confirm a second pane appears to the right.
2. Right-click in the right pane.
3. Confirm **Close pane** is now enabled (red, not greyed).
4. Click **Close pane**. Confirm the right pane is removed.

- [ ] **Step 5: Verify Esc dismissal does not leak to xterm**

1. Right-click to open the menu.
2. Press **Esc**.
3. Confirm the menu closes and **no `^[`** (escape code) appears in the terminal output.

- [ ] **Step 6: Verify outside-click dismissal**

1. Right-click to open the menu.
2. Left-click anywhere outside the menu.
3. Confirm the menu closes without firing any item action.

- [ ] **Step 7: Verify viewport flip**

1. Resize the window to about 400px wide.
2. Right-click near the right edge of the terminal pane.
3. Confirm the menu opens to the **left** of the click instead of overflowing the window.

- [ ] **Step 8: Verify reopening on a second right-click**

1. Right-click to open the menu over the left half of the pane.
2. Right-click again over the right half **without** closing first.
3. Confirm the first menu dismisses and a fresh one opens at the new position.

- [ ] **Step 9: Verify there is no remaining native browser context menu**

1. With dev tools closed, right-click on the terminal area.
2. Confirm only the themed `aip-ctx-menu` appears — never the browser's default menu.

- [ ] **Step 10: Final commit (if anything was tweaked during verification)**

If manual verification revealed adjustments, commit them:

```bash
git add -p
git commit -m "fix(terminal): <describe the tweak>"
```

Otherwise nothing to commit at this step.

---

## Self-review checklist (for the engineer before requesting code review)

- [ ] All tasks above have green checkboxes.
- [ ] `pnpm test` passes across the workspace.
- [ ] `pnpm typecheck` passes across the workspace.
- [ ] `pnpm lint` is clean.
- [ ] Find and Clear are nowhere in the new code (grep confirmation: `git grep -n 'Find\|Clear' apps/desktop/src/renderer/terminal/`).
- [ ] No IPC, no main-process changes, no schema changes.
- [ ] The chrome renderer (`tab-strip.ts`, `sidebar.ts`, `layout-manager.ts`, `titlebar.ts`) is untouched.
