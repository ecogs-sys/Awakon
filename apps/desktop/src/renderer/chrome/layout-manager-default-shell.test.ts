// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./new-session-dialog.js', () => ({
  showNewSessionDialog: vi.fn().mockResolvedValue(null),
  showRenameDialog: vi.fn(),
}));
vi.mock('./settings-dialog.js', () => ({
  showSettingsDialog: vi.fn().mockResolvedValue(null),
}));
vi.mock('./about-dialog.js', () => ({
  showAboutDialog: vi.fn().mockResolvedValue(undefined),
}));

import { LayoutManager } from './layout-manager.js';
import { showNewSessionDialog } from './new-session-dialog.js';
import { IpcChannel } from '@awakon/contracts';
import type { PreloadBridge } from '@awakon/terminal-host';
import type { TabStrip } from './tab-strip.js';
import type { Sidebar } from './sidebar.js';

function makeBridge(defaultShell: unknown) {
  const handlers = new Map<string, (raw: unknown) => void>();
  return {
    send: vi.fn().mockImplementation((channel: string) => {
      if (channel === IpcChannel.LayoutDefaultShell) return Promise.resolve(defaultShell);
      if (channel === IpcChannel.LayoutDefaultCwd) return Promise.resolve('/home/user');
      if (channel === IpcChannel.SettingsGet) return Promise.resolve({
        autoResume: { enabled: false, detectText: '', responseText: '' },
        defaultCwd: '',
      });
      if (channel === IpcChannel.SessionList) return Promise.resolve([]);
      if (channel === IpcChannel.RecentList) return Promise.resolve([]);
      return Promise.resolve(undefined);
    }),
    on: vi.fn().mockImplementation((ch: string, h: (raw: unknown) => void) => {
      handlers.set(ch, h);
    }),
    _fire: (ch: string, payload: unknown) => handlers.get(ch)?.(payload),
  };
}

function makeLayout(bridge: ReturnType<typeof makeBridge>) {
  const tabStrip = { render: vi.fn() } as unknown as TabStrip;
  const sidebar = { render: vi.fn() } as unknown as Sidebar;
  const bodyEl = document.createElement('div');
  const mount = document.createElement('div');
  mount.id = 'dialog-mount';
  const emptyStateHostEl = document.createElement('div');
  emptyStateHostEl.id = 'empty-state-host';
  emptyStateHostEl.hidden = true;
  const viewHostEl = document.createElement('div');
  document.body.appendChild(mount);
  document.body.appendChild(emptyStateHostEl);
  document.body.appendChild(viewHostEl);
  return new LayoutManager({ bridge: bridge as unknown as PreloadBridge, tabStrip, sidebar, bodyEl, emptyStateHostEl, viewHostEl, platform: 'win32' });
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('LayoutManager — default shell from main (B3)', () => {
  it('fetches LayoutDefaultShell on startup', async () => {
    const bridge = makeBridge('powershell');
    const lm = makeLayout(bridge);
    await lm.start();
    expect(bridge.send).toHaveBeenCalledWith(IpcChannel.LayoutDefaultShell);
  });

  it('prefills the New Session dialog with the probed shell rather than assuming pwsh', async () => {
    // On a clean Windows machine main probes PATH and reports 'powershell' (pwsh.exe
    // absent) — the dialog must reflect that, not silently default to 'pwsh' and
    // fail the spawn on submit.
    const bridge = makeBridge('powershell');
    const lm = makeLayout(bridge);
    await lm.start();
    await lm.openNewTabDialog();
    expect(showNewSessionDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ defaultShell: 'powershell' }),
    );
  });
});
