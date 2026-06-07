// ═══════════════════════════════════════════════════════════════════════════
// AI.Pad — Terminal panes, modals, full screens
// ═══════════════════════════════════════════════════════════════════════════

// ─── Terminal line renderer ───────────────────────────────────────────────
// Tokens accepted in a `lines` array:
//   ['prompt', 'PS C:\\Work>', 'Get-ChildItem packages']    → colored prompt
//   ['out', 'plain text']
//   ['dim', 'muted text']
//   ['green'|'cyan'|'yellow'|'blue'|'magenta'|'red', 'colored text']
//   ['ai', '▎ Welcome to claude-code v3.1']                  → AI block
//   ['tool', '⏵ scan packages/terminal-host', 'read 14 files']
//   ['blank']
//   ['cursor']                                               → blinking cursor

function TermLine({ line }) {
  const mono = { fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.6, whiteSpace: 'pre' };
  const [kind, ...rest] = line;
  switch (kind) {
    case 'prompt':
      return <div style={mono}><span style={{ color: 'var(--term-blue)' }}>{rest[0]}</span>{rest[1] ? <> <span style={{ color: 'var(--term-yellow)' }}>{rest[1]}</span></> : null}{rest[2] ? <> <span style={{ color: 'var(--term-fg)' }}>{rest[2]}</span></> : null}</div>;
    case 'out':     return <div style={{ ...mono, color: 'var(--term-fg)'    }}>{rest[0]}</div>;
    case 'dim':     return <div style={{ ...mono, color: 'var(--term-dim)'   }}>{rest[0]}</div>;
    case 'green':   return <div style={{ ...mono, color: 'var(--term-green)' }}>{rest[0]}</div>;
    case 'cyan':    return <div style={{ ...mono, color: 'var(--term-cyan)'  }}>{rest[0]}</div>;
    case 'yellow':  return <div style={{ ...mono, color: 'var(--term-yellow)' }}>{rest[0]}</div>;
    case 'blue':    return <div style={{ ...mono, color: 'var(--term-blue)'  }}>{rest[0]}</div>;
    case 'magenta': return <div style={{ ...mono, color: 'var(--term-magenta)' }}>{rest[0]}</div>;
    case 'red':     return <div style={{ ...mono, color: 'var(--term-red)'   }}>{rest[0]}</div>;
    case 'ai':      return <div style={{ ...mono, color: 'var(--term-fg)', borderLeft: '2px solid var(--term-magenta)', paddingLeft: 12, marginLeft: -14 }}>{rest[0]}</div>;
    case 'tool':    return <div style={{ ...mono, color: 'var(--term-cyan)' }}>{rest[0]}{rest[1] && <span style={{ color: 'var(--term-dim)' }}>{'  '}{rest[1]}</span>}</div>;
    case 'blank':   return <div style={{ ...mono, height: '1.6em' }}>&nbsp;</div>;
    case 'cursor':  return <div style={mono}><span style={{ color: 'var(--term-fg)' }}>{rest[0] || ''}</span><span className="aip-cursor" style={{ display: 'inline-block', width: 8, height: '1em', background: 'var(--term-fg)', verticalAlign: 'middle', marginLeft: 2 }} /></div>;
    case 'ai-link': {
      // ['ai-link', '▎   → ', 'docs/migration.md', ' (proposed)']
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7CA8E0';
      return (
        <div style={{ ...mono, color: 'var(--term-fg)', borderLeft: '2px solid var(--term-magenta)', paddingLeft: 12, marginLeft: -14 }}>
          <span>{rest[0]}</span>
          <span style={{ color: accent, textDecoration: 'underline', textDecorationColor: accent + '66', textUnderlineOffset: 3, cursor: 'pointer' }}>{rest[1]}</span>
          {rest[2] && <span style={{ color: 'var(--term-dim)' }}>{rest[2]}</span>}
        </div>
      );
    }
    default:        return <div style={mono}>{rest[0]}</div>;
  }
}

function TerminalPane({ lines, accent, scrollbar = true, padding = 18 }) {
  return (
    <div style={{ flex: 1, background: 'var(--term-bg)', position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ flex: 1, padding, paddingRight: padding + 4, overflow: 'hidden' }}>
        {lines.map((l, i) => <TermLine key={i} line={l} />)}
      </div>
      {scrollbar && (
        <div style={{ position: 'absolute', top: 8, right: 4, bottom: 8, width: 6, borderRadius: 3 }}>
          <div style={{ position: 'absolute', top: 0, right: 0, width: 4, height: '38%', background: 'var(--bg-4)', borderRadius: 2 }} />
        </div>
      )}
    </div>
  );
}

// ─── Sample terminal content ──────────────────────────────────────────────
const TERM_DEFAULT = [
  ['prompt', 'PS C:\\Work\\ecogs\\projects\\AI.Pad>', 'Get-ChildItem packages', '| Select-Object Name'],
  ['blank'],
  ['green', 'Name'],
  ['dim',   '----'],
  ['out',   'contracts'],
  ['out',   'core'],
  ['out',   'keymap'],
  ['out',   'terminal-host'],
  ['blank'],
  ['prompt', 'PS C:\\Work\\ecogs\\projects\\AI.Pad>', 'claude', '--continue'],
  ['blank'],
  ['ai', '▎ Welcome back. Resuming session #4128.'],
  ['ai', '▎'],
  ['ai', '▎ Last task: refactor terminal-host IPC layer'],
  ['ai', '▎ Files modified: 6 · Tests passing: 24/24'],
  ['blank'],
  ['tool', '⏵ read packages/terminal-host/src/ipc.ts',  '320 lines'],
  ['tool', '⏵ read packages/terminal-host/src/pty.ts',  '186 lines'],
  ['tool', '⏵ grep "EventEmitter" in src/',             '4 matches'],
  ['blank'],
  ['ai', '▎ The IPC layer still routes via a single EventEmitter — I can'],
  ['ai', '▎ swap it for a typed MessagePort bus. Estimated diff: ~140 LOC.'],
  ['blank'],
  ['yellow', '? Proceed with the refactor?  [y/n/show plan]'],
  ['cursor', '› '],
];

const TERM_AWAITING = [
  ['prompt', 'PS C:\\Work\\ecogs\\projects\\AI.Pad>', 'codex'],
  ['blank'],
  ['ai', '▎ codex-cli v0.4.2'],
  ['blank'],
  ['tool', '⏵ analyze package structure', 'done'],
  ['tool', '⏵ generate test scaffolding', 'pending approval'],
  ['blank'],
  ['ai', '▎ I want to create 14 new test files across 3 packages.'],
  ['ai', '▎ Files will be added under each package\'s tests/ directory.'],
  ['blank'],
  ['yellow', '? Approve file creation?'],
  ['dim',    '   [a]pprove all   [r]eject   [d]iff'],
  ['cursor', '› '],
];

const TERM_LIMITED = [
  ['prompt', 'PS C:\\Work>', 'claude', 'plan'],
  ['blank'],
  ['ai', '▎ Working on your task...'],
  ['blank'],
  ['tool', '⏵ read 8 files', 'done'],
  ['tool', '⏵ draft refactor plan', 'in progress'],
  ['blank'],
  ['red', '⚠ You\'ve hit your usage limit.'],
  ['dim', '  Quota resets in 47 minutes.'],
  ['blank'],
  ['dim', '  AI.Pad will auto-resume when quota refreshes.'],
  ['dim', '  Press [c] to continue manually  ·  [q] to quit'],
  ['cursor', ''],
];

// ─── Modal scrim ──────────────────────────────────────────────────────────
function ModalScrim({ children }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-overlay)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 120, zIndex: 10 }}>
      {children}
    </div>
  );
}

// ─── Settings modal ───────────────────────────────────────────────────────
function SettingsModal({ accent }) {
  const section = { padding: '18px 22px', borderBottom: '1px solid var(--border-1)' };
  const label = { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 };
  const input = { width: '100%', background: 'var(--bg-0)', border: '1px solid var(--border-2)', borderRadius: 6, padding: '9px 12px', fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--text-1)', outline: 'none' };

  return (
    <div style={{ width: 560, background: 'var(--bg-2)', border: '1px solid var(--border-2)', borderRadius: 10, boxShadow: '0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)', overflow: 'hidden' }}>
      <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--border-1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: 1.4 }}>Settings</span>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--text-4)' }} />
          <span style={{ fontSize: 13, color: 'var(--text-1)' }}>Auto-resume</span>
        </div>
        <div style={{ width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 14 }}>×</div>
      </div>

      <div style={section}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{ width: 36, height: 20, borderRadius: 999, background: accent, position: 'relative', flexShrink: 0, marginTop: 2 }}>
            <div style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%', background: '#fff' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, color: 'var(--text-1)', fontWeight: 500, marginBottom: 3 }}>Auto-resume rate-limited tabs</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>When an agent hits its quota and you've set a response below, AI.Pad will send that response automatically once the quota refreshes.</div>
          </div>
        </div>
      </div>

      <div style={section}>
        <div style={label}>Text to detect</div>
        <div style={{ ...input, border: `1px solid ${accent}`, boxShadow: `0 0 0 3px var(--accent-soft)` }}>
          You've hit your limit
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {['You\'ve hit your limit', 'rate limit reached', 'quota exceeded'].map((p, i) => (
            <span key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-3)', background: 'var(--bg-1)', padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border-1)' }}>{p}</span>
          ))}
        </div>
      </div>

      <div style={section}>
        <div style={label}>Response to send</div>
        <div style={input}>continue</div>
      </div>

      <div style={{ padding: '14px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-4)' }}>3 rules configured</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ background: 'transparent', color: 'var(--text-2)', border: '1px solid var(--border-2)', borderRadius: 6, padding: '7px 14px', fontFamily: 'var(--font-sans)', fontSize: 12.5, cursor: 'pointer' }}>Cancel</button>
          <button style={{ background: accent, color: '#0d1117', border: 'none', borderRadius: 6, padding: '7px 16px', fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ─── About dialog ─────────────────────────────────────────────────────────
function AboutModal({ accent }) {
  const row = { display: 'flex', alignItems: 'baseline', gap: 10, padding: '4px 0' };
  const k   = { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: 0.8, minWidth: 78 };
  const v   = { fontFamily: 'var(--font-mono)', fontSize: 12,   color: 'var(--text-2)' };

  return (
    <div style={{ width: 440, background: 'var(--bg-2)', border: '1px solid var(--border-2)', borderRadius: 10, boxShadow: '0 24px 64px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04)', overflow: 'hidden' }}>
      {/* header bar */}
      <div style={{ padding: '10px 14px 10px 16px', borderBottom: '1px solid var(--border-1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: 1.4 }}>About</span>
        <div style={{ width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 14 }}>×</div>
      </div>

      {/* identity */}
      <div style={{ padding: '26px 24px 18px', display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{ width: 64, height: 64, flexShrink: 0, borderRadius: 14, boxShadow: '0 8px 22px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04)' }}>
          <AppGlyph accent={accent} size={64} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-1)', letterSpacing: -0.3 }}>AI.Pad</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>Version 1.0.0 <span style={{ color: 'var(--text-4)' }}>(build 2026.05.27)</span></div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Run many agents · never miss a prompt</div>
        </div>
      </div>

      {/* details */}
      <div style={{ padding: '4px 24px 16px' }}>
        <div style={row}><span style={k}>Commit</span>   <span style={v}>a3f91c2</span> <span style={{ ...v, color: 'var(--text-4)' }}>· main</span></div>
        <div style={row}><span style={k}>Electron</span> <span style={v}>33.2.0</span></div>
        <div style={row}><span style={k}>Chromium</span> <span style={v}>130.0.6723.44</span></div>
        <div style={row}><span style={k}>Node</span>     <span style={v}>20.18.0</span></div>
        <div style={row}><span style={k}>V8</span>       <span style={v}>13.0.245.16</span></div>
        <div style={row}><span style={k}>OS</span>       <span style={v}>Windows 11 · 23H2 (x64)</span></div>
      </div>

      {/* links */}
      <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border-1)', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        {['Website', 'Release notes', 'Acknowledgements', 'Report an issue'].map((l) => (
          <span key={l} style={{ fontSize: 12, color: accent, textDecoration: 'underline', textDecorationColor: accent + '66', textUnderlineOffset: 3, cursor: 'pointer' }}>{l}</span>
        ))}
      </div>

      {/* footer */}
      <div style={{ padding: '12px 22px 14px', borderTop: '1px solid var(--border-1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-4)' }}>© 2026 AI.Pad contributors</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-4)' }}>Released under the MIT License</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ background: 'transparent', color: 'var(--text-2)', border: '1px solid var(--border-2)', borderRadius: 6, padding: '7px 14px', fontFamily: 'var(--font-sans)', fontSize: 12.5, cursor: 'pointer' }}>Copy info</button>
          <button style={{ background: accent, color: '#0d1117', border: 'none', borderRadius: 6, padding: '7px 16px', fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ─── Command palette ──────────────────────────────────────────────────────
function CommandPalette({ accent }) {
  const sections = [
    {
      title: 'Switch to session',
      items: [
        { kind: 'PS', name: 'claude · refactor terminal-host', meta: '~/AI.Pad', status: 'awaiting', shortcut: '⌘1' },
        { kind: 'PS', name: 'codex · add e2e tests',           meta: '~/AI.Pad', status: 'limited',  shortcut: '⌘2' },
        { kind: 'PS', name: 'pwsh · package scripts',          meta: '~/AI.Pad', status: 'running',  shortcut: '⌘3' },
      ],
    },
    {
      title: 'Start session',
      items: [
        { kind: '+', name: 'New Claude Code session', meta: 'claude', shortcut: '⌘N' },
        { kind: '+', name: 'New Codex session',       meta: 'codex' },
        { kind: '+', name: 'New PowerShell',          meta: 'pwsh.exe' },
      ],
    },
    {
      title: 'Actions',
      items: [
        { kind: '⌘', name: 'Split pane right',        shortcut: '⌘D' },
        { kind: '⌘', name: 'Settings…',               shortcut: '⌘,' },
        { kind: '⌘', name: 'Toggle sidebar',          shortcut: '⌘B' },
      ],
    },
  ];

  return (
    <div style={{ width: 620, maxHeight: 520, background: 'var(--bg-2)', border: '1px solid var(--border-2)', borderRadius: 12, boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-1)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ color: 'var(--text-4)', fontSize: 13 }}>⌘K</span>
        <div style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--text-1)' }}>
          claude<span className="aip-cursor" style={{ display: 'inline-block', width: 7, height: 14, background: accent, verticalAlign: '-2px', marginLeft: 2 }} />
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-4)', background: 'var(--bg-1)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border-1)' }}>esc</span>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', padding: '6px 0' }}>
        {sections.map((sec, si) => (
          <div key={si}>
            <div style={{ padding: '10px 18px 6px', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--text-4)', fontWeight: 600 }}>{sec.title}</div>
            {sec.items.map((it, ii) => {
              const active = si === 0 && ii === 0;
              return (
                <div key={ii} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 18px', background: active ? 'var(--bg-3)' : 'transparent', borderLeft: active ? `2px solid ${accent}` : '2px solid transparent' }}>
                  <div style={{ width: 22, height: 22, borderRadius: 5, background: 'var(--bg-1)', border: '1px solid var(--border-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-2)', fontWeight: 600 }}>{it.kind}</div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: 13, color: active ? 'var(--text-1)' : 'var(--text-2)' }}>{it.name}</span>
                    {it.meta && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-4)' }}>{it.meta}</span>}
                  </div>
                  {it.status && <StatusBadge status={it.status} style="pill" />}
                  {it.shortcut && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-4)', background: 'var(--bg-1)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border-1)' }}>{it.shortcut}</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div style={{ borderTop: '1px solid var(--border-1)', padding: '8px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-4)' }}>
        <div style={{ display: 'flex', gap: 14 }}>
          <span><span style={{ color: 'var(--text-3)' }}>↑↓</span> navigate</span>
          <span><span style={{ color: 'var(--text-3)' }}>↵</span> open</span>
          <span><span style={{ color: 'var(--text-3)' }}>⇥</span> filter</span>
        </div>
        <span>9 results</span>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────
function EmptyState({ accent }) {
  const card = (label, mono, kbd, primary) => (
    <div style={{
      flex: 1,
      background: primary ? 'var(--bg-2)' : 'var(--bg-1)',
      border: primary ? `1px solid ${accent}` : '1px solid var(--border-1)',
      borderRadius: 10,
      padding: '20px 22px',
      display: 'flex', flexDirection: 'column', gap: 10,
      position: 'relative',
      boxShadow: primary ? `0 0 0 3px var(--accent-soft)` : 'none',
    }}>
      <div style={{ fontSize: 14, color: 'var(--text-1)', fontWeight: 500 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: primary ? accent : 'var(--text-3)' }}>{mono}</div>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-4)' }}>{kbd}</span>
        <span style={{ color: primary ? accent : 'var(--text-4)', fontSize: 14 }}>→</span>
      </div>
    </div>
  );
  return (
    <div style={{ flex: 1, background: 'var(--bg-0)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div style={{ width: 540, maxWidth: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
          <div style={{ width: 64, height: 64 }}><AppGlyph accent={accent} size={64} /></div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-1)', letterSpacing: -0.3 }}>AI.Pad</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>run many agents · never miss a prompt</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
          {card('New session',     'claude · codex · pwsh',  '⌘N',  true)}
          {card('Resume',          '3 sessions from last time', '⌘R')}
        </div>
        <div style={{ borderTop: '1px solid var(--border-1)', paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: 1.2, color: 'var(--text-4)', textTransform: 'uppercase', fontWeight: 600 }}>Recent</div>
          {[
            { name: 'AI.Pad · refactor', cwd: '~/Work/ecogs/projects/AI.Pad', when: '14m ago' },
            { name: 'web-app · billing', cwd: '~/Work/web-app',               when: 'yesterday' },
            { name: 'cli-tools',         cwd: '~/personal/cli-tools',         when: '3 days ago' },
          ].map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0' }}>
              <span style={{ width: 18, height: 18, borderRadius: 4, background: 'var(--bg-2)', border: '1px solid var(--border-2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)' }}>PS</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--text-2)' }}>{r.name}</span>
              <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-4)' }}>{r.cwd}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-4)' }}>{r.when}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Terminal content with file references (links) ───────────────────────
const TERM_WITH_MD_LINKS = [
  ['prompt', 'PS C:\\Work\\ecogs\\projects\\AI.Pad>', 'claude', 'plan'],
  ['blank'],
  ['ai', '▎ I\'ve drafted the migration plan and the API change spec.'],
  ['ai', '▎ Please review:'],
  ['ai', '▎'],
  ['ai-link', '▎   → ', 'docs/migration.md',  ''],
  ['ai-link', '▎   → ', 'docs/api-changes.md', ' (proposed)'],
  ['ai-link', '▎   → ', 'README.md',           ' (updated install steps)'],
  ['ai', '▎'],
  ['ai', '▎ The migration covers all four packages and preserves'],
  ['ai', '▎ wire-compatibility with existing sessions. Estimated diff:'],
  ['ai', '▎ ~340 LOC across 12 files.'],
  ['blank'],
  ['yellow', '? Approve plan and proceed with implementation?'],
  ['dim',    '   [y]es   [n]o   [d]iff plan   [e]dit plan'],
  ['cursor', '› '],
];

// ─── Markdown preview pane (right-side, slides over terminal) ─────────────
// Renders a small markdown-like AST without a real MD parser — production
// would feed an actual parsed AST through equivalent components.
function MarkdownPreviewPane({ accent, width = 460 }) {
  const files = [
    { name: 'migration.md',   path: 'docs/migration.md',   active: true,  modified: '2m ago'  },
    { name: 'api-changes.md', path: 'docs/api-changes.md', active: false, modified: '2m ago'  },
    { name: 'README.md',      path: 'README.md',           active: false, modified: '2m ago'  },
  ];

  const block = { fontFamily: 'var(--font-sans)', fontSize: 13.5, lineHeight: 1.65, color: 'var(--text-1)', margin: '0 0 12px 0' };
  const h1    = { fontFamily: 'var(--font-sans)', fontSize: 20,   fontWeight: 600, color: 'var(--text-1)', margin: '0 0 8px 0',  letterSpacing: -0.2 };
  const h2    = { fontFamily: 'var(--font-sans)', fontSize: 15,   fontWeight: 600, color: 'var(--text-1)', margin: '20px 0 8px 0' };
  const li    = { ...block, margin: '2px 0 2px 20px', position: 'relative' };
  const code  = { fontFamily: 'var(--font-mono)', fontSize: 12,   background: 'var(--bg-3)', padding: '1px 5px', borderRadius: 3, color: 'var(--text-1)' };
  const pre   = { fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.55, background: 'var(--term-bg)', border: '1px solid var(--border-1)', borderRadius: 6, padding: '12px 14px', color: 'var(--text-2)', overflow: 'hidden', margin: '0 0 16px 0' };

  return (
    <div style={{ width, background: 'var(--bg-1)', borderLeft: '1px solid var(--border-2)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      {/* mini tab strip — files mentioned in this session */}
      <div style={{ display: 'flex', alignItems: 'stretch', height: 36, background: 'var(--bg-1)', borderBottom: '1px solid var(--border-1)' }}>
        {files.map((f, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '0 12px',
            background: f.active ? 'var(--bg-0)' : 'transparent',
            borderRight: '1px solid var(--border-1)',
            fontFamily: 'var(--font-mono)', fontSize: 12,
            color: f.active ? 'var(--text-1)' : 'var(--text-3)',
            position: 'relative', minWidth: 0,
          }}>
            {f.active && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: accent }} />}
            <span style={{ fontSize: 11, color: f.active ? accent : 'var(--text-4)' }}>M↓</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
            <span className="aip-tab-close" style={{ width: 18, height: 18, marginRight: -4, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}>×</span>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ width: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', borderLeft: '1px solid var(--border-1)' }}>
          <span style={{ fontSize: 14 }}>×</span>
        </div>
      </div>

      {/* path bar + actions */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-1)', background: 'var(--bg-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ color: 'var(--text-4)' }}>~/AI.Pad/</span>docs/migration.md
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-4)' }}>modified 2m ago</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <span style={{ width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, color: 'var(--text-3)', fontSize: 12 }} title="Open in editor">↗</span>
          <span style={{ width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, color: 'var(--text-3)', fontSize: 12 }} title="Copy path">⎘</span>
        </div>
      </div>

      {/* rendered markdown body */}
      <div style={{ flex: 1, overflow: 'hidden', padding: '20px 22px', background: 'var(--bg-0)' }}>
        <h1 style={h1}>Migration plan: terminal-host</h1>
        <p style={{ ...block, color: 'var(--text-2)' }}>
          Move the per-session IPC from a single <span style={code}>EventEmitter</span> to a typed <span style={code}>MessagePort</span> bus. The change is wire-compatible with existing sessions.
        </p>

        <h2 style={h2}>Why</h2>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          <li style={li}><span style={{ position: 'absolute', left: -12, color: 'var(--text-4)' }}>·</span>Stronger types at the transport boundary</li>
          <li style={li}><span style={{ position: 'absolute', left: -12, color: 'var(--text-4)' }}>·</span>Backpressure-aware by default</li>
          <li style={li}><span style={{ position: 'absolute', left: -12, color: 'var(--text-4)' }}>·</span>Survives renderer reload via transferable ports</li>
        </ul>

        <h2 style={h2}>Steps</h2>
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', counterReset: 'step' }}>
          {[
            ['Add', <span style={code} key="c">MessagePortHost</span>, ' in ', <span style={code} key="d">terminal-host/src/transport/</span>],
            ['Wrap existing handlers with a compatibility adapter'],
            ['Migrate one channel at a time, behind a feature flag'],
            ['Remove the legacy emitter and adapter'],
          ].map((parts, i) => (
            <li key={i} style={{ ...block, margin: '4px 0', display: 'flex', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-4)', minWidth: 18 }}>{i + 1}.</span>
              <span style={{ flex: 1 }}>{parts}</span>
            </li>
          ))}
        </ol>

        <pre style={pre}>
{`class MessagePortHost {
  constructor(public port: MessagePort) {
    port.onmessage = (e) => this.dispatch(e.data);
  }
  send<T>(channel: string, payload: T) {
    this.port.postMessage({ channel, payload });
  }
}`}
        </pre>
      </div>

      {/* footer */}
      <div style={{ borderTop: '1px solid var(--border-1)', padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-4)', background: 'var(--bg-1)' }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <span><span style={{ color: 'var(--text-3)' }}>esc</span> close</span>
          <span><span style={{ color: 'var(--text-3)' }}>⌘[</span> prev file</span>
          <span><span style={{ color: 'var(--text-3)' }}>⌘]</span> next file</span>
        </div>
        <span>342 LOC · 6 KB</span>
      </div>
    </div>
  );
}

Object.assign(window, { TermLine, TerminalPane, TERM_DEFAULT, TERM_AWAITING, TERM_LIMITED, ModalScrim, SettingsModal, AboutModal, CommandPalette, EmptyState, MarkdownPreviewPane, TERM_WITH_MD_LINKS });
