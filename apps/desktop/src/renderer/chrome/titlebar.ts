import type { PreloadBridge } from '@awakon/terminal-host';
import { IpcChannel } from '@awakon/contracts';
import { Bindings, formatAccelerator } from '@awakon/keymap';
import { renderAwakonMark } from './icon.js';

export interface TitleBarOptions {
  bridge: PreloadBridge;
  /** 'win32' | 'darwin' | 'linux' (etc.) — drives the platform-specific shape. */
  platform: string;
  /** Open the Settings dialog (gear button). */
  onOpenSettings: () => void;
  /** Open the command palette (⌘K/Ctrl+K chip). Wired in Phase 4. */
  onOpenPalette: () => void;
}

/** What the top bar shows about the focused session. */
export interface TitleBarContext {
  /** Project name — the basename of the active session's cwd. Empty hides the crumb. */
  project: string;
  /** Optional VCS branch. Omitted unless a cheap source exists (no fabricated data). */
  branch?: string;
  /** Centered subtitle, e.g. "pwsh · running". Empty hides it. */
  subtitle: string;
}

const GEAR_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>';
const MENU_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
const BRANCH_SVG =
  '<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="4" r="2" stroke="currentColor" stroke-width="1.4"/><circle cx="4" cy="12" r="2" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="8" r="2" stroke="currentColor" stroke-width="1.4"/><path d="M4 6v4M6 8h4M6 12h4" stroke="currentColor" stroke-width="1.4"/></svg>';

/**
 * The platform-neutral 44px top bar (Direction 1 "Hot Wax"). Left→right: the
 * Awakon wordmark, a project·branch breadcrumb, a centered session subtitle, and
 * an action cluster — command-palette chip, settings gear, a hamburger that pops
 * the full application menu (File/Tabs/View/Window/Help), and window controls.
 *
 * There is no in-window menu strip: the five native menus live behind the
 * hamburger via ChromeAppMenuPopup. On macOS the OS menu bar + traffic lights
 * remain, so the hamburger and window controls are hidden (see chrome.css
 * [data-platform="darwin"]).
 *
 * The bar is a drag region; interactive children opt out via .tb-no-drag.
 */
export class TitleBar {
  private readonly bridge: PreloadBridge;
  private readonly platform: string;
  private readonly opts: TitleBarOptions;

  private crumbEl!: HTMLElement;
  private crumbProjectEl!: HTMLElement;
  private crumbBranchEl!: HTMLElement;
  private subtitleEl!: HTMLElement;

  constructor(private readonly root: HTMLElement, opts: TitleBarOptions) {
    this.bridge = opts.bridge;
    this.platform = opts.platform;
    this.opts = opts;
    root.dataset['platform'] = this.platform;
    this.render();
  }

  /** Update the breadcrumb + subtitle from the focused session (called on render). */
  setContext(ctx: TitleBarContext): void {
    this.crumbProjectEl.textContent = ctx.project;
    if (ctx.branch) {
      this.crumbBranchEl.hidden = false;
      this.crumbBranchEl.querySelector('.tb-crumb-branch-name')!.textContent = ctx.branch;
    } else {
      this.crumbBranchEl.hidden = true;
    }
    this.crumbEl.hidden = !ctx.project;
    this.subtitleEl.textContent = ctx.subtitle;
  }

  private render(): void {
    this.root.innerHTML = '';

    // ── Wordmark ──────────────────────────────────────────────────────────
    const brand = document.createElement('div');
    brand.className = 'tb-brand';
    const mark = document.createElement('span');
    mark.className = 'tb-mark';
    mark.appendChild(renderAwakonMark(20));
    const name = document.createElement('span');
    name.className = 'tb-name';
    name.textContent = 'Awakon';
    brand.append(mark, name);
    this.root.appendChild(brand);

    const divider = document.createElement('div');
    divider.className = 'tb-divider';
    this.root.appendChild(divider);

    // ── Breadcrumb (project · branch) ─────────────────────────────────────
    this.crumbEl = document.createElement('div');
    this.crumbEl.className = 'tb-crumb';
    this.crumbEl.hidden = true;
    this.crumbProjectEl = document.createElement('span');
    this.crumbProjectEl.className = 'tb-crumb-project';
    const sep = document.createElement('span');
    sep.className = 'tb-crumb-sep';
    sep.textContent = '·';
    this.crumbBranchEl = document.createElement('span');
    this.crumbBranchEl.className = 'tb-crumb-branch';
    this.crumbBranchEl.hidden = true;
    this.crumbBranchEl.innerHTML = `${BRANCH_SVG}<span class="tb-crumb-branch-name"></span>`;
    this.crumbEl.append(this.crumbProjectEl, sep, this.crumbBranchEl);
    this.root.appendChild(this.crumbEl);

    // ── Centered subtitle ─────────────────────────────────────────────────
    this.subtitleEl = document.createElement('div');
    this.subtitleEl.className = 'tb-subtitle';
    this.root.appendChild(this.subtitleEl);

    // ── Action cluster ────────────────────────────────────────────────────
    const actions = document.createElement('div');
    actions.className = 'tb-actions tb-no-drag';

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tb-chip';
    chip.textContent = this.paletteLabel();
    chip.title = 'Command palette';
    chip.addEventListener('click', () => this.opts.onOpenPalette());
    actions.appendChild(chip);

    const gear = document.createElement('button');
    gear.type = 'button';
    gear.className = 'tb-iconbtn';
    gear.title = 'Settings';
    gear.innerHTML = GEAR_SVG;
    gear.addEventListener('click', () => this.opts.onOpenSettings());
    actions.appendChild(gear);

    const menu = document.createElement('button');
    menu.type = 'button';
    menu.className = 'tb-iconbtn tb-menu-btn';
    menu.title = 'Menu';
    menu.innerHTML = MENU_SVG;
    menu.addEventListener('click', (ev) => {
      const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      void this.bridge.send(IpcChannel.ChromeAppMenuPopup, {
        x: Math.round(rect.left),
        y: Math.round(rect.bottom),
      });
    });
    actions.appendChild(menu);

    this.root.appendChild(actions);

    if (this.platform !== 'darwin') {
      this.root.appendChild(this.renderControls());
    }
  }

  private paletteLabel(): string {
    return formatAccelerator(Bindings.commandPalette.accelerator, this.platform);
  }

  private renderControls(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'tb-controls tb-no-drag';

    const mkBtn = (className: string, title: string, svg: string, onClick: () => void): HTMLElement => {
      const btn = document.createElement('div');
      btn.className = `tb-ctrl ${className}`;
      btn.title = title;
      btn.innerHTML = svg;
      btn.addEventListener('click', onClick);
      return btn;
    };

    const minSvg = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" stroke-width="1.1"/></svg>';
    const maxSvg = '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';
    const closeSvg = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1.1"/></svg>';

    wrap.appendChild(mkBtn('min',   'Minimize', minSvg,   () => void this.bridge.send(IpcChannel.ChromeWindowControl, { action: 'minimize' })));
    wrap.appendChild(mkBtn('max',   'Maximize', maxSvg,   () => void this.bridge.send(IpcChannel.ChromeWindowControl, { action: 'maximize' })));
    wrap.appendChild(mkBtn('close', 'Close',    closeSvg, () => void this.bridge.send(IpcChannel.ChromeWindowControl, { action: 'close' })));
    return wrap;
  }
}
