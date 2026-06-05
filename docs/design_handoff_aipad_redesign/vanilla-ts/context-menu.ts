// ═══════════════════════════════════════════════════════════════════════
// Awakon — Context menu (right-click)
//
// Generic component used for:
//   • terminal area: copy / paste / select-all / find / clear / split / close
//   • tab right-click: rename / duplicate / move to new window / close
//   • session row right-click: same as tab
//   • md pane link right-click: copy path / open in editor / reveal in finder
//
// Mount one menu at a time; clicking outside or pressing Esc dismisses it.
// ═══════════════════════════════════════════════════════════════════════

import { h, setChildren } from './dom.ts';
import { kbd, matchShortcut } from './platform.ts';

export interface ContextMenuItem {
  /** Item label. Required. */
  label: string;
  /** Shortcut in 'Mod+C' format — auto-translates to ⌘C / Ctrl+C. */
  shortcut?: string;
  /** Optional 1-char glyph (mono) shown on the left. */
  icon?: string;
  disabled?: boolean;
  /** Styles the item in red — use for destructive actions like Close pane. */
  danger?: boolean;
  /** Called when activated (click / Enter). The menu auto-closes afterward. */
  onClick?: () => void;
  /** Used by the parent context-menu controller for keyboard nav. */
  id?: string;
}

/** Pass a `null` between items to insert a separator line. */
export type ContextMenuSection = (ContextMenuItem | null)[];

export interface ContextMenuOptions {
  /** Menu items, optionally with nulls as separators. */
  items: ContextMenuSection;
  /** Pixel coords of the click. Auto-flipped if it would go off-screen. */
  x: number;
  y: number;
  /** Called when the menu dismisses (outside click, Esc, item activation). */
  onClose?: () => void;
}

/**
 * Render a context menu and mount it to `document.body`. Returns the menu
 * element; the caller can keep a handle but typically just relies on the
 * auto-dismiss behavior.
 *
 * Auto-handles:
 *   • outside-click dismissal (via an invisible backdrop layer)
 *   • Esc dismissal
 *   • arrow-key navigation between enabled items
 *   • viewport flipping if click is near the edge
 *
 * Production note: in Electron, you can also use the native Menu API
 * (electron.Menu.buildFromTemplate) for a more native feel — but you lose
 * theming. We use a custom menu because matching the rest of the dark UI
 * is more important than native consistency in a developer tool.
 */
export function showContextMenu({ items, x, y, onClose }: ContextMenuOptions): HTMLElement {
  // Filter to keep nulls (separators) but track real items for keyboard nav
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
      ] as any);
    }));
  }
  renderItems();

  // Position — measure after mount so we can flip if needed.
  document.body.append(backdrop, menu);
  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const px = (x + rect.width  > vw - 8) ? Math.max(8, x - rect.width)  : x;
  const py = (y + rect.height > vh - 8) ? Math.max(8, y - rect.height) : y;
  menu.style.left = px + 'px';
  menu.style.top  = py + 'px';

  // Outside click closes.
  backdrop.addEventListener('mousedown', close);
  backdrop.addEventListener('contextmenu', (e) => { e.preventDefault(); close(); });

  // Keyboard.
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Enter')  {
      e.preventDefault();
      activate(realItems[activeIdx]);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const pos = enabledIndices.indexOf(activeIdx);
      const next = enabledIndices[(pos + dir + enabledIndices.length) % enabledIndices.length];
      activeIdx = next;
      renderItems();
    }
  }
  window.addEventListener('keydown', onKey, true);

  return menu;
}

// ─── Pre-built menu builders ────────────────────────────────────────
// These match the design spec. Wire your real callbacks in production.

export interface TerminalMenuOptions {
  /** True when text is selected in the terminal — gates Copy. */
  hasSelection: boolean;
  /** True when there's text on the clipboard — gates Paste. */
  hasClipboard: boolean;
  /** True when this pane is part of a split (enables Close pane). */
  inSplit: boolean;
  onCopy?:        () => void;
  onPaste?:       () => void;
  onSelectAll?:   () => void;
  onClear?:       () => void;
  onFind?:        () => void;
  onSplitRight?:  () => void;
  onSplitBelow?:  () => void;
  onClosePane?:   () => void;
}

export function buildTerminalContextMenu(opts: TerminalMenuOptions): ContextMenuSection {
  return [
    { label: 'Copy',        shortcut: 'Mod+C', icon: '⎘', disabled: !opts.hasSelection, onClick: opts.onCopy },
    { label: 'Paste',       shortcut: 'Mod+V', icon: '⎙', disabled: !opts.hasClipboard, onClick: opts.onPaste },
    { label: 'Select all',  shortcut: 'Mod+A',            onClick: opts.onSelectAll },
    null,
    { label: 'Find\u2026',  shortcut: 'Mod+F', icon: '⌕', onClick: opts.onFind },
    { label: 'Clear',       shortcut: 'Mod+L', icon: '⌫', onClick: opts.onClear },
    null,
    { label: 'Split right', shortcut: 'Mod+D',            onClick: opts.onSplitRight },
    { label: 'Split below', shortcut: 'Mod+Shift+D',      onClick: opts.onSplitBelow },
    null,
    { label: 'Close pane',  shortcut: 'Mod+W', icon: '×', danger: true, onClick: opts.onClosePane,
      disabled: !opts.inSplit },
  ];
}

export interface TabMenuOptions {
  isAwaiting: boolean;
  onRename?:           () => void;
  onDuplicate?:        () => void;
  onMoveToNewWindow?:  () => void;
  onCloseOthers?:      () => void;
  onClose?:            () => void;
}

export function buildTabContextMenu(opts: TabMenuOptions): ContextMenuSection {
  return [
    { label: 'Rename\u2026',          shortcut: 'F2',   onClick: opts.onRename },
    { label: 'Duplicate',             shortcut: 'Mod+Shift+D', onClick: opts.onDuplicate },
    { label: 'Move to new window',                       onClick: opts.onMoveToNewWindow },
    null,
    { label: 'Close other tabs',                         onClick: opts.onCloseOthers },
    { label: 'Close',                 shortcut: 'Mod+W', danger: true, onClick: opts.onClose },
  ];
}
