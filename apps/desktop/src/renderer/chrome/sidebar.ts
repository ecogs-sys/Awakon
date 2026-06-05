import type { SessionId, SessionInfo } from '@awakon/contracts';

export interface SidebarRowVm {
  info: SessionInfo;
  attention: boolean;
  /** Time the session entered its current status, in epoch ms. */
  statusSinceMs: number;
  /** Epoch ms a pending auto-resume will fire, or null when none is scheduled. */
  resumeAt: number | null;
}

export interface SidebarCallbacks {
  onRowClick: (sessionId: SessionId) => void;
  onToggle: () => void;
  /** Opens the rename modal; the LayoutManager owns the dialog + IPC. */
  onRename: (sessionId: SessionId) => void;
  onDuplicate: (sessionId: SessionId) => void;
  /** Restart an exited tab (fresh shell) or a crashed tab (fresh renderer). */
  onRestart: (sessionId: SessionId) => void;
  onClose: (sessionId: SessionId) => void;
  /** Cancel a pending auto-resume for the session. */
  onResumeCancel: (sessionId: SessionId) => void;
  /** New-session button in the sidebar header. */
  onNewSession: () => void;
}

/** Visual status bucket used by the sidebar (collapses the contracts enum + resumeAt). */
type VisualStatus = 'awaiting' | 'limited' | 'running' | 'idle';

const ATTENTION_PRIORITY: Record<VisualStatus, number> = {
  awaiting: 0,
  limited: 1,
  running: 2,
  idle: 3,
};

function visualStatusFor(row: SidebarRowVm): VisualStatus {
  if (row.resumeAt !== null) return 'limited';
  if (row.attention || row.info.status === 'awaiting-input') return 'awaiting';
  if (row.info.status === 'running' || row.info.status === 'starting') return 'running';
  return 'idle';
}

const SHELL_ICONS: Record<string, string> = {
  pwsh: 'PS',
  powershell: 'PS',
  cmd: 'CM',
  bash: 'BA',
  zsh: 'ZS',
  wsl: 'WSL',
};

export class Sidebar {
  private readonly listEl: HTMLElement;
  private readonly overviewEl: HTMLElement | null;
  private readonly toggleEl: HTMLElement;
  private readonly newEl: HTMLElement | null;
  private readonly sortEl: HTMLElement | null;
  private readonly railSummaryEl: HTMLElement | null;
  private readonly railListEl: HTMLElement | null;
  private readonly railExpandEl: HTMLElement | null;
  private readonly railNewEl: HTMLElement | null;
  private readonly callbacks: SidebarCallbacks;
  /** Attention-sort is on by default per design — toggleable via the ⇅ header button. */
  private attentionSort = true;
  /** Cached input for repaints triggered by header buttons (e.g. sort toggle). */
  private lastRows: SidebarRowVm[] = [];
  private lastFocusedId: SessionId | null = null;

  constructor(opts: {
    listEl: HTMLElement;
    overviewEl?: HTMLElement | null;
    toggleEl: HTMLElement;
    newEl?: HTMLElement | null;
    sortEl?: HTMLElement | null;
    railSummaryEl?: HTMLElement | null;
    railListEl?: HTMLElement | null;
    railExpandEl?: HTMLElement | null;
    railNewEl?: HTMLElement | null;
    callbacks: SidebarCallbacks;
  }) {
    this.listEl = opts.listEl;
    this.overviewEl = opts.overviewEl ?? null;
    this.toggleEl = opts.toggleEl;
    this.newEl = opts.newEl ?? null;
    this.sortEl = opts.sortEl ?? null;
    this.railSummaryEl = opts.railSummaryEl ?? null;
    this.railListEl = opts.railListEl ?? null;
    this.railExpandEl = opts.railExpandEl ?? null;
    this.railNewEl = opts.railNewEl ?? null;
    this.callbacks = opts.callbacks;
    this.toggleEl.addEventListener('click', () => this.callbacks.onToggle());
    this.newEl?.addEventListener('click', () => this.callbacks.onNewSession());
    this.sortEl?.addEventListener('click', () => {
      this.attentionSort = !this.attentionSort;
      this.sortEl?.classList.toggle('active', this.attentionSort);
      this.render(this.lastRows, this.lastFocusedId);
    });
    this.sortEl?.classList.toggle('active', this.attentionSort);
    // Rail (collapsed) wiring — expand mirrors toggle, new mirrors new-session.
    this.railExpandEl?.addEventListener('click', () => this.callbacks.onToggle());
    this.railNewEl?.addEventListener('click', () => this.callbacks.onNewSession());
  }

  render(rows: SidebarRowVm[], focusedId: SessionId | null): void {
    this.lastRows = rows;
    this.lastFocusedId = focusedId;
    this.renderOverview(rows);
    const sorted = this.attentionSort ? this.sortByAttention(rows) : rows;
    this.renderRail(sorted, focusedId);
    this.listEl.innerHTML = '';
    const now = Date.now();
    for (const row of sorted) {
      const el = document.createElement('div');
      el.className =
        'sidebar-row' +
        (row.info.id === focusedId ? ' active' : '') +
        (row.attention ? ' attention' : '');
      el.dataset['sessionId'] = row.info.id;

      // Header row: icon tile + title
      const head = document.createElement('div');
      head.className = 'sr-head';

      const iconTile = document.createElement('div');
      iconTile.className = 'sr-icon';
      iconTile.textContent = SHELL_ICONS[row.info.shell] ?? '??';
      const cornerStatus = this.cornerDotClass(row);
      if (cornerStatus) {
        const dot = document.createElement('span');
        dot.className = `sr-icon-dot ${cornerStatus}`;
        iconTile.appendChild(dot);
      }
      head.appendChild(iconTile);

      const titleSpan = document.createElement('span');
      titleSpan.className = 'sr-title title-text';
      titleSpan.textContent = row.info.title || row.info.shell;
      head.appendChild(titleSpan);

      el.appendChild(head);

      // cwd line
      const cwd = document.createElement('div');
      cwd.className = 'sr-cwd';
      cwd.textContent = row.info.cwd ?? '';
      el.appendChild(cwd);

      // pill: status + elapsed (or limited pill if pending resume)
      const pill = document.createElement('div');
      pill.className = 'sr-pill';
      const pillStatus = this.pillStatusClass(row);
      pill.classList.add(pillStatus);

      const pillDot = document.createElement('span');
      pillDot.className = 'sr-pill-dot';
      pill.appendChild(pillDot);

      const pillLabel = document.createElement('span');
      pillLabel.className = 'sr-pill-label';
      pillLabel.textContent = this.pillLabel(row);
      pill.appendChild(pillLabel);

      const ageSec = Math.max(0, Math.floor((now - row.statusSinceMs) / 1000));
      const pillTime = document.createElement('span');
      pillTime.className = 'sr-pill-time';
      pillTime.textContent = `· ${formatAge(ageSec)}`;
      pill.appendChild(pillTime);

      if (row.resumeAt !== null) {
        const cancel = document.createElement('span');
        cancel.className = 'sr-pill-cancel resume-cancel';
        cancel.textContent = '×';
        cancel.title = 'Cancel auto-resume';
        cancel.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.callbacks.onResumeCancel(row.info.id);
        });
        pill.appendChild(cancel);
      }

      el.appendChild(pill);

      el.addEventListener('click', () => this.callbacks.onRowClick(row.info.id));
      el.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        this.showContextMenu(ev.clientX, ev.clientY, row.info.id);
      });
      this.listEl.appendChild(el);
    }
  }

  /** 'running' | 'awaiting' | 'limited' | 'idle' for the pill (matches handoff palette). */
  private pillStatusClass(row: SidebarRowVm): VisualStatus {
    return visualStatusFor(row);
  }

  /** Corner dot is only rendered for non-idle states (matches handoff). */
  private cornerDotClass(row: SidebarRowVm): '' | 'running' | 'awaiting' | 'limited' {
    const v = visualStatusFor(row);
    return v === 'idle' ? '' : v;
  }

  /** Sort rows by attention priority, then time-in-state desc (oldest first within a bucket). */
  private sortByAttention(rows: SidebarRowVm[]): SidebarRowVm[] {
    return [...rows].sort((a, b) => {
      const pa = ATTENTION_PRIORITY[visualStatusFor(a)];
      const pb = ATTENTION_PRIORITY[visualStatusFor(b)];
      if (pa !== pb) return pa - pb;
      // Older first within a bucket — the smaller statusSinceMs is older.
      return a.statusSinceMs - b.statusSinceMs;
    });
  }

  /** Render the 4-cell status overview strip (await / limited / running / idle). */
  private renderOverview(rows: SidebarRowVm[]): void {
    if (!this.overviewEl) return;
    if (rows.length === 0) {
      this.overviewEl.innerHTML = '';
      this.overviewEl.hidden = true;
      return;
    }
    const counts: Record<VisualStatus, number> = { awaiting: 0, limited: 0, running: 0, idle: 0 };
    for (const row of rows) counts[visualStatusFor(row)]++;

    this.overviewEl.hidden = false;
    this.overviewEl.innerHTML = '';
    const order: Array<{ key: VisualStatus; label: string }> = [
      { key: 'awaiting', label: 'await' },
      { key: 'limited',  label: 'limited' },
      { key: 'running',  label: 'running' },
      { key: 'idle',     label: 'idle' },
    ];
    for (const { key, label } of order) {
      const count = counts[key];
      const cell = document.createElement('div');
      cell.className = `ov-cell ${key}` + (count > 0 ? ' has' : '');
      cell.dataset['status'] = key;

      const top = document.createElement('div');
      top.className = 'ov-top';
      const dot = document.createElement('span');
      dot.className = 'ov-dot';
      const num = document.createElement('span');
      num.className = 'ov-count';
      num.textContent = String(count);
      top.appendChild(dot);
      top.appendChild(num);

      const lbl = document.createElement('span');
      lbl.className = 'ov-label';
      lbl.textContent = label;

      cell.appendChild(top);
      cell.appendChild(lbl);
      this.overviewEl.appendChild(cell);
    }
  }

  private pillLabel(row: SidebarRowVm): string {
    if (row.resumeAt !== null) return 'rate-limited';
    if (row.info.status === 'running') return 'running';
    if (row.info.status === 'awaiting-input') return 'awaiting input';
    return 'idle';
  }

  /** Render the collapsed 56px rail — summary counts + chip rows + hover flyouts. */
  private renderRail(sortedRows: SidebarRowVm[], focusedId: SessionId | null): void {
    if (!this.railListEl) return;
    const now = Date.now();

    // Summary stack: non-zero statuses only, attention order (await → limited → running → idle).
    if (this.railSummaryEl) {
      const counts: Record<VisualStatus, number> = { awaiting: 0, limited: 0, running: 0, idle: 0 };
      for (const row of sortedRows) counts[visualStatusFor(row)]++;
      this.railSummaryEl.innerHTML = '';
      const order: VisualStatus[] = ['awaiting', 'limited', 'running', 'idle'];
      for (const key of order) {
        if (counts[key] === 0) continue;
        const item = document.createElement('div');
        item.className = 'aip-rail__summary-item';
        item.title = `${counts[key]} ${key}`;
        const dot = document.createElement('span');
        dot.className = 'aip-rail__summary-dot';
        dot.style.background = `var(--st-${key})`;
        const count = document.createElement('span');
        count.className = 'aip-rail__summary-count';
        count.textContent = String(counts[key]);
        item.appendChild(dot);
        item.appendChild(count);
        this.railSummaryEl.appendChild(item);
      }
    }

    // Chip rows (one per session).
    this.railListEl.innerHTML = '';
    for (const row of sortedRows) {
      const rowEl = document.createElement('div');
      rowEl.className =
        'aip-rail__row' + (row.info.id === focusedId ? ' aip-rail__row--active' : '');
      rowEl.dataset['sessionId'] = row.info.id;
      rowEl.title = row.info.title || row.info.shell;

      const chip = document.createElement('div');
      chip.className = 'aip-rail__chip';
      chip.textContent = SHELL_ICONS[row.info.shell] ?? '??';
      const cornerStatus = this.cornerDotClass(row);
      if (cornerStatus) {
        const corner = document.createElement('span');
        corner.className = 'aip-rail__chip-corner';
        corner.dataset['status'] = cornerStatus;
        chip.appendChild(corner);
      }
      rowEl.appendChild(chip);

      // Hover flyout — pointer-events:none, preview only.
      const flyout = document.createElement('div');
      flyout.className = 'aip-rail__flyout';

      const top = document.createElement('div');
      top.className = 'aip-rail__flyout-top';
      const flyDot = document.createElement('span');
      flyDot.className = 'aip-rail__flyout-dot';
      flyDot.style.background = `var(--st-${visualStatusFor(row)})`;
      const flyName = document.createElement('span');
      flyName.className = 'aip-rail__flyout-name';
      flyName.textContent = row.info.title || row.info.shell;
      top.appendChild(flyDot);
      top.appendChild(flyName);
      flyout.appendChild(top);

      const cwd = document.createElement('div');
      cwd.className = 'aip-rail__flyout-cwd';
      cwd.textContent = row.info.cwd ?? '';
      flyout.appendChild(cwd);

      const pillStatus = this.pillStatusClass(row);
      const pill = document.createElement('div');
      pill.className = `aip-rail__flyout-pill ${pillStatus}`;
      const pillDot = document.createElement('span');
      pillDot.className = 'aip-rail__flyout-pill-dot';
      pill.appendChild(pillDot);
      const pillLabel = document.createElement('span');
      pillLabel.textContent = this.pillLabel(row);
      pill.appendChild(pillLabel);
      const ageSec = Math.max(0, Math.floor((now - row.statusSinceMs) / 1000));
      const pillTime = document.createElement('span');
      pillTime.className = 'aip-rail__flyout-pill-time';
      pillTime.textContent = `· ${formatAge(ageSec)}`;
      pill.appendChild(pillTime);
      flyout.appendChild(pill);

      rowEl.appendChild(flyout);

      rowEl.addEventListener('click', () => this.callbacks.onRowClick(row.info.id));
      rowEl.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        this.showContextMenu(ev.clientX, ev.clientY, row.info.id);
      });
      this.railListEl.appendChild(rowEl);
    }
  }

  private showContextMenu(x: number, y: number, sessionId: SessionId): void {
    const existing = document.getElementById('sidebar-context-menu');
    existing?.remove();
    const menu = document.createElement('div');
    menu.id = 'sidebar-context-menu';
    menu.className = 'ctx-menu';
    menu.style.top = `${y}px`;
    menu.style.left = `${x}px`;
    const mk = (label: string, fn: () => void) => {
      const item = document.createElement('div');
      item.className = 'ctx-item';
      item.textContent = label;
      item.addEventListener('click', () => { menu.remove(); fn(); });
      menu.appendChild(item);
    };
    mk('Rename', () => this.callbacks.onRename(sessionId));
    mk('Duplicate', () => this.callbacks.onDuplicate(sessionId));
    mk('Restart', () => this.callbacks.onRestart(sessionId));
    mk('Close', () => this.callbacks.onClose(sessionId));
    document.body.appendChild(menu);
    const close = (): void => {
      menu.remove();
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', onKey);
    };
    const dismiss = (ev: MouseEvent): void => {
      if (!menu.contains(ev.target as Node)) close();
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') close();
    };
    setTimeout(() => {
      document.addEventListener('mousedown', dismiss);
      document.addEventListener('keydown', onKey);
    }, 0);
  }
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}
