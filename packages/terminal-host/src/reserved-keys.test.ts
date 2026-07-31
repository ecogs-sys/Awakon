import { describe, expect, it, vi } from 'vitest';
import { Bindings, TERMINAL_PASS_THROUGH } from '@awakon/keymap';
import { TerminalBindingInvokePayloadSchema } from '@awakon/contracts';
import { createReservedKeyHandler } from './reserved-keys.js';

// Regression suite for the terminal-focus shortcut gap: with no custom key handler,
// xterm encoded reserved chords into PTY bytes (Ctrl+K → \x0b kill-line, Ctrl+T → \x14
// transpose-chars) and the app never saw them — the palette and all tab shortcuts were
// dead whenever a terminal had keyboard focus, i.e. most of the time.

interface Mods {
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** Fake KeyboardEvent — a structural stand-in so the suite needs no jsdom. */
function keyEvent(key: string, mods: Mods = {}, opts: { type?: string; code?: string } = {}): KeyboardEvent {
  return {
    type: opts.type ?? 'keydown',
    key,
    code: opts.code ?? '',
    ctrlKey: mods.ctrl ?? false,
    metaKey: mods.meta ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent;
}

function handler() {
  const invoke = vi.fn();
  return { invoke, handle: createReservedKeyHandler(invoke) };
}

describe('createReservedKeyHandler — reserved bindings', () => {
  it('Ctrl+K forwards commandPalette, consumes the event, and blocks xterm', () => {
    const { invoke, handle } = handler();
    const ev = keyEvent('k', { ctrl: true });
    expect(handle(ev)).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('commandPalette');
    // preventDefault suppresses the Win/Linux menu accelerator — without it the
    // accelerator's ActionInvoke pipe would double-fire the action.
    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['t', { ctrl: true }, 'newTab'],
    ['Tab', { ctrl: true }, 'nextTab'],
    ['Tab', { ctrl: true, shift: true }, 'prevTab'],
    ['3', { ctrl: true }, 'jumpTab3'],
    ['b', { ctrl: true }, 'toggleSidebar'],
    ['\\', { ctrl: true }, 'splitHorizontal'],
    ['w', { ctrl: true, shift: true }, 'closePane'],
  ] as const)('key %s %o → %s intercepted', (key, mods, action) => {
    const { invoke, handle } = handler();
    expect(handle(keyEvent(key, mods))).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(action);
  });

  it('Ctrl+Shift+\\ matches by physical code when the layout shifts the key to "|"', () => {
    const { invoke, handle } = handler();
    expect(handle(keyEvent('|', { ctrl: true, shift: true }, { code: 'Backslash' }))).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('splitVertical');
  });
});

describe('createReservedKeyHandler — pass-through', () => {
  it('Ctrl+W stays a shell key (word-rubout / vim window prefix), not closeTab', () => {
    const { invoke, handle } = handler();
    const ev = keyEvent('w', { ctrl: true });
    expect(handle(ev)).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it.each([
    ['c', { ctrl: true }], // SIGINT must always reach the PTY
    ['k', {}],
    ['k', { alt: true, ctrl: true }],
  ] as const)('unbound key %s %o flows to the PTY untouched', (key, mods) => {
    const { invoke, handle } = handler();
    expect(handle(keyEvent(key, mods))).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('non-keydown events are ignored even for reserved chords', () => {
    const { invoke, handle } = handler();
    expect(handle(keyEvent('k', { ctrl: true }, { type: 'keyup' }))).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('contract alignment', () => {
  it('the IPC schema enum is exactly the Bindings table minus TERMINAL_PASS_THROUGH', () => {
    const forwardable = Object.keys(Bindings).filter(
      (id) => !TERMINAL_PASS_THROUGH.has(id as keyof typeof Bindings),
    );
    expect(new Set(TerminalBindingInvokePayloadSchema.shape.action.options)).toEqual(
      new Set(forwardable),
    );
  });
});
