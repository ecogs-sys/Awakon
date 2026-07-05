import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { isAllowedNavigation, isPathInside } from './navigation-guard.js';

const rendererDir =
  process.platform === 'win32' ? 'C:\\app\\out\\renderer' : '/app/out/renderer';
const appIndexUrl =
  process.platform === 'win32'
    ? 'file:///C:/app/out/renderer/index.html'
    : 'file:///app/out/renderer/index.html';

describe('isAllowedNavigation (R7)', () => {
  it('allows navigation within the same non-file origin', () => {
    expect(
      isAllowedNavigation('http://localhost:5173/foo', 'http://localhost:5173/', rendererDir),
    ).toBe(true);
  });

  it('rejects navigation to a different origin', () => {
    expect(
      isAllowedNavigation('https://evil.example/', 'http://localhost:5173/', rendererDir),
    ).toBe(false);
  });

  it('rejects file: -> file: navigation outside the renderer directory even though both origins are "null"', () => {
    const evilUrl =
      process.platform === 'win32' ? 'file:///C:/Users/victim/evil.html' : 'file:///tmp/evil.html';
    expect(isAllowedNavigation(evilUrl, appIndexUrl, rendererDir)).toBe(false);
  });

  it('rejects a file: URL on a different Windows drive letter than the renderer directory', () => {
    if (process.platform !== 'win32') return;
    expect(isAllowedNavigation('file:///D:/evil/payload.html', appIndexUrl, rendererDir)).toBe(false);
  });

  it('allows file: navigation to another file inside the renderer directory', () => {
    const otherPageUrl =
      process.platform === 'win32'
        ? 'file:///C:/app/out/renderer/terminal-host.html'
        : 'file:///app/out/renderer/terminal-host.html';
    expect(isAllowedNavigation(otherPageUrl, appIndexUrl, rendererDir)).toBe(true);
  });

  it('rejects a malformed URL instead of throwing', () => {
    expect(isAllowedNavigation('not a url', appIndexUrl, rendererDir)).toBe(false);
  });
});

const cwd = process.platform === 'win32' ? 'C:\\project\\cwd' : '/project/cwd';

describe('isPathInside (N9)', () => {
  it('allows a plain file directly inside baseDir', () => {
    expect(isPathInside(cwd, join(cwd, 'notes.md'))).toBe(true);
  });

  it('allows a nested file inside baseDir', () => {
    expect(isPathInside(cwd, join(cwd, 'sub', 'dir', 'notes.md'))).toBe(true);
  });

  it('allows baseDir itself', () => {
    expect(isPathInside(cwd, cwd)).toBe(true);
  });

  it('does NOT false-reject an in-cwd file literally named starting with ".."', () => {
    // relative() returns '..plan.md' unchanged for this — starts with '..' as a string
    // prefix without being a parent-traversal segment.
    expect(isPathInside(cwd, join(cwd, '..plan.md'))).toBe(true);
  });

  it('rejects real parent-directory traversal', () => {
    const parent = process.platform === 'win32' ? 'C:\\project\\escape.md' : '/project/escape.md';
    expect(isPathInside(cwd, parent)).toBe(false);
  });

  it('rejects a path on a different Windows drive', () => {
    if (process.platform !== 'win32') return;
    expect(isPathInside(cwd, 'D:\\other\\file.md')).toBe(false);
  });
});
