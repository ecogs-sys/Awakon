import './styles/tokens.css';
import './styles/chrome.css';
import type { PreloadBridge } from '@awakon/terminal-host';
import { TabStrip } from './tab-strip.js';
import { Sidebar } from './sidebar.js';
import { TitleBar } from './titlebar.js';
import { LayoutManager } from './layout-manager.js';
import { wireKeyboard, routeMenuAction, type KeyboardCallbacks } from './keyboard.js';
import { CommandPalette, type PaletteCommand } from './command-palette.js';
import { shellChip } from './empty-state.js';
import { Bindings, formatAccelerator } from '@awakon/keymap';
import { IpcChannel } from '@awakon/contracts';

const bridge = (window as unknown as { awakon: PreloadBridge }).awakon;

const tabStripEl = document.getElementById('tab-strip')!;
const sidebarListEl = document.getElementById('sidebar-list')!;
const sidebarOverviewEl = document.getElementById('sidebar-overview');
const sidebarToggleEl = document.getElementById('sidebar-toggle')!;
const sidebarNewEl = document.getElementById('sidebar-new');
const sidebarSortEl = document.getElementById('sidebar-sort');
const sidebarRailSummaryEl = document.getElementById('sidebar-rail-summary');
const sidebarRailListEl = document.getElementById('sidebar-rail-list');
const sidebarRailExpandEl = document.getElementById('sidebar-rail-expand');
const sidebarRailNewEl = document.getElementById('sidebar-rail-new');
const bodyEl = document.getElementById('body')!;
const emptyStateHostEl = document.getElementById('empty-state-host')!;
const viewHostEl = document.getElementById('view-host')!;
const titlebarEl = document.getElementById('titlebar')!;

const platform = navigator.userAgent.includes('Mac OS') ? 'darwin'
              : navigator.userAgent.includes('Windows') ? 'win32'
              : 'linux';

const manager = new LayoutManager({
  bridge,
  bodyEl,
  emptyStateHostEl,
  viewHostEl,
  platform,
  tabStrip: new TabStrip(tabStripEl, {
    onTabClick: (id) => manager.focus(id),
    onTabClose: (id) => void manager.closeTab(id),
    onNewTab: () => void manager.newTab(),
    onTabReorder: (id, before) => manager.reorderTab(id, before),
  }, platform),
  sidebar: new Sidebar({
    listEl: sidebarListEl,
    overviewEl: sidebarOverviewEl,
    toggleEl: sidebarToggleEl,
    newEl: sidebarNewEl,
    sortEl: sidebarSortEl,
    railSummaryEl: sidebarRailSummaryEl,
    railListEl: sidebarRailListEl,
    railExpandEl: sidebarRailExpandEl,
    railNewEl: sidebarRailNewEl,
    callbacks: {
      onRowClick: (id) => manager.focus(id),
      onToggle: () => manager.toggleSidebar(),
      onRename: (id) => void manager.renameTab(id),
      onDuplicate: (id) => void manager.duplicateTab(id),
      onRestart: (id) => void manager.restartTab(id),
      onClose: (id) => void manager.closeTab(id),
      onResumeCancel: (id) => manager.cancelResume(id),
      onNewSession: () => void manager.newTab(),
    },
  }),
});

const fmt = (accelerator: string): string => formatAccelerator(accelerator, platform);

// L6: these hints previously hardcoded "Ctrl+T"/"Ctrl+B" in index.html, which is
// wrong on macOS. Set them here from the shared Bindings + formatAccelerator so
// they can never drift from the actual accelerator.
const newTabHint = `New session (${fmt(Bindings.newTab.accelerator)})`;
const sidebarHint = `sidebar (${fmt(Bindings.toggleSidebar.accelerator)})`;
sidebarNewEl?.setAttribute('title', newTabHint);
sidebarToggleEl.title = `Toggle ${sidebarHint}`;
sidebarRailExpandEl?.setAttribute('title', `Expand ${sidebarHint}`);
sidebarRailNewEl?.setAttribute('title', newTabHint);
const jumpAccel = (i: number): string | undefined =>
  i < 9 ? fmt(Bindings[`jumpTab${i + 1}` as 'jumpTab1'].accelerator) : undefined;

const palette = new CommandPalette({
  hotkeyLabel: fmt(Bindings.commandPalette.accelerator),
  // Suspend the native terminal WebContentsView while the palette is up, else the
  // overlay renders behind it and is invisible (same treatment as chrome modals).
  onVisibilityChange: (open) => void bridge.send(IpcChannel.LayoutModal, { open }),
  buildCommands: () => {
    const cmds: PaletteCommand[] = [];
    manager.listSessions().forEach((s, i) => {
      cmds.push({
        id: `session:${s.info.id}`,
        group: 'Switch to session',
        title: s.info.title || s.info.shell,
        meta: s.info.cwd,
        chip: shellChip(s.info.shell),
        status: paletteStatus(s.info.status, s.resumeAt),
        ...(jumpAccel(i) ? { accel: jumpAccel(i)! } : {}),
        run: () => manager.focus(s.info.id),
      });
    });
    cmds.push(
      { id: 'act:new',      group: 'Actions', title: 'New session',    chip: '+', accel: fmt(Bindings.newTab.accelerator),        run: () => void manager.newTab() },
      { id: 'act:settings', group: 'Actions', title: 'Settings…',      chip: '⚙', accel: fmt('CmdOrCtrl+,'),                       run: () => void manager.openSettings() },
      { id: 'act:sidebar',  group: 'Actions', title: 'Toggle sidebar', chip: '▤', accel: fmt(Bindings.toggleSidebar.accelerator), run: () => manager.toggleSidebar() },
      { id: 'act:about',    group: 'Actions', title: 'About Awakon…',  chip: 'i',                                                 run: () => void manager.openAbout() },
      { id: 'act:close',    group: 'Actions', title: 'Close tab',      chip: '×', accel: fmt(Bindings.closeTab.accelerator),      run: () => manager.closeFocused() },
    );
    return cmds;
  },
});

const titleBar = new TitleBar(titlebarEl, {
  bridge,
  platform,
  onOpenSettings: () => void manager.openSettings(),
  onOpenPalette: () => palette.open(),
});
manager.attachTitleBar(titleBar);

void manager.start();

// Report the viewport size to main so it can position the terminal WebContentsView. The
// renderer is the authoritative size source: it always reflows on maximize/resize, whereas
// the main process's getContentBounds() is unreliable on some Linux WMs. Coalesce bursts
// of resize events with rAF and send the settled size.
let viewportRaf = 0;
const reportViewport = (): void => {
  viewportRaf = 0;
  void bridge.send(IpcChannel.LayoutViewportSize, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
};
window.addEventListener('resize', () => {
  if (viewportRaf) return;
  viewportRaf = requestAnimationFrame(reportViewport);
});
reportViewport(); // initial size

// Expose for keyboard handler (T14).
(window as unknown as { __awakonLayout: LayoutManager }).__awakonLayout = manager;

// Shared by both shortcut paths: the menu accelerator's ActionInvoke pipe (fires when
// a terminal view has focus, and always on macOS) and the chrome document-keydown
// handler (the only path that runs on Windows/Linux while the chrome itself has
// keyboard focus — empty state, palette open, sidebar/titlebar interactions). The two
// paths can never double-fire for one keypress: keydown preventDefaults the key, which
// suppresses the Win/Linux accelerator, and on macOS the menu consumes the key
// equivalent before the renderer sees it.
const keyboardCallbacks: KeyboardCallbacks = {
  commandPalette: () => palette.toggle(),
  terminalAction: (action) => void bridge.send(IpcChannel.ChromeTerminalAction, { action }),
};

bridge.on(IpcChannel.ActionInvoke, (raw) => {
  const { action } = raw as { action: string };
  routeMenuAction(manager, keyboardCallbacks, action);
});

wireKeyboard(manager, keyboardCallbacks);

console.info('[chrome] mounted');

/** Map a session's status (+ pending resume) to a palette pill style. */
function paletteStatus(status: string, resumeAt: number | null): 'running' | 'awaiting' | 'limited' | 'idle' {
  if (resumeAt !== null) return 'limited';
  if (status === 'running' || status === 'starting') return 'running';
  if (status === 'awaiting-input') return 'awaiting';
  return 'idle';
}
