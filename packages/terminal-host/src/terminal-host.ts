import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { SessionId } from '@awakon/contracts';
import { IpcChannel } from '@awakon/contracts';

/**
 * Bridge between an xterm.js Terminal instance and one Session in the main process.
 *
 * The renderer's preload exposes:
 *   window.awakon.send(channel, payload)          -> Promise<unknown>
 *   window.awakon.on(channel, handler) -> unsubscribe
 *
 * (Defined in apps/desktop/src/preload/index.ts.)
 */
export interface PreloadBridge {
  send: (channel: string, payload?: unknown) => Promise<unknown>;
  on: (channel: string, handler: (payload: unknown) => void) => () => void;
}

export interface TerminalHostOptions {
  container: HTMLElement;
  sessionId: SessionId;
  bridge: PreloadBridge;
}

function encodeUtf8Base64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function decodeUtf8Base64(input: string): string {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export class TerminalHost {
  private readonly term: Terminal;
  private readonly fit: FitAddon;
  private readonly bridge: PreloadBridge;
  private readonly sessionId: SessionId;
  private unsubscribers: Array<() => void> = [];
  private resizeObserver: ResizeObserver | null = null;
  /** Until the ring-buffer replay completes, live data is buffered here so it cannot
   * be written to xterm ahead of the snapshot. */
  private replayComplete = false;
  private pendingChunks: string[] = [];

  constructor(opts: TerminalHostOptions) {
    this.sessionId = opts.sessionId;
    this.bridge = opts.bridge;

    this.term = new Terminal({
      fontFamily: 'ui-monospace, Menlo, Consolas, "Courier New", monospace',
      fontSize: 14,
      cursorBlink: true,
      convertEol: false,
      scrollback: 5000,
      theme: {
        background:    '#1c1f25', // --term-bg / --bg-0
        foreground:    '#e8eaee', // --term-fg
        cursor:        '#e8eaee',
        cursorAccent:  '#1c1f25',
        selectionBackground: '#7CA8E059', // --accent-glow
        // ANSI standard colors
        black:         '#1c1f25',
        red:           '#d27566', // --term-red
        green:         '#82c69b', // --term-green
        yellow:        '#d8c376', // --term-yellow
        blue:          '#7CA8E0', // --term-blue / --accent
        magenta:       '#c388d8', // --term-magenta
        cyan:          '#7dc3d4', // --term-cyan
        white:         '#e8eaee',
        // ANSI bright colors
        brightBlack:   '#5a5e66',
        brightRed:     '#e08879',
        brightGreen:   '#9bd6b3',
        brightYellow:  '#e8d489',
        brightBlue:    '#9ac2f0',
        brightMagenta: '#d39ce8',
        brightCyan:    '#92d5e8',
        brightWhite:   '#f4f5f7',
      },
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.loadAddon(new WebLinksAddon());

    this.term.open(opts.container);
    this.fit.fit();

    this.wireInput();
    this.wireOutput();
    this.wireResize(opts.container);
    void this.replay();
  }

  dispose(): void {
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];
    this.resizeObserver?.disconnect();
    this.term.dispose();
  }

  // ── Public terminal actions used by the context menu wiring ──────────

  hasSelection(): boolean {
    return this.term.hasSelection();
  }

  getSelection(): string {
    return this.term.getSelection();
  }

  paste(text: string): void {
    this.term.paste(text);
  }

  selectAll(): void {
    this.term.selectAll();
  }

  focus(): void {
    this.term.focus();
  }

  private async replay(): Promise<void> {
    try {
      const response = await this.bridge.send(IpcChannel.SessionReplay, { sessionId: this.sessionId });
      const r = response as { sessionId: string; data: string } | { error: string };
      if ('error' in r) {
        console.warn('[terminal] replay failed:', r.error);
      } else if (r.data) {
        this.term.write(decodeUtf8Base64(r.data));
      }
    } catch (err) {
      console.warn('[terminal] replay threw:', err);
    } finally {
      // Write the snapshot first, then drain any live chunks that arrived during
      // replay — preserving order — then let subsequent chunks write directly.
      for (const chunk of this.pendingChunks) this.term.write(chunk);
      this.pendingChunks = [];
      this.replayComplete = true;
    }
  }

  private wireInput(): void {
    const sub = this.term.onData((data) => {
      void this.bridge.send(IpcChannel.SessionWrite, {
        sessionId: this.sessionId,
        data: encodeUtf8Base64(data),
      });
    });
    this.unsubscribers.push(() => sub.dispose());
  }

  private wireOutput(): void {
    const onData = this.bridge.on(IpcChannel.SessionData, (raw) => {
      const event = raw as { sessionId: SessionId; data: string };
      if (event.sessionId !== this.sessionId) return;
      const decoded = decodeUtf8Base64(event.data);
      // Before replay finishes, buffer live data so it never precedes the snapshot.
      if (this.replayComplete) this.term.write(decoded);
      else this.pendingChunks.push(decoded);
    });

    const onExit = this.bridge.on(IpcChannel.SessionExited, (raw) => {
      const event = raw as { sessionId: SessionId; exitCode: number | null };
      if (event.sessionId !== this.sessionId) return;
      this.term.write(`\r\n\x1b[90m[session exited, code=${event.exitCode}]\x1b[0m\r\n`);
    });

    this.unsubscribers.push(onData, onExit);
  }

  private wireResize(container: HTMLElement): void {
    const dispatchResize = (): void => {
      this.fit.fit();
      const { cols, rows } = this.term;
      void this.bridge.send(IpcChannel.SessionResize, {
        sessionId: this.sessionId,
        cols,
        rows,
      });
    };
    this.resizeObserver = new ResizeObserver(dispatchResize);
    this.resizeObserver.observe(container);
    queueMicrotask(dispatchResize);
  }
}
