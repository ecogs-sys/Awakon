import { Terminal } from '@xterm/xterm';
import type { ILinkProvider, ILink, IBufferLine } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { SessionId } from '@awakon/contracts';
import { IpcChannel, isHttpUrl } from '@awakon/contracts';
import { findMarkdownLinks } from './md-links.js';
import { sanitizePasteText } from './sanitize-paste.js';

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
      // Direction 1 "Hot Wax" palette. xterm needs concrete hex, so these are the
      // sRGB equivalents of the --term-* oklch tokens in chrome/styles/tokens.css.
      theme: {
        background:    '#0d0d12', // --term-bg
        foreground:    '#e5e4e8', // --term-fg
        cursor:        '#e5e4e8',
        cursorAccent:  '#0d0d12',
        selectionBackground: '#C36BEF59', // --accent-glow
        // ANSI standard colors
        black:         '#0b0b10', // --bg-0
        red:           '#f97772', // --term-red
        green:         '#73e087', // --term-green
        yellow:        '#f5cc58', // --term-yellow
        blue:          '#96b4ff', // --term-blue
        magenta:       '#e08ced', // --term-magenta
        cyan:          '#56d2df', // --term-cyan
        white:         '#e5e4e8', // --term-fg
        // ANSI bright colors
        brightBlack:   '#605e66',
        brightRed:     '#ff948e',
        brightGreen:   '#8ef29e',
        brightYellow:  '#ffde75',
        brightBlue:    '#afcbff',
        brightMagenta: '#f5a5ff',
        brightCyan:    '#7de8f3',
        brightWhite:   '#f6f5f9', // --text-1
      },
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    // Terminal output is untrusted (any command/remote server can print a URL).
    // Never let the addon's default window.open() land inside the Electron app —
    // route http(s) links through main's shell.openExternal, same as doc-reader.
    this.term.loadAddon(new WebLinksAddon((_ev, uri) => {
      if (isHttpUrl(uri)) {
        void this.bridge.send(IpcChannel.ChromeOpenExternal, { url: uri });
      }
    }));
    this.term.registerLinkProvider(this.markdownLinkProvider());

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
    this.term.paste(sanitizePasteText(text));
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

  /** xterm link provider: underlines `.md` paths and opens the reader on click. */
  private markdownLinkProvider(): ILinkProvider {
    const term = this.term;
    const bridge = this.bridge;
    const sessionId = this.sessionId;
    return {
      provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
        const line: IBufferLine | undefined = term.buffer.active.getLine(bufferLineNumber - 1);
        if (!line) { callback(undefined); return; }
        const text = line.translateToString(true);
        const hits = findMarkdownLinks(text);
        if (hits.length === 0) { callback(undefined); return; }
        const links: ILink[] = hits.map((hit) => ({
          // xterm ranges are 1-based, end inclusive.
          range: {
            start: { x: hit.start + 1, y: bufferLineNumber },
            end: { x: hit.end, y: bufferLineNumber },
          },
          text: hit.text,
          activate: (): void => {
            void bridge.send(IpcChannel.DocOpen, { sessionId, path: hit.text });
          },
        }));
        callback(links);
      },
    };
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
