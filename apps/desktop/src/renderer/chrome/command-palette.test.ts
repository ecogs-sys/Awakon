// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette, type PaletteCommand } from './command-palette.js';

function makeCommands(runs: Record<string, () => void> = {}): PaletteCommand[] {
  return [
    { id: 's1', group: 'Switch to session', title: 'claude · refactor', meta: '~/Awakon', chip: 'CL', status: 'awaiting', accel: 'Ctrl+1', run: runs['s1'] ?? vi.fn() },
    { id: 's2', group: 'Switch to session', title: 'codex · tests',     meta: '~/Awakon', chip: 'CX', status: 'limited',  accel: 'Ctrl+2', run: runs['s2'] ?? vi.fn() },
    { id: 'a1', group: 'Actions', title: 'New session',    chip: '+', accel: 'Ctrl+T', run: runs['a1'] ?? vi.fn() },
    { id: 'a2', group: 'Actions', title: 'Toggle sidebar', chip: '▤', accel: 'Ctrl+B', run: runs['a2'] ?? vi.fn() },
  ];
}

function mk(runs?: Record<string, () => void>) {
  const buildCommands = vi.fn(() => makeCommands(runs));
  const palette = new CommandPalette({ hotkeyLabel: 'Ctrl+K', buildCommands });
  return { palette, buildCommands };
}

function type(value: string): void {
  const input = document.querySelector<HTMLInputElement>('.aip-pal__input')!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function key(k: string): void {
  const input = document.querySelector<HTMLInputElement>('.aip-pal__input')!;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
}

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('.aip-pal__row'));
}
function row(i: number): HTMLElement {
  const r = rows()[i];
  if (!r) throw new Error(`no row at ${i}`);
  return r;
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('CommandPalette', () => {
  it('opens, rebuilds commands, and renders grouped rows', () => {
    const { palette, buildCommands } = mk();
    palette.open();
    expect(palette.isOpen).toBe(true);
    expect(buildCommands).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('.aip-pal__group').length).toBe(2);
    expect(rows().length).toBe(4);
    expect(document.querySelector('.aip-pal__hotkey')?.textContent).toBe('Ctrl+K');
    expect(document.querySelector('.aip-pal__count')?.textContent).toBe('4 results');
  });

  it('highlights the first row by default', () => {
    const { palette } = mk();
    palette.open();
    expect(row(0).classList.contains('active')).toBe(true);
  });

  it('filters rows by title and meta as you type', () => {
    const { palette } = mk();
    palette.open();
    type('codex');
    expect(rows().length).toBe(1);
    expect(row(0).querySelector('.aip-pal__title')?.textContent).toBe('codex · tests');
    expect(document.querySelector('.aip-pal__count')?.textContent).toBe('1 result');
  });

  it('arrow keys move the highlight and wrap around', () => {
    const { palette } = mk();
    palette.open();
    key('ArrowDown');
    expect(row(1).classList.contains('active')).toBe(true);
    key('ArrowUp');
    key('ArrowUp'); // wrap past the top → last row
    expect(row(rows().length - 1).classList.contains('active')).toBe(true);
  });

  it('Enter runs the highlighted command and closes', () => {
    const s1 = vi.fn();
    const { palette } = mk({ s1 });
    palette.open();
    key('Enter');
    expect(s1).toHaveBeenCalledOnce();
    expect(palette.isOpen).toBe(false);
  });

  it('Enter after filtering runs the matching command', () => {
    const a2 = vi.fn();
    const { palette } = mk({ a2 });
    palette.open();
    type('sidebar');
    key('Enter');
    expect(a2).toHaveBeenCalledOnce();
  });

  it('clicking a row runs it', () => {
    const s2 = vi.fn();
    const { palette } = mk({ s2 });
    palette.open();
    row(1).click();
    expect(s2).toHaveBeenCalledOnce();
    expect(palette.isOpen).toBe(false);
  });

  it('Escape closes without running anything', () => {
    const s1 = vi.fn();
    const { palette } = mk({ s1 });
    palette.open();
    key('Escape');
    expect(palette.isOpen).toBe(false);
    expect(s1).not.toHaveBeenCalled();
  });

  it('toggle opens then closes', () => {
    const { palette } = mk();
    palette.toggle();
    expect(palette.isOpen).toBe(true);
    palette.toggle();
    expect(palette.isOpen).toBe(false);
  });
});
