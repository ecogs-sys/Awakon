// Awakon terminal-pane context menu.
//
// Ported from docs/design_handoff_awakon_redesign/vanilla-ts/context-menu.ts
// with Find and Clear items removed per the 2026-05-26 spec.

import { h, setChildren } from './dom.js';
import { Bindings, formatAccelerator } from '@awakon/keymap';

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
  /** 'darwin' or anything else — formats the split/close-pane shortcut hints via the
   * shared keymap formatAccelerator so they can never drift from the real bindings
   * (A6-I2: this menu used to hardcode "Mod+D"/"Mod+Shift+D"/"Mod+W", which didn't
   * match the actual CmdOrCtrl+\ / CmdOrCtrl+Shift+\ / CmdOrCtrl+Shift+W bindings). */
  platform: NodeJS.Platform | string;
  onCopy:        () => void;
  onPaste:       () => void;
  onSelectAll:   () => void;
  onSplitRight:  () => void;
  onSplitBelow:  () => void;
  onClosePane:   () => void;
}

export function buildTerminalContextMenu(opts: TerminalMenuOptions): ContextMenuSection {
  const fmt = (accelerator: string): string => formatAccelerator(accelerator, opts.platform);
  return [
    // Copy/Paste/Select all have no keyboard wiring in the terminal renderer — showing
    // a shortcut hint here would advertise a binding that doesn't actually work.
    { label: 'Copy',        icon: '⎘', disabled: !opts.hasSelection, onClick: opts.onCopy },
    { label: 'Paste',       icon: '⎙', onClick: opts.onPaste },
    { label: 'Select all',             onClick: opts.onSelectAll },
    null,
    { label: 'Split right', shortcut: fmt(Bindings.splitHorizontal.accelerator), onClick: opts.onSplitRight },
    { label: 'Split below', shortcut: fmt(Bindings.splitVertical.accelerator),   onClick: opts.onSplitBelow },
    null,
    { label: 'Close pane',  shortcut: fmt(Bindings.closePane.accelerator), icon: '×', danger: true, onClick: opts.onClosePane,
      disabled: !opts.inSplit },
  ];
}

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
    // Order is load-bearing: close() runs onClose BEFORE the item's onClick. Callers
    // (e.g. the terminal pane menu) rely on this to restore focus in onClose and then
    // let onClick re-target it — flipping these two lines would break that. See
    // split-container.ts wirePaneContextMenu().
    close();
    it.onClick?.();
  }

  // Item nodes are built ONCE so click handlers stay attached to the same DOM
  // node across hover/keyboard navigation. The --active class is toggled in
  // place via updateActiveClass(), not by recreating the children. (Recreating
  // mid-click — e.g. mouseenter firing between mousedown and mouseup — would
  // cause the click event to be dropped because mousedown/mouseup landed on
  // different elements.)
  const itemNodes: HTMLElement[] = [];
  let realIdx = 0;
  setChildren(menu, items.map((it) => {
    if (it === null) return h('div', { class: 'aip-ctx-menu__sep' });
    const i = realIdx++;
    const cls = ['aip-ctx-menu__item'];
    if (it.disabled) cls.push('aip-ctx-menu__item--disabled');
    if (it.danger)   cls.push('aip-ctx-menu__item--danger');
    const node = h('div', {
      class: cls.join(' '),
      on: {
        click: () => activate(it),
        mouseenter: () => { if (!it.disabled) { activeIdx = i; updateActiveClass(); } },
      },
    }, [
      h('span', { class: 'aip-ctx-menu__icon', text: it.icon ?? '' }),
      h('span', { class: 'aip-ctx-menu__label', text: it.label }),
      it.shortcut ? h('span', { class: 'aip-ctx-menu__kbd', text: it.shortcut }) : null,
    ]);
    itemNodes.push(node);
    return node;
  }));

  function updateActiveClass(): void {
    itemNodes.forEach((node, i) => {
      const it = realItems[i];
      const isActive = i === activeIdx && it && !it.disabled;
      node.classList.toggle('aip-ctx-menu__item--active', isActive);
    });
  }
  updateActiveClass();

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
      updateActiveClass();
    }
  }
  window.addEventListener('keydown', onKey, true);

  return menu;
}
