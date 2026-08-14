/**
 * Dev-only stand-in for the Rust backend, so the UI can be opened in a plain
 * browser (`npm run dev`) without the desktop shell. Never bundled in a
 * production build: it is imported behind `import.meta.env.DEV`.
 */
import type { ActivityDay, DayCount, Project, Tag, Todo, TodoPatch, TodoQuery } from "./api";

interface Event {
  todoId: number | null;
  title: string;
  projectName: string;
  tags: string[];
  kind: "complete" | "uncomplete";
  at: number;
  date: string;
}

let nextId = 1;
const projects: Project[] = [
  { id: nextId++, name: "Inbox", position: 1, isDefault: true, openCount: 0 },
  { id: nextId++, name: "jata", position: 2, isDefault: false, openCount: 0 },
  { id: nextId++, name: "House", position: 3, isDefault: false, openCount: 0 },
];
const todos: Todo[] = [];
const events: Event[] = [];
const settings: Record<string, string> = {};

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shift = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return iso(d);
};

function seedTodo(projectId: number, title: string, dueDate: string | null, tags: string[]) {
  const project = projects.find((p) => p.id === projectId)!;
  const todo: Todo = {
    id: nextId++,
    projectId,
    projectName: project.name,
    title,
    notes: "",
    dueDate,
    position: todos.filter((t) => t.projectId === projectId).length + 1,
    completedAt: null,
    createdAt: Math.floor(Date.now() / 1000),
    tags,
  };
  todos.push(todo);
  return todo;
}

seedTodo(1, "Buy milk", shift(0), ["errands"]);
seedTodo(1, "Call the dentist", shift(-2), ["errands"]);
seedTodo(1, "Read the Tauri 2 changelog", null, []);
seedTodo(2, "Hand-roll the drag reordering", null, ["code"]);
seedTodo(2, "Draw the activity heatmap", shift(3), ["code"]);
seedTodo(2, "Write the README", shift(7), []);
seedTodo(3, "Replace the kitchen bulb", null, []);

// A year of plausible completion history for the heatmap.
let seed = 42;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let day = 364; day >= 0; day--) {
  const date = shift(-day);
  const weekend = [0, 6].includes(new Date(date).getDay());
  const count = Math.floor(random() * (weekend ? 3 : 6)) - 1;
  for (let i = 0; i < count; i++) {
    events.push({
      todoId: null,
      title: ["Fix a bug", "Review a PR", "Tidy the kitchen", "Write notes", "Pay a bill"][
        Math.floor(random() * 5)
      ],
      projectName: projects[Math.floor(random() * projects.length)].name,
      tags: [],
      kind: "complete",
      at: Math.floor(new Date(`${date}T09:00:00`).getTime() / 1000) + i * 3600,
      date,
    });
  }
}

const withCounts = (): Project[] =>
  projects.map((p) => ({
    ...p,
    openCount: todos.filter((t) => t.projectId === p.id && t.completedAt === null).length,
  }));

function matches(todo: Todo, query: TodoQuery): boolean {
  if (query.projectId != null && todo.projectId !== query.projectId) return false;
  if (query.tag && !todo.tags.includes(query.tag)) return false;
  if (query.search && !todo.title.toLowerCase().includes(query.search.toLowerCase())) return false;
  if (!query.includeCompleted && todo.completedAt !== null) return false;
  return true;
}

export async function mockInvoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const a = args as any;
  switch (command) {
    case "list_projects":
      return withCounts() as T;
    case "create_project":
      projects.push({ id: nextId++, name: a.name.trim(), position: projects.length + 1, isDefault: false, openCount: 0 });
      return withCounts() as T;
    case "rename_project": {
      const project = projects.find((p) => p.id === a.id)!;
      project.name = a.name;
      for (const todo of todos) if (todo.projectId === project.id) todo.projectName = project.name;
      return withCounts() as T;
    }
    case "delete_project": {
      for (const todo of todos) {
        if (todo.projectId === a.id) {
          todo.projectId = projects[0].id;
          todo.projectName = projects[0].name;
        }
      }
      projects.splice(projects.findIndex((p) => p.id === a.id), 1);
      return withCounts() as T;
    }
    case "list_tags": {
      const names = new Set(todos.flatMap((t) => t.tags));
      return [...names].sort().map<Tag>((name) => ({
        name,
        openCount: todos.filter((t) => t.tags.includes(name) && t.completedAt === null).length,
      })) as T;
    }
    case "list_todos":
      return todos
        .filter((t) => matches(t, a.query))
        .sort((x, y) =>
          (x.completedAt === null ? 0 : 1) - (y.completedAt === null ? 0 : 1) ||
          (x.completedAt === null ? x.position - y.position : (y.completedAt ?? 0) - (x.completedAt ?? 0)),
        )
        .map((t) => ({ ...t })) as T;
    case "create_todo":
      return seedTodo(a.projectId ?? projects[0].id, a.title, a.dueDate, a.tags) as T;
    case "update_todo": {
      const todo = todos.find((t) => t.id === a.id)!;
      const patch = a.patch as TodoPatch;
      if (patch.title !== undefined) todo.title = patch.title;
      if (patch.dueDate !== undefined) todo.dueDate = patch.dueDate;
      if (patch.tags !== undefined) todo.tags = patch.tags;
      return todo as T;
    }
    case "delete_todo":
      todos.splice(todos.findIndex((t) => t.id === a.id), 1);
      return undefined as T;
    case "set_completed": {
      const todo = todos.find((t) => t.id === a.id)!;
      const at = Math.floor(Date.now() / 1000);
      todo.completedAt = a.done ? at : null;
      events.push({
        todoId: todo.id,
        title: todo.title,
        projectName: todo.projectName,
        tags: todo.tags,
        kind: a.done ? "complete" : "uncomplete",
        at,
        date: iso(new Date()),
      });
      return todo as T;
    }
    case "move_todo": {
      const todo = todos.find((t) => t.id === a.id)!;
      const before = todos.find((t) => t.id === a.beforeId);
      const after = todos.find((t) => t.id === a.afterId);
      todo.position = before && after
        ? (before.position + after.position) / 2
        : before
          ? before.position + 1
          : after
            ? after.position - 1
            : todo.position;
      return todo.position as T;
    }
    case "activity_heatmap": {
      const counts = new Map<string, number>();
      for (const e of events) {
        if (e.date < a.from || e.date > a.to) continue;
        counts.set(e.date, (counts.get(e.date) ?? 0) + (e.kind === "complete" ? 1 : -1));
      }
      return [...counts]
        .filter(([, count]) => count > 0)
        .sort()
        .map<DayCount>(([date, count]) => ({ date, count })) as T;
    }
    case "activity_range": {
      const days = new Map<string, ActivityDay>();
      for (const e of events) {
        if (e.date < a.from || e.date > a.to) continue;
        const day = days.get(e.date) ?? { date: e.date, items: [] };
        if (e.kind === "complete") {
          day.items.push({ title: e.title, projectName: e.projectName, tags: e.tags, at: e.at, date: e.date });
        } else {
          const index = day.items.findIndex((i) => i.title === e.title);
          if (index >= 0) day.items.splice(index, 1);
        }
        days.set(e.date, day);
      }
      return [...days.values()]
        .filter((d) => d.items.length > 0)
        .sort((x, y) => y.date.localeCompare(x.date))
        .map((d) => ({ ...d, items: [...d.items].sort((i, j) => j.at - i.at) })) as T;
    }
    case "get_settings":
      return { ...settings } as T;
    case "set_setting":
      settings[a.key] = a.value;
      return undefined as T;
    default:
      throw new Error(`mock: unknown command ${command}`);
  }
}
