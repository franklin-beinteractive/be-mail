// Cards whose follow-up day has come: a notice in the top right corner of
// the window (once per card per day) and a dialog that lists them, so they
// can be opened, given a new follow-up date or finished right there.
import { useState } from "react";
import { useApp } from "../../lib/ctx";
import { doneColumnIds, todoApi, type Task, type TaskPatch, type TodoData } from "../../lib/todo";
import { ClockIcon, CloseIcon } from "../Icons";
import FollowUpField from "./FollowUpField";
import { DateLabel } from "./TodoView";

const SEEN_STORE = "BE-Mail.todoDueSeen";

interface Seen {
  date: string;
  ids: number[];
}

function loadSeen(): Seen | null {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_STORE) ?? "null");
    return v && typeof v.date === "string" && Array.isArray(v.ids) ? v : null;
  } catch {
    return null;
  }
}

/** Whether the notice should show: some due card has not been seen today.
 *  `markSeen` hides it until another card becomes due, or until tomorrow. */
export function useDueNotice(due: Task[], today: string) {
  const [seen, setSeen] = useState<Seen | null>(loadSeen);
  const seenIds = new Set(seen?.date === today ? seen.ids : []);
  const show = due.some((x) => !seenIds.has(x.id));
  function markSeen() {
    const next = { date: today, ids: due.map((x) => x.id) };
    localStorage.setItem(SEEN_STORE, JSON.stringify(next));
    setSeen(next);
  }
  return { show, markSeen };
}

export function DueNotice({
  count,
  onShow,
  onDismiss,
}: {
  count: number;
  onShow: () => void;
  onDismiss: () => void;
}) {
  const { t } = useApp();
  return (
    <div className="due-notice" role="status">
      <button className="due-notice-main" onClick={onShow}>
        <span className="due-notice-icon">
          <ClockIcon size={20} />
        </span>
        <span className="due-notice-text">
          <strong>{count === 1 ? t("todoDueOne") : t("todoDueMany").replace("{n}", String(count))}</strong>
          <span className="muted small">{t("todoDueShow")}</span>
        </span>
      </button>
      <button className="icon-btn" onClick={onDismiss} aria-label={t("todoClose")}>
        <CloseIcon size={16} />
      </button>
    </div>
  );
}

export function DueDialog({
  tasks,
  data,
  today,
  onOpenTask,
  onClose,
}: {
  tasks: Task[];
  data: TodoData;
  today: string;
  onOpenTask: (id: number) => void;
  onClose: () => void;
}) {
  const { t, tip, notify } = useApp();
  const done = doneColumnIds(data);
  const doneColumn = data.columns.find((c) => c.done);
  const projects = new Map(data.projects.map((p) => [p.id, p]));
  const columns = new Map(data.columns.map((c) => [c.id, c]));
  const tasksById = new Map(data.tasks.map((x) => [x.id, x]));
  const dueIds = new Set(tasks.map((x) => x.id));

  // The cards stay in their group until the dialog closes, also after a new
  // date or "finish": otherwise a card would vanish halfway through typing a
  // date, and you would not see what you changed. true = was overdue.
  const [shownAt] = useState(() => new Map(tasks.map((x) => [x.id, x.followUp! < today])));
  const groups = new Map(shownAt);
  for (const x of tasks) if (!groups.has(x.id)) groups.set(x.id, x.followUp! < today);
  const rows = [...groups].flatMap(([id, wasOverdue]) => {
    const task = tasksById.get(id);
    return task ? [{ task, wasOverdue }] : [];
  });

  function patch(id: number, changes: TaskPatch) {
    todoApi.patchTask(id, changes).catch((e) => notify(String(e), "error"));
  }

  function group(label: string, list: Task[]) {
    if (!list.length) return null;
    return (
      <section className="due-group">
        <h3>
          {label} <span className="muted">{list.length}</span>
        </h3>
        <ul className="due-list">
          {list.map((task) => {
            const project = task.projectId != null ? projects.get(task.projectId) : undefined;
            const finished = done.has(task.columnId);
            return (
              <li key={task.id} className={"due-row" + (dueIds.has(task.id) ? "" : " handled")}>
                <div className="due-row-top">
                  <button className="due-row-main" onClick={() => onOpenTask(task.id)} title={tip("todoDueOpenCard")}>
                    <span className="due-row-title">{task.title}</span>
                    <span className="due-row-meta">
                      {task.followUp && <DateLabel date={task.followUp} today={today} done={finished} />}
                      {project && (
                        <span className="todo-tag">
                          <span className="todo-dot" style={{ background: project.color || "var(--text-muted)" }} />
                          {project.name}
                        </span>
                      )}
                      <span className="todo-tag">{columns.get(task.columnId)?.name}</span>
                    </span>
                  </button>
                  {doneColumn && !finished && (
                    <button
                      className="btn small"
                      onClick={() => patch(task.id, { columnId: doneColumn.id, sort: null })}
                      title={tip("todoDueFinishHint")?.replace("{col}", () => doneColumn.name)}
                    >
                      {t("todoDueFinish")}
                    </button>
                  )}
                </div>
                {!finished && (
                  <div className="due-row-date">
                    <FollowUpField
                      value={task.followUp}
                      today={today}
                      onChange={(followUp) => patch(task.id, { followUp })}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("todoDueTitle")}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="dialog due-dialog">
        <header className="dialog-head">
          <h2>{t("todoDueTitle")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("todoClose")} autoFocus>
            <CloseIcon size={18} />
          </button>
        </header>
        <div className="dialog-body">
          {rows.length === 0 ? (
            <p className="muted">{t("todoDueEmpty")}</p>
          ) : (
            <>
              {group(t("todoOverdue"), rows.filter((r) => r.wasOverdue).map((r) => r.task))}
              {group(t("todoToday"), rows.filter((r) => !r.wasOverdue).map((r) => r.task))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
