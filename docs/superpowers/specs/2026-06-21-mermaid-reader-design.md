# Mermaid diagram rendering in the markdown reader

**Date:** 2026-06-21
**Status:** Approved (design)

## Problem

The desktop app's markdown reader (`apps/desktop/src/renderer/chrome`) renders
markdown via `markdown-it` + `DOMPurify`. Fenced ` ```mermaid ` blocks are shown
as plain source code instead of rendered diagrams. We want them rendered as
inline SVG diagrams, matching the app's dark theme.

## Decisions

- **Loading:** lazy `import('mermaid')`, only the first time a viewed document
  actually contains a mermaid block. Documents without diagrams never pull
  mermaid into memory.
- **On render failure:** show a small error banner and fall back to the original
  fenced code block (source stays readable/copyable).
- **Interaction:** inline render only — no pan/zoom/click-to-enlarge.
- **Theme:** mermaid's built-in `dark` theme (no custom `themeVariables`).
- **Security:** mermaid runs at `securityLevel: 'strict'` (sanitizes its own SVG
  output). We do not re-run DOMPurify on the finished SVG.

## Architecture

The existing separation is preserved: `renderMarkdown()` stays a **pure,
synchronous** function returning sanitized HTML. Mermaid rendering — inherently
async and DOM-based — runs as a separate pass after the HTML is injected.

### 1. `markdown.ts` — mark mermaid fences

Override `markdown-it`'s fence renderer so a ` ```mermaid ` block produces a
*marker* element instead of a highlighted code block:

```html
<pre class="aip-mermaid"><code>graph TD; A--&gt;B</code></pre>
```

- Raw source is preserved as the `<code>` text content.
- Survives DOMPurify (it keeps `<pre>`/`<code>` and the `class` attribute).
- The `<code>` child doubles as the error-fallback view.
- All other code blocks render exactly as before.

`renderMarkdown()` remains sync and keeps its existing DOMPurify pass unchanged.

### 2. `mermaid.ts` (new) — render the marked blocks

Single export:

```ts
export async function renderMermaidBlocks(container: HTMLElement): Promise<void>
```

Behavior:

1. Query `pre.aip-mermaid` inside `container`. If none, return immediately —
   mermaid is never imported.
2. Lazy `await import('mermaid')` on first need. Initialize once
   (module-level guard) with
   `{ startOnLoad: false, theme: 'dark', securityLevel: 'strict' }`.
3. For each block: call `mermaid.render(uniqueId, source)`; on success replace
   the `<pre>` with the returned SVG (wrapped in a `div.aip-mermaid-rendered`).
4. On failure: insert an error banner before the block and leave the original
   `<pre><code>` in place; remove the `aip-mermaid` marker class so it is not
   re-processed.

The module owns all mermaid concerns (loading, init, per-block render, error
handling) and is testable in isolation with a mocked `mermaid` module.

### 3. `doc-reader.ts` — invoke the pass

In `loadBody()`, after `bodyEl.innerHTML = …` for the `content` branch, call
`await renderMermaidBlocks(bodyEl)`. Reuse the existing `loadToken` +
`isConnected` guard: re-check `token === this.loadToken` and `bodyEl.isConnected`
after the await so a doc switch mid-render cannot write an SVG into a stale body.

## Data flow

```
file content
  -> renderMarkdown()           (sync; sanitized HTML with pre.aip-mermaid markers)
  -> injected into .aip-reader__body
  -> renderMermaidBlocks(body)  (async; markers -> SVG, or error banner + code)
```

## Edge cases

- No mermaid blocks → mermaid never imported.
- Multiple blocks → each rendered with a unique id.
- Doc switch mid-render → token/`isConnected` guard discards stale writes.
- Invalid syntax → error banner + original code retained.

## Styling

Add a small block to `chrome.css`:

- `.aip-mermaid-rendered svg { max-width: 100%; height: auto; }`, centered.
- Error banner styled with the existing `--st-limited` red token.

## Testing

- `markdown.test.ts`: a ` ```mermaid ` fence yields `pre.aip-mermaid` with source
  preserved; a normal ` ``` ` fence is unchanged.
- `mermaid.test.ts` (jsdom, mocked `mermaid` module):
  - success swaps in the SVG;
  - failure shows the error banner and keeps the original code;
  - a container with no mermaid blocks never imports mermaid;
  - multiple blocks each render.

## Dependency

Add `mermaid` (v11) to `apps/desktop/package.json` dependencies.
