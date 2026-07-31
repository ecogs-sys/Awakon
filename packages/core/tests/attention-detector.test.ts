import { describe, expect, it, vi } from 'vitest';
import { AttentionDetector } from '../src/attention-detector.js';
import type { AttentionEvent } from '@awakon/contracts';

function collect(d: AttentionDetector): AttentionEvent[] {
  const out: AttentionEvent[] = [];
  d.on('attention', (ev) => out.push(ev));
  return out;
}

describe('AttentionDetector', () => {
  it('emits bell for a single BEL byte', () => {
    const d = new AttentionDetector();
    const events = collect(d);
    d.process(Buffer.from([0x07]));
    expect(events).toHaveLength(1);
    expect(events[0]?.signal).toBe('bell');
    expect(events[0]?.confidence).toBe(1);
  });

  it('emits bell for each of multiple BELs in one chunk', () => {
    const d = new AttentionDetector();
    const events = collect(d);
    d.process(Buffer.from([0x07, 0x41, 0x07, 0x42, 0x07]));
    expect(events.filter((e) => e.signal === 'bell')).toHaveLength(3);
  });

  it('does not emit bell on non-BEL bytes', () => {
    const d = new AttentionDetector();
    const events = collect(d);
    d.process(Buffer.from('hello world'));
    expect(events).toHaveLength(0);
  });

  it('emits osc for a complete OSC sequence and not bell for its terminator', () => {
    const d = new AttentionDetector();
    const events = collect(d);
    d.process(Buffer.from('\x1b]1337;awakonAttention=needs-input\x07'));
    expect(events).toHaveLength(1);
    expect(events[0]?.signal).toBe('osc');
    expect(events[0]?.snippet).toBe('needs-input');
  });

  it('handles OSC split across multiple chunks', () => {
    const d = new AttentionDetector();
    const events = collect(d);
    d.process(Buffer.from('\x1b]1337;awakon'));
    d.process(Buffer.from('Attention=split-payload'));
    d.process(Buffer.from('\x07'));
    expect(events).toHaveLength(1);
    expect(events[0]?.signal).toBe('osc');
    expect(events[0]?.snippet).toBe('split-payload');
  });

  it('treats BEL outside OSC and BEL inside OSC differently', () => {
    const d = new AttentionDetector();
    const events = collect(d);
    // bell, then OSC (which ends with bell), then bell
    d.process(Buffer.from('\x07\x1b]1337;awakonAttention=mid\x07\x07'));
    expect(events.map((e) => e.signal)).toEqual(['bell', 'osc', 'bell']);
  });

  it('does not treat a foreign OSC sequence\'s own terminator as a bell (A4-I2)', () => {
    const d = new AttentionDetector();
    const events = collect(d);
    // \x1b]999;other\x07 starts like an OSC (ESC ]) but diverges from our prefix at
    // "999" — it's some OTHER program's OSC sequence, and its terminating BEL belongs
    // to that sequence, not to the terminal's audible-bell channel.
    d.process(Buffer.from('\x1b]999;other\x07'));
    expect(events).toHaveLength(0);
  });

  it('does not mistake a shell window-title OSC\'s BEL terminator for a real bell (A4-I2)', () => {
    const d = new AttentionDetector();
    const events = collect(d);
    // A very common real-world case: `ESC]0;title BEL` sets the window title.
    d.process(Buffer.from('\x1b]0;my-shell-title\x07'));
    expect(events).toHaveLength(0);
  });

  it('still detects a real bell that follows a foreign OSC sequence', () => {
    const d = new AttentionDetector();
    const events = collect(d);
    d.process(Buffer.from('\x1b]0;title\x07\x07'));
    expect(events.map((e) => e.signal)).toEqual(['bell']);
  });

  it('cap OSC payload length to prevent runaway buffering', () => {
    const d = new AttentionDetector();
    const events = collect(d);
    const big = 'x'.repeat(2048);
    d.process(Buffer.from(`\x1b]1337;awakonAttention=${big}\x07`));
    expect(events).toHaveLength(1);
    expect(events[0]?.snippet?.length).toBeLessThanOrEqual(1024);
  });

  it('emits events with a millisecond timestamp', () => {
    const d = new AttentionDetector();
    const events = collect(d);
    const before = Date.now();
    d.process(Buffer.from([0x07]));
    const after = Date.now();
    expect(events[0]?.timestamp).toBeGreaterThanOrEqual(before);
    expect(events[0]?.timestamp).toBeLessThanOrEqual(after);
  });

  it('does not emit any signal for empty input', () => {
    const d = new AttentionDetector();
    const events = collect(d);
    d.process(Buffer.alloc(0));
    expect(events).toHaveLength(0);
  });

  it('processes chunks in order and preserves OSC state across many small writes', () => {
    const d = new AttentionDetector();
    const events = collect(d);
    const seq = '\x1b]1337;awakonAttention=hello\x07';
    for (const byte of Buffer.from(seq)) {
      d.process(Buffer.from([byte]));
    }
    expect(events).toHaveLength(1);
    expect(events[0]?.signal).toBe('osc');
    expect(events[0]?.snippet).toBe('hello');
  });

  it('does not retain state across detector instances', () => {
    const dA = new AttentionDetector();
    const dB = new AttentionDetector();
    const eA = collect(dA);
    const eB = collect(dB);
    dA.process(Buffer.from('\x1b]1337;awakonAttention=incomplete'));
    dB.process(Buffer.from([0x07]));
    expect(eA).toHaveLength(0); // OSC not terminated
    expect(eB).toHaveLength(1); // plain BEL on independent detector
    expect(eB[0]?.signal).toBe('bell');
  });

  it('emits idle when output ends in a prompt and timer expires', async () => {
    vi.useFakeTimers();
    try {
      const d = new AttentionDetector();
      const events = collect(d);
      d.process(Buffer.from('PS C:\\Users\\me> '));
      vi.advanceTimersByTime(1600);
      expect(events.some((e) => e.signal === 'idle')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not emit idle when the tail is not prompt-like', async () => {
    vi.useFakeTimers();
    try {
      const d = new AttentionDetector();
      const events = collect(d);
      d.process(Buffer.from('Running tests...\nstill running'));
      vi.advanceTimersByTime(2000);
      expect(events.some((e) => e.signal === 'idle')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the idle timer on new output', () => {
    vi.useFakeTimers();
    try {
      const d = new AttentionDetector();
      const events = collect(d);
      d.process(Buffer.from('PS> '));
      vi.advanceTimersByTime(1000);
      d.process(Buffer.from('running...'));
      vi.advanceTimersByTime(1000);
      expect(events.some((e) => e.signal === 'idle')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('only emits one idle per quiet window', () => {
    vi.useFakeTimers();
    try {
      const d = new AttentionDetector();
      const events = collect(d);
      d.process(Buffer.from('$ '));
      vi.advanceTimersByTime(5000);
      const idles = events.filter((e) => e.signal === 'idle');
      expect(idles).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-arms after new output then quiet again', () => {
    vi.useFakeTimers();
    try {
      const d = new AttentionDetector();
      const events = collect(d);
      d.process(Buffer.from('% '));
      vi.advanceTimersByTime(1600);
      d.process(Buffer.from('result\n# '));
      vi.advanceTimersByTime(1600);
      const idles = events.filter((e) => e.signal === 'idle');
      expect(idles).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('dispose() clears a pending idle timer so no idle fires afterwards', () => {
    vi.useFakeTimers();
    try {
      const d = new AttentionDetector();
      const events = collect(d);
      d.process(Buffer.from('PS> '));
      d.dispose();
      vi.advanceTimersByTime(5000);
      expect(events.some((e) => e.signal === 'idle')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits idle for a colorized prompt whose reset code sits after the prompt char (A4-I1)', () => {
    vi.useFakeTimers();
    try {
      const d = new AttentionDetector();
      const events = collect(d);
      // The trailing "\x1b[0m" reset code after "$" would defeat a raw \s*$ match
      // against the un-stripped byte stream even though "$ " is what's on screen.
      d.process(Buffer.from('\x1b[32m$\x1b[0m '));
      vi.advanceTimersByTime(1600);
      const idle = events.find((e) => e.signal === 'idle');
      expect(idle).toBeDefined();
      expect(idle?.snippet).toBe('$ ');
    } finally {
      vi.useRealTimers();
    }
  });

  it('idle signal has confidence 0.7 and snippet contains the prompt', () => {
    vi.useFakeTimers();
    try {
      const d = new AttentionDetector();
      const events = collect(d);
      d.process(Buffer.from('PS> '));
      vi.advanceTimersByTime(1600);
      const idle = events.find((e) => e.signal === 'idle');
      expect(idle?.confidence).toBe(0.7);
      expect(idle?.snippet).toMatch(/PS> $/);
    } finally {
      vi.useRealTimers();
    }
  });
});
