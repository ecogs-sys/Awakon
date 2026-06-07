import { describe, expect, it } from 'vitest';
import { findMarkdownLinks } from './md-links.js';

describe('findMarkdownLinks', () => {
  it('finds a simple relative .md path', () => {
    const hits = findMarkdownLinks('see docs/migration.md for details');
    expect(hits).toEqual([{ text: 'docs/migration.md', start: 4, end: 21 }]);
  });

  it('finds multiple links on a line', () => {
    const hits = findMarkdownLinks('a.md and b/c.md');
    expect(hits.map((h) => h.text)).toEqual(['a.md', 'b/c.md']);
  });

  it('matches a bare filename', () => {
    expect(findMarkdownLinks('README.md').map((h) => h.text)).toEqual(['README.md']);
  });

  it('matches ./ and ../ prefixes', () => {
    expect(findMarkdownLinks('./a.md ../b.md').map((h) => h.text)).toEqual(['./a.md', '../b.md']);
  });

  it('strips a trailing paren/period that is not part of the path', () => {
    expect(findMarkdownLinks('(see docs/x.md).').map((h) => h.text)).toEqual(['docs/x.md']);
  });

  it('ignores .markdown and bare "md"', () => {
    expect(findMarkdownLinks('notes.markdown and md alone')).toEqual([]);
  });

  it('returns correct start/end offsets for slicing', () => {
    const line = 'open README.md now';
    const [hit] = findMarkdownLinks(line);
    expect(line.slice(hit!.start, hit!.end)).toBe('README.md');
  });
});
