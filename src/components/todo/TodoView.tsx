// Task board: the projects on the left (cards can be dropped on them), the
// columns of the chosen project in the middle as a Trello-style board, and
// the open card in a dialog. Columns are shared by every project.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../../lib/ctx";
import {
  addDays,
  archivedProjectIds,
  COLORS,
  archiveCutoff,
  doneColumnIds,
  formatDay,
  isArchived,
  isDue,
  isImage,
  isoDate,
  todoApi,
  useAttachmentUrl,
  useToday,
  useTodo,
  type Attachment,
  type Column,
  type MailLink,
  type Project,
  type Task,
} from "../../lib/todo";
import { ArchiveIcon, ClockIcon, EditIcon, MailIcon, PaperclipIcon, PlusIcon, SearchIcon } from "../Icons";
import CardDialog from "./CardDialog";
import ArchiveList from "./ArchiveList";
import ColumnDialog from "./ColumnDialog";
import ProjectDialog from "./ProjectDialog";

type BoardKey = "all" | "inbox" | "archive" | `p${number}`;
const BOARD_STORE = "BE-Mail.todoBoard";

/** The board shown last, if the stored value still looks like one. */
function storedBoard(): BoardKey {
  const v = localStorage.getItem(BOARD_STORE) ?? "";
  return /^(all|inbox|archive|p\d+)$/.test(v) ? (v as BoardKey) : "all";
}

/** What is being dragged right now. Kept outside React state: dragover
 *  fires many times a second and cannot read dataTransfer contents. */
type Drag = { kind: "card"; id: number } | { kind: "column"; id: number };

/** Where a dragged card would land. */
interface DropSpot {
  columnId: number;
  index: number;
}

/** Motion for cards making room and columns growing or shrinking while a
 *  card is dragged: a strong ease-out, so the board answers the pointer at once. */
const FLIP_MS = 200;
const FLIP_EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Where the cards and columns were drawn just before a drag update. */
interface FlipSnapshot {
  at: number;
  rects: Map<string, DOMRect>;
}
const flipKey = (el: HTMLElement) => (el.dataset.card ? `card${el.dataset.card}` : `col${el.dataset.col}`);

/** Layout position of a card, ignoring a slide that is still running, so the
 *  drop index does not flip back and forth while cards move. */
function layoutRect(el: HTMLElement): DOMRect {
  const r = el.getBoundingClientRect();
  const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
  return new DOMRect(r.x - m.m41, r.y - m.m42, r.width, r.height);
}

/** Sort value for a card placed between two neighbours. */
function sortBetween(prev?: Task, next?: Task): number {
  if (prev && next) return (prev.sort + next.sort) / 2;
  if (prev) return prev.sort + 1;
  if (next) return next.sort - 1;
  return 1;
}

export default function TodoView({
  onOpenMail,
  dueCount,
  onShowDue,
  openTaskId,
  onOpenTaskHandled,
}: {
  onOpenMail: (m: MailLink) => void;
  /** Cards on every board whose follow-up day has come. */
  dueCount: number;
  onShowDue: () => void;
  /** A card to open, picked in the "tasks for today" dialog. */
  openTaskId: number | null;
  onOpenTaskHandled: () => void;
}) {
  const { t, tip, notify } = useApp();
  const data = useTodo();
  const today = useToday();
  const [board, setBoardState] = useState<BoardKey>(storedBoard);
  const [openCardId, setOpenCardId] = useState<number | null>(null);
  // A card that was just added opens with the cursor in its description.
  const [openIsNew, setOpenIsNew] = useState(false);
  const [filter, setFilter] = useState("");
  const [showArchive, setShowArchive] = useState(false);
  const [projectDialog, setProjectDialog] = useState<Project | "new" | null>(null);
  const [columnDialog, setColumnDialog] = useState<Column | "new" | null>(null);
  const [addingIn, setAddingIn] = useState<number | null>(null);

  useEffect(() => {
    if (openTaskId == null) return;
    setOpenIsNew(false);
    setOpenCardId(openTaskId);
    onOpenTaskHandled();
  }, [openTaskId, onOpenTaskHandled]);

  const drag = useRef<Drag | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropSpot, setDropSpot] = useState<DropSpot | null>(null);
  const [columnDrop, setColumnDrop] = useState<{ id: number; after: boolean } | null>(null);
  const [projectDrop, setProjectDrop] = useState<string | null>(null);
  // A moved card shows in its new place right away, before the reload.
  const [pending, setPending] = useState<Map<number, Partial<Task>>>(new Map());
  useEffect(() => setPending(new Map()), [data]);

  // Drag updates animate FLIP-style: snapshot() records where everything is
  // drawn, the next commit measures the new layout and slides cards (and
  // resizes columns) from the old spot to the new one.
  const boardRef = useRef<HTMLDivElement>(null);
  const flipFrom = useRef<FlipSnapshot | null>(null);
  const dragHeight = useRef(0);

  function snapshot() {
    const root = boardRef.current;
    if (!root || reduceMotion()) return;
    const rects = new Map<string, DOMRect>();
    root.querySelectorAll<HTMLElement>("[data-card], [data-col]").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.height) rects.set(flipKey(el), r);
    });
    // A hidden dragged card lands where its placeholder is.
    const ph = root.querySelector(".board-placeholder");
    if (ph && drag.current?.kind === "card" && !rects.has(`card${drag.current.id}`)) {
      rects.set(`card${drag.current.id}`, ph.getBoundingClientRect());
    }
    flipFrom.current = { at: performance.now(), rects };
  }

  useLayoutEffect(() => {
    const from = flipFrom.current;
    flipFrom.current = null;
    const root = boardRef.current;
    // An old snapshot belongs to an update that never rendered.
    if (!from || !root || performance.now() - from.at > 150) return;
    const els = [...root.querySelectorAll<HTMLElement>("[data-card], [data-col]")];
    // Stop running slides first, so the measurements below are the real layout
    // and a new slide starts from where the element is drawn right now.
    for (const el of els) for (const a of el.getAnimations()) if (a.id === "flip") a.cancel();
    const now = els.map((el) => el.getBoundingClientRect());
    els.forEach((el, i) => {
      const old = from.rects.get(flipKey(el));
      const cur = now[i];
      if (!old || !cur.height) return;
      const opts = { duration: FLIP_MS, easing: FLIP_EASE, id: "flip" };
      if (el.dataset.col) {
        if (Math.abs(old.height - cur.height) < 1) return;
        el.classList.add("resizing");
        const a = el.animate({ height: [`${old.height}px`, `${cur.height}px`] }, opts);
        a.onfinish = a.oncancel = () => el.classList.remove("resizing");
      } else {
        const dx = old.left - cur.left;
        const dy = old.top - cur.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        el.animate({ transform: [`translate(${dx}px, ${dy}px)`, "none"] }, opts);
      }
    });
  });

  function setBoard(k: BoardKey) {
    setBoardState(k);
    localStorage.setItem(BOARD_STORE, k);
    setAddingIn(null);
  }

  const projectsById = useMemo(
    () => new Map((data?.projects ?? []).map((p) => [p.id, p])),
    [data]
  );
  const currentProject = board.startsWith("p") ? projectsById.get(Number(board.slice(1))) : undefined;
  // A remembered project that has since been deleted falls back to "all".
  useEffect(() => {
    if (data && board.startsWith("p") && !currentProject) setBoard("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, board, currentProject]);

  const doneCols = useMemo(() => doneColumnIds(data), [data]);
  const cutoff = useMemo(() => archiveCutoff(today), [today]);
  const attachmentsByTask = useMemo(() => {
    const m = new Map<number, Attachment[]>();
    for (const a of data?.attachments ?? []) {
      const list = m.get(a.taskId) ?? [];
      list.push(a);
      m.set(a.taskId, list);
    }
    return m;
  }, [data]);

  const sortedProjects = useMemo(
    () =>
      [...(data?.projects ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      ),
    [data]
  );

  // Unfinished cards per board, for the counters on the left.
  const counts = useMemo(() => {
    const archived = archivedProjectIds(data);
    const c: Record<string, number> = { all: 0, inbox: 0 };
    for (const task of data?.tasks ?? []) {
      if (doneCols.has(task.columnId) || task.archivedAt != null) continue;
      if (task.projectId == null) c.inbox++;
      else c[`p${task.projectId}`] = (c[`p${task.projectId}`] ?? 0) + 1;
      if (task.projectId == null || !archived.has(task.projectId)) c.all++;
    }
    return c;
  }, [data, doneCols]);

  // The cards on this board, with pending moves applied, per column.
  const cardsByColumn = useMemo(() => {
    const m = new Map<number, Task[]>();
    if (!data) return m;
    const archived = archivedProjectIds(data);
    const q = filter.trim().toLowerCase();
    for (const raw of data.tasks) {
      if (isArchived(raw, doneCols, cutoff)) continue;
      const task = pending.has(raw.id) ? { ...raw, ...pending.get(raw.id) } : raw;
      const onBoard =
        board === "all"
          ? task.projectId == null || !archived.has(task.projectId)
          : board === "inbox"
            ? task.projectId == null
            : task.projectId === Number(board.slice(1));
      if (!onBoard) continue;
      if (q && !`${task.title}\n${task.note}`.toLowerCase().includes(q)) continue;
      const list = m.get(task.columnId) ?? [];
      list.push(task);
      m.set(task.columnId, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.sort - b.sort || a.id - b.id);
    return m;
  }, [data, board, filter, pending, doneCols, cutoff]);

  // The archive: finished cards from every project, the latest first.
  const archiveCards = useMemo(
    () =>
      (data?.tasks ?? [])
        .filter((x) => isArchived(x, doneCols, cutoff))
        .sort(
          (a, b) =>
            (b.archivedAt ?? b.doneAt ?? "").localeCompare(a.archivedAt ?? a.doneAt ?? "") || b.id - a.id
        ),
    [data, doneCols, cutoff]
  );

  const openCard = data?.tasks.find((x) => x.id === openCardId) ?? null;

  // n = new card in the first column, / = search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (openCardId != null || projectDialog || columnDialog) return;
      if (document.querySelector(".overlay")) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.key === "n" && data?.columns[0] && board !== "archive") {
        e.preventDefault();
        setAddingIn(data.columns[0].id);
      } else if (e.key === "/") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".board-search input")?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!data) return <div className="todo centered">{t("loading")}</div>;

  // ---- Actions ----

  async function addCard(columnId: number, title: string) {
    const list = cardsByColumn.get(columnId) ?? [];
    try {
      // New work in an archived project makes it active again; otherwise
      // the card would only be visible inside the archive.
      if (currentProject?.archived) await todoApi.saveProject({ ...currentProject, archived: false });
      const saved = await todoApi.saveTask({
        title,
        projectId: currentProject?.id ?? null,
        columnId,
        sort: sortBetween(list[list.length - 1], undefined),
      });
      // Straight on to the details: description, attachments, date.
      setAddingIn(null);
      setOpenIsNew(true);
      setOpenCardId(saved.id);
    } catch (e) {
      notify(String(e), "error");
    }
  }

  function moveCard(id: number, spot: DropSpot) {
    const list = (cardsByColumn.get(spot.columnId) ?? []).filter((x) => x.id !== id);
    const sort = sortBetween(list[spot.index - 1], list[spot.index]);
    const card = data!.tasks.find((x) => x.id === id);
    if (!card) return;
    if (card.columnId === spot.columnId && card.sort === sort) return;
    setPending((m) => new Map(m).set(id, { columnId: spot.columnId, sort }));
    todoApi.patchTask(id, { columnId: spot.columnId, sort }).catch((e) => {
      setPending(new Map());
      notify(String(e), "error");
    });
  }

  function moveCardToProject(id: number, projectId: number | null) {
    const card = data!.tasks.find((x) => x.id === id);
    if (!card || card.projectId === projectId) return;
    const target = projectId != null ? projectsById.get(projectId) : undefined;
    void (async () => {
      try {
        if (target?.archived) await todoApi.saveProject({ ...target, archived: false });
        await todoApi.patchTask(id, { projectId });
        notify(`${t("todoMovedTo")} ${target?.name ?? t("todoInbox")}`, "info");
      } catch (e) {
        notify(String(e), "error");
      }
    })();
  }

  async function moveColumn(id: number, targetId: number, after: boolean) {
    if (id === targetId) return;
    const ids = data!.columns.map((c) => c.id).filter((x) => x !== id);
    const at = ids.indexOf(targetId) + (after ? 1 : 0);
    ids.splice(at, 0, id);
    try {
      await todoApi.reorder("column", ids);
    } catch (e) {
      notify(String(e), "error");
    }
  }

  function endDrag() {
    snapshot();
    drag.current = null;
    setDraggingId(null);
    setDropSpot(null);
    setColumnDrop(null);
    setProjectDrop(null);
  }

  /** Insertion index from the pointer position over a column's card list. */
  function indexAt(listEl: HTMLElement, y: number): number {
    const cards = [...listEl.querySelectorAll<HTMLElement>("[data-card]")].filter(
      (el) => Number(el.dataset.card) !== drag.current?.id
    );
    const i = cards.findIndex((el) => {
      const r = layoutRect(el);
      return y < r.top + r.height / 2;
    });
    return i === -1 ? cards.length : i;
  }

  // ---- Left: boards ----

  const boardItem = (key: BoardKey, label: string, color?: string, project?: Project) => {
    const projectId = key === "inbox" ? null : key.startsWith("p") ? Number(key.slice(1)) : undefined;
    const droppable = projectId !== undefined;
    return (
      <div
        key={key}
        className={
          "folder todo-list-item" +
          (board === key ? " active" : "") +
          (projectDrop === key ? " drop-target" : "")
        }
        onDragOver={(e) => {
          if (!droppable || drag.current?.kind !== "card") return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (projectDrop !== key) setProjectDrop(key);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setProjectDrop(null);
        }}
        onDrop={(e) => {
          if (!droppable || drag.current?.kind !== "card") return;
          e.preventDefault();
          moveCardToProject(drag.current.id, projectId);
          endDrag();
        }}
      >
        <div
          className="folder-main"
          role="button"
          tabIndex={0}
          onClick={() => setBoard(key)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setBoard(key);
            }
          }}
        >
          <span className="todo-list-name">
            {color !== undefined && (
              <span className="todo-dot" style={{ background: color || "var(--text-muted)" }} />
            )}
            <span className="folder-name">{label}</span>
          </span>
          {(counts[key] ?? 0) > 0 && <span className="badge">{counts[key]}</span>}
        </div>
        {project && (
          <span className="folder-actions">
            <button
              className="icon-btn"
              onClick={() => setProjectDialog(project)}
              title={tip("todoEditProject")}
              aria-label={t("todoEditProject")}
            >
              <EditIcon size={14} />
            </button>
          </span>
        )}
      </div>
    );
  };

  const openProjects = sortedProjects.filter((p) => !p.archived);
  const archived = sortedProjects.filter((p) => p.archived);
  const boardTitle =
    board === "all"
      ? t("todoAllProjects")
      : board === "inbox"
        ? t("todoInbox")
        : board === "archive"
          ? t("todoCardArchive")
          : currentProject?.name ?? "";

  // ---- Middle: the board ----

  return (
    <div className="todo">
      <aside className="folders todo-lists">
        {boardItem("all", t("todoAllProjects"))}
        {boardItem("inbox", t("todoInbox"))}

        <div className="folders-head todo-projects-head">
          <span className="muted small">{t("todoProjects")}</span>
          <button
            className="icon-btn"
            onClick={() => setProjectDialog("new")}
            title={tip("todoNewProject")}
            aria-label={t("todoNewProject")}
          >
            <PlusIcon size={16} />
          </button>
        </div>
        {openProjects.length === 0 && <p className="muted small todo-hint">{t("todoNoProjects")}</p>}
        {openProjects.map((p) => boardItem(`p${p.id}`, p.name, p.color, p))}

        {archived.length > 0 && (
          <>
            <button className="btn ghost todo-archive-toggle" onClick={() => setShowArchive((v) => !v)}>
              {showArchive ? "▾" : "▸"} {t("todoArchivedProjects")} ({archived.length})
            </button>
            {showArchive && archived.map((p) => boardItem(`p${p.id}`, p.name, p.color, p))}
          </>
        )}
        <p className="muted small todo-hint todo-drag-hint">{t("todoDragToProject")}</p>
        <div className={"folder todo-list-item todo-archive-item" + (board === "archive" ? " active" : "")}>
          <button className="folder-main" onClick={() => setBoard("archive")} title={tip("todoCardArchiveHint")}>
            <span className="todo-list-name">
              <ArchiveIcon size={16} />
              <span className="folder-name">{t("todoCardArchive")}</span>
            </span>
            {archiveCards.length > 0 && <span className="badge">{archiveCards.length}</span>}
          </button>
        </div>
      </aside>

      <section className="board-wrap">
        <header className="board-head">
          {currentProject && (
            <span className="todo-dot board-dot" style={{ background: currentProject.color || "var(--text-muted)" }} />
          )}
          <h2>{boardTitle}</h2>
          {currentProject && (
            <button
              className="icon-btn"
              onClick={() => setProjectDialog(currentProject)}
              title={tip("todoEditProject")}
              aria-label={t("todoEditProject")}
            >
              <EditIcon size={16} />
            </button>
          )}
          {currentProject?.archived && <span className="todo-tag">({t("todoArchived")})</span>}
          <span className="spacer" />
          {dueCount > 0 && (
            <button className="btn board-due-btn" onClick={onShowDue} title={tip("todoDueButton")}>
              <ClockIcon size={16} /> {t("todoToday")}
              <span className="board-due-count">{dueCount}</span>
            </button>
          )}
          <label className="board-search">
            <SearchIcon size={16} />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setFilter("");
                  e.currentTarget.blur();
                }
              }}
              placeholder={t("todoFilter")}
              aria-label={t("todoFilter")}
            />
          </label>
          {board !== "archive" && (
            <button className="btn" onClick={() => setColumnDialog("new")}>
              <PlusIcon size={16} /> {t("todoAddColumn")}
            </button>
          )}
        </header>

        {board === "archive" ? (
          <ArchiveList
            cards={archiveCards}
            filter={filter}
            data={data}
            today={today}
            onOpen={(id) => {
              setOpenIsNew(false);
              setOpenCardId(id);
            }}
          />
        ) : (
        <div className="board" ref={boardRef}>
          {data.columns.map((col) => {
            const cards = cardsByColumn.get(col.id) ?? [];
            const spot = dropSpot?.columnId === col.id ? dropSpot.index : -1;
            // While a drop spot shows, the dragged card is hidden (not removed:
            // Chromium fires no dragend on an element that left the DOM).
            const hideDragged = draggingId != null && dropSpot != null;
            let slot = 0;
            return (
              <div
                key={col.id}
                data-col={col.id}
                className={
                  "board-col" +
                  (columnDrop?.id === col.id ? (columnDrop.after ? " drop-after" : " drop-before") : "")
                }
                style={{ "--c": col.color || "var(--text-muted)" } as React.CSSProperties}
                onDragOver={(e) => {
                  const d = drag.current;
                  if (!d) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (d.kind === "column") {
                    const r = e.currentTarget.getBoundingClientRect();
                    const after = e.clientX > r.left + r.width / 2;
                    if (columnDrop?.id !== col.id || columnDrop.after !== after) {
                      setColumnDrop(d.id === col.id ? null : { id: col.id, after });
                    }
                    return;
                  }
                  const listEl = e.currentTarget.querySelector<HTMLElement>(".board-cards");
                  if (!listEl) return;
                  const index = indexAt(listEl, e.clientY);
                  if (dropSpot?.columnId !== col.id || dropSpot.index !== index) {
                    snapshot();
                    setDropSpot({ columnId: col.id, index });
                  }
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  if (dropSpot?.columnId === col.id) {
                    snapshot();
                    setDropSpot(null);
                  }
                  if (columnDrop?.id === col.id) setColumnDrop(null);
                }}
                onDrop={(e) => {
                  const d = drag.current;
                  if (!d) return;
                  e.preventDefault();
                  if (d.kind === "card" && dropSpot) moveCard(d.id, dropSpot);
                  if (d.kind === "column" && columnDrop) void moveColumn(d.id, columnDrop.id, columnDrop.after);
                  endDrag();
                }}
              >
                <div
                  className="board-col-head"
                  draggable
                  onDragStart={(e) => {
                    drag.current = { kind: "column", id: col.id };
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", col.name);
                  }}
                  onDragEnd={endDrag}
                  title={tip("todoDragColumn")}
                >
                  <span className="board-col-name">{col.name}</span>
                  <span className="board-col-count">{cards.length}</span>
                  <button
                    className="icon-btn"
                    onClick={() => setColumnDialog(col)}
                    title={tip("todoEditColumn")}
                    aria-label={`${t("todoEditColumn")}: ${col.name}`}
                  >
                    <EditIcon size={14} />
                  </button>
                </div>

                <div className="board-cards">
                  {cards.map((card) => {
                    const isDragged = card.id === draggingId;
                    const here = !isDragged && slot === spot;
                    if (!isDragged) slot++;
                    return (
                    <div key={card.id} className={"board-slot" + (isDragged && hideDragged ? " hidden" : "")}>
                      {here && <div className="board-placeholder" style={{ height: dragHeight.current || undefined }} />}
                      <Card
                        card={card}
                        done={doneCols.has(card.columnId)}
                        due={isDue(card, today, doneCols)}
                        project={
                          board === "all" && card.projectId != null
                            ? projectsById.get(card.projectId)
                            : undefined
                        }
                        attachments={attachmentsByTask.get(card.id) ?? []}
                        today={today}
                        dragging={card.id === draggingId}
                        onOpen={() => {
                          setOpenIsNew(false);
                          setOpenCardId(card.id);
                        }}
                        onOpenMail={onOpenMail}
                        onDragStart={(e) => {
                          drag.current = { kind: "card", id: card.id };
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", card.title);
                          // The placeholder takes the card's height, so nothing shifts
                          // when the card makes way for it.
                          dragHeight.current = e.currentTarget.getBoundingClientRect().height;
                          // Hide the card only after the browser took its picture.
                          window.setTimeout(() => {
                            snapshot();
                            setDraggingId(card.id);
                          }, 0);
                        }}
                        onDragEnd={endDrag}
                      />
                    </div>
                    );
                  })}
                  {spot >= 0 && spot >= cards.filter((c) => c.id !== draggingId).length && (
                    <div className="board-placeholder" style={{ height: dragHeight.current || undefined }} />
                  )}
                </div>

                {addingIn === col.id ? (
                  <InlineAdd
                    placeholder={t("todoCardTitle")}
                    multiline
                    onAdd={(title) => void addCard(col.id, title)}
                    onClose={() => setAddingIn(null)}
                  />
                ) : (
                  <button className="board-add" onClick={() => setAddingIn(col.id)}>
                    <PlusIcon size={16} /> {t("todoAddCard")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        )}
      </section>

      {openCard && (
        <CardDialog
          key={openCard.id}
          card={openCard}
          isNew={openIsNew}
          data={data}
          today={today}
          onClose={() => setOpenCardId(null)}
          onOpenMail={(m) => {
            setOpenCardId(null);
            onOpenMail(m);
          }}
        />
      )}

      {columnDialog && (
        <ColumnDialog
          column={columnDialog === "new" ? null : columnDialog}
          defaultColor={COLORS[data.columns.length % COLORS.length]}
          last={data.columns.length <= 1}
          onClose={() => setColumnDialog(null)}
        />
      )}

      {projectDialog && (
        <ProjectDialog
          project={projectDialog === "new" ? null : projectDialog}
          onClose={() => setProjectDialog(null)}
          onSaved={(p) => {
            setProjectDialog(null);
            if (projectDialog === "new") setBoard(`p${p.id}`);
          }}
          onDeleted={() => {
            setProjectDialog(null);
            setBoard("inbox");
          }}
        />
      )}
    </div>
  );
}

/** Text field that adds an item on Enter and stays open for the next one. */
function InlineAdd({
  placeholder,
  multiline,
  onAdd,
  onClose,
}: {
  placeholder: string;
  multiline?: boolean;
  onAdd: (text: string) => void;
  onClose: () => void;
}) {
  const { t } = useApp();
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  function submit() {
    const v = text.trim();
    if (!v) return;
    onAdd(v);
    setText("");
    ref.current?.focus();
  }
  const props = {
    ref,
    autoFocus: true,
    value: text,
    placeholder,
    "aria-label": placeholder,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement & HTMLInputElement>) => setText(e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    // Clicking elsewhere closes an empty field, but keeps typed text.
    onBlur: () => !text.trim() && onClose(),
  };
  return (
    <div className="board-inline-add">
      {multiline ? <textarea rows={3} {...props} /> : <input {...props} />}
      <div className="board-inline-actions">
        <button className="btn primary small" onMouseDown={(e) => e.preventDefault()} onClick={submit}>
          {t("add")}
        </button>
        <button className="btn ghost small" onMouseDown={(e) => e.preventDefault()} onClick={onClose}>
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}

export function DateLabel({ date, today, done }: { date: string; today: string; done?: boolean }) {
  const { t, settings } = useApp();
  const cls = done ? "" : date < today ? " overdue" : date === today ? " today" : "";
  const label =
    date === today
      ? t("todoToday")
      : date === isoDate(addDays(new Date(), 1))
        ? t("todoTomorrow")
        : formatDay(date, settings.lang);
  return (
    <span className={"todo-date" + cls} title={!done && date < today ? t("todoOverdue") : undefined}>
      {label}
    </span>
  );
}

function Card({
  card,
  done,
  due,
  project,
  attachments,
  today,
  dragging,
  onOpen,
  onOpenMail,
  onDragStart,
  onDragEnd,
}: {
  card: Task;
  done: boolean;
  /** Its follow-up day has come: marked in red. */
  due: boolean;
  project?: Project;
  attachments: Attachment[];
  today: string;
  dragging: boolean;
  onOpen: () => void;
  onOpenMail: (m: MailLink) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const { t, tip } = useApp();
  const cover = attachments.find(isImage);
  const coverUrl = useAttachmentUrl(cover);
  return (
    <div
      className={"board-card" + (dragging ? " dragging" : "") + (done ? " done" : "") + (due ? " due" : "")}
      data-card={card.id}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      {card.color && <div className="board-card-band" style={{ background: card.color }} />}
      {cover && coverUrl && <img className="board-card-cover" src={coverUrl} alt="" draggable={false} />}
      <div className="board-card-body">
        <div className="board-card-title">{card.title}</div>
        {card.note.trim() && <div className="board-card-note">{card.note}</div>}
        {(project || card.followUp || attachments.length > 0 || card.mail) && (
          <div className="board-card-foot">
            {project && (
              <span className="todo-tag">
                <span className="todo-dot" style={{ background: project.color || "var(--text-muted)" }} />
                {project.name}
              </span>
            )}
            {card.followUp && <DateLabel date={card.followUp} today={today} done={done} />}
            {attachments.length > 0 && (
              <span className="todo-tag" title={t("todoAttachments")}>
                <PaperclipIcon size={14} /> {attachments.length}
              </span>
            )}
            {card.mail && (
              <button
                className="icon-btn todo-mail"
                onClick={(e) => {
                  e.stopPropagation();
                  if (card.mail) onOpenMail(card.mail);
                }}
                title={tip("todoOpenMail")}
                aria-label={t("todoOpenMail")}
              >
                <MailIcon size={15} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
