import { describe, expect, it } from 'vitest';
import {
  emptyDocState,
  openDoc,
  closeDocAt,
  setReview,
  toPersistedDocs,
  fromPersistedDocs,
  type OpenDoc,
} from './doc-state.js';

function sampleDoc(over: Partial<OpenDoc> = {}): OpenDoc {
  return {
    rawPath: 'docs/a.md',
    resolvedPath: '/x/docs/a.md',
    provenanceTitle: 'pwsh',
    provenanceStatus: 'running',
    reviewState: 'proposed',
    ...over,
  };
}

describe('openDoc', () => {
  it('adds a new doc, makes it active + visible', () => {
    const s = openDoc(emptyDocState(), sampleDoc());
    expect(s.openDocs).toHaveLength(1);
    expect(s.activeDocIndex).toBe(0);
    expect(s.readerVisible).toBe(true);
  });

  it('does not duplicate an already-open doc; re-activates it', () => {
    let s = openDoc(emptyDocState(), sampleDoc({ resolvedPath: '/x/a.md' }));
    s = openDoc(s, sampleDoc({ resolvedPath: '/x/b.md' }));
    s = openDoc(s, sampleDoc({ resolvedPath: '/x/a.md' }));
    expect(s.openDocs).toHaveLength(2);
    expect(s.activeDocIndex).toBe(0);
    expect(s.readerVisible).toBe(true);
  });
});

describe('closeDocAt', () => {
  it('removes a doc and clamps the active index', () => {
    let s = openDoc(emptyDocState(), sampleDoc({ resolvedPath: '/x/a.md' }));
    s = openDoc(s, sampleDoc({ resolvedPath: '/x/b.md' }));
    s = closeDocAt(s, 1);
    expect(s.openDocs).toHaveLength(1);
    expect(s.activeDocIndex).toBe(0);
  });

  it('closing the last doc clears the reader', () => {
    let s = openDoc(emptyDocState(), sampleDoc());
    s = closeDocAt(s, 0);
    expect(s.openDocs).toHaveLength(0);
    expect(s.activeDocIndex).toBeNull();
    expect(s.readerVisible).toBe(false);
  });
});

describe('setReview', () => {
  it('updates the review state of a doc', () => {
    let s = openDoc(emptyDocState(), sampleDoc());
    s = setReview(s, 0, 'approved');
    expect(s.openDocs[0]!.reviewState).toBe('approved');
  });
});

describe('persistence round-trip', () => {
  it('toPersistedDocs strips nothing structural; fromPersistedDocs restores parked', () => {
    let s = openDoc(emptyDocState(), sampleDoc());
    const persisted = toPersistedDocs(s);
    const restored = fromPersistedDocs(persisted.docs, persisted.activeDocIndex);
    expect(restored.openDocs).toEqual(s.openDocs);
    expect(restored.activeDocIndex).toBe(0);
    expect(restored.readerVisible).toBe(false);
  });
});
