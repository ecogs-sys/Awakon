// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown, countLoc } from './markdown.js';

describe('renderMarkdown', () => {
  it('renders headings and paragraphs', () => {
    const html = renderMarkdown('# Title\n\nHello world');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<p>Hello world</p>');
  });

  it('renders fenced code blocks', () => {
    const html = renderMarkdown('```\nconst x = 1;\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('const x = 1;');
  });

  it('sanitizes script tags', () => {
    const html = renderMarkdown('ok <script>alert(1)</script>');
    expect(html).not.toContain('<script>');
  });

  it('strips event-handler attributes', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('onerror');
  });

  it('emits an aip-mermaid marker for mermaid fences', () => {
    const html = renderMarkdown('```mermaid\ngraph TD; A-->B\n```');
    expect(html).toContain('class="aip-mermaid"');
    // raw source preserved as (escaped) text content
    expect(html).toContain('graph TD; A--&gt;B');
    expect(html).not.toContain('language-mermaid');
  });

  it('leaves non-mermaid fences as normal code blocks', () => {
    const html = renderMarkdown('```\nconst x = 1;\n```');
    expect(html).toContain('<pre>');
    expect(html).not.toContain('aip-mermaid');
    expect(html).toContain('const x = 1;');
  });
});

describe('countLoc', () => {
  it('counts lines of the raw source', () => {
    expect(countLoc('a\nb\nc')).toBe(3);
    expect(countLoc('')).toBe(0);
  });
});
