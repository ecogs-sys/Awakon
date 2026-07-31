import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IpcChannel } from '@awakon/contracts';

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
}));

// Regression for R2: `bridge.send(IpcChannel.LayoutShow, …)` on every tab focus/switch
// (layout-manager.ts) was rejected because chrome's SEND_CHANNELS omitted it, breaking
// tab switching. C1: the two lists below used to be hand-copied and could drift silently
// (a renderer using a channel absent from both the allowlist and this copy would pass).
// Instead, scan the actual renderer sources for `.send(IpcChannel.X` / `.on(IpcChannel.X`
// — the same grep the old comment described, now enforced instead of just documented.

const here = dirname(fileURLToPath(import.meta.url));

/** Concatenated source of every non-test .ts file directly inside `dir`. */
function readSources(dir: string): string {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
}

/** IpcChannel values referenced as `<method>(IpcChannel.Key` anywhere in `source`. */
function channelsCalledWith(source: string, method: 'send' | 'on'): string[] {
  const re = new RegExp(`\\.${method}\\(IpcChannel\\.(\\w+)`, 'g');
  const keys = new Set<string>();
  for (const m of source.matchAll(re)) keys.add(m[1]!);
  return [...keys].map((key) => {
    const value = (IpcChannel as Record<string, string>)[key];
    if (!value) throw new Error(`IpcChannel.${key} referenced in a renderer but does not exist in contracts`);
    return value;
  });
}

const chromeSource = readSources(join(here, '../renderer/chrome'));
const terminalSource =
  readSources(join(here, '../renderer/terminal')) +
  readSources(join(here, '../../../../packages/terminal-host/src'));

describe('chrome preload allowlists', () => {
  it('SEND_CHANNELS is a superset of every channel the chrome renderer sends', async () => {
    const { SEND_CHANNELS } = await import('./chrome');
    for (const channel of channelsCalledWith(chromeSource, 'send')) {
      expect(SEND_CHANNELS, `missing ${channel}`).toContain(channel);
    }
  });

  it('LISTEN_CHANNELS is a superset of every channel the chrome renderer listens for', async () => {
    const { LISTEN_CHANNELS } = await import('./chrome');
    for (const channel of channelsCalledWith(chromeSource, 'on')) {
      expect(LISTEN_CHANNELS, `missing ${channel}`).toContain(channel);
    }
  });

  // A2-I2: the two tests above only ever check the superset direction — a channel
  // added to an allowlist that the chrome renderer never actually calls (e.g. a
  // terminal-only channel like FsReadFile mistakenly also granted to the OTHER side)
  // would pass silently forever. Assert the reverse too: every allowlisted channel is
  // actually used somewhere in this renderer's own source.
  it('SEND_CHANNELS contains no channel the chrome renderer does not actually send', async () => {
    const { SEND_CHANNELS } = await import('./chrome');
    const used = channelsCalledWith(chromeSource, 'send');
    for (const channel of SEND_CHANNELS) {
      expect(used, `${channel} is allowlisted but never sent by the chrome renderer`).toContain(channel);
    }
  });

  it('LISTEN_CHANNELS contains no channel the chrome renderer does not actually listen for', async () => {
    const { LISTEN_CHANNELS } = await import('./chrome');
    const used = channelsCalledWith(chromeSource, 'on');
    for (const channel of LISTEN_CHANNELS) {
      expect(used, `${channel} is allowlisted but never listened for by the chrome renderer`).toContain(channel);
    }
  });
});

describe('terminal preload allowlists', () => {
  it('SEND_CHANNELS is a superset of every channel the terminal renderer (+ terminal-host) sends', async () => {
    const { SEND_CHANNELS } = await import('./terminal');
    for (const channel of channelsCalledWith(terminalSource, 'send')) {
      expect(SEND_CHANNELS, `missing ${channel}`).toContain(channel);
    }
  });

  it('LISTEN_CHANNELS is a superset of every channel the terminal renderer (+ terminal-host) listens for', async () => {
    const { LISTEN_CHANNELS } = await import('./terminal');
    for (const channel of channelsCalledWith(terminalSource, 'on')) {
      expect(LISTEN_CHANNELS, `missing ${channel}`).toContain(channel);
    }
  });

  // A2-I2: exclusion direction — a scoped-bridge test that would have caught
  // FsReadFile (or SettingsUpdate, SessionCreate, etc.) being added to the terminal's
  // SEND_CHANNELS by mistake, since the terminal renderer never actually calls it.
  it('SEND_CHANNELS contains no channel the terminal renderer/terminal-host does not actually send', async () => {
    const { SEND_CHANNELS } = await import('./terminal');
    const used = channelsCalledWith(terminalSource, 'send');
    for (const channel of SEND_CHANNELS) {
      expect(used, `${channel} is allowlisted but never sent by the terminal renderer`).toContain(channel);
    }
  });

  it('LISTEN_CHANNELS contains no channel the terminal renderer/terminal-host does not actually listen for', async () => {
    const { LISTEN_CHANNELS } = await import('./terminal');
    const used = channelsCalledWith(terminalSource, 'on');
    for (const channel of LISTEN_CHANNELS) {
      expect(used, `${channel} is allowlisted but never listened for by the terminal renderer`).toContain(channel);
    }
  });

  // Direct regression for the exact scenario the review called out: FsReadFile must
  // never be reachable from the terminal renderer's scoped bridge.
  it('never allowlists chrome-only channels (FsReadFile, SettingsUpdate, SessionCreate) on the terminal side', async () => {
    const { SEND_CHANNELS } = await import('./terminal');
    expect(SEND_CHANNELS).not.toContain(IpcChannel.FsReadFile);
    expect(SEND_CHANNELS).not.toContain(IpcChannel.SettingsUpdate);
    expect(SEND_CHANNELS).not.toContain(IpcChannel.SessionCreate);
  });
});
