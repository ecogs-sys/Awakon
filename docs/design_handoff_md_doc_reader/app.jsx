// ═══════════════════════════════════════════════════════════════════════════
// AI.Pad — UI components & screens
// All inline-styled to avoid a global `styles` name collision across files.
// ═══════════════════════════════════════════════════════════════════════════

const STATUSES = {
  running:  { label: 'running',        dot: 'var(--st-running)',  bg: 'var(--st-running-bg)',  ring: 'oklch(0.78 0.15 155 / 0.45)' },
  awaiting: { label: 'awaiting input', dot: 'var(--st-awaiting)', bg: 'var(--st-awaiting-bg)', ring: 'oklch(0.82 0.13 88 / 0.50)' },
  limited:  { label: 'rate-limited',   dot: 'var(--st-limited)',  bg: 'var(--st-limited-bg)',  ring: 'oklch(0.70 0.18 25 / 0.45)' },
  idle:     { label: 'idle',           dot: 'var(--st-idle)',     bg: 'var(--st-idle-bg)',     ring: 'oklch(0.55 0.008 250 / 0.30)' },
};

// ─── Status badge — three styles ──────────────────────────────────────────
function StatusBadge({ status, time, style = 'pill' }) {
  const s = STATUSES[status];
  if (style === 'dot') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.dot, boxShadow: `0 0 0 3px ${s.ring}` }} />
        <span>{s.label}{time != null && <span style={{ color: 'var(--text-4)' }}>  ·  {time}</span>}</span>
      </span>
    );
  }
  if (style === 'icon') {
    const Icon = status === 'running' ? '▶' : status === 'awaiting' ? '◔' : status === 'limited' ? '◼' : '○';
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: s.dot }}>
        <span style={{ fontSize: 10 }}>{Icon}</span>
        <span style={{ color: 'var(--text-3)' }}>{s.label}{time != null && <span style={{ color: 'var(--text-4)' }}>  ·  {time}</span>}</span>
      </span>
    );
  }
  // pill
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: s.dot, background: s.bg, padding: '2px 8px', borderRadius: 999, letterSpacing: 0.2, lineHeight: 1.4 }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: s.dot }} />
      {s.label}{time != null && <span style={{ color: 'var(--text-3)', marginLeft: 2 }}>· {time}</span>}
    </span>
  );
}

// ─── Window controls (Windows-style, themed) ──────────────────────────────
function WindowControls() {
  const btn = { width: 46, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-2)' };
  return (
    <div style={{ display: 'flex', height: 32 }}>
      <div style={btn} title="Minimize">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" strokeWidth="1" /></svg>
      </div>
      <div style={btn} title="Maximize">
        <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
      </div>
      <div style={{ ...btn, color: 'var(--text-1)' }} title="Close">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" /></svg>
      </div>
    </div>
  );
}

// ─── App icon mini (for titlebar) ─────────────────────────────────────────
function AppGlyph({ accent = '#7CA8E0', size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
      <rect width="24" height="24" rx="6" fill="#2a2f38" />
      <circle cx="7"  cy="9" r="1.6" fill="#9bc8a3" />
      <circle cx="12" cy="9" r="1.6" fill={accent} />
      <circle cx="17" cy="9" r="1.6" fill="#e0c477" />
      <path d="M 7 15 L 10 17 L 7 19" fill="none" stroke="#e8eaee" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="12" y="18" width="5" height="1.2" rx="0.6" fill={accent} />
    </svg>
  );
}

// ─── Custom titlebar (VS Code style) ──────────────────────────────────────
function TitleBar({ accent, title = 'AI.Pad', subtitle }) {
  const menu = ['File', 'Tabs', 'View', 'Window', 'Help'];
  return (
    <div style={{ height: 32, background: 'var(--bg-1)', display: 'flex', alignItems: 'stretch', borderBottom: '1px solid var(--border-1)', userSelect: 'none', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px 0 12px' }}>
        <AppGlyph accent={accent} size={16} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {menu.map((m) => (
          <div key={m} style={{ padding: '0 8px', height: '100%', display: 'flex', alignItems: 'center', fontSize: 12.5, color: 'var(--text-2)' }}>{m}</div>
        ))}
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--text-3)', letterSpacing: 0.2 }}>
        <span style={{ color: 'var(--text-2)', fontWeight: 500 }}>{title}</span>
        {subtitle && <span style={{ color: 'var(--text-4)', marginLeft: 10 }}>— {subtitle}</span>}
      </div>
      <WindowControls />
    </div>
  );
}

// ─── Tab strip ────────────────────────────────────────────────────────────
function Tab({ label, status, active, accent }) {
  const s = STATUSES[status];
  return (
    <div style={{
      position: 'relative',
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '0 14px',
      height: 36,
      minWidth: 160, maxWidth: 220,
      background: active ? 'var(--bg-0)' : 'transparent',
      borderRight: '1px solid var(--border-1)',
      fontFamily: 'var(--font-mono)', fontSize: 12,
      color: active ? 'var(--text-1)' : 'var(--text-3)',
    }}>
      {active && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: accent }} />}
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.dot, boxShadow: status === 'awaiting' ? `0 0 0 3px ${s.ring}` : 'none' }} />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span className="aip-tab-close" style={{ width: 18, height: 18, marginRight: -4, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}>×</span>
    </div>
  );
}

function TabBar({ tabs, activeIdx = 0, accent }) {
  return (
    <div style={{ height: 36, background: 'var(--bg-1)', display: 'flex', alignItems: 'stretch', borderBottom: '1px solid var(--border-1)', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        {tabs.map((t, i) => <Tab key={i} {...t} active={i === activeIdx} accent={accent} />)}
      </div>
      <div style={{ width: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 16 }}>+</div>
      <div style={{ flex: 1 }} />
    </div>
  );
}

// ─── Sidebar — status overview header ─────────────────────────────────────
function StatusOverview({ sessions, accent }) {
  const counts = sessions.reduce((acc, s) => { acc[s.status] = (acc[s.status] || 0) + 1; return acc; }, {});
  const order = ['awaiting', 'limited', 'running', 'idle'];
  const cell = (k) => {
    const c = counts[k] || 0;
    const s = STATUSES[k];
    return (
      <div key={k} style={{ flex: 1, padding: '8px 10px', borderRight: k !== 'idle' ? '1px solid var(--border-1)' : 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: s.dot, opacity: c > 0 ? 1 : 0.4 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: c > 0 ? 'var(--text-1)' : 'var(--text-4)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{c}</span>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--text-4)', letterSpacing: 0.4, textTransform: 'uppercase' }}>{k === 'awaiting' ? 'await' : k}</span>
      </div>
    );
  };
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid var(--border-1)', background: 'var(--bg-1)' }}>
      {order.map(cell)}
    </div>
  );
}

// ─── Session row ──────────────────────────────────────────────────────────
function SessionRow({ session, active, badgeStyle, accent }) {
  const s = STATUSES[session.status];
  return (
    <div style={{
      position: 'relative',
      padding: '12px 14px 12px 16px',
      background: active ? 'var(--bg-3)' : 'transparent',
      borderLeft: active ? `2px solid ${accent}` : '2px solid transparent',
      cursor: 'pointer',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 22, height: 22, borderRadius: 5, background: 'var(--bg-3)', border: '1px solid var(--border-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, color: 'var(--text-2)', letterSpacing: 0.4, position: 'relative' }}>
          {session.kind}
          {session.status !== 'idle' && (
            <span style={{ position: 'absolute', top: -3, right: -3, width: 8, height: 8, borderRadius: '50%', background: s.dot, border: '2px solid var(--bg-1)' }} />
          )}
        </div>
        <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12.5, color: active ? 'var(--text-1)' : 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.name}</span>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-4)', marginLeft: 32, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.cwd}</div>
      <div style={{ marginLeft: 32 }}>
        <StatusBadge status={session.status} time={session.time} style={badgeStyle} />
      </div>
    </div>
  );
}

function Sidebar({ sessions, activeId, badgeStyle, accent, width = 260 }) {
  return (
    <div style={{ width, background: 'var(--bg-1)', borderRight: '1px solid var(--border-1)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: 1.2, color: 'var(--text-3)', textTransform: 'uppercase', fontWeight: 600 }}>Sessions</div>
        <div style={{ display: 'flex', gap: 4, color: 'var(--text-4)' }}>
          <span style={{ width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, fontSize: 14 }}>⇅</span>
          <span style={{ width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, fontSize: 14 }}>+</span>
        </div>
      </div>
      {sessions.length > 0 && <StatusOverview sessions={sessions} accent={accent} />}
      <div style={{ flex: 1, overflow: 'hidden', paddingTop: 4 }}>
        {sessions.map((s) => <SessionRow key={s.id} session={s} active={s.id === activeId} badgeStyle={badgeStyle} accent={accent} />)}
      </div>
      <div style={{ borderTop: '1px solid var(--border-1)', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-4)' }}>
        <span>⌘K  palette</span>
        <span style={{ color: 'var(--text-3)' }}>{sessions.length} active</span>
      </div>
    </div>
  );
}

// ─── Collapsed sidebar rail (~56px) ───────────────────────────────────────
// Chips-only triage view. Each chip keeps its status corner-dot; the active
// session keeps the accent left-border. Hovering a chip pops a flyout to the
// right previewing the session name + cwd + status badge.
function CollapsedRailRow({ session, active, accent }) {
  const [hover, setHover] = React.useState(false);
  const s = STATUSES[session.status];
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: 44,
        borderLeft: active ? `2px solid ${accent}` : '2px solid transparent',
        background: active ? 'var(--bg-3)' : (hover ? 'var(--bg-2)' : 'transparent'),
        cursor: 'pointer',
      }}
    >
      <div style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--bg-3)', border: '1px solid var(--border-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 600, color: active ? 'var(--text-1)' : 'var(--text-2)', letterSpacing: 0.4, position: 'relative' }}>
        {session.kind}
        {session.status !== 'idle' && (
          <span style={{ position: 'absolute', top: -3, right: -3, width: 9, height: 9, borderRadius: '50%', background: s.dot, border: '2px solid var(--bg-1)', boxShadow: session.status === 'awaiting' ? `0 0 0 2px ${s.ring}` : 'none' }} />
        )}
      </div>

      {/* hover flyout — previews name + cwd + status */}
      {hover && (
        <div style={{
          position: 'absolute', left: '100%', top: '50%', transform: 'translateY(-50%)',
          marginLeft: 10, zIndex: 30,
          minWidth: 232,
          background: 'var(--bg-2)', border: '1px solid var(--border-2)', borderRadius: 8,
          boxShadow: '0 12px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04)',
          padding: '11px 13px',
          display: 'flex', flexDirection: 'column', gap: 7,
          pointerEvents: 'none',
        }}>
          {/* little left-pointing notch */}
          <span style={{ position: 'absolute', left: -5, top: '50%', transform: 'translateY(-50%) rotate(45deg)', width: 9, height: 9, background: 'var(--bg-2)', borderLeft: '1px solid var(--border-2)', borderBottom: '1px solid var(--border-2)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: s.dot, flexShrink: 0 }} />
            <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.name}</span>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.cwd}</div>
          <StatusBadge status={session.status} time={session.time} style="pill" />
        </div>
      )}
    </div>
  );
}

function CollapsedSidebar({ sessions, activeId, accent, onExpand }) {
  const counts = sessions.reduce((acc, s) => { acc[s.status] = (acc[s.status] || 0) + 1; return acc; }, {});
  const order = ['awaiting', 'limited', 'running', 'idle'];
  return (
    <div style={{ width: 56, background: 'var(--bg-1)', borderRight: '1px solid var(--border-1)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      {/* header: expand chevron */}
      <div style={{ height: 45, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid var(--border-1)' }}>
        <span title="Expand sidebar (⌘B)" style={{ width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 5, color: 'var(--text-3)', fontSize: 14, cursor: 'pointer' }} onClick={onExpand}>›</span>
      </div>

      {/* compact status summary — dot + count, non-zero only */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '11px 0', borderBottom: '1px solid var(--border-1)' }}>
        {order.filter((k) => (counts[k] || 0) > 0).map((k) => {
          const s = STATUSES[k];
          return (
            <div key={k} title={`${counts[k]} ${s.label}`} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{counts[k]}</span>
            </div>
          );
        })}
      </div>

      {/* session chips */}
      <div style={{ flex: 1, overflow: 'hidden', paddingTop: 4 }}>
        {sessions.map((s) => <CollapsedRailRow key={s.id} session={s} active={s.id === activeId} accent={accent} />)}
      </div>

      {/* footer: new + palette */}
      <div style={{ borderTop: '1px solid var(--border-1)', padding: '8px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <span title="New session (⌘N)" style={{ width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 5, color: 'var(--text-3)', fontSize: 16, cursor: 'pointer' }}>+</span>
        <span title="Command palette (⌘K)" style={{ width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 5, color: 'var(--text-4)', fontFamily: 'var(--font-mono)', fontSize: 11, cursor: 'pointer' }}>⌘K</span>
      </div>
    </div>
  );
}

Object.assign(window, { STATUSES, StatusBadge, AppGlyph, TitleBar, Tab, TabBar, StatusOverview, SessionRow, Sidebar, CollapsedSidebar, CollapsedRailRow, WindowControls });
