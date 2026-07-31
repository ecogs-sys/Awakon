import { describe, expect, it } from 'vitest';
import { sanitizePasteText } from './sanitize-paste.js';

describe('sanitizePasteText (A6-I1)', () => {
  it('leaves plain text untouched', () => {
    expect(sanitizePasteText('hello world')).toBe('hello world');
  });

  it('strips ESC bytes so a forged bracketed-paste end marker cannot escape the paste', () => {
    // \x1b[201~ is the bracketed-paste end marker xterm.paste() itself appends; a
    // payload smuggling one mid-text would otherwise end the paste early and get
    // whatever follows treated as live keystrokes.
    const malicious = 'safe text\x1b[201~rm -rf /\r';
    const cleaned = sanitizePasteText(malicious);
    expect(cleaned).not.toContain('\x1b');
    expect(cleaned).toBe('safe text[201~rm -rf /\n');
  });

  it('collapses CRLF and lone CR to LF', () => {
    expect(sanitizePasteText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('strips every ESC byte, not just the first', () => {
    expect(sanitizePasteText('\x1bfoo\x1bbar\x1b')).toBe('foobar');
  });
});
