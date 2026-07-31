// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { wireKeyboard, routeMenuAction, type KeyboardCallbacks } from './keyboard.js';
import type { LayoutManager } from './layout-manager.js';

// Regression suite for the Windows/Linux chrome-focus shortcut gap: app-menu
// accelerators do not fire while the chrome webContents has keyboard focus, so every
// binding must resolve to a working handler on the document-keydown path. Ctrl+K used
// to be a no-op here — palette dead at the empty state and impossible to toggle closed
// (runtime-verified with native keys + --log-ipc, 2026-07-13).

function makeManager(overrides: Partial<Record<string, unknown>> = {}): LayoutManager {
  return {
    newTab: vi.fn().mockResolvedValue(undefined),
    closeFocused: vi.fn(),
    focusNext: vi.fn(),
    focusPrev: vi.fn(),
    focusIndex: vi.fn(),
    toggleSidebar: vi.fn(),
    openSettings: vi.fn().mockResolvedValue(undefined),
    openAbout: vi.fn().mockResolvedValue(undefined),
    isDialogOpen: vi.fn(() => false),
    ...overrides,
  } as unknown as LayoutManager;
}

function makeCallbacks(): KeyboardCallbacks {
  return { commandPalette: vi.fn(), terminalAction: vi.fn() };
}

function press(key: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', {
    key,
    ctrlKey: mods.ctrl ?? false,
    metaKey: mods.meta ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(ev);
  return ev;
}

describe('wireKeyboard — command palette binding', () => {
  it('Ctrl+K invokes the commandPalette callback and consumes the event (Win/Linux)', () => {
    const cb = makeCallbacks();
    wireKeyboard(makeManager(), cb);
    const ev = press('k', { ctrl: true });
    expect(cb.commandPalette).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('Cmd+K (metaKey) also invokes the commandPalette callback (macOS keydown parity)', () => {
    const cb = makeCallbacks();
    wireKeyboard(makeManager(), cb);
    press('k', { meta: true });
    expect(cb.commandPalette).toHaveBeenCalledTimes(1);
  });

  it('plain K without a modifier does nothing', () => {
    const cb = makeCallbacks();
    const manager = makeManager();
    wireKeyboard(manager, cb);
    press('k');
    expect(cb.commandPalette).not.toHaveBeenCalled();
    expect(cb.terminalAction).not.toHaveBeenCalled();
  });

  it('is suppressed while a chrome dialog is open (A5-I1 guard unchanged)', () => {
    const cb = makeCallbacks();
    wireKeyboard(makeManager({ isDialogOpen: vi.fn(() => true) }), cb);
    press('k', { ctrl: true });
    expect(cb.commandPalette).not.toHaveBeenCalled();
  });
});

describe('wireKeyboard — pane actions forward to the terminal', () => {
  it.each([
    ['\\', { ctrl: true }, 'splitHorizontal'],
    ['\\', { ctrl: true, shift: true }, 'splitVertical'],
    ['w', { ctrl: true, shift: true }, 'closePane'],
  ] as const)('key %s %o → terminalAction(%s)', (key, mods, action) => {
    const cb = makeCallbacks();
    wireKeyboard(makeManager(), cb);
    press(key, mods);
    expect(cb.terminalAction).toHaveBeenCalledTimes(1);
    expect(cb.terminalAction).toHaveBeenCalledWith(action);
  });
});

describe('wireKeyboard — existing bindings unaffected', () => {
  it('dispatches every manager-backed binding to the same handler as before', () => {
    const cb = makeCallbacks();
    const manager = makeManager();
    wireKeyboard(manager, cb);

    press('t', { ctrl: true });
    expect(manager.newTab).toHaveBeenCalledTimes(1);

    press('w', { ctrl: true });
    expect(manager.closeFocused).toHaveBeenCalledTimes(1);

    press('Tab', { ctrl: true });
    expect(manager.focusNext).toHaveBeenCalledTimes(1);

    press('Tab', { ctrl: true, shift: true });
    expect(manager.focusPrev).toHaveBeenCalledTimes(1);

    press('b', { ctrl: true });
    expect(manager.toggleSidebar).toHaveBeenCalledTimes(1);

    press('3', { ctrl: true });
    expect(manager.focusIndex).toHaveBeenCalledWith(3);

    // None of the above may leak into the palette/terminal callbacks.
    expect(cb.commandPalette).not.toHaveBeenCalled();
    expect(cb.terminalAction).not.toHaveBeenCalled();
  });

  it('Ctrl+Shift+W closes the pane, not the tab (modifier matching still exact)', () => {
    const cb = makeCallbacks();
    const manager = makeManager();
    wireKeyboard(manager, cb);
    press('w', { ctrl: true, shift: true });
    expect(manager.closeFocused).not.toHaveBeenCalled();
    expect(cb.terminalAction).toHaveBeenCalledWith('closePane');
  });
});

describe('routeMenuAction', () => {
  it('routes commandPalette from the menu-accelerator pipe to the same callback', () => {
    const cb = makeCallbacks();
    routeMenuAction(makeManager(), cb, 'commandPalette');
    expect(cb.commandPalette).toHaveBeenCalledTimes(1);
  });

  it('still routes openSettings / openAbout to the manager', () => {
    const cb = makeCallbacks();
    const manager = makeManager();
    routeMenuAction(manager, cb, 'openSettings');
    expect(manager.openSettings).toHaveBeenCalledTimes(1);
    routeMenuAction(manager, cb, 'openAbout');
    expect(manager.openAbout).toHaveBeenCalledTimes(1);
  });

  it('ignores unknown actions', () => {
    const cb = makeCallbacks();
    expect(() => routeMenuAction(makeManager(), cb, 'nope')).not.toThrow();
    expect(cb.commandPalette).not.toHaveBeenCalled();
    expect(cb.terminalAction).not.toHaveBeenCalled();
  });
});
