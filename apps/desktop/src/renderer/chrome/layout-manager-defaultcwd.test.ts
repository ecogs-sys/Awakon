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
import type { TabStrip } from './tab-strip.js';
import type { Sidebar } from './sidebar.js';
import type { PreloadBridge } from '@awakon/terminal-host';

type BridgeMock = {
  send: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  _fire: (channel: string, payload: unknown) => void;
};

function makeBridge(defaultCwd = ''): BridgeMock {
  const handlers = new Map<string, (raw: unknown) => void>();
  return {
    send: vi.fn().mockImplementation((channel: string) => {
      if (channel === IpcChannel.LayoutDefaultCwd) return Promise.resolve('/home/user');
      if (channel === IpcChannel.SettingsGet) return Promise.resolve({
        autoResume: { enabled: false, detectText: '', responseText: '' },
        defaultCwd,
      });
      if (channel === IpcChannel.SessionList) return Promise.resolve([]);
      if (channel === IpcChannel.RecentList) return Promise.resolve([]);
      return Promise.resolve(undefined);
    }),
    on: vi.fn().mockImplementation((channel: string, handler: (raw: unknown) => void) => {
      handlers.set(channel, handler);
    }),
    _fire: (channel: string, payload: unknown) => handlers.get(channel)?.(payload),
  };
}

function makeLayout(bridge: BridgeMock) {
  const tabStrip = { render: vi.fn() } as unknown as TabStrip;
  const sidebar = { render: vi.fn() } as unknown as Sidebar;
  const bodyEl = document.createElement('div');
  const mount = document.createElement('div');
  mount.id = 'dialog-mount';
  const emptyStateHostEl = document.createElement('div');
  emptyStateHostEl.id = 'empty-state-host';
  document.body.appendChild(mount);
  document.body.appendChild(emptyStateHostEl);
  return new LayoutManager({ bridge: bridge as unknown as PreloadBridge, tabStrip, sidebar, bodyEl, emptyStateHostEl });
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('LayoutManager — defaultCwd setting in platformDefaultCwd', () => {
  it('passes configured defaultCwd as defaultCwd when no sessions are open', async () => {
    const bridge = makeBridge('/my/workspace');
    const lm = makeLayout(bridge);
    await lm.start();

    await lm.openNewTabDialog();

    expect(showNewSessionDialog).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ defaultCwd: '/my/workspace' }),
    );
  });

  it('falls back to homeCwd when defaultCwd setting is empty and no sessions are open', async () => {
    const bridge = makeBridge('');
    const lm = makeLayout(bridge);
    await lm.start();

    await lm.openNewTabDialog();

    expect(showNewSessionDialog).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ defaultCwd: '/home/user' }),
    );
  });

  it('updates the cached setting when SettingsChanged fires', async () => {
    const bridge = makeBridge('/initial');
    const lm = makeLayout(bridge);
    await lm.start();

    bridge._fire(IpcChannel.SettingsChanged, {
      autoResume: { enabled: false, detectText: '', responseText: '' },
      defaultCwd: '/updated/path',
    });

    await lm.openNewTabDialog();

    expect(showNewSessionDialog).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ defaultCwd: '/updated/path' }),
    );
  });
});
