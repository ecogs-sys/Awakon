// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showNewSessionDialog } from './new-session-dialog.js';

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
  const send = vi.fn();
  (window as unknown as { awakon: FakeBridge }).awakon = { send };
  return { send };
}

function setUserAgent(ua: string): void {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

beforeEach(() => {
  document.body.innerHTML = '';
  freshBridge();
  setUserAgent('Windows NT 10.0; Win64; x64');
});

describe('showNewSessionDialog — structure', () => {
  it('mounts an .aip-modal--newsession with header crumb and Start button', () => {
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'pwsh', defaultCwd: 'C:\\Users\\me\\proj' });

    const root = mount.querySelector('.aip-modal--newsession');
    expect(root).not.toBeNull();

    const crumb = root!.querySelector('.aip-modal__crumb');
    const title = root!.querySelector('.aip-modal__title');
    expect(crumb?.textContent).toBe('New session');
    expect(title?.textContent).toBe('Configure');

    const start = root!.querySelector('.aip-btn--primary');
    expect(start?.textContent).toContain('Start session');
  });
});

describe('showNewSessionDialog — working directory', () => {
  it('renders the path with parent muted and tail bright (POSIX)', async () => {
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'bash', defaultCwd: '/home/me/work/foo' });

    // First mount starts in edit state and auto-focuses the input. Blur it to enter display state.
    const input = mount.querySelector<HTMLInputElement>('.aip-path-input__field input');
    expect(input).not.toBeNull();
    input!.blur();

    const dim = mount.querySelector('.aip-path-input__field .dim');
    expect(dim?.textContent).toBe('/home/me/work/');
    const fieldText = mount.querySelector('.aip-path-input__field')!.textContent;
    expect(fieldText).toContain('foo');
  });

  it('renders the path with parent muted and tail bright (Windows)', () => {
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'pwsh', defaultCwd: 'C:\\Users\\me\\proj' });
    const input = mount.querySelector<HTMLInputElement>('.aip-path-input__field input')!;
    input.blur();
    const dim = mount.querySelector('.aip-path-input__field .dim');
    expect(dim?.textContent).toBe('C:\\Users\\me\\');
    expect(mount.querySelector('.aip-path-input__field')!.textContent).toContain('proj');
  });

  it('starts in edit state with the input focused and selected', () => {
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'bash', defaultCwd: '/foo' });
    const input = mount.querySelector<HTMLInputElement>('.aip-path-input__field input');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(input!.selectionStart).toBe(0);
    expect(input!.selectionEnd).toBe('/foo'.length);
  });

  it('clicking the display state swaps to edit state and focuses the input', () => {
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'bash', defaultCwd: '/foo' });
    const input = mount.querySelector<HTMLInputElement>('.aip-path-input__field input')!;
    input.blur(); // enter display state

    const field = mount.querySelector<HTMLDivElement>('.aip-path-input__field')!;
    field.click();

    const newInput = mount.querySelector<HTMLInputElement>('.aip-path-input__field input');
    expect(newInput).not.toBeNull();
    expect(document.activeElement).toBe(newInput);
  });
});

describe('showNewSessionDialog — Browse button', () => {
  it('dispatches FsPickDirectory with the current cwd and updates the field on success', async () => {
    const mount = mountEl();
    const bridge = (window as unknown as { awakon: FakeBridge }).awakon;
    bridge.send.mockResolvedValueOnce({ path: '/picked/dir' });

    void showNewSessionDialog(mount, { defaultShell: 'bash', defaultCwd: '/start' });
    const browse = mount.querySelector<HTMLButtonElement>('.aip-path-input__browse')!;
    browse.click();

    // Wait for the async update.
    await new Promise((r) => setTimeout(r, 0));

    expect(bridge.send).toHaveBeenCalledWith('core.fs.pick-directory', { startPath: '/start' });
    const input = mount.querySelector<HTMLInputElement>('.aip-path-input__field input')!;
    expect(input.value).toBe('/picked/dir');
  });

  it('leaves the field unchanged when the user cancels', async () => {
    const mount = mountEl();
    const bridge = (window as unknown as { awakon: FakeBridge }).awakon;
    bridge.send.mockResolvedValueOnce({ cancelled: true });

    void showNewSessionDialog(mount, { defaultShell: 'bash', defaultCwd: '/start' });
    mount.querySelector<HTMLButtonElement>('.aip-path-input__browse')!.click();
    await new Promise((r) => setTimeout(r, 0));

    const input = mount.querySelector<HTMLInputElement>('.aip-path-input__field input')!;
    expect(input.value).toBe('/start');
  });
});

describe('showNewSessionDialog — shell radio row', () => {
  it('shows pwsh.exe / cmd.exe / git-bash on Windows', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'pwsh', defaultCwd: '/x' });
    const labels = [...mount.querySelectorAll('.aip-radio')].map((r) => r.textContent!.trim());
    expect(labels).toEqual(['pwsh.exe', 'cmd.exe', 'git-bash']);
  });

  it('shows zsh / bash on macOS', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'zsh', defaultCwd: '/x' });
    const labels = [...mount.querySelectorAll('.aip-radio')].map((r) => r.textContent!.trim());
    expect(labels).toEqual(['zsh', 'bash']);
  });

  it('shows bash / zsh on Linux', () => {
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64)');
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'bash', defaultCwd: '/x' });
    const labels = [...mount.querySelectorAll('.aip-radio')].map((r) => r.textContent!.trim());
    expect(labels).toEqual(['bash', 'zsh']);
  });

  it('marks the default shell active', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'cmd', defaultCwd: '/x' });
    const active = mount.querySelector('.aip-radio--active');
    expect(active?.textContent).toContain('cmd.exe');
  });

  it('switches active on click', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'pwsh', defaultCwd: '/x' });
    const radios = mount.querySelectorAll<HTMLElement>('.aip-radio');
    radios[2]!.click();   // git-bash
    expect(radios[0]!.classList.contains('aip-radio--active')).toBe(false);
    expect(radios[2]!.classList.contains('aip-radio--active')).toBe(true);
  });

  it('ArrowRight moves selection forward', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'pwsh', defaultCwd: '/x' });
    const radios = mount.querySelectorAll<HTMLElement>('.aip-radio');
    radios[0]!.focus();
    radios[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(radios[1]!.classList.contains('aip-radio--active')).toBe(true);
    expect(document.activeElement).toBe(radios[1]);
  });

  it('ArrowLeft from first wraps to last', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'pwsh', defaultCwd: '/x' });
    const radios = mount.querySelectorAll<HTMLElement>('.aip-radio');
    radios[0]!.focus();
    radios[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(radios[radios.length - 1]!.classList.contains('aip-radio--active')).toBe(true);
  });
});

describe('showNewSessionDialog — submit', () => {
  it('resolves with { shell, cwd } when cwd is a real directory', async () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const mount = mountEl();
    const bridge = (window as unknown as { awakon: FakeBridge }).awakon;
    bridge.send.mockResolvedValueOnce({ exists: true, isDirectory: true });

    const p = showNewSessionDialog(mount, { defaultShell: 'pwsh', defaultCwd: 'C:\\Users\\me' });
    mount.querySelector<HTMLButtonElement>('#ns-start')!.click();
    const result = await p;

    expect(bridge.send).toHaveBeenCalledWith('core.fs.path-exists', { path: 'C:\\Users\\me' });
    expect(result).toEqual({ shell: 'pwsh', cwd: 'C:\\Users\\me' });
  });

  it('stays open and shows "directory not found" when cwd is missing', async () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const mount = mountEl();
    const bridge = (window as unknown as { awakon: FakeBridge }).awakon;
    bridge.send.mockResolvedValueOnce({ exists: false, isDirectory: false });

    void showNewSessionDialog(mount, { defaultShell: 'pwsh', defaultCwd: 'C:\\nope' });
    mount.querySelector<HTMLButtonElement>('#ns-start')!.click();
    await new Promise((r) => setTimeout(r, 0));

    const err = mount.querySelector<HTMLDivElement>('#ns-cwd-error');
    expect(err?.hidden).toBe(false);
    expect(err?.textContent).toBe('directory not found');
    expect(mount.querySelector('.aip-path-input--invalid')).not.toBeNull();
    // Dialog still mounted.
    expect(mount.querySelector('.aip-modal--newsession')).not.toBeNull();
  });

  it('shows "not a directory" when cwd is a file', async () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const mount = mountEl();
    const bridge = (window as unknown as { awakon: FakeBridge }).awakon;
    bridge.send.mockResolvedValueOnce({ exists: true, isDirectory: false });

    void showNewSessionDialog(mount, { defaultShell: 'pwsh', defaultCwd: 'C:\\file.txt' });
    mount.querySelector<HTMLButtonElement>('#ns-start')!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(mount.querySelector<HTMLDivElement>('#ns-cwd-error')?.textContent).toBe('not a directory');
  });

  it('clears the error when the user starts editing', async () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const mount = mountEl();
    const bridge = (window as unknown as { awakon: FakeBridge }).awakon;
    bridge.send.mockResolvedValueOnce({ exists: false, isDirectory: false });

    void showNewSessionDialog(mount, { defaultShell: 'pwsh', defaultCwd: 'C:\\nope' });
    mount.querySelector<HTMLButtonElement>('#ns-start')!.click();
    await new Promise((r) => setTimeout(r, 0));

    const input = mount.querySelector<HTMLInputElement>('.aip-path-input__field input')!;
    input.value = 'C:\\better';
    input.dispatchEvent(new Event('input'));

    expect(mount.querySelector<HTMLDivElement>('#ns-cwd-error')?.hidden).toBe(true);
    expect(mount.querySelector('.aip-path-input--invalid')).toBeNull();
  });

  it('disables Start when cwd is empty', () => {
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'pwsh', defaultCwd: '' });
    expect(mount.querySelector<HTMLButtonElement>('#ns-start')!.disabled).toBe(true);
  });
});

describe('showNewSessionDialog — recent sessions', () => {
  it('renders no Recent section when recentTabs is omitted or empty', () => {
    const mount = mountEl();
    void showNewSessionDialog(mount, { defaultShell: 'pwsh', defaultCwd: 'C:\\x' });
    expect(mount.querySelector('.aip-ns-recent-list')).toBeNull();

    const mount2 = mountEl();
    void showNewSessionDialog(mount2, { defaultShell: 'pwsh', defaultCwd: 'C:\\x', recentTabs: [] });
    expect(mount2.querySelector('.aip-ns-recent-list')).toBeNull();
  });

  it('renders a row per recent tab with shell chip, path, and relative time', () => {
    const mount = mountEl();
    void showNewSessionDialog(mount, {
      defaultShell: 'pwsh',
      defaultCwd: 'C:\\x',
      recentTabs: [
        { title: 'proj', cwd: 'C:\\work\\proj', shell: 'pwsh', closedAt: Date.now() - 60_000 },
        { title: 'scratch', cwd: 'C:\\work\\scratch', shell: 'git-bash', closedAt: Date.now() - 3_600_000 },
      ],
    });

    const rows = mount.querySelectorAll<HTMLButtonElement>('.aip-ns-recent-row');
    expect(rows.length).toBe(2);
    expect(rows[0]!.querySelector('.aip-ns-recent-row__path')!.textContent).toBe('C:\\work\\proj');
    expect(rows[0]!.querySelector('.aip-ns-recent-row__chip')!.textContent).toBe('PS');
    expect(rows[1]!.querySelector('.aip-ns-recent-row__path')!.textContent).toBe('C:\\work\\scratch');
  });

  it('clicking a recent row fills in its cwd and selects its shell', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const mount = mountEl();
    void showNewSessionDialog(mount, {
      defaultShell: 'pwsh',
      defaultCwd: 'C:\\x',
      recentTabs: [{ title: 'scratch', cwd: 'C:\\work\\scratch', shell: 'git-bash', closedAt: Date.now() }],
    });

    mount.querySelector<HTMLButtonElement>('.aip-ns-recent-row')!.click();

    const input = mount.querySelector<HTMLInputElement>('.aip-path-input__field input')!;
    expect(input.value).toBe('C:\\work\\scratch');
    const active = mount.querySelector('.aip-radio--active')!;
    expect(active.textContent).toContain('git-bash');
    expect(mount.querySelector<HTMLButtonElement>('#ns-start')!.disabled).toBe(false);
  });
});

describe('showNewSessionDialog — cancel paths', () => {
  it('resolves null on Escape', async () => {
    const mount = mountEl();
    const p = showNewSessionDialog(mount, { defaultShell: 'bash', defaultCwd: '/x' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(p).resolves.toBeNull();
    expect(mount.querySelector('.aip-modal--newsession')).toBeNull();
  });

  it('resolves null on Cancel button', async () => {
    const mount = mountEl();
    const p = showNewSessionDialog(mount, { defaultShell: 'bash', defaultCwd: '/x' });
    mount.querySelector<HTMLButtonElement>('#ns-cancel')!.click();
    await expect(p).resolves.toBeNull();
  });

  it('resolves null on scrim click', async () => {
    const mount = mountEl();
    const p = showNewSessionDialog(mount, { defaultShell: 'bash', defaultCwd: '/x' });
    mount.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await expect(p).resolves.toBeNull();
  });

  it('resolves null on close ×', async () => {
    const mount = mountEl();
    const p = showNewSessionDialog(mount, { defaultShell: 'bash', defaultCwd: '/x' });
    mount.querySelector<HTMLButtonElement>('#ns-close')!.click();
    await expect(p).resolves.toBeNull();
  });

  it('removes its scrim click listener on cleanup instead of leaking it (A5-I2)', async () => {
    const mount = mountEl();
    const removeSpy = vi.spyOn(mount, 'removeEventListener');
    const p = showNewSessionDialog(mount, { defaultShell: 'bash', defaultCwd: '/x' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await p;
    expect(removeSpy).toHaveBeenCalledWith('click', expect.any(Function));
  });
});
