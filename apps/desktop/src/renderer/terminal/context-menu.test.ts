// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { h, setChildren } from './dom.js';
import { buildTerminalContextMenu } from './context-menu.js';

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

describe('buildTerminalContextMenu()', () => {
  const baseOpts = {
    hasSelection: true,
    inSplit: true,
    platform: 'linux' as const,
    onCopy: () => {},
    onPaste: () => {},
    onSelectAll: () => {},
    onSplitRight: () => {},
    onSplitBelow: () => {},
    onClosePane: () => {},
  };

  it('formats split/close-pane shortcuts from the real keymap bindings, not hardcoded literals (A6-I2)', () => {
    const items = buildTerminalContextMenu(baseOpts);
    expect(items[4]?.shortcut).toBe('Ctrl+\\');
    expect(items[5]?.shortcut).toBe('Ctrl+Shift+\\');
    expect(items[7]?.shortcut).toBe('Ctrl+Shift+W');
  });

  it('formats shortcuts with mac glyphs when platform is darwin', () => {
    const items = buildTerminalContextMenu({ ...baseOpts, platform: 'darwin' });
    expect(items[4]?.shortcut).toBe('⌘\\');
    expect(items[7]?.shortcut).toBe('⇧⌘W');
  });

  it('does not advertise a shortcut for Copy/Paste/Select all (no keyboard wiring exists)', () => {
    const items = buildTerminalContextMenu(baseOpts);
    expect(items[0]?.shortcut).toBeUndefined();
    expect(items[1]?.shortcut).toBeUndefined();
    expect(items[2]?.shortcut).toBeUndefined();
  });

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
      platform: 'linux',
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

import { showContextMenu } from './context-menu.js';
import type { ContextMenuItem, ContextMenuSection } from './context-menu.js';

function basicItems(opts: { onA?: () => void; onB?: () => void; disabledA?: boolean } = {}): ContextMenuSection {
  const a: ContextMenuItem = { label: 'A' };
  if (opts.disabledA !== undefined) a.disabled = opts.disabledA;
  if (opts.onA) a.onClick = opts.onA;
  const b: ContextMenuItem = { label: 'B' };
  if (opts.onB) b.onClick = opts.onB;
  return [a, b];
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
