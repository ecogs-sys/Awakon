import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';

/** Max characters of decoded output kept for phrase matching. */
const WINDOW_MAX = 4096;
/** Characters captured after the matched phrase, so the reset time is included. */
const TRAILING_CONTEXT = 200;
/** The 'resets 9:10pm (Pacific/Auckland)' header sits ~250-300 chars before the
 * option-1 label (status line + ruler lines in between) — verified from a real
 * IPC log. 600 gives comfortable margin for wider terminals. */
const LEADING_CONTEXT = 600;

/** CSI sequences, OSC sequences, and other single escapes — stripped before matching. */
const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;

/** Menu chrome that only appears around a *live* interactive prompt — never in a
 * quoted transcript or doc discussing the phrase. Requiring one of these near the
 * match anchors detection to an actual on-screen menu (see N11). */
const MENU_CHROME_MARKERS = ['❯', 'Enter to confirm'];

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
    const stripped = this.window.replace(ANSI_RE, '');
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
    // Cheap phrase match above is only a first-pass filter — require menu chrome
    // nearby before treating this as a real prompt (quoted text has neither).
    if (!MENU_CHROME_MARKERS.some((marker) => resetText.includes(marker))) return;
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
