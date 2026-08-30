import * as dates from "../dates";
import { attachDrag } from "../dnd";
import { append, el, icon, replace } from "../dom";
import * as store from "../store";
import { state, type Todo } from "../store";

let editingId: number | null = null;
let quickAdd: HTMLInputElement | null = null;

/** Focuses the quick-add box, seeding it with the character that summoned it. */
export function startQuickAdd(initial = ""): void {
  if (!quickAdd) return;
  quickAdd.value += initial;
  quickAdd.focus();
}

export function beginEdit(id: number | null): void {
  editingId = id;
  store.emit();
}

const WEEKDAY_WORDS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Pulls `#tags` and an `@due` token out of a quick-add line. */
export function parseInput(raw: string): { title: string; tags: string[]; dueDate: string | null } {
  const tags: string[] = [];
  let dueDate: string | null = null;

  const title = raw
    .replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (_m, space: string, tag: string) => {
      tags.push(tag.toLowerCase());
      return space;
    })
    .replace(/(^|\s)@(\S+)/g, (match, space: string, token: string) => {
      const parsed = parseDueToken(token.toLowerCase());
      if (parsed === null) return match;
      dueDate = parsed;
      return space;
    })
    .replace(/\s+/g, " ")
    .trim();

  return { title, tags, dueDate };
}

function parseDueToken(token: string): string | null {
  if (token === "today") return dates.today();
  if (token === "tomorrow" || token === "tmr") return dates.addDays(dates.today(), 1);
  if (dates.isValidISO(token)) return token;

  const weekday = WEEKDAY_WORDS.findIndex((d) => d.startsWith(token) && token.length >= 3);
  if (weekday >= 0) {
    const from = dates.today();
    const ahead = (weekday - dates.weekday(from) + 7) % 7 || 7;
    return dates.addDays(from, ahead);
  }
  const days = /^\+(\d+)d?$/.exec(token);
  if (days) return dates.addDays(dates.today(), Number(days[1]));
  return null;
}

function dueBadge(todo: Todo): HTMLElement | null {
  if (!todo.dueDate || todo.completedAt !== null) return null;
  const days = dates.daysUntil(todo.dueDate);
  const cls = days < 0 ? " is-overdue" : days === 0 ? " is-due" : "";
  return el("span", { class: `due${cls}`, title: dates.formatDateFull(todo.dueDate) },
    dates.formatDue(todo.dueDate));
}

function todoRow(todo: Todo, draggable: boolean): HTMLElement {
  const done = todo.completedAt !== null;
  const selected = state.selectedId === todo.id;

  if (editingId === todo.id) return editorRow(todo);

  const meta = el(
    "span",
    { class: "todo-meta" },
    dueBadge(todo),
    state.view.kind !== "project" ? el("span", {}, todo.projectName) : null,
    ...todo.tags.map((tag) =>
      el(
        "button",
        {
          class: "tag",
          on: {
            click: (ev) => {
              ev.stopPropagation();
              store.setView({ kind: "tag", name: tag });
            },
          },
        },
        `#${tag}`,
      ),
    ),
  );

  const row = el(
    "li",
    {
      class: `todo${done ? " is-done" : ""}${selected ? " is-selected" : ""}`,
      dataset: { id: String(todo.id) },
      on: {
        click: () => {
          state.selectedId = todo.id;
          store.emit();
        },
        dblclick: () => beginEdit(todo.id),
      },
    },
    draggable
      ? el("span", { class: "grip", title: "Drag to reorder" }, icon("grip"))
      : el("span", { class: "grip is-hidden" }, icon("grip")),
    el(
      "button",
      {
        class: "checkbox",
        title: done ? "Mark as not done" : "Mark as done",
        on: {
          click: (ev) => {
            ev.stopPropagation();
            store.toggleTodo(todo.id);
          },
        },
      },
      icon("check", 12),
    ),
    el(
      "span",
      { class: "todo-body" },
      el("span", { class: "todo-title" }, todo.title),
      meta.childNodes.length ? meta : null,
    ),
    el(
      "button",
      {
        class: "row-action",
        title: "Delete",
        on: {
          click: (ev) => {
            ev.stopPropagation();
            store.removeTodo(todo.id);
          },
        },
      },
      icon("x", 12),
    ),
  );
  return row;
}

/** Inline editor: title, due date and tags, saved with Enter. */
function editorRow(todo: Todo): HTMLElement {
  const title = el("input", { class: "title-input", value: todo.title }) as HTMLInputElement;
  const due = el("input", { type: "date", value: todo.dueDate ?? "" }) as HTMLInputElement;
  const tags = el("input", {
    class: "title-input is-tags",
    value: todo.tags.map((t) => `#${t}`).join(" "),
    placeholder: "#tags",
  }) as HTMLInputElement;

  const save = () => {
    const parsed = parseInput(`${title.value} ${tags.value}`);
    editingId = null;
    store.editTodo(todo.id, {
      title: parsed.title || todo.title,
      dueDate: due.value || null,
      tags: parsed.tags,
    });
  };
  const cancel = () => beginEdit(null);

  const onKey = (ev: KeyboardEvent) => {
    ev.stopPropagation();
    if (ev.key === "Enter") save();
    if (ev.key === "Escape") cancel();
  };
  for (const input of [title, due, tags]) input.addEventListener("keydown", onKey);

  queueMicrotask(() => {
    title.focus();
    title.select();
  });

  return el(
    "li",
    { class: "todo is-selected", dataset: { id: String(todo.id) } },
    el("span", { class: "grip is-hidden" }, icon("grip")),
    el("span", { class: "todo-body todo-editor" }, title, due, tags),
    el("button", { class: "btn is-primary", on: { click: save } }, "Save"),
  );
}

interface Group {
  heading: string | null;
  todos: Todo[];
}

function groupTodos(todos: Todo[]): Group[] {
  if (!state.groupByDue) return [{ heading: null, todos }];

  const buckets: Group[] = [
    { heading: "Overdue", todos: [] },
    { heading: "Today", todos: [] },
    { heading: "Upcoming", todos: [] },
    { heading: "No date", todos: [] },
  ];
  for (const todo of todos) {
    if (!todo.dueDate) buckets[3].todos.push(todo);
    else {
      const days = dates.daysUntil(todo.dueDate);
      buckets[days < 0 ? 0 : days === 0 ? 1 : 2].todos.push(todo);
    }
  }
  for (const bucket of buckets.slice(0, 3)) {
    bucket.todos.sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  }
  return buckets.filter((b) => b.todos.length > 0);
}

function viewTitle(): { title: string; subtitle: string; greet: boolean } {
  const view = state.view;
  switch (view.kind) {
    case "project": {
      const project = state.projects.find((p) => p.id === view.id);
      return {
        title: project?.name ?? "List",
        subtitle: project?.isDefault
          ? dates.formatDateFull(dates.today())
          : "Project",
        greet: project?.isDefault === true,
      };
    }
    case "tag":
      return { title: `#${view.name}`, subtitle: "Tagged across all projects", greet: false };
    default:
      return { title: "All todos", subtitle: "Every project at once", greet: false };
  }
}

export function renderList(root: HTMLElement): void {
  const scroller = el("div", { class: "scroll" });
  const { title, subtitle, greet } = viewTitle();
  const active = state.todos.filter((t) => t.completedAt === null);
  const done = state.todos.filter((t) => t.completedAt !== null);
  const draggable = store.canReorder();

  const header = el(
    "div",
    { class: "view-header" },
    el(
      "div",
      {},
      greet ? el("div", { class: "greeting" }, dates.greeting()) : null,
      el("h1", {}, title),
      el("div", { class: "subtitle" }, subtitle),
    ),
    el("div", { class: "spacer" }),
    el(
      "div",
      { class: "header-actions" },
      el(
        "button",
        {
          class: `toggle${state.groupByDue ? " is-on" : ""}`,
          title: "Group by due date (reordering is off while grouped)",
          on: { click: () => store.toggleSetting("groupByDue") },
        },
        "Group by due date",
      ),
      el(
        "button",
        {
          class: `toggle${state.showCompleted ? " is-on" : ""}`,
          on: { click: () => store.toggleSetting("showCompleted") },
        },
        "Show completed",
      ),
    ),
  );

  const input = el("input", {
    placeholder:
      state.view.kind === "tag"
        ? `New todo, tagged #${state.view.name}`
        : "Add a todo, then press Enter",
    on: {
      keydown: (ev) => {
        ev.stopPropagation();
        if (ev.key !== "Enter") return;
        const value = (ev.currentTarget as HTMLInputElement).value;
        const parsed = parseInput(value);
        if (!parsed.title) return;
        if (state.view.kind === "tag" && !parsed.tags.includes(state.view.name)) {
          parsed.tags.push(state.view.name);
        }
        (ev.currentTarget as HTMLInputElement).value = "";
        store.addTodo(parsed.title, parsed.dueDate, parsed.tags);
      },
    },
  }) as HTMLInputElement;
  quickAdd = input;

  const body: HTMLElement[] = [
    el(
      "div",
      { class: "quick-add" },
      icon("plus", 13),
      input,
      el("span", { class: "hint" }, "#tag  @today"),
    ),
  ];

  if (active.length === 0 && done.length === 0) {
    body.push(
      el(
        "div",
        { class: "empty" },
        icon("list", 32),
        el("strong", {}, "Nothing here yet"),
        "Type above to add your first todo.",
      ),
    );
  }

  for (const group of groupTodos(active)) {
    if (group.heading) body.push(el("div", { class: "group-heading" }, group.heading));
    const list = el("ul", { class: "todo-list" }, ...group.todos.map((t) => todoRow(t, draggable)));
    if (draggable && !group.heading) {
      attachDrag(list, {
        rows: () => Array.from(list.querySelectorAll<HTMLElement>("li.todo")),
        scroller,
        onDrop: (id, before, after) => store.reorder(id, before, after),
      });
    }
    body.push(list);
  }

  if (done.length > 0) {
    body.push(el("div", { class: "group-heading" }, `Completed (${done.length})`));
    body.push(el("ul", { class: "todo-list" }, ...done.map((t) => todoRow(t, false))));
  }

  append(scroller, body);
  replace(root, header, scroller);
}
