import { el, icon, replace } from "../dom";
import * as store from "../store";
import { state } from "../store";

function navItem(
  label: string,
  active: boolean,
  count: number | null,
  onClick: () => void,
  extra?: HTMLElement,
) {
  return el(
    "button",
    {
      class: `nav-item${active ? " is-active" : ""}`,
      on: { click: onClick },
    },
    extra ?? el("span", { class: "dot" }),
    el("span", { class: "label" }, label),
    count !== null && count > 0 ? el("span", { class: "count" }, count) : null,
  );
}

export function renderSidebar(root: HTMLElement): void {
  const view = state.view;
  const inbox = store.defaultProject();

  const nodes: HTMLElement[] = [
    el("div", { class: "brand" }, el("strong", {}, "jata"), el("span", {}, "just another todo app")),
  ];

  if (inbox) {
    nodes.push(
      navItem(
        inbox.name,
        view.kind === "project" && view.id === inbox.id,
        inbox.openCount,
        () => store.setView({ kind: "project", id: inbox.id }).then(store.rememberView),
      ),
    );
  }
  nodes.push(
    navItem("All todos", view.kind === "all", null, () =>
      store.setView({ kind: "all" }).then(store.rememberView),
    ),
    navItem("Activity", view.kind === "activity", null, () =>
      store.setView({ kind: "activity" }).then(store.rememberView),
    ),
  );

  nodes.push(
    el(
      "div",
      { class: "nav-heading" },
      el("span", {}, "Projects"),
      el(
        "button",
        {
          title: "New project",
          attrs: { "aria-label": "New project" },
          on: {
            click: () => {
              const name = window.prompt("Project name");
              if (name?.trim()) store.addProject(name);
            },
          },
        },
        icon("plus", 12),
      ),
    ),
  );

  const projects = state.projects.filter((p) => !p.isDefault);
  if (projects.length === 0) {
    nodes.push(el("div", { class: "nav-item", style: { color: "var(--text-faint)" } }, "No projects yet"));
  }
  for (const project of projects) {
    const item = navItem(
      project.name,
      view.kind === "project" && view.id === project.id,
      project.openCount,
      () => store.setView({ kind: "project", id: project.id }).then(store.rememberView),
    );
    item.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      const name = window.prompt(`Rename "${project.name}" (empty to delete it)`, project.name);
      if (name === null) return;
      if (name.trim() === "") {
        if (window.confirm(`Delete "${project.name}"? Its todos move to ${inbox?.name ?? "the default list"}.`)) {
          store.removeProject(project.id);
        }
      } else {
        store.renameProject(project.id, name);
      }
    });
    nodes.push(item);
  }

  if (state.tags.length > 0) {
    nodes.push(el("div", { class: "nav-heading" }, el("span", {}, "Tags")));
    for (const tag of state.tags) {
      nodes.push(
        navItem(
          `#${tag.name}`,
          view.kind === "tag" && view.name === tag.name,
          tag.openCount,
          () => store.setView({ kind: "tag", name: tag.name }),
        ),
      );
    }
  }

  const themeLabels: Record<store.Theme, string> = {
    system: "Theme: system",
    light: "Theme: light",
    dark: "Theme: dark",
  };
  nodes.push(
    el(
      "div",
      { class: "sidebar-footer" },
      el(
        "button",
        {
          title: "Cycle theme (t)",
          on: {
            click: () => {
              const order: store.Theme[] = ["system", "light", "dark"];
              store.setTheme(order[(order.indexOf(state.theme) + 1) % order.length]);
            },
          },
        },
        themeLabels[state.theme],
      ),
      el(
        "button",
        {
          title: "Keyboard shortcuts (?)",
          on: { click: () => window.dispatchEvent(new CustomEvent("jata:shortcuts")) },
        },
        "?",
      ),
    ),
  );

  replace(root, ...nodes);
}
