import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { parseResetTime } from '../src/reset-time-parser.js';

describe('parseResetTime', () => {
  it('parses a clock time with an IANA timezone', () => {
    const now = DateTime.fromObject(
      { year: 2026, month: 5, day: 20, hour: 12, minute: 0 },
      { zone: 'Pacific/Auckland' },
    ).toJSDate();
    const ms = parseResetTime("You've hit your limit · resets 9:30pm (Pacific/Auckland)", now);
    expect(ms).not.toBeNull();
    const dt = DateTime.fromMillis(ms!, { zone: 'Pacific/Auckland' });
    expect(dt.hour).toBe(21);
    expect(dt.minute).toBe(30);
    expect(dt.day).toBe(20); // 9:30pm today, still in the future
  });

  it('rolls to the next day when the time has already passed', () => {
    const now = DateTime.fromObject(
      { year: 2026, month: 5, day: 20, hour: 23, minute: 0 },
      { zone: 'Pacific/Auckland' },
    ).toJSDate();
    const ms = parseResetTime('resets 9:30am (Pacific/Auckland)', now);
    expect(ms).not.toBeNull();
    const dt = DateTime.fromMillis(ms!, { zone: 'Pacific/Auckland' });
    expect(dt.day).toBe(21);
    expect(dt.hour).toBe(9);
    expect(dt.minute).toBe(30);
  });

  it('uses the system local timezone when none is given', () => {
    const now = new Date(2026, 4, 20, 1, 0, 0); // local 01:00
    const ms = parseResetTime('resets 3pm', now);
    expect(ms).not.toBeNull();
    expect(new Date(ms!).getHours()).toBe(15);
    expect(ms!).toBeGreaterThan(now.getTime());
  });

  it('parses an upper-case "11:00 AM" form', () => {
    const now = new Date(2026, 4, 20, 6, 0, 0);
    const ms = parseResetTime('resets 11:00 AM', now);
    expect(new Date(ms!).getHours()).toBe(11);
  });

  it('handles a reset time across a DST spring-forward boundary', () => {
    // 2026-03-08: America/New_York springs forward (02:00 -> 03:00 EST->EDT).
    // 'now' is 23:30 on 2026-03-08 (already EDT); reset '9:30am' must roll to
    // the next day and resolve to a valid 09:30 wall-clock instant in that zone.
    const now = DateTime.fromObject(
      { year: 2026, month: 3, day: 8, hour: 23, minute: 30 },
      { zone: 'America/New_York' },
    ).toJSDate();
    const ms = parseResetTime('resets 9:30am (America/New_York)', now);
    expect(ms).not.toBeNull();
    const dt = DateTime.fromMillis(ms!, { zone: 'America/New_York' });
    expect(dt.day).toBe(9);
    expect(dt.hour).toBe(9);
    expect(dt.minute).toBe(30);
    expect(ms!).toBeGreaterThan(now.getTime());
  });

  it('falls back to local time when the timezone is unknown', () => {
    const now = new Date(2026, 4, 20, 1, 0, 0);
    const ms = parseResetTime('resets 3pm (Not/AZone)', now);
    expect(ms).not.toBeNull();
    expect(new Date(ms!).getHours()).toBe(15);
  });

  it('returns null when no clock time is present', () => {
    expect(parseResetTime('You have plenty of quota left', new Date())).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(parseResetTime('25:99 xx', new Date())).toBeNull();
  });

  // --- A4-I3/I4: 24h clock, anchoring to "resets", iterating candidates ---

  it('parses a 24-hour clock time (A4-I3)', () => {
    const now = new Date(2026, 4, 20, 6, 0, 0);
    const ms = parseResetTime('resets 21:30 (Pacific/Auckland)', now);
    expect(ms).not.toBeNull();
    const dt = DateTime.fromMillis(ms!, { zone: 'Pacific/Auckland' });
    expect(dt.hour).toBe(21);
    expect(dt.minute).toBe(30);
  });

  it('rolls a 24-hour time to the next day once it has passed', () => {
    const now = new Date(2026, 4, 20, 23, 0, 0);
    const ms = parseResetTime('resets 09:15', now);
    expect(new Date(ms!).getHours()).toBe(9);
    expect(new Date(ms!).getMinutes()).toBe(15);
    expect(ms!).toBeGreaterThan(now.getTime());
  });

  it('prefers the clock time nearest "resets" over an unrelated timestamp elsewhere in the window (A4-I4)', () => {
    const now = new Date(2026, 4, 20, 6, 0, 0);
    // An unrelated status timestamp (11:45am) appears well before the actual
    // "resets HH:MM" header — the old first-match behavior would have locked onto it.
    const text = 'last synced 11:45am · some filler text here padding the window out '
      + '· You\'ve hit your limit · resets 9:30pm (Pacific/Auckland)';
    const ms = parseResetTime(text, now);
    const dt = DateTime.fromMillis(ms!, { zone: 'Pacific/Auckland' });
    expect(dt.hour).toBe(21);
    expect(dt.minute).toBe(30);
  });

  it('skips an invalid candidate and finds the next valid one instead of giving up (A4-I3)', () => {
    const now = new Date(2026, 4, 20, 6, 0, 0);
    // "25:99" is not a valid clock time; the parser must keep scanning rather than
    // returning null just because the first-encountered candidate was garbage.
    const ms = parseResetTime('resets 25:99, actually resets 3pm', now);
    expect(ms).not.toBeNull();
    expect(new Date(ms!).getHours()).toBe(15);
  });

  it('falls back to the first valid candidate when "resets" is not present in the text', () => {
    const now = new Date(2026, 4, 20, 6, 0, 0);
    const ms = parseResetTime('your session limit refreshes at 3pm', now);
    expect(ms).not.toBeNull();
    expect(new Date(ms!).getHours()).toBe(15);
  });
});
