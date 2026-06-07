import type { SessionStatus, PersistedOpenDoc, ReviewState } from '@awakon/contracts';

export type { ReviewState } from '@awakon/contracts';

/** A markdown doc opened in a tab's reader. */
export interface OpenDoc {
  rawPath: string;
  resolvedPath: string;
  provenanceTitle: string;
  provenanceStatus: SessionStatus;
  reviewState: ReviewState;
}

/** Per-tab reader state. */
export interface TabDocState {
  openDocs: OpenDoc[];
  activeDocIndex: number | null;
  readerVisible: boolean;
}

export function emptyDocState(): TabDocState {
  return { openDocs: [], activeDocIndex: null, readerVisible: false };
}

/** Open (or re-activate) a doc, identified by resolvedPath. Returns a new state. */
export function openDoc(state: TabDocState, doc: OpenDoc): TabDocState {
  const existing = state.openDocs.findIndex((d) => d.resolvedPath === doc.resolvedPath);
  if (existing >= 0) {
    return { ...state, activeDocIndex: existing, readerVisible: true };
  }
  const openDocs = [...state.openDocs, doc];
  return { openDocs, activeDocIndex: openDocs.length - 1, readerVisible: true };
}

/** Close one doc by index. Clears the reader when none remain. */
export function closeDocAt(state: TabDocState, index: number): TabDocState {
  const openDocs = state.openDocs.filter((_, i) => i !== index);
  if (openDocs.length === 0) {
    return { openDocs, activeDocIndex: null, readerVisible: false };
  }
  let activeDocIndex = state.activeDocIndex ?? 0;
  if (index < activeDocIndex) activeDocIndex -= 1;
  else if (index === activeDocIndex) activeDocIndex = Math.min(activeDocIndex, openDocs.length - 1);
  return { ...state, openDocs, activeDocIndex };
}

/** Set a doc's review state. */
export function setReview(state: TabDocState, index: number, review: ReviewState): TabDocState {
  const openDocs = state.openDocs.map((d, i) => (i === index ? { ...d, reviewState: review } : d));
  return { ...state, openDocs };
}

/** Move the active doc by a delta (clamped). */
export function moveActive(state: TabDocState, delta: number): TabDocState {
  if (state.activeDocIndex === null || state.openDocs.length === 0) return state;
  const next = Math.max(0, Math.min(state.openDocs.length - 1, state.activeDocIndex + delta));
  return { ...state, activeDocIndex: next };
}

export function toPersistedDocs(state: TabDocState): {
  docs: PersistedOpenDoc[];
  activeDocIndex: number | null;
} {
  return { docs: state.openDocs.map((d) => ({ ...d })), activeDocIndex: state.activeDocIndex };
}

/** Restore persisted docs as a parked reader (markers visible, panel hidden). */
export function fromPersistedDocs(
  docs: PersistedOpenDoc[],
  activeDocIndex: number | null,
): TabDocState {
  return {
    openDocs: docs.map((d) => ({ ...d })),
    activeDocIndex: docs.length > 0 ? activeDocIndex : null,
    readerVisible: false,
  };
}
