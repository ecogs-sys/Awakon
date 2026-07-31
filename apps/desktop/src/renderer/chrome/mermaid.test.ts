// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMermaidBlocks } from './mermaid.js';

// Mock the mermaid module. render() returns a marker SVG; initialize() is spied.
const renderMock = vi.fn(async (id: string, src: string) => ({
  svg: `<svg data-id="${id}"><title>${src}</title></svg>`,
}));
const initializeMock = vi.fn();
vi.mock('mermaid', () => ({
  default: { initialize: initializeMock, render: renderMock },
}));

afterEach(() => {
  vi.clearAllMocks();
});

function host(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

describe('renderMermaidBlocks', () => {
  it('replaces a marker with the rendered SVG', async () => {
    const el = host('<pre class="aip-mermaid"><code>graph TD; A--&gt;B</code></pre>');
    await renderMermaidBlocks(el);
    expect(el.querySelector('svg')).not.toBeNull();
    expect(el.querySelector('pre.aip-mermaid')).toBeNull();
    expect(initializeMock).toHaveBeenCalledTimes(1);
  });

  it('renders every marker when there are several', async () => {
    const el = host(
      '<pre class="aip-mermaid"><code>graph TD; A-->B</code></pre>' +
        '<pre class="aip-mermaid"><code>graph LR; C-->D</code></pre>',
    );
    await renderMermaidBlocks(el);
    expect(el.querySelectorAll('svg')).toHaveLength(2);
    expect(renderMock).toHaveBeenCalledTimes(2);
  });

  it('shows an error banner and keeps the source when render fails', async () => {
    renderMock.mockRejectedValueOnce(new Error('Parse error on line 2'));
    const el = host('<pre class="aip-mermaid"><code>bad diagram</code></pre>');
    await renderMermaidBlocks(el);
    expect(el.querySelector('svg')).toBeNull();
    expect(el.querySelector('.aip-mermaid-error')).not.toBeNull();
    expect(el.textContent).toContain('Parse error on line 2');
    // original code retained, marker class removed so it is not re-processed
    expect(el.querySelector('pre')).not.toBeNull();
    expect(el.querySelector('pre.aip-mermaid')).toBeNull();
    expect(el.textContent).toContain('bad diagram');
  });

  it('sanitizes the rendered SVG before injecting it (A5-I3)', async () => {
    renderMock.mockResolvedValueOnce({
      svg: '<svg><script>alert(1)</script><rect onload="alert(2)" width="1" height="1"/></svg>',
    });
    const el = host('<pre class="aip-mermaid"><code>graph TD; A-->B</code></pre>');
    await renderMermaidBlocks(el);
    expect(el.querySelector('script')).toBeNull();
    expect(el.innerHTML).not.toContain('onload');
    // The rest of the SVG (a harmless rect) survives sanitization.
    expect(el.querySelector('rect')).not.toBeNull();
  });

  it('does not import mermaid when there are no markers', async () => {
    const el = host('<p>no diagrams here</p>');
    await renderMermaidBlocks(el);
    expect(initializeMock).not.toHaveBeenCalled();
    expect(renderMock).not.toHaveBeenCalled();
  });

  it('imports and initializes mermaid only once across multiple calls', async () => {
    // The memoized module promise persists across tests, so by the time this
    // test runs mermaid may already be loaded/initialized. Assert on the delta:
    // a second render call must add no further initialize() beyond the first.
    await renderMermaidBlocks(host('<pre class="aip-mermaid"><code>graph TD; A-->B</code></pre>'));
    const afterFirstCall = initializeMock.mock.calls.length;
    await renderMermaidBlocks(host('<pre class="aip-mermaid"><code>graph LR; C-->D</code></pre>'));
    expect(initializeMock.mock.calls.length).toBe(afterFirstCall);
    expect(initializeMock.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
