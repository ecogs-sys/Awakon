import '../chrome/styles/tokens.css';
import '../chrome/styles/context-menu.css';
import type { PreloadBridge } from '@awakon/terminal-host';
import type { SessionId, Shell } from '@awakon/contracts';
import { IpcChannel } from '@awakon/contracts';
import { SplitContainer } from './split-container.js';

const container = document.getElementById('term-root');
if (!container) throw new Error('#term-root not found in terminal-host.html');

const bridge = (window as unknown as { awakon: PreloadBridge }).awakon;

const params = new URLSearchParams(window.location.search);
const sessionId = params.get('sessionId') as SessionId | null;
const shell = (params.get('shell') ?? 'pwsh') as Shell;
const cwd = params.get('cwd') ?? '~';
if (!sessionId) throw new Error('terminal-host.html opened without ?sessionId=...');

const splits = new SplitContainer({
  rootEl: container,
  bridge,
  initialSessionId: sessionId,
  shell,
  cwd,
});

// Expose for keyboard / split shortcuts.
(window as unknown as { __awakonSplits: SplitContainer }).__awakonSplits = splits;

void splits.loadSavedLayout();

bridge.on(IpcChannel.TerminalAction, (raw) => {
  const e = raw as { action: 'splitHorizontal' | 'splitVertical' | 'closePane' };
  if (e.action === 'splitHorizontal') void splits.splitFocused('horizontal');
  else if (e.action === 'splitVertical') void splits.splitFocused('vertical');
  else if (e.action === 'closePane') splits.closeFocusedPane();
});

// Main targets this event at the promoted tab's own webContents only (index.ts's
// reparentTab), so every LayoutTabReparented this view receives is always about its
// own tab — no need to track/compare oldTabId here; SplitContainer already owns the
// current tabId (retarget() updates it in place).
bridge.on(IpcChannel.LayoutTabReparented, (raw) => {
  const e = raw as { newTabId: SessionId };
  splits.retarget(e.newTabId);
});

console.info('[terminal] split container mounted; primary session', sessionId);
