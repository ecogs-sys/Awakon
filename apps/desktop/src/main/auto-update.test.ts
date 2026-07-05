import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const appState = { isPackaged: true };

vi.mock('electron', () => ({
  app: appState,
}));

const autoUpdaterMock = {
  autoDownload: false,
  autoInstallOnAppQuit: false,
  on: vi.fn(),
  checkForUpdates: vi.fn(),
};

vi.mock('electron-updater', () => ({
  autoUpdater: autoUpdaterMock,
}));

const { setupAutoUpdate } = await import('./auto-update.js');

describe('setupAutoUpdate', () => {
  beforeEach(() => {
    appState.isPackaged = true;
    autoUpdaterMock.checkForUpdates.mockClear();
  });

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
});
