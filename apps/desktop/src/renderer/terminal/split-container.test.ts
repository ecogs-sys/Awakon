// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Records the order of host method invocations so tests can assert that focus is
// restored AFTER an action (e.g. paste → focus). Hoisted so the vi.mock factory,
// which is itself hoisted above imports, can close over it.
const hostCalls = vi.hoisted(() => [] as string[]);

// What every stub host reports from resolveRightClickAction(). Hoisted alongside
// hostCalls so the vi.mock factory can close over it; tests flip it to simulate an
// app (Claude Code, vim) taking control of the pane.
const hostState = vi.hoisted(() => ({
  rightClickAction: 'menu' as 'menu' | 'paste' | 'passthrough',
}));

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
    /** Mirrors TerminalHost.resolveRightClickAction(); 'menu' = plain shell prompt. */
    resolveRightClickAction(): string { return hostState.rightClickAction; }
    hasSelection(): boolean { return this._hasSel; }
    getSelection(): string { return this.selection; }
    paste(_: string): void { hostCalls.push('paste'); }
    selectAll(): void { this._hasSel = true; hostCalls.push('selectAll'); }
    focus(): void { hostCalls.push('focus'); }
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
  hostCalls.length = 0;
  hostState.rightClickAction = 'menu';
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

// Right-click policy per running app. The pane shows the menu only at a shell
// prompt; when an app owns the pane its profile decides (see app-profiles.ts).
describe('SplitContainer right-click app policy', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: vi.fn().mockResolvedValue('pasted text') },
      configurable: true,
    });
  });

  function rightClick(pane: HTMLElement): { down: MouseEvent; ctx: MouseEvent } {
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 2, clientX: 10, clientY: 10 });
    pane.dispatchEvent(down);
    const ctx = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
    pane.dispatchEvent(ctx);
    return { down, ctx };
  }

  it('shows no menu when a known app (Claude Code) is running', () => {
    hostState.rightClickAction = 'paste';
    rightClick(rootEl.firstElementChild as HTMLElement);
    expect(document.querySelector('.aip-ctx-menu')).toBeNull();
  });

  it('pastes through the sanitized host path instead of opening the menu', async () => {
    hostState.rightClickAction = 'paste';
    rightClick(rootEl.firstElementChild as HTMLElement);
    // The paste is async (clipboard read) — let the microtask queue drain.
    await vi.waitFor(() => expect(hostCalls).toContain('paste'));
    expect(document.querySelector('.aip-ctx-menu')).toBeNull();
  });

  it('stops the right-click reaching the app so it sees no phantom click', () => {
    hostState.rightClickAction = 'paste';
    const { down } = rightClick(rootEl.firstElementChild as HTMLElement);
    // Capture-phase preventDefault is what keeps xterm from forwarding button 2 to
    // the PTY; without it Claude Code would get the click AND we would paste.
    expect(down.defaultPrevented).toBe(true);
  });

  it('shows no menu and does not paste for an unknown full-screen app', async () => {
    hostState.rightClickAction = 'passthrough';
    rightClick(rootEl.firstElementChild as HTMLElement);
    await Promise.resolve();
    expect(document.querySelector('.aip-ctx-menu')).toBeNull();
    expect(hostCalls).not.toContain('paste');
  });

  it('leaves a left-click alone while an app is in control', () => {
    hostState.rightClickAction = 'paste';
    const pane = rootEl.firstElementChild as HTMLElement;
    const left = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    pane.dispatchEvent(left);
    expect(left.defaultPrevented).toBe(false);
    expect(hostCalls).not.toContain('paste');
  });

  it('still shows the menu at a shell prompt after an app exits', () => {
    hostState.rightClickAction = 'paste';
    rightClick(rootEl.firstElementChild as HTMLElement);
    expect(document.querySelector('.aip-ctx-menu')).toBeNull();
    // App exits -> modes reset -> pane is a plain prompt again.
    hostState.rightClickAction = 'menu';
    rightClick(rootEl.firstElementChild as HTMLElement);
    expect(document.querySelector('.aip-ctx-menu')).not.toBeNull();
  });

  // Regression: right-click → Copy/Paste/Select all used to leave the xterm blurred
  // (hollow "box" cursor); the user had to click the pane before they could type. The
  // menu now restores terminal focus via onClose for every action.
  function openMenuAndClick(label: string): void {
    const pane = rootEl.firstElementChild as HTMLElement;
    pane.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    const item = Array.from(document.querySelectorAll('.aip-ctx-menu__item'))
      .find((i) => i.textContent?.includes(label)) as HTMLElement | undefined;
    if (!item) throw new Error(`menu item "${label}" not found`);
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  it('restores terminal focus after Select all', () => {
    openMenuAndClick('Select all');
    expect(hostCalls).toContain('focus');
    // focus is restored (via onClose) before the action's own effects — either way the
    // terminal ends focused, which is what fixes the hollow-cursor bug.
    expect(hostCalls).toEqual(['focus', 'selectAll']);
  });

  it('restores terminal focus after Paste', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: vi.fn().mockResolvedValue('pasted text') },
      configurable: true,
    });
    openMenuAndClick('Paste');
    // onPaste is async (awaits clipboard.readText); let its microtasks settle.
    await vi.waitFor(() => expect(hostCalls).toContain('paste'));
    // Focus was restored on close, before the paste resolved — and nothing blurs it after.
    expect(hostCalls).toEqual(['focus', 'paste']);
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

describe('SplitContainer.splitFocused() concurrency (A6-I3)', () => {
  it('abandons the split and cleans up the new pane if the focused pane leaves the tree during creation', async () => {
    // First split settles synchronously; focused is now the new "pane-a" leaf.
    bridge.send.mockResolvedValueOnce({ id: 'pane-a' });
    await splits.splitFocused('horizontal');

    // Second split targets the now-focused pane-a leaf; control its resolution so we
    // can simulate something else changing the tree while it's in flight.
    let resolveCreate!: (v: { id: string }) => void;
    bridge.send.mockImplementationOnce(
      () => new Promise((resolve) => { resolveCreate = resolve; }),
    );
    const splitPromise = splits.splitFocused('vertical');

    // While the create-pane call is in flight, the user closes the focused pane
    // (e.g. Ctrl+Shift+W) before it resolves — collapsing the tree back to one leaf.
    splits.closeFocusedPane();
    expect(splits.serialize()).toBeUndefined();

    // Now the stale create-pane call resolves with the orphaned sibling.
    resolveCreate({ id: 'pane-b' });
    await splitPromise;

    // The abandoned split must not corrupt the tree with an orphaned root branch.
    expect(splits.serialize()).toBeUndefined();
    // The orphaned pane-b session must be cleaned up, not leaked.
    const closePaneCalls = bridge.send.mock.calls.filter(
      (c: unknown[]) => c[0] === 'core.session.close-pane',
    );
    expect(closePaneCalls.some((c: unknown[]) => (c[1] as { sessionId: string }).sessionId === 'pane-b')).toBe(true);
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
