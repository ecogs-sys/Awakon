import { matchBinding, type BindingId } from '@awakon/keymap';
import type { LayoutManager } from './layout-manager.js';

/**
 * Chrome-side handlers for bindings whose target lives outside the LayoutManager.
 * Every binding MUST have a working handler here: on Windows/Linux the app-menu
 * accelerators do not fire while the chrome webContents has keyboard focus (empty
 * state, palette open, after clicking the sidebar/titlebar), so this keydown path is
 * the only one that runs there. A no-op entry produces a shortcut that works on macOS
 * (the menu handles the key equivalent before the renderer sees it) but is silently
 * dead on Windows/Linux — that was the Ctrl+K command-palette bug, runtime-verified
 * with native keys + --log-ipc on 2026-07-13.
 */
export interface KeyboardCallbacks {
  /** Toggle the command palette — same effect as the menu accelerator's ActionInvoke path. */
  commandPalette: () => void;
  /** Forward a pane action to the focused tab's terminal view (relayed via main). */
  terminalAction: (action: 'splitHorizontal' | 'splitVertical' | 'closePane') => void;
}

const ACTION_HANDLERS: Record<BindingId, (m: LayoutManager, cb: KeyboardCallbacks) => void> = {
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
  splitHorizontal: (_m, cb) => cb.terminalAction('splitHorizontal'),
  splitVertical: (_m, cb) => cb.terminalAction('splitVertical'),
  closePane: (_m, cb) => cb.terminalAction('closePane'),
  commandPalette: (_m, cb) => cb.commandPalette(),
};

export function wireKeyboard(manager: LayoutManager, callbacks: KeyboardCallbacks): void {
  document.addEventListener('keydown', (ev) => {
    // A5-I1: a chrome dialog (Settings/About/New Session/Rename) owns its own Escape/
    // Enter handling via its own document keydown listener — the global bindings here
    // must not also fire while one is open (e.g. Ctrl+T re-triggering newTab and
    // wiping the open New Session dialog's DOM out from under it).
    if (manager.isDialogOpen()) return;
    const id = matchBinding(ev);
    if (!id) return;
    ev.preventDefault();
    ev.stopPropagation();
    ACTION_HANDLERS[id](manager, callbacks);
  });
}

export function routeMenuAction(manager: LayoutManager, callbacks: KeyboardCallbacks, actionId: string): void {
  if (actionId === 'openSettings') {
    void manager.openSettings();
    return;
  }
  if (actionId === 'openAbout') {
    void manager.openAbout();
    return;
  }
  const handler = ACTION_HANDLERS[actionId as BindingId];
  if (handler) handler(manager, callbacks);
}
