import { IpcChannel } from '@awakon/contracts';
import { exposeScopedBridge, type Bridge } from './shared.js';

/** Channels a terminal view (one per tab, hosting its own panes) may invoke. Scoped
 * so a terminal renderer cannot reach chrome-only or cross-session handlers (M2) —
 * notably it has no SessionCreate (only SessionCreateForPane, which main scopes to
 * the caller's own tabId) and no FsReadFile/SettingsUpdate. */
const SEND_CHANNELS = [
  IpcChannel.SessionCreateForPane,
  IpcChannel.SessionClose,
  IpcChannel.SessionWrite,
  IpcChannel.SessionResize,
  IpcChannel.SessionReplay,
  IpcChannel.DocOpen,
  IpcChannel.ChromeOpenExternal,
  IpcChannel.LayoutPersistSplits,
  IpcChannel.LayoutSplitsForTab,
] as const;

/** Events a terminal view subscribes to. */
const LISTEN_CHANNELS = [
  IpcChannel.SessionData,
  IpcChannel.SessionExited,
  IpcChannel.TerminalAction,
  IpcChannel.LayoutTabReparented,
] as const;

exposeScopedBridge(SEND_CHANNELS, LISTEN_CHANNELS);
declare global { interface Window { awakon: Bridge } }
