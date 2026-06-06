export interface MarkdownLinkHit {
  /** The matched path text (trailing punctuation stripped). */
  text: string;
  /** Inclusive start offset into the line. */
  start: number;
  /** Exclusive end offset into the line. */
  end: number;
}

// A path-like run of characters ending in `.md`, with a word boundary after.
// Allows ./ ../ segments, letters/digits/_/-/. and / separators.
const MD_PATH_RE = /(?:\.{0,2}\/)?(?:[\w.-]+\/)*[\w.-]+\.md\b/g;

/**
 * Find `.md` path references in a single rendered terminal line. Pure string logic —
 * no filesystem access. Trailing `)` `.` `,` characters adjacent to the boundary are
 * excluded from the returned offsets so links inside prose ("(see x.md).") resolve cleanly.
 */
export function findMarkdownLinks(line: string): MarkdownLinkHit[] {
  const hits: MarkdownLinkHit[] = [];
  for (const m of line.matchAll(MD_PATH_RE)) {
    const start = m.index;
    let text = m[0];
    let end = start + text.length;
    while (text.length > 3 && /[).,]$/.test(text)) {
      text = text.slice(0, -1);
      end -= 1;
    }
    hits.push({ text, start, end });
  }
  return hits;
}
