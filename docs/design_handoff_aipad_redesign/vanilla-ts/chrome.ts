// ═══════════════════════════════════════════════════════════════════════
// Awakon — Chrome: TitleBar, TabBar, Sidebar
// ═══════════════════════════════════════════════════════════════════════

import { h, setClass } from './dom.ts';
import type { BadgeStyle, Session, Status, TabSpec } from './types.ts';
import { appGlyph, winCtrlGlyph } from './icons.ts';
import { renderStatusBadge } from './status-badge.ts';
import { kbd } from './platform.ts';

// ─── Window controls ───────────────────────────────────────────────────
export function renderWindowControls(opts: {
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
export interface TitleBarOptions {
  title?: string;
  subtitle?: string;
  menus?: string[];
}

export function renderTitleBar({
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
export function renderTab(tab: TabSpec, opts: { active?: boolean } = {}): HTMLElement {
  return h('div', {
    class: 'aip-tab' + (opts.active ? ' aip-tab--active' : ''),
  }, [
    h('span', { class: 'aip-dot', attrs: { 'data-status': tab.status } }),
    h('span', { class: 'aip-tab__label', text: tab.label }),
    h('span', { class: 'aip-tab__close', text: '×' }),
  ]);
}

// ─── Tab bar ──────────────────────────────────────────────────────────
export interface TabBarOptions {
  tabs: TabSpec[];
  activeIdx?: number;
  onNewTab?: () => void;
}

export function renderTabBar({ tabs, activeIdx = 0, onNewTab }: TabBarOptions): HTMLElement {
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
export interface SessionRowOptions {
  session: Session;
  active?: boolean;
  badgeStyle?: BadgeStyle;
  onClick?: (s: Session) => void;
}

export function renderSessionRow({
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
export function updateSessionRow(row: HTMLElement, session: Session, opts: {
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
export interface SidebarOptions {
  sessions: Session[];
  activeSessionId?: string | null;
  badgeStyle?: BadgeStyle;
  onSessionClick?: (s: Session) => void;
  onNewSession?: () => void;
}

export function renderSidebar({
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

// ─── Collapsed sidebar rail (~56px) ────────────────────────────────────
// Chips-only triage view, toggled with Mod+B. Each chip keeps its status
// corner-dot; hovering a chip reveals a flyout previewing name + cwd + status.
function renderCollapsedRailRow(
  session: Session, active: boolean, badgeStyle: BadgeStyle,
  onClick?: (s: Session) => void,
): HTMLElement {
  const showCorner = session.status !== 'idle';
  const s = STATUS_COLOR_VAR(session.status);
  return h('div', {
    class: 'aip-rail__row' + (active ? ' aip-rail__row--active' : ''),
    attrs: { 'data-session-id': session.id, title: session.name },
    on: { click: () => onClick?.(session) },
  }, [
    h('div', { class: 'aip-rail__chip' }, [
      session.kind,
      showCorner && h('span', {
        class: 'aip-rail__chip-corner',
        attrs: { 'data-status': session.status },
      }),
    ]),
    // hover flyout (CSS-driven visibility)
    h('div', { class: 'aip-rail__flyout' }, [
      h('div', { class: 'aip-rail__flyout-top' }, [
        h('span', { class: 'aip-rail__flyout-dot', style: { background: s } }),
        h('span', { class: 'aip-rail__flyout-name', text: session.name }),
      ]),
      h('div', { class: 'aip-rail__flyout-cwd', text: session.cwd }),
      renderStatusBadge({ status: session.status, time: session.time, style: 'pill' }),
    ]),
  ]);
}

// small helper: maps a status to its CSS color variable
function STATUS_COLOR_VAR(status: Status): string {
  return `var(--st-${status})`;
}

export interface CollapsedSidebarOptions {
  sessions: Session[];
  activeSessionId?: string | null;
  badgeStyle?: BadgeStyle;
  onSessionClick?: (s: Session) => void;
  onNewSession?: () => void;
  onExpand?: () => void;
}

export function renderCollapsedSidebar({
  sessions, activeSessionId = null, badgeStyle = 'pill',
  onSessionClick, onNewSession, onExpand,
}: CollapsedSidebarOptions): HTMLElement {
  const order: Status[] = ['awaiting', 'limited', 'running', 'idle'];
  const counts: Record<Status, number> = { running: 0, awaiting: 0, limited: 0, idle: 0 };
  for (const s of sessions) counts[s.status]++;

  return h('div', { class: 'aip-rail' }, [
    h('div', { class: 'aip-rail__header' }, [
      h('span', {
        class: 'aip-rail__expand', text: '›',
        attrs: { title: `Expand sidebar (${kbd('Mod+B')})` },
        on: { click: () => onExpand?.() },
      }),
    ]),
    // compact status summary — dot + count, non-zero only
    h('div', { class: 'aip-rail__summary' },
      order.filter((k) => counts[k] > 0).map((k) =>
        h('div', { class: 'aip-rail__summary-item', attrs: { title: `${counts[k]} ${k}` } }, [
          h('span', { class: 'aip-rail__summary-dot', style: { background: `var(--st-${k})` } }),
          h('span', { class: 'aip-rail__summary-count', text: String(counts[k]) }),
        ]))),
    h('div', { class: 'aip-rail__list' },
      sessions.map((s) => renderCollapsedRailRow(
        s, s.id === activeSessionId, badgeStyle, onSessionClick))),
    h('div', { class: 'aip-rail__footer' }, [
      h('span', {
        class: 'aip-rail__icon-btn aip-rail__icon-btn--new', text: '+',
        attrs: { title: `New session (${kbd('Mod+N')})` },
        on: { click: () => onNewSession?.() },
      }),
      h('span', {
        class: 'aip-rail__icon-btn aip-rail__icon-btn--palette', text: kbd('Mod+K'),
        attrs: { title: 'Command palette' },
      }),
    ]),
  ]);
}
