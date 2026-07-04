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
import { TabStrip } from './tab-strip.js';
import { IpcChannel } from '@awakon/contracts';
import type { SessionInfo } from '@awakon/contracts';
import type { PreloadBridge } from '@awakon/terminal-host';
import type { Sidebar } from './sidebar.js';

function sessionInfo(id: string): SessionInfo {
  return {
    id, title: id, shell: 'pwsh', cwd: '/x',
    status: 'running', kind: 'tab', pid: 1, exitCode: null,
  };
}

type BridgeMock = {
  send: ReturnType<typeof vi.fn>;
  on:   ReturnType<typeof vi.fn>;
  _fire: (channel: string, payload: unknown) => void;
};

function makeBridge(): BridgeMock {
  const handlers = new Map<string, (raw: unknown) => void>();
  return {
    send: vi.fn().mockImplementation((channel: string) => {
      if (channel === IpcChannel.LayoutDefaultCwd) return Promise.resolve('/home');
      if (channel === IpcChannel.SettingsGet) return Promise.resolve({
        autoResume: { enabled: false, detectText: '', responseText: '' },
        defaultCwd: '', recentTabs: [],
      });
      if (channel === IpcChannel.SessionList) return Promise.resolve([]);
      if (channel === IpcChannel.RecentList)  return Promise.resolve([]);
      if (channel === IpcChannel.LayoutDocsForTab) return Promise.resolve({ docs: [], activeDocIndex: null });
      return Promise.resolve({ ok: true });
    }),
    on: vi.fn().mockImplementation((channel: string, handler: (raw: unknown) => void) => {
      handlers.set(channel, handler);
    }),
    _fire: (channel: string, payload: unknown) => handlers.get(channel)?.(payload),
  };
}

function makeLayout(bridge: BridgeMock) {
  const tabStripEl = document.createElement('div');
  tabStripEl.id = 'tab-strip';
  const bodyEl = document.createElement('div');
  bodyEl.id = 'body';
  const viewHostEl = document.createElement('div');
  viewHostEl.id = 'view-host';
  bodyEl.appendChild(viewHostEl);
  const emptyStateHostEl = document.createElement('div');
  emptyStateHostEl.id = 'empty-state-host';
  emptyStateHostEl.hidden = true;
  const mount = document.createElement('div');
  mount.id = 'dialog-mount';

  document.body.appendChild(tabStripEl);
  document.body.appendChild(bodyEl);
  document.body.appendChild(emptyStateHostEl);
  document.body.appendChild(mount);

  const tabStrip = new TabStrip(tabStripEl, {
    onTabClick: vi.fn(),
    onTabClose: vi.fn(),
    onNewTab: vi.fn(),
    onTabReorder: vi.fn(),
  });
  const sidebar = { render: vi.fn() } as unknown as Sidebar;

  const lm = new LayoutManager({
    bridge: bridge as unknown as PreloadBridge,
    tabStrip, sidebar, bodyEl, emptyStateHostEl, viewHostEl,
    platform: 'linux',
  });
  return { lm, viewHostEl, tabStripEl };
}

function docOpenPayload(tabId: string) {
  return {
    tabId,
    rawPath: './docs/spec.md',
    resolvedPath: '/x/docs/spec.md',
    provenanceTitle: tabId,
    provenanceStatus: 'running' as const,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('LayoutManager — doc reader orchestration', () => {
  it('opens the reader and suspends the terminal overlay on DocOpenRequest for the focused tab', async () => {
    const bridge = makeBridge();
    const { lm, viewHostEl } = makeLayout(bridge);
    await lm.start();

    bridge._fire(IpcChannel.SessionCreated, { info: sessionInfo('t1') });
    bridge._fire(IpcChannel.DocOpenRequest, docOpenPayload('t1'));

    expect(viewHostEl.querySelector('.aip-reader')).not.toBeNull();
    const modalOpen = bridge.send.mock.calls.find(
      (c: unknown[]) => c[0] === IpcChannel.LayoutModal && (c[1] as { open: boolean }).open === true,
    );
    expect(modalOpen).toBeDefined();
  });

  it('persists docs when a doc is opened', async () => {
    const bridge = makeBridge();
    const { lm } = makeLayout(bridge);
    await lm.start();

    bridge._fire(IpcChannel.SessionCreated, { info: sessionInfo('t1') });
    bridge._fire(IpcChannel.DocOpenRequest, docOpenPayload('t1'));

    const persist = bridge.send.mock.calls.find((c: unknown[]) => c[0] === IpcChannel.LayoutPersistDocs);
    expect(persist).toBeDefined();
  });

  it('shows a doc marker on the tab after a doc is opened', async () => {
    const bridge = makeBridge();
    const { lm, tabStripEl } = makeLayout(bridge);
    await lm.start();

    bridge._fire(IpcChannel.SessionCreated, { info: sessionInfo('t1') });
    bridge._fire(IpcChannel.DocOpenRequest, docOpenPayload('t1'));

    expect(tabStripEl.querySelector('.tab .doc-marker')).not.toBeNull();
  });

  it('parks the reader when focus moves to another tab, keeping the marker on the origin tab', async () => {
    const bridge = makeBridge();
    const { lm, viewHostEl, tabStripEl } = makeLayout(bridge);
    await lm.start();

    bridge._fire(IpcChannel.SessionCreated, { info: sessionInfo('t1') });
    bridge._fire(IpcChannel.DocOpenRequest, docOpenPayload('t1'));
    expect(viewHostEl.querySelector('.aip-reader')).not.toBeNull();

    // Creating a second tab focuses it, parking t1's reader.
    bridge._fire(IpcChannel.SessionCreated, { info: sessionInfo('t2') });

    expect(viewHostEl.querySelector('.aip-reader')).toBeNull();
    // The marker stays on t1's tab.
    const t1Tab = tabStripEl.querySelector('.tab[data-session-id="t1"]');
    expect(t1Tab?.querySelector('.doc-marker')).not.toBeNull();
  });
});
