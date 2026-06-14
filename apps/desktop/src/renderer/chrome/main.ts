import './styles/tokens.css';
import './styles/chrome.css';
import type { PreloadBridge } from '@awakon/terminal-host';
import { TabStrip } from './tab-strip.js';
import { Sidebar } from './sidebar.js';
import { TitleBar } from './titlebar.js';
import { LayoutManager } from './layout-manager.js';
import { wireKeyboard, routeMenuAction } from './keyboard.js';
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
new TitleBar(titlebarEl, { bridge, platform });

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
  routeMenuAction(manager, action);
});

wireKeyboard(manager);

console.info('[chrome] mounted');
