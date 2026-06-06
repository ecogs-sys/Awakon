// ═══════════════════════════════════════════════════════════════════════
// Awakon — icons (SVG factories)
// Each returns an SVGSVGElement so callers can size it via CSS.
// ═══════════════════════════════════════════════════════════════════════

import { s } from './dom.ts';

/** Tiny app glyph for the titlebar (24-unit viewBox). */
export function appGlyph(accent = 'var(--accent)'): SVGElement {
  return s('svg', { viewBox: '0 0 24 24', width: 16, height: 16, style: 'display:block' }, [
    s('rect', { width: 24, height: 24, rx: 6, fill: '#2a2f38' }),
    s('circle', { cx: 7,  cy: 9, r: 1.6, fill: '#9bc8a3' }),
    s('circle', { cx: 12, cy: 9, r: 1.6, fill: accent }),
    s('circle', { cx: 17, cy: 9, r: 1.6, fill: '#e0c477' }),
    s('path', {
      d: 'M 7 15 L 10 17 L 7 19',
      fill: 'none', stroke: '#e8eaee', 'stroke-width': 1.4,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }),
    s('rect', { x: 12, y: 18, width: 5, height: 1.2, rx: 0.6, fill: accent }),
  ]);
}

/** ────────────────────────────────────────────────────────────────────
 *  Direction A — refined evolution of the existing icon.
 *  Same DNA (rounded square + status dots + cursor) tightened up.
 * ──────────────────────────────────────────────────────────────────── */
export function iconA(accent = '#7CA8E0'): SVGElement {
  const grad = s('linearGradient', { id: 'iconA-bg', x1: 0, y1: 0, x2: 0, y2: 1 }, [
    s('stop', { offset: 0, 'stop-color': '#2a2f38' }),
    s('stop', { offset: 1, 'stop-color': '#1a1d24' }),
  ]);
  return s('svg', { viewBox: '0 0 1024 1024', xmlns: 'http://www.w3.org/2000/svg',
                    style: 'width:100%;height:100%;display:block' }, [
    s('defs', {}, [grad]),
    s('rect', { width: 1024, height: 1024, rx: 224, fill: 'url(#iconA-bg)' }),
    s('rect', { width: 1024, height: 1024, rx: 224, fill: 'none', stroke: 'rgba(255,255,255,0.06)', 'stroke-width': 2 }),
    s('circle', { cx: 260, cy: 320, r: 60, fill: '#9bc8a3' }),
    s('circle', { cx: 436, cy: 320, r: 60, fill: accent }),
    s('circle', { cx: 612, cy: 320, r: 60, fill: '#e0c477' }),
    s('circle', { cx: 788, cy: 320, r: 60, fill: '#6e7480', opacity: 0.55 }),
    s('path', { d: 'M 260 600 L 420 700 L 260 800', fill: 'none',
                stroke: '#e8eaee', 'stroke-width': 64,
                'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    s('rect', { x: 500, y: 760, width: 264, height: 44, rx: 6, fill: accent }),
  ]);
}

/** ────────────────────────────────────────────────────────────────────
 *  Direction B — the pad as physical artifact (notepad surface).
 * ──────────────────────────────────────────────────────────────────── */
export function iconB(accent = '#7CA8E0'): SVGElement {
  const bgGrad = s('linearGradient', { id: 'iconB-bg', x1: 0, y1: 0, x2: 1, y2: 1 }, [
    s('stop', { offset: 0, 'stop-color': '#1f232b' }),
    s('stop', { offset: 1, 'stop-color': '#13151a' }),
  ]);
  const sheetGrad = s('linearGradient', { id: 'iconB-sheet', x1: 0, y1: 0, x2: 0, y2: 1 }, [
    s('stop', { offset: 0, 'stop-color': '#2e333d' }),
    s('stop', { offset: 1, 'stop-color': '#262a33' }),
  ]);
  return s('svg', { viewBox: '0 0 1024 1024', xmlns: 'http://www.w3.org/2000/svg',
                    style: 'width:100%;height:100%;display:block' }, [
    s('defs', {}, [bgGrad, sheetGrad]),
    s('rect', { width: 1024, height: 1024, rx: 224, fill: 'url(#iconB-bg)' }),
    s('rect', { x: 184, y: 216, width: 656, height: 640, rx: 56,
                fill: 'url(#iconB-sheet)', stroke: 'rgba(255,255,255,0.08)', 'stroke-width': 3 }),
    s('circle', { cx: 260, cy: 216, r: 26, fill: '#0e1014', stroke: 'rgba(255,255,255,0.12)', 'stroke-width': 3 }),
    s('circle', { cx: 512, cy: 216, r: 26, fill: '#0e1014', stroke: 'rgba(255,255,255,0.12)', 'stroke-width': 3 }),
    s('circle', { cx: 764, cy: 216, r: 26, fill: '#0e1014', stroke: 'rgba(255,255,255,0.12)', 'stroke-width': 3 }),
    s('path', { d: 'M 268 416 L 360 478 L 268 540', fill: 'none',
                stroke: accent, 'stroke-width': 44,
                'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    s('rect', { x: 404, y: 464, width: 216, height: 28, rx: 6, fill: 'rgba(255,255,255,0.85)' }),
    s('rect', { x: 268, y: 608, width: 488, height: 20, rx: 6, fill: 'rgba(255,255,255,0.32)' }),
    s('rect', { x: 268, y: 676, width: 380, height: 20, rx: 6, fill: 'rgba(255,255,255,0.22)' }),
    s('rect', { x: 268, y: 744, width: 296, height: 20, rx: 6, fill: 'rgba(255,255,255,0.14)' }),
  ]);
}

/** ────────────────────────────────────────────────────────────────────
 *  Direction C — stacked sessions (recommended).
 *  Most metaphorically aligned with the product's value prop.
 * ──────────────────────────────────────────────────────────────────── */
export function iconC(accent = '#7CA8E0'): SVGElement {
  const bgGrad = s('linearGradient', { id: 'iconC-bg', x1: 0, y1: 0, x2: 0, y2: 1 }, [
    s('stop', { offset: 0, 'stop-color': '#252a33' }),
    s('stop', { offset: 1, 'stop-color': '#15171d' }),
  ]);
  const cardGrad = s('linearGradient', { id: 'iconC-card', x1: 0, y1: 0, x2: 0, y2: 1 }, [
    s('stop', { offset: 0, 'stop-color': '#373d49' }),
    s('stop', { offset: 1, 'stop-color': '#2a2f38' }),
  ]);
  return s('svg', { viewBox: '0 0 1024 1024', xmlns: 'http://www.w3.org/2000/svg',
                    style: 'width:100%;height:100%;display:block' }, [
    s('defs', {}, [bgGrad, cardGrad]),
    s('rect', { width: 1024, height: 1024, rx: 224, fill: 'url(#iconC-bg)' }),
    // back card
    s('rect', { x: 252, y: 252, width: 600, height: 120, rx: 28, fill: '#2a2f38', opacity: 0.55 }),
    s('circle', { cx: 316, cy: 312, r: 20, fill: '#e0c477' }),
    s('rect', { x: 364, y: 298, width: 200, height: 14, rx: 5, fill: 'rgba(255,255,255,0.30)' }),
    s('rect', { x: 364, y: 326, width: 120, height: 10, rx: 4, fill: 'rgba(255,255,255,0.16)' }),
    // middle card
    s('rect', { x: 212, y: 412, width: 640, height: 120, rx: 28, fill: '#30353f', opacity: 0.85 }),
    s('circle', { cx: 276, cy: 472, r: 20, fill: '#e07a7a' }),
    s('rect', { x: 324, y: 458, width: 216, height: 14, rx: 5, fill: 'rgba(255,255,255,0.42)' }),
    s('rect', { x: 324, y: 486, width: 132, height: 10, rx: 4, fill: 'rgba(255,255,255,0.20)' }),
    // front (active) card
    s('rect', { x: 172, y: 572, width: 680, height: 200, rx: 32,
                fill: 'url(#iconC-card)', stroke: 'rgba(255,255,255,0.10)', 'stroke-width': 3 }),
    s('circle', { cx: 240, cy: 672, r: 24, fill: accent }),
    s('circle', { cx: 240, cy: 672, r: 38, fill: 'none',
                  stroke: accent, 'stroke-opacity': 0.35, 'stroke-width': 4 }),
    s('path', { d: 'M 308 644 L 364 672 L 308 700', fill: 'none',
                stroke: '#e8eaee', 'stroke-width': 22,
                'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    s('rect', { x: 396, y: 660, width: 288, height: 24, rx: 6, fill: 'rgba(255,255,255,0.78)' }),
  ]);
}

/** Render the minimize / maximize / close glyphs for the window-controls. */
export function winCtrlGlyph(kind: 'min' | 'max' | 'close'): SVGElement {
  if (kind === 'min')
    return s('svg', { width: 10, height: 10, viewBox: '0 0 10 10' }, [
      s('path', { d: 'M0 5h10', stroke: 'currentColor', 'stroke-width': 1 }),
    ]);
  if (kind === 'max')
    return s('svg', { width: 10, height: 10, viewBox: '0 0 10 10' }, [
      s('rect', { x: 0.5, y: 0.5, width: 9, height: 9, fill: 'none',
                  stroke: 'currentColor', 'stroke-width': 1 }),
    ]);
  return s('svg', { width: 10, height: 10, viewBox: '0 0 10 10' }, [
    s('path', { d: 'M0 0l10 10M10 0L0 10', stroke: 'currentColor', 'stroke-width': 1 }),
  ]);
}
