import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import { stripAnsi } from './strip-ansi.js';

/** Max characters of decoded output kept for phrase matching. */
const WINDOW_MAX = 4096;
/** Characters captured after the matched phrase, so the reset time is included. */
const TRAILING_CONTEXT = 200;
/** The 'resets 9:10pm (Pacific/Auckland)' header sits ~250-300 chars before the
 * option-1 label (status line + ruler lines in between) — verified from a real
 * IPC log. 600 gives comfortable margin for wider terminals. */
const LEADING_CONTEXT = 600;

/** A structural menu signature — both parts must be present, not just one (N11 /
 * Critical #2). The bare `❯` selector glyph alone is *not* sufficient: it is also the
 * prompt glyph of Claude Code itself and of starship/pure/p10k shell themes, so any
 * ordinary prompt sitting near a quoted mention of the phrase (a doc, `cat`'d file,
 * pasted transcript) would satisfy an OR-based check even though no menu is on screen.
 * Requiring an actual numbered option line ("1. ...") *and* the confirm footer
 * together is specific enough that only the live interactive menu produces both. */
const OPTION_LINE_RE = /^[ \t]*(?:❯[ \t]*)?\d+\.[ \t]+\S/m;
const CONFIRM_FOOTER_RE = /Enter to confirm/;

function hasMenuSignature(resetText: string): boolean {
  return OPTION_LINE_RE.test(resetText) && CONFIRM_FOOTER_RE.test(resetText);
}

export interface RateLimitDetectorEvents {
  rateLimitDetected: (resetText: string) => void;
}

/**
 * Scans a session's PTY output for a configured literal phrase. Maintains a small
 * sliding window of decoded, ANSI-stripped text. Emits `rateLimitDetected` once
 * each time the phrase newly appears (a false->true transition), so a redrawn TUI
 * frame that keeps the phrase on screen does not produce a storm of events.
 */
export class RateLimitDetector extends EventEmitter {
  private readonly decoder = new StringDecoder('utf8');
  private window = '';
  private detectText: string;
  private present = false;

  constructor(detectText: string) {
    super();
    this.detectText = detectText;
  }

  /** Update the phrase. Re-arms detection so a phrase already on screen can trigger. */
  setDetectText(text: string): void {
    if (text === this.detectText) return;
    this.detectText = text;
    this.present = false;
  }

  process(chunk: Buffer): void {
    if (chunk.length === 0) return;
    // StringDecoder keeps multi-byte UTF-8 characters intact across chunk boundaries.
    this.window = (this.window + this.decoder.write(chunk)).slice(-WINDOW_MAX);

    if (!this.detectText) {
      this.present = false;
      return;
    }
    const stripped = stripAnsi(this.window);
    const idx = stripped.indexOf(this.detectText);
    if (idx === -1) {
      this.present = false;
      return;
    }
    if (this.present) return;
    const resetText = stripped.slice(
      Math.max(0, idx - LEADING_CONTEXT),
      idx + this.detectText.length + TRAILING_CONTEXT,
    );
    // Cheap phrase match above is only a first-pass filter — require the structural
    // menu signature nearby before treating this as a real prompt (quoted text has
    // neither an option line nor a confirm footer).
    if (!hasMenuSignature(resetText)) return;
    this.present = true;
    this.emit('rateLimitDetected', resetText);
  }

  /** Clear state and listeners. Call when the session ends. */
  dispose(): void {
    this.window = '';
    this.present = false;
    this.removeAllListeners();
  }
}

export interface RateLimitDetector {
  on<K extends keyof RateLimitDetectorEvents>(event: K, listener: RateLimitDetectorEvents[K]): this;
  emit<K extends keyof RateLimitDetectorEvents>(
    event: K,
    ...args: Parameters<RateLimitDetectorEvents[K]>
  ): boolean;
}
