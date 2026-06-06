// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmptyStateView, shellChip, formatWhen, platformMod } from './empty-state.js';
import type { RecentTab } from '@awakon/contracts';

function makeHost(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

const SAMPLE_RECENT: RecentTab = {
  title: 'my-project',
  cwd:   '/home/me/work/proj',
  shell: 'bash',
  closedAt: Date.now() - 5 * 60 * 1000, // 5 minutes ago
};

beforeEach(() => { document.body.innerHTML = ''; });

// ── shellChip ────────────────────────────────────────────────────────────────

describe('shellChip', () => {
  it('maps pwsh to PS', ()        => expect(shellChip('pwsh')).toBe('PS'));
  it('maps powershell to PS', ()  => expect(shellChip('powershell')).toBe('PS'));
  it('maps cmd to CMD', ()        => expect(shellChip('cmd')).toBe('CMD'));
  it('maps bash to BSH', ()       => expect(shellChip('bash')).toBe('BSH'));
  it('maps git-bash to BSH', ()   => expect(shellChip('git-bash')).toBe('BSH'));
  it('maps zsh to ZSH', ()        => expect(shellChip('zsh')).toBe('ZSH'));
  it('maps wsl to WSL', ()        => expect(shellChip('wsl')).toBe('WSL'));
});

// ── formatWhen ───────────────────────────────────────────────────────────────

describe('formatWhen', () => {
  it('returns "just now" for timestamps under 60 seconds ago', () => {
    expect(formatWhen(Date.now() - 30_000)).toBe('just now');
  });
  it('returns "Xm ago" for timestamps within the last hour', () => {
    expect(formatWhen(Date.now() - 5 * 60 * 1000)).toBe('5m ago');
  });
  it('returns "Xh ago" for timestamps within the last 24 hours', () => {
    expect(formatWhen(Date.now() - 3 * 60 * 60 * 1000)).toBe('3h ago');
  });
  it('returns "X days ago" for timestamps within the last 7 days', () => {
    expect(formatWhen(Date.now() - 2 * 24 * 60 * 60 * 1000)).toBe('2 days ago');
  });
  it('returns a locale date string for timestamps older than 7 days', () => {
    const old = Date.now() - 10 * 24 * 60 * 60 * 1000;
    expect(formatWhen(old)).toBe(new Date(old).toLocaleDateString());
  });
});

// ── platformMod ──────────────────────────────────────────────────────────────

describe('platformMod', () => {
  it('returns ⌘ on macOS', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      configurable: true,
    });
    expect(platformMod()).toBe('⌘');
  });
  it('returns Ctrl+ on Windows', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      configurable: true,
    });
    expect(platformMod()).toBe('Ctrl+');
  });
});

// ── EmptyStateView ───────────────────────────────────────────────────────────

describe('EmptyStateView — brand section', () => {
  it('renders "Awakon" brand title', () => {
    const host = makeHost();
    new EmptyStateView(host).render([], { onNew: vi.fn(), onPickRecent: vi.fn() });
    expect(host.querySelector('.aip-empty__brand-title')?.textContent).toBe('Awakon');
  });

  it('renders the tagline', () => {
    const host = makeHost();
    new EmptyStateView(host).render([], { onNew: vi.fn(), onPickRecent: vi.fn() });
    expect(host.querySelector('.aip-empty__brand-sub')?.textContent).toContain('run many agents');
  });
});

describe('EmptyStateView — New Session card', () => {
  it('renders a New Session card', () => {
    const host = makeHost();
    new EmptyStateView(host).render([], { onNew: vi.fn(), onPickRecent: vi.fn() });
    const card = host.querySelector('.aip-empty__card--primary');
    expect(card).not.toBeNull();
    expect(card?.querySelector('.aip-empty__card-title')?.textContent).toBe('New session');
  });

  it('fires onNew when the card is clicked', () => {
    const host = makeHost();
    const onNew = vi.fn();
    new EmptyStateView(host).render([], { onNew, onPickRecent: vi.fn() });
    (host.querySelector('.aip-empty__card--primary') as HTMLElement).click();
    expect(onNew).toHaveBeenCalledOnce();
  });
});

describe('EmptyStateView — Recent list', () => {
  it('does not render the recents section when list is empty', () => {
    const host = makeHost();
    new EmptyStateView(host).render([], { onNew: vi.fn(), onPickRecent: vi.fn() });
    expect(host.querySelector('.aip-empty__recents')).toBeNull();
  });

  it('renders a row for each recent tab', () => {
    const host = makeHost();
    const recents: RecentTab[] = [
      SAMPLE_RECENT,
      { title: 'other', cwd: '/other', shell: 'pwsh', closedAt: Date.now() - 1000 },
    ];
    new EmptyStateView(host).render(recents, { onNew: vi.fn(), onPickRecent: vi.fn() });
    expect(host.querySelectorAll('.aip-empty__recent').length).toBe(2);
  });

  it('renders chip, name, cwd in a row', () => {
    const host = makeHost();
    new EmptyStateView(host).render([SAMPLE_RECENT], { onNew: vi.fn(), onPickRecent: vi.fn() });
    const row = host.querySelector('.aip-empty__recent')!;
    expect(row.querySelector('.aip-empty__recent-chip')?.textContent).toBe('BSH');
    expect(row.querySelector('.aip-empty__recent-name')?.textContent).toBe('my-project');
    expect(row.querySelector('.aip-empty__recent-cwd')?.textContent).toBe('/home/me/work/proj');
  });

  it('fires onPickRecent with the correct item when a row is clicked', () => {
    const host = makeHost();
    const onPickRecent = vi.fn();
    new EmptyStateView(host).render([SAMPLE_RECENT], { onNew: vi.fn(), onPickRecent });
    (host.querySelector('.aip-empty__recent') as HTMLElement).click();
    expect(onPickRecent).toHaveBeenCalledWith(SAMPLE_RECENT);
  });
});
