import "@fontsource-variable/inter/wght.css";
import "./styles.css";

import { el } from "./dom";
import * as store from "./store";
import { state } from "./store";
import { invalidateActivity, renderActivity } from "./views/activity";
import { beginEdit, focusQuickAdd, renderList } from "./views/list";
import { closePalette, isPaletteOpen, openPalette, openShortcuts } from "./views/palette";
import { renderSidebar } from "./views/sidebar";

const app = document.getElementById("app")!;
const sidebar = el("aside", { class: "sidebar" });
const main = el("section", { class: "main" });
app.append(sidebar, main);

let lastViewKind = "";

function render(): void {
  renderSidebar(sidebar);

  if (state.view.kind === "activity") {
    if (lastViewKind !== "activity") invalidateActivity();
    renderActivity(main);
  } else {
    renderList(main);
  }
  lastViewKind = state.view.kind;

  if (state.error) {
    main.prepend(el("div", { class: "error-bar" }, state.error));
  }
  keepSelectionVisible();
}

function keepSelectionVisible(): void {
  if (state.selectedId === null) return;
  const row = main.querySelector<HTMLElement>(`li.todo[data-id="${state.selectedId}"]`);
  row?.scrollIntoView({ block: "nearest" });
}

// ------------------------------------------------------------- keyboard map

/** Todos the selection can move through, in the order they are drawn. */
function visibleTodos() {
  return Array.from(main.querySelectorAll<HTMLElement>("li.todo"))
    .map((row) => Number(row.dataset.id))
    .map((id) => state.todos.find((t) => t.id === id))
    .filter((todo): todo is store.Todo => todo !== undefined);
}

function moveSelection(delta: number): void {
  const todos = visibleTodos();
  if (todos.length === 0) return;
  const index = todos.findIndex((t) => t.id === state.selectedId);
  const next = index < 0 ? 0 : Math.min(todos.length - 1, Math.max(0, index + delta));
  state.selectedId = todos[next].id;
  store.emit();
}

/** Alt + arrow reordering, using the same neighbour contract as a drag. */
function nudgeSelected(delta: number): void {
  if (!store.canReorder() || state.selectedId === null) return;
  const todos = visibleTodos().filter((t) => t.completedAt === null);
  const index = todos.findIndex((t) => t.id === state.selectedId);
  if (index < 0) return;
  const target = index + delta;
  if (target < 0 || target >= todos.length) return;

  const others = todos.filter((_, i) => i !== index);
  const before = others[target - 1]?.id ?? null;
  const after = others[target]?.id ?? null;
  store.reorder(state.selectedId, before, after);
}

let pendingG = false;

function typingIn(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  return !!node && ["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName);
}

window.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    if (isPaletteOpen()) return closePalette();
    beginEdit(null);
    (document.activeElement as HTMLElement | null)?.blur();
    return;
  }
  if (isPaletteOpen() || typingIn(ev.target)) return;

  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") {
    ev.preventDefault();
    return openPalette("command");
  }
  if (ev.ctrlKey || ev.metaKey || ev.altKey) {
    if (ev.altKey && ev.key === "ArrowUp") {
      ev.preventDefault();
      return nudgeSelected(-1);
    }
    if (ev.altKey && ev.key === "ArrowDown") {
      ev.preventDefault();
      return nudgeSelected(1);
    }
    return;
  }

  if (pendingG) {
    pendingG = false;
    if (ev.key === "i") {
      const inbox = store.defaultProject();
      if (inbox) store.setView({ kind: "project", id: inbox.id }).then(store.rememberView);
      return;
    }
    if (ev.key === "a") return void store.setView({ kind: "activity" });
    if (ev.key === "g") return moveSelection(-1e6);
  }

  switch (ev.key) {
    case "g":
      pendingG = true;
      return;
    case "j":
    case "ArrowDown":
      ev.preventDefault();
      return moveSelection(1);
    case "k":
    case "ArrowUp":
      ev.preventDefault();
      return moveSelection(-1);
    case "G":
      return moveSelection(1e6);
    case "x":
    case " ":
      ev.preventDefault();
      if (state.selectedId !== null) void store.toggleTodo(state.selectedId);
      return;
    case "n":
      ev.preventDefault();
      return focusQuickAdd();
    case "e":
      ev.preventDefault();
      if (state.selectedId !== null) beginEdit(state.selectedId);
      return;
    case "d":
      if (state.selectedId !== null) void store.removeTodo(state.selectedId);
      return;
    case "/":
      ev.preventDefault();
      return openPalette("search");
    case "t":
      return void store.setTheme(
        state.theme === "system" ? "light" : state.theme === "light" ? "dark" : "system",
      );
    case "?":
      return openShortcuts();
    default:
      break;
  }

  // 1-9 jump straight to a list, default list first.
  if (/^[1-9]$/.test(ev.key)) {
    const project = state.projects[Number(ev.key) - 1];
    if (project) void store.setView({ kind: "project", id: project.id }).then(store.rememberView);
  }
});

window.addEventListener("jata:shortcuts", () => openShortcuts());

store.subscribe(render);
void store.init();
