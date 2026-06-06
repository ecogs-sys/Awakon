import type { PreloadBridge } from '@awakon/terminal-host';
import { IpcChannel } from '@awakon/contracts';

const MENU_NAMES = ['File', 'Tabs', 'View', 'Window', 'Help'] as const;
type MenuName = (typeof MENU_NAMES)[number];

export interface TitleBarOptions {
  bridge: PreloadBridge;
  /** 'win32' | 'darwin' | 'linux' (etc.) — drives the platform-specific shape. */
  platform: string;
}

/**
 * Renders the 32px in-window titlebar. On macOS the bar shows only the app glyph
 * + centered title (the OS menu bar lives at the top of the screen and the traffic
 * lights overlay the bar's left edge). On Windows/Linux the bar shows the glyph,
 * the five menu names, and min/max/close window controls — and the menu names pop
 * the existing native submenus via the ChromeMenuPopup IPC.
 *
 * The whole bar has -webkit-app-region: drag; interactive children opt out via
 * .tb-menu / .tb-controls (no-drag), set in chrome.css.
 */
export class TitleBar {
  private readonly bridge: PreloadBridge;
  private readonly platform: string;

  constructor(private readonly root: HTMLElement, opts: TitleBarOptions) {
    this.bridge = opts.bridge;
    this.platform = opts.platform;
    root.dataset['platform'] = this.platform;
    this.render();
  }

  private render(): void {
    this.root.innerHTML = '';

    const glyph = document.createElement('div');
    glyph.className = 'tb-glyph';
    glyph.appendChild(this.renderGlyphSvg());
    this.root.appendChild(glyph);

    if (this.platform !== 'darwin') {
      const menu = document.createElement('div');
      menu.className = 'tb-menu';
      for (const name of MENU_NAMES) {
        const item = document.createElement('div');
        item.className = 'tb-menu-item';
        item.textContent = name;
        item.addEventListener('click', (ev) => {
          const target = ev.currentTarget as HTMLElement;
          const rect = target.getBoundingClientRect();
          void this.bridge.send(IpcChannel.ChromeMenuPopup, {
            menu: name satisfies MenuName,
            x: Math.round(rect.left),
            y: Math.round(rect.bottom),
          });
        });
        menu.appendChild(item);
      }
      this.root.appendChild(menu);
    }

    const title = document.createElement('div');
    title.className = 'tb-title';
    title.innerHTML = '<b>Awakon</b>';
    this.root.appendChild(title);

    if (this.platform !== 'darwin') {
      this.root.appendChild(this.renderControls());
    }
  }

  private renderGlyphSvg(): SVGSVGElement {
    // 16x16 app glyph — matches the AppGlyph in design/app.jsx.
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.style.display = 'block';

    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('width', '24');
    rect.setAttribute('height', '24');
    rect.setAttribute('rx', '6');
    rect.setAttribute('fill', '#2a2f38');
    svg.appendChild(rect);

    const dot = (cx: string, cy: string, fill: string): SVGCircleElement => {
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', '1.6'); c.setAttribute('fill', fill);
      return c;
    };
    svg.appendChild(dot('7',  '9', '#9bc8a3'));
    svg.appendChild(dot('12', '9', '#7CA8E0'));
    svg.appendChild(dot('17', '9', '#e0c477'));

    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M 7 15 L 10 17 L 7 19');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#e8eaee');
    path.setAttribute('stroke-width', '1.4');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);

    const bar = document.createElementNS(ns, 'rect');
    bar.setAttribute('x', '12'); bar.setAttribute('y', '18');
    bar.setAttribute('width', '5'); bar.setAttribute('height', '1.2');
    bar.setAttribute('rx', '0.6'); bar.setAttribute('fill', '#7CA8E0');
    svg.appendChild(bar);

    return svg;
  }

  private renderControls(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'tb-controls';

    const mkBtn = (className: string, title: string, svg: string, onClick: () => void): HTMLElement => {
      const btn = document.createElement('div');
      btn.className = `tb-ctrl ${className}`;
      btn.title = title;
      btn.innerHTML = svg;
      btn.addEventListener('click', onClick);
      return btn;
    };

    const minSvg = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" stroke-width="1"/></svg>';
    const maxSvg = '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
    const closeSvg = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1"/></svg>';

    wrap.appendChild(mkBtn('min',   'Minimize', minSvg,   () => void this.bridge.send(IpcChannel.ChromeWindowControl, { action: 'minimize' })));
    wrap.appendChild(mkBtn('max',   'Maximize', maxSvg,   () => void this.bridge.send(IpcChannel.ChromeWindowControl, { action: 'maximize' })));
    wrap.appendChild(mkBtn('close', 'Close',    closeSvg, () => void this.bridge.send(IpcChannel.ChromeWindowControl, { action: 'close' })));
    return wrap;
  }
}
