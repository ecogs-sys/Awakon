import { IpcChannel } from '@awakon/contracts';
import { exposeScopedBridge, type Bridge } from './shared.js';

/** Channels the chrome window (tab strip, sidebar, dialogs, titlebar) may invoke. */
export const SEND_CHANNELS = [
  IpcChannel.LayoutModal,
  IpcChannel.LayoutViewportSize,
  IpcChannel.LayoutDefaultCwd,
  IpcChannel.LayoutDefaultShell,
  IpcChannel.LayoutSetSidebarWidth,
  IpcChannel.LayoutReorderTabs,
  IpcChannel.LayoutPersistDocs,
  IpcChannel.LayoutDocsForTab,
  IpcChannel.SettingsGet,
  IpcChannel.SettingsUpdate,
  IpcChannel.RecentList,
  IpcChannel.RecentAdd,
  IpcChannel.SessionList,
  IpcChannel.SessionCreate,
  IpcChannel.SessionClose,
  IpcChannel.SessionSetTitle,
  IpcChannel.SessionRestartView,
  IpcChannel.FsPickDirectory,
  IpcChannel.FsPathExists,
  IpcChannel.FsReadFile,
  IpcChannel.ChromeOpenExternal,
  IpcChannel.ChromeAppInfo,
  IpcChannel.ChromeAppMenuPopup,
  IpcChannel.ChromeWindowControl,
  IpcChannel.ResumeCancel,
  IpcChannel.LayoutShow,
] as const;

/** Events the chrome window subscribes to. */
export const LISTEN_CHANNELS = [
  IpcChannel.SessionCreated,
  IpcChannel.SessionExited,
  IpcChannel.SessionAttention,
  IpcChannel.LayoutShow,
  IpcChannel.SessionTitleChanged,
  IpcChannel.SessionTabBroken,
  IpcChannel.ResumeScheduled,
  IpcChannel.ResumeCancelled,
  IpcChannel.ResumeFired,
  IpcChannel.SettingsChanged,
  IpcChannel.LayoutTabReparented,
  IpcChannel.DocOpenRequest,
  IpcChannel.ActionInvoke,
] as const;

exposeScopedBridge(SEND_CHANNELS, LISTEN_CHANNELS);
declare global { interface Window { awakon: Bridge } }
