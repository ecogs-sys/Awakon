import { matchBinding, TERMINAL_PASS_THROUGH, type BindingId } from '@awakon/keymap';

/** Binding ids the terminal may forward to main — everything in the Bindings table
 * except the pass-through set. Mirrors contracts' TerminalBindingInvokePayloadSchema
 * (alignment asserted in reserved-keys.test.ts). */
export type ReservedBindingId = Exclude<BindingId, 'closeTab'>;

/**
 * xterm custom key handler: reserved app shortcuts (palette, tab management, sidebar,
 * splits) are intercepted BEFORE xterm encodes them into PTY bytes, so they behave
 * identically in every shell — the shell process never sees the keystroke. Bindings in
 * TERMINAL_PASS_THROUGH keep their shell meaning (Ctrl+W: bash/zsh word-rubout, vim's
 * window prefix) and flow to the PTY untouched.
 *
 * preventDefault() is load-bearing: on Win/Linux a renderer-consumed keydown suppresses
 * the app-menu accelerator (same mechanism chrome/keyboard.ts relies on), so the
 * forwarded action can never double-fire with the accelerator's ActionInvoke pipe. On
 * macOS the menu consumes key equivalents before the renderer sees them, so this
 * handler never runs for reserved combos there.
 */
export function createReservedKeyHandler(
  invoke: (action: ReservedBindingId) => void,
): (ev: KeyboardEvent) => boolean {
  return (ev) => {
    // xterm routes keydown/keypress/keyup through the same handler; only keydown
    // dispatches, but returning true for the rest is safe — Ctrl chords produce no
    // keypress input.
    if (ev.type !== 'keydown') return true;
    const id = matchBinding(ev);
    if (!id || TERMINAL_PASS_THROUGH.has(id)) return true;
    ev.preventDefault();
    invoke(id as ReservedBindingId);
    return false;
  };
}
