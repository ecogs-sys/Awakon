import { describe, expect, it, vi } from 'vitest';
import { ShellIntegrationDetector, parseFileUri } from '../src/shell-integration-detector.js';

function collect(d: ShellIntegrationDetector) {
  const events: Array<[string, unknown]> = [];
  d.on('commandStart', (c) => events.push(['commandStart', c]));
  d.on('commandEnd', (e) => events.push(['commandEnd', e]));
  d.on('cwdChanged', (p) => events.push(['cwdChanged', p]));
  d.on('promptStart', () => events.push(['promptStart', undefined]));
  return events;
}

const feed = (d: ShellIntegrationDetector, s: string): void => d.process(Buffer.from(s, 'utf8'));

describe('ShellIntegrationDetector', () => {
  it('reports a prompt start', () => {
    const d = new ShellIntegrationDetector();
    const events = collect(d);
    feed(d, '\x1b]133;A\x07');
    expect(events).toEqual([['promptStart', undefined]]);
  });

  it('reports a submitted command line', () => {
    const d = new ShellIntegrationDetector();
    const events = collect(d);
    feed(d, '\x1b]1337;awakonCommand=git status\x07');
    expect(events).toEqual([['commandStart', 'git status']]);
  });

  it('reports an exit code', () => {
    const d = new ShellIntegrationDetector();
    const events = collect(d);
    feed(d, '\x1b]133;D;0\x07\x1b]133;D;130\x07');
    expect(events).toEqual([['commandEnd', 0], ['commandEnd', 130]]);
  });

  it('reports null for a bare D with no exit code', () => {
    const d = new ShellIntegrationDetector();
    const events = collect(d);
    feed(d, '\x1b]133;D\x07');
    expect(events).toEqual([['commandEnd', null]]);
  });

  it('reports null for an unparseable exit code', () => {
    const d = new ShellIntegrationDetector();
    const events = collect(d);
    feed(d, '\x1b]133;D;oops\x07');
    expect(events).toEqual([['commandEnd', null]]);
  });

  it('decodes a cwd file URI', () => {
    const d = new ShellIntegrationDetector();
    const events = collect(d);
    feed(d, '\x1b]7;file:///C:/Work/Awakon\x07');
    expect(events).toEqual([['cwdChanged', 'C:\\Work\\Awakon']]);
  });

  // The emitter percent-encodes via .NET's AbsoluteUri; the parser must undo it, or a
  // path with a space silently becomes a different directory.
  it('percent-decodes a cwd containing spaces', () => {
    const d = new ShellIntegrationDetector();
    const events = collect(d);
    feed(d, '\x1b]7;file:///C:/My%20Projects/a%23b\x07');
    expect(events).toEqual([['cwdChanged', 'C:\\My Projects\\a#b']]);
  });

  // A PTY read can split a sequence at ANY byte. Matching within a chunk would miss
  // these entirely, which is the same hazard AttentionDetector handles.
  it('handles a marker split across chunk boundaries', () => {
    const d = new ShellIntegrationDetector();
    const events = collect(d);
    const whole = '\x1b]1337;awakonCommand=npm run build\x07';
    for (let split = 1; split < whole.length; split++) {
      events.length = 0;
      const fresh = new ShellIntegrationDetector();
      const e2 = collect(fresh);
      feed(fresh, whole.slice(0, split));
      feed(fresh, whole.slice(split));
      expect(e2, `split at ${split}`).toEqual([['commandStart', 'npm run build']]);
    }
  });

  it('handles ESC alone at a chunk boundary', () => {
    const d = new ShellIntegrationDetector();
    const events = collect(d);
    feed(d, '\x1b');
    feed(d, ']133;A\x07');
    expect(events).toEqual([['promptStart', undefined]]);
  });

  it('accepts ST (ESC backslash) as a terminator', () => {
    const d = new ShellIntegrationDetector();
    const events = collect(d);
    feed(d, '\x1b]133;A\x1b\\');
    expect(events).toEqual([['promptStart', undefined]]);
  });

  // The shell sets its window title constantly; those must not corrupt parser state.
  it('ignores unrelated OSC sequences', () => {
    const d = new ShellIntegrationDetector();
    const events = collect(d);
    feed(d, '\x1b]0;pwsh.exe\x07');
    feed(d, '\x1b]133;A\x07');
    expect(events).toEqual([['promptStart', undefined]]);
  });

  it('ignores ordinary terminal output and CSI sequences', () => {
    const d = new ShellIntegrationDetector();
    const events = collect(d);
    feed(d, 'hello \x1b[32mgreen\x1b[0m world\r\n');
    expect(events).toEqual([]);
  });

  it('abandons an over-long payload instead of growing without bound', () => {
    const d = new ShellIntegrationDetector();
    const events = collect(d);
    feed(d, '\x1b]1337;awakonCommand=' + 'x'.repeat(10_000) + '\x07');
    expect(events).toEqual([]);
    // Parser must still work afterwards.
    feed(d, '\x1b]133;A\x07');
    expect(events).toEqual([['promptStart', undefined]]);
  });

  it('parses a realistic prompt round trip', () => {
    const d = new ShellIntegrationDetector();
    const events = collect(d);
    feed(d, '\x1b]133;D;0\x07\x1b]133;A\x07\x1b]7;file:///C:/Work\x07PS C:\\Work> \x1b]133;B\x07');
    feed(d, '\x1b]133;C\x07\x1b]1337;awakonCommand=claude\x07');
    expect(events).toEqual([
      ['commandEnd', 0],
      ['promptStart', undefined],
      ['cwdChanged', 'C:\\Work'],
      ['commandStart', 'claude'],
    ]);
  });

  it('drops listeners on dispose', () => {
    const d = new ShellIntegrationDetector();
    const spy = vi.fn();
    d.on('promptStart', spy);
    d.dispose();
    feed(d, '\x1b]133;A\x07');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('parseFileUri()', () => {
  it('returns null for a non-file URI', () => {
    expect(parseFileUri('http://example.com/x')).toBeNull();
  });

  it('returns null for malformed percent-encoding', () => {
    expect(parseFileUri('file:///C:/%ZZ')).toBeNull();
  });

  it('keeps POSIX paths as-is', () => {
    expect(parseFileUri('file:///home/dines/work')).toBe('/home/dines/work');
  });
});
