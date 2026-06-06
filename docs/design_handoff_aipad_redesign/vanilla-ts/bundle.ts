// ════════════════════════════════════════════════════════════════════════
//  Awakon — bundled vanilla TS (demo loader) — GENERATED FILE
// ════════════════════════════════════════════════════════════════════════

// ── types.ts ───────────────────
// ═══════════════════════════════════════════════════════════════════════
// Awakon — types
// ═══════════════════════════════════════════════════════════════════════

type Status = 'running' | 'awaiting' | 'limited' | 'idle';
type BadgeStyle = 'pill' | 'dot' | 'icon';

interface Session {
  id: string;
  /** 2-3 letter shell label shown in the 22×22 chip (PS, BSH, ZSH, CMD, ...) */
  kind: string;
  /** Display name — user-editable, defaults to binary */
  name: string;
  /** Tildified working directory */
  cwd: string;
  status: Status;
  /** Formatted time-in-state: "10s", "1m 14s", "47m" */
  time?: string;
}

interface TabSpec {
  label: string;
  status: Status;
}

interface RecentProject {
  name: string;
  cwd: string;
  /** Human-readable "14m ago", "yesterday" */
  when: string;
}

/** Status visual config — single source of truth for label + glyph. */
const STATUSES: Record<Status, { label: string; glyph: string }> = {
  running:  { label: 'running',        glyph: '▶' },
  awaiting: { label: 'awaiting input', glyph: '◔' },
  limited:  { label: 'rate-limited',   glyph: '◼' },
  idle:     { label: 'idle',           glyph: '○' },
};

/** Sidebar sort priority — lower = higher up in the list. */
const STATUS_PRIORITY: Record<Status, number> = {
  awaiting: 0,
  limited:  1,
  running:  2,
  idle:     3,
};

function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]);
}


// ── platform.ts ───────────────────
// ═══════════════════════════════════════════════════════════════════════
// Awakon — platform helpers
//
// One detection at startup, then all UI uses kbd('Mod+K') for both display
// and event matching. Single source of truth across the three OSes.
// ═══════════════════════════════════════════════════════════════════════

type Platform = 'mac' | 'windows' | 'linux';

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'linux';
  const p = (navigator.platform || navigator.userAgent || '').toLowerCase();
  if (p.includes('mac')) return 'mac';
  if (p.includes('win')) return 'windows';
  return 'linux';
}

const PLATFORM: Platform = detectPlatform();

/** Bare modifier symbol — '⌘' on macOS, 'Ctrl' elsewhere. */
const MOD: string = PLATFORM === 'mac' ? '⌘' : 'Ctrl';

/**
 * Format a keyboard shortcut for display. Use 'Mod' as a stand-in for
 * Cmd-or-Ctrl, and 'Shift'/'Alt'/'Enter'/'Esc' as their respective tokens.
 *
 *   kbd('Mod+K')          // → '⌘K'    on macOS · 'Ctrl+K'    elsewhere
 *   kbd('Mod+Shift+P')    // → '⌘⇧P'   on macOS · 'Ctrl+Shift+P'
 *   kbd('Mod+Enter')      // → '⌘↵'    on macOS · 'Ctrl+Enter'
 */
function kbd(combo: string): string {
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
function matchShortcut(e: KeyboardEvent, combo: string): boolean {
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


// ── dom.ts ───────────────────
// ═══════════════════════════════════════════════════════════════════════
// Awakon — DOM helpers
// Tiny utilities so the rest of the code stays focused on structure.
// ═══════════════════════════════════════════════════════════════════════

type Child = Node | string | number | null | undefined | false;

interface HProps {
  /** Space-separated class names. */
  class?: string;
  /** Text content shortcut (set last, after children). */
  text?: string;
  /** Inline style as cssText string or object. */
  style?: string | Partial<CSSStyleDeclaration>;
  /** Arbitrary attributes (data-*, aria-*, title, etc.) */
  attrs?: Record<string, string | number | boolean>;
  /** Event listeners. */
  on?: Partial<Record<keyof HTMLElementEventMap, EventListener>>;
  /** Child nodes / strings / falsy (skipped). */
  children?: Child[];
}

/** Create an HTML element with props in one call. */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: HProps = {},
  children?: Child[],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.style) {
    if (typeof props.style === 'string') el.style.cssText = props.style;
    else Object.assign(el.style, props.style);
  }
  if (props.attrs) {
    for (const [k, v] of Object.entries(props.attrs)) {
      if (v === false) continue;
      el.setAttribute(k, String(v));
    }
  }
  if (props.on) {
    for (const [k, fn] of Object.entries(props.on)) {
      if (fn) el.addEventListener(k, fn as EventListener);
    }
  }
  const kids = children ?? props.children;
  if (kids) appendChildren(el, kids);
  if (props.text !== undefined) el.textContent = props.text;
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an SVG element. Pass children as 3rd arg. */
function s(
  tag: string,
  attrs: Record<string, string | number> = {},
  children?: (SVGElement | string)[],
): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (children) {
    for (const c of children) {
      el.append(c as Node | string);
    }
  }
  return el;
}

function appendChildren(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (typeof c === 'string' || typeof c === 'number') parent.appendChild(document.createTextNode(String(c)));
    else parent.appendChild(c);
  }
}

/** Replace `parent`'s children with `children`. */
function setChildren(parent: Node, children: Child[]): void {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
  appendChildren(parent, children);
}

/** Toggle a class without the boilerplate. */
function setClass(el: Element, cls: string, on: boolean): void {
  el.classList.toggle(cls, on);
}


// ── icons.ts ───────────────────
// ═══════════════════════════════════════════════════════════════════════
// Awakon — icons (SVG factories)
// Each returns an SVGSVGElement so callers can size it via CSS.
// ═══════════════════════════════════════════════════════════════════════


/** Tiny app glyph for the titlebar (24-unit viewBox). */
function appGlyph(accent = 'var(--accent)'): SVGElement {
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
function iconA(accent = '#7CA8E0'): SVGElement {
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
function iconB(accent = '#7CA8E0'): SVGElement {
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
function iconC(accent = '#7CA8E0'): SVGElement {
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
function winCtrlGlyph(kind: 'min' | 'max' | 'close'): SVGElement {
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


// ── status-badge.ts ───────────────────
// ═══════════════════════════════════════════════════════════════════════
// Awakon — Status badge
// Three render styles share status data + label set.
// ═══════════════════════════════════════════════════════════════════════




interface BadgeOptions {
  status: Status;
  /** "10s", "1m 14s", etc. Omitted if undefined. */
  time?: string;
  style?: BadgeStyle;
}

function renderStatusBadge({ status, time, style = 'pill' }: BadgeOptions): HTMLElement {
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


// ── chrome.ts ───────────────────
// ═══════════════════════════════════════════════════════════════════════
// Awakon — Chrome: TitleBar, TabBar, Sidebar
// ═══════════════════════════════════════════════════════════════════════






// ─── Window controls ───────────────────────────────────────────────────
function renderWindowControls(opts: {
  onMinimize?: () => void;
  onMaximize?: () => void;
  onClose?: () => void;
} = {}): HTMLElement {
  return h('div', { class: 'aip-window-controls aip-no-drag' }, [
    h('div', { class: 'aip-window-control', attrs: { title: 'Minimize' },
               on: { click: () => opts.onMinimize?.() } }, [winCtrlGlyph('min')]),
    h('div', { class: 'aip-window-control', attrs: { title: 'Maximize' },
               on: { click: () => opts.onMaximize?.() } }, [winCtrlGlyph('max')]),
    h('div', { class: 'aip-window-control aip-window-control--close', attrs: { title: 'Close' },
               on: { click: () => opts.onClose?.() } }, [winCtrlGlyph('close')]),
  ]);
}

// ─── Titlebar ──────────────────────────────────────────────────────────
interface TitleBarOptions {
  title?: string;
  subtitle?: string;
  menus?: string[];
}

function renderTitleBar({
  title = 'Awakon',
  subtitle,
  menus = ['File', 'Tabs', 'View', 'Window', 'Help'],
}: TitleBarOptions = {}): HTMLElement {
  return h('div', { class: 'aip-titlebar' }, [
    h('div', { class: 'aip-titlebar__brand' }, [appGlyph()]),
    h('div', { class: 'aip-titlebar__menus aip-no-drag' },
      menus.map((m) => h('div', { class: 'aip-titlebar__menu', text: m }))),
    h('div', { class: 'aip-titlebar__title' }, [
      h('span', { class: 'aip-titlebar__title-main', text: title }),
      subtitle && h('span', { class: 'aip-titlebar__title-sub', text: `— ${subtitle}` }),
    ]),
    renderWindowControls(),
  ]);
}

// ─── Tab ───────────────────────────────────────────────────────────────
function renderTab(tab: TabSpec, opts: { active?: boolean } = {}): HTMLElement {
  return h('div', {
    class: 'aip-tab' + (opts.active ? ' aip-tab--active' : ''),
  }, [
    h('span', { class: 'aip-dot', attrs: { 'data-status': tab.status } }),
    h('span', { class: 'aip-tab__label', text: tab.label }),
    h('span', { class: 'aip-tab__close', text: '×' }),
  ]);
}

// ─── Tab bar ──────────────────────────────────────────────────────────
interface TabBarOptions {
  tabs: TabSpec[];
  activeIdx?: number;
  onNewTab?: () => void;
}

function renderTabBar({ tabs, activeIdx = 0, onNewTab }: TabBarOptions): HTMLElement {
  return h('div', { class: 'aip-tabbar' }, [
    ...tabs.map((t, i) => renderTab(t, { active: i === activeIdx })),
    h('div', {
      class: 'aip-tabbar__new',
      text: '+',
      attrs: { title: 'New tab' },
      on: { click: () => onNewTab?.() },
    }),
    h('div', { class: 'aip-tabbar__spacer' }),
  ]);
}

// ─── Status overview (4-cell strip above session list) ────────────────
function renderOverview(sessions: Session[]): HTMLElement {
  const order: Status[] = ['awaiting', 'limited', 'running', 'idle'];
  const counts: Record<Status, number> = { running: 0, awaiting: 0, limited: 0, idle: 0 };
  for (const s of sessions) counts[s.status]++;

  return h('div', { class: 'aip-overview' },
    order.map((k) => {
      const count = counts[k];
      const zero = count === 0;
      return h('div', { class: 'aip-overview__cell', attrs: { 'data-status-filter': k } }, [
        h('div', { class: 'aip-overview__cell-top' }, [
          h('span', {
            class: 'aip-overview__cell-dot' + (zero ? ' aip-overview__cell-dot--zero' : ''),
            style: { background: `var(--st-${k})` },
          }),
          h('span', {
            class: 'aip-overview__count' + (zero ? ' aip-overview__count--zero' : ''),
            text: String(count),
          }),
        ]),
        h('span', { class: 'aip-overview__label', text: k === 'awaiting' ? 'await' : k }),
      ]);
    })
  );
}

// ─── Session row ──────────────────────────────────────────────────────
interface SessionRowOptions {
  session: Session;
  active?: boolean;
  badgeStyle?: BadgeStyle;
  onClick?: (s: Session) => void;
}

function renderSessionRow({
  session, active = false, badgeStyle = 'pill', onClick,
}: SessionRowOptions): HTMLElement {
  const showCorner = session.status !== 'idle';
  return h('div', {
    class: 'aip-session-row' + (active ? ' aip-session-row--active' : ''),
    attrs: { 'data-session-id': session.id },
    on: { click: () => onClick?.(session) },
  }, [
    h('div', { class: 'aip-session-row__top' }, [
      h('div', { class: 'aip-session-row__chip' }, [
        session.kind,
        showCorner && h('span', {
          class: 'aip-session-row__chip-corner',
          attrs: { 'data-status': session.status },
        }),
      ]),
      h('span', { class: 'aip-session-row__name', text: session.name }),
    ]),
    h('div', { class: 'aip-session-row__cwd', text: session.cwd }),
    h('div', { class: 'aip-session-row__badge-row' }, [
      renderStatusBadge({ status: session.status, time: session.time, style: badgeStyle }),
    ]),
  ]);
}

/**
 * Update a session row in place — call this when status/time changes rather
 * than rebuilding the whole sidebar. Keeps the row's DOM identity so any
 * focus/hover state stays put.
 */
function updateSessionRow(row: HTMLElement, session: Session, opts: {
  active?: boolean; badgeStyle?: BadgeStyle;
} = {}): void {
  setClass(row, 'aip-session-row--active', !!opts.active);
  // Update corner dot
  const chip = row.querySelector('.aip-session-row__chip');
  let corner = row.querySelector('.aip-session-row__chip-corner');
  if (session.status === 'idle') {
    corner?.remove();
  } else {
    if (!corner) {
      corner = h('span', { class: 'aip-session-row__chip-corner' });
      chip?.appendChild(corner);
    }
    corner.setAttribute('data-status', session.status);
  }
  // Swap badge
  const badgeRow = row.querySelector('.aip-session-row__badge-row');
  if (badgeRow) {
    while (badgeRow.firstChild) badgeRow.removeChild(badgeRow.firstChild);
    badgeRow.appendChild(renderStatusBadge({
      status: session.status, time: session.time, style: opts.badgeStyle ?? 'pill',
    }));
  }
}

// ─── Sidebar ──────────────────────────────────────────────────────────
interface SidebarOptions {
  sessions: Session[];
  activeSessionId?: string | null;
  badgeStyle?: BadgeStyle;
  onSessionClick?: (s: Session) => void;
  onNewSession?: () => void;
}

function renderSidebar({
  sessions, activeSessionId = null, badgeStyle = 'pill', onSessionClick, onNewSession,
}: SidebarOptions): HTMLElement {
  return h('div', { class: 'aip-sidebar' }, [
    h('div', { class: 'aip-sidebar__header' }, [
      h('div', { class: 'aip-sidebar__header-title', text: 'Sessions' }),
      h('div', { class: 'aip-sidebar__header-actions' }, [
        h('span', { class: 'aip-sidebar__icon-btn', text: '⇅', attrs: { title: 'Sort' } }),
        h('span', { class: 'aip-sidebar__icon-btn', text: '+', attrs: { title: 'New session' },
                    on: { click: () => onNewSession?.() } }),
      ]),
    ]),
    sessions.length > 0 ? renderOverview(sessions) : null as any,
    h('div', { class: 'aip-session-list' },
      sessions.map((s) => renderSessionRow({
        session: s, active: s.id === activeSessionId, badgeStyle, onClick: onSessionClick,
      }))),
    h('div', { class: 'aip-sidebar__footer' }, [
      h('span', { text: `${kbd('Mod+K')}  palette` }),
      h('span', { class: 'aip-sidebar__footer-count', text: `${sessions.length} active` }),
    ]),
  ]);
}


// ── terminal.ts ───────────────────
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


// ─── Line token model ─────────────────────────────────────────────────
// A `Line` is a discriminated union — the kind tells you the structure of
// the rest of the tuple. This matches the JSX prototype's data shape so
// migrations between the two are mechanical.

type Line =
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
function renderLine(line: Line, onMdLinkClick?: (href: string) => void): HTMLElement {
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
interface TerminalPaneOptions {
  lines: Line[];
  /** Optional label rendered in the top-left (used by split-pane). */
  label?: string;
  /** Hide the scrollbar overlay. */
  hideScrollbar?: boolean;
  onMdLinkClick?: (href: string) => void;
}

function renderTerminalPane({
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


// ── panels.ts ───────────────────
// ═══════════════════════════════════════════════════════════════════════
// Awakon — Modals, palette, empty state, markdown preview
// ═══════════════════════════════════════════════════════════════════════






// ─── Scrim wrapper ────────────────────────────────────────────────────
function renderScrim(child: HTMLElement, onDismiss?: () => void): HTMLElement {
  return h('div', {
    class: 'aip-scrim',
    on: { click: (e) => { if (e.target === e.currentTarget) onDismiss?.(); } },
  }, [child]);
}

// ─── Settings modal · auto-resume ────────────────────────────────────
interface SettingsModalOptions {
  /** Initial values for the auto-resume rule */
  detectText?: string;
  responseText?: string;
  enabled?: boolean;
  quickAdds?: string[];
  /** Total rule count, shown in footer */
  ruleCount?: number;
  onSave?: () => void;
  onCancel?: () => void;
  onClose?: () => void;
}

function renderSettingsModal(opts: SettingsModalOptions = {}): HTMLElement {
  const {
    detectText  = "You've hit your limit",
    responseText = 'continue',
    enabled     = true,
    quickAdds   = ["You've hit your limit", 'rate limit reached', 'quota exceeded'],
    ruleCount   = 3,
    onSave, onCancel, onClose,
  } = opts;

  return h('div', { class: 'aip-modal aip-modal--settings' }, [
    h('div', { class: 'aip-modal__header' }, [
      h('div', { class: 'aip-modal__header-left' }, [
        h('span', { class: 'aip-modal__crumb', text: 'Settings' }),
        h('span', { class: 'aip-modal__crumb-dot' }),
        h('span', { class: 'aip-modal__title', text: 'Auto-resume' }),
      ]),
      h('div', { class: 'aip-modal__close', text: '×', on: { click: () => onClose?.() } }),
    ]),

    h('div', { class: 'aip-modal__section' }, [
      h('div', { style: 'display:flex;align-items:flex-start;gap:14px' }, [
        h('div', {
          class: 'aip-toggle' + (enabled ? ' aip-toggle--on' : ''),
          style: 'margin-top:2px',
        }, [h('div', { class: 'aip-toggle__knob' })]),
        h('div', { style: 'flex:1' }, [
          h('div', { style: 'font-size:13.5px;color:var(--text-1);font-weight:500;margin-bottom:3px',
                     text: 'Auto-resume rate-limited tabs' }),
          h('div', { style: 'font-size:12px;color:var(--text-3);line-height:1.5',
                     text: "When an agent hits its quota and you've set a response below, Awakon will send that response automatically once the quota refreshes." }),
        ]),
      ]),
    ]),

    h('div', { class: 'aip-modal__section' }, [
      h('div', { class: 'aip-label', text: 'Text to detect' }),
      h('div', { class: 'aip-input aip-input--focused', text: detectText }),
      h('div', { style: 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap' },
        quickAdds.map((q) => h('span', { class: 'aip-chip', text: q }))),
    ]),

    h('div', { class: 'aip-modal__section' }, [
      h('div', { class: 'aip-label', text: 'Response to send' }),
      h('div', { class: 'aip-input', text: responseText }),
    ]),

    h('div', { class: 'aip-modal__footer' }, [
      h('div', { style: 'font-family:var(--font-mono);font-size:10.5px;color:var(--text-4)',
                 text: `${ruleCount} rules configured` }),
      h('div', { style: 'display:flex;gap:8px' }, [
        h('button', { class: 'aip-btn aip-btn--ghost', text: 'Cancel',
                      on: { click: () => onCancel?.() } }),
        h('button', { class: 'aip-btn aip-btn--primary', text: 'Save',
                      on: { click: () => onSave?.() } }),
      ]),
    ]),
  ]);
}

// ─── About dialog ────────────────────────────────────────────────────
interface AboutDialogOptions {
  appName?:    string;
  tagline?:    string;
  version?:    string;
  build?:      string;
  commit?:     string;
  branch?:     string;
  electron?:   string;
  chromium?:   string;
  node?:       string;
  v8?:         string;
  os?:         string;
  copyright?:  string;
  license?:    string;
  links?:      Array<{ label: string; href?: string; onClick?: () => void }>;
  onCopyInfo?: () => void;
  onOk?:       () => void;
  onClose?:    () => void;
}

function renderAboutDialog(opts: AboutDialogOptions = {}): HTMLElement {
  const {
    appName   = 'Awakon',
    tagline   = 'Run many agents · never miss a prompt',
    version   = '1.0.0',
    build     = '2026.05.27',
    commit    = 'a3f91c2',
    branch    = 'main',
    electron  = '33.2.0',
    chromium  = '130.0.6723.44',
    node      = '20.18.0',
    v8        = '13.0.245.16',
    os        = 'Windows 11 · 23H2 (x64)',
    copyright = '© 2026 Awakon contributors',
    license   = 'Released under the MIT License',
    links     = [
      { label: 'Website' },
      { label: 'Release notes' },
      { label: 'Acknowledgements' },
      { label: 'Report an issue' },
    ],
    onCopyInfo, onOk, onClose,
  } = opts;

  const row = (key: string, ...vals: Array<HTMLElement | string>) =>
    h('div', { class: 'aip-about__row' }, [
      h('span', { class: 'aip-about__key', text: key }),
      h('span', { class: 'aip-about__val' }, vals as any),
    ]);

  return h('div', { class: 'aip-modal aip-modal--about' }, [
    h('div', { class: 'aip-modal__header' }, [
      h('span', { class: 'aip-modal__crumb', text: 'About' }),
      h('div', { class: 'aip-modal__close', text: '×', on: { click: () => onClose?.() } }),
    ]),

    h('div', { class: 'aip-about__identity' }, [
      h('div', { class: 'aip-about__icon' }, [appGlyph()]),
      h('div', { class: 'aip-about__id-text' }, [
        h('div', { class: 'aip-about__name', text: appName }),
        h('div', { class: 'aip-about__version' }, [
          `Version ${version} `,
          h('span', { class: 'aip-about__build', text: `(build ${build})` }),
        ] as any),
        h('div', { class: 'aip-about__tagline', text: tagline }),
      ]),
    ]),

    h('div', { class: 'aip-about__details' }, [
      row('Commit',   commit, h('span', { class: 'aip-about__dim', text: ` · ${branch}` })),
      row('Electron', electron),
      row('Chromium', chromium),
      row('Node',     node),
      row('V8',       v8),
      row('OS',       os),
    ]),

    h('div', { class: 'aip-about__links' },
      links.map((l) => h('a', {
        class: 'aip-about__link',
        text: l.label,
        attrs: l.href ? { href: l.href } : {},
        on:   l.onClick ? { click: () => l.onClick!() } : {},
      }))),

    h('div', { class: 'aip-modal__footer' }, [
      h('div', { class: 'aip-about__legal' }, [
        h('div', { class: 'aip-about__legal-line', text: copyright }),
        h('div', { class: 'aip-about__legal-line', text: license }),
      ]),
      h('div', { style: 'display:flex;gap:8px' }, [
        h('button', { class: 'aip-btn aip-btn--ghost',   text: 'Copy info',
                      on: { click: () => onCopyInfo?.() } }),
        h('button', { class: 'aip-btn aip-btn--primary', text: 'OK',
                      on: { click: () => onOk?.() } }),
      ]),
    ]),
  ]);
}

// ─── Command palette ─────────────────────────────────────────────────
interface PaletteItem {
  kind: string;           // 2-char chip
  name: string;
  meta?: string;
  status?: Status;
  shortcut?: string;
}
interface PaletteSection {
  title: string;
  items: PaletteItem[];
}

interface CommandPaletteOptions {
  query?: string;
  sections?: PaletteSection[];
  /** Highlighted item — pass [sectionIdx, itemIdx]. Defaults to [0, 0]. */
  activeIndex?: [number, number];
  onClose?: () => void;
}

const DEFAULT_PALETTE: PaletteSection[] = [
  { title: 'Switch to session', items: [
    { kind: 'PS', name: 'claude · refactor terminal-host', meta: '~/Awakon', status: 'awaiting', shortcut: kbd('Mod+1') },
    { kind: 'PS', name: 'codex · add e2e tests',           meta: '~/Awakon', status: 'limited',  shortcut: kbd('Mod+2') },
    { kind: 'PS', name: 'pwsh · package scripts',          meta: '~/Awakon', status: 'running',  shortcut: kbd('Mod+3') },
  ]},
  { title: 'Start session', items: [
    { kind: '+', name: 'New Claude Code session', meta: 'claude', shortcut: kbd('Mod+N') },
    { kind: '+', name: 'New Codex session',       meta: 'codex' },
    { kind: '+', name: 'New PowerShell',          meta: 'pwsh.exe' },
  ]},
  { title: 'Actions', items: [
    { kind: '⌘', name: 'Split pane right',        shortcut: kbd('Mod+D') },
    { kind: '⌘', name: 'Settings…',               shortcut: kbd('Mod+,') },
    { kind: '⌘', name: 'Toggle sidebar',          shortcut: kbd('Mod+B') },
  ]},
];

function renderCommandPalette({
  query = 'claude',
  sections = DEFAULT_PALETTE,
  activeIndex = [0, 0],
  onClose,
}: CommandPaletteOptions = {}): HTMLElement {
  let totalCount = 0;
  for (const s of sections) totalCount += s.items.length;

  return h('div', { class: 'aip-modal aip-modal--palette' }, [
    h('div', { class: 'aip-palette__search' }, [
      h('span', { class: 'aip-palette__hint', text: '⌘K' }),
      h('div', { class: 'aip-palette__query' }, [
        query,
        h('span', { class: 'aip-cursor-caret' }),
      ]),
      h('span', { class: 'aip-palette__kbd', text: 'esc',
                  on: { click: () => onClose?.() } }),
    ]),

    h('div', { class: 'aip-palette__body' },
      sections.flatMap((sec, si) => [
        h('div', { class: 'aip-palette__section-title', text: sec.title }),
        ...sec.items.map((it, ii) => {
          const active = activeIndex[0] === si && activeIndex[1] === ii;
          return h('div', {
            class: 'aip-palette__item' + (active ? ' aip-palette__item--active' : ''),
          }, [
            h('div', { class: 'aip-palette__item-kind', text: it.kind }),
            h('div', { class: 'aip-palette__item-body' }, [
              h('span', { class: 'aip-palette__item-name', text: it.name }),
              it.meta ? h('span', { class: 'aip-palette__item-meta', text: it.meta }) : null,
            ] as any),
            it.status ? renderStatusBadge({ status: it.status, style: 'pill' }) : null,
            it.shortcut ? h('span', { class: 'aip-palette__kbd', text: it.shortcut }) : null,
          ] as any);
        }),
      ])),

      h('div', { class: 'aip-palette__footer' }, [
      h('div', { class: 'aip-palette__footer-hints' }, [
        h('span', {}, [h('span', { text: '↑↓' }), ' navigate']),
        h('span', {}, [h('span', { text: '↵'  }), ' open']),
        h('span', {}, [h('span', { text: '⇥'  }), ' filter']),
      ]),
      h('span', { text: `${totalCount} results` }),
    ]),
  ]);
}

// ─── Empty state ─────────────────────────────────────────────────────

// ─── New session dialog ─────────────────────────────────────────────
//
// Opened when the user clicks "+" in the tab bar / sidebar header, or
// hits Mod+N. Pre-fills with the active session's cwd if one exists.
// First field auto-focuses; Enter triggers Start (when valid); Esc cancels.

type SessionType = 'claude' | 'codex' | 'shell';
type ShellKind   = 'pwsh' | 'cmd' | 'bash' | 'zsh' | 'git-bash';
type OpenIn      = 'tab' | 'split-right' | 'split-below';

interface NewSessionState {
  type: SessionType;
  cwd: string;
  shell: ShellKind;
  initialPrompt: string;
  openIn: OpenIn;
  name?: string;
}

interface NewSessionDialogOptions {
  /** Initial form values. */
  initial?: Partial<NewSessionState>;
  /** Recent working directories (shown as chips below the path input). */
  recentDirs?: string[];
  /** Shells available on this platform — gated by OS detection. */
  availableShells?: ShellKind[];
  onStart?:  (state: NewSessionState) => void;
  onCancel?: () => void;
  onClose?:  () => void;
}

interface SessionTypeMeta {
  id: SessionType; chip: string; title: string; desc: string; recommended?: boolean;
}

const SESSION_TYPES: SessionTypeMeta[] = [
  { id: 'claude', chip: 'CC',  title: 'Claude Code', desc: 'Anthropic\u2019s AI pair programmer', recommended: true },
  { id: 'codex',  chip: 'CX',  title: 'Codex CLI',   desc: 'OpenAI coding assistant' },
  { id: 'shell',  chip: 'PS',  title: 'Shell only',  desc: 'pwsh / bash / cmd' },
];

const SHELL_LABELS: Record<ShellKind, string> = {
  'pwsh':     'pwsh.exe',
  'cmd':      'cmd.exe',
  'bash':     'bash',
  'zsh':      'zsh',
  'git-bash': 'git-bash',
};

const OPEN_IN_OPTIONS: Array<{ id: OpenIn; label: string }> = [
  { id: 'tab',          label: 'New tab' },
  { id: 'split-right',  label: 'Split right' },
  { id: 'split-below',  label: 'Split below' },
];

function renderNewSessionDialog(opts: NewSessionDialogOptions = {}): HTMLElement {
  const {
    initial = {},
    recentDirs = ['~/Work/ecogs/projects/Awakon', '~/Work/web-app', '~/personal/cli-tools'],
    availableShells = ['pwsh', 'cmd', 'git-bash'],
    onStart, onCancel, onClose,
  } = opts;

  // Mutable local state. In production this hooks into your store; here we
  // just re-render relevant sections on change.
  const state: NewSessionState = {
    type:          initial.type          ?? 'claude',
    cwd:           initial.cwd           ?? recentDirs[0] ?? '~',
    shell:         initial.shell         ?? availableShells[0],
    initialPrompt: initial.initialPrompt ?? '',
    openIn:        initial.openIn        ?? 'tab',
    name:          initial.name,
  };

  // ─── Section renderers (each rebuilds its own subtree on change) ──

  const typePicker = h('div', { class: 'aip-segmented' });
  function renderTypeSection(): void {
    setChildren(typePicker, SESSION_TYPES.map((t) => {
      const active = state.type === t.id;
      return h('div', {
        class: 'aip-seg' + (active ? ' aip-seg--active' : ''),
        on: { click: () => { state.type = t.id; renderTypeSection(); promptVisibility(); } },
      }, [
        h('div', { class: 'aip-seg__head' }, [
          h('span', { class: 'aip-seg__glyph', text: t.chip }),
          h('span', { class: 'aip-seg__title', text: t.title }),
          t.recommended ? h('span', { class: 'aip-seg__recommended', text: 'Recommended' }) : null,
        ] as any),
        h('div', { class: 'aip-seg__desc', text: t.desc }),
      ]);
    }));
  }
  renderTypeSection();

  // Working directory (path + Browse + recents)
  const cwdField = h('div', { class: 'aip-path-input__field' });
  function renderCwd(): void {
    const idx = state.cwd.lastIndexOf('/');
    const head = idx >= 0 ? state.cwd.slice(0, idx + 1) : '';
    const tail = idx >= 0 ? state.cwd.slice(idx + 1)    : state.cwd;
    setChildren(cwdField, [
      head ? h('span', { class: 'dim', text: head }) : null,
      tail || '~',
    ] as any);
  }
  renderCwd();

  const recentsRow = h('div', { class: 'aip-recents-row' });
  function renderRecents(): void {
    setChildren(recentsRow, recentDirs.map((d) => h('span', {
      class: 'aip-chip',
      text: d,
      on: { click: () => { state.cwd = d; renderCwd(); } },
    })));
  }
  renderRecents();

  // Shell radio row
  const shellRow = h('div', { class: 'aip-radio-row' });
  function renderShellRow(): void {
    setChildren(shellRow, availableShells.map((sh) => {
      const active = state.shell === sh;
      return h('div', {
        class: 'aip-radio' + (active ? ' aip-radio--active' : ''),
        on: { click: () => { state.shell = sh; renderShellRow(); } },
      }, [
        h('span', { class: 'aip-radio__dot' }),
        h('span', { text: SHELL_LABELS[sh] }),
      ]);
    }));
  }
  renderShellRow();

  // Initial prompt textarea (only shown for AI agent types)
  const promptSection = h('div', { class: 'aip-modal__section' });
  function promptVisibility(): void {
    const visible = state.type === 'claude' || state.type === 'codex';
    promptSection.style.display = visible ? '' : 'none';
  }
  setChildren(promptSection, [
    h('div', { class: 'aip-section-header' }, [
      h('div', { class: 'aip-label', text: 'Initial prompt' }),
      h('span', { class: 'aip-section-header__aside', text: 'optional · sent on start' }),
    ]),
    h('div', { class: 'aip-textarea aip-input--focused' }, [
      h('span', { class: 'aip-textarea__placeholder',
                   text: 'e.g. refactor the IPC layer in terminal-host to use MessagePort' }),
    ]),
  ]);
  promptVisibility();

  // Open-in radio row
  const openInRow = h('div', { class: 'aip-radio-row' });
  function renderOpenInRow(): void {
    setChildren(openInRow, OPEN_IN_OPTIONS.map((opt) => {
      const active = state.openIn === opt.id;
      return h('div', {
        class: 'aip-radio' + (active ? ' aip-radio--active' : ''),
        on: { click: () => { state.openIn = opt.id; renderOpenInRow(); } },
      }, [
        h('span', { class: 'aip-radio__dot' }),
        h('span', { text: opt.label }),
      ]);
    }));
  }
  renderOpenInRow();

  // ─── Assemble ─────────────────────────────────────────────────────
  const body = h('div', { class: 'aip-modal__body' }, [

    // Type
    h('div', { class: 'aip-modal__section' }, [
      h('div', { class: 'aip-label', text: 'Type' }),
      typePicker,
    ]),

    // Working directory
    h('div', { class: 'aip-modal__section' }, [
      h('div', { class: 'aip-label', text: 'Working directory' }),
      h('div', { class: 'aip-path-input' }, [
        cwdField,
        h('div', { class: 'aip-path-input__browse' }, [
          h('span', { text: '🗁' }),
          h('span', { text: 'Browse\u2026' }),
        ]),
      ]),
      recentsRow,
    ]),

    // Shell
    h('div', { class: 'aip-modal__section' }, [
      h('div', { class: 'aip-label', text: 'Shell' }),
      shellRow,
    ]),

    // Initial prompt (conditionally visible)
    promptSection,

    // Open in
    h('div', { class: 'aip-modal__section' }, [
      h('div', { class: 'aip-label', text: 'Open in' }),
      openInRow,
    ]),
  ]);

  return h('div', { class: 'aip-modal aip-modal--newsession' }, [

    // Header
    h('div', { class: 'aip-modal__header' }, [
      h('div', { class: 'aip-modal__header-left' }, [
        h('span', { class: 'aip-modal__crumb', text: 'New session' }),
        h('span', { class: 'aip-modal__crumb-dot' }),
        h('span', { class: 'aip-modal__title', text: 'Configure' }),
      ]),
      h('div', { class: 'aip-modal__close', text: '×', on: { click: () => onClose?.() } }),
    ]),

    body,

    // Footer
    h('div', { class: 'aip-modal__footer' }, [
      h('div', { style: 'font-family:var(--font-mono);font-size:10.5px;color:var(--text-4)',
                 text: 'Press Enter to start  ·  Esc to cancel' }),
      h('div', { style: 'display:flex;gap:8px' }, [
        h('button', { class: 'aip-btn aip-btn--ghost',   text: 'Cancel',
                      on: { click: () => onCancel?.() } }),
        h('button', { class: 'aip-btn aip-btn--primary', text: 'Start session',
                      on: { click: () => onStart?.(state) } }),
      ]),
    ]),
  ]);
}

// ─── Empty state ─────────────────────────────────────────────────────
interface EmptyStateOptions {
  recents?: RecentProject[];
  onNew?: () => void;
  onResume?: () => void;
  onPickRecent?: (r: RecentProject) => void;
}

const DEFAULT_RECENTS: RecentProject[] = [
  { name: 'Awakon · refactor', cwd: '~/Work/ecogs/projects/Awakon', when: '14m ago' },
  { name: 'web-app · billing', cwd: '~/Work/web-app',               when: 'yesterday' },
  { name: 'cli-tools',         cwd: '~/personal/cli-tools',         when: '3 days ago' },
];

function renderEmptyState({
  recents = DEFAULT_RECENTS, onNew, onResume, onPickRecent,
}: EmptyStateOptions = {}): HTMLElement {
  const card = (cfg: {
    primary?: boolean; title: string; meta: string; kbd: string; onClick?: () => void;
  }) => h('div', {
    class: 'aip-empty__card' + (cfg.primary ? ' aip-empty__card--primary' : ''),
    on: { click: () => cfg.onClick?.() },
  }, [
    h('div', { class: 'aip-empty__card-title', text: cfg.title }),
    h('div', { class: 'aip-empty__card-meta',  text: cfg.meta }),
    h('div', { class: 'aip-empty__card-foot' }, [
      h('span', { class: 'aip-empty__card-kbd',   text: cfg.kbd }),
      h('span', { class: 'aip-empty__card-arrow', text: '→' }),
    ]),
  ]);

  return h('div', { class: 'aip-empty' }, [
    h('div', { class: 'aip-empty__inner' }, [
      h('div', { class: 'aip-empty__brand' }, [
        h('div', { class: 'aip-empty__brand-icon' }, [appGlyph()]),
        h('div', {}, [
          h('div', { class: 'aip-empty__brand-title', text: 'Awakon' }),
          h('div', { class: 'aip-empty__brand-sub',   text: 'run many agents · never miss a prompt' }),
        ]),
      ]),
      h('div', { class: 'aip-empty__cards' }, [
        card({ primary: true, title: 'New session', meta: 'claude · codex · pwsh', kbd: kbd('Mod+N'), onClick: onNew }),
        card({                title: 'Resume',      meta: '3 sessions from last time', kbd: kbd('Mod+R'), onClick: onResume }),
      ]),
      h('div', { class: 'aip-empty__recents' }, [
        h('div', { class: 'aip-empty__recents-title', text: 'Recent' }),
        ...recents.map((r) => h('div', {
          class: 'aip-empty__recent',
          on: { click: () => onPickRecent?.(r) },
        }, [
          h('span', { class: 'aip-empty__recent-chip', text: 'PS' }),
          h('span', { class: 'aip-empty__recent-name', text: r.name }),
          h('span', { class: 'aip-empty__recent-cwd',  text: r.cwd }),
          h('span', { class: 'aip-empty__recent-when', text: r.when }),
        ])),
      ]),
    ]),
  ]);
}

// ─── Markdown preview pane (sliding right) ───────────────────────────
interface MdFile {
  name: string;
  path: string;
  active?: boolean;
  modified?: string;
}

interface MdPaneOptions {
  files: MdFile[];
  activePath: string;
  modifiedAgo?: string;
  loc?: number;
  sizeKb?: number;
  /** Slot for the rendered markdown body — call your MD renderer and pass the result. */
  body?: HTMLElement;
  onClose?: () => void;
  onPickFile?: (path: string) => void;
}

function renderMdPane({
  files, activePath, modifiedAgo = '2m ago', loc = 342, sizeKb = 6,
  body, onClose, onPickFile,
}: MdPaneOptions): HTMLElement {
  return h('div', { class: 'aip-mdpane' }, [
    // Mini tab strip
    h('div', { class: 'aip-mdpane__tabs' }, [
      ...files.map((f) => {
        const active = f.path === activePath;
        return h('div', {
          class: 'aip-mdpane__tab' + (active ? ' aip-mdpane__tab--active' : ''),
          on: { click: () => onPickFile?.(f.path) },
        }, [
          h('span', { class: 'aip-mdpane__tab-icon', text: 'M↓' }),
          h('span', { class: 'aip-mdpane__tab-name', text: f.name }),
          h('span', { class: 'aip-mdpane__tab-close', text: '×' }),
        ]);
      }),
      h('div', { class: 'aip-mdpane__tabs-spacer' }),
      h('div', {
        class: 'aip-mdpane__close-all',
        text: '×',
        attrs: { title: 'Close pane' },
        on: { click: () => onClose?.() },
      }),
    ]),

    // Path bar + actions
    h('div', { class: 'aip-mdpane__pathbar' }, [
      h('span', { class: 'aip-mdpane__path' }, [
        h('span', { class: 'aip-mdpane__path-dir', text: '~/Awakon/' }),
        activePath,
      ]),
      h('span', { class: 'aip-mdpane__path-meta', text: `modified ${modifiedAgo}` }),
      h('div', { style: 'display:flex;gap:4px' }, [
        h('span', { class: 'aip-mdpane__action', text: '↗', attrs: { title: 'Open in editor' } }),
        h('span', { class: 'aip-mdpane__action', text: '⎘', attrs: { title: 'Copy path' } }),
      ]),
    ]),

    // Body (caller provides the rendered markdown)
    h('div', { class: 'aip-mdpane__body' }, body ? [body] : [renderSampleMdBody()]),

    // Footer
    h('div', { class: 'aip-mdpane__footer' }, [
      h('div', { class: 'aip-mdpane__footer-hints' }, [
        h('span', {}, [h('span', { text: 'esc'         }), ' close']),
        h('span', {}, [h('span', { text: kbd('Mod+[')  }), ' prev file']),
        h('span', {}, [h('span', { text: kbd('Mod+]')  }), ' next file']),
      ]),
      h('span', { text: `${loc} LOC · ${sizeKb} KB` }),
    ]),
  ]);
}

/** Sample markdown body — production code would feed a real parsed AST in. */
function renderSampleMdBody(): HTMLElement {
  return h('div', {}, [
    h('h1', { text: 'Migration plan: terminal-host' }),
    h('p', {}, [
      'Move the per-session IPC from a single ',
      h('code', { text: 'EventEmitter' }),
      ' to a typed ',
      h('code', { text: 'MessagePort' }),
      ' bus. The change is wire-compatible with existing sessions.',
    ]),
    h('h2', { text: 'Why' }),
    h('ul', {}, [
      h('li', { text: 'Stronger types at the transport boundary' }),
      h('li', { text: 'Backpressure-aware by default' }),
      h('li', { text: 'Survives renderer reload via transferable ports' }),
    ]),
    h('h2', { text: 'Steps' }),
    h('ol', {}, [
      h('li', {}, ['Add ', h('code', { text: 'MessagePortHost' }), ' in ',
                    h('code', { text: 'terminal-host/src/transport/' })]),
      h('li', { text: 'Wrap existing handlers with a compatibility adapter' }),
      h('li', { text: 'Migrate one channel at a time, behind a feature flag' }),
      h('li', { text: 'Remove the legacy emitter and adapter' }),
    ]),
    h('pre', { text:
`class MessagePortHost {
  constructor(public port: MessagePort) {
    port.onmessage = (e) => this.dispatch(e.data);
  }
  send<T>(channel: string, payload: T) {
    this.port.postMessage({ channel, payload });
  }
}` }),
  ]);
}


// ── context-menu.ts ───────────────────
// ═══════════════════════════════════════════════════════════════════════
// Awakon — Context menu (right-click)
//
// Generic component used for:
//   • terminal area: copy / paste / select-all / find / clear / split / close
//   • tab right-click: rename / duplicate / move to new window / close
//   • session row right-click: same as tab
//   • md pane link right-click: copy path / open in editor / reveal in finder
//
// Mount one menu at a time; clicking outside or pressing Esc dismisses it.
// ═══════════════════════════════════════════════════════════════════════



interface ContextMenuItem {
  /** Item label. Required. */
  label: string;
  /** Shortcut in 'Mod+C' format — auto-translates to ⌘C / Ctrl+C. */
  shortcut?: string;
  /** Optional 1-char glyph (mono) shown on the left. */
  icon?: string;
  disabled?: boolean;
  /** Styles the item in red — use for destructive actions like Close pane. */
  danger?: boolean;
  /** Called when activated (click / Enter). The menu auto-closes afterward. */
  onClick?: () => void;
  /** Used by the parent context-menu controller for keyboard nav. */
  id?: string;
}

/** Pass a `null` between items to insert a separator line. */
type ContextMenuSection = (ContextMenuItem | null)[];

interface ContextMenuOptions {
  /** Menu items, optionally with nulls as separators. */
  items: ContextMenuSection;
  /** Pixel coords of the click. Auto-flipped if it would go off-screen. */
  x: number;
  y: number;
  /** Called when the menu dismisses (outside click, Esc, item activation). */
  onClose?: () => void;
}

/**
 * Render a context menu and mount it to `document.body`. Returns the menu
 * element; the caller can keep a handle but typically just relies on the
 * auto-dismiss behavior.
 *
 * Auto-handles:
 *   • outside-click dismissal (via an invisible backdrop layer)
 *   • Esc dismissal
 *   • arrow-key navigation between enabled items
 *   • viewport flipping if click is near the edge
 *
 * Production note: in Electron, you can also use the native Menu API
 * (electron.Menu.buildFromTemplate) for a more native feel — but you lose
 * theming. We use a custom menu because matching the rest of the dark UI
 * is more important than native consistency in a developer tool.
 */
function showContextMenu({ items, x, y, onClose }: ContextMenuOptions): HTMLElement {
  // Filter to keep nulls (separators) but track real items for keyboard nav
  const realItems = items.filter((i): i is ContextMenuItem => i !== null);
  const enabledIndices: number[] = [];
  realItems.forEach((it, i) => { if (!it.disabled) enabledIndices.push(i); });
  let activeIdx = enabledIndices[0] ?? 0;

  const backdrop = h('div', { class: 'aip-ctx-backdrop' });
  const menu = h('div', { class: 'aip-ctx-menu' });

  function close(): void {
    backdrop.remove();
    menu.remove();
    window.removeEventListener('keydown', onKey, true);
    onClose?.();
  }

  function activate(it: ContextMenuItem): void {
    if (it.disabled) return;
    close();
    it.onClick?.();
  }

  function renderItems(): void {
    let realIdx = 0;
    setChildren(menu, items.map((it) => {
      if (it === null) return h('div', { class: 'aip-ctx-menu__sep' });
      const i = realIdx++;
      const cls = ['aip-ctx-menu__item'];
      if (it.disabled)             cls.push('aip-ctx-menu__item--disabled');
      if (it.danger)               cls.push('aip-ctx-menu__item--danger');
      if (i === activeIdx && !it.disabled) cls.push('aip-ctx-menu__item--active');
      return h('div', {
        class: cls.join(' '),
        on: {
          click: () => activate(it),
          mouseenter: () => { if (!it.disabled) { activeIdx = i; renderItems(); } },
        },
      }, [
        h('span', { class: 'aip-ctx-menu__icon', text: it.icon ?? '' }),
        h('span', { class: 'aip-ctx-menu__label', text: it.label }),
        it.shortcut ? h('span', { class: 'aip-ctx-menu__kbd', text: kbd(it.shortcut) }) : null,
      ] as any);
    }));
  }
  renderItems();

  // Position — measure after mount so we can flip if needed.
  document.body.append(backdrop, menu);
  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const px = (x + rect.width  > vw - 8) ? Math.max(8, x - rect.width)  : x;
  const py = (y + rect.height > vh - 8) ? Math.max(8, y - rect.height) : y;
  menu.style.left = px + 'px';
  menu.style.top  = py + 'px';

  // Outside click closes.
  backdrop.addEventListener('mousedown', close);
  backdrop.addEventListener('contextmenu', (e) => { e.preventDefault(); close(); });

  // Keyboard.
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Enter')  {
      e.preventDefault();
      activate(realItems[activeIdx]);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const pos = enabledIndices.indexOf(activeIdx);
      const next = enabledIndices[(pos + dir + enabledIndices.length) % enabledIndices.length];
      activeIdx = next;
      renderItems();
    }
  }
  window.addEventListener('keydown', onKey, true);

  return menu;
}

// ─── Pre-built menu builders ────────────────────────────────────────
// These match the design spec. Wire your real callbacks in production.

interface TerminalMenuOptions {
  /** True when text is selected in the terminal — gates Copy. */
  hasSelection: boolean;
  /** True when there's text on the clipboard — gates Paste. */
  hasClipboard: boolean;
  /** True when this pane is part of a split (enables Close pane). */
  inSplit: boolean;
  onCopy?:        () => void;
  onPaste?:       () => void;
  onSelectAll?:   () => void;
  onClear?:       () => void;
  onFind?:        () => void;
  onSplitRight?:  () => void;
  onSplitBelow?:  () => void;
  onClosePane?:   () => void;
}

function buildTerminalContextMenu(opts: TerminalMenuOptions): ContextMenuSection {
  return [
    { label: 'Copy',        shortcut: 'Mod+C', icon: '⎘', disabled: !opts.hasSelection, onClick: opts.onCopy },
    { label: 'Paste',       shortcut: 'Mod+V', icon: '⎙', disabled: !opts.hasClipboard, onClick: opts.onPaste },
    { label: 'Select all',  shortcut: 'Mod+A',            onClick: opts.onSelectAll },
    null,
    { label: 'Find\u2026',  shortcut: 'Mod+F', icon: '⌕', onClick: opts.onFind },
    { label: 'Clear',       shortcut: 'Mod+L', icon: '⌫', onClick: opts.onClear },
    null,
    { label: 'Split right', shortcut: 'Mod+D',            onClick: opts.onSplitRight },
    { label: 'Split below', shortcut: 'Mod+Shift+D',      onClick: opts.onSplitBelow },
    null,
    { label: 'Close pane',  shortcut: 'Mod+W', icon: '×', danger: true, onClick: opts.onClosePane,
      disabled: !opts.inSplit },
  ];
}

interface TabMenuOptions {
  isAwaiting: boolean;
  onRename?:           () => void;
  onDuplicate?:        () => void;
  onMoveToNewWindow?:  () => void;
  onCloseOthers?:      () => void;
  onClose?:            () => void;
}

function buildTabContextMenu(opts: TabMenuOptions): ContextMenuSection {
  return [
    { label: 'Rename\u2026',          shortcut: 'F2',   onClick: opts.onRename },
    { label: 'Duplicate',             shortcut: 'Mod+Shift+D', onClick: opts.onDuplicate },
    { label: 'Move to new window',                       onClick: opts.onMoveToNewWindow },
    null,
    { label: 'Close other tabs',                         onClick: opts.onCloseOthers },
    { label: 'Close',                 shortcut: 'Mod+W', danger: true, onClick: opts.onClose },
  ];
}


// ── mocks.ts ───────────────────
// ═══════════════════════════════════════════════════════════════════════
// Awakon — sample data (mocks)
//
// All fixture data used by demo.html lives here. Real production code
// will populate these shapes from your session store / PTY stream / etc.
// Use this file to:
//   • see what each component expects in its props
//   • copy a starter shape for your real data
//   • run the demo without touching anything else
// ═══════════════════════════════════════════════════════════════════════




// ─── Sessions ────────────────────────────────────────────────────────
// One-session state (Main screen)
const SESSIONS_SOLO: Session[] = [
  { id: 'a', kind: 'PS', name: 'pwsh.exe',
    cwd: '~/Work/ecogs/projects/Awakon', status: 'running', time: '3s' },
];

// Multi-session state (Multi / Split / Settings / Palette / Markdown / NewSession)
// Status mix is intentional — one of each so the sidebar overview cells
// always show non-zero counts.
const SESSIONS_MULTI: Session[] = [
  { id: 'a', kind: 'PS', name: 'claude · refactor',
    cwd: '~/Work/ecogs/projects/Awakon', status: 'awaiting', time: '1m 14s' },
  { id: 'b', kind: 'PS', name: 'codex · tests',
    cwd: '~/Work/ecogs/projects/Awakon', status: 'limited',  time: '47m' },
  { id: 'c', kind: 'PS', name: 'pwsh.exe',
    cwd: '~/Work/ecogs/projects/Awakon', status: 'running',  time: '10s' },
  { id: 'd', kind: 'PS', name: 'pwsh.exe',
    cwd: '~/Work/ecogs/projects/Awakon', status: 'idle',     time: '4m' },
];

// ─── Tab bar ─────────────────────────────────────────────────────────
const TABS_SOLO: TabSpec[] = [
  { label: 'pwsh.exe', status: 'running' },
];

const TABS_MULTI: TabSpec[] = [
  { label: 'claude · refactor', status: 'awaiting' },
  { label: 'codex · tests',     status: 'limited' },
  { label: 'pwsh.exe',          status: 'running' },
  { label: 'pwsh.exe',          status: 'idle' },
];

// ─── Empty state · recents ──────────────────────────────────────────
const RECENT_PROJECTS: RecentProject[] = [
  { name: 'Awakon · refactor', cwd: '~/Work/ecogs/projects/Awakon', when: '14m ago' },
  { name: 'web-app · billing', cwd: '~/Work/web-app',               when: 'yesterday' },
  { name: 'cli-tools',         cwd: '~/personal/cli-tools',         when: '3 days ago' },
];

// ─── New session dialog · recent CWDs ────────────────────────────────
const NEW_SESSION_RECENT_DIRS: string[] = [
  '~/Work/ecogs/projects/Awakon',
  '~/Work/web-app',
  '~/personal/cli-tools',
];

// ─── Markdown pane · files referenced by an agent ───────────────────
const MD_FILES: MdFile[] = [
  { name: 'migration.md',   path: 'docs/migration.md',   active: true,  modified: '2m ago' },
  { name: 'api-changes.md', path: 'docs/api-changes.md',                modified: '2m ago' },
  { name: 'README.md',      path: 'README.md',                          modified: '2m ago' },
];

// ─── Terminal scrollback — sample states ────────────────────────────
// These mirror the four states the design covers. In production these
// come from the live PTY stream; here they're hand-authored to exercise
// every Line variant (prompt, ai, tool, ai-link, cursor, blank, …).

const TERM_DEFAULT: Line[] = [
  { kind: 'prompt', host: 'PS C:\\Work\\ecogs\\projects\\Awakon>', cmd: 'Get-ChildItem packages', tail: '| Select-Object Name' },
  { kind: 'blank' },
  { kind: 'green', text: 'Name' },
  { kind: 'dim',   text: '----' },
  { kind: 'out',   text: 'contracts' },
  { kind: 'out',   text: 'core' },
  { kind: 'out',   text: 'keymap' },
  { kind: 'out',   text: 'terminal-host' },
  { kind: 'blank' },
  { kind: 'prompt', host: 'PS C:\\Work\\ecogs\\projects\\Awakon>', cmd: 'claude', tail: '--continue' },
  { kind: 'blank' },
  { kind: 'ai', text: '▎ Welcome back. Resuming session #4128.' },
  { kind: 'ai', text: '▎' },
  { kind: 'ai', text: '▎ Last task: refactor terminal-host IPC layer' },
  { kind: 'ai', text: '▎ Files modified: 6 · Tests passing: 24/24' },
  { kind: 'blank' },
  { kind: 'tool', text: '⏵ read packages/terminal-host/src/ipc.ts', meta: '320 lines' },
  { kind: 'tool', text: '⏵ read packages/terminal-host/src/pty.ts', meta: '186 lines' },
  { kind: 'tool', text: '⏵ grep "EventEmitter" in src/',            meta: '4 matches' },
  { kind: 'blank' },
  { kind: 'ai', text: '▎ The IPC layer still routes via a single EventEmitter — I can' },
  { kind: 'ai', text: '▎ swap it for a typed MessagePort bus. Estimated diff: ~140 LOC.' },
  { kind: 'blank' },
  { kind: 'yellow', text: '? Proceed with the refactor?  [y/n/show plan]' },
  { kind: 'cursor', prefix: '› ' },
];

const TERM_AWAITING: Line[] = [
  { kind: 'prompt', host: 'PS C:\\Work\\ecogs\\projects\\Awakon>', cmd: 'codex' },
  { kind: 'blank' },
  { kind: 'ai', text: '▎ codex-cli v0.4.2' },
  { kind: 'blank' },
  { kind: 'tool', text: '⏵ analyze package structure',   meta: 'done' },
  { kind: 'tool', text: '⏵ generate test scaffolding',   meta: 'pending approval' },
  { kind: 'blank' },
  { kind: 'ai', text: '▎ I want to create 14 new test files across 3 packages.' },
  { kind: 'ai', text: "▎ Files will be added under each package's tests/ directory." },
  { kind: 'blank' },
  { kind: 'yellow', text: '? Approve file creation?' },
  { kind: 'dim',    text: '   [a]pprove all   [r]eject   [d]iff' },
  { kind: 'cursor', prefix: '› ' },
];

const TERM_LIMITED: Line[] = [
  { kind: 'prompt', host: 'PS C:\\Work>', cmd: 'claude', tail: 'plan' },
  { kind: 'blank' },
  { kind: 'ai', text: '▎ Working on your task...' },
  { kind: 'blank' },
  { kind: 'tool', text: '⏵ read 8 files',         meta: 'done' },
  { kind: 'tool', text: '⏵ draft refactor plan',  meta: 'in progress' },
  { kind: 'blank' },
  { kind: 'red', text: "⚠ You've hit your usage limit." },
  { kind: 'dim', text: '  Quota resets in 47 minutes.' },
  { kind: 'blank' },
  { kind: 'dim', text: '  Awakon will auto-resume when quota refreshes.' },
  { kind: 'dim', text: '  Press [c] to continue manually  ·  [q] to quit' },
  { kind: 'cursor' },
];

const TERM_WITH_MD_LINKS: Line[] = [
  { kind: 'prompt', host: 'PS C:\\Work\\ecogs\\projects\\Awakon>', cmd: 'claude', tail: 'plan' },
  { kind: 'blank' },
  { kind: 'ai', text: "▎ I've drafted the migration plan and the API change spec." },
  { kind: 'ai', text: '▎ Please review:' },
  { kind: 'ai', text: '▎' },
  { kind: 'ai-link', prefix: '▎   → ', href: 'docs/migration.md',   trailing: '' },
  { kind: 'ai-link', prefix: '▎   → ', href: 'docs/api-changes.md', trailing: ' (proposed)', proposed: true },
  { kind: 'ai-link', prefix: '▎   → ', href: 'README.md',           trailing: ' (updated install steps)' },
  { kind: 'ai', text: '▎' },
  { kind: 'ai', text: '▎ The migration covers all four packages and preserves' },
  { kind: 'ai', text: '▎ wire-compatibility with existing sessions. Estimated diff:' },
  { kind: 'ai', text: '▎ ~340 LOC across 12 files.' },
  { kind: 'blank' },
  { kind: 'yellow', text: '? Approve plan and proceed with implementation?' },
  { kind: 'dim',    text: '   [y]es   [n]o   [d]iff plan   [e]dit plan' },
  { kind: 'cursor', prefix: '› ' },
];

