import { el, replace } from "../dom";
import * as store from "../store";
import { state } from "../store";

interface Entry {
  label: string;
  kind: string;
  run: () => void;
}

let overlay: HTMLElement | null = null;

export const isPaletteOpen = (): boolean => overlay !== null;

function entries(): Entry[] {
  const items: Entry[] = [];
  for (const project of state.projects) {
    items.push({
      label: project.name,
      kind: project.isDefault ? "default list" : "project",
      run: () => store.setView({ kind: "project", id: project.id }).then(store.rememberView),
    });
  }
  items.push({
    label: "All todos",
    kind: "view",
    run: () => store.setView({ kind: "all" }).then(store.rememberView),
  });
  items.push({ label: "Activity", kind: "view", run: () => store.setView({ kind: "activity" }) });
  for (const tag of state.tags) {
    items.push({
      label: `#${tag.name}`,
      kind: "tag",
      run: () => store.setView({ kind: "tag", name: tag.name }),
    });
  }
  items.push(
    { label: "New project", kind: "action", run: () => {
        const name = window.prompt("Project name");
        if (name?.trim()) store.addProject(name);
      } },
    { label: "Toggle completed todos", kind: "action", run: () => store.toggleSetting("showCompleted") },
    { label: "Group by due date", kind: "action", run: () => store.toggleSetting("groupByDue") },
    { label: "Theme: system", kind: "action", run: () => store.setTheme("system") },
    { label: "Theme: light", kind: "action", run: () => store.setTheme("light") },
    { label: "Theme: dark", kind: "action", run: () => store.setTheme("dark") },
  );
  return items;
}

export function closePalette(): void {
  overlay?.remove();
  overlay = null;
}

/** Opens the palette. With `search`, Enter runs a full-text search instead. */
export function openPalette(mode: "command" | "search" = "command"): void {
  closePalette();
  const all = entries();
  let active = 0;
  let matches = all;

  const list = el("ul", {});
  const input = el("input", {
    placeholder: mode === "search" ? "Search todos" : "Jump to a list, or run an action",
    attrs: { autofocus: "true" },
  }) as HTMLInputElement;

  const draw = () => {
    replace(
      list,
      ...matches.map((entry, i) =>
        el(
          "li",
          {
            class: i === active ? "is-active" : "",
            on: {
              click: () => {
                closePalette();
                entry.run();
              },
              pointerenter: () => {
                active = i;
                draw();
              },
            },
          },
          entry.label,
          el("span", { class: "kind" }, entry.kind),
        ),
      ),
    );
  };

  const filter = () => {
    const query = input.value.trim().toLowerCase();
    matches = query
      ? all.filter((entry) => entry.label.toLowerCase().includes(query))
      : all;
    active = 0;
    draw();
  };

  input.addEventListener("input", filter);
  input.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Escape") return closePalette();
    if (ev.key === "ArrowDown" || (ev.key === "n" && ev.ctrlKey)) {
      active = Math.min(active + 1, matches.length - 1);
      return draw();
    }
    if (ev.key === "ArrowUp" || (ev.key === "p" && ev.ctrlKey)) {
      active = Math.max(active - 1, 0);
      return draw();
    }
    if (ev.key === "Enter") {
      const query = input.value.trim();
      if (mode === "search" && query) {
        closePalette();
        store.setView({ kind: "search", query });
        return;
      }
      const entry = matches[active];
      if (entry) {
        closePalette();
        entry.run();
      }
    }
  });

  const panel = el("div", { class: "palette" }, input, list);
  overlay = el(
    "div",
    {
      class: "overlay",
      on: {
        pointerdown: (ev) => {
          if (ev.target === overlay) closePalette();
        },
      },
    },
    panel,
  );
  document.body.appendChild(overlay);
  filter();
  input.focus();
}

const SHORTCUTS: [string, string][] = [
  ["j / k", "Move the selection down and up"],
  ["x / Space", "Toggle the selected todo"],
  ["n", "Focus the quick-add box"],
  ["e", "Edit the selected todo"],
  ["d", "Delete the selected todo"],
  ["Alt + ↑ / ↓", "Reorder the selected todo"],
  ["/", "Search todos"],
  ["Ctrl + K", "Command palette"],
  ["g then i", "Go to the default list"],
  ["g then a", "Go to activity"],
  ["1 - 9", "Jump to a project"],
  ["t", "Cycle the theme"],
  ["?", "This list"],
];

export function openShortcuts(): void {
  closePalette();
  const panel = el(
    "div",
    { class: "shortcuts" },
    el("h2", {}, "Keyboard shortcuts"),
    el(
      "dl",
      {},
      ...SHORTCUTS.flatMap(([keys, description]) => [
        el("dt", {}, keys),
        el("dd", {}, description),
      ]),
    ),
  );
  overlay = el(
    "div",
    {
      class: "overlay",
      style: { "padding-top": "14vh" },
      on: { pointerdown: () => closePalette() },
    },
    panel,
  );
  document.body.appendChild(overlay);
}
