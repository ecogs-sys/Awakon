// ═══════════════════════════════════════════════════════════════════════════
// Command palette (Direction 1) — Ctrl/⌘+K.
//
// A filterable overlay over the open sessions (switch to) and app actions. It is
// deliberately decoupled from LayoutManager: the caller supplies a buildCommands()
// that returns a fresh, grouped command list each time the palette opens (sessions
// change), and each command carries its own run() handler.
// ═══════════════════════════════════════════════════════════════════════════

export interface PaletteCommand {
  /** Stable id (used for keys/tests). */
  id: string;
  /** Section header this command appears under. */
  group: string;
  /** Primary label. */
  title: string;
  /** Secondary line (cwd, shell, …). */
  meta?: string;
  /** Short chip glyph, e.g. a shell abbreviation or an action symbol. */
  chip: string;
  /** Optional status for a colored pill (running | awaiting | limited | idle). */
  status?: 'running' | 'awaiting' | 'limited' | 'idle';
  /** Optional pre-formatted accelerator label (already OS-resolved). */
  accel?: string;
  /** Invoked on Enter / click. The palette closes first, then runs this. */
  run: () => void;
}

export interface CommandPaletteDeps {
  /** Where to attach the overlay. Defaults to document.body. */
  mount?: HTMLElement;
  /** Pre-formatted accelerator shown in the input row (e.g. "Ctrl+K"). */
  hotkeyLabel: string;
  /** Build the current command list. Called every time the palette opens. */
  buildCommands: () => PaletteCommand[];
  /**
   * Notified when the palette opens (true) / closes (false). Chrome wires this to
   * IpcChannel.LayoutModal so the native terminal WebContentsView is suspended
   * while the overlay is up — otherwise the terminal view covers the palette.
   */
  onVisibilityChange?: (open: boolean) => void;
}

export class CommandPalette {
  private readonly mount: HTMLElement;
  private overlay: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private listEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;

  private commands: PaletteCommand[] = [];
  private filtered: PaletteCommand[] = [];
  private highlight = 0;
  private onKeyDown = (ev: KeyboardEvent): void => this.handleKey(ev);

  constructor(private readonly deps: CommandPaletteDeps) {
    this.mount = deps.mount ?? document.body;
  }

  get isOpen(): boolean {
    return this.overlay !== null;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    if (this.isOpen) return;
    this.commands = this.deps.buildCommands();
    this.highlight = 0;

    const overlay = document.createElement('div');
    overlay.className = 'aip-pal';
    overlay.addEventListener('mousedown', (ev) => {
      if (ev.target === overlay) this.close();
    });

    const card = document.createElement('div');
    card.className = 'aip-pal__card';
    card.innerHTML = `
      <div class="aip-pal__head">
        <span class="aip-pal__hotkey">${escapeHtml(this.deps.hotkeyLabel)}</span>
        <input class="aip-pal__input" type="text" spellcheck="false" autocomplete="off" placeholder="Type a command or session…" aria-label="Command palette" />
        <span class="aip-pal__esc">esc</span>
      </div>
      <div class="aip-pal__list" role="listbox"></div>
      <div class="aip-pal__foot">
        <div class="aip-pal__hints">
          <span><span class="k">↑↓</span> navigate</span>
          <span><span class="k">↵</span> open</span>
          <span><span class="k">esc</span> close</span>
        </div>
        <span class="aip-pal__count"></span>
      </div>`;
    overlay.appendChild(card);
    this.mount.appendChild(overlay);

    this.overlay = overlay;
    this.inputEl = card.querySelector('.aip-pal__input');
    this.listEl = card.querySelector('.aip-pal__list');
    this.countEl = card.querySelector('.aip-pal__count');

    this.inputEl!.addEventListener('input', () => {
      this.highlight = 0;
      this.renderList();
    });
    this.inputEl!.addEventListener('keydown', this.onKeyDown);

    this.renderList();
    this.inputEl!.focus();
    this.deps.onVisibilityChange?.(true);
  }

  close(): void {
    if (!this.overlay) return;
    this.inputEl?.removeEventListener('keydown', this.onKeyDown);
    this.overlay.remove();
    this.overlay = null;
    this.inputEl = null;
    this.listEl = null;
    this.countEl = null;
    this.deps.onVisibilityChange?.(false);
  }

  private handleKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.close();
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      this.move(1);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      this.move(-1);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      this.runHighlighted();
    }
  }

  private move(delta: number): void {
    if (this.filtered.length === 0) return;
    const n = this.filtered.length;
    this.highlight = (this.highlight + delta + n) % n;
    this.paintHighlight();
  }

  private runHighlighted(): void {
    const cmd = this.filtered[this.highlight];
    if (!cmd) return;
    this.close();
    cmd.run();
  }

  private currentQuery(): string {
    return (this.inputEl?.value ?? '').trim().toLowerCase();
  }

  private renderList(): void {
    if (!this.listEl) return;
    const q = this.currentQuery();
    this.filtered = q
      ? this.commands.filter((c) => `${c.title} ${c.meta ?? ''}`.toLowerCase().includes(q))
      : this.commands.slice();

    this.listEl.innerHTML = '';
    let lastGroup = '';
    this.filtered.forEach((cmd, idx) => {
      if (cmd.group !== lastGroup) {
        lastGroup = cmd.group;
        const g = document.createElement('div');
        g.className = 'aip-pal__group';
        g.textContent = cmd.group;
        this.listEl!.appendChild(g);
      }
      this.listEl!.appendChild(this.renderRow(cmd, idx));
    });

    if (this.countEl) {
      this.countEl.textContent = `${this.filtered.length} result${this.filtered.length === 1 ? '' : 's'}`;
    }
    this.paintHighlight();
  }

  private renderRow(cmd: PaletteCommand, idx: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'aip-pal__row';
    row.dataset['idx'] = String(idx);
    row.setAttribute('role', 'option');

    const chip = document.createElement('span');
    chip.className = 'aip-pal__chip';
    chip.textContent = cmd.chip;

    const body = document.createElement('div');
    body.className = 'aip-pal__body';
    const title = document.createElement('span');
    title.className = 'aip-pal__title';
    title.textContent = cmd.title;
    body.appendChild(title);
    if (cmd.meta) {
      const meta = document.createElement('span');
      meta.className = 'aip-pal__meta';
      meta.textContent = cmd.meta;
      body.appendChild(meta);
    }

    row.append(chip, body);

    if (cmd.status) {
      const pill = document.createElement('span');
      pill.className = `aip-pal__pill ${cmd.status}`;
      pill.textContent = STATUS_LABEL[cmd.status];
      row.appendChild(pill);
    }
    if (cmd.accel) {
      const acc = document.createElement('span');
      acc.className = 'aip-pal__accel';
      acc.textContent = cmd.accel;
      row.appendChild(acc);
    }

    row.addEventListener('mousemove', () => {
      if (this.highlight !== idx) { this.highlight = idx; this.paintHighlight(); }
    });
    row.addEventListener('click', () => { this.highlight = idx; this.runHighlighted(); });

    return row;
  }

  private paintHighlight(): void {
    if (!this.listEl) return;
    const rows = this.listEl.querySelectorAll<HTMLElement>('.aip-pal__row');
    rows.forEach((row) => {
      const on = Number(row.dataset['idx']) === this.highlight;
      row.classList.toggle('active', on);
      // scrollIntoView is unimplemented in jsdom; guard so tests (and any host
      // without it) don't throw.
      if (on && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
    });
  }
}

const STATUS_LABEL: Record<NonNullable<PaletteCommand['status']>, string> = {
  running: 'running',
  awaiting: 'awaiting',
  limited: 'rate-limited',
  idle: 'idle',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
