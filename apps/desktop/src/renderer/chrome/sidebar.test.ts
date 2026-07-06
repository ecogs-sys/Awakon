// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar, type SidebarRowVm } from './sidebar.js';
import type { SessionInfo } from '@awakon/contracts';

function info(id: string): SessionInfo {
  return { id, title: id, shell: 'pwsh', cwd: '/x', status: 'running', kind: 'tab', pid: 1, exitCode: null };
}
function row(id: string, statusSinceMs: number): SidebarRowVm {
  return { info: info(id), attention: false, statusSinceMs, resumeAt: null };
}

function callbacks() {
  return {
    onRowClick: vi.fn(), onToggle: vi.fn(), onRename: vi.fn(), onDuplicate: vi.fn(),
    onRestart: vi.fn(), onClose: vi.fn(), onResumeCancel: vi.fn(), onNewSession: vi.fn(),
  };
}

let listEl: HTMLElement;
let toggleEl: HTMLElement;
let sidebar: Sidebar;

beforeEach(() => {
  document.body.innerHTML = '';
  listEl = document.createElement('div');
  toggleEl = document.createElement('button');
  document.body.append(listEl, toggleEl);
  sidebar = new Sidebar({ listEl, toggleEl, callbacks: callbacks() });
});

describe('Sidebar.tick() (A5-I5)', () => {
  it('updates the elapsed-time label in place without rebuilding the row', () => {
    const now = Date.now();
    sidebar.render([row('t1', now - 5_000)], 't1');
    const rowEl = listEl.querySelector('[data-session-id="t1"]')!;
    expect(rowEl.querySelector('.sr-pill-time')?.textContent).toBe('· 5s');

    vi.useFakeTimers();
    try {
      vi.setSystemTime(now + 65_000);
      sidebar.tick();
      // Same row element identity — tick() must not have rebuilt the DOM.
      expect(listEl.querySelector('[data-session-id="t1"]')).toBe(rowEl);
      expect(rowEl.querySelector('.sr-pill-time')?.textContent).toBe('· 1m');
    } finally {
      vi.useRealTimers();
    }
  });

  it('is a no-op when there are no rows', () => {
    sidebar.render([], null);
    expect(() => sidebar.tick()).not.toThrow();
  });
});
