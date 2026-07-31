// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '@awakon/contracts';
import { DocReader } from './doc-reader.js';
import { emptyDocState, openDoc, type OpenDoc } from './doc-state.js';

function doc(over: Partial<OpenDoc> = {}): OpenDoc {
  return {
    rawPath: 'docs/migration.md',
    resolvedPath: '/x/docs/migration.md',
    provenanceTitle: 'pwsh',
    provenanceStatus: 'running',
    reviewState: 'proposed',
    ...over,
  };
}

const callbacks = () => ({
  onDismiss: vi.fn(),
  onSelectFile: vi.fn(),
  onCloseFile: vi.fn(),
  onReview: vi.fn(),
  onPrevFile: vi.fn(),
  onNextFile: vi.fn(),
});

function fakeBridge(response: unknown) {
  return { send: vi.fn().mockResolvedValue(response) };
}

let host: HTMLElement;
beforeEach(() => { document.body.innerHTML = ''; host = document.createElement('div'); document.body.appendChild(host); });
afterEach(() => { vi.restoreAllMocks(); });

describe('DocReader visibility', () => {
  it('renders nothing when readerVisible is false', () => {
    const r = new DocReader(host, fakeBridge({ notFound: true }), callbacks(), 'linux');
    r.render(emptyDocState(), 'tab-1');
    expect(host.querySelector('.aip-reader')).toBeNull();
  });

  it('renders the panel + scrim when a doc is active and visible', () => {
    const r = new DocReader(host, fakeBridge({ content: '# Hi', sizeBytes: 4, mtimeMs: 1 }), callbacks(), 'linux');
    r.render(openDoc(emptyDocState(), doc()), 'tab-1');
    expect(host.querySelector('.aip-reader')).not.toBeNull();
    expect(host.querySelector('.aip-reader__scrim')).not.toBeNull();
  });
});

describe('DocReader file tabs', () => {
  it('renders one file tab per open doc with the active one marked', () => {
    const r = new DocReader(host, fakeBridge({ notFound: true }), callbacks(), 'linux');
    let s = openDoc(emptyDocState(), doc({ resolvedPath: '/x/a.md', rawPath: 'a.md' }));
    s = openDoc(s, doc({ resolvedPath: '/x/b.md', rawPath: 'b.md' }));
    r.render(s, 'tab-1');
    const tabs = host.querySelectorAll('.aip-reader__file');
    expect(tabs).toHaveLength(2);
    expect(host.querySelectorAll('.aip-reader__file.active')).toHaveLength(1);
  });

  it('fires onSelectFile when a non-active file tab is clicked', () => {
    const cb = callbacks();
    const r = new DocReader(host, fakeBridge({ notFound: true }), cb, 'linux');
    let s = openDoc(emptyDocState(), doc({ resolvedPath: '/x/a.md' }));
    s = openDoc(s, doc({ resolvedPath: '/x/b.md' }));
    r.render(s, 'tab-1');
    (host.querySelectorAll('.aip-reader__file')[0] as HTMLElement).click();
    expect(cb.onSelectFile).toHaveBeenCalledWith(0);
  });

  it('fires onCloseFile when a file tab × is clicked', () => {
    const cb = callbacks();
    const r = new DocReader(host, fakeBridge({ notFound: true }), cb, 'linux');
    r.render(openDoc(emptyDocState(), doc()), 'tab-1');
    (host.querySelector('.aip-reader__file-close') as HTMLElement).click();
    expect(cb.onCloseFile).toHaveBeenCalledWith(0);
  });
});

describe('DocReader review actions', () => {
  it('fires onReview("approved") when Approve is clicked', () => {
    const cb = callbacks();
    const r = new DocReader(host, fakeBridge({ notFound: true }), cb, 'linux');
    r.render(openDoc(emptyDocState(), doc()), 'tab-1');
    (host.querySelector('.aip-reader__approve') as HTMLElement).click();
    expect(cb.onReview).toHaveBeenCalledWith(0, 'approved');
  });

  it('fires onReview("changes-requested") when Request changes is clicked', () => {
    const cb = callbacks();
    const r = new DocReader(host, fakeBridge({ notFound: true }), cb, 'linux');
    r.render(openDoc(emptyDocState(), doc()), 'tab-1');
    (host.querySelector('.aip-reader__request') as HTMLElement).click();
    expect(cb.onReview).toHaveBeenCalledWith(0, 'changes-requested');
  });

  it('shows the provenance title', () => {
    const r = new DocReader(host, fakeBridge({ notFound: true }), callbacks(), 'linux');
    r.render(openDoc(emptyDocState(), doc({ provenanceTitle: 'claude · refactor' })), 'tab-1');
    expect(host.querySelector('.aip-reader__provenance')?.textContent).toContain('claude · refactor');
  });
});

describe('DocReader dismiss', () => {
  it('fires onDismiss on scrim click', () => {
    const cb = callbacks();
    const r = new DocReader(host, fakeBridge({ notFound: true }), cb, 'linux');
    r.render(openDoc(emptyDocState(), doc()), 'tab-1');
    (host.querySelector('.aip-reader__scrim') as HTMLElement).click();
    expect(cb.onDismiss).toHaveBeenCalled();
  });

  it('fires onDismiss on Escape while visible', () => {
    const cb = callbacks();
    const r = new DocReader(host, fakeBridge({ notFound: true }), cb, 'linux');
    r.render(openDoc(emptyDocState(), doc()), 'tab-1');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cb.onDismiss).toHaveBeenCalled();
  });
});

describe('DocReader body', () => {
  it('renders a "(not yet created)" placeholder for a missing file', async () => {
    const r = new DocReader(host, fakeBridge({ notFound: true }), callbacks(), 'linux');
    r.render(openDoc(emptyDocState(), doc({ rawPath: 'docs/new.md' })), 'tab-1');
    await Promise.resolve(); await Promise.resolve();
    expect(host.querySelector('.aip-reader__body')?.textContent).toContain('not yet created');
  });

  it('renders parsed markdown for an existing file', async () => {
    const r = new DocReader(host, fakeBridge({ content: '# Heading', sizeBytes: 9, mtimeMs: 1 }), callbacks(), 'linux');
    r.render(openDoc(emptyDocState(), doc()), 'tab-1');
    await Promise.resolve(); await Promise.resolve();
    expect(host.querySelector('.aip-reader__body h1')?.textContent).toBe('Heading');
  });

  it('renders a large-file placeholder', async () => {
    const r = new DocReader(host, fakeBridge({ tooLarge: true, sizeBytes: 2_000_000 }), callbacks(), 'linux');
    r.render(openDoc(emptyDocState(), doc()), 'tab-1');
    await Promise.resolve(); await Promise.resolve();
    expect(host.querySelector('.aip-reader__body')?.textContent).toContain('too large');
  });

  it('N6: sends the tabId alongside path in the FsReadFile request', async () => {
    const bridge = fakeBridge({ content: '# Hi', sizeBytes: 4, mtimeMs: 1 });
    const r = new DocReader(host, bridge, callbacks(), 'linux');
    r.render(openDoc(emptyDocState(), doc()), 'tab-42');
    await Promise.resolve(); await Promise.resolve();
    expect(bridge.send).toHaveBeenCalledWith(IpcChannel.FsReadFile, { path: doc().resolvedPath, tabId: 'tab-42' });
  });
});

describe('DocReader keyboard navigation', () => {
  it('fires onPrevFile on Ctrl/Cmd+[ while visible', () => {
    const cb = callbacks();
    const r = new DocReader(host, fakeBridge({ notFound: true }), cb, 'linux');
    r.render(openDoc(emptyDocState(), doc()), 'tab-1');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '[', ctrlKey: true }));
    expect(cb.onPrevFile).toHaveBeenCalled();
  });

  it('fires onNextFile on Ctrl/Cmd+] while visible', () => {
    const cb = callbacks();
    const r = new DocReader(host, fakeBridge({ notFound: true }), cb, 'linux');
    r.render(openDoc(emptyDocState(), doc()), 'tab-1');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ']', ctrlKey: true }));
    expect(cb.onNextFile).toHaveBeenCalled();
  });

  it('does not fire nav callbacks after the reader is hidden', () => {
    const cb = callbacks();
    const r = new DocReader(host, fakeBridge({ notFound: true }), cb, 'linux');
    r.render(openDoc(emptyDocState(), doc()), 'tab-1');
    r.render(emptyDocState(), 'tab-1'); // hide → keydown listener must be removed
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ']', ctrlKey: true }));
    expect(cb.onNextFile).not.toHaveBeenCalled();
  });
});

describe('DocReader close cell + error body', () => {
  it('fires onDismiss when the right-aligned close cell is clicked', () => {
    const cb = callbacks();
    const r = new DocReader(host, fakeBridge({ notFound: true }), cb, 'linux');
    r.render(openDoc(emptyDocState(), doc()), 'tab-1');
    (host.querySelector('.aip-reader__close') as HTMLElement).click();
    expect(cb.onDismiss).toHaveBeenCalled();
  });

  it('renders an error message when the read fails', async () => {
    const r = new DocReader(host, fakeBridge({ error: 'boom' }), callbacks(), 'linux');
    r.render(openDoc(emptyDocState(), doc()), 'tab-1');
    await Promise.resolve(); await Promise.resolve();
    expect(host.querySelector('.aip-reader__body')?.textContent).toContain('Could not read file');
  });
});

describe('DocReader slide animation', () => {
  it('plays the slide-in on a fresh open (no --static class)', () => {
    const r = new DocReader(host, fakeBridge({ notFound: true }), callbacks(), 'linux');
    r.render(openDoc(emptyDocState(), doc()), 'tab-1');
    const panel = host.querySelector('.aip-reader__panel')!;
    expect(panel.classList.contains('aip-reader__panel--static')).toBe(false);
  });

  it('suppresses the slide when re-rendering while already visible (file switch)', () => {
    const cb = callbacks();
    const r = new DocReader(host, fakeBridge({ notFound: true }), cb, 'linux');
    let s = openDoc(emptyDocState(), doc({ resolvedPath: '/x/a.md', rawPath: 'a.md' }));
    s = openDoc(s, doc({ resolvedPath: '/x/b.md', rawPath: 'b.md' }));
    r.render(s, 'tab-1');                       // fresh open -> animates
    r.render({ ...s, activeDocIndex: 0 }, 'tab-1'); // switch file while visible -> no slide
    const panel = host.querySelector('.aip-reader__panel')!;
    expect(panel.classList.contains('aip-reader__panel--static')).toBe(true);
  });

  it('animates again after the reader was closed and reopened', () => {
    const r = new DocReader(host, fakeBridge({ notFound: true }), callbacks(), 'linux');
    r.render(openDoc(emptyDocState(), doc()), 'tab-1');
    r.render(emptyDocState(), 'tab-1');         // close (removes the panel)
    r.render(openDoc(emptyDocState(), doc()), 'tab-1'); // reopen -> animates again
    const panel = host.querySelector('.aip-reader__panel')!;
    expect(panel.classList.contains('aip-reader__panel--static')).toBe(false);
  });
});

describe('DocReader markdown links', () => {
  it('opens an http(s) link externally and never navigates the chrome window', async () => {
    const bridge = fakeBridge({ content: '[site](https://example.com)', sizeBytes: 28, mtimeMs: 1 });
    const r = new DocReader(host, bridge, callbacks(), 'linux');
    r.render(openDoc(emptyDocState(), doc()), 'tab-1');
    await Promise.resolve(); await Promise.resolve();
    const a = host.querySelector('.aip-reader__body a') as HTMLAnchorElement;
    expect(a).not.toBeNull();
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(bridge.send.mock.calls.some(
      (c) => c[0] === IpcChannel.ChromeOpenExternal && (c[1] as { url: string }).url === 'https://example.com',
    )).toBe(true);
  });

  it('swallows a non-http link without opening anything external', async () => {
    const bridge = fakeBridge({ content: '[anchor](#section)', sizeBytes: 18, mtimeMs: 1 });
    const r = new DocReader(host, bridge, callbacks(), 'linux');
    r.render(openDoc(emptyDocState(), doc()), 'tab-1');
    await Promise.resolve(); await Promise.resolve();
    const a = host.querySelector('.aip-reader__body a') as HTMLAnchorElement;
    expect(a).not.toBeNull();
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(bridge.send.mock.calls.some((c) => c[0] === IpcChannel.ChromeOpenExternal)).toBe(false);
  });
});
