type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, source: string) => Promise<{ svg: string }>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;
let initialized = false;
let idSeq = 0;

/** Lazily load mermaid once and initialize it once (dark, non-interactive). */
async function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default as MermaidApi);
  }
  const mermaid = await mermaidPromise;
  if (!initialized) {
    mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
    initialized = true;
  }
  return mermaid;
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
      const wrapper = document.createElement('div');
      wrapper.className = 'aip-mermaid-rendered';
      wrapper.innerHTML = svg;
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
