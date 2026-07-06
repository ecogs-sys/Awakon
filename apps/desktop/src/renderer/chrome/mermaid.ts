import DOMPurify from 'dompurify';

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, source: string) => Promise<{ svg: string }>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;
let idSeq = 0;

/** Lazily load and initialize mermaid once (dark, non-interactive). The promise
 * is memoized so the import and initialize() run exactly once across all calls. */
function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      const mermaid = m.default as MermaidApi;
      mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
      return mermaid;
    });
  }
  return mermaidPromise;
}

/**
 * Find pre.aip-mermaid markers in `container` and replace each with rendered
 * SVG. On failure, insert an error banner and keep the original code block.
 * Imports mermaid only when at least one marker is present.
 */
export async function renderMermaidBlocks(container: HTMLElement): Promise<void> {
  const blocks = Array.from(container.querySelectorAll<HTMLElement>('pre.aip-mermaid'));
  if (blocks.length === 0) return;

  const mermaid = await loadMermaid();

  for (const block of blocks) {
    const source = block.textContent ?? '';
    const id = `aip-mermaid-${++idSeq}`;
    try {
      const { svg } = await mermaid.render(id, source);
      // `securityLevel: 'strict'` is mermaid's own diagram-source sanitization, not a
      // guarantee about the SVG markup it emits — DOMPurify is the actual barrier before
      // this untrusted-source-derived string is injected via innerHTML (A5-I3).
      const safeSvg = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
      const wrapper = document.createElement('div');
      wrapper.className = 'aip-mermaid-rendered';
      wrapper.innerHTML = safeSvg;
      block.replaceWith(wrapper);
    } catch (err) {
      const banner = document.createElement('div');
      banner.className = 'aip-mermaid-error';
      banner.textContent = `Diagram error: ${err instanceof Error ? err.message : String(err)}`;
      block.classList.remove('aip-mermaid'); // leave source visible, don't re-process
      block.before(banner);
    }
  }
}
