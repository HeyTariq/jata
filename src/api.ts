import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/**
 * In `npm run dev` outside the desktop shell there is no Rust side to talk to,
 * so the UI runs against an in-memory mock. Production builds keep only the
 * real bridge.
 */
const inTauri = "__TAURI_INTERNALS__" in window;
const invoke: typeof tauriInvoke =
  import.meta.env.DEV && !inTauri
    ? ((await import("./mock")).mockInvoke as typeof tauriInvoke)
    : tauriInvoke;

export interface Project {
  id: number;
  name: string;
  position: number;
  isDefault: boolean;
  openCount: number;
}

export interface Todo {
  id: number;
  projectId: number;
  projectName: string;
  title: string;
  notes: string;
  dueDate: string | null;
  position: number;
  completedAt: number | null;
  createdAt: number;
  tags: string[];
}

export interface Tag {
  name: string;
  openCount: number;
}

export interface TodoQuery {
  projectId?: number | null;
  tag?: string | null;
  search?: string | null;
  includeCompleted?: boolean;
}

export interface TodoPatch {
  title?: string;
  notes?: string;
  /** Omit to leave alone; `null` clears the date. */
  dueDate?: string | null;
  projectId?: number;
  tags?: string[];
}

export interface DayCount {
  date: string;
  count: number;
}

export interface ActivityItem {
  title: string;
  projectName: string;
  tags: string[];
  at: number;
  date: string;
}

export interface ActivityDay {
  date: string;
  items: ActivityItem[];
}

/** Minutes this machine is behind UTC, as the Rust side expects it. */
export const tzOffsetMinutes = () => new Date().getTimezoneOffset();

export const listProjects = () => invoke<Project[]>("list_projects");
export const createProject = (name: string) => invoke<Project[]>("create_project", { name });
export const renameProject = (id: number, name: string) =>
  invoke<Project[]>("rename_project", { id, name });
export const deleteProject = (id: number) => invoke<Project[]>("delete_project", { id });

export const listTags = () => invoke<Tag[]>("list_tags");

export const listTodos = (query: TodoQuery) => invoke<Todo[]>("list_todos", { query });

export const createTodo = (
  projectId: number | null,
  title: string,
  dueDate: string | null,
  tags: string[],
) => invoke<Todo>("create_todo", { projectId, title, dueDate, tags });

export const updateTodo = (id: number, patch: TodoPatch) =>
  invoke<Todo>("update_todo", { id, patch });

export const deleteTodo = (id: number) => invoke<void>("delete_todo", { id });

export const setCompleted = (id: number, done: boolean) =>
  invoke<Todo>("set_completed", { id, done, tzOffsetMinutes: tzOffsetMinutes() });

export const moveTodo = (
  id: number,
  projectId: number | null,
  beforeId: number | null,
  afterId: number | null,
) => invoke<number>("move_todo", { id, projectId, beforeId, afterId });

export const activityHeatmap = (from: string, to: string) =>
  invoke<DayCount[]>("activity_heatmap", { from, to });

export const activityRange = (from: string, to: string) =>
  invoke<ActivityDay[]>("activity_range", { from, to });

export const getSettings = () => invoke<Record<string, string>>("get_settings");
export const setSetting = (key: string, value: string) =>
  invoke<void>("set_setting", { key, value });
