import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

class FakeWebContents extends EventEmitter {
  focus = vi.fn();
  close = vi.fn();
}

class FakeWebContentsView {
  webContents = new FakeWebContents();
  setBounds = vi.fn();
}

class FakeBrowserWindow {
  contentView = { addChildView: vi.fn(), removeChildView: vi.fn() };
  on = vi.fn();
  getContentBounds = vi.fn().mockReturnValue({ width: 800, height: 600 });
}

vi.mock('electron', () => ({
  BrowserWindow: FakeBrowserWindow,
  WebContentsView: FakeWebContentsView,
}));

// Import after the mock so ViewManager picks up the faked WebContentsView.
const { ViewManager } = await import('./view-manager.js');

function newManager(onCrash: (id: string, view: unknown) => void) {
  const manager = new ViewManager({ preloadPath: '/preload.js', onCrash });
  manager.attach(new FakeBrowserWindow() as unknown as import('electron').BrowserWindow);
  return manager;
}

describe('ViewManager crash-listener rekeying (N2)', () => {
  it('resolves the current id after rekey(), not the id captured at create time', () => {
    const crashes: string[] = [];
    const manager = newManager((id) => crashes.push(id));

    const view = manager.create('old-id');
    manager.rekey('old-id', 'new-id');
    (view.webContents as unknown as FakeWebContents).emit('render-process-gone');

    expect(crashes).toEqual(['new-id']);
  });

  it('still fires with the original id when no rekey happened', () => {
    const crashes: string[] = [];
    const manager = newManager((id) => crashes.push(id));

    const view = manager.create('only-id');
    (view.webContents as unknown as FakeWebContents).emit('render-process-gone');

    expect(crashes).toEqual(['only-id']);
  });

  it('follows a second rekey (repeated reparent)', () => {
    const crashes: string[] = [];
    const manager = newManager((id) => crashes.push(id));

    const view = manager.create('a');
    manager.rekey('a', 'b');
    manager.rekey('b', 'c');
    (view.webContents as unknown as FakeWebContents).emit('render-process-gone');

    expect(crashes).toEqual(['c']);
  });
});
