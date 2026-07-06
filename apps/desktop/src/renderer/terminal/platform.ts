// Cross-platform detection helper. Shortcut label formatting lives in
// @awakon/keymap's formatAccelerator — this file used to duplicate that as kbd(),
// which is why its labels could (and did) drift from the actual bindings (A6-M1/M2).

export type Platform = 'mac' | 'windows' | 'linux';

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'linux';
  const p = (navigator.platform || navigator.userAgent || '').toLowerCase();
  if (p.includes('mac')) return 'mac';
  if (p.includes('win')) return 'windows';
  return 'linux';
}

export const PLATFORM: Platform = detectPlatform();

/** The subset of formatAccelerator's `platform` param it actually distinguishes
 * ('darwin' vs anything else) — lets terminal-renderer call sites reuse the shared
 * keymap formatter instead of a local duplicate. */
export const ACCELERATOR_PLATFORM: NodeJS.Platform | 'other' = PLATFORM === 'mac' ? 'darwin' : 'other';
