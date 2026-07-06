import { DateTime } from 'luxon';

/** 12-hour clock: "9:30pm", "3pm", "11:00 AM". */
const TIME_12H_RE = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\b/gi;
/** 24-hour clock: "21:30", "09:05" — the colon is required so a bare "9" (or a
 * 4-digit year like "2026") never matches. */
const TIME_24H_RE = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;

/** Matches an IANA timezone in parentheses, e.g. "(Pacific/Auckland)". */
const TZ_RE = /\(([A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+)\)/;

/** How many characters past the word "resets" a clock-time candidate may start and
 * still count as "near" it (A4-I4). The real header is a few words away — "resets
 * 9:10pm (Pacific/Auckland)" — while an unrelated status timestamp sitting elsewhere in
 * the captured window is not "the" reset time just because it happens to parse as one. */
const RESETS_PROXIMITY = 40;

interface Candidate {
  index: number;
  hour: number;
  minute: number;
}

function collect12h(text: string): Candidate[] {
  const out: Candidate[] = [];
  for (const m of text.matchAll(TIME_12H_RE)) {
    let hour = Number(m[1]);
    const minute = m[2] ? Number(m[2]) : 0;
    const meridiem = m[3]!.toLowerCase();
    if (hour < 1 || hour > 12 || minute > 59) continue;
    if (hour === 12) hour = 0;
    if (meridiem === 'p') hour += 12;
    out.push({ index: m.index!, hour, minute });
  }
  return out;
}

function collect24h(text: string): Candidate[] {
  const out: Candidate[] = [];
  for (const m of text.matchAll(TIME_24H_RE)) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour > 23 || minute > 59) continue;
    out.push({ index: m.index!, hour, minute });
  }
  return out;
}

/**
 * Find a clock time (and optional IANA timezone) in `text` and return the next
 * future occurrence of it, as epoch milliseconds, relative to `now`.
 *
 * Scans every 12-hour and 24-hour clock-time candidate in the text (not just the
 * first) and prefers whichever sits closest after the literal word "resets" — falling
 * back to the first valid candidate found anywhere when "resets" isn't present, since
 * some real messages don't put the word directly next to the clock time.
 *
 * - No timezone in the text -> the system local zone.
 * - An unknown timezone -> falls back to the system local zone.
 * - If today's occurrence has already passed, the next day is used.
 * Returns null when no valid clock time is found.
 */
export function parseResetTime(text: string, now: Date): number | null {
  const candidates = [...collect12h(text), ...collect24h(text)].sort((a, b) => a.index - b.index);
  if (candidates.length === 0) return null;

  const resetsIdx = text.toLowerCase().indexOf('resets');
  let chosen: Candidate | undefined;
  if (resetsIdx !== -1) {
    chosen = candidates.find(
      (c) => c.index >= resetsIdx && c.index - (resetsIdx + 'resets'.length) <= RESETS_PROXIMITY,
    );
  }
  chosen ??= candidates[0];
  if (!chosen) return null;

  const tzMatch = TZ_RE.exec(text);
  const zone = tzMatch?.[1];

  // Build "now" in the target zone; fall back to local if the zone is unknown.
  let nowDt = zone ? DateTime.fromJSDate(now, { zone }) : DateTime.fromJSDate(now);
  if (!nowDt.isValid) nowDt = DateTime.fromJSDate(now);

  let target = nowDt.set({ hour: chosen.hour, minute: chosen.minute, second: 0, millisecond: 0 });
  if (target.toMillis() <= nowDt.toMillis()) target = target.plus({ days: 1 });

  return target.toMillis();
}
