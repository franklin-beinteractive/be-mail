// Settings -> Tasks: the board columns (name, colour, "counts as done") and
// their order, changed by dragging a row by its grip. The same columns can
// also be edited on the board itself.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useApp } from "../../lib/ctx";
import { COLORS, todoApi, useTodo, type Column } from "../../lib/todo";
import { GripIcon, TrashIcon } from "../Icons";
import DeleteColumnDialog from "./DeleteColumnDialog";

/** Rows slide to their new place after a reorder (same feel as the board). */
const FLIP_MS = 200;
const FLIP_EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

type DropMark = { id: number; after: boolean };

function ColumnRow({
  column,
  only,
  dragging,
  mark,
  onGripDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onStep,
  onDelete,
}: {
  column: Column;
  only: boolean;
  dragging: boolean;
  mark: "before" | "after" | null;
  onGripDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onStep: (delta: number) => void;
  onDelete: () => void;
}) {
  const { t, tip, notify } = useApp();
  const [name, setName] = useState(column.name);
  useEffect(() => setName(column.name), [column.name]);

  async function save(patch: Partial<Column>) {
    try {
      await todoApi.saveColumn({ ...column, ...patch });
    } catch (e) {
      notify(String(e), "error");
      setName(column.name);
    }
  }

  return (
    <div
      className={
        "setting-row todo-action-row todo-col-row" +
        (dragging ? " dragging" : "") +
        (mark ? ` drop-${mark}` : "")
      }
      data-row={column.id}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <button
        className="icon-btn todo-grip"
        data-grip={column.id}
        draggable
        onDragStart={onGripDragStart}
        onDragEnd={onDragEnd}
        // Keyboard users move the row with the up and down keys.
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            onStep(e.key === "ArrowUp" ? -1 : 1);
          }
        }}
        title={tip("todoDragRow")}
        aria-label={`${t("todoDragRow")}: ${column.name}`}
      >
        <GripIcon size={16} />
      </button>
      <input
        type="color"
        className="todo-color-input"
        value={column.color || COLORS[0]}
        onChange={(e) => void save({ color: e.target.value })}
        aria-label={t("todoColor")}
      />
      <input
        className="todo-action-label"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() !== column.name && void save({ name })}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        aria-label={t("todoName")}
      />
      <label className="todo-waiting-check small">
        <input
          type="checkbox"
          checked={column.done}
          onChange={(e) => void save({ done: e.target.checked })}
        />
        {t("todoColumnDone")}
      </label>
      <button
        className="icon-btn todo-action-delete"
        onClick={onDelete}
        disabled={only}
        title={only ? t("todoLastColumn") : tip("delete")}
        aria-label={t("delete")}
      >
        <TrashIcon size={16} />
      </button>
    </div>
  );
}

export default function TodoSettings() {
  const { t, notify } = useApp();
  const data = useTodo();
  const columns = data?.columns ?? [];

  const listRef = useRef<HTMLDivElement>(null);
  const dragId = useRef<number | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropMark, setDropMark] = useState<DropMark | null>(null);
  const [deleting, setDeleting] = useState<Column | null>(null);

  // Where each row was before a reorder, so the next render can slide it.
  const flipFrom = useRef<{ at: number; tops: Map<string, number> } | null>(null);
  useLayoutEffect(() => {
    const from = flipFrom.current;
    const root = listRef.current;
    if (!from || !root) return;
    // The new order arrives after a round trip to the database.
    if (performance.now() - from.at > 2000) {
      flipFrom.current = null;
      return;
    }
    const rows = [...root.querySelectorAll<HTMLElement>("[data-row]")];
    let moved = false;
    for (const row of rows) {
      const old = from.tops.get(row.dataset.row!);
      const dy = old == null ? 0 : old - row.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;
      moved = true;
      row.animate({ transform: [`translateY(${dy}px)`, "none"] }, { duration: FLIP_MS, easing: FLIP_EASE });
    }
    if (moved) flipFrom.current = null;
  });

  async function reorder(ids: number[], focusId?: number) {
    if (ids.every((id, i) => id === columns[i]?.id)) return;
    const root = listRef.current;
    if (root && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const tops = new Map<string, number>();
      root.querySelectorAll<HTMLElement>("[data-row]").forEach((r) => tops.set(r.dataset.row!, r.getBoundingClientRect().top));
      flipFrom.current = { at: performance.now(), tops };
    }
    try {
      await todoApi.reorder("column", ids);
      // Moving a row in the DOM drops focus; give it back to the grip.
      if (focusId != null) root?.querySelector<HTMLElement>(`[data-grip="${focusId}"]`)?.focus();
    } catch (e) {
      flipFrom.current = null;
      notify(String(e), "error");
    }
  }

  function dropOn(targetId: number, after: boolean) {
    const id = dragId.current;
    if (id == null || id === targetId) return;
    const ids = columns.map((c) => c.id).filter((x) => x !== id);
    ids.splice(ids.indexOf(targetId) + (after ? 1 : 0), 0, id);
    void reorder(ids);
  }

  function step(index: number, delta: number) {
    const to = index + delta;
    if (to < 0 || to >= columns.length) return;
    const ids = columns.map((c) => c.id);
    [ids[index], ids[to]] = [ids[to], ids[index]];
    void reorder(ids, ids[to]);
  }

  function endDrag() {
    dragId.current = null;
    setDraggingId(null);
    setDropMark(null);
  }

  async function add() {
    try {
      await todoApi.saveColumn({
        name: t("todoNewColumn"),
        done: false,
        color: COLORS[columns.length % COLORS.length],
      });
    } catch (e) {
      notify(String(e), "error");
    }
  }

  return (
    <section className="settings-block">
      <h2>{t("todoColumns")}</h2>
      <p className="muted small">{t("todoColumnsHint")}</p>
      <div ref={listRef}>
        {columns.map((c, i) => (
          <ColumnRow
            key={c.id}
            column={c}
            only={columns.length <= 1}
            dragging={draggingId === c.id}
            mark={dropMark?.id === c.id ? (dropMark.after ? "after" : "before") : null}
            onGripDragStart={(e) => {
              dragId.current = c.id;
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", c.name);
              // Drag the whole row, not just the grip.
              const row = e.currentTarget.closest<HTMLElement>("[data-row]");
              if (row) {
                const r = row.getBoundingClientRect();
                e.dataTransfer.setDragImage(row, e.clientX - r.left, e.clientY - r.top);
              }
              window.setTimeout(() => setDraggingId(c.id), 0);
            }}
            onDragEnd={endDrag}
            onDragOver={(e) => {
              if (dragId.current == null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const r = e.currentTarget.getBoundingClientRect();
              const after = e.clientY > r.top + r.height / 2;
              const next = dragId.current === c.id ? null : { id: c.id, after };
              if (next?.id !== dropMark?.id || next?.after !== dropMark?.after) setDropMark(next);
            }}
            onDrop={(e) => {
              if (dragId.current == null) return;
              e.preventDefault();
              if (dropMark) dropOn(dropMark.id, dropMark.after);
              endDrag();
            }}
            onStep={(d) => step(i, d)}
            onDelete={() => setDeleting(c)}
          />
        ))}
      </div>
      <button className="btn" onClick={() => void add()}>
        + {t("add")}
      </button>
      {deleting && (
        <DeleteColumnDialog
          column={deleting}
          onCancel={() => setDeleting(null)}
          onDeleted={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
