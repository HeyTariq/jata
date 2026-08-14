/** Tiny element builder. The whole of jata's "view layer". */

type Child = Node | string | number | null | undefined | false;

type Props<K extends keyof HTMLElementTagNameMap> = Partial<
  Omit<HTMLElementTagNameMap[K], "style" | "children" | "class">
> & {
  class?: string;
  dataset?: Record<string, string>;
  style?: Record<string, string>;
  on?: Partial<{
    [E in keyof HTMLElementEventMap]: (ev: HTMLElementEventMap[E]) => void;
  }>;
  attrs?: Record<string, string>;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props<K> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: className, dataset, style, on, attrs, ...rest } = props;

  if (className) node.className = className;
  if (dataset) Object.assign(node.dataset, dataset);
  if (style) for (const [k, v] of Object.entries(style)) node.style.setProperty(k, v);
  if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (on) {
    for (const [event, handler] of Object.entries(on)) {
      node.addEventListener(event, handler as EventListener);
    }
  }
  Object.assign(node, rest);

  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(
      typeof child === "string" || typeof child === "number"
        ? document.createTextNode(String(child))
        : child,
    );
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function replace(node: Node, ...children: Child[]): void {
  clear(node);
  append(node, children);
}

/** SVG icons, kept as a small set so the UI has no icon dependency. */
export function icon(name: "grip" | "check" | "plus" | "x" | "search" | "list", size = 16) {
  const paths: Record<string, string> = {
    grip: "M6 4h1.5v1.5H6zM6 9h1.5v1.5H6zM6 14h1.5v1.5H6zM11 4h1.5v1.5H11zM11 9h1.5v1.5H11zM11 14h1.5v1.5H11z",
    check: "M3.5 8.5l3 3 6.5-7",
    plus: "M9 3.5v11M3.5 9h11",
    x: "M4.5 4.5l9 9M13.5 4.5l-9 9",
    search: "M11.5 11.5L15 15M2.5 7.5a5 5 0 1 0 10 0 5 5 0 0 0-10 0",
    list: "M3 4.5h12M3 9h12M3 13.5h8",
  };
  const filled = name === "grip";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 18 18");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", paths[name]);
  if (filled) {
    path.setAttribute("fill", "currentColor");
  } else {
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
  }
  svg.appendChild(path);
  return svg;
}
