import { EventEmitter } from 'node:events';

/**
 * Byte-stream scanner for the shell-integration markers emitted by the injected
 * script (see shell-integration/pwsh.ts):
 *
 *   ESC ] 133 ; A BEL              prompt start
 *   ESC ] 133 ; B BEL              input start
 *   ESC ] 133 ; C BEL              command began executing
 *   ESC ] 133 ; D ; <exit> BEL     command finished
 *   ESC ] 7 ; file://...   BEL     cwd
 *   ESC ] 1337 ; awakonCommand=... BEL
 *
 * Runs on every byte of every session, so it keeps a small fixed-size buffer and only
 * allocates once a marker actually completes.
 *
 * Chunk boundaries are the real hazard here: a PTY read can split a sequence anywhere,
 * so state is carried across process() calls rather than matching within a chunk.
 */
export interface ShellIntegrationEvents {
  /** A command was submitted. `command` is the raw line the user entered. */
  commandStart: (command: string) => void;
  /** The previous command finished. `exitCode` is null when unparseable. */
  commandEnd: (exitCode: number | null) => void;
  /** The shell reported its working directory. Native path, percent-decoded. */
  cwdChanged: (cwd: string) => void;
  /** A prompt was drawn — the session is idle, waiting for input. */
  promptStart: () => void;
}

const ESC = 0x1b;
const BEL = 0x07;
const OSC_OPEN = 0x5d; // ']'

/** Cap on a single OSC payload. Command lines and paths are far below this; the limit
 *  exists so a stream that never sends BEL cannot grow memory without bound. */
const PAYLOAD_MAX = 4096;

export class ShellIntegrationDetector extends EventEmitter {
  /** True once ESC ] has been seen and we are accumulating until BEL/ST. */
  private inOsc = false;
  private payload = '';
  /** Set when ESC was the previous byte, so ']' can be recognised across a chunk split. */
  private sawEsc = false;
  /** Set when ESC was seen INSIDE an OSC payload — ESC \ (ST) is a valid terminator. */
  private sawEscInOsc = false;

  process(chunk: Buffer): void {
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i]!;

      if (this.inOsc) {
        if (this.sawEscInOsc) {
          this.sawEscInOsc = false;
          // ESC \ terminates the string (ST). Anything else: the ESC was not a
          // terminator, so drop the sequence rather than risk swallowing the stream.
          if (byte === 0x5c) this.finishOsc();
          else { this.inOsc = false; this.payload = ''; }
          continue;
        }
        if (byte === BEL) { this.finishOsc(); continue; }
        if (byte === ESC) { this.sawEscInOsc = true; continue; }
        if (this.payload.length < PAYLOAD_MAX) {
          this.payload += String.fromCharCode(byte);
        } else {
          // Over-long payload: abandon it rather than keep accumulating.
          this.inOsc = false;
          this.payload = '';
        }
        continue;
      }

      if (this.sawEsc) {
        this.sawEsc = false;
        if (byte === OSC_OPEN) { this.inOsc = true; this.payload = ''; continue; }
        // Not an OSC — if this byte is itself ESC, stay armed for the next one.
        if (byte === ESC) this.sawEsc = true;
        continue;
      }

      if (byte === ESC) this.sawEsc = true;
    }
  }

  /** Drop any partial state. Call when the session ends. */
  dispose(): void {
    this.inOsc = false;
    this.sawEsc = false;
    this.sawEscInOsc = false;
    this.payload = '';
    this.removeAllListeners();
  }

  private finishOsc(): void {
    const payload = this.payload;
    this.payload = '';
    this.inOsc = false;
    this.dispatch(payload);
  }

  private dispatch(payload: string): void {
    // OSC 133 — semantic prompt markers.
    if (payload.startsWith('133;')) {
      const body = payload.slice(4);
      if (body === 'A') { this.emit('promptStart'); return; }
      if (body === 'C') return;             // command start is reported via awakonCommand
      if (body === 'B') return;
      if (body.startsWith('D')) {
        // "D" alone, or "D;<exit>".
        const rest = body.startsWith('D;') ? body.slice(2) : '';
        const parsed = /^-?\d+$/.test(rest) ? Number(rest) : null;
        this.emit('commandEnd', parsed);
      }
      return;
    }

    // OSC 7 — cwd as a file:// URI.
    if (payload.startsWith('7;')) {
      const cwd = parseFileUri(payload.slice(2));
      if (cwd) this.emit('cwdChanged', cwd);
      return;
    }

    // OSC 1337 — our private namespace, matching the existing awakonAttention marker.
    if (payload.startsWith('1337;awakonCommand=')) {
      const command = payload.slice('1337;awakonCommand='.length);
      this.emit('commandStart', command);
    }
  }
}

/** `file:///C:/a%20b` → `C:\a b`. Returns null for anything that is not a file URI. */
export function parseFileUri(uri: string): string | null {
  if (!uri.startsWith('file://')) return null;
  // Strip scheme and (empty) authority.
  let path = uri.slice('file://'.length);
  const slash = path.indexOf('/');
  if (slash < 0) return null;
  path = path.slice(slash);
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null; // malformed percent-encoding
  }
  // Windows drive paths arrive as /C:/... — drop the leading slash and use backslashes.
  if (/^\/[A-Za-z]:/.test(decoded)) return decoded.slice(1).replace(/\//g, '\\');
  return decoded;
}

export interface ShellIntegrationDetector {
  on<K extends keyof ShellIntegrationEvents>(event: K, listener: ShellIntegrationEvents[K]): this;
  emit<K extends keyof ShellIntegrationEvents>(
    event: K,
    ...args: Parameters<ShellIntegrationEvents[K]>
  ): boolean;
}
