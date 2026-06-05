// ═══════════════════════════════════════════════════════════════════════
// Awakon — Modals, palette, empty state, markdown preview
// ═══════════════════════════════════════════════════════════════════════

import { h, setChildren } from './dom.ts';
import type { RecentProject, Status } from './types.ts';
import { appGlyph } from './icons.ts';
import { renderStatusBadge } from './status-badge.ts';
import { kbd } from './platform.ts';

// ─── Scrim wrapper ────────────────────────────────────────────────────
export function renderScrim(child: HTMLElement, onDismiss?: () => void): HTMLElement {
  return h('div', {
    class: 'aip-scrim',
    on: { click: (e) => { if (e.target === e.currentTarget) onDismiss?.(); } },
  }, [child]);
}

// ─── Settings modal · auto-resume ────────────────────────────────────
export interface SettingsModalOptions {
  /** Initial values for the auto-resume rule */
  detectText?: string;
  responseText?: string;
  enabled?: boolean;
  quickAdds?: string[];
  /** Total rule count, shown in footer */
  ruleCount?: number;
  onSave?: () => void;
  onCancel?: () => void;
  onClose?: () => void;
}

export function renderSettingsModal(opts: SettingsModalOptions = {}): HTMLElement {
  const {
    detectText  = "You've hit your limit",
    responseText = 'continue',
    enabled     = true,
    quickAdds   = ["You've hit your limit", 'rate limit reached', 'quota exceeded'],
    ruleCount   = 3,
    onSave, onCancel, onClose,
  } = opts;

  return h('div', { class: 'aip-modal aip-modal--settings' }, [
    h('div', { class: 'aip-modal__header' }, [
      h('div', { class: 'aip-modal__header-left' }, [
        h('span', { class: 'aip-modal__crumb', text: 'Settings' }),
        h('span', { class: 'aip-modal__crumb-dot' }),
        h('span', { class: 'aip-modal__title', text: 'Auto-resume' }),
      ]),
      h('div', { class: 'aip-modal__close', text: '×', on: { click: () => onClose?.() } }),
    ]),

    h('div', { class: 'aip-modal__section' }, [
      h('div', { style: 'display:flex;align-items:flex-start;gap:14px' }, [
        h('div', {
          class: 'aip-toggle' + (enabled ? ' aip-toggle--on' : ''),
          style: 'margin-top:2px',
        }, [h('div', { class: 'aip-toggle__knob' })]),
        h('div', { style: 'flex:1' }, [
          h('div', { style: 'font-size:13.5px;color:var(--text-1);font-weight:500;margin-bottom:3px',
                     text: 'Auto-resume rate-limited tabs' }),
          h('div', { style: 'font-size:12px;color:var(--text-3);line-height:1.5',
                     text: "When an agent hits its quota and you've set a response below, Awakon will send that response automatically once the quota refreshes." }),
        ]),
      ]),
    ]),

    h('div', { class: 'aip-modal__section' }, [
      h('div', { class: 'aip-label', text: 'Text to detect' }),
      h('div', { class: 'aip-input aip-input--focused', text: detectText }),
      h('div', { style: 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap' },
        quickAdds.map((q) => h('span', { class: 'aip-chip', text: q }))),
    ]),

    h('div', { class: 'aip-modal__section' }, [
      h('div', { class: 'aip-label', text: 'Response to send' }),
      h('div', { class: 'aip-input', text: responseText }),
    ]),

    h('div', { class: 'aip-modal__footer' }, [
      h('div', { style: 'font-family:var(--font-mono);font-size:10.5px;color:var(--text-4)',
                 text: `${ruleCount} rules configured` }),
      h('div', { style: 'display:flex;gap:8px' }, [
        h('button', { class: 'aip-btn aip-btn--ghost', text: 'Cancel',
                      on: { click: () => onCancel?.() } }),
        h('button', { class: 'aip-btn aip-btn--primary', text: 'Save',
                      on: { click: () => onSave?.() } }),
      ]),
    ]),
  ]);
}

// ─── About dialog ────────────────────────────────────────────────────
export interface AboutDialogOptions {
  appName?:    string;
  tagline?:    string;
  version?:    string;
  build?:      string;
  commit?:     string;
  branch?:     string;
  electron?:   string;
  chromium?:   string;
  node?:       string;
  v8?:         string;
  os?:         string;
  copyright?:  string;
  license?:    string;
  links?:      Array<{ label: string; href?: string; onClick?: () => void }>;
  onCopyInfo?: () => void;
  onOk?:       () => void;
  onClose?:    () => void;
}

export function renderAboutDialog(opts: AboutDialogOptions = {}): HTMLElement {
  const {
    appName   = 'Awakon',
    tagline   = 'Run many agents · never miss a prompt',
    version   = '1.0.0',
    build     = '2026.05.27',
    commit    = 'a3f91c2',
    branch    = 'main',
    electron  = '33.2.0',
    chromium  = '130.0.6723.44',
    node      = '20.18.0',
    v8        = '13.0.245.16',
    os        = 'Windows 11 · 23H2 (x64)',
    copyright = '© 2026 Awakon contributors',
    license   = 'Released under the MIT License',
    links     = [
      { label: 'Website' },
      { label: 'Release notes' },
      { label: 'Acknowledgements' },
      { label: 'Report an issue' },
    ],
    onCopyInfo, onOk, onClose,
  } = opts;

  const row = (key: string, ...vals: Array<HTMLElement | string>) =>
    h('div', { class: 'aip-about__row' }, [
      h('span', { class: 'aip-about__key', text: key }),
      h('span', { class: 'aip-about__val' }, vals as any),
    ]);

  return h('div', { class: 'aip-modal aip-modal--about' }, [
    // Header
    h('div', { class: 'aip-modal__header' }, [
      h('span', { class: 'aip-modal__crumb', text: 'About' }),
      h('div', { class: 'aip-modal__close', text: '×', on: { click: () => onClose?.() } }),
    ]),

    // Identity row
    h('div', { class: 'aip-about__identity' }, [
      h('div', { class: 'aip-about__icon' }, [appGlyph()]),
      h('div', { class: 'aip-about__id-text' }, [
        h('div', { class: 'aip-about__name', text: appName }),
        h('div', { class: 'aip-about__version' }, [
          `Version ${version} `,
          h('span', { class: 'aip-about__build', text: `(build ${build})` }),
        ] as any),
        h('div', { class: 'aip-about__tagline', text: tagline }),
      ]),
    ]),

    // Detail rows
    h('div', { class: 'aip-about__details' }, [
      row('Commit',   commit, h('span', { class: 'aip-about__dim', text: ` · ${branch}` })),
      row('Electron', electron),
      row('Chromium', chromium),
      row('Node',     node),
      row('V8',       v8),
      row('OS',       os),
    ]),

    // Links
    h('div', { class: 'aip-about__links' },
      links.map((l) => h('a', {
        class: 'aip-about__link',
        text: l.label,
        attrs: l.href ? { href: l.href } : {},
        on:   l.onClick ? { click: () => l.onClick!() } : {},
      }))),

    // Footer
    h('div', { class: 'aip-modal__footer' }, [
      h('div', { class: 'aip-about__legal' }, [
        h('div', { class: 'aip-about__legal-line', text: copyright }),
        h('div', { class: 'aip-about__legal-line', text: license }),
      ]),
      h('div', { style: 'display:flex;gap:8px' }, [
        h('button', { class: 'aip-btn aip-btn--ghost',   text: 'Copy info',
                      on: { click: () => onCopyInfo?.() } }),
        h('button', { class: 'aip-btn aip-btn--primary', text: 'OK',
                      on: { click: () => onOk?.() } }),
      ]),
    ]),
  ]);
}

// ─── Command palette ─────────────────────────────────────────────────
interface PaletteItem {
  kind: string;           // 2-char chip
  name: string;
  meta?: string;
  status?: Status;
  shortcut?: string;
}
interface PaletteSection {
  title: string;
  items: PaletteItem[];
}

export interface CommandPaletteOptions {
  query?: string;
  sections?: PaletteSection[];
  /** Highlighted item — pass [sectionIdx, itemIdx]. Defaults to [0, 0]. */
  activeIndex?: [number, number];
  onClose?: () => void;
}

const DEFAULT_PALETTE: PaletteSection[] = [
  { title: 'Switch to session', items: [
    { kind: 'PS', name: 'claude · refactor terminal-host', meta: '~/Awakon', status: 'awaiting', shortcut: kbd('Mod+1') },
    { kind: 'PS', name: 'codex · add e2e tests',           meta: '~/Awakon', status: 'limited',  shortcut: kbd('Mod+2') },
    { kind: 'PS', name: 'pwsh · package scripts',          meta: '~/Awakon', status: 'running',  shortcut: kbd('Mod+3') },
  ]},
  { title: 'Start session', items: [
    { kind: '+', name: 'New Claude Code session', meta: 'claude', shortcut: kbd('Mod+N') },
    { kind: '+', name: 'New Codex session',       meta: 'codex' },
    { kind: '+', name: 'New PowerShell',          meta: 'pwsh.exe' },
  ]},
  { title: 'Actions', items: [
    { kind: '⌘', name: 'Split pane right',        shortcut: kbd('Mod+D') },
    { kind: '⌘', name: 'Settings…',               shortcut: kbd('Mod+,') },
    { kind: '⌘', name: 'Toggle sidebar',          shortcut: kbd('Mod+B') },
  ]},
];

export function renderCommandPalette({
  query = 'claude',
  sections = DEFAULT_PALETTE,
  activeIndex = [0, 0],
  onClose,
}: CommandPaletteOptions = {}): HTMLElement {
  let totalCount = 0;
  for (const s of sections) totalCount += s.items.length;

  return h('div', { class: 'aip-modal aip-modal--palette' }, [
    h('div', { class: 'aip-palette__search' }, [
      h('span', { class: 'aip-palette__hint', text: '⌘K' }),
      h('div', { class: 'aip-palette__query' }, [
        query,
        h('span', { class: 'aip-cursor-caret' }),
      ]),
      h('span', { class: 'aip-palette__kbd', text: 'esc',
                  on: { click: () => onClose?.() } }),
    ]),

    h('div', { class: 'aip-palette__body' },
      sections.flatMap((sec, si) => [
        h('div', { class: 'aip-palette__section-title', text: sec.title }),
        ...sec.items.map((it, ii) => {
          const active = activeIndex[0] === si && activeIndex[1] === ii;
          return h('div', {
            class: 'aip-palette__item' + (active ? ' aip-palette__item--active' : ''),
          }, [
            h('div', { class: 'aip-palette__item-kind', text: it.kind }),
            h('div', { class: 'aip-palette__item-body' }, [
              h('span', { class: 'aip-palette__item-name', text: it.name }),
              it.meta ? h('span', { class: 'aip-palette__item-meta', text: it.meta }) : null,
            ] as any),
            it.status ? renderStatusBadge({ status: it.status, style: 'pill' }) : null,
            it.shortcut ? h('span', { class: 'aip-palette__kbd', text: it.shortcut }) : null,
          ] as any);
        }),
      ])),

      h('div', { class: 'aip-palette__footer' }, [
      h('div', { class: 'aip-palette__footer-hints' }, [
        h('span', {}, [h('span', { text: '↑↓' }), ' navigate']),
        h('span', {}, [h('span', { text: '↵'  }), ' open']),
        h('span', {}, [h('span', { text: '⇥'  }), ' filter']),
      ]),
      h('span', { text: `${totalCount} results` }),
    ]),
  ]);
}

// ─── Empty state ─────────────────────────────────────────────────────

// ─── New session dialog ─────────────────────────────────────────────
//
// Opened when the user clicks "+" in the tab bar / sidebar header, or
// hits Mod+N. Pre-fills with the active session's cwd if one exists.
// First field auto-focuses; Enter triggers Start (when valid); Esc cancels.

export type SessionType = 'claude' | 'codex' | 'shell';
export type ShellKind   = 'pwsh' | 'cmd' | 'bash' | 'zsh' | 'git-bash';
export type OpenIn      = 'tab' | 'split-right' | 'split-below';

export interface NewSessionState {
  type: SessionType;
  cwd: string;
  shell: ShellKind;
  initialPrompt: string;
  openIn: OpenIn;
  name?: string;
}

export interface NewSessionDialogOptions {
  /** Initial form values. */
  initial?: Partial<NewSessionState>;
  /** Recent working directories (shown as chips below the path input). */
  recentDirs?: string[];
  /** Shells available on this platform — gated by OS detection. */
  availableShells?: ShellKind[];
  onStart?:  (state: NewSessionState) => void;
  onCancel?: () => void;
  onClose?:  () => void;
}

interface SessionTypeMeta {
  id: SessionType; chip: string; title: string; desc: string; recommended?: boolean;
}

const SESSION_TYPES: SessionTypeMeta[] = [
  { id: 'claude', chip: 'CC',  title: 'Claude Code', desc: 'Anthropic\u2019s AI pair programmer', recommended: true },
  { id: 'codex',  chip: 'CX',  title: 'Codex CLI',   desc: 'OpenAI coding assistant' },
  { id: 'shell',  chip: 'PS',  title: 'Shell only',  desc: 'pwsh / bash / cmd' },
];

const SHELL_LABELS: Record<ShellKind, string> = {
  'pwsh':     'pwsh.exe',
  'cmd':      'cmd.exe',
  'bash':     'bash',
  'zsh':      'zsh',
  'git-bash': 'git-bash',
};

const OPEN_IN_OPTIONS: Array<{ id: OpenIn; label: string }> = [
  { id: 'tab',          label: 'New tab' },
  { id: 'split-right',  label: 'Split right' },
  { id: 'split-below',  label: 'Split below' },
];

export function renderNewSessionDialog(opts: NewSessionDialogOptions = {}): HTMLElement {
  const {
    initial = {},
    recentDirs = ['~/Work/ecogs/projects/Awakon', '~/Work/web-app', '~/personal/cli-tools'],
    availableShells = ['pwsh', 'cmd', 'git-bash'],
    onStart, onCancel, onClose,
  } = opts;

  // Mutable local state. In production this hooks into your store; here we
  // just re-render relevant sections on change.
  const state: NewSessionState = {
    type:          initial.type          ?? 'claude',
    cwd:           initial.cwd           ?? recentDirs[0] ?? '~',
    shell:         initial.shell         ?? availableShells[0],
    initialPrompt: initial.initialPrompt ?? '',
    openIn:        initial.openIn        ?? 'tab',
    name:          initial.name,
  };

  // ─── Section renderers (each rebuilds its own subtree on change) ──

  const typePicker = h('div', { class: 'aip-segmented' });
  function renderTypeSection(): void {
    setChildren(typePicker, SESSION_TYPES.map((t) => {
      const active = state.type === t.id;
      return h('div', {
        class: 'aip-seg' + (active ? ' aip-seg--active' : ''),
        on: { click: () => { state.type = t.id; renderTypeSection(); promptVisibility(); } },
      }, [
        h('div', { class: 'aip-seg__head' }, [
          h('span', { class: 'aip-seg__glyph', text: t.chip }),
          h('span', { class: 'aip-seg__title', text: t.title }),
          t.recommended ? h('span', { class: 'aip-seg__recommended', text: 'Recommended' }) : null,
        ] as any),
        h('div', { class: 'aip-seg__desc', text: t.desc }),
      ]);
    }));
  }
  renderTypeSection();

  // Working directory (path + Browse + recents)
  const cwdField = h('div', { class: 'aip-path-input__field' });
  function renderCwd(): void {
    const idx = state.cwd.lastIndexOf('/');
    const head = idx >= 0 ? state.cwd.slice(0, idx + 1) : '';
    const tail = idx >= 0 ? state.cwd.slice(idx + 1)    : state.cwd;
    setChildren(cwdField, [
      head ? h('span', { class: 'dim', text: head }) : null,
      tail || '~',
    ] as any);
  }
  renderCwd();

  const recentsRow = h('div', { class: 'aip-recents-row' });
  function renderRecents(): void {
    setChildren(recentsRow, recentDirs.map((d) => h('span', {
      class: 'aip-chip',
      text: d,
      on: { click: () => { state.cwd = d; renderCwd(); } },
    })));
  }
  renderRecents();

  // Shell radio row
  const shellRow = h('div', { class: 'aip-radio-row' });
  function renderShellRow(): void {
    setChildren(shellRow, availableShells.map((sh) => {
      const active = state.shell === sh;
      return h('div', {
        class: 'aip-radio' + (active ? ' aip-radio--active' : ''),
        on: { click: () => { state.shell = sh; renderShellRow(); } },
      }, [
        h('span', { class: 'aip-radio__dot' }),
        h('span', { text: SHELL_LABELS[sh] }),
      ]);
    }));
  }
  renderShellRow();

  // Initial prompt textarea (only shown for AI agent types)
  const promptSection = h('div', { class: 'aip-modal__section' });
  function promptVisibility(): void {
    const visible = state.type === 'claude' || state.type === 'codex';
    promptSection.style.display = visible ? '' : 'none';
  }
  setChildren(promptSection, [
    h('div', { class: 'aip-section-header' }, [
      h('div', { class: 'aip-label', text: 'Initial prompt' }),
      h('span', { class: 'aip-section-header__aside', text: 'optional · sent on start' }),
    ]),
    h('div', { class: 'aip-textarea aip-input--focused' }, [
      h('span', { class: 'aip-textarea__placeholder',
                   text: 'e.g. refactor the IPC layer in terminal-host to use MessagePort' }),
    ]),
  ]);
  promptVisibility();

  // Open-in radio row
  const openInRow = h('div', { class: 'aip-radio-row' });
  function renderOpenInRow(): void {
    setChildren(openInRow, OPEN_IN_OPTIONS.map((opt) => {
      const active = state.openIn === opt.id;
      return h('div', {
        class: 'aip-radio' + (active ? ' aip-radio--active' : ''),
        on: { click: () => { state.openIn = opt.id; renderOpenInRow(); } },
      }, [
        h('span', { class: 'aip-radio__dot' }),
        h('span', { text: opt.label }),
      ]);
    }));
  }
  renderOpenInRow();

  // ─── Assemble ─────────────────────────────────────────────────────
  const body = h('div', { class: 'aip-modal__body' }, [

    // Type
    h('div', { class: 'aip-modal__section' }, [
      h('div', { class: 'aip-label', text: 'Type' }),
      typePicker,
    ]),

    // Working directory
    h('div', { class: 'aip-modal__section' }, [
      h('div', { class: 'aip-label', text: 'Working directory' }),
      h('div', { class: 'aip-path-input' }, [
        cwdField,
        h('div', { class: 'aip-path-input__browse' }, [
          h('span', { text: '🗁' }),
          h('span', { text: 'Browse\u2026' }),
        ]),
      ]),
      recentsRow,
    ]),

    // Shell
    h('div', { class: 'aip-modal__section' }, [
      h('div', { class: 'aip-label', text: 'Shell' }),
      shellRow,
    ]),

    // Initial prompt (conditionally visible)
    promptSection,

    // Open in
    h('div', { class: 'aip-modal__section' }, [
      h('div', { class: 'aip-label', text: 'Open in' }),
      openInRow,
    ]),
  ]);

  return h('div', { class: 'aip-modal aip-modal--newsession' }, [

    // Header
    h('div', { class: 'aip-modal__header' }, [
      h('div', { class: 'aip-modal__header-left' }, [
        h('span', { class: 'aip-modal__crumb', text: 'New session' }),
        h('span', { class: 'aip-modal__crumb-dot' }),
        h('span', { class: 'aip-modal__title', text: 'Configure' }),
      ]),
      h('div', { class: 'aip-modal__close', text: '×', on: { click: () => onClose?.() } }),
    ]),

    body,

    // Footer
    h('div', { class: 'aip-modal__footer' }, [
      h('div', { style: 'font-family:var(--font-mono);font-size:10.5px;color:var(--text-4)',
                 text: 'Press Enter to start  ·  Esc to cancel' }),
      h('div', { style: 'display:flex;gap:8px' }, [
        h('button', { class: 'aip-btn aip-btn--ghost',   text: 'Cancel',
                      on: { click: () => onCancel?.() } }),
        h('button', { class: 'aip-btn aip-btn--primary', text: 'Start session',
                      on: { click: () => onStart?.(state) } }),
      ]),
    ]),
  ]);
}

// ─── Empty state ─────────────────────────────────────────────────────
export interface EmptyStateOptions {
  recents?: RecentProject[];
  onNew?: () => void;
  onResume?: () => void;
  onPickRecent?: (r: RecentProject) => void;
}

const DEFAULT_RECENTS: RecentProject[] = [
  { name: 'Awakon · refactor', cwd: '~/Work/ecogs/projects/Awakon', when: '14m ago' },
  { name: 'web-app · billing', cwd: '~/Work/web-app',               when: 'yesterday' },
  { name: 'cli-tools',         cwd: '~/personal/cli-tools',         when: '3 days ago' },
];

export function renderEmptyState({
  recents = DEFAULT_RECENTS, onNew, onResume, onPickRecent,
}: EmptyStateOptions = {}): HTMLElement {
  const card = (cfg: {
    primary?: boolean; title: string; meta: string; kbd: string; onClick?: () => void;
  }) => h('div', {
    class: 'aip-empty__card' + (cfg.primary ? ' aip-empty__card--primary' : ''),
    on: { click: () => cfg.onClick?.() },
  }, [
    h('div', { class: 'aip-empty__card-title', text: cfg.title }),
    h('div', { class: 'aip-empty__card-meta',  text: cfg.meta }),
    h('div', { class: 'aip-empty__card-foot' }, [
      h('span', { class: 'aip-empty__card-kbd',   text: cfg.kbd }),
      h('span', { class: 'aip-empty__card-arrow', text: '→' }),
    ]),
  ]);

  return h('div', { class: 'aip-empty' }, [
    h('div', { class: 'aip-empty__inner' }, [
      h('div', { class: 'aip-empty__brand' }, [
        h('div', { class: 'aip-empty__brand-icon' }, [appGlyph()]),
        h('div', {}, [
          h('div', { class: 'aip-empty__brand-title', text: 'Awakon' }),
          h('div', { class: 'aip-empty__brand-sub',   text: 'run many agents · never miss a prompt' }),
        ]),
      ]),
      h('div', { class: 'aip-empty__cards' }, [
        card({ primary: true, title: 'New session', meta: 'claude · codex · pwsh', kbd: kbd('Mod+N'), onClick: onNew }),
        card({                title: 'Resume',      meta: '3 sessions from last time', kbd: kbd('Mod+R'), onClick: onResume }),
      ]),
      h('div', { class: 'aip-empty__recents' }, [
        h('div', { class: 'aip-empty__recents-title', text: 'Recent' }),
        ...recents.map((r) => h('div', {
          class: 'aip-empty__recent',
          on: { click: () => onPickRecent?.(r) },
        }, [
          h('span', { class: 'aip-empty__recent-chip', text: 'PS' }),
          h('span', { class: 'aip-empty__recent-name', text: r.name }),
          h('span', { class: 'aip-empty__recent-cwd',  text: r.cwd }),
          h('span', { class: 'aip-empty__recent-when', text: r.when }),
        ])),
      ]),
    ]),
  ]);
}

// ─── Markdown preview pane (sliding right) ───────────────────────────
export interface MdFile {
  name: string;
  path: string;
  active?: boolean;
  modified?: string;
}

export interface MdPaneOptions {
  files: MdFile[];
  activePath: string;
  modifiedAgo?: string;
  loc?: number;
  sizeKb?: number;
  /** Slot for the rendered markdown body — call your MD renderer and pass the result. */
  body?: HTMLElement;
  onClose?: () => void;
  onPickFile?: (path: string) => void;
}

export function renderMdPane({
  files, activePath, modifiedAgo = '2m ago', loc = 342, sizeKb = 6,
  body, onClose, onPickFile,
}: MdPaneOptions): HTMLElement {
  return h('div', { class: 'aip-mdpane' }, [
    // Mini tab strip
    h('div', { class: 'aip-mdpane__tabs' }, [
      ...files.map((f) => {
        const active = f.path === activePath;
        return h('div', {
          class: 'aip-mdpane__tab' + (active ? ' aip-mdpane__tab--active' : ''),
          on: { click: () => onPickFile?.(f.path) },
        }, [
          h('span', { class: 'aip-mdpane__tab-icon', text: 'M↓' }),
          h('span', { class: 'aip-mdpane__tab-name', text: f.name }),
          h('span', { class: 'aip-mdpane__tab-close', text: '×' }),
        ]);
      }),
      h('div', { class: 'aip-mdpane__tabs-spacer' }),
      h('div', {
        class: 'aip-mdpane__close-all',
        text: '×',
        attrs: { title: 'Close pane' },
        on: { click: () => onClose?.() },
      }),
    ]),

    // Path bar + actions
    h('div', { class: 'aip-mdpane__pathbar' }, [
      h('span', { class: 'aip-mdpane__path' }, [
        h('span', { class: 'aip-mdpane__path-dir', text: '~/Awakon/' }),
        activePath,
      ]),
      h('span', { class: 'aip-mdpane__path-meta', text: `modified ${modifiedAgo}` }),
      h('div', { style: 'display:flex;gap:4px' }, [
        h('span', { class: 'aip-mdpane__action', text: '↗', attrs: { title: 'Open in editor' } }),
        h('span', { class: 'aip-mdpane__action', text: '⎘', attrs: { title: 'Copy path' } }),
      ]),
    ]),

    // Body (caller provides the rendered markdown)
    h('div', { class: 'aip-mdpane__body' }, body ? [body] : [renderSampleMdBody()]),

    // Footer
    h('div', { class: 'aip-mdpane__footer' }, [
      h('div', { class: 'aip-mdpane__footer-hints' }, [
        h('span', {}, [h('span', { text: 'esc'         }), ' close']),
        h('span', {}, [h('span', { text: kbd('Mod+[')  }), ' prev file']),
        h('span', {}, [h('span', { text: kbd('Mod+]')  }), ' next file']),
      ]),
      h('span', { text: `${loc} LOC · ${sizeKb} KB` }),
    ]),
  ]);
}

/** Sample markdown body — production code would feed a real parsed AST in. */
function renderSampleMdBody(): HTMLElement {
  return h('div', {}, [
    h('h1', { text: 'Migration plan: terminal-host' }),
    h('p', {}, [
      'Move the per-session IPC from a single ',
      h('code', { text: 'EventEmitter' }),
      ' to a typed ',
      h('code', { text: 'MessagePort' }),
      ' bus. The change is wire-compatible with existing sessions.',
    ]),
    h('h2', { text: 'Why' }),
    h('ul', {}, [
      h('li', { text: 'Stronger types at the transport boundary' }),
      h('li', { text: 'Backpressure-aware by default' }),
      h('li', { text: 'Survives renderer reload via transferable ports' }),
    ]),
    h('h2', { text: 'Steps' }),
    h('ol', {}, [
      h('li', {}, ['Add ', h('code', { text: 'MessagePortHost' }), ' in ',
                    h('code', { text: 'terminal-host/src/transport/' })]),
      h('li', { text: 'Wrap existing handlers with a compatibility adapter' }),
      h('li', { text: 'Migrate one channel at a time, behind a feature flag' }),
      h('li', { text: 'Remove the legacy emitter and adapter' }),
    ]),
    h('pre', { text:
`class MessagePortHost {
  constructor(public port: MessagePort) {
    port.onmessage = (e) => this.dispatch(e.data);
  }
  send<T>(channel: string, payload: T) {
    this.port.postMessage({ channel, payload });
  }
}` }),
  ]);
}
