// ═══════════════════════════════════════════════════════════════════════
// Awakon — Status badge
// Three render styles share status data + label set.
// ═══════════════════════════════════════════════════════════════════════

import { h } from './dom.ts';
import type { BadgeStyle, Status } from './types.ts';
import { STATUSES } from './types.ts';

export interface BadgeOptions {
  status: Status;
  /** "10s", "1m 14s", etc. Omitted if undefined. */
  time?: string;
  style?: BadgeStyle;
}

export function renderStatusBadge({ status, time, style = 'pill' }: BadgeOptions): HTMLElement {
  const meta = STATUSES[status];

  if (style === 'pill') {
    return h('span', { class: 'aip-badge aip-badge--pill', attrs: { 'data-status': status } }, [
      h('span', { class: 'aip-badge__dot' }),
      meta.label,
      time !== undefined && h('span', { class: 'aip-badge__time' }, [`· ${time}`]),
    ]);
  }

  if (style === 'dot') {
    return h('span', { class: 'aip-badge aip-badge--dot', attrs: { 'data-status': status } }, [
      h('span', { class: 'aip-badge__dot' }),
      h('span', {}, [
        meta.label,
        time !== undefined && h('span', { class: 'aip-badge__time' }, [`  ·  ${time}`]),
      ]),
    ]);
  }

  // icon
  return h('span', { class: 'aip-badge aip-badge--icon', attrs: { 'data-status': status } }, [
    h('span', { class: 'aip-badge__icon' }, [meta.glyph]),
    h('span', { class: 'aip-badge__label' }, [
      meta.label,
      time !== undefined && h('span', { class: 'aip-badge__time' }, [`  ·  ${time}`]),
    ]),
  ]);
}
