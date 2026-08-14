/**
 * Pointer-driven reordering for a vertical list of rows.
 *
 * Geometry is measured once when the drag starts, so every pointermove is
 * arithmetic on that snapshot instead of a layout read.
 */

interface Row {
  id: number;
  el: HTMLElement;
  top: number;
  height: number;
  mid: number;
}

export interface DragOptions {
  /** Rows to consider, in visual order. */
  rows: () => HTMLElement[];
  /** Scroll container used for edge autoscrolling. */
  scroller: HTMLElement;
  onDrop: (id: number, beforeId: number | null, afterId: number | null) => void;
}

const DRAG_THRESHOLD = 4;
const EDGE = 48;
const EDGE_SPEED = 12;

export function attachDrag(container: HTMLElement, options: DragOptions): void {
  container.addEventListener("pointerdown", (ev) => {
    const target = ev.target as HTMLElement;
    const grip = target.closest<HTMLElement>(".grip");
    if (!grip || ev.button !== 0) return;
    const handle = grip.closest<HTMLElement>("[data-id]");
    if (!handle) return;
    ev.preventDefault();
    startDrag(container, ev, handle, options);
  });
}

function startDrag(
  container: HTMLElement,
  down: PointerEvent,
  handle: HTMLElement,
  options: DragOptions,
): void {
  const elements = options.rows();
  const index = elements.indexOf(handle);
  if (index < 0) return;

  const rows: Row[] = elements.map((el) => {
    const rect = el.getBoundingClientRect();
    return {
      id: Number(el.dataset.id),
      el,
      top: rect.top,
      height: rect.height,
      mid: rect.top + rect.height / 2,
    };
  });
  const dragged = rows[index];
  const others = rows.filter((_, i) => i !== index);
  const step = dragged.height;

  let started = false;
  let dy = 0;
  let scrolled = 0;
  let targetIndex = index;
  let autoscroll = 0;
  let pointerY = down.clientY;

  const line = document.createElement("div");
  line.className = "drop-line";

  const begin = () => {
    started = true;
    dragged.el.classList.add("is-dragging");
    dragged.el.setPointerCapture(down.pointerId);
    for (const row of others) row.el.classList.add("is-shifting");
    container.appendChild(line);
  };

  const layout = () => {
    const y = pointerY + scrolled;
    targetIndex = others.filter((row) => row.mid < y).length;

    dragged.el.style.transform = `translateY(${dy + scrolled}px)`;
    others.forEach((row, j) => {
      const wasBelow = row.top > dragged.top;
      const shift = (wasBelow ? -step : 0) + (j >= targetIndex ? step : 0);
      row.el.style.transform = shift ? `translateY(${shift}px)` : "";
    });

    // The insertion line sits where the row will land.
    const anchor = others[targetIndex - 1];
    const containerTop = container.getBoundingClientRect().top;
    const lineY = anchor
      ? anchor.top + anchor.height + (anchor.top > dragged.top ? -step : 0)
      : rows[0].top;
    line.style.top = `${lineY - containerTop - 1}px`;
  };

  const tick = () => {
    const rect = options.scroller.getBoundingClientRect();
    let delta = 0;
    if (pointerY < rect.top + EDGE) delta = -EDGE_SPEED;
    else if (pointerY > rect.bottom - EDGE) delta = EDGE_SPEED;
    if (delta) {
      const before = options.scroller.scrollTop;
      options.scroller.scrollTop += delta;
      const moved = options.scroller.scrollTop - before;
      if (moved) {
        scrolled += moved;
        // Rows scrolled with the container; the snapshot moves with them.
        for (const row of rows) {
          row.top -= moved;
          row.mid -= moved;
        }
        layout();
      }
    }
    autoscroll = requestAnimationFrame(tick);
  };

  const onMove = (ev: PointerEvent) => {
    pointerY = ev.clientY;
    dy = ev.clientY - down.clientY;
    if (!started) {
      if (Math.abs(dy) < DRAG_THRESHOLD) return;
      begin();
      autoscroll = requestAnimationFrame(tick);
    }
    layout();
  };

  const cleanup = () => {
    cancelAnimationFrame(autoscroll);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey, true);
    line.remove();
    dragged.el.classList.remove("is-dragging");
    dragged.el.style.transform = "";
    for (const row of others) {
      row.el.classList.remove("is-shifting");
      row.el.style.transform = "";
    }
  };

  const onUp = () => {
    const moved = started;
    const before = others[targetIndex - 1]?.id ?? null;
    const after = others[targetIndex]?.id ?? null;
    cleanup();
    if (moved && targetIndex !== index) options.onDrop(dragged.id, before, after);
  };

  const onCancel = () => cleanup();

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      cleanup();
    }
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKey, true);
}
