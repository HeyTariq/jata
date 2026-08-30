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
export type IconName =
  | "grip"
  | "check"
  | "plus"
  | "x"
  | "search"
  | "list"
  | "inbox"
  | "layers"
  | "activity"
  | "tag"
  | "theme";

export function icon(name: IconName, size = 16) {
  const paths: Record<IconName, string> = {
    grip: "M6 4h1.5v1.5H6zM6 9h1.5v1.5H6zM6 14h1.5v1.5H6zM11 4h1.5v1.5H11zM11 9h1.5v1.5H11zM11 14h1.5v1.5H11z",
    check: "M3.5 8.5l3 3 6.5-7",
    plus: "M9 3.5v11M3.5 9h11",
    x: "M4.5 4.5l9 9M13.5 4.5l-9 9",
    search: "M11.5 11.5L15 15M2.5 7.5a5 5 0 1 0 10 0 5 5 0 0 0-10 0",
    list: "M3 4.5h12M3 9h12M3 13.5h8",
    inbox: "M2.5 10.5h3l1 2h5l1-2h3M2.5 10.5l2-7h9l2 7v4h-13z",
    layers: "M9 2.5l6.5 3.25L9 9 2.5 5.75zM2.5 9.5L9 12.75 15.5 9.5M2.5 13L9 16.25 15.5 13",
    activity: "M3 15V8.5M7 15V4M11 15v-4.5M15 15V6.5",
    tag: "M8.5 2.5H15V9l-6.75 6.75-6.5-6.5zM12 6h.01",
    theme: "M13.5 10.8A5.5 5.5 0 0 1 7.2 4.5a5.5 5.5 0 1 0 6.3 6.3z",
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
