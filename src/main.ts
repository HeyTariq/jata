import "@fontsource-variable/inter/wght.css";
import "./styles.css";

import { el } from "./dom";
import * as store from "./store";
import { state } from "./store";
import { invalidateActivity, renderActivity } from "./views/activity";
import { beginEdit, renderList, startQuickAdd } from "./views/list";
import { promptNewProject, renderSidebar } from "./views/sidebar";

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

function typingIn(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  return !!node && ["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName);
}

/** The quick-add box only exists on a list view, so activity moves off it first. */
async function newTodo(): Promise<void> {
  if (state.view.kind === "activity") {
    const inbox = store.defaultProject();
    if (!inbox) return;
    await store.setView({ kind: "project", id: inbox.id });
    await store.rememberView();
  }
  startQuickAdd();
}

window.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    beginEdit(null);
    (document.activeElement as HTMLElement | null)?.blur();
    return;
  }

  const mod = (ev.ctrlKey || ev.metaKey) && !ev.altKey;
  if (mod && ev.key.toLowerCase() === "n") {
    ev.preventDefault();
    return void newTodo();
  }
  if (mod && ev.key.toLowerCase() === "p") {
    ev.preventDefault();
    return promptNewProject();
  }
  if (ev.ctrlKey || ev.metaKey || ev.altKey || typingIn(ev.target)) return;

  // Anywhere a quick-add box exists, the first character typed starts a todo.
  if (state.view.kind === "activity") return;
  if (ev.key.length !== 1 || ev.key === " ") return;
  ev.preventDefault();
  startQuickAdd(ev.key);
});

store.subscribe(render);
void store.init();
