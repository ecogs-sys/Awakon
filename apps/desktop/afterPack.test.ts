import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// afterPack.cjs is plain CommonJS (electron-builder loads it via require()), so it is
// exercised here against a real temp directory rather than mocked fs — dynamic import()
// of a .cjs file goes through Node's native CJS loader, which vi.mock('fs') cannot hook.
const afterPackModule = await import('./afterPack.cjs');
const afterPack = afterPackModule.default;

function target(name: string) {
  return { name };
}

function contextFor(appOutDir: string, targetNames: string[]) {
  return {
    electronPlatformName: 'linux',
    targets: targetNames.map(target),
    appOutDir,
    packager: { executableName: 'awakon' },
  };
}

let appOutDir: string;
beforeEach(async () => {
  appOutDir = await mkdtemp(join(tmpdir(), 'afterpack-'));
  await writeFile(join(appOutDir, 'awakon'), 'binary-placeholder');
});
afterEach(async () => {
  await rm(appOutDir, { recursive: true, force: true });
});

describe('afterPack (N7)', () => {
  it('is a no-op on non-linux platforms', async () => {
    await afterPack({ ...contextFor(appOutDir, ['appImage']), electronPlatformName: 'darwin' });
    expect(existsSync(join(appOutDir, 'awakon.bin'))).toBe(false);
  });

  it('wraps the binary for an AppImage-only pack', async () => {
    await afterPack(contextFor(appOutDir, ['appImage']));
    expect(existsSync(join(appOutDir, 'awakon.bin'))).toBe(true);
    const wrapper = await readFile(join(appOutDir, 'awakon'), 'utf8');
    expect(wrapper).toContain('--no-sandbox');
  });

  it('wraps the binary for a --dir-only pack (N7 regression)', async () => {
    await afterPack(contextFor(appOutDir, ['dir']));
    expect(existsSync(join(appOutDir, 'awakon.bin'))).toBe(true);
    const wrapper = await readFile(join(appOutDir, 'awakon'), 'utf8');
    expect(wrapper).toContain('--no-sandbox');
  });

  it('does not wrap a deb-only pack', async () => {
    await afterPack(contextFor(appOutDir, ['deb']));
    expect(existsSync(join(appOutDir, 'awakon.bin'))).toBe(false);
    const st = await stat(join(appOutDir, 'awakon'));
    expect(st.isFile()).toBe(true); // untouched, not renamed
  });

  it('throws instead of silently skipping when appImage and deb are combined in one pack (N7)', async () => {
    await expect(afterPack(contextFor(appOutDir, ['appImage', 'deb']))).rejects.toThrow(/separate electron-builder invocations/);
    expect(existsSync(join(appOutDir, 'awakon.bin'))).toBe(false);
  });

  it('throws when dir and deb are combined in one pack (N7)', async () => {
    await expect(afterPack(contextFor(appOutDir, ['dir', 'deb']))).rejects.toThrow(/separate electron-builder invocations/);
    expect(existsSync(join(appOutDir, 'awakon.bin'))).toBe(false);
  });
});
