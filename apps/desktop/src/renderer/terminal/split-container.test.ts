// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stub @awakon/terminal-host BEFORE importing SplitContainer so the test
// doesn't pull in xterm.js (which doesn't run cleanly under jsdom).
vi.mock('@awakon/terminal-host', () => {
  class StubTerminalHost {
    public selection = '';
    private _hasSel = false;
    constructor(_opts: unknown) {}
    setSelectionForTest(text: string): void {
      this.selection = text;
      this._hasSel = text.length > 0;
    }
    hasSelection(): boolean { return this._hasSel; }
    getSelection(): string { return this.selection; }
    paste(_: string): void {}
    selectAll(): void { this._hasSel = true; }
    focus(): void {}
    dispose(): void {}
  }
  return { TerminalHost: StubTerminalHost };
});

import { SplitContainer } from './split-container.js';
import type { SessionId, Shell } from '@awakon/contracts';

interface FakeBridge {
  send: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

function freshBridge(): FakeBridge {
  return {
    send: vi.fn().mockResolvedValue({ id: 'pane-1' }),
    on: vi.fn().mockReturnValue(() => {}),
  };
}

let rootEl: HTMLElement;
let bridge: FakeBridge;
let splits: SplitContainer;

beforeEach(() => {
  document.body.innerHTML = '';
  rootEl = document.createElement('div');
  document.body.appendChild(rootEl);
  bridge = freshBridge();
  splits = new SplitContainer({
    rootEl,
    bridge: bridge as unknown as ConstructorParameters<typeof SplitContainer>[0]['bridge'],
    initialSessionId: 'tab-1' as SessionId,
    shell: 'pwsh' as Shell,
    cwd: '/tmp',
  });
});

describe('SplitContainer pane context menu', () => {
  it('opens the menu on right-click in a pane', () => {
    const pane = rootEl.firstElementChild as HTMLElement;
    pane.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(document.querySelector('.aip-ctx-menu')).not.toBeNull();
  });

  it('disables Close pane in a single-leaf tree', () => {
    const pane = rootEl.firstElementChild as HTMLElement;
    pane.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    const items = document.querySelectorAll('.aip-ctx-menu__item');
    const closeItem = Array.from(items).find((i) => i.textContent?.includes('Close pane'));
    expect(closeItem?.classList.contains('aip-ctx-menu__item--disabled')).toBe(true);
  });

  it('prevents the browser default context menu', () => {
    const pane = rootEl.firstElementChild as HTMLElement;
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
    pane.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe('SplitContainer.serialize()', () => {
  it('returns undefined for a single leaf (no splits)', () => {
    expect(splits.serialize()).toBeUndefined();
  });

  it('returns a single horizontal branch after one horizontal split', async () => {
    bridge.send.mockResolvedValueOnce({ id: 'pane-a' });
    await splits.splitFocused('horizontal');
    expect(splits.serialize()).toEqual({
      kind: 'branch',
      orientation: 'horizontal',
      ratio: 0.5,
      a: { kind: 'leaf' },
      b: { kind: 'leaf' },
    });
  });

  it('returns a nested tree after a horizontal split followed by a vertical split on the new pane', async () => {
    bridge.send.mockResolvedValueOnce({ id: 'pane-a' });
    await splits.splitFocused('horizontal');
    bridge.send.mockResolvedValueOnce({ id: 'pane-b' });
    await splits.splitFocused('vertical');
    expect(splits.serialize()).toEqual({
      kind: 'branch',
      orientation: 'horizontal',
      ratio: 0.5,
      a: { kind: 'leaf' },
      b: {
        kind: 'branch',
        orientation: 'vertical',
        ratio: 0.5,
        a: { kind: 'leaf' },
        b: { kind: 'leaf' },
      },
    });
  });
});

describe('SplitContainer.restore()', () => {
  it('does nothing for a tree with no branches (treats a leaf as a no-op)', async () => {
    await splits.restore({ kind: 'leaf' });
    expect(splits.serialize()).toBeUndefined();
  });

  it('rebuilds a single horizontal branch and matches via serialize()', async () => {
    bridge.send.mockResolvedValue({ id: 'pane-x' });
    const tree = {
      kind: 'branch' as const,
      orientation: 'horizontal' as const,
      ratio: 0.7,
      a: { kind: 'leaf' as const },
      b: { kind: 'leaf' as const },
    };
    await splits.restore(tree);
    expect(splits.serialize()).toEqual(tree);
  });

  it('rebuilds a nested tree (horizontal then vertical on right leaf)', async () => {
    bridge.send.mockResolvedValue({ id: 'pane-y' });
    const tree = {
      kind: 'branch' as const,
      orientation: 'horizontal' as const,
      ratio: 0.6,
      a: { kind: 'leaf' as const },
      b: {
        kind: 'branch' as const,
        orientation: 'vertical' as const,
        ratio: 0.3,
        a: { kind: 'leaf' as const },
        b: { kind: 'leaf' as const },
      },
    };
    await splits.restore(tree);
    expect(splits.serialize()).toEqual(tree);
  });

  it('stops descending a subtree if a pane create returns an error, leaving the rest intact', async () => {
    // First split succeeds; second (inside the b subtree) fails.
    bridge.send
      .mockResolvedValueOnce({ id: 'pane-ok' })
      .mockResolvedValueOnce({ error: 'spawn failed' });
    const tree = {
      kind: 'branch' as const,
      orientation: 'horizontal' as const,
      ratio: 0.8,
      a: { kind: 'leaf' as const },
      b: {
        kind: 'branch' as const,
        orientation: 'vertical' as const,
        ratio: 0.2,
        a: { kind: 'leaf' as const },
        b: { kind: 'leaf' as const },
      },
    };
    await splits.restore(tree);
    // Outer split survives with its saved ratio (0.8); inner split failed so its
    // subtree is replaced by a plain leaf. The outer ratio must NOT be corrupted
    // by the failed inner restore.
    expect(splits.serialize()).toEqual({
      kind: 'branch',
      orientation: 'horizontal',
      ratio: 0.8,
      a: { kind: 'leaf' },
      b: { kind: 'leaf' },
    });
  });
});

function persistCalls(b: FakeBridge): Array<{ tabId: string; splits: unknown }> {
  return b.send.mock.calls
    .filter((c: unknown[]) => c[0] === 'core.layout.persist-splits')
    .map((c: unknown[]) => c[1] as { tabId: string; splits: unknown });
}

describe('SplitContainer persistence', () => {
  it('sends LayoutPersistSplits after a successful split', async () => {
    bridge.send.mockResolvedValueOnce({ id: 'pane-a' });
    await splits.splitFocused('horizontal');
    const calls = persistCalls(bridge);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1]!.tabId).toBe('tab-1');
    expect(calls[calls.length - 1]!.splits).toEqual({
      kind: 'branch',
      orientation: 'horizontal',
      ratio: 0.5,
      a: { kind: 'leaf' },
      b: { kind: 'leaf' },
    });
  });

  it('sends LayoutPersistSplits with null after closing the last extra pane', async () => {
    bridge.send.mockResolvedValueOnce({ id: 'pane-a' });
    await splits.splitFocused('horizontal');
    splits.closeFocusedPane();
    const calls = persistCalls(bridge);
    expect(calls[calls.length - 1]!.splits).toBeNull();
  });

  it('N1: retarget() re-persists the current tree under the new tabId', async () => {
    bridge.send.mockResolvedValueOnce({ id: 'pane-a' });
    await splits.splitFocused('horizontal');
    splits.closeFocusedPane(); // promotes sibling; persists (null) under the OLD tabId
    bridge.send.mockClear();

    splits.retarget('pane-a' as SessionId);

    const calls = persistCalls(bridge);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ tabId: 'pane-a', splits: null });
  });

  it('sends LayoutPersistSplits with the new ratio after a divider drag ends', async () => {
    bridge.send.mockResolvedValueOnce({ id: 'pane-a' });
    await splits.splitFocused('horizontal');
    const divider = rootEl.querySelector('div[style*="col-resize"]') as HTMLElement;
    expect(divider).not.toBeNull();
    divider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    // No mousemove — just end the drag; persist should still fire on mouseup.
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const calls = persistCalls(bridge);
    const last = calls[calls.length - 1]!;
    expect(last.tabId).toBe('tab-1');
    expect((last.splits as { kind: string }).kind).toBe('branch');
  });
});

describe('SplitContainer.loadSavedLayout()', () => {
  it('is a no-op when main returns null', async () => {
    bridge.send.mockImplementation((channel: string) =>
      channel === 'core.layout.splits-for-tab'
        ? Promise.resolve(null)
        : Promise.resolve({ id: 'pane-x' }),
    );
    await splits.loadSavedLayout();
    expect(splits.serialize()).toBeUndefined();
  });

  it('replays a tree returned by main', async () => {
    const saved = {
      kind: 'branch' as const,
      orientation: 'horizontal' as const,
      ratio: 0.4,
      a: { kind: 'leaf' as const },
      b: { kind: 'leaf' as const },
    };
    bridge.send.mockImplementation((channel: string) =>
      channel === 'core.layout.splits-for-tab'
        ? Promise.resolve(saved)
        : Promise.resolve({ id: 'pane-y' }),
    );
    await splits.loadSavedLayout();
    expect(splits.serialize()).toEqual(saved);
  });

  it('is a no-op when main returns { error }', async () => {
    bridge.send.mockImplementation((channel: string) =>
      channel === 'core.layout.splits-for-tab'
        ? Promise.resolve({ error: 'bad payload' })
        : Promise.resolve({ id: 'pane-x' }),
    );
    await splits.loadSavedLayout();
    expect(splits.serialize()).toBeUndefined();
  });
});
