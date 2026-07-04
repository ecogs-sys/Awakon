import { Menu, type MenuItemConstructorOptions, BrowserWindow, type WebContentsView } from 'electron';
import { Bindings } from '@awakon/keymap';
import { IpcChannel } from '@awakon/contracts';

function send(action: string, chromeWindow: () => BrowserWindow | null): void {
  const win = chromeWindow();
  win?.webContents.send(IpcChannel.ActionInvoke, { action });
}

export type MenuName = 'File' | 'Tabs' | 'View' | 'Window' | 'Help';

/** Templates per top-level menu so the custom titlebar can pop them individually.
 * `buildAppMenu` composes the same templates into the OS application menu. */
function buildTemplates(
  chromeWindow: () => BrowserWindow | null,
  getActiveTerminalView: () => WebContentsView | null,
): Record<MenuName, MenuItemConstructorOptions[]> {
  function sendTerminal(action: 'splitHorizontal' | 'splitVertical' | 'closePane'): void {
    const view = getActiveTerminalView();
    view?.webContents.send(IpcChannel.TerminalAction, { action });
  }

  const fileSubmenu: MenuItemConstructorOptions[] = [
    { role: 'quit' },
  ];

  const tabsSubmenu: MenuItemConstructorOptions[] = [
    { label: 'New Tab',      accelerator: Bindings.newTab.accelerator,   click: () => send('newTab', chromeWindow) },
    { label: 'Close Tab',    accelerator: Bindings.closeTab.accelerator, click: () => send('closeTab', chromeWindow) },
    { type: 'separator' },
    { label: 'Next Tab',     accelerator: Bindings.nextTab.accelerator,  click: () => send('nextTab', chromeWindow) },
    { label: 'Previous Tab', accelerator: Bindings.prevTab.accelerator,  click: () => send('prevTab', chromeWindow) },
    { type: 'separator' },
    ...Array.from({ length: 9 }, (_, i) => {
      const id = `jumpTab${i + 1}` as 'jumpTab1';
      return {
        label: `Tab ${i + 1}`,
        accelerator: Bindings[id].accelerator,
        click: () => send(id, chromeWindow),
      };
    }),
    { type: 'separator' },
    { label: 'Split Horizontally', accelerator: Bindings.splitHorizontal.accelerator, click: () => sendTerminal('splitHorizontal') },
    { label: 'Split Vertically',   accelerator: Bindings.splitVertical.accelerator,   click: () => sendTerminal('splitVertical') },
    { label: 'Close Pane',         accelerator: Bindings.closePane.accelerator,       click: () => sendTerminal('closePane') },
  ];

  const viewSubmenu: MenuItemConstructorOptions[] = [
    { label: 'Command Palette…', accelerator: Bindings.commandPalette.accelerator, click: () => send('commandPalette', chromeWindow) },
    { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('openSettings', chromeWindow) },
    { type: 'separator' },
    { label: 'Toggle Sidebar', accelerator: Bindings.toggleSidebar.accelerator, click: () => send('toggleSidebar', chromeWindow) },
    { type: 'separator' },
    { role: 'reload' },
    { role: 'toggleDevTools' },
  ];

  const windowSubmenu: MenuItemConstructorOptions[] = [
    { role: 'togglefullscreen' },
    { type: 'separator' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { role: 'resetZoom' },
    { type: 'separator' },
    { role: 'minimize' },
    { role: 'close' },
  ];

  const helpSubmenu: MenuItemConstructorOptions[] = [
    { label: 'About Awakon…', click: () => send('openAbout', chromeWindow) },
  ];

  return {
    File: fileSubmenu,
    Tabs: tabsSubmenu,
    View: viewSubmenu,
    Window: windowSubmenu,
    Help: helpSubmenu,
  };
}

/**
 * Build the application menu. Accelerators on menu items fire OS-globally when the
 * app is focused, regardless of which WebContentsView (chrome vs. terminal) currently
 * has keyboard focus. This is the only way to make Ctrl+T / Ctrl+W / Ctrl+Tab / etc.
 * work without requiring the user to click on the chrome bar first.
 */
export function buildAppMenu(
  chromeWindow: () => BrowserWindow | null,
  getActiveTerminalView: () => WebContentsView | null,
): Menu {
  const t = buildTemplates(chromeWindow, getActiveTerminalView);
  return Menu.buildFromTemplate([
    { label: 'File',   submenu: t.File },
    { label: 'Tabs',   submenu: t.Tabs },
    { label: 'View',   submenu: t.View },
    { label: 'Window', submenu: t.Window },
    { label: 'Help',   submenu: t.Help },
  ]);
}

/** Build a one-off Menu for the named submenu so the custom titlebar can popup() it
 * at a specific (x, y). Rebuilt per call so click callbacks see fresh closures. */
export function buildSubmenu(
  name: MenuName,
  chromeWindow: () => BrowserWindow | null,
  getActiveTerminalView: () => WebContentsView | null,
): Menu {
  const t = buildTemplates(chromeWindow, getActiveTerminalView);
  return Menu.buildFromTemplate(t[name]);
}
