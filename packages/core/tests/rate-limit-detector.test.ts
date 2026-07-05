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
    d.process(Buffer.from(`${PHRASE} · resets 9:30pm (Pacific/Auckland)\nEnter to confirm\n`, 'utf8'));
    expect(events).toHaveLength(1);
    expect(events[0]).toContain('resets 9:30pm');
  });

  it('detects a phrase split across two chunks', () => {
    const d = new RateLimitDetector(PHRASE);
    const events = collect(d);
    d.process(Buffer.from("You've hit ", 'utf8'));
    d.process(Buffer.from('your limit · resets 3pm\nEnter to confirm\n', 'utf8'));
    expect(events).toHaveLength(1);
  });

  it('detects the phrase when ANSI colour codes are interspersed', () => {
    const d = new RateLimitDetector(PHRASE);
    const events = collect(d);
    d.process(Buffer.from(`\x1b[31m${PHRASE}\x1b[0m · resets 8am\nEnter to confirm\n`, 'utf8'));
    expect(events).toHaveLength(1);
  });

  it('does not re-emit while the phrase stays on screen', () => {
    const d = new RateLimitDetector(PHRASE);
    const events = collect(d);
    d.process(Buffer.from(`${PHRASE} · resets 8am\nEnter to confirm\n`, 'utf8'));
    d.process(Buffer.from(`${PHRASE} still here\nEnter to confirm\n`, 'utf8'));
    expect(events).toHaveLength(1);
  });

  it('re-emits after the phrase scrolls out of the window and reappears', () => {
    const d = new RateLimitDetector(PHRASE);
    const events = collect(d);
    d.process(Buffer.from(`${PHRASE} · resets 8am\nEnter to confirm\n`, 'utf8'));
    d.process(Buffer.from('x'.repeat(5000), 'utf8')); // evicts the phrase
    d.process(Buffer.from(`${PHRASE} · resets 9am\nEnter to confirm\n`, 'utf8'));
    expect(events).toHaveLength(2);
  });

  it('does not emit when the phrase appears without menu chrome nearby (N11)', () => {
    const d = new RateLimitDetector(PHRASE);
    const events = collect(d);
    // e.g. a doc or transcript quoting the phrase, with no ❯/"Enter to confirm" nearby.
    d.process(Buffer.from(`Some review text mentions: "${PHRASE}" as an example.\n`, 'utf8'));
    expect(events).toHaveLength(0);
  });

  it('emits when the phrase is preceded by the ❯ selector glyph', () => {
    const d = new RateLimitDetector(PHRASE);
    const events = collect(d);
    d.process(Buffer.from(`❯ 1. ${PHRASE}\n  2. Upgrade your plan\n`, 'utf8'));
    expect(events).toHaveLength(1);
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

  it('captures the reset-time header that precedes the option-1 label by ~280 chars (M6 step 1)', () => {
    // Layout verified from a real IPC log: the "resets HH:MMam/pm (Zone)" header sits
    // well before the option-1 label, separated by status/ruler filler text.
    const header = "You've hit your session limit · resets 9:10pm (Pacific/Auckland)\n";
    const filler = '─'.repeat(150) + '\n' + 'some status text '.repeat(6) + '\n';
    const menu = 'What do you want to do?\n' + CLAUDE_MENU.split('\n').slice(1).join('\n');
    const d = new RateLimitDetector(DEFAULT_APP_SETTINGS.autoResume.detectText);
    const events = collect(d);
    d.process(Buffer.from(header + filler + menu, 'utf8'));
    expect(events).toHaveLength(1);
    expect(events[0]).toContain('resets 9:10pm (Pacific/Auckland)');
  });

  it('re-arms after setDetectText so an on-screen phrase can trigger', () => {
    const d = new RateLimitDetector('');
    const events = collect(d);
    d.process(Buffer.from(`${PHRASE} · resets 8am\nEnter to confirm\n`, 'utf8'));
    expect(events).toHaveLength(0);
    d.setDetectText(PHRASE);
    d.process(Buffer.from('more output\n', 'utf8'));
    expect(events).toHaveLength(1);
  });
});
