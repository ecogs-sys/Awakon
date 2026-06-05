// ═══════════════════════════════════════════════════════════════════════
// Awakon — sample data (mocks)
//
// All fixture data used by demo.html lives here. Real production code
// will populate these shapes from your session store / PTY stream / etc.
// Use this file to:
//   • see what each component expects in its props
//   • copy a starter shape for your real data
//   • run the demo without touching anything else
// ═══════════════════════════════════════════════════════════════════════

import type { Session, TabSpec, RecentProject } from './types.ts';
import type { Line } from './terminal.ts';
import type { MdFile } from './panels.ts';

// ─── Sessions ────────────────────────────────────────────────────────
// One-session state (Main screen)
export const SESSIONS_SOLO: Session[] = [
  { id: 'a', kind: 'PS', name: 'pwsh.exe',
    cwd: '~/Work/ecogs/projects/Awakon', status: 'running', time: '3s' },
];

// Multi-session state (Multi / Split / Settings / Palette / Markdown / NewSession)
// Status mix is intentional — one of each so the sidebar overview cells
// always show non-zero counts.
export const SESSIONS_MULTI: Session[] = [
  { id: 'a', kind: 'PS', name: 'claude · refactor',
    cwd: '~/Work/ecogs/projects/Awakon', status: 'awaiting', time: '1m 14s' },
  { id: 'b', kind: 'PS', name: 'codex · tests',
    cwd: '~/Work/ecogs/projects/Awakon', status: 'limited',  time: '47m' },
  { id: 'c', kind: 'PS', name: 'pwsh.exe',
    cwd: '~/Work/ecogs/projects/Awakon', status: 'running',  time: '10s' },
  { id: 'd', kind: 'PS', name: 'pwsh.exe',
    cwd: '~/Work/ecogs/projects/Awakon', status: 'idle',     time: '4m' },
];

// ─── Tab bar ─────────────────────────────────────────────────────────
export const TABS_SOLO: TabSpec[] = [
  { label: 'pwsh.exe', status: 'running' },
];

export const TABS_MULTI: TabSpec[] = [
  { label: 'claude · refactor', status: 'awaiting' },
  { label: 'codex · tests',     status: 'limited' },
  { label: 'pwsh.exe',          status: 'running' },
  { label: 'pwsh.exe',          status: 'idle' },
];

// ─── Empty state · recents ──────────────────────────────────────────
export const RECENT_PROJECTS: RecentProject[] = [
  { name: 'Awakon · refactor', cwd: '~/Work/ecogs/projects/Awakon', when: '14m ago' },
  { name: 'web-app · billing', cwd: '~/Work/web-app',               when: 'yesterday' },
  { name: 'cli-tools',         cwd: '~/personal/cli-tools',         when: '3 days ago' },
];

// ─── New session dialog · recent CWDs ────────────────────────────────
export const NEW_SESSION_RECENT_DIRS: string[] = [
  '~/Work/ecogs/projects/Awakon',
  '~/Work/web-app',
  '~/personal/cli-tools',
];

// ─── Markdown pane · files referenced by an agent ───────────────────
export const MD_FILES: MdFile[] = [
  { name: 'migration.md',   path: 'docs/migration.md',   active: true,  modified: '2m ago' },
  { name: 'api-changes.md', path: 'docs/api-changes.md',                modified: '2m ago' },
  { name: 'README.md',      path: 'README.md',                          modified: '2m ago' },
];

// ─── Terminal scrollback — sample states ────────────────────────────
// These mirror the four states the design covers. In production these
// come from the live PTY stream; here they're hand-authored to exercise
// every Line variant (prompt, ai, tool, ai-link, cursor, blank, …).

export const TERM_DEFAULT: Line[] = [
  { kind: 'prompt', host: 'PS C:\\Work\\ecogs\\projects\\Awakon>', cmd: 'Get-ChildItem packages', tail: '| Select-Object Name' },
  { kind: 'blank' },
  { kind: 'green', text: 'Name' },
  { kind: 'dim',   text: '----' },
  { kind: 'out',   text: 'contracts' },
  { kind: 'out',   text: 'core' },
  { kind: 'out',   text: 'keymap' },
  { kind: 'out',   text: 'terminal-host' },
  { kind: 'blank' },
  { kind: 'prompt', host: 'PS C:\\Work\\ecogs\\projects\\Awakon>', cmd: 'claude', tail: '--continue' },
  { kind: 'blank' },
  { kind: 'ai', text: '▎ Welcome back. Resuming session #4128.' },
  { kind: 'ai', text: '▎' },
  { kind: 'ai', text: '▎ Last task: refactor terminal-host IPC layer' },
  { kind: 'ai', text: '▎ Files modified: 6 · Tests passing: 24/24' },
  { kind: 'blank' },
  { kind: 'tool', text: '⏵ read packages/terminal-host/src/ipc.ts', meta: '320 lines' },
  { kind: 'tool', text: '⏵ read packages/terminal-host/src/pty.ts', meta: '186 lines' },
  { kind: 'tool', text: '⏵ grep "EventEmitter" in src/',            meta: '4 matches' },
  { kind: 'blank' },
  { kind: 'ai', text: '▎ The IPC layer still routes via a single EventEmitter — I can' },
  { kind: 'ai', text: '▎ swap it for a typed MessagePort bus. Estimated diff: ~140 LOC.' },
  { kind: 'blank' },
  { kind: 'yellow', text: '? Proceed with the refactor?  [y/n/show plan]' },
  { kind: 'cursor', prefix: '› ' },
];

export const TERM_AWAITING: Line[] = [
  { kind: 'prompt', host: 'PS C:\\Work\\ecogs\\projects\\Awakon>', cmd: 'codex' },
  { kind: 'blank' },
  { kind: 'ai', text: '▎ codex-cli v0.4.2' },
  { kind: 'blank' },
  { kind: 'tool', text: '⏵ analyze package structure',   meta: 'done' },
  { kind: 'tool', text: '⏵ generate test scaffolding',   meta: 'pending approval' },
  { kind: 'blank' },
  { kind: 'ai', text: '▎ I want to create 14 new test files across 3 packages.' },
  { kind: 'ai', text: "▎ Files will be added under each package's tests/ directory." },
  { kind: 'blank' },
  { kind: 'yellow', text: '? Approve file creation?' },
  { kind: 'dim',    text: '   [a]pprove all   [r]eject   [d]iff' },
  { kind: 'cursor', prefix: '› ' },
];

export const TERM_LIMITED: Line[] = [
  { kind: 'prompt', host: 'PS C:\\Work>', cmd: 'claude', tail: 'plan' },
  { kind: 'blank' },
  { kind: 'ai', text: '▎ Working on your task...' },
  { kind: 'blank' },
  { kind: 'tool', text: '⏵ read 8 files',         meta: 'done' },
  { kind: 'tool', text: '⏵ draft refactor plan',  meta: 'in progress' },
  { kind: 'blank' },
  { kind: 'red', text: "⚠ You've hit your usage limit." },
  { kind: 'dim', text: '  Quota resets in 47 minutes.' },
  { kind: 'blank' },
  { kind: 'dim', text: '  Awakon will auto-resume when quota refreshes.' },
  { kind: 'dim', text: '  Press [c] to continue manually  ·  [q] to quit' },
  { kind: 'cursor' },
];

export const TERM_WITH_MD_LINKS: Line[] = [
  { kind: 'prompt', host: 'PS C:\\Work\\ecogs\\projects\\Awakon>', cmd: 'claude', tail: 'plan' },
  { kind: 'blank' },
  { kind: 'ai', text: "▎ I've drafted the migration plan and the API change spec." },
  { kind: 'ai', text: '▎ Please review:' },
  { kind: 'ai', text: '▎' },
  { kind: 'ai-link', prefix: '▎   → ', href: 'docs/migration.md',   trailing: '' },
  { kind: 'ai-link', prefix: '▎   → ', href: 'docs/api-changes.md', trailing: ' (proposed)', proposed: true },
  { kind: 'ai-link', prefix: '▎   → ', href: 'README.md',           trailing: ' (updated install steps)' },
  { kind: 'ai', text: '▎' },
  { kind: 'ai', text: '▎ The migration covers all four packages and preserves' },
  { kind: 'ai', text: '▎ wire-compatibility with existing sessions. Estimated diff:' },
  { kind: 'ai', text: '▎ ~340 LOC across 12 files.' },
  { kind: 'blank' },
  { kind: 'yellow', text: '? Approve plan and proceed with implementation?' },
  { kind: 'dim',    text: '   [y]es   [n]o   [d]iff plan   [e]dit plan' },
  { kind: 'cursor', prefix: '› ' },
];
