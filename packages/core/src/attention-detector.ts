import { EventEmitter } from 'node:events';
import { ATTENTION_SNIPPET_MAX_LEN } from '@awakon/contracts';
import type { AttentionEvent, AttentionSignal } from '@awakon/contracts';

const BEL = 0x07;
const OSC_PREFIX = Buffer.from('\x1b]1337;awakonAttention=', 'utf8');
const PAYLOAD_MAX = ATTENTION_SNIPPET_MAX_LEN;
const IDLE_MS = 1500;
const TAIL_BUFFER_MAX = 512; // Bytes of recent output we keep for prompt-pattern matching.
const PROMPT_PATTERN = /[\$#%>:]\s*$/;

export interface AttentionDetectorEvents {
  attention: (ev: AttentionEvent) => void;
}

/**
 * Byte-stream scanner that emits attention events for terminal BEL (\x07), the Awakon
 * OSC escape (\x1b]1337;awakonAttention=...\x07), and idle prompts (no output for 1.5 s
 * after a prompt-like trailing line).
 */
export class AttentionDetector extends EventEmitter {
  private inOsc = false;
  private oscPayload = '';
  private prefixMatchPos = 0;
  private tailBuffer = '';
  private idleTimer: NodeJS.Timeout | null = null;
  private idleEmittedForCurrentQuiet = false;

  process(chunk: Buffer): void {
    if (chunk.length === 0) return;

    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i]!;

      if (this.inOsc) {
        if (byte === BEL) {
          this.emitEvent('osc', 1, this.oscPayload);
          this.oscPayload = '';
          this.inOsc = false;
        } else if (this.oscPayload.length < PAYLOAD_MAX) {
          this.oscPayload += String.fromCharCode(byte);
        }
        continue;
      }

      if (byte === OSC_PREFIX[this.prefixMatchPos]) {
        this.prefixMatchPos++;
        if (this.prefixMatchPos === OSC_PREFIX.length) {
          this.inOsc = true;
          this.prefixMatchPos = 0;
        }
        continue;
      }

      if (this.prefixMatchPos > 0) {
        this.prefixMatchPos = 0;
        // Re-process this byte from scratch. Safe because prefixMatchPos is now 0, so
        // the `prefixMatchPos > 0` branch above cannot fire on the re-entry — no loop.
        i--;
        continue;
      }

      if (byte === BEL) {
        this.emitEvent('bell', 1);
      }
    }

    // Maintain the tail buffer for idle-prompt heuristic. Append decoded chunk; cap length.
    this.tailBuffer = (this.tailBuffer + chunk.toString('utf8')).slice(-TAIL_BUFFER_MAX);

    // Any new output resets the idle window and re-arms the once-per-quiet emit.
    this.idleEmittedForCurrentQuiet = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.checkIdle(), IDLE_MS);
    // Do not let a pending idle timer keep the Node event loop (or a test run) alive.
    this.idleTimer.unref?.();
  }

  /** Clear any pending idle timer and drop listeners. Call when the session ends. */
  dispose(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.removeAllListeners();
  }

  private checkIdle(): void {
    if (this.idleEmittedForCurrentQuiet) return;
    if (!PROMPT_PATTERN.test(this.tailBuffer)) return;
    this.idleEmittedForCurrentQuiet = true;
    const lastNewline = this.tailBuffer.lastIndexOf('\n');
    const lastLine = this.tailBuffer.slice(lastNewline + 1);
    const snippet = lastLine.slice(-PAYLOAD_MAX);
    const ev: AttentionEvent = {
      sessionId: '__pending__',
      signal: 'idle',
      confidence: 0.7,
      timestamp: Date.now(),
      ...(snippet ? { snippet } : {}),
    };
    this.emit('attention', ev);
  }

  private emitEvent(signal: AttentionSignal, confidence: number, snippet?: string): void {
    const ev: AttentionEvent = {
      sessionId: '__pending__',
      signal,
      confidence,
      timestamp: Date.now(),
      ...(snippet !== undefined ? { snippet } : {}),
    };
    this.emit('attention', ev);
  }
}

export interface AttentionDetector {
  on<K extends keyof AttentionDetectorEvents>(event: K, listener: AttentionDetectorEvents[K]): this;
  emit<K extends keyof AttentionDetectorEvents>(
    event: K,
    ...args: Parameters<AttentionDetectorEvents[K]>
  ): boolean;
}
