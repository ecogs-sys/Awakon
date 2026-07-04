// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '@awakon/contracts';
import { TitleBar } from './titlebar.js';

function mkBridge() {
  return { send: vi.fn().mockResolvedValue({ ok: true }), on: vi.fn(), invoke: vi.fn() };
}

function mount(platform = 'win32', over: Partial<ConstructorParameters<typeof TitleBar>[1]> = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const bridge = mkBridge();
  const onOpenSettings = vi.fn();
  const onOpenPalette = vi.fn();
  const bar = new TitleBar(root, { bridge: bridge as never, platform, onOpenSettings, onOpenPalette, ...over });
  return { root, bridge, bar, onOpenSettings, onOpenPalette };
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('TitleBar', () => {
  it('renders the wordmark, palette chip, gear and hamburger', () => {
    const { root } = mount();
    expect(root.querySelector('.tb-name')?.textContent).toBe('Awakon');
    expect(root.querySelector('.tb-mark svg')).not.toBeNull();
    expect(root.querySelector('.tb-chip')?.textContent).toBe('Ctrl+K');
    expect(root.querySelector('.tb-iconbtn[title="Settings"]')).not.toBeNull();
    expect(root.querySelector('.tb-menu-btn')).not.toBeNull();
  });

  it('shows the ⌘K label on macOS', () => {
    const { root } = mount('darwin');
    expect(root.querySelector('.tb-chip')?.textContent).toBe('⌘K');
  });

  it('hides window controls + hamburger on macOS, shows them elsewhere', () => {
    expect(mount('win32').root.querySelector('.tb-controls')).not.toBeNull();
    // macOS: controls are not rendered at all; the hamburger is hidden via CSS.
    expect(mount('darwin').root.querySelector('.tb-controls')).toBeNull();
  });

  it('breadcrumb is hidden until a project is set, then shows it', () => {
    const { root, bar } = mount();
    const crumb = root.querySelector<HTMLElement>('.tb-crumb')!;
    expect(crumb.hidden).toBe(true);
    bar.setContext({ project: 'Awakon', subtitle: 'pwsh · running' });
    expect(crumb.hidden).toBe(false);
    expect(root.querySelector('.tb-crumb-project')?.textContent).toBe('Awakon');
    expect(root.querySelector('.tb-subtitle')?.textContent).toBe('pwsh · running');
  });

  it('omits the branch unless one is provided', () => {
    const { root, bar } = mount();
    const branch = root.querySelector<HTMLElement>('.tb-crumb-branch')!;
    bar.setContext({ project: 'Awakon', subtitle: '' });
    expect(branch.hidden).toBe(true);
    bar.setContext({ project: 'Awakon', branch: 'main', subtitle: '' });
    expect(branch.hidden).toBe(false);
    expect(root.querySelector('.tb-crumb-branch-name')?.textContent).toBe('main');
  });

  it('hamburger pops the full app menu via ChromeAppMenuPopup', () => {
    const { root, bridge } = mount();
    root.querySelector<HTMLElement>('.tb-menu-btn')!.click();
    expect(bridge.send).toHaveBeenCalledWith(
      IpcChannel.ChromeAppMenuPopup,
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    );
  });

  it('gear opens settings and chip opens the palette', () => {
    const { root, onOpenSettings, onOpenPalette } = mount();
    root.querySelector<HTMLElement>('.tb-iconbtn[title="Settings"]')!.click();
    root.querySelector<HTMLElement>('.tb-chip')!.click();
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(onOpenPalette).toHaveBeenCalledOnce();
  });
});
