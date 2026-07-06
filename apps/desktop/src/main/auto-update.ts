import { app } from 'electron';

/**
 * Wire auto-update against GitHub Releases. Quiet behavior: check on startup, download in
 * background, prompt user only when an update is ready to install.
 *
 * electron-updater is lazy-imported so that its module-load side-effects (network probes,
 * native-addon loads, etc.) never execute in the unpackaged dev / Playwright context.
 */
export async function setupAutoUpdate(): Promise<void> {
  if (!app.isPackaged) return; // skip in dev / Playwright
  // A Store (MSIX) build is packaged too, but Store policy prohibits self-updating
  // from outside the Store, and it can't work anyway — MSIX installs to the
  // read-only WindowsApps directory. Electron sets process.windowsStore when
  // running inside an AppX/MSIX container.
  if (process.windowsStore) return;
  const { autoUpdater } = await import('electron-updater');
  // A1-I1: pin the channel and forbid prerelease consumption explicitly — without
  // this, electron-updater falls back to whatever channel matches the current
  // version's pre-release tag, which would silently start serving a beta/rc build to
  // production users if one were ever published to the same GitHub repo.
  autoUpdater.channel = 'latest';
  autoUpdater.allowPrerelease = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // Gated download: checking for an update and downloading it are separate steps
  // (autoDownload = false) so there is an explicit decision point between "an update
  // exists" and "start pulling it over the network" rather than an implicit
  // background download the instant checkForUpdates() resolves.
  autoUpdater.autoDownload = false;

  autoUpdater.on('error', (err) => console.warn('[auto-update] error:', err));
  autoUpdater.on('update-available', (info) => {
    console.info('[auto-update] available:', info.version);
    void autoUpdater.downloadUpdate();
  });
  autoUpdater.on('update-downloaded', () => console.info('[auto-update] downloaded; will install on quit'));

  void autoUpdater.checkForUpdates();
}
