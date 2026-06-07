import { describe, expect, it } from 'vitest';
import {
  FsReadFilePayloadSchema,
  FsReadFileResponseSchema,
  DocOpenPayloadSchema,
  DocOpenRequestEventSchema,
  LayoutPersistDocsPayloadSchema,
  LayoutDocsForTabPayloadSchema,
  IpcChannel,
} from '@awakon/contracts';

describe('IpcChannel — doc reader channels', () => {
  it('defines the new channel strings', () => {
    expect(IpcChannel.FsReadFile).toBe('core.fs.read-file');
    expect(IpcChannel.DocOpen).toBe('core.doc.open');
    expect(IpcChannel.DocOpenRequest).toBe('event.doc.open-request');
    expect(IpcChannel.LayoutPersistDocs).toBe('core.layout.persist-docs');
    expect(IpcChannel.LayoutDocsForTab).toBe('core.layout.docs-for-tab');
  });
});

describe('FsReadFile schemas', () => {
  it('accepts a valid request', () => {
    expect(FsReadFilePayloadSchema.safeParse({ path: '/x/a.md' }).success).toBe(true);
  });
  it('rejects an empty path', () => {
    expect(FsReadFilePayloadSchema.safeParse({ path: '' }).success).toBe(false);
  });
  it('accepts each response variant', () => {
    expect(FsReadFileResponseSchema.safeParse({ content: '# hi', sizeBytes: 4, mtimeMs: 1 }).success).toBe(true);
    expect(FsReadFileResponseSchema.safeParse({ tooLarge: true, sizeBytes: 2_000_000 }).success).toBe(true);
    expect(FsReadFileResponseSchema.safeParse({ notFound: true }).success).toBe(true);
    expect(FsReadFileResponseSchema.safeParse({ error: 'nope' }).success).toBe(true);
  });
});

describe('DocOpen schemas', () => {
  it('accepts a request from a terminal pane', () => {
    expect(DocOpenPayloadSchema.safeParse({ sessionId: 's1', path: 'docs/x.md' }).success).toBe(true);
  });
  it('accepts the open-request event', () => {
    expect(DocOpenRequestEventSchema.safeParse({
      tabId: 't1', rawPath: 'docs/x.md', resolvedPath: '/x/docs/x.md',
      provenanceTitle: 'pwsh', provenanceStatus: 'running',
    }).success).toBe(true);
  });
});

describe('Layout doc persistence schemas', () => {
  it('accepts a persist-docs payload', () => {
    expect(LayoutPersistDocsPayloadSchema.safeParse({
      tabId: 't1',
      docs: [{
        rawPath: 'a.md', resolvedPath: '/x/a.md',
        provenanceTitle: 'pwsh', provenanceStatus: 'running', reviewState: 'proposed',
      }],
      activeDocIndex: 0,
    }).success).toBe(true);
  });
  it('accepts an empty docs list with null index', () => {
    expect(LayoutPersistDocsPayloadSchema.safeParse({ tabId: 't1', docs: [], activeDocIndex: null }).success).toBe(true);
  });
  it('accepts a docs-for-tab request', () => {
    expect(LayoutDocsForTabPayloadSchema.safeParse({ tabId: 't1' }).success).toBe(true);
  });
});
