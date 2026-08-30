import * as api from "../api";
import * as dates from "../dates";
import { append, el, icon, replace } from "../dom";
import * as store from "../store";

const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

let counts = new Map<string, number>();
let days: api.ActivityDay[] = [];
// Opens on the last week, which usually has something in it; clicking a
// square narrows to a single day.
let from = dates.addDays(dates.today(), -6);
let to = dates.today();
let loading = false;
let stale = true;

/** Marks the activity data dirty so the next render refetches it. */
export function invalidateActivity(): void {
  stale = true;
}

export function setRange(nextFrom: string, nextTo: string): void {
  from = nextFrom > nextTo ? nextTo : nextFrom;
  to = nextFrom > nextTo ? nextFrom : nextTo;
  stale = true;
  store.emit();
}

async function load(): Promise<void> {
  if (loading) return;
  loading = true;
  stale = false;
  await store.guard(async () => {
    const yearAgo = dates.addDays(dates.addMonths(dates.today(), -12), 1);
    const [heat, range] = await Promise.all([
      api.activityHeatmap(yearAgo, dates.today()),
      api.activityRange(from, to),
    ]);
    counts = new Map(heat.map((d) => [d.date, d.count]));
    days = range;
  });
  loading = false;
  store.emit();
}

function level(count: number, max: number): number {
  if (count <= 0) return 0;
  if (max <= 1) return 1;
  return Math.min(4, Math.ceil((count / max) * 4));
}

function currentStreak(): number {
  let streak = 0;
  let cursor = dates.today();
  // Today not being done yet should not break yesterday's streak.
  if (!counts.get(cursor)) cursor = dates.addDays(cursor, -1);
  while ((counts.get(cursor) ?? 0) > 0) {
    streak += 1;
    cursor = dates.addDays(cursor, -1);
  }
  return streak;
}

function tooltip(text: string, anchor: HTMLElement): void {
  const tip = el("div", { class: "tooltip" }, text);
  document.body.appendChild(tip);
  const rect = anchor.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  tip.style.left = `${Math.max(6, rect.left + rect.width / 2 - tipRect.width / 2)}px`;
  tip.style.top = `${rect.top - tipRect.height - 6}px`;
  const remove = () => tip.remove();
  anchor.addEventListener("pointerleave", remove, { once: true });
  anchor.addEventListener("pointerdown", remove, { once: true });
}

function heatmap(): HTMLElement {
  const today = dates.today();
  const start = dates.startOfWeek(dates.addDays(dates.addMonths(today, -12), 1));
  const end = dates.addDays(dates.startOfWeek(today), 6);
  const max = Math.max(1, ...counts.values());

  // Columns are whole weeks; both rows share the template so month labels
  // line up with the squares underneath them.
  const weeks = Math.round((dates.daysUntil(end) - dates.daysUntil(start) + 1) / 7);
  const template = `repeat(${weeks}, 11px)`;
  const grid = el("div", { class: "heatmap-grid", style: { "grid-template-columns": template } });
  const months = el("div", {
    class: "heatmap-months",
    style: { "grid-template-columns": template },
  });

  let column = 0;
  let lastMonth = "";
  for (let date = start; date <= end; date = dates.addDays(date, 1)) {
    const weekday = dates.weekday(date);
    if (weekday === 0) {
      column += 1;
      const month = date.slice(0, 7);
      // Label a column when its week opens a new month, GitHub-style.
      if (month !== lastMonth && Number(date.slice(8)) <= 7) {
        lastMonth = month;
        months.appendChild(
          el(
            "span",
            { style: { "grid-column": `${column} / span 4`, "grid-row": "1" } },
            dates.monthName(date),
          ),
        );
      }
    }

    const future = date > today;
    const count = counts.get(date) ?? 0;
    const cell = el("button", {
      class: `day-cell${future ? " is-empty" : ""}${date >= from && date <= to ? " is-selected" : ""}`,
      dataset: { level: String(level(count, max)), date },
      attrs: {
        "aria-label": `${count} completed on ${dates.formatDate(date)}`,
        tabindex: future ? "-1" : "0",
      },
      on: {
        pointerenter: (ev) => {
          const label = count === 1 ? "1 todo completed" : `${count} todos completed`;
          tooltip(`${label} on ${dates.formatDate(date)}`, ev.currentTarget as HTMLElement);
        },
        click: () => setRange(date, date),
      },
    });
    grid.appendChild(cell);
  }

  const dayLabels = el(
    "div",
    { class: "heatmap-days" },
    ...WEEKDAY_LABELS.map((label) => el("span", {}, label)),
  );

  const legend = el(
    "div",
    { class: "heatmap-legend" },
    el("span", {}, "Less"),
    ...[0, 1, 2, 3, 4].map((l) => el("span", { class: "day-cell", dataset: { level: String(l) } })),
    el("span", {}, "More"),
  );

  return el(
    "div",
    { class: "activity-card" },
    el("div", { class: "heatmap-scroll" }, el("div", { class: "heatmap" }, months, dayLabels, grid)),
    legend,
  );
}

function presets(): HTMLElement[] {
  const today = dates.today();
  const options: [string, string, string][] = [
    ["Today", today, today],
    ["Last 7 days", dates.addDays(today, -6), today],
    ["This month", dates.startOfMonth(today), today],
    ["Last 12 months", dates.addDays(dates.addMonths(today, -12), 1), today],
  ];
  return options.map(([label, f, t]) =>
    el(
      "button",
      {
        class: `toggle${from === f && to === t ? " is-on" : ""}`,
        on: { click: () => setRange(f, t) },
      },
      label,
    ),
  );
}

function dateInput(value: string, onChange: (value: string) => void): HTMLElement {
  return el("input", {
    type: "date",
    value,
    on: {
      change: (ev) => {
        const next = (ev.currentTarget as HTMLInputElement).value;
        if (dates.isValidISO(next)) onChange(next);
      },
    },
  });
}

export function renderActivity(root: HTMLElement): void {
  if (stale) void load();

  const yearTotal = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const streak = currentStreak();
  const rangeTotal = days.reduce((sum, day) => sum + day.items.length, 0);

  const header = el(
    "div",
    { class: "view-header" },
    el(
      "div",
      {},
      el("h1", {}, "Activity"),
      el("div", { class: "subtitle" }, "Todos you have completed"),
    ),
  );

  const summary = el(
    "div",
    { class: "stat-row" },
    el(
      "div",
      { class: "stat-card" },
      el("strong", {}, yearTotal),
      el("span", {}, "completed in the last year"),
    ),
    el(
      "div",
      { class: "stat-card" },
      el("strong", {}, streak),
      el("span", {}, "day streak"),
    ),
  );

  const rangeBar = el(
    "div",
    { class: "range-bar" },
    dateInput(from, (value) => setRange(value, to)),
    el("span", { class: "sep" }, "to"),
    dateInput(to, (value) => setRange(from, value)),
    ...presets(),
  );

  const detail = el("div", {});
  const rangeLabel =
    from === to
      ? dates.formatDateFull(from)
      : `${dates.formatDate(from)} to ${dates.formatDate(to)}`;
  append(detail, [
    el(
      "div",
      { class: "group-heading" },
      `${rangeLabel}: ${rangeTotal} ${rangeTotal === 1 ? "todo" : "todos"}`,
    ),
  ]);

  if (days.length === 0) {
    detail.appendChild(
      el(
        "div",
        { class: "empty" },
        icon("activity", 32),
        el("strong", {}, "Nothing completed in this range"),
        "Pick another date, or check something off.",
      ),
    );
  }

  for (const day of days) {
    detail.appendChild(
      el(
        "div",
        { class: "day-group" },
        el(
          "h3",
          {},
          dates.formatDateFull(day.date),
          el("span", {}, `${day.items.length} ${day.items.length === 1 ? "todo" : "todos"}`),
        ),
        ...day.items.map((item) =>
          el(
            "div",
            { class: "done-item" },
            el("span", { class: "time" }, dates.formatTime(item.at)),
            el("span", { class: "name" }, item.title),
            ...item.tags.map((tag) => el("span", { class: "tag" }, `#${tag}`)),
            el("span", { class: "project" }, item.projectName),
          ),
        ),
      ),
    );
  }

  replace(root, header, el("div", { class: "scroll" }, summary, heatmap(), rangeBar, detail));
}
