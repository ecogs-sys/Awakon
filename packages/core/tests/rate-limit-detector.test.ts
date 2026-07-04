import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@awakon/contracts';
import { RateLimitDetector } from '../src/rate-limit-detector.js';

const PHRASE = "You've hit your limit";

/** A realistic frame of Claude Code's rate-limit menu, as captured from a real
 * session's PTY output (ANSI stripped for readability). */
const CLAUDE_MENU =
  'What do you want to do?\n' +
  '❯ 1. Stop and wait for limit to reset\n' +
  '  2. Upgrade your plan\n' +
  '\n  Enter to confirm · Esc to cancel\n';

function collect(detector: RateLimitDetector): string[] {
  const out: string[] = [];
  detector.on('rateLimitDetected', (resetText) => out.push(resetText));
  return out;
}

describe('RateLimitDetector', () => {
  it('emits once when the phrase appears, with trailing context', () => {
    const d = new RateLimitDetector(PHRASE);
    const events = collect(d);
    d.process(Buffer.from(`${PHRASE} · resets 9:30pm (Pacific/Auckland)\n`, 'utf8'));
    expect(events).toHaveLength(1);
    expect(events[0]).toContain('resets 9:30pm');
  });

  it('detects a phrase split across two chunks', () => {
    const d = new RateLimitDetector(PHRASE);
    const events = collect(d);
    d.process(Buffer.from("You've hit ", 'utf8'));
    d.process(Buffer.from('your limit · resets 3pm\n', 'utf8'));
    expect(events).toHaveLength(1);
  });

  it('detects the phrase when ANSI colour codes are interspersed', () => {
    const d = new RateLimitDetector(PHRASE);
    const events = collect(d);
    d.process(Buffer.from(`\x1b[31m${PHRASE}\x1b[0m · resets 8am\n`, 'utf8'));
    expect(events).toHaveLength(1);
  });

  it('does not re-emit while the phrase stays on screen', () => {
    const d = new RateLimitDetector(PHRASE);
    const events = collect(d);
    d.process(Buffer.from(`${PHRASE} · resets 8am\n`, 'utf8'));
    d.process(Buffer.from(`${PHRASE} still here\n`, 'utf8'));
    expect(events).toHaveLength(1);
  });

  it('re-emits after the phrase scrolls out of the window and reappears', () => {
    const d = new RateLimitDetector(PHRASE);
    const events = collect(d);
    d.process(Buffer.from(`${PHRASE} · resets 8am\n`, 'utf8'));
    d.process(Buffer.from('x'.repeat(5000), 'utf8')); // evicts the phrase
    d.process(Buffer.from(`${PHRASE} · resets 9am\n`, 'utf8'));
    expect(events).toHaveLength(2);
  });

  it('emits nothing when detectText is empty', () => {
    const d = new RateLimitDetector('');
    const events = collect(d);
    d.process(Buffer.from(`${PHRASE} · resets 8am\n`, 'utf8'));
    expect(events).toHaveLength(0);
  });

  it("fires on Claude's real rate-limit menu using the shipped default phrase", () => {
    const d = new RateLimitDetector(DEFAULT_APP_SETTINGS.autoResume.detectText);
    const events = collect(d);
    d.process(Buffer.from(CLAUDE_MENU, 'utf8'));
    expect(events).toHaveLength(1);
  });

  it('re-arms after setDetectText so an on-screen phrase can trigger', () => {
    const d = new RateLimitDetector('');
    const events = collect(d);
    d.process(Buffer.from(`${PHRASE} · resets 8am\n`, 'utf8'));
    expect(events).toHaveLength(0);
    d.setDetectText(PHRASE);
    d.process(Buffer.from('more output\n', 'utf8'));
    expect(events).toHaveLength(1);
  });
});
