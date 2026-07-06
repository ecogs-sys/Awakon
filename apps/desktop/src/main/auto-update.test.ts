import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const appState = { isPackaged: true };

vi.mock('electron', () => ({
  app: appState,
}));

const autoUpdaterMock = {
  autoDownload: false,
  autoInstallOnAppQuit: false,
  channel: undefined as string | undefined,
  allowPrerelease: undefined as boolean | undefined,
  on: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
};

vi.mock('electron-updater', () => ({
  autoUpdater: autoUpdaterMock,
}));

const { setupAutoUpdate } = await import('./auto-update.js');

describe('setupAutoUpdate', () => {
  beforeEach(() => {
    appState.isPackaged = true;
    autoUpdaterMock.checkForUpdates.mockClear();
    autoUpdaterMock.downloadUpdate.mockClear();
    autoUpdaterMock.on.mockClear();
    autoUpdaterMock.channel = undefined;
    autoUpdaterMock.allowPrerelease = undefined;
  });

  function handlerFor(event: string): ((...args: unknown[]) => void) | undefined {
    const call = autoUpdaterMock.on.mock.calls.find((c) => c[0] === event);
    return call?.[1] as ((...args: unknown[]) => void) | undefined;
  }

  afterEach(() => {
    delete (process as unknown as { windowsStore?: boolean }).windowsStore;
  });

  it('skips wiring the updater when running inside an MSIX/Store container (B2)', async () => {
    // A Store submission is packaged, so isPackaged alone must not be the only gate —
    // Electron sets process.windowsStore when running inside an AppX/MSIX container,
    // and Store policy prohibits apps from self-updating outside the Store.
    (process as unknown as { windowsStore?: boolean }).windowsStore = true;

    await setupAutoUpdate();

    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();
  });

  it('still wires the updater for a packaged non-Store (NSIS) build', async () => {
    await setupAutoUpdate();

    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('pins the channel to "latest" and forbids prerelease consumption (A1-I1)', async () => {
    await setupAutoUpdate();

    expect(autoUpdaterMock.channel).toBe('latest');
    expect(autoUpdaterMock.allowPrerelease).toBe(false);
  });

  it('does not auto-download — checking and downloading are separate, gated steps (A1-I1)', async () => {
    await setupAutoUpdate();

    expect(autoUpdaterMock.autoDownload).toBe(false);
    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled();
  });

  it('downloads only after an update-available event fires', async () => {
    await setupAutoUpdate();

    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled();
    handlerFor('update-available')?.({ version: '9.9.9' });
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1);
  });
});
