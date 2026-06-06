// ═══════════════════════════════════════════════════════════════════════
// Awakon — platform helpers
//
// One detection at startup, then all UI uses kbd('Mod+K') for both display
// and event matching. Single source of truth across the three OSes.
// ═══════════════════════════════════════════════════════════════════════

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
 *
 *   kbd('Mod+K')          // → '⌘K'    on macOS · 'Ctrl+K'    elsewhere
 *   kbd('Mod+Shift+P')    // → '⌘⇧P'   on macOS · 'Ctrl+Shift+P'
 *   kbd('Mod+Enter')      // → '⌘↵'    on macOS · 'Ctrl+Enter'
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
      .replace(/\+/g,                      '');     // macOS uses no separator
  }
  return combo.replace(/\bMod\b/g, 'Ctrl');         // Win / Linux keep '+' joiners
}

/**
 * Check whether a KeyboardEvent matches a given combo string. Use 'Mod'
 * to mean Cmd on macOS and Ctrl elsewhere.
 *
 *   if (matchShortcut(e, 'Mod+K')) openPalette();
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
  if (otherSide) return false;                       // reject wrong-modifier combos
  if (wantShift !== e.shiftKey) return false;
  if (wantAlt   !== e.altKey)   return false;

  // Match by .key (letter / Enter / Escape / ArrowLeft / etc.)
  return e.key.toLowerCase() === key.toLowerCase();
}
