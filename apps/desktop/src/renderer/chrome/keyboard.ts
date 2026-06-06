import { Bindings, type BindingId } from '@awakon/keymap';
import type { LayoutManager } from './layout-manager.js';

interface ParsedAccelerator {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string; // uppercase
}

function parseAccelerator(acc: string): ParsedAccelerator {
  const parts = acc.split('+').map((p) => p.trim());
  const result: ParsedAccelerator = { ctrl: false, shift: false, alt: false, key: '' };
  for (const part of parts) {
    if (part === 'CmdOrCtrl' || part === 'Ctrl' || part === 'Cmd') result.ctrl = true;
    else if (part === 'Shift') result.shift = true;
    else if (part === 'Alt' || part === 'Option') result.alt = true;
    else result.key = part.toUpperCase();
  }
  return result;
}

function eventMatches(ev: KeyboardEvent, acc: ParsedAccelerator): boolean {
  const ctrlPressed = ev.ctrlKey || ev.metaKey;
  if (!!acc.ctrl !== ctrlPressed) return false;
  if (!!acc.shift !== ev.shiftKey) return false;
  if (!!acc.alt !== ev.altKey) return false;
  return ev.key.toUpperCase() === acc.key || ev.code.toUpperCase() === acc.key
    // Map `Tab` literal to the actual Tab key
    || (acc.key === 'TAB' && ev.key === 'Tab');
}

const ACTION_HANDLERS: Record<BindingId, (m: LayoutManager) => void> = {
  newTab: (m) => void m.newTab(),
  closeTab: (m) => m.closeFocused(),
  nextTab: (m) => m.focusNext(),
  prevTab: (m) => m.focusPrev(),
  jumpTab1: (m) => m.focusIndex(1),
  jumpTab2: (m) => m.focusIndex(2),
  jumpTab3: (m) => m.focusIndex(3),
  jumpTab4: (m) => m.focusIndex(4),
  jumpTab5: (m) => m.focusIndex(5),
  jumpTab6: (m) => m.focusIndex(6),
  jumpTab7: (m) => m.focusIndex(7),
  jumpTab8: (m) => m.focusIndex(8),
  jumpTab9: (m) => m.focusIndex(9),
  toggleSidebar: (m) => m.toggleSidebar(),
  // These act on the focused terminal view, not the chrome. They are dispatched by the
  // Electron menu accelerator as a TerminalAction event; the chrome handler is a no-op.
  splitHorizontal: () => {},
  splitVertical: () => {},
  closePane: () => {},
};

export function wireKeyboard(manager: LayoutManager): void {
  const parsed: Array<{ id: BindingId; acc: ParsedAccelerator }> = Object.entries(Bindings).map(
    ([id, binding]) => ({ id: id as BindingId, acc: parseAccelerator(binding.accelerator) }),
  );

  document.addEventListener('keydown', (ev) => {
    for (const { id, acc } of parsed) {
      if (eventMatches(ev, acc)) {
        ev.preventDefault();
        ev.stopPropagation();
        ACTION_HANDLERS[id](manager);
        return;
      }
    }
  });
}

export function routeMenuAction(manager: LayoutManager, actionId: string): void {
  if (actionId === 'openSettings') {
    void manager.openSettings();
    return;
  }
  if (actionId === 'openAbout') {
    void manager.openAbout();
    return;
  }
  const handler = ACTION_HANDLERS[actionId as BindingId];
  if (handler) handler(manager);
}
