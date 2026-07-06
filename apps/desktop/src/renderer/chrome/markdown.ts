import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
});

// Render ```mermaid fences to a marker element that survives DOMPurify and
// preserves the raw source as text. mermaid.ts swaps these for SVG after the
// HTML is injected into the DOM. All other languages use the default renderer.
const defaultFence =
  md.renderer.rules.fence ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!;
  const info = token.info.trim().split(/\s+/)[0] ?? '';
  if (info === 'mermaid') {
    return `<pre class="aip-mermaid"><code>${md.utils.escapeHtml(token.content)}</code></pre>`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

/** Render markdown source to sanitized HTML for the reader body.
 * FORBID_ATTR strips `id`/`name` (A5-I4): markdown-it otherwise preserves an author's
 * `<a id="dialog-mount">` (or similar) verbatim, and DOMPurify's default profile does not
 * forbid `id` — letting untrusted markdown DOM-clobber `#dialog-mount` (or any other id
 * the app looks up via getElementById) once injected via innerHTML. */
export function renderMarkdown(source: string): string {
  const rawHtml = md.render(source);
  return DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true }, FORBID_ATTR: ['id', 'name'] });
}

/** Lines of source — shown as "N LOC" in the reader footer. */
export function countLoc(source: string): number {
  if (source === '') return 0;
  return source.split('\n').length;
}
