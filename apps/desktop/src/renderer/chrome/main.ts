import './styles/tokens.css';
import './styles/chrome.css';
import type { PreloadBridge } from '@awakon/terminal-host';
import { TabStrip } from './tab-strip.js';
import { Sidebar } from './sidebar.js';
import { TitleBar } from './titlebar.js';
import { LayoutManager } from './layout-manager.js';
import { wireKeyboard, routeMenuAction } from './keyboard.js';
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
  tabStrip: new TabStrip(tabStripEl, {
    onTabClick: (id) => manager.focus(id),
    onTabClose: (id) => void manager.closeTab(id),
    onNewTab: () => void manager.newTab(),
    onTabReorder: (id, before) => manager.reorderTab(id, before),
  }),
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
const jumpAccel = (i: number): string | undefined =>
  i < 9 ? fmt(Bindings[`jumpTab${i + 1}` as 'jumpTab1'].accelerator) : undefined;

const palette = new CommandPalette({
  hotkeyLabel: fmt(Bindings.commandPalette.accelerator),
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

bridge.on(IpcChannel.ActionInvoke, (raw) => {
  const { action } = raw as { action: string };
  // The palette is opened here (not in keyboard.ts) so the global Ctrl/⌘+K menu
  // accelerator toggles it regardless of which view currently has focus.
  if (action === 'commandPalette') { palette.toggle(); return; }
  routeMenuAction(manager, action);
});

wireKeyboard(manager);

console.info('[chrome] mounted');

/** Map a session's status (+ pending resume) to a palette pill style. */
function paletteStatus(status: string, resumeAt: number | null): 'running' | 'awaiting' | 'limited' | 'idle' {
  if (resumeAt !== null) return 'limited';
  if (status === 'running' || status === 'starting') return 'running';
  if (status === 'awaiting-input') return 'awaiting';
  return 'idle';
}
