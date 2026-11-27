// The card archive: cards archived by hand, and cards that have been in a
// "counts as done" column for ARCHIVE_AFTER_DAYS days. They leave the board;
// here they can be opened, put back on the board or deleted for good (with
// their attachments), one by one or the whole archive at once.
import { useApp } from "../../lib/ctx";
import { ARCHIVE_AFTER_DAYS, formatDay, todoApi, type Task, type TodoData } from "../../lib/todo";
import { PaperclipIcon, TrashIcon } from "../Icons";

export default function ArchiveList({
  cards,
  filter,
  data,
  today,
  onOpen,
}: {
  /** The archived cards, latest first. */
  cards: Task[];
  filter: string;
  data: TodoData;
  today: string;
  onOpen: (id: number) => void;
}) {
  const { t, tip, notify, confirm, settings } = useApp();
  const projects = new Map(data.projects.map((p) => [p.id, p]));
  const columns = new Map(data.columns.map((c) => [c.id, c]));
  const attachmentCount = new Map<number, number>();
  for (const a of data.attachments) attachmentCount.set(a.taskId, (attachmentCount.get(a.taskId) ?? 0) + 1);

  const q = filter.trim().toLowerCase();
  const shown = q ? cards.filter((x) => `${x.title}\n${x.note}`.toLowerCase().includes(q)) : cards;

  async function remove(card: Task) {
    if (!(await confirm(t("todoDeleteForever").replace("{title}", () => card.title)))) return;
    try {
      await todoApi.deleteTask(card.id);
    } catch (e) {
      notify(String(e), "error");
    }
  }

  function restore(card: Task) {
    todoApi
      .restoreTask(card, data, today)
      .then((moved) => notify(moved ? `${t("todoMovedTo")} ${moved.name}` : t("todoRestored"), "info"))
      .catch((e) => notify(String(e), "error"));
  }

  /** Deletes every archived card, also the ones a filter hides. */
  async function emptyArchive() {
    const msg = cards.length === 1 ? t("todoEmptyArchiveOne") : t("todoEmptyArchiveMany").replace("{n}", String(cards.length));
    if (!(await confirm(msg))) return;
    try {
      await todoApi.deleteTasks(cards.map((x) => x.id));
      notify(t("todoArchiveEmptied"), "info");
    } catch (e) {
      notify(String(e), "error");
    }
  }

  return (
    <div className="archive">
      <div className="archive-head">
        <p className="muted small archive-intro">
          {t("todoCardArchiveIntro").replace("{n}", String(ARCHIVE_AFTER_DAYS))}
        </p>
        {cards.length > 0 && (
          <button className="btn danger" onClick={() => void emptyArchive()}>
            <TrashIcon size={16} /> {t("todoEmptyArchive")}
          </button>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="muted archive-empty">{q ? t("todoArchiveNoMatch") : t("todoArchiveEmpty")}</p>
      ) : (
        <ul className="archive-list">
          {shown.map((card) => {
            const project = card.projectId != null ? projects.get(card.projectId) : undefined;
            const files = attachmentCount.get(card.id) ?? 0;
            return (
              <li key={card.id} className="archive-row">
                <button className="archive-row-main" onClick={() => onOpen(card.id)} title={tip("todoDueOpenCard")}>
                  <span className="archive-row-title">{card.title}</span>
                  <span className="archive-row-meta">
                    {card.archivedAt ? (
                      <span className="todo-tag">
                        {t("todoArchivedOn")} {formatDay(card.archivedAt.slice(0, 10), settings.lang)}
                      </span>
                    ) : (
                      card.doneAt && (
                        <span className="todo-tag">
                          {t("todoFinishedOn")} {formatDay(card.doneAt.slice(0, 10), settings.lang)}
                        </span>
                      )
                    )}
                    {project && (
                      <span className="todo-tag">
                        <span className="todo-dot" style={{ background: project.color || "var(--text-muted)" }} />
                        {project.name}
                      </span>
                    )}
                    <span className="todo-tag">{columns.get(card.columnId)?.name}</span>
                    {files > 0 && (
                      <span className="todo-tag" title={t("todoAttachments")}>
                        <PaperclipIcon size={14} /> {files}
                      </span>
                    )}
                  </span>
                </button>
                <button className="btn small" onClick={() => restore(card)} title={tip("todoRestoreHint")}>
                  {t("todoRestore")}
                </button>
                <button
                  className="icon-btn archive-delete"
                  onClick={() => void remove(card)}
                  title={tip("todoDeleteCard")}
                  aria-label={`${t("todoDeleteCard")}: ${card.title}`}
                >
                  <TrashIcon size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
