import * as api from "./api";
import type { Project, Tag, Todo } from "./api";

export type View =
  | { kind: "project"; id: number }
  | { kind: "all" }
  | { kind: "tag"; name: string }
  | { kind: "activity" };

export type Theme = "system" | "light" | "dark";

export interface State {
  projects: Project[];
  tags: Tag[];
  todos: Todo[];
  view: View;
  selectedId: number | null;
  showCompleted: boolean;
  groupByDue: boolean;
  theme: Theme;
  error: string | null;
}

export const state: State = {
  projects: [],
  tags: [],
  todos: [],
  view: { kind: "all" },
  selectedId: null,
  showCompleted: false,
  groupByDue: false,
  theme: "system",
  error: null,
};

type Listener = (state: State) => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): void {
  listeners.add(fn);
}

export function emit(): void {
  for (const fn of listeners) fn(state);
}

/** Runs an action, surfacing any backend error in the UI instead of the void. */
export async function guard<T>(work: () => Promise<T>): Promise<T | undefined> {
  try {
    const result = await work();
    if (state.error) {
      state.error = null;
      emit();
    }
    return result;
  } catch (err) {
    state.error = String(err);
    emit();
    return undefined;
  }
}

export function defaultProject(): Project | undefined {
  return state.projects.find((p) => p.isDefault);
}

/** The project a new todo should land in for the current view. */
export function targetProjectId(): number | null {
  return state.view.kind === "project" ? state.view.id : null;
}

/** Dragging only makes sense where the visible order is the stored order. */
export function canReorder(): boolean {
  return state.view.kind === "project" && !state.groupByDue;
}

function queryFor(view: View): api.TodoQuery {
  const base = { includeCompleted: state.showCompleted };
  switch (view.kind) {
    case "project":
      return { ...base, projectId: view.id };
    case "tag":
      return { ...base, tag: view.name };
    default:
      return base;
  }
}

export async function loadSidebar(): Promise<void> {
  const [projects, tags] = await Promise.all([api.listProjects(), api.listTags()]);
  state.projects = projects;
  state.tags = tags;
}

export async function loadTodos(): Promise<void> {
  if (state.view.kind === "activity") {
    state.todos = [];
    return;
  }
  state.todos = await api.listTodos(queryFor(state.view));
  if (!state.todos.some((t) => t.id === state.selectedId)) {
    state.selectedId = state.todos[0]?.id ?? null;
  }
}

export async function refresh(): Promise<void> {
  await guard(async () => {
    await Promise.all([loadSidebar(), loadTodos()]);
    emit();
  });
}

export async function setView(view: View): Promise<void> {
  state.view = view;
  state.selectedId = null;
  await refresh();
}

export async function init(): Promise<void> {
  await guard(async () => {
    const settings = await api.getSettings();
    state.theme = (settings.theme as Theme) ?? "system";
    state.groupByDue = settings.groupByDue === "1";
    state.showCompleted = settings.showCompleted === "1";
    applyTheme();

    await loadSidebar();
    const lastView = settings.view;
    const project = lastView ? state.projects.find((p) => String(p.id) === lastView) : undefined;
    state.view = project
      ? { kind: "project", id: project.id }
      : lastView === "activity"
        ? { kind: "activity" }
        : { kind: "all" };
    await loadTodos();
    emit();
  });
}

export function applyTheme(): void {
  document.documentElement.dataset.theme = state.theme;
}

export async function setTheme(theme: Theme): Promise<void> {
  state.theme = theme;
  applyTheme();
  emit();
  await guard(() => api.setSetting("theme", theme));
}

export async function rememberView(): Promise<void> {
  const value =
    state.view.kind === "project"
      ? String(state.view.id)
      : state.view.kind === "activity"
        ? "activity"
        : "";
  await guard(() => api.setSetting("view", value));
}

export async function toggleSetting(key: "groupByDue" | "showCompleted"): Promise<void> {
  state[key] = !state[key];
  await guard(() => api.setSetting(key, state[key] ? "1" : "0"));
  await refresh();
}

// ------------------------------------------------------------------ actions

export async function addTodo(title: string, dueDate: string | null, tags: string[]) {
  const todo = await guard(() => api.createTodo(targetProjectId(), title, dueDate, tags));
  if (todo) {
    state.selectedId = todo.id;
    await refresh();
  }
  return todo;
}

export async function toggleTodo(id: number): Promise<void> {
  const todo = state.todos.find((t) => t.id === id);
  if (!todo) return;
  await guard(() => api.setCompleted(id, todo.completedAt === null));
  await refresh();
}

export async function editTodo(id: number, patch: api.TodoPatch): Promise<void> {
  await guard(() => api.updateTodo(id, patch));
  await refresh();
}

export async function removeTodo(id: number): Promise<void> {
  await guard(() => api.deleteTodo(id));
  await refresh();
}

export async function reorder(
  id: number,
  beforeId: number | null,
  afterId: number | null,
): Promise<void> {
  await guard(() => api.moveTodo(id, null, beforeId, afterId));
  await refresh();
}

export async function addProject(name: string): Promise<void> {
  const projects = await guard(() => api.createProject(name));
  if (!projects) return;
  state.projects = projects;
  const created = projects.find((p) => p.name === name.trim() && !p.isDefault);
  await setView(created ? { kind: "project", id: created.id } : state.view);
}

export async function renameProject(id: number, name: string): Promise<void> {
  await guard(() => api.renameProject(id, name));
  await refresh();
}

export async function removeProject(id: number): Promise<void> {
  await guard(() => api.deleteProject(id));
  if (state.view.kind === "project" && state.view.id === id) {
    await setView({ kind: "all" });
  } else {
    await refresh();
  }
}

export { api };
export type { Project, Tag, Todo };
