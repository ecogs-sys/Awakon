// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TabStrip, type TabViewModel } from './tab-strip.js';
import type { SessionInfo } from '@awakon/contracts';

function info(id: string): SessionInfo {
  return { id, title: id, shell: 'pwsh', cwd: '/x', status: 'running', kind: 'tab', pid: 1, exitCode: null };
}
function vm(id: string, hasDoc: boolean): TabViewModel {
  return { info: info(id), attention: false, broken: false, resumeAt: null, hasDoc };
}

let root: HTMLElement;
beforeEach(() => { document.body.innerHTML = ''; root = document.createElement('div'); document.body.appendChild(root); });

const callbacks = () => ({ onTabClick: vi.fn(), onTabClose: vi.fn(), onNewTab: vi.fn(), onTabReorder: vi.fn() });

describe('TabStrip M↓ marker', () => {
  it('renders an M↓ marker on a tab that has an open doc', () => {
    new TabStrip(root, callbacks()).render([vm('t1', true)], 't1');
    expect(root.querySelector('.tab .doc-marker')?.textContent).toBe('M↓');
  });

  it('does not render the marker when the tab has no doc', () => {
    new TabStrip(root, callbacks()).render([vm('t1', false)], 't1');
    expect(root.querySelector('.tab .doc-marker')).toBeNull();
  });
});
