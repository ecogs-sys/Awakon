// ═══════════════════════════════════════════════════════════════════════════
// AI.Pad — Split + Markdown doc review  ·  "pane is a tab container" model
// Storyboard of the C→B flow: doc docks into the originating agent's pane,
// then promotes to a real split inside that pane. Other agent untouched.
// Reuses globals: TitleBar, TabBar, Sidebar, TerminalPane, TermLine,
//                 DesignCanvas, DCSection, DCArtboard, TweaksPanel, useTweaks.
// ═══════════════════════════════════════════════════════════════════════════

const ACCENT_OPTIONS = ['#7CA8E0', '#9BC8A3', '#C9A56B', '#B89BD9', '#7BC1C5'];

const SESSIONS = [
  { id: 'a', kind: 'PS', name: 'claude · refactor', cwd: '~/Work/ecogs/projects/AI.Pad', status: 'awaiting', time: '1m 14s' },
  { id: 'b', kind: 'PS', name: 'codex · tests',     cwd: '~/Work/ecogs/projects/AI.Pad', status: 'limited',  time: '47m' },
  { id: 'c', kind: 'PS', name: 'pwsh.exe',          cwd: '~/Work/ecogs/projects/AI.Pad', status: 'running',  time: '10s' },
  { id: 'd', kind: 'PS', name: 'pwsh.exe',          cwd: '~/Work/ecogs/projects/AI.Pad', status: 'idle',     time: '4m' },
];
const TABS = [
  { label: 'claude + pwsh · split', status: 'awaiting' },
  { label: 'pwsh.exe',             status: 'running' },
  { label: 'pwsh.exe',             status: 'idle' },
];

// The realistic second pane: the user's own working shell against the repo.
const TERM_SHELL = [
  ['prompt', 'PS C:\\Work\\ecogs\\projects\\AI.Pad>', 'git', 'status'],
  ['blank'],
  ['out',   'On branch refactor/transport-bus'],
  ['out',   'Changes not staged for commit:'],
  ['red',   '  modified:   packages/terminal-host/src/ipc.ts'],
  ['green', '  new file:   docs/migration.md'],
  ['blank'],
  ['prompt', 'PS C:\\Work\\ecogs\\projects\\AI.Pad>', 'dotnet', 'test'],
  ['blank'],
  ['dim',   '  Determining projects to restore...'],
  ['green', '  Passed!  24 tests, 0 failed  (1.8s)'],
  ['blank'],
  ['cursor', '› '],
];

// ─── Shell (local copy — main.jsx not loaded here) ─────────────────────────
function Shell({ children, subtitle, accent }) {
  return (
    <div style={{ width: '100%', height: '100%', background: 'var(--bg-0)', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-1)', position: 'relative' }}>
      <TitleBar accent={accent} title="AI.Pad" subtitle={subtitle} />
      <TabBar tabs={TABS} activeIdx={0} accent={accent} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Sidebar sessions={SESSIONS} activeId="a" badgeStyle="pill" accent={accent} />
        {children}
      </div>
    </div>
  );
}

// ─── Pane header: the tab strip that turns a split pane into a container ────
// tabs: [{ type:'term'|'doc', label, status?, active, dirty? }]
function PaneHeader({ agent, tabs, accent, actions }) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', height: 34, background: 'var(--bg-1)', borderBottom: '1px solid var(--border-1)', flexShrink: 0 }}>
      {tabs.map((t, i) => {
        const isDoc = t.type === 'doc';
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '0 11px',
            background: t.active ? 'var(--term-bg)' : 'transparent',
            borderRight: '1px solid var(--border-1)',
            fontFamily: 'var(--font-mono)', fontSize: 11.5,
            color: t.active ? 'var(--text-1)' : 'var(--text-3)',
            position: 'relative', minWidth: 0, maxWidth: 230, cursor: 'pointer',
          }}>
            {t.active && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: accent }} />}
            {isDoc
              ? <span style={{ fontSize: 10.5, fontWeight: 700, color: t.active ? accent : 'var(--text-4)' }}>M↓</span>
              : <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: t.status === 'awaiting' ? 'var(--st-awaiting)' : t.status === 'limited' ? 'var(--st-limited)' : 'var(--st-running)' }} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label}</span>
            {isDoc && <span className="aip-tab-close" style={{ width: 16, height: 16, marginRight: -3, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)', fontSize: 13 }}>×</span>}
          </div>
        );
      })}
      <div style={{ flex: 1 }} />
      {actions}
    </div>
  );
}

const HeaderBtn = ({ children, title, accent, on }) => (
  <span title={title} style={{ height: 22, alignSelf: 'center', marginRight: 6, padding: '0 8px', borderRadius: 5, display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-mono)', fontSize: 11, color: on ? accent : 'var(--text-3)', background: on ? (accent + '22') : 'var(--bg-2)', border: '1px solid var(--border-1)', cursor: 'pointer' }}>{children}</span>
);

// ─── Doc review bar: path + provenance + approve/request ───────────────────
function DocReviewBar({ path, accent }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', background: 'var(--bg-1)', borderBottom: '1px solid var(--border-1)', flexShrink: 0 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span style={{ color: 'var(--text-4)' }}>~/AI.Pad/</span>{path}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-4)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--st-awaiting)' }} />proposed by claude · refactor
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        <span style={{ padding: '3px 10px', borderRadius: 5, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--st-running)', background: 'var(--st-running-bg)', border: '1px solid transparent', cursor: 'pointer' }}>✓ Approve</span>
        <span style={{ padding: '3px 10px', borderRadius: 5, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)', background: 'var(--bg-2)', border: '1px solid var(--border-1)', cursor: 'pointer' }}>✎ Request changes</span>
      </div>
    </div>
  );
}

// ─── Rendered markdown body (migration.md) ─────────────────────────────────
function MigrationDoc({ maxWidth } = {}) {
  const block = { fontFamily: 'var(--font-sans)', fontSize: 13.5, lineHeight: 1.65, color: 'var(--text-1)', margin: '0 0 12px 0' };
  const h1 = { fontFamily: 'var(--font-sans)', fontSize: 20, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 8px 0', letterSpacing: -0.2 };
  const h2 = { fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 600, color: 'var(--text-1)', margin: '20px 0 8px 0' };
  const li = { ...block, margin: '2px 0 2px 20px', position: 'relative' };
  const code = { fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--bg-3)', padding: '1px 5px', borderRadius: 3, color: 'var(--text-1)' };
  const pre = { fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.55, background: 'var(--term-bg)', border: '1px solid var(--border-1)', borderRadius: 6, padding: '12px 14px', color: 'var(--text-2)', overflow: 'hidden', margin: '0 0 16px 0' };
  return (
    <div style={{ flex: 1, overflow: 'hidden', background: 'var(--bg-0)' }}>
     <div style={{ maxWidth: maxWidth || 'none', margin: '0 auto', padding: maxWidth ? '28px 24px' : '20px 24px' }}>
      <h1 style={h1}>Migration plan: terminal-host</h1>
      <p style={{ ...block, color: 'var(--text-2)' }}>
        Move the per-session IPC from a single <span style={code}>EventEmitter</span> to a typed <span style={code}>MessagePort</span> bus. The change is wire-compatible with existing sessions.
      </p>
      <h2 style={h2}>Why</h2>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {['Stronger types at the transport boundary', 'Backpressure-aware by default', 'Survives renderer reload via transferable ports'].map((x, i) => (
          <li key={i} style={li}><span style={{ position: 'absolute', left: -12, color: 'var(--text-4)' }}>·</span>{x}</li>
        ))}
      </ul>
      <h2 style={h2}>Steps</h2>
      <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {[
          ['Add ', <span style={code} key="d">MessagePortHost</span>, ' in transport/'],
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
      <pre style={pre}>{`class MessagePortHost {
  constructor(public port: MessagePort) {
    port.onmessage = (e) => this.dispatch(e.data);
  }
  send<T>(channel: string, payload: T) {
    this.port.postMessage({ channel, payload });
  }
}`}</pre>
     </div>
    </div>
  );
}

// ─── Rendered markdown body (test-plan.md, for codex) ──────────────────────
function TestPlanDoc() {
  const block = { fontFamily: 'var(--font-sans)', fontSize: 13.5, lineHeight: 1.65, color: 'var(--text-1)', margin: '0 0 12px 0' };
  const h1 = { fontFamily: 'var(--font-sans)', fontSize: 20, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 8px 0', letterSpacing: -0.2 };
  const h2 = { fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 600, color: 'var(--text-1)', margin: '20px 0 8px 0' };
  const li = { ...block, margin: '2px 0 2px 20px', position: 'relative' };
  const code = { fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--bg-3)', padding: '1px 5px', borderRadius: 3, color: 'var(--text-1)' };
  return (
    <div style={{ flex: 1, overflow: 'hidden', padding: '20px 24px', background: 'var(--bg-0)' }}>
      <h1 style={h1}>Test plan: transport bus</h1>
      <p style={{ ...block, color: 'var(--text-2)' }}>
        14 new specs across <span style={code}>core</span>, <span style={code}>keymap</span>, and <span style={code}>terminal-host</span>. Each channel gets a round-trip and a backpressure case.
      </p>
      <h2 style={h2}>Coverage</h2>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {['port handshake + transfer', 'ordered delivery under load', 'reconnect after renderer reload', 'legacy emitter parity'].map((x, i) => (
          <li key={i} style={li}><span style={{ position: 'absolute', left: -12, color: 'var(--text-4)' }}>·</span>{x}</li>
        ))}
      </ul>
      <h2 style={h2}>Fixtures</h2>
      <p style={block}>Shared <span style={code}>makePortPair()</span> helper; deterministic clock via <span style={code}>vi.useFakeTimers()</span>.</p>
    </div>
  );
}

// ─── A pane that holds a live terminal ─────────────────────────────────────
function TermPane({ agent, status, lines, accent, hintFile }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
      <PaneHeader agent={agent} accent={accent} tabs={[{ type: 'term', label: agent, status, active: true }]} />
      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <TerminalPane lines={lines} accent={accent} padding={22} />
        {hintFile && (
          <div style={{ position: 'absolute', left: 64, top: 150, display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none' }}>
            <span style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${accent}`, boxShadow: `0 0 0 4px ${accent}33` }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-1)', background: 'var(--bg-2)', border: '1px solid var(--border-2)', borderRadius: 6, padding: '5px 9px', boxShadow: '0 8px 20px rgba(0,0,0,.4)' }}>click → opens in this pane</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── A pane showing a doc (C: doc covers the terminal) ─────────────────────
function DocPane({ agent, status, accent, docName, path, DocComp, promoteOn }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <PaneHeader agent={agent} accent={accent}
        tabs={[
          { type: 'term', label: agent, status, active: false },
          { type: 'doc', label: docName, active: true },
        ]}
        actions={<>
          <HeaderBtn title="Split this pane: terminal + doc side by side" accent={accent} on={promoteOn}>⤢ Open beside</HeaderBtn>
          <HeaderBtn title="Back to the live terminal" accent={accent}>↩ Terminal</HeaderBtn>
        </>}
      />
      <DocReviewBar path={path} accent={accent} />
      <DocComp />
    </div>
  );
}

// ─── A pane PROMOTED to a split: live terminal + doc together (B) ──────────
function PromotedPane({ agent, status, accent, docName, path, axis }) {
  const vertical = axis === 'vertical';
  const miniTerm = [
    ['ai', '▎ Implementing migration plan…'],
    ['tool', '⏵ write transport/MessagePortHost.ts', '＋62'],
    ['tool', '⏵ wrap ipc.ts handlers', '＋31 −12'],
    ['blank'],
    ['yellow', '? Apply changes to 3 files?'],
    ['cursor', '› '],
  ];
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <PaneHeader agent={agent} accent={accent}
        tabs={[
          { type: 'term', label: agent, status, active: true },
          { type: 'doc', label: docName, active: true },
        ]}
        actions={<><HeaderBtn title="Doc is docked beside the terminal" accent={accent} on>⤢ Beside · {vertical ? 'stacked' : 'columns'}</HeaderBtn></>}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: vertical ? 'column' : 'row', minHeight: 0, minWidth: 0 }}>
        <div style={{ ...(vertical ? { height: 232 } : { width: '46%' }), display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, flexShrink: 0 }}>
          <TerminalPane lines={miniTerm} accent={accent} padding={18} />
        </div>
        <div style={{ ...(vertical ? { height: 1, width: '100%' } : { width: 1, height: '100%' }), background: 'var(--border-2)', flexShrink: 0 }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          <DocReviewBar path={path} accent={accent} />
          <MigrationDoc />
        </div>
      </div>
    </div>
  );
}

const Divider = () => <div style={{ width: 1, background: 'var(--border-2)', flexShrink: 0 }} />;

// ════════════════ OVERLAY MODEL · slide-from-right reader ══════════════════
// The reader is owned by the TAB, not a pane. It slides in from the right and
// covers ~90% of the console — every split included. The ~10% peek of dimmed
// terminal IS the dismiss affordance. Switching tabs parks it; the doc tab
// gets an M↓ marker. This is a read mode, not a work-while-reading mode.

// Plain terminal pane with a corner label (no tab-container header)
function PlainPane({ label, status, lines, accent, hintFile }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
      <div style={{ position: 'absolute', top: 8, left: 12, zIndex: 2, fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-4)', background: 'var(--term-bg)', padding: '2px 6px', borderRadius: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
        {status && <span style={{ width: 5, height: 5, borderRadius: '50%', background: status === 'awaiting' ? 'var(--st-awaiting)' : status === 'limited' ? 'var(--st-limited)' : 'var(--st-running)' }} />}
        {label}
      </div>
      <TerminalPane lines={lines} accent={accent} padding={22} />
      {hintFile && (
        <div style={{ position: 'absolute', left: 64, top: 150, display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none' }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${accent}`, boxShadow: `0 0 0 4px ${accent}33` }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-1)', background: 'var(--bg-2)', border: '1px solid var(--border-2)', borderRadius: 6, padding: '5px 9px', boxShadow: '0 8px 20px rgba(0,0,0,.4)' }}>click → slides the reader in</span>
        </div>
      )}
    </div>
  );
}

function PlainSplitAS({ accent }) {
  return (
    <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
      <PlainPane label="claude · refactor" status="awaiting" lines={TERM_WITH_MD_LINKS} accent={accent} />
      <Divider />
      <PlainPane label="pwsh · git / dotnet" status="running" lines={TERM_SHELL} accent={accent} />
    </div>
  );
}

// The sliding reader panel itself
function OverlayDoc({ accent }) {
  const files = [
    { name: 'migration.md',   active: true  },
    { name: 'api-changes.md', active: false },
    { name: 'README.md',      active: false },
  ];
  return (
    <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: '90%', display: 'flex', flexDirection: 'column', background: 'var(--bg-0)', borderLeft: '1px solid var(--border-2)', boxShadow: '-24px 0 60px rgba(0,0,0,.5)', zIndex: 6 }}>
      <div style={{ display: 'flex', alignItems: 'stretch', height: 36, background: 'var(--bg-1)', borderBottom: '1px solid var(--border-1)' }}>
        {files.map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 13px', background: f.active ? 'var(--bg-0)' : 'transparent', borderRight: '1px solid var(--border-1)', fontFamily: 'var(--font-mono)', fontSize: 12, color: f.active ? 'var(--text-1)' : 'var(--text-3)', position: 'relative', cursor: 'pointer' }}>
            {f.active && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: accent }} />}
            <span style={{ fontSize: 11, fontWeight: 700, color: f.active ? accent : 'var(--text-4)' }}>M↓</span>
            <span>{f.name}</span>
            <span className="aip-tab-close" style={{ width: 16, height: 16, marginRight: -3, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)', fontSize: 13 }}>×</span>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div title="Close (esc)" style={{ width: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', borderLeft: '1px solid var(--border-1)', cursor: 'pointer' }}><span style={{ fontSize: 15 }}>×</span></div>
      </div>
      <DocReviewBar path="docs/migration.md" accent={accent} />
      <MigrationDoc maxWidth={780} />
      <div style={{ borderTop: '1px solid var(--border-1)', padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-4)', background: 'var(--bg-1)' }}>
        <div style={{ display: 'flex', gap: 14 }}>
          <span><span style={{ color: 'var(--text-3)' }}>esc</span> close</span>
          <span><span style={{ color: 'var(--text-3)' }}>⌘[</span> prev file</span>
          <span><span style={{ color: 'var(--text-3)' }}>⌘]</span> next file</span>
        </div>
        <span>342 LOC · 6 KB</span>
      </div>
    </div>
  );
}

// Reader open over a 3-way split — covers all of them
function OverlayModelScreen({ accent }) {
  return (
    <Shell subtitle="claude + pwsh · split — reviewing migration.md" accent={accent}>
      <div style={{ flex: 1, position: 'relative', display: 'flex', minWidth: 0 }}>
        <PlainSplitAS accent={accent} />
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(8,7,11,.55)', zIndex: 5 }}>
          <div style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', writingMode: 'vertical-rl', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: 1.5, color: 'var(--text-3)' }}>click or esc to close</div>
        </div>
        <OverlayDoc accent={accent} />
      </div>
    </Shell>
  );
}

// Per-tab persistence: switched to another tab; reader stays parked on its tab
function TabPersistScreen({ accent }) {
  const tab = (label, opts = {}) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', height: '100%', position: 'relative', background: opts.active ? 'var(--bg-0)' : 'transparent', borderRight: '1px solid var(--border-1)', fontFamily: 'var(--font-mono)', fontSize: 12.5, color: opts.active ? 'var(--text-1)' : 'var(--text-3)', cursor: 'pointer' }}>
      {opts.active && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: accent }} />}
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: opts.dot || 'var(--st-running)' }} />
      <span>{label}</span>
      {opts.doc && <span title="A document is open on this tab" style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 700, color: accent, background: accent + '22', border: '1px solid ' + accent + '44', borderRadius: 4, padding: '1px 4px', lineHeight: 1.2 }}>M↓</span>}
      <span className="aip-tab-close" style={{ width: 18, height: 18, marginRight: -4, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)', fontSize: 14 }}>×</span>
    </div>
  );
  return (
    <div style={{ width: '100%', height: '100%', background: 'var(--bg-0)', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-1)' }}>
      <TitleBar accent={accent} title="AI.Pad" subtitle="pwsh.exe — doc parked on the split tab" />
      <div style={{ height: 36, background: 'var(--bg-1)', display: 'flex', alignItems: 'stretch', borderBottom: '1px solid var(--border-1)' }}>
        <div style={{ display: 'flex', alignItems: 'stretch' }}>
          {tab('claude + pwsh · split', { dot: 'var(--st-awaiting)', doc: true })}
          {tab('pwsh.exe', { active: true, dot: 'var(--st-running)' })}
          {tab('pwsh.exe', { dot: 'var(--st-idle)' })}
        </div>
        <div style={{ width: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 16 }}>+</div>
        <div style={{ flex: 1 }} />
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Sidebar sessions={SESSIONS} activeId="c" badgeStyle="pill" accent={accent} />
        <PlainPane label="pwsh.exe" status="running" lines={TERM_DEFAULT} accent={accent} />
      </div>
    </div>
  );
}

// ════════════════════════ STORYBOARD SCREENS ══════════════════════════════

// ① Agent proposes docs in the agent pane — your shell runs alongside
function Step1({ accent }) {
  return (
    <Shell subtitle="claude + pwsh · split — agent proposed 3 files" accent={accent}>
      <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
        <PlainPane label="claude · refactor" status="awaiting" lines={TERM_WITH_MD_LINKS} accent={accent} hintFile />
        <Divider />
        <PlainPane label="pwsh · git / dotnet" status="running" lines={TERM_SHELL} accent={accent} />
      </div>
    </Shell>
  );
}

// ② C — doc opens INSIDE claude's pane, covering its terminal. Shell stays live.
function Step2({ accent }) {
  return (
    <Shell subtitle="claude + pwsh · split — reviewing migration.md, shell live" accent={accent}>
      <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
        <DocPane agent="claude · refactor" status="awaiting" accent={accent} docName="migration.md" path="docs/migration.md" DocComp={MigrationDoc} />
        <Divider />
        <TermPane agent="pwsh · git / dotnet" status="running" lines={TERM_SHELL} accent={accent} />
      </div>
    </Shell>
  );
}

// ③ B — promoted: claude's pane splits so terminal + doc coexist (stacked)
function Step3({ accent }) {
  return (
    <Shell subtitle="claude + pwsh · split — migration.md docked beside agent terminal" accent={accent}>
      <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
        <PromotedPane agent="claude · refactor" status="awaiting" accent={accent} docName="migration.md" path="docs/migration.md" axis="vertical" />
        <Divider />
        <TermPane agent="pwsh · git / dotnet" status="running" lines={TERM_SHELL} accent={accent} />
      </div>
    </Shell>
  );
}

// ④ Two agents, two docs — each pane owns its own doc, independently
function Step4({ accent }) {
  return (
    <Shell subtitle="claude + codex · split — both reviewing docs" accent={accent}>
      <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
        <DocPane agent="claude · refactor" status="awaiting" accent={accent} docName="migration.md" path="docs/migration.md" DocComp={MigrationDoc} />
        <Divider />
        <DocPaneCodex accent={accent} />
      </div>
    </Shell>
  );
}
// codex variant (provenance differs)
function DocPaneCodex({ accent }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <PaneHeader agent="codex · tests" accent={accent}
        tabs={[
          { type: 'term', label: 'codex · tests', status: 'limited', active: false },
          { type: 'doc', label: 'test-plan.md', active: true },
        ]}
        actions={<><HeaderBtn title="Split this pane" accent={accent}>⤢ Open beside</HeaderBtn><HeaderBtn title="Back to terminal" accent={accent}>↩ Terminal</HeaderBtn></>}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', background: 'var(--bg-1)', borderBottom: '1px solid var(--border-1)', flexShrink: 0 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', flex: 1 }}><span style={{ color: 'var(--text-4)' }}>~/AI.Pad/</span>docs/test-plan.md</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-4)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--st-limited)' }} />proposed by codex · tests</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ padding: '3px 10px', borderRadius: 5, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--st-running)', background: 'var(--st-running-bg)', cursor: 'pointer' }}>✓ Approve</span>
          <span style={{ padding: '3px 10px', borderRadius: 5, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)', background: 'var(--bg-2)', border: '1px solid var(--border-1)', cursor: 'pointer' }}>✎ Request changes</span>
        </div>
      </div>
      <TestPlanDoc />
    </div>
  );
}

// ─── Behaviour legend ──────────────────────────────────────────────────────
function Legend({ accent }) {
  const row = (k, v) => (
    <div style={{ display: 'flex', gap: 12, marginBottom: 13 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: accent, minWidth: 78, flexShrink: 0 }}>{k}</span>
      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-2)' }}>{v}</span>
    </div>
  );
  return (
    <div style={{ width: '100%', height: '100%', background: 'var(--bg-1)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '26px 28px', overflow: 'hidden' }}>
      <div style={{ fontFamily: 'var(--font-sans)', fontSize: 17, fontWeight: 600, color: 'var(--text-1)', marginBottom: 4 }}>How it behaves</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-4)', marginBottom: 22 }}>a reader the tab owns</div>
      {row('Open', 'Clicking a proposed .md slides a reader in from the right, covering ~90% of the console — every split included (agent pane + your shell).')}
      {row('Read mode', 'It’s modal: the dimmed ~10% sliver of terminal behind it is just the dismiss target. Click it or hit esc to drop back.')}
      {row('Per tab', 'The reader belongs to its tab. Switch tabs and it stays parked; the other tab shows its own view. An M↓ marker on the tab flags an open doc.')}
      {row('Files', 'Multiple proposed files share the reader’s tab strip; ⌘[ / ⌘] move between them. Provenance + approve / request-changes ride along.')}
      {row('Need shell?', 'The reader is modal, so dismiss it (esc or click the sliver) to drop straight back to the split — your shell is sitting right there, still live.')}
    </div>
  );
}

// ─── App ───────────────────────────────────────────────────────────────────
function App() {
  const [t, setTweak] = useTweaks(window.__TWEAK_DEFAULTS);
  React.useEffect(() => {
    document.documentElement.style.setProperty('--accent', t.accent);
    document.documentElement.style.setProperty('--accent-soft', t.accent + '2e');
    document.documentElement.style.setProperty('--accent-glow', t.accent + '59');
  }, [t.accent]);
  const accent = t.accent;
  return (
    <React.Fragment>
      <DesignCanvas>
        <DCSection id="overlay" title="Right-side overlay · signed off">
          <DCArtboard id="o1" label="① Agent proposes files in the agent pane · your shell runs alongside" width={1500} height={900}><Step1 accent={accent} /></DCArtboard>
          <DCArtboard id="o2" label="② Reader slides in from right · covers ~90% · agent + shell both behind" width={1500} height={900}><OverlayModelScreen accent={accent} /></DCArtboard>
          <DCArtboard id="o3" label="③ Switch tabs · reader stays parked (M↓) · other tab unaffected" width={1500} height={900}><TabPersistScreen accent={accent} /></DCArtboard>
        </DCSection>
        <DCSection id="notes" title="Model">
          <DCArtboard id="legend" label="Behaviour" width={620} height={440}><Legend accent={accent} /></DCArtboard>
        </DCSection>
      </DesignCanvas>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Accent">
          <TweakColor label="Color" value={t.accent} onChange={(v) => setTweak('accent', v)} options={ACCENT_OPTIONS} />
        </TweakSection>
      </TweaksPanel>

      <style>{`
        @keyframes aip-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
        .aip-cursor { animation: aip-blink 1.05s steps(1) infinite; }
        .aip-tab-close { transition: background .12s ease, color .12s ease; }
        .aip-tab-close:hover { background: var(--bg-3); color: var(--text-1); }
      `}</style>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
