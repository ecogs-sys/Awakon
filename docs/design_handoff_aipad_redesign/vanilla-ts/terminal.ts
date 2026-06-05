// ═══════════════════════════════════════════════════════════════════════
// Awakon — Terminal pane + line renderers
//
// In production, this surface is xterm.js (or similar). The renderers here
// model what Awakon needs to layer ON TOP of the raw terminal output:
//   • detect markdown links and replace them with clickable spans
//   • detect AI-agent blocks and wrap them with the magenta left border
//   • detect tool-call prefixes and color them
//
// Use these as a template for an xterm.js decoration / matcher.
// ═══════════════════════════════════════════════════════════════════════

import { h } from './dom.ts';

// ─── Line token model ─────────────────────────────────────────────────
// A `Line` is a discriminated union — the kind tells you the structure of
// the rest of the tuple. This matches the JSX prototype's data shape so
// migrations between the two are mechanical.

export type Line =
  | { kind: 'prompt';  host: string; cmd?: string; tail?: string }
  | { kind: 'out';     text: string }
  | { kind: 'dim';     text: string }
  | { kind: 'green';   text: string }
  | { kind: 'cyan';    text: string }
  | { kind: 'yellow';  text: string }
  | { kind: 'blue';    text: string }
  | { kind: 'magenta'; text: string }
  | { kind: 'red';     text: string }
  | { kind: 'ai';      text: string }
  | { kind: 'ai-link'; prefix: string; href: string; trailing?: string; proposed?: boolean }
  | { kind: 'tool';    text: string; meta?: string }
  | { kind: 'blank' }
  | { kind: 'cursor';  prefix?: string };

// ─── Single-line render ───────────────────────────────────────────────
export function renderLine(line: Line, onMdLinkClick?: (href: string) => void): HTMLElement {
  switch (line.kind) {
    case 'prompt':
      return h('div', { class: 'aip-line' }, [
        h('span', { class: 'aip-line__prompt-host', text: line.host }),
        line.cmd  ? h('span', { class: 'aip-line__prompt-cmd', text: ' ' + line.cmd }) : null,
        line.tail ? h('span', { class: 'aip-line__prompt-tail', text: ' ' + line.tail }) : null,
      ] as any);

    case 'out':     return h('div', { class: 'aip-line', text: line.text });
    case 'dim':     return h('div', { class: 'aip-line aip-line--dim', text: line.text });
    case 'green':   return h('div', { class: 'aip-line aip-line--green', text: line.text });
    case 'cyan':    return h('div', { class: 'aip-line aip-line--cyan', text: line.text });
    case 'yellow':  return h('div', { class: 'aip-line aip-line--yellow', text: line.text });
    case 'blue':    return h('div', { class: 'aip-line aip-line--blue', text: line.text });
    case 'magenta': return h('div', { class: 'aip-line aip-line--magenta', text: line.text });
    case 'red':     return h('div', { class: 'aip-line aip-line--red', text: line.text });

    case 'ai':
      return h('div', { class: 'aip-line aip-line--ai', text: line.text });

    case 'ai-link':
      return h('div', { class: 'aip-line aip-line--ai' }, [
        h('span', { text: line.prefix }),
        h('span', {
          class: 'aip-mdlink' + (line.proposed ? ' aip-mdlink--proposed' : ''),
          text: line.href,
          attrs: { 'data-md-link': line.href },
          on: { click: () => onMdLinkClick?.(line.href) },
        }),
        line.trailing ? h('span', { class: 'aip-line__tool-meta', text: line.trailing }) : null,
      ] as any);

    case 'tool':
      return h('div', { class: 'aip-line aip-line--cyan' }, [
        h('span', { text: line.text }),
        line.meta ? h('span', { class: 'aip-line__tool-meta', text: line.meta }) : null,
      ] as any);

    case 'blank':
      return h('div', { class: 'aip-line aip-line--blank' });

    case 'cursor':
      return h('div', { class: 'aip-line' }, [
        h('span', { text: line.prefix ?? '' }),
        h('span', { class: 'aip-cursor-block' }),
      ]);
  }
}

// ─── Pane ─────────────────────────────────────────────────────────────
export interface TerminalPaneOptions {
  lines: Line[];
  /** Optional label rendered in the top-left (used by split-pane). */
  label?: string;
  /** Hide the scrollbar overlay. */
  hideScrollbar?: boolean;
  onMdLinkClick?: (href: string) => void;
}

export function renderTerminalPane({
  lines, label, hideScrollbar, onMdLinkClick,
}: TerminalPaneOptions): HTMLElement {
  return h('div', { class: 'aip-terminal' }, [
    label && h('div', { class: 'aip-pane-label', text: label }),
    h('div', { class: 'aip-terminal__body' },
      lines.map((l) => renderLine(l, onMdLinkClick))),
    !hideScrollbar && h('div', { class: 'aip-terminal__scroll' }, [
      h('div', { class: 'aip-terminal__scroll-thumb' }),
    ]),
  ]);
}

// ─── Sample line content lives in mocks.ts — keep this file focused
//     on the line model + renderer so it's easy to read.
