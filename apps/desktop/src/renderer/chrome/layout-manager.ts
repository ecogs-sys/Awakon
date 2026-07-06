import type { SessionId, SessionInfo, AttentionEvent, Shell, AppSettings, ChromeAppInfoResponse, RecentTab } from '@awakon/contracts';
import { emptyDocState, openDoc, closeDocAt, setReview, moveActive, toPersistedDocs, fromPersistedDocs, type ReviewState } from './doc-state.js';
import { DocReader } from './doc-reader.js';
import { IpcChannel } from '@awakon/contracts';
import type { PreloadBridge } from '@awakon/terminal-host';
import { TabStrip, type TabViewModel } from './tab-strip.js';
import { Sidebar, type SidebarRowVm } from './sidebar.js';
import { emptyState, type ChromeState, type SessionState } from './state.js';
import { showNewSessionDialog, showRenameDialog } from './new-session-dialog.js';
import { showSettingsDialog } from './settings-dialog.js';
import { showAboutDialog } from './about-dialog.js';
import { EmptyStateView } from './empty-state.js';
import type { TitleBar } from './titlebar.js';

export interface LayoutDeps {
  bridge: PreloadBridge;
  tabStrip: TabStrip;
  sidebar: Sidebar;
  bodyEl: HTMLElement;
  emptyStateHostEl: HTMLElement;
  viewHostEl: HTMLElement;
  /** 'win32' | 'darwin' | 'linux' — forwarded to DocReader so its shortcut hints go
   * through the shared formatAccelerator instead of a local UA sniff (L6). */
  platform: string;
}

export class LayoutManager {
  private readonly bridge: PreloadBridge;
  private readonly tabStrip: TabStrip;
  private readonly sidebar: Sidebar;
  private readonly bodyEl: HTMLElement;
  private readonly state: ChromeState = emptyState();
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  /** Platform home directory, fetched from main at startup (the chrome cannot read it). */
  private homeCwd = '~';
  /** User-configured default working directory (settings.defaultCwd). Cached here so
   *  platformDefaultCwd() can remain synchronous. Kept live by the SettingsChanged subscription. */
  private defaultCwdSetting = '';
  /** Main's PATH-probed default shell (B3) — the chrome cannot check PATH itself.
   *  Null until fetched; platformDefaultShell() falls back to a platform guess until then. */
  private detectedDefaultShell: Shell | null = null;
  private readonly emptyStateHostEl: HTMLElement;
  private readonly emptyStateView: EmptyStateView;
  private readonly viewHostEl: HTMLElement;
  private readonly docReader: DocReader;
  /** Top bar, attached after construction so render() can reflect the focused session. */
  private titleBar: TitleBar | null = null;
  /** True while a chrome dialog (Settings/About/New Session/Rename) is open. Combined
   * with the reader's own visibility (see currentModalState) so that closing one overlay
   * while another is still open does not tell main to un-suspend the terminal view out
   * from under the overlay that's still showing (Critical #3). LayoutModal used to be
   * sent as a bare open/close bracket per-overlay, which desynced the instant two
   * overlays' lifetimes overlapped — e.g. opening Settings while the reader is open,
   * then closing Settings, incorrectly resumed the terminal view over the still-visible
   * reader. */
  private dialogOpen = false;

  constructor(deps: LayoutDeps) {
    this.bridge = deps.bridge;
    this.tabStrip = deps.tabStrip;
    this.sidebar = deps.sidebar;
    this.bodyEl = deps.bodyEl;
    this.emptyStateHostEl = deps.emptyStateHostEl;
    this.emptyStateView = new EmptyStateView(deps.emptyStateHostEl);
    this.viewHostEl = deps.viewHostEl;
    this.docReader = new DocReader(this.viewHostEl, this.bridge, {
      onDismiss:    () => this.dismissReader(),
      onSelectFile: (i) => this.selectDoc(i),
      onCloseFile:  (i) => this.closeDoc(i),
      onReview:     (i, r) => this.reviewDoc(i, r),
      onPrevFile:   () => this.moveDoc(-1),
      onNextFile:   () => this.moveDoc(1),
    }, deps.platform);
  }

  /** Wire the top bar so its breadcrumb + subtitle track the focused session. */
  attachTitleBar(titleBar: TitleBar): void {
    this.titleBar = titleBar;
  }

  async start(): Promise<void> {
    // Subscribe to events FIRST (before any await), then query the list. This order
    // closes the race where main may create the boot session between the list query
    // and the listener registration. `upsertSession` is idempotent so double-counting
    // is safe.
    this.bridge.on(IpcChannel.SessionCreated, (raw) => {
      const e = raw as { info: SessionInfo };
      // Pane sessions live inside a tab's terminal renderer — they are never tabs.
      if (e.info.kind === 'pane') return;
      this.upsertSession(e.info);
      this.focus(e.info.id);
    });
    this.bridge.on(IpcChannel.SessionExited, (raw) => {
      const e = raw as { sessionId: SessionId; exitCode: number | null };
      const session = this.state.sessions.get(e.sessionId);
      if (session) {
        session.info = { ...session.info, status: 'exited', exitCode: e.exitCode };
        session.statusSinceMs = Date.now();
        session.resumeAt = null;
        this.render();
      }
    });
    this.bridge.on(IpcChannel.SessionAttention, (raw) => {
      const e = raw as AttentionEvent;
      const session = this.state.sessions.get(e.sessionId);
      if (!session) return;
      // Don't badge the currently focused tab — the user is already on it.
      if (this.state.focusedId === e.sessionId) return;
      session.attention = true;
      session.info = { ...session.info, status: 'awaiting-input' };
      session.statusSinceMs = Date.now();
      this.render();
    });
    // Main may push LayoutShow when the user clicks a notification — keep our state in sync.
    this.bridge.on(IpcChannel.LayoutShow, (raw) => {
      const e = raw as { sessionId: SessionId };
      if (this.state.sessions.has(e.sessionId)) this.focus(e.sessionId);
    });
    // Title changes (rename) are echoed by main — keep tab/sidebar labels in sync.
    this.bridge.on(IpcChannel.SessionTitleChanged, (raw) => {
      const e = raw as { sessionId: SessionId; title: string };
      const session = this.state.sessions.get(e.sessionId);
      if (!session) return;
      session.info = { ...session.info, title: e.title };
      this.render();
    });
    // A tab whose renderer crashed twice in 60s — mark it broken so the UI offers Restart.
    this.bridge.on(IpcChannel.SessionTabBroken, (raw) => {
      const e = raw as { sessionId: SessionId };
      const session = this.state.sessions.get(e.sessionId);
      if (!session) return;
      session.broken = true;
      this.render();
    });
    // Auto-resume countdown badge: track the scheduled time per session.
    this.bridge.on(IpcChannel.ResumeScheduled, (raw) => {
      const e = raw as { sessionId: SessionId; resetAt: number };
      const session = this.state.sessions.get(e.sessionId);
      if (!session) return;
      session.resumeAt = e.resetAt;
      this.render();
    });
    this.bridge.on(IpcChannel.ResumeCancelled, (raw) => {
      const e = raw as { sessionId: SessionId };
      const session = this.state.sessions.get(e.sessionId);
      if (!session) return;
      session.resumeAt = null;
      this.render();
    });
    this.bridge.on(IpcChannel.ResumeFired, (raw) => {
      const e = raw as { sessionId: SessionId };
      const session = this.state.sessions.get(e.sessionId);
      if (!session) return;
      session.resumeAt = null;
      this.render();
    });
    this.bridge.on(IpcChannel.SettingsChanged, (raw) => {
      const s = raw as AppSettings;
      this.defaultCwdSetting = s.defaultCwd ?? '';
    });
    // A tab's primary pane closed and a sibling pane was promoted to take its place
    // (H2). The tab keeps its view/session-state — just relabel the id it's tracked
    // under so the tab strip/sidebar keep pointing at the still-alive session.
    this.bridge.on(IpcChannel.LayoutTabReparented, (raw) => {
      const e = raw as { oldTabId: SessionId; newTabId: SessionId };
      const session = this.state.sessions.get(e.oldTabId);
      if (!session) return;
      this.state.sessions.delete(e.oldTabId);
      this.state.sessions.set(e.newTabId, { ...session, info: { ...session.info, id: e.newTabId } });
      this.state.tabOrder = this.state.tabOrder.map((id) => (id === e.oldTabId ? e.newTabId : id));
      if (this.state.focusedId === e.oldTabId) this.state.focusedId = e.newTabId;
      // Critical #3: re-point the reader at the session's new id (docReader.render is
      // keyed by tab id) instead of leaving it wired to the id that just stopped existing.
      this.syncReader();
      this.render();
    });
    this.bridge.on(IpcChannel.DocOpenRequest, (raw) => {
      const e = raw as {
        tabId: SessionId; rawPath: string; resolvedPath: string;
        provenanceTitle: string; provenanceStatus: SessionInfo['status'];
      };
      const session = this.state.sessions.get(e.tabId);
      if (!session) return;
      session.docState = openDoc(session.docState, {
        rawPath: e.rawPath,
        resolvedPath: e.resolvedPath,
        provenanceTitle: e.provenanceTitle,
        provenanceStatus: e.provenanceStatus,
        reviewState: 'proposed',
      });
      this.persistDocs(e.tabId);
      if (this.state.focusedId === e.tabId) this.syncReader();
      this.render();
    });

    // Fetch the real home directory, default shell, settings, and recent tabs in parallel.
    const [homeCwdResult, defaultShellResult, settingsResult, recentsResult] = await Promise.allSettled([
      this.bridge.send(IpcChannel.LayoutDefaultCwd) as Promise<string>,
      this.bridge.send(IpcChannel.LayoutDefaultShell) as Promise<Shell>,
      this.bridge.send(IpcChannel.SettingsGet) as Promise<AppSettings>,
      this.bridge.send(IpcChannel.RecentList) as Promise<RecentTab[]>,
    ]);
    if (homeCwdResult.status === 'fulfilled') this.homeCwd = homeCwdResult.value;
    if (defaultShellResult.status === 'fulfilled') this.detectedDefaultShell = defaultShellResult.value;
    if (settingsResult.status === 'fulfilled') this.defaultCwdSetting = settingsResult.value.defaultCwd ?? '';
    if (recentsResult.status === 'fulfilled') this.state.recentTabs = recentsResult.value;

    // Pull initial session list (main may have already spawned the boot session).
    const list = (await this.bridge.send(IpcChannel.SessionList)) as SessionInfo[];
    for (const info of list) {
      if (info.kind === 'pane') continue;
      this.upsertSession(info);
    }
    if (!this.state.focusedId && this.state.tabOrder[0]) this.focus(this.state.tabOrder[0]);

    // Tick sidebar time-in-state once per second.
    this.tickHandle = setInterval(() => this.render(), 1_000);

    this.render();
  }

  // --- Public actions invoked by TabStrip/Sidebar callbacks and keyboard ---

  async newTab(): Promise<void> {
    await this.openNewTabDialog();
  }

  /** Snapshot of the open sessions in tab order — used by the command palette. */
  listSessions(): Array<{ info: SessionInfo; resumeAt: number | null; active: boolean }> {
    return this.state.tabOrder
      .map((id) => this.state.sessions.get(id))
      .filter((s): s is SessionState => !!s)
      .map((s) => ({ info: s.info, resumeAt: s.resumeAt, active: s.info.id === this.state.focusedId }));
  }

  async openSettings(): Promise<void> {
    const mount = document.getElementById('dialog-mount');
    if (!mount) return;
    // Suspend the terminal overlay before any async work so the modal is never obscured.
    this.dialogOpen = true;
    this.sendModalState();
    let result: AppSettings | null;
    try {
      const current = (await this.bridge.send(IpcChannel.SettingsGet)) as AppSettings;
      result = await showSettingsDialog(mount, current);
    } finally {
      this.dialogOpen = false;
      this.sendModalState();
    }
    if (!result) return;
    await this.bridge.send(IpcChannel.SettingsUpdate, result);
  }

  async openAbout(): Promise<void> {
    const mount = document.getElementById('dialog-mount');
    if (!mount) return;
    this.dialogOpen = true;
    this.sendModalState();
    try {
      const info = (await this.bridge.send(IpcChannel.ChromeAppInfo)) as ChromeAppInfoResponse;
      await showAboutDialog(mount, info);
    } finally {
      this.dialogOpen = false;
      this.sendModalState();
    }
  }

  /** Cancel a pending auto-resume (badge cancel control). */
  cancelResume(sessionId: SessionId): void {
    void this.bridge.send(IpcChannel.ResumeCancel, { sessionId });
    const session = this.state.sessions.get(sessionId);
    if (session) {
      session.resumeAt = null;
      this.render();
    }
  }

  async openNewTabDialog(): Promise<void> {
    const mount = document.getElementById('dialog-mount');
    if (!mount) return;
    // Suspend the terminal overlay so the modal is visible, restore it afterwards.
    this.dialogOpen = true;
    this.sendModalState();
    let result: { shell: Shell; cwd: string } | null;
    try {
      result = await showNewSessionDialog(mount, {
        defaultShell: this.platformDefaultShell(),
        defaultCwd: this.platformDefaultCwd(),
      });
    } finally {
      this.dialogOpen = false;
      this.sendModalState();
    }
    if (!result) return;
    const info = (await this.bridge.send(IpcChannel.SessionCreate, {
      shell: result.shell,
      cwd: result.cwd,
      cols: 80,
      rows: 24,
    })) as SessionInfo | { error: string };
    if ('error' in info) {
      console.error('[chrome] new tab failed:', info.error);
    }
  }

  private async openRecentTab(recent: RecentTab): Promise<void> {
    const info = (await this.bridge.send(IpcChannel.SessionCreate, {
      shell: recent.shell,
      cwd:   recent.cwd,
      cols:  80,
      rows:  24,
    })) as SessionInfo | { error: string };
    if ('error' in info) console.error('[chrome] open recent failed:', info.error);
  }

  private platformDefaultShell(): Shell {
    if (this.detectedDefaultShell) return this.detectedDefaultShell;
    // Fallback before LayoutDefaultShell resolves (or if it failed): a platform guess
    // only, since the chrome cannot itself check whether pwsh.exe is on PATH.
    const ua = navigator.userAgent;
    if (ua.includes('Windows')) return 'pwsh';
    if (ua.includes('Mac OS')) return 'zsh';
    return 'bash';
  }

  private platformDefaultCwd(): string {
    // Prefer the most recent session's cwd; otherwise the configured default working
    // directory from settings; otherwise the real home directory fetched from main at startup.
    for (const id of this.state.tabOrder) {
      const cwd = this.state.sessions.get(id)?.info.cwd;
      if (cwd) return cwd;
    }
    if (this.defaultCwdSetting) return this.defaultCwdSetting;
    return this.homeCwd;
  }

  async closeTab(sessionId: SessionId): Promise<void> {
    const session = this.state.sessions.get(sessionId);
    if (session) {
      const entry: RecentTab = {
        title:    session.info.title || session.info.shell,
        cwd:      session.info.cwd,
        shell:    session.info.shell,
        closedAt: Date.now(),
      };
      try {
        const updated = (await this.bridge.send(IpcChannel.RecentAdd, { entry })) as RecentTab[];
        this.state.recentTabs = updated;
      } catch (e) { console.warn('[chrome] RecentAdd failed:', e); }
    }
    await this.bridge.send(IpcChannel.SessionClose, { sessionId });
    // Local cleanup happens lazily on the SessionExited event. Optimistically remove tab
    // ordering so the UI feels responsive.
    this.state.sessions.delete(sessionId);
    this.state.tabOrder = this.state.tabOrder.filter((id) => id !== sessionId);
    if (this.state.focusedId === sessionId) {
      this.state.focusedId = this.state.tabOrder[this.state.tabOrder.length - 1] ?? null;
      if (this.state.focusedId) void this.bridge.send(IpcChannel.LayoutShow, { sessionId: this.state.focusedId });
    }
    // Critical #3: the closed tab's docState (and its reader, if open) went away with it.
    // Without this, closing a tab with the reader open left the dead tab's reader
    // rendered and the terminal view suspended indefinitely (LayoutModal stuck open).
    this.syncReader();
    this.render();
  }

  reorderTab(draggedId: SessionId, beforeId: SessionId | null): void {
    const dragIdx = this.state.tabOrder.indexOf(draggedId);
    if (dragIdx < 0) return;
    const [moved] = this.state.tabOrder.splice(dragIdx, 1);
    if (!moved) return;
    if (beforeId === null) {
      this.state.tabOrder.push(moved);
    } else {
      const beforeIdx = this.state.tabOrder.indexOf(beforeId);
      this.state.tabOrder.splice(beforeIdx, 0, moved);
    }
    // Persist the new order so it survives a restart.
    void this.bridge.send(IpcChannel.LayoutReorderTabs, { order: [...this.state.tabOrder] });
    this.render();
  }

  async renameTab(sessionId: SessionId): Promise<void> {
    const session = this.state.sessions.get(sessionId);
    if (!session) return;
    const mount = document.getElementById('dialog-mount');
    if (!mount) return;
    this.dialogOpen = true;
    this.sendModalState();
    let newTitle: string | null;
    try {
      newTitle = await showRenameDialog(mount, session.info.title);
    } finally {
      this.dialogOpen = false;
      this.sendModalState();
    }
    if (!newTitle) return;
    // Main echoes SessionTitleChanged, which updates local state + persists.
    await this.bridge.send(IpcChannel.SessionSetTitle, { sessionId, title: newTitle });
  }

  async duplicateTab(sessionId: SessionId): Promise<void> {
    const session = this.state.sessions.get(sessionId);
    if (!session) return;
    const info = (await this.bridge.send(IpcChannel.SessionCreate, {
      shell: session.info.shell,
      cwd: session.info.cwd,
      cols: 80,
      rows: 24,
    })) as SessionInfo | { error: string };
    if ('error' in info) console.error('[chrome] duplicate failed:', info.error);
  }

  /** Restart a broken tab (recreate its renderer) or an exited tab (fresh shell).
   * A running tab is left untouched. */
  async restartTab(sessionId: SessionId): Promise<void> {
    const session = this.state.sessions.get(sessionId);
    if (!session) return;
    if (session.broken) {
      await this.bridge.send(IpcChannel.SessionRestartView, { sessionId });
      session.broken = false;
      this.render();
    } else if (session.info.status === 'exited') {
      await this.duplicateTab(sessionId);
      await this.closeTab(sessionId);
    }
  }

  focus(sessionId: SessionId): void {
    if (!this.state.sessions.has(sessionId)) return;
    this.state.focusedId = sessionId;
    const session = this.state.sessions.get(sessionId)!;
    if (session.attention) {
      session.attention = false; // clear badge on focus
    }
    void this.bridge.send(IpcChannel.LayoutShow, { sessionId });
    this.syncReader();
    this.render();
  }

  focusNext(): void {
    if (this.state.tabOrder.length === 0) return;
    const idx = this.state.focusedId ? this.state.tabOrder.indexOf(this.state.focusedId) : -1;
    const next = this.state.tabOrder[(idx + 1) % this.state.tabOrder.length]!;
    this.focus(next);
  }

  focusPrev(): void {
    if (this.state.tabOrder.length === 0) return;
    const idx = this.state.focusedId ? this.state.tabOrder.indexOf(this.state.focusedId) : 0;
    const prev = this.state.tabOrder[(idx - 1 + this.state.tabOrder.length) % this.state.tabOrder.length]!;
    this.focus(prev);
  }

  focusIndex(oneBasedIndex: number): void {
    const target = this.state.tabOrder[oneBasedIndex - 1];
    if (target) this.focus(target);
  }

  closeFocused(): void {
    if (this.state.focusedId) void this.closeTab(this.state.focusedId);
  }

  toggleSidebar(): void {
    this.state.sidebarOpen = !this.state.sidebarOpen;
    this.bodyEl.classList.toggle('sidebar-collapsed', !this.state.sidebarOpen);
    document.body.classList.toggle('sidebar-collapsed', !this.state.sidebarOpen);
    const widthPx = this.state.sidebarOpen ? 260 : 56;
    void this.bridge.send(IpcChannel.LayoutSetSidebarWidth, { widthPx });
    this.render();
  }

  // --- Internals ---

  private upsertSession(info: SessionInfo): void {
    const existing = this.state.sessions.get(info.id);
    if (existing) {
      const statusChanged = existing.info.status !== info.status;
      existing.info = info;
      if (statusChanged) existing.statusSinceMs = Date.now();
    } else {
      const fresh: SessionState = {
        info,
        attention: false,
        broken: false,
        statusSinceMs: Date.now(),
        resumeAt: null,
        docState: emptyDocState(),
      };
      this.state.sessions.set(info.id, fresh);
      this.state.tabOrder.push(info.id);
      void this.restoreDocs(info.id);
    }
    this.render();
  }

  private focusedDocState(): SessionState | undefined {
    return this.state.focusedId ? this.state.sessions.get(this.state.focusedId) : undefined;
  }

  /** Whether the reader is currently showing a doc for the focused tab. */
  private isReaderVisible(): boolean {
    const ds = this.focusedDocState()?.docState;
    return !!(ds && ds.readerVisible && ds.activeDocIndex !== null && ds.openDocs.length > 0);
  }

  /** The combined suspend-request state main should see: suspended while the reader
   * OR a chrome dialog is open, so one closing doesn't resume the terminal view out
   * from under the other still being open (Critical #3). */
  private sendModalState(): void {
    void this.bridge.send(IpcChannel.LayoutModal, { open: this.isReaderVisible() || this.dialogOpen });
  }

  /** Show or hide the reader to match the focused tab's doc state. */
  private syncReader(): void {
    if (this.isReaderVisible()) {
      this.docReader.render(this.focusedDocState()!.docState, this.state.focusedId!);
    } else {
      this.docReader.render(emptyDocState(), this.state.focusedId ?? '');
    }
    this.sendModalState();
  }

  private dismissReader(): void {
    const session = this.focusedDocState();
    if (!session) return;
    session.docState = { ...session.docState, readerVisible: false };
    this.persistDocs(session.info.id);
    this.syncReader();
    this.render();
  }

  private selectDoc(index: number): void {
    const session = this.focusedDocState();
    if (!session) return;
    session.docState = { ...session.docState, activeDocIndex: index, readerVisible: true };
    this.persistDocs(session.info.id);
    this.syncReader();
    this.render();
  }

  private closeDoc(index: number): void {
    const session = this.focusedDocState();
    if (!session) return;
    session.docState = closeDocAt(session.docState, index);
    this.persistDocs(session.info.id);
    this.syncReader();
    this.render();
  }

  private reviewDoc(index: number, review: ReviewState): void {
    const session = this.focusedDocState();
    if (!session) return;
    session.docState = setReview(session.docState, index, review);
    this.persistDocs(session.info.id);
    this.syncReader();
  }

  private moveDoc(delta: number): void {
    const session = this.focusedDocState();
    if (!session) return;
    session.docState = moveActive(session.docState, delta);
    this.persistDocs(session.info.id);
    this.syncReader();
    this.render();
  }

  private persistDocs(tabId: SessionId): void {
    const session = this.state.sessions.get(tabId);
    if (!session) return;
    const { docs, activeDocIndex } = toPersistedDocs(session.docState);
    void this.bridge.send(IpcChannel.LayoutPersistDocs, { tabId, docs, activeDocIndex });
  }

  private async restoreDocs(tabId: SessionId): Promise<void> {
    let res: { docs: unknown[]; activeDocIndex: number | null } | { error: string };
    try {
      res = (await this.bridge.send(IpcChannel.LayoutDocsForTab, { tabId })) as typeof res;
    } catch { return; }
    if (!res || 'error' in res || !res.docs || res.docs.length === 0) return;
    const session = this.state.sessions.get(tabId);
    if (!session) return;
    session.docState = fromPersistedDocs(res.docs as never, res.activeDocIndex);
    this.render();
  }

  private render(): void {
    const tabs: TabViewModel[] = this.state.tabOrder
      .map((id) => this.state.sessions.get(id))
      .filter((s): s is SessionState => !!s)
      .map((s) => ({
        info: s.info,
        attention: s.attention,
        broken: s.broken,
        resumeAt: s.resumeAt,
        hasDoc: s.docState.activeDocIndex !== null,
      }));
    this.tabStrip.render(tabs, this.state.focusedId);

    const rows: SidebarRowVm[] = this.state.tabOrder
      .map((id) => this.state.sessions.get(id))
      .filter((s): s is SessionState => !!s)
      .map((s) => ({ info: s.info, attention: s.attention, statusSinceMs: s.statusSinceMs, resumeAt: s.resumeAt }));
    this.sidebar.render(rows, this.state.focusedId);

    const countEl = document.getElementById('sidebar-count');
    if (countEl) countEl.textContent = `${rows.length} active`;

    const isEmpty = this.state.tabOrder.length === 0;
    this.emptyStateHostEl.hidden = !isEmpty;
    if (isEmpty) {
      this.emptyStateView.render(this.state.recentTabs, {
        onNew:        () => void this.openNewTabDialog(),
        onPickRecent: (r) => void this.openRecentTab(r),
      });
    }

    this.updateTitleBar();
  }

  /** Reflect the focused session in the top bar's breadcrumb + subtitle. */
  private updateTitleBar(): void {
    if (!this.titleBar) return;
    const focused = this.state.focusedId ? this.state.sessions.get(this.state.focusedId) : undefined;
    if (!focused) {
      this.titleBar.setContext({ project: '', subtitle: '' });
      return;
    }
    const { info } = focused;
    const status = focused.resumeAt !== null ? 'rate-limited' : statusLabel(info.status);
    this.titleBar.setContext({
      project: cwdBasename(info.cwd),
      subtitle: `${info.title || info.shell} · ${status}`,
    });
  }
}

/** Last path segment of a cwd, tolerant of both separators and trailing slashes. */
function cwdBasename(cwd: string): string {
  const parts = cwd.split(/[/\\]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : cwd;
}

function statusLabel(status: SessionInfo['status']): string {
  switch (status) {
    case 'awaiting-input': return 'awaiting input';
    case 'running':        return 'running';
    case 'starting':       return 'starting';
    case 'exited':         return 'exited';
    default:               return status;
  }
}
