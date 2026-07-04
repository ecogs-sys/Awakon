import type { SessionId, SessionInfo } from '@awakon/contracts';

export interface TabViewModel {
  info: SessionInfo;
  attention: boolean;
  broken: boolean;
  /** Epoch ms a pending auto-resume will fire, or null when none is scheduled. */
  resumeAt: number | null;
  /** True when this tab has a parked/open markdown doc (shows an M↓ marker). */
  hasDoc: boolean;
}

export interface TabStripCallbacks {
  onTabClick: (sessionId: SessionId) => void;
  onTabClose: (sessionId: SessionId) => void;
  onNewTab: () => void;
  onTabReorder: (sessionId: SessionId, beforeId: SessionId | null) => void;
}

export class TabStrip {
  private readonly root: HTMLElement;
  private readonly callbacks: TabStripCallbacks;

  constructor(root: HTMLElement, callbacks: TabStripCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
  }

  render(tabs: TabViewModel[], focusedId: SessionId | null): void {
    this.root.innerHTML = '';
    for (const tab of tabs) {
      const el = document.createElement('div');
      el.className = 'tab' + (tab.info.id === focusedId ? ' active' : '');
      el.dataset['sessionId'] = tab.info.id;

      // The active tab's accent edge is a CSS inset box-shadow (.tab.active), so
      // it follows the tab's rounded top corners — no separate stripe element.

      // Status dot — color comes from status; resumeAt overrides to 'limited'.
      const dot = document.createElement('span');
      dot.className = 'dot';
      const isLimited = tab.resumeAt !== null;
      if (isLimited) dot.classList.add('limited');
      else if (tab.attention) dot.classList.add('awaiting');
      else if (tab.info.status === 'running') dot.classList.add('running');
      else if (tab.info.status === 'awaiting-input') dot.classList.add('awaiting');
      else if (tab.info.status === 'exited') dot.classList.add('idle');
      el.appendChild(dot);

      const title = document.createElement('span');
      title.className = 'title';
      const label = tab.info.title || tab.info.shell;
      title.textContent = tab.broken
        ? `⚠ ${label}`
        : tab.info.status === 'exited'
          ? `${label} (exited)`
          : label;
      el.appendChild(title);

      if (tab.hasDoc) {
        const marker = document.createElement('span');
        marker.className = 'doc-marker';
        marker.textContent = 'M↓';
        marker.title = 'A document is open on this tab';
        el.appendChild(marker);
      }

      if (tab.resumeAt !== null) {
        const badge = document.createElement('span');
        badge.className = 'resume-badge limited';
        badge.textContent = `⏳ ${formatClock(tab.resumeAt)}`;
        badge.title = 'Auto-resume scheduled';
        el.appendChild(badge);
      }

      const close = document.createElement('span');
      close.className = 'close';
      close.textContent = '×';
      close.title = 'Close tab (Ctrl+W)';
      close.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.callbacks.onTabClose(tab.info.id);
      });
      el.appendChild(close);

      el.addEventListener('click', () => this.callbacks.onTabClick(tab.info.id));

      el.draggable = true;
      el.addEventListener('dragstart', (ev) => {
        ev.dataTransfer?.setData('text/plain', tab.info.id);
      });
      el.addEventListener('dragover', (ev) => ev.preventDefault());
      el.addEventListener('drop', (ev) => {
        ev.preventDefault();
        const draggedId = ev.dataTransfer?.getData('text/plain') as SessionId | undefined;
        if (!draggedId || draggedId === tab.info.id) return;
        this.callbacks.onTabReorder(draggedId, tab.info.id);
      });

      this.root.appendChild(el);
    }

    const plus = document.createElement('button');
    plus.id = 'new-tab';
    plus.textContent = '+';
    plus.title = 'New tab (Ctrl+T)';
    plus.addEventListener('click', () => this.callbacks.onNewTab());
    this.root.appendChild(plus);
  }
}

/** Format an epoch-ms instant as a short local clock time, e.g. "9:30 PM". */
export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
