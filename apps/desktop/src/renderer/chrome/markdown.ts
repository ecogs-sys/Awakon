import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
});

/** Render markdown source to sanitized HTML for the reader body. */
export function renderMarkdown(source: string): string {
  const rawHtml = md.render(source);
  return DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
}

/** Lines of source — shown as "N LOC" in the reader footer. */
export function countLoc(source: string): number {
  if (source === '') return 0;
  return source.split('\n').length;
}
