// ═══════════════════════════════════════════════════════════════════════
// Awakon — types
// ═══════════════════════════════════════════════════════════════════════

export type Status = 'running' | 'awaiting' | 'limited' | 'idle';
export type BadgeStyle = 'pill' | 'dot' | 'icon';

export interface Session {
  id: string;
  /** 2-3 letter shell label shown in the 22×22 chip (PS, BSH, ZSH, CMD, ...) */
  kind: string;
  /** Display name — user-editable, defaults to binary */
  name: string;
  /** Tildified working directory */
  cwd: string;
  status: Status;
  /** Formatted time-in-state: "10s", "1m 14s", "47m" */
  time?: string;
}

export interface TabSpec {
  label: string;
  status: Status;
}

export interface RecentProject {
  name: string;
  cwd: string;
  /** Human-readable "14m ago", "yesterday" */
  when: string;
}

/** Status visual config — single source of truth for label + glyph. */
export const STATUSES: Record<Status, { label: string; glyph: string }> = {
  running:  { label: 'running',        glyph: '▶' },
  awaiting: { label: 'awaiting input', glyph: '◔' },
  limited:  { label: 'rate-limited',   glyph: '◼' },
  idle:     { label: 'idle',           glyph: '○' },
};

/** Sidebar sort priority — lower = higher up in the list. */
export const STATUS_PRIORITY: Record<Status, number> = {
  awaiting: 0,
  limited:  1,
  running:  2,
  idle:     3,
};

function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]);
}
