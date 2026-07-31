/**
 * Plan 1 shipped a minimal registry. Plan 2 adds tab and sidebar shortcuts.
 * Plan 3 will add split shortcuts (Ctrl+\, Ctrl+Shift+\).
 */
export interface KeyBinding {
  id: string;
  description: string;
  /** Electron accelerator syntax. The chrome renderer maps these to keydown matches. */
  accelerator: string;
}

export const Bindings = {
  newTab:        { id: 'newTab',        description: 'New tab',           accelerator: 'CmdOrCtrl+T' },
  closeTab:      { id: 'closeTab',      description: 'Close tab',         accelerator: 'CmdOrCtrl+W' },
  nextTab:       { id: 'nextTab',       description: 'Next tab',          accelerator: 'CmdOrCtrl+Tab' },
  prevTab:       { id: 'prevTab',       description: 'Previous tab',      accelerator: 'CmdOrCtrl+Shift+Tab' },
  jumpTab1:      { id: 'jumpTab1',      description: 'Switch to tab 1',   accelerator: 'CmdOrCtrl+1' },
  jumpTab2:      { id: 'jumpTab2',      description: 'Switch to tab 2',   accelerator: 'CmdOrCtrl+2' },
  jumpTab3:      { id: 'jumpTab3',      description: 'Switch to tab 3',   accelerator: 'CmdOrCtrl+3' },
  jumpTab4:      { id: 'jumpTab4',      description: 'Switch to tab 4',   accelerator: 'CmdOrCtrl+4' },
  jumpTab5:      { id: 'jumpTab5',      description: 'Switch to tab 5',   accelerator: 'CmdOrCtrl+5' },
  jumpTab6:      { id: 'jumpTab6',      description: 'Switch to tab 6',   accelerator: 'CmdOrCtrl+6' },
  jumpTab7:      { id: 'jumpTab7',      description: 'Switch to tab 7',   accelerator: 'CmdOrCtrl+7' },
  jumpTab8:      { id: 'jumpTab8',      description: 'Switch to tab 8',   accelerator: 'CmdOrCtrl+8' },
  jumpTab9:      { id: 'jumpTab9',      description: 'Switch to tab 9',   accelerator: 'CmdOrCtrl+9' },
  toggleSidebar:   { id: 'toggleSidebar',   description: 'Toggle sidebar',      accelerator: 'CmdOrCtrl+B' },
  splitHorizontal: { id: 'splitHorizontal', description: 'Split horizontally', accelerator: 'CmdOrCtrl+\\' },
  splitVertical:   { id: 'splitVertical',   description: 'Split vertically',   accelerator: 'CmdOrCtrl+Shift+\\' },
  closePane:       { id: 'closePane',       description: 'Close pane',         accelerator: 'CmdOrCtrl+Shift+W' },
  commandPalette:  { id: 'commandPalette',  description: 'Command palette',    accelerator: 'CmdOrCtrl+K' },
} as const satisfies Record<string, KeyBinding>;

export type BindingId = keyof typeof Bindings;

/**
 * Bindings that keep their shell meaning while an xterm terminal has keyboard focus —
 * the terminal-side interceptor (terminal-host reserved-keys.ts) lets these reach the
 * PTY instead of invoking the app action. Ctrl+W is unix-word-rubout in bash/zsh emacs
 * mode and vim's window-command prefix; stealing it would turn a word-erase into a tab
 * close. Close Tab stays reachable from a focused terminal via the menu and palette.
 * (Same call VS Code and Windows Terminal make: neither reserves plain Ctrl+W from
 * the shell.)
 */
export const TERMINAL_PASS_THROUGH: ReadonlySet<BindingId> = new Set<BindingId>(['closeTab']);

/** Structural subset of DOM KeyboardEvent used for matching, so this package (also
 * imported by the main process) never depends on a live DOM event instance. */
export interface KeyEventLike {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  key: string;
  code: string;
}

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

/** Physical-position fallback: `ev.key` is layout- and shift-dependent (Ctrl+Shift+\
 * reports key "|" on a US layout), so also match on `ev.code` normalized to the
 * accelerator's key spelling. */
function normalizeCode(code: string): string {
  if (code.startsWith('Key')) return code.slice(3).toUpperCase();
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Backslash') return '\\';
  return code.toUpperCase();
}

function eventMatches(ev: KeyEventLike, acc: ParsedAccelerator): boolean {
  const ctrlPressed = ev.ctrlKey || ev.metaKey;
  if (!!acc.ctrl !== ctrlPressed) return false;
  if (!!acc.shift !== ev.shiftKey) return false;
  if (!!acc.alt !== ev.altKey) return false;
  return ev.key.toUpperCase() === acc.key || normalizeCode(ev.code) === acc.key;
}

const PARSED_BINDINGS: ReadonlyArray<{ id: BindingId; acc: ParsedAccelerator }> = Object.entries(
  Bindings,
).map(([id, binding]) => ({ id: id as BindingId, acc: parseAccelerator(binding.accelerator) }));

/** Match a keyboard event against the Bindings table. Single matcher shared by the
 * chrome keydown path (chrome/keyboard.ts) and the terminal interceptor, so the two
 * can never disagree about what a chord means. */
export function matchBinding(ev: KeyEventLike): BindingId | null {
  for (const { id, acc } of PARSED_BINDINGS) {
    if (eventMatches(ev, acc)) return id;
  }
  return null;
}

/**
 * Render an Electron accelerator as an OS-appropriate label. macOS uses the glyph
 * cluster (⌃⌥⇧⌘K); Windows/Linux use the "Ctrl+Shift+K" form. This is the single
 * source for shortcut display so labels can never drift from the bindings.
 */
export function formatAccelerator(accelerator: string, platform: NodeJS.Platform | string): string {
  const mac = platform === 'darwin';
  const mods = { ctrl: false, alt: false, shift: false, cmd: false };
  let key = '';
  for (const part of accelerator.split('+')) {
    switch (part) {
      case 'CmdOrCtrl':
      case 'Cmd':
      case 'Command':      mac ? (mods.cmd = true) : (mods.ctrl = true); break;
      case 'Ctrl':
      case 'Control':      mods.ctrl = true; break;
      case 'Alt':
      case 'Option':       mods.alt = true; break;
      case 'Shift':        mods.shift = true; break;
      default:             key = part;
    }
  }
  const k = key.length === 1 ? key.toUpperCase() : key;
  if (mac) {
    return `${mods.ctrl ? '⌃' : ''}${mods.alt ? '⌥' : ''}${mods.shift ? '⇧' : ''}${mods.cmd ? '⌘' : ''}${k}`;
  }
  const prefix: string[] = [];
  if (mods.ctrl) prefix.push('Ctrl');
  if (mods.alt) prefix.push('Alt');
  if (mods.shift) prefix.push('Shift');
  return prefix.length ? `${prefix.join('+')}+${k}` : k;
}
