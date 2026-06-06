import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerFsHandlers, type IpcLike, type DialogLike } from './fs-handlers.js';

interface RegisteredHandler {
  (event: unknown, payload: unknown): Promise<unknown>;
}

function makeFakeIpc(): { ipc: IpcLike; handlers: Map<string, RegisteredHandler> } {
  const handlers = new Map<string, RegisteredHandler>();
  const ipc: IpcLike = {
    handle: (channel, handler) => { handlers.set(channel, handler as RegisteredHandler); },
  };
  return { ipc, handlers };
}

describe('FsPathExists handler', () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fs-handlers-'));
    tempFile = join(tempDir, 'file.txt');
    await writeFile(tempFile, 'hi');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns exists+isDirectory for a real directory', async () => {
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => null, {} as DialogLike);
    const result = await handlers.get('core.fs.path-exists')!({}, { path: tempDir });
    expect(result).toEqual({ exists: true, isDirectory: true });
  });

  it('returns exists but not directory for a real file', async () => {
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => null, {} as DialogLike);
    const result = await handlers.get('core.fs.path-exists')!({}, { path: tempFile });
    expect(result).toEqual({ exists: true, isDirectory: false });
  });

  it('returns exists=false for a missing path', async () => {
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => null, {} as DialogLike);
    const result = await handlers.get('core.fs.path-exists')!({}, { path: join(tempDir, 'nope') });
    expect(result).toEqual({ exists: false, isDirectory: false });
  });

  it('returns exists=false for an empty string payload', async () => {
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => null, {} as DialogLike);
    const result = await handlers.get('core.fs.path-exists')!({}, { path: '' });
    expect(result).toEqual({ exists: false, isDirectory: false });
  });

  it('returns exists=false for a malformed payload', async () => {
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => null, {} as DialogLike);
    const result = await handlers.get('core.fs.path-exists')!({}, { wrong: 'shape' });
    expect(result).toEqual({ exists: false, isDirectory: false });
  });
});

describe('FsPickDirectory handler', () => {
  it('returns { path } when the user picks a directory', async () => {
    const showOpenDialog = vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/picked'] });
    const dialog: DialogLike = { showOpenDialog };
    const fakeWindow = {} as Electron.BrowserWindow;
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => fakeWindow, dialog);

    const result = await handlers.get('core.fs.pick-directory')!({}, { startPath: '/start' });

    expect(result).toEqual({ path: '/picked' });
    expect(showOpenDialog).toHaveBeenCalledWith(fakeWindow, {
      properties: ['openDirectory'],
      defaultPath: '/start',
    });
  });

  it('omits defaultPath when startPath is absent', async () => {
    const showOpenDialog = vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/picked'] });
    const dialog: DialogLike = { showOpenDialog };
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => ({} as Electron.BrowserWindow), dialog);

    await handlers.get('core.fs.pick-directory')!({}, {});

    expect(showOpenDialog).toHaveBeenCalledWith(expect.anything(), {
      properties: ['openDirectory'],
    });
  });

  it('returns { cancelled: true } when the user cancels', async () => {
    const dialog: DialogLike = {
      showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
    };
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => ({} as Electron.BrowserWindow), dialog);
    const result = await handlers.get('core.fs.pick-directory')!({}, {});
    expect(result).toEqual({ cancelled: true });
  });

  it('returns { cancelled: true } when no window is available', async () => {
    const dialog: DialogLike = { showOpenDialog: vi.fn() };
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => null, dialog);
    const result = await handlers.get('core.fs.pick-directory')!({}, {});
    expect(result).toEqual({ cancelled: true });
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
  });

  it('returns { cancelled: true } when the payload is malformed', async () => {
    const dialog: DialogLike = { showOpenDialog: vi.fn() };
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => ({} as Electron.BrowserWindow), dialog);
    const result = await handlers.get('core.fs.pick-directory')!({}, { startPath: 5 });
    expect(result).toEqual({ cancelled: true });
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
  });
});

describe('FsReadFile handler', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fs-read-'));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns content + stat for a real .md file', async () => {
    const md = join(tempDir, 'doc.md');
    await writeFile(md, '# Title');
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => null, {} as DialogLike);
    const result = await handlers.get('core.fs.read-file')!({}, { path: md }) as { content: string; sizeBytes: number };
    expect(result.content).toBe('# Title');
    expect(result.sizeBytes).toBe(7);
  });

  it('returns notFound for a missing file', async () => {
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => null, {} as DialogLike);
    const result = await handlers.get('core.fs.read-file')!({}, { path: join(tempDir, 'nope.md') });
    expect(result).toEqual({ notFound: true });
  });

  it('rejects a non-.md file with an error', async () => {
    const txt = join(tempDir, 'notes.txt');
    await writeFile(txt, 'hi');
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => null, {} as DialogLike);
    const result = await handlers.get('core.fs.read-file')!({}, { path: txt }) as { error: string };
    expect(result.error).toMatch(/\.md/);
  });

  it('returns tooLarge for a file over 1 MB', async () => {
    const big = join(tempDir, 'big.md');
    await writeFile(big, 'x'.repeat(1_048_577));
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => null, {} as DialogLike);
    const result = await handlers.get('core.fs.read-file')!({}, { path: big }) as { tooLarge: true; sizeBytes: number };
    expect(result.tooLarge).toBe(true);
    expect(result.sizeBytes).toBeGreaterThan(1_048_576);
  });

  it('returns an error for a malformed payload', async () => {
    const { ipc, handlers } = makeFakeIpc();
    registerFsHandlers(ipc, () => null, {} as DialogLike);
    const result = await handlers.get('core.fs.read-file')!({}, { wrong: 1 }) as { error: string };
    expect(typeof result.error).toBe('string');
  });
});
