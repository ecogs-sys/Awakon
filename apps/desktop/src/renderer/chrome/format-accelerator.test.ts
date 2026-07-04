import { describe, expect, it } from 'vitest';
import { Bindings, formatAccelerator } from '@awakon/keymap';

describe('formatAccelerator — Windows/Linux', () => {
  for (const platform of ['win32', 'linux']) {
    it(`renders the Ctrl+ form on ${platform}`, () => {
      expect(formatAccelerator('CmdOrCtrl+K', platform)).toBe('Ctrl+K');
      expect(formatAccelerator('CmdOrCtrl+Shift+\\', platform)).toBe('Ctrl+Shift+\\');
      expect(formatAccelerator('CmdOrCtrl+1', platform)).toBe('Ctrl+1');
      expect(formatAccelerator('CmdOrCtrl+Tab', platform)).toBe('Ctrl+Tab');
      expect(formatAccelerator('CmdOrCtrl+,', platform)).toBe('Ctrl+,');
    });
  }
});

describe('formatAccelerator — macOS', () => {
  it('renders the glyph cluster', () => {
    expect(formatAccelerator('CmdOrCtrl+K', 'darwin')).toBe('⌘K');
    expect(formatAccelerator('CmdOrCtrl+Shift+\\', 'darwin')).toBe('⇧⌘\\');
    expect(formatAccelerator('CmdOrCtrl+Tab', 'darwin')).toBe('⌘Tab');
    expect(formatAccelerator('Alt+Shift+F', 'darwin')).toBe('⌥⇧F');
  });
});

describe('formatAccelerator — bindings', () => {
  it('registers a CmdOrCtrl+K command-palette binding', () => {
    expect(Bindings.commandPalette.accelerator).toBe('CmdOrCtrl+K');
  });
});
