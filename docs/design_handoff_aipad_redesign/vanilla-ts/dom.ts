// ═══════════════════════════════════════════════════════════════════════
// Awakon — DOM helpers
// Tiny utilities so the rest of the code stays focused on structure.
// ═══════════════════════════════════════════════════════════════════════

type Child = Node | string | number | null | undefined | false;

interface HProps {
  /** Space-separated class names. */
  class?: string;
  /** Text content shortcut (set last, after children). */
  text?: string;
  /** Inline style as cssText string or object. */
  style?: string | Partial<CSSStyleDeclaration>;
  /** Arbitrary attributes (data-*, aria-*, title, etc.) */
  attrs?: Record<string, string | number | boolean>;
  /** Event listeners. */
  on?: Partial<Record<keyof HTMLElementEventMap, EventListener>>;
  /** Child nodes / strings / falsy (skipped). */
  children?: Child[];
}

/** Create an HTML element with props in one call. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: HProps = {},
  children?: Child[],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.style) {
    if (typeof props.style === 'string') el.style.cssText = props.style;
    else Object.assign(el.style, props.style);
  }
  if (props.attrs) {
    for (const [k, v] of Object.entries(props.attrs)) {
      if (v === false) continue;
      el.setAttribute(k, String(v));
    }
  }
  if (props.on) {
    for (const [k, fn] of Object.entries(props.on)) {
      if (fn) el.addEventListener(k, fn as EventListener);
    }
  }
  const kids = children ?? props.children;
  if (kids) appendChildren(el, kids);
  if (props.text !== undefined) el.textContent = props.text;
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an SVG element. Pass children as 3rd arg. */
export function s(
  tag: string,
  attrs: Record<string, string | number> = {},
  children?: (SVGElement | string)[],
): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (children) {
    for (const c of children) {
      el.append(c as Node | string);
    }
  }
  return el;
}

export function appendChildren(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (typeof c === 'string' || typeof c === 'number') parent.appendChild(document.createTextNode(String(c)));
    else parent.appendChild(c);
  }
}

/** Replace `parent`'s children with `children`. */
export function setChildren(parent: Node, children: Child[]): void {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
  appendChildren(parent, children);
}

/** Toggle a class without the boilerplate. */
export function setClass(el: Element, cls: string, on: boolean): void {
  el.classList.toggle(cls, on);
}
