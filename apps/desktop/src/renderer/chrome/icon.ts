/**
 * Awakon brand mark — the "aperture".
 *
 * An open accent ring (awareness / an agent coming awake) wrapping an upward
 * caret (the prompt, rising). Geometric only, so it scales clean at every size.
 * Mirrors AwakonMark() in the design handoff (awakon-shared.jsx).
 *
 * Colors reference the theme tokens (var(--accent), var(--bg-2), var(--text-1))
 * so the mark re-skins automatically with the palette. `tile: false` draws just
 * the ring + caret for callers that supply their own container/background.
 */

const R = 27;
const CIRC = 2 * Math.PI * R; // ≈ 169.6
const GAP = CIRC * 0.2; // notch at the top
const DASH = CIRC - GAP;

let gradSeq = 0;

export interface MarkOptions {
  /** Draw the rounded background tile + inner hairline. Default true. */
  tile?: boolean;
}

/** SVG markup string for the aperture mark, sized to `size` px. */
export function awakonMarkMarkup(size: number, opts: MarkOptions = {}): string {
  const tile = opts.tile ?? true;
  const gid = `awk-tile-${(gradSeq += 1)}`;
  const tileMarkup = tile
    ? `<defs>
         <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
           <stop offset="0" stop-color="rgba(255,255,255,0.09)"/>
           <stop offset="1" stop-color="rgba(255,255,255,0)"/>
         </linearGradient>
       </defs>
       <rect width="100" height="100" rx="24" fill="var(--bg-2)"/>
       <rect width="100" height="100" rx="24" fill="url(#${gid})"/>
       <rect x="0.75" y="0.75" width="98.5" height="98.5" rx="23.5" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>`
    : '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="display:block">
    ${tileMarkup}
    <circle cx="50" cy="50" r="${R}" fill="none" stroke="var(--accent)" stroke-width="8"
            stroke-linecap="round" stroke-dasharray="${DASH.toFixed(2)} ${GAP.toFixed(2)}"
            transform="rotate(-72 50 50)"/>
    <path d="M39 56 L50 45 L61 56" fill="none" stroke="var(--text-1)" stroke-width="7.5"
          stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/** Build the aperture mark as a live SVG element (for appendChild callers). */
export function renderAwakonMark(size: number, opts: MarkOptions = {}): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = awakonMarkMarkup(size, opts).trim();
  return tpl.content.firstElementChild as SVGSVGElement;
}
