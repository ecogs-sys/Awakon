import { IpcChannel, isHttpUrl } from '@awakon/contracts';
import type { SessionId } from '@awakon/contracts';
import { formatAccelerator } from '@awakon/keymap';
import type { TabDocState, ReviewState } from './doc-state.js';
import { renderMarkdown, countLoc } from './markdown.js';
import { renderMermaidBlocks } from './mermaid.js';

/** Local mirror of the FsReadFile response union (see contracts FsReadFileResponseSchema). */
type ReadFileResponse =
  | { content: string; sizeBytes: number; mtimeMs: number }
  | { tooLarge: true; sizeBytes: number }
  | { notFound: true }
  | { error: string };

interface Bridge {
  send: (channel: string, payload?: unknown) => Promise<unknown>;
}

export interface DocReaderCallbacks {
  onDismiss: () => void;
  onSelectFile: (index: number) => void;
  onCloseFile: (index: number) => void;
  onReview: (index: number, review: ReviewState) => void;
  onPrevFile: () => void;
  onNextFile: () => void;
}

/**
 * Renders the right-side modal markdown reader into a host element (the chrome's
 * #view-host). Driven by render(state); loads the active doc body asynchronously.
 * State is owned by the LayoutManager.
 */
export class DocReader {
  private readonly host: HTMLElement;
  private readonly bridge: Bridge;
  private readonly cb: DocReaderCallbacks;
  private readonly platform: string;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  /** Guards against a stale async body write after the active doc changed. */
  private loadToken = 0;

  constructor(host: HTMLElement, bridge: Bridge, callbacks: DocReaderCallbacks, platform: string) {
    this.host = host;
    this.bridge = bridge;
    this.cb = callbacks;
    this.platform = platform;
  }

  render(state: TabDocState, tabId: SessionId): void {
    this.teardownKeys();
    const existing = this.host.querySelector('.aip-reader');
    // Whether the panel was already on-screen. If so, this render is an in-place update
    // (file switch / review toggle) and the slide-in animation must NOT replay.
    const wasVisible = existing !== null;
    if (existing) existing.remove();

    const visible = state.readerVisible && state.activeDocIndex !== null && state.openDocs.length > 0;
    if (!visible) return;

    const activeIndex = state.activeDocIndex!;
    const active = state.openDocs[activeIndex]!;

    const root = document.createElement('div');
    root.className = 'aip-reader';
    // Only animate the slide-in on a fresh open (closed -> open), not on re-renders
    // while the reader is already visible.
    const panelClass = 'aip-reader__panel' + (wasVisible ? ' aip-reader__panel--static' : '');
    root.innerHTML = `
      <div class="aip-reader__scrim">
        <div class="aip-reader__scrim-hint">click or esc to close</div>
      </div>
      <div class="${panelClass}" role="dialog" aria-label="Markdown reader">
        <div class="aip-reader__files"></div>
        <div class="aip-reader__review">
          <span class="aip-reader__path"></span>
          <span class="aip-reader__provenance"></span>
          <div class="aip-reader__actions">
            <button type="button" class="aip-reader__approve">✓ Approve</button>
            <button type="button" class="aip-reader__request">✎ Request changes</button>
          </div>
        </div>
        <div class="aip-reader__body"></div>
        <div class="aip-reader__footer">
          <div class="aip-reader__hints">
            <span><span class="k">esc</span> close</span>
            <span><span class="k">${formatAccelerator('CmdOrCtrl+[', this.platform)}</span> prev file</span>
            <span><span class="k">${formatAccelerator('CmdOrCtrl+]', this.platform)}</span> next file</span>
          </div>
          <span class="aip-reader__stats"></span>
        </div>
      </div>
    `;
    this.host.appendChild(root);

    root.querySelector<HTMLElement>('.aip-reader__scrim')!
      .addEventListener('click', () => this.cb.onDismiss());

    const filesEl = root.querySelector<HTMLElement>('.aip-reader__files')!;
    state.openDocs.forEach((d, i) => {
      const tab = document.createElement('div');
      tab.className = 'aip-reader__file' + (i === activeIndex ? ' active' : '');
      const glyph = document.createElement('span');
      glyph.className = 'aip-reader__file-glyph';
      glyph.textContent = 'M↓';
      const name = document.createElement('span');
      name.className = 'aip-reader__file-name';
      name.textContent = basename(d.rawPath);
      const close = document.createElement('span');
      close.className = 'aip-reader__file-close';
      close.textContent = '×';
      close.title = 'Close file';
      close.addEventListener('click', (ev) => { ev.stopPropagation(); this.cb.onCloseFile(i); });
      tab.append(glyph, name, close);
      tab.addEventListener('click', () => { if (i !== activeIndex) this.cb.onSelectFile(i); });
      filesEl.appendChild(tab);
    });
    const closeCell = document.createElement('div');
    closeCell.className = 'aip-reader__close';
    closeCell.title = 'Close (esc)';
    closeCell.textContent = '×';
    closeCell.addEventListener('click', () => this.cb.onDismiss());
    filesEl.appendChild(closeCell);

    const pathEl = root.querySelector<HTMLElement>('.aip-reader__path')!;
    pathEl.textContent = active.rawPath;
    const prov = root.querySelector<HTMLElement>('.aip-reader__provenance')!;
    prov.textContent = `proposed by ${active.provenanceTitle}`;
    const approve = root.querySelector<HTMLButtonElement>('.aip-reader__approve')!;
    const request = root.querySelector<HTMLButtonElement>('.aip-reader__request')!;
    approve.classList.toggle('is-on', active.reviewState === 'approved');
    request.classList.toggle('is-on', active.reviewState === 'changes-requested');
    approve.addEventListener('click', () => this.cb.onReview(activeIndex, 'approved'));
    request.addEventListener('click', () => this.cb.onReview(activeIndex, 'changes-requested'));

    const bodyEl = root.querySelector<HTMLElement>('.aip-reader__body')!;
    const statsEl = root.querySelector<HTMLElement>('.aip-reader__stats')!;
    // Links inside rendered markdown must never navigate the chrome window (that would
    // replace the whole app UI). Intercept clicks and hand http(s) links to the OS
    // default browser; swallow everything else. Delegated so it covers async body content.
    bodyEl.addEventListener('click', (ev) => {
      const anchor = (ev.target as HTMLElement | null)?.closest('a');
      if (!anchor) return;
      ev.preventDefault();
      const href = anchor.getAttribute('href') ?? '';
      if (isHttpUrl(href)) {
        void this.bridge.send(IpcChannel.ChromeOpenExternal, { url: href });
      }
    });
    void this.loadBody(active.resolvedPath, bodyEl, statsEl, tabId);

    this.keyHandler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); this.cb.onDismiss(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === '[') { e.preventDefault(); this.cb.onPrevFile(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === ']') { e.preventDefault(); this.cb.onNextFile(); }
    };
    document.addEventListener('keydown', this.keyHandler);
  }

  private async loadBody(resolvedPath: string, bodyEl: HTMLElement, statsEl: HTMLElement, tabId: SessionId): Promise<void> {
    const token = ++this.loadToken;
    let res: ReadFileResponse;
    try {
      res = (await this.bridge.send(IpcChannel.FsReadFile, { path: resolvedPath, tabId })) as ReadFileResponse;
    } catch {
      res = { error: 'failed to read file' };
    }
    if (token !== this.loadToken) return;
    if (!bodyEl.isConnected) return;

    if ('content' in res) {
      bodyEl.innerHTML = `<div class="aip-reader__prose">${renderMarkdown(res.content)}</div>`;
      statsEl.textContent = `${countLoc(res.content)} LOC · ${formatKb(res.sizeBytes)}`;
      // Mermaid renders asynchronously, swapping markers for SVG in place. If the
      // active doc changed mid-render, render() has already rebuilt the body via
      // root.innerHTML, so this bodyEl is detached and those writes are invisible.
      // The guard then stops any further work on the stale body.
      await renderMermaidBlocks(bodyEl);
      if (token !== this.loadToken || !bodyEl.isConnected) return;
    } else if ('tooLarge' in res) {
      bodyEl.textContent = `This file is too large to preview (${formatKb(res.sizeBytes)}).`;
      statsEl.textContent = formatKb(res.sizeBytes);
    } else if ('notFound' in res) {
      bodyEl.textContent = `${resolvedPath} (not yet created)`;
      statsEl.textContent = '';
    } else {
      bodyEl.textContent = `Could not read file: ${res.error}`;
      statsEl.textContent = '';
    }
  }

  private teardownKeys(): void {
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
  }
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function formatKb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
