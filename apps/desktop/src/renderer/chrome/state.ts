import type { SessionId, SessionInfo, RecentTab } from '@awakon/contracts';
import type { TabDocState } from './doc-state.js';

export interface SessionState {
  info: SessionInfo;
  attention: boolean;
  /** True when the tab's renderer crashed twice in 60s and stopped auto-recovering. */
  broken: boolean;
  /** Epoch ms when this session entered its current status. */
  statusSinceMs: number;
  /** Epoch ms a pending auto-resume will fire, or null when none is scheduled. */
  resumeAt: number | null;
  /** Per-tab markdown reader state. */
  docState: TabDocState;
}

export interface ChromeState {
  sessions: Map<SessionId, SessionState>;
  tabOrder: SessionId[];
  focusedId: SessionId | null;
  sidebarOpen: boolean;
  recentTabs: RecentTab[];
}

export function emptyState(): ChromeState {
  return {
    sessions: new Map(),
    tabOrder: [],
    focusedId: null,
    sidebarOpen: true,
    recentTabs: [],
  };
}
