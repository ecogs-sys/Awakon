import type { RecentTab, Shell } from '@awakon/contracts';
import { Bindings, formatAccelerator } from '@awakon/keymap';
import { awakonMarkMarkup } from './icon.js';

export interface EmptyStateCallbacks {
  onNew:        () => void;
  onPickRecent: (r: RecentTab) => void;
}

export function shellChip(shell: Shell | string): string {
  // Abbreviations intentionally differ from sidebar.ts SHELL_ICONS (3-char vs 2-char).
  // TODO: consolidate into a shared shell-utils module when sidebar is next touched.
  const map: Record<string, string> = {
    pwsh: 'PS', powershell: 'PS', cmd: 'CMD',
    bash: 'BSH', 'git-bash': 'BSH',
    zsh: 'ZSH', wsl: 'WSL',
  };
  return map[shell] ?? shell.slice(0, 3).toUpperCase();
}

export function formatWhen(closedAt: number): string {
  const diffMs = Date.now() - closedAt;
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(closedAt).toLocaleDateString();
}

function appGlyph(): string {
  return awakonMarkMarkup(40);
}

export class EmptyStateView {
  /** 'win32' | 'darwin' | 'linux' — formats the "New session" card's shortcut hint via
   * the shared keymap formatAccelerator (A5-I6: this used to be a local UA sniff). */
  private readonly platform: string;

  constructor(private readonly root: HTMLElement, platform: string = 'linux') {
    this.platform = platform;
  }

  render(recents: RecentTab[], callbacks: EmptyStateCallbacks): void {
    this.root.innerHTML = '';
    this.root.appendChild(this.build(recents, callbacks));
  }

  private build(recents: RecentTab[], cb: EmptyStateCallbacks): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'aip-empty';

    const inner = document.createElement('div');
    inner.className = 'aip-empty__inner';
    wrap.appendChild(inner);

    inner.appendChild(this.buildBrand());
    inner.appendChild(this.buildCards(cb.onNew));

    if (recents.length > 0) {
      inner.appendChild(this.buildRecents(recents, cb.onPickRecent));
    }

    return wrap;
  }

  private buildBrand(): HTMLElement {
    const brand = document.createElement('div');
    brand.className = 'aip-empty__brand';

    const icon = document.createElement('div');
    icon.className = 'aip-empty__brand-icon';
    icon.innerHTML = appGlyph();

    const text = document.createElement('div');
    text.className = 'aip-empty__brand-text';
    const title = document.createElement('div');
    title.className = 'aip-empty__brand-title';
    title.textContent = 'Awakon';
    const sub = document.createElement('div');
    sub.className = 'aip-empty__brand-sub';
    sub.textContent = 'run many agents · never miss a prompt';
    text.appendChild(title);
    text.appendChild(sub);

    brand.appendChild(icon);
    brand.appendChild(text);
    return brand;
  }

  private buildCards(onNew: () => void): HTMLElement {
    const cards = document.createElement('div');
    cards.className = 'aip-empty__cards';

    const card = document.createElement('div');
    card.className = 'aip-empty__card aip-empty__card--primary';
    card.addEventListener('click', onNew);

    const titleEl = document.createElement('div');
    titleEl.className = 'aip-empty__card-title';
    titleEl.textContent = 'New session';

    const metaEl = document.createElement('div');
    metaEl.className = 'aip-empty__card-meta';
    metaEl.textContent = 'claude · codex · pwsh';

    const foot = document.createElement('div');
    foot.className = 'aip-empty__card-foot';
    const kbdEl = document.createElement('span');
    kbdEl.className = 'aip-empty__card-kbd';
    kbdEl.textContent = formatAccelerator(Bindings.newTab.accelerator, this.platform);
    const arrow = document.createElement('span');
    arrow.className = 'aip-empty__card-arrow';
    arrow.textContent = '→';
    foot.appendChild(kbdEl);
    foot.appendChild(arrow);

    card.appendChild(titleEl);
    card.appendChild(metaEl);
    card.appendChild(foot);
    cards.appendChild(card);
    return cards;
  }

  private buildRecents(recents: RecentTab[], onPickRecent: (r: RecentTab) => void): HTMLElement {
    const section = document.createElement('div');
    section.className = 'aip-empty__recents';

    const heading = document.createElement('div');
    heading.className = 'aip-empty__recents-title';
    heading.textContent = 'Recent';
    section.appendChild(heading);

    for (const r of recents) {
      section.appendChild(this.buildRecentRow(r, onPickRecent));
    }
    return section;
  }

  private buildRecentRow(r: RecentTab, onClick: (r: RecentTab) => void): HTMLElement {
    const row = document.createElement('div');
    row.className = 'aip-empty__recent';
    row.addEventListener('click', () => onClick(r));

    const chip = document.createElement('span');
    chip.className = 'aip-empty__recent-chip';
    chip.textContent = shellChip(r.shell);

    const name = document.createElement('span');
    name.className = 'aip-empty__recent-name';
    name.textContent = r.title;

    const cwd = document.createElement('span');
    cwd.className = 'aip-empty__recent-cwd';
    cwd.textContent = r.cwd;

    const when = document.createElement('span');
    when.className = 'aip-empty__recent-when';
    when.textContent = formatWhen(r.closedAt);

    row.appendChild(chip);
    row.appendChild(name);
    row.appendChild(cwd);
    row.appendChild(when);
    return row;
  }
}
