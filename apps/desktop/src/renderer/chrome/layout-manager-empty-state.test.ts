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
import { IpcChannel } from '@awakon/contracts';
import type { RecentTab, SessionInfo, SessionId } from '@awakon/contracts';
import type { PreloadBridge } from '@awakon/terminal-host';
import type { TabStrip } from './tab-strip.js';
import type { Sidebar } from './sidebar.js';

const SAMPLE_SESSION: SessionInfo = {
  id: 'sess-1', title: 'my-project', shell: 'bash',
  cwd: '/home/me/proj', status: 'running', kind: 'tab',
  pid: 123, exitCode: null,
};

const SAMPLE_RECENT: RecentTab = {
  title: 'my-project', cwd: '/home/me/proj', shell: 'bash', closedAt: Date.now() - 1000,
};

type BridgeMock = {
  send: ReturnType<typeof vi.fn>;
  on:   ReturnType<typeof vi.fn>;
  _fire: (channel: string, payload: unknown) => void;
};

function makeBridge(recents: RecentTab[] = []): BridgeMock {
  const handlers = new Map<string, (raw: unknown) => void>();
  return {
    send: vi.fn().mockImplementation((channel: string) => {
      if (channel === IpcChannel.LayoutDefaultCwd) return Promise.resolve('/home/user');
      if (channel === IpcChannel.SettingsGet)  return Promise.resolve({
        autoResume: { enabled: false, detectText: '', responseText: '' },
        defaultCwd: '',
      });
      if (channel === IpcChannel.SessionList)  return Promise.resolve([]);
      if (channel === IpcChannel.RecentList)   return Promise.resolve(recents);
      if (channel === IpcChannel.RecentAdd)    return Promise.resolve([...recents]);
      return Promise.resolve(undefined);
    }),
    on: vi.fn().mockImplementation((ch: string, h: (raw: unknown) => void) => {
      handlers.set(ch, h);
    }),
    _fire: (ch, payload) => handlers.get(ch)?.(payload),
  };
}

function makeLayout(bridge: BridgeMock) {
  const tabStrip = { render: vi.fn() } as unknown as TabStrip;
  const sidebar  = { render: vi.fn() } as unknown as Sidebar;
  const bodyEl   = document.createElement('div');
  const mount    = document.createElement('div');
  mount.id = 'dialog-mount';
  const emptyStateHostEl = document.createElement('div');
  emptyStateHostEl.id = 'empty-state-host';
  emptyStateHostEl.hidden = true;
  const viewHostEl = document.createElement('div');
  document.body.appendChild(mount);
  document.body.appendChild(emptyStateHostEl);
  document.body.appendChild(viewHostEl);
  return new LayoutManager({ bridge: bridge as unknown as PreloadBridge, tabStrip, sidebar, bodyEl, emptyStateHostEl, viewHostEl, platform: 'linux' });
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('LayoutManager — empty state visibility', () => {
  it('shows the empty state host when no sessions are loaded', async () => {
    const bridge = makeBridge();
    const lm = makeLayout(bridge);
    await lm.start();
    const host = document.getElementById('empty-state-host')!;
    expect(host.hidden).toBe(false);
  });

  it('hides the empty state when a session is created', async () => {
    const bridge = makeBridge();
    const lm = makeLayout(bridge);
    await lm.start();
    bridge._fire(IpcChannel.SessionCreated, { info: SAMPLE_SESSION });
    const host = document.getElementById('empty-state-host')!;
    expect(host.hidden).toBe(true);
  });
});

describe('LayoutManager — recent tabs hydration', () => {
  it('calls RecentList on startup and stores the result', async () => {
    const bridge = makeBridge([SAMPLE_RECENT]);
    const lm = makeLayout(bridge);
    await lm.start();
    expect(bridge.send).toHaveBeenCalledWith(IpcChannel.RecentList);
    // After hydration, empty state should render the recent row
    const host = document.getElementById('empty-state-host')!;
    expect(host.hidden).toBe(false);
    expect(host.querySelector('.aip-empty__recent-name')?.textContent).toBe('my-project');
  });
});

describe('LayoutManager — closeTab captures recent', () => {
  it('calls RecentAdd with the closed session info', async () => {
    const bridge = makeBridge();
    const lm = makeLayout(bridge);
    await lm.start();

    // Simulate a running session
    bridge._fire(IpcChannel.SessionCreated, { info: SAMPLE_SESSION });
    // Now close it
    await lm.closeTab('sess-1' as SessionId);

    const recentAddCall = (bridge.send as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => call[0] === IpcChannel.RecentAdd,
    );
    expect(recentAddCall).toBeDefined();
    const payload = recentAddCall![1] as { entry: RecentTab };
    expect(payload.entry.cwd).toBe('/home/me/proj');
    expect(payload.entry.shell).toBe('bash');
    expect(payload.entry.title).toBe('my-project');
  });
});

describe('LayoutManager — openRecentTab', () => {
  it('calls SessionCreate with the recent entry shell and cwd', async () => {
    const bridge = makeBridge([SAMPLE_RECENT]);
    bridge.send.mockImplementation((channel: string) => {
      if (channel === IpcChannel.LayoutDefaultCwd) return Promise.resolve('/home/user');
      if (channel === IpcChannel.SettingsGet) return Promise.resolve({
        autoResume: { enabled: false, detectText: '', responseText: '' },
        defaultCwd: '',
      });
      if (channel === IpcChannel.SessionList) return Promise.resolve([]);
      if (channel === IpcChannel.RecentList)  return Promise.resolve([SAMPLE_RECENT]);
      if (channel === IpcChannel.SessionCreate) return Promise.resolve({ ...SAMPLE_SESSION, id: 'new-1' });
      return Promise.resolve(undefined);
    });
    const lm = makeLayout(bridge);
    await lm.start();

    // Click a recent row in the rendered empty state
    const host = document.getElementById('empty-state-host')!;
    (host.querySelector('.aip-empty__recent') as HTMLElement).click();

    // Wait for the async SessionCreate call
    await vi.waitFor(() => {
      const call = (bridge.send as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[0] === IpcChannel.SessionCreate,
      );
      expect(call).toBeDefined();
      expect((call as unknown[])[1]).toMatchObject({ shell: 'bash', cwd: '/home/me/proj' });
    });
  });
});
