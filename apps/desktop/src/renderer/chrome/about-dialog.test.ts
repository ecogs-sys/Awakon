// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showAboutDialog } from './about-dialog.js';
import type { ChromeAppInfoResponse } from '@awakon/contracts';

interface FakeBridge {
  send: ReturnType<typeof vi.fn>;
}

function mountEl(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'dialog-mount';
  document.body.appendChild(el);
  return el;
}

function freshBridge(): FakeBridge {
  const send = vi.fn().mockResolvedValue({ ok: true });
  (window as unknown as { awakon: FakeBridge }).awakon = { send };
  return { send };
}

const INFO: ChromeAppInfoResponse = {
  version:  '0.3.0',
  electron: '33.2.0',
  chromium: '130.0.6723.44',
  node:     '20.18.0',
  v8:       '13.0.245.16',
  os:       'Windows · 10.0.26200 (x64)',
};

beforeEach(() => {
  document.body.innerHTML = '';
  freshBridge();
});

describe('showAboutDialog — structure', () => {
  it('mounts an .aip-modal--about with header crumb', () => {
    const mount = mountEl();
    void showAboutDialog(mount, INFO);

    const root = mount.querySelector('.aip-modal--about');
    expect(root).not.toBeNull();
    expect(root!.querySelector('.aip-modal__crumb')?.textContent).toBe('About');
    expect(mount.classList.contains('open')).toBe(true);
  });

  it('renders identity row with app name, version, tagline, and glyph', () => {
    const mount = mountEl();
    void showAboutDialog(mount, INFO);

    expect(mount.querySelector('.aip-about__name')?.textContent).toBe('Awakon');
    expect(mount.querySelector('.aip-about__version')?.textContent).toContain('0.3.0');
    expect(mount.querySelector('.aip-about__tagline')?.textContent).toContain('Run many agents');
    expect(mount.querySelector('.aip-about__icon svg')).not.toBeNull();
  });

  it('renders one detail row per non-empty runtime field', () => {
    const mount = mountEl();
    void showAboutDialog(mount, INFO);

    const rows = mount.querySelectorAll('.aip-about__row');
    expect(rows.length).toBe(5); // Electron, Chromium, Node, V8, OS

    const keys = [...rows].map((r) => r.querySelector('.aip-about__key')?.textContent);
    expect(keys).toEqual(['Electron', 'Chromium', 'Node', 'V8', 'OS']);

    const vals = [...rows].map((r) => r.querySelector('.aip-about__val')?.textContent);
    expect(vals).toEqual([INFO.electron, INFO.chromium, INFO.node, INFO.v8, INFO.os]);
  });

  it('omits rows whose runtime field is empty', () => {
    const mount = mountEl();
    void showAboutDialog(mount, { ...INFO, v8: '', node: '' });

    const keys = [...mount.querySelectorAll('.aip-about__key')].map((k) => k.textContent);
    expect(keys).toEqual(['Electron', 'Chromium', 'OS']);
  });

  it('renders the four standard external links', () => {
    const mount = mountEl();
    void showAboutDialog(mount, INFO);

    const labels = [...mount.querySelectorAll('.aip-about__link')].map((l) => l.textContent);
    expect(labels).toEqual(['Website', 'Release notes', 'Acknowledgements', 'Report an issue']);
  });
});

describe('showAboutDialog — actions', () => {
  it('clicking a link sends ChromeOpenExternal with that link\'s URL', () => {
    const mount = mountEl();
    const bridge = (window as unknown as { awakon: FakeBridge }).awakon;
    void showAboutDialog(mount, INFO);

    const reportLink = [...mount.querySelectorAll<HTMLButtonElement>('.aip-about__link')]
      .find((l) => l.textContent === 'Report an issue')!;
    reportLink.click();

    expect(bridge.send).toHaveBeenCalledWith(
      'core.chrome.open-external',
      { url: 'https://github.com/ecogs-sys/Awakon/issues' },
    );
  });

  it('clicking Acknowledgements opens the shipped notices file, not a URL', () => {
    const mount = mountEl();
    const bridge = (window as unknown as { awakon: FakeBridge }).awakon;
    void showAboutDialog(mount, INFO);

    const ackLink = [...mount.querySelectorAll<HTMLButtonElement>('.aip-about__link')]
      .find((l) => l.textContent === 'Acknowledgements')!;
    ackLink.click();

    expect(bridge.send).toHaveBeenCalledWith('core.chrome.open-acknowledgements');
    expect(bridge.send).not.toHaveBeenCalledWith('core.chrome.open-external', expect.anything());
  });

  it('Copy info writes a multi-line summary to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText }, configurable: true,
    });
    const mount = mountEl();
    void showAboutDialog(mount, INFO);

    mount.querySelector<HTMLButtonElement>('#ab-copy')!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toContain('Awakon 0.3.0');
    expect(text).toContain('Electron 33.2.0');
    expect(text).toContain('OS Windows · 10.0.26200 (x64)');
  });
});

describe('showAboutDialog — dismissal', () => {
  it('resolves on OK', async () => {
    const mount = mountEl();
    const p = showAboutDialog(mount, INFO);
    mount.querySelector<HTMLButtonElement>('#ab-ok')!.click();
    await expect(p).resolves.toBeUndefined();
    expect(mount.querySelector('.aip-modal--about')).toBeNull();
    expect(mount.classList.contains('open')).toBe(false);
  });

  it('resolves on ×', async () => {
    const mount = mountEl();
    const p = showAboutDialog(mount, INFO);
    mount.querySelector<HTMLButtonElement>('#ab-close')!.click();
    await expect(p).resolves.toBeUndefined();
  });

  it('resolves on Escape', async () => {
    const mount = mountEl();
    const p = showAboutDialog(mount, INFO);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(p).resolves.toBeUndefined();
  });

  it('resolves on backdrop click', async () => {
    const mount = mountEl();
    const p = showAboutDialog(mount, INFO);
    mount.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await expect(p).resolves.toBeUndefined();
  });

  it('does not resolve on clicks inside the modal card', async () => {
    const mount = mountEl();
    let settled = false;
    void showAboutDialog(mount, INFO).then(() => { settled = true; });

    mount.querySelector<HTMLElement>('.aip-modal--about')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(settled).toBe(false);
    expect(mount.querySelector('.aip-modal--about')).not.toBeNull();
  });
});
