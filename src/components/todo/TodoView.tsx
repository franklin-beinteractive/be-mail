// Task list: the lists on the left (Today, Inbox, Waiting, All open,
// Completed and the projects), the tasks in the middle with one quick-add
// line on top, and the open task on the right.
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../../lib/ctx";
import type { TextKey } from "../../lib/i18n";
import {
  addDays,
  archivedProjectIds,
  COLORS,
  formatDay,
  isoDate,
  nextStatus,
  parseQuickAdd,
  STATUSES,
  todoApi,
  useToday,
  useTodo,
  type MailLink,
  type Project,
  type Task,
  type TaskPatch,
  type TaskStatus,
  type TodoAction,
  type TodoData,
} from "../../lib/todo";
import { MailIcon, PlusIcon, EditIcon, TrashIcon } from "../Icons";
import ProjectDialog from "./ProjectDialog";

type ListKey = "today" | "inbox" | "waiting" | "open" | "done" | `p${number}`;
const LIST_STORE = "BE-Mail.todoList";

/** The list shown last, if the stored value still looks like one. */
function storedList(): ListKey {
  const v = localStorage.getItem(LIST_STORE) ?? "";
  return /^(today|inbox|waiting|open|done|p\d+)$/.test(v) ? (v as ListKey) : "today";
}

interface Group {
  key: string;
  label: string;
  color?: string;
  tasks: Task[];
}

/** Follow-up date first (none last), then oldest first. */
function byFollowUp(a: Task, b: Task): number {
  if (a.followUp !== b.followUp) {
    if (!a.followUp) return 1;
    if (!b.followUp) return -1;
    return a.followUp.localeCompare(b.followUp);
  }
  return a.createdAt.localeCompare(b.createdAt);
}

export default function TodoView({ onOpenMail }: { onOpenMail: (m: MailLink) => void }) {
  const { t, tip, settings, notify, confirm } = useApp();
  const data = useTodo();
  const [list, setListState] = useState<ListKey>(storedList);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [quick, setQuick] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [projectDialog, setProjectDialog] = useState<Project | "new" | null>(null);
  const quickRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const today = useToday();

  function setList(k: ListKey) {
    setListState(k);
    localStorage.setItem(LIST_STORE, k);
    setSelectedId(null);
  }

  const projectsById = useMemo(
    () => new Map((data?.projects ?? []).map((p) => [p.id, p])),
    [data]
  );
  const actionsById = useMemo(
    () => new Map((data?.actions ?? []).map((a) => [a.id, a])),
    [data]
  );
  const isWaiting = (task: Task) =>
    task.actionId != null && !!actionsById.get(task.actionId)?.waiting;

  // A remembered project that has since been deleted falls back to Today.
  const currentProject =
    list.startsWith("p") ? projectsById.get(Number(list.slice(1))) : undefined;
  useEffect(() => {
    if (data && list.startsWith("p") && !currentProject) setList("today");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, list, currentProject]);

  const openTasks = useMemo(
    () => (data?.tasks ?? []).filter((x) => x.status !== "done"),
    [data]
  );
  // Today, Waiting and All open leave archived projects out.
  const activeOpen = useMemo(() => {
    const archived = archivedProjectIds(data);
    return openTasks.filter((x) => x.projectId == null || !archived.has(x.projectId));
  }, [data, openTasks]);

  const counts = useMemo(() => {
    const c = { today: 0, inbox: 0, waiting: 0, open: activeOpen.length } as Record<string, number>;
    for (const task of activeOpen) {
      if (task.followUp && task.followUp <= today) c.today++;
      if (isWaiting(task)) c.waiting++;
    }
    for (const task of openTasks) {
      if (task.projectId == null) c.inbox++;
      else c[`p${task.projectId}`] = (c[`p${task.projectId}`] ?? 0) + 1;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTasks, activeOpen, actionsById, today]);

  const sortedProjects = useMemo(
    () =>
      [...(data?.projects ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      ),
    [data]
  );

  const statusLabel = (s: TaskStatus) => t(`todoStatus_${s}` as TextKey);

  // Groups shown in the middle: per status inside one project or the Inbox,
  // per project in the lists that span projects.
  const groups: Group[] = useMemo(() => {
    if (!data) return [];
    const all = data.tasks;
    if (list === "done") {
      const done = all
        .filter((x) => x.status === "done")
        .sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));
      return [{ key: "done", label: "", tasks: done }];
    }
    if (list === "inbox" || list.startsWith("p")) {
      const pid = list === "inbox" ? null : Number(list.slice(1));
      const mine = all.filter((x) => x.projectId === pid);
      const out: Group[] = (["doing", "todo"] as TaskStatus[]).map((s) => ({
        key: s,
        label: statusLabel(s),
        tasks: mine.filter((x) => x.status === s).sort(byFollowUp),
      }));
      if (showDone) {
        out.push({
          key: "done",
          label: statusLabel("done"),
          tasks: mine
            .filter((x) => x.status === "done")
            .sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "")),
        });
      }
      return out.filter((g) => g.tasks.length > 0);
    }
    const pick =
      list === "today"
        ? activeOpen.filter((x) => x.followUp != null && x.followUp <= today)
        : list === "waiting"
          ? activeOpen.filter(isWaiting)
          : activeOpen;
    const out: Group[] = [];
    const inbox = pick.filter((x) => x.projectId == null);
    if (inbox.length) out.push({ key: "inbox", label: t("todoInbox"), tasks: inbox.sort(byFollowUp) });
    for (const p of sortedProjects) {
      const mine = pick.filter((x) => x.projectId === p.id);
      if (mine.length) {
        out.push({ key: `p${p.id}`, label: p.name, color: p.color, tasks: mine.sort(byFollowUp) });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, list, showDone, activeOpen, sortedProjects, today, settings.lang]);

  const flat = useMemo(() => groups.flatMap((g) => g.tasks), [groups]);
  const selected = data?.tasks.find((x) => x.id === selectedId) ?? null;
  const doneInList =
    list === "inbox" || list.startsWith("p")
      ? (data?.tasks ?? []).filter(
          (x) =>
            x.status === "done" &&
            x.projectId === (list === "inbox" ? null : Number(list.slice(1)))
        ).length
      : 0;

  const parsed = data ? parseQuickAdd(quick, data.projects, data.actions) : null;

  async function save(task: Task, patch: TaskPatch) {
    try {
      await todoApi.patchTask(task.id, patch);
    } catch (e) {
      notify(String(e), "error");
    }
  }

  async function addQuick(open: boolean) {
    if (!data || !parsed || !parsed.title) return;
    try {
      let projectId = parsed.projectId;
      if (parsed.newProject) {
        const color = COLORS[data.projects.length % COLORS.length];
        projectId = (await todoApi.saveProject({ name: parsed.newProject, color })).id;
      } else if (projectId == null && currentProject) {
        projectId = currentProject.id;
      }
      // New work in an archived project makes it active again; otherwise the
      // task would only be visible inside the archive.
      const target = projectId != null ? projectsById.get(projectId) : undefined;
      if (target?.archived) await todoApi.saveProject({ ...target, archived: false });
      // Make the new task show up in the list it was typed in.
      let followUp = parsed.followUp;
      if (!followUp && list === "today") followUp = today;
      let actionId = parsed.actionId;
      if (actionId == null && list === "waiting") {
        actionId = data.actions.find((a) => a.waiting)?.id ?? null;
      }
      const task = await todoApi.saveTask({
        title: parsed.title,
        projectId,
        status: "todo",
        actionId,
        followUp,
        note: "",
        mail: null,
      });
      setQuick("");
      if (open) {
        setSelectedId(task.id);
        window.setTimeout(() => titleRef.current?.focus(), 0);
      }
    } catch (e) {
      notify(String(e), "error");
    }
  }

  async function removeTask(task: Task) {
    if (!(await confirm(t("todoDeleteTaskConfirm")))) return;
    const idx = flat.findIndex((x) => x.id === task.id);
    try {
      await todoApi.deleteTask(task.id);
      const next = flat[idx + 1] ?? flat[idx - 1];
      setSelectedId(next && next.id !== task.id ? next.id : null);
    } catch (e) {
      notify(String(e), "error");
    }
  }

  // Keyboard: n = new task, arrows/j/k = pick, space = next status,
  // Enter = edit title, Delete = remove, Esc = close the task.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (projectDialog || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector(".overlay")) return;
      const el = document.activeElement as HTMLElement | null;
      const inField =
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable);
      if (inField) {
        if (e.key === "Escape") el?.blur();
        return;
      }
      const k = e.key;
      // Space and Enter on a focused button belong to that button; handling
      // them here as well would change the status twice.
      const onButton = !!el && (el.tagName === "BUTTON" || el.getAttribute("role") === "button");
      if (onButton && (k === " " || k === "Enter")) return;
      if (k === "n") {
        e.preventDefault();
        quickRef.current?.focus();
      } else if (k === "ArrowDown" || k === "j" || k === "ArrowUp" || k === "k") {
        e.preventDefault();
        const idx = flat.findIndex((x) => x.id === selectedId);
        const down = k === "ArrowDown" || k === "j";
        const next = down
          ? flat[Math.min(idx + 1, flat.length - 1)]
          : flat[Math.max(idx - 1, 0)];
        if (next) setSelectedId(next.id);
      } else if (!selected) {
        return;
      } else if (k === " ") {
        e.preventDefault();
        void save(selected, (cur) => ({ status: nextStatus(cur.status) }));
      } else if (k === "Enter") {
        e.preventDefault();
        titleRef.current?.focus();
      } else if (k === "Delete") {
        void removeTask(selected);
      } else if (k === "Escape") {
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Keep the picked task in view while stepping through with the keyboard.
  useEffect(() => {
    if (selectedId == null) return;
    document
      .querySelector(`[data-task="${selectedId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  if (!data) return <div className="todo centered">{t("loading")}</div>;

  const listTitle =
    list === "today" ? t("todoToday")
    : list === "inbox" ? t("todoInbox")
    : list === "waiting" ? t("todoWaiting")
    : list === "open" ? t("todoAllOpen")
    : list === "done" ? t("todoDoneList")
    : currentProject?.name ?? "";

  const listButton = (key: ListKey, label: string, color?: string, project?: Project) => (
    <div key={key} className={"folder todo-list-item" + (list === key ? " active" : "")}>
      <div
        className="folder-main"
        role="button"
        tabIndex={0}
        onClick={() => setList(key)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setList(key);
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

  const openProjects = sortedProjects.filter((p) => !p.archived);
  const archived = sortedProjects.filter((p) => p.archived);

  return (
    <div className="todo">
      <aside className="folders todo-lists">
        {listButton("today", t("todoToday"))}
        {listButton("inbox", t("todoInbox"))}
        {listButton("waiting", t("todoWaiting"))}
        {listButton("open", t("todoAllOpen"))}
        {listButton("done", t("todoDoneList"))}

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
        {openProjects.map((p) => listButton(`p${p.id}`, p.name, p.color, p))}

        {archived.length > 0 && (
          <>
            <button className="btn ghost todo-archive-toggle" onClick={() => setShowArchive((v) => !v)}>
              {showArchive ? "▾" : "▸"} {t("todoArchive")} ({archived.length})
            </button>
            {showArchive && archived.map((p) => listButton(`p${p.id}`, p.name, p.color, p))}
          </>
        )}
      </aside>

      <section className="todo-main">
        <div className="todo-add">
          <input
            ref={quickRef}
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addQuick(e.ctrlKey);
              } else if (e.key === "Escape") {
                setQuick("");
                e.currentTarget.blur();
              }
            }}
            placeholder={t("todoQuickAdd")}
            aria-label={t("todoQuickAdd")}
          />
          <button className="btn primary" onClick={() => void addQuick(false)} disabled={!parsed?.title}>
            <PlusIcon size={16} /> {t("add")}
          </button>
        </div>
        <div className="todo-add-preview small muted">
          {quick.trim() && parsed ? (
            <QuickPreview parsed={parsed} data={data} lang={settings.lang} t={t} />
          ) : (
            t("todoQuickAddHint")
          )}
        </div>

        <header className="todo-list-head">
          <h2>{listTitle}</h2>
          {doneInList > 0 && (
            <button className="btn ghost small" onClick={() => setShowDone((v) => !v)}>
              {showDone ? t("todoHideDone") : `${t("todoShowDone")} (${doneInList})`}
            </button>
          )}
        </header>

        <div className="todo-scroll">
          {flat.length === 0 && <div className="empty">{t("todoEmpty")}</div>}
          {groups.map((g) => (
            <div key={g.key} className="todo-group">
              {g.label && (
                <div className="todo-group-head">
                  {g.color !== undefined && (
                    <span className="todo-dot" style={{ background: g.color || "var(--text-muted)" }} />
                  )}
                  {g.label}
                  <span className="muted"> {g.tasks.length}</span>
                </div>
              )}
              {g.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  active={task.id === selectedId}
                  projectOf={
                    list === "done" && task.projectId != null
                      ? projectsById.get(task.projectId)
                      : undefined
                  }
                  actions={data.actions}
                  action={task.actionId != null ? actionsById.get(task.actionId) : undefined}
                  today={today}
                  onSelect={() => setSelectedId(task.id)}
                  onSave={(patch) => save(task, patch)}
                  onOpenMail={onOpenMail}
                />
              ))}
            </div>
          ))}
          <p className="muted small todo-shortcuts">{t("todoShortcuts")}</p>
        </div>
      </section>

      <aside className="todo-detail">
        {selected ? (
          <TaskDetail
            key={selected.id}
            task={selected}
            data={data}
            today={today}
            titleRef={titleRef}
            onSave={(patch) => save(selected, patch)}
            onDelete={() => void removeTask(selected)}
            onOpenMail={onOpenMail}
          />
        ) : (
          <p className="muted todo-detail-empty">{t("todoSelectHint")}</p>
        )}
      </aside>

      {projectDialog && (
        <ProjectDialog
          project={projectDialog === "new" ? null : projectDialog}
          onClose={() => setProjectDialog(null)}
          onSaved={(p) => {
            setProjectDialog(null);
            if (projectDialog === "new") setList(`p${p.id}`);
          }}
          onDeleted={() => {
            setProjectDialog(null);
            setList("inbox");
          }}
        />
      )}
    </div>
  );
}

/** What the quick-add line will create, shown while typing. */
function QuickPreview({
  parsed,
  data,
  lang,
  t,
}: {
  parsed: ReturnType<typeof parseQuickAdd>;
  data: TodoData;
  lang: string;
  t: (k: TextKey) => string;
}) {
  const project = data.projects.find((p) => p.id === parsed.projectId);
  const action = data.actions.find((a) => a.id === parsed.actionId);
  return (
    <span className="todo-preview">
      <strong>{parsed.title || "…"}</strong>
      {project && (
        <span className="todo-tag">
          <span className="todo-dot" style={{ background: project.color || "var(--text-muted)" }} />
          {project.name}
        </span>
      )}
      {parsed.newProject && (
        <span className="todo-tag">
          {parsed.newProject} <em>({t("todoWillCreate")})</em>
        </span>
      )}
      {action && <ActionChip action={action} />}
      {parsed.followUp && <span className="todo-date">{formatDay(parsed.followUp, lang)}</span>}
    </span>
  );
}

function ActionChip({ action }: { action: TodoAction }) {
  return (
    <span
      className="todo-action"
      style={{ "--c": action.color || "var(--text-muted)" } as React.CSSProperties}
    >
      {action.label}
    </span>
  );
}

function StatusButton({
  status,
  onClick,
}: {
  status: TaskStatus;
  onClick: () => void;
}) {
  const { t, tip } = useApp();
  return (
    <button
      className={"todo-status s-" + status}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={tip("todoChangeStatus")}
      aria-label={`${t(`todoStatus_${status}` as TextKey)}. ${t("todoChangeStatus")}`}
    >
      {status === "done" ? "✓" : ""}
    </button>
  );
}

function DateLabel({ date, today }: { date: string; today: string }) {
  const { t, settings } = useApp();
  const cls = date < today ? " overdue" : date === today ? " today" : "";
  const label =
    date === today
      ? t("todoToday")
      : date === isoDate(addDays(new Date(), 1))
        ? t("todoTomorrow")
        : formatDay(date, settings.lang);
  return (
    <span className={"todo-date" + cls} title={date < today ? t("todoOverdue") : undefined}>
      {label}
    </span>
  );
}

function TaskRow({
  task,
  active,
  projectOf,
  actions,
  action,
  today,
  onSelect,
  onSave,
  onOpenMail,
}: {
  task: Task;
  active: boolean;
  projectOf?: Project;
  actions: TodoAction[];
  action?: TodoAction;
  today: string;
  onSelect: () => void;
  onSave: (patch: TaskPatch) => void;
  onOpenMail: (m: MailLink) => void;
}) {
  const { t, tip } = useApp();
  return (
    <div
      className={"todo-row" + (active ? " active" : "") + (task.status === "done" ? " done" : "")}
      data-task={task.id}
      onClick={onSelect}
    >
      <StatusButton status={task.status} onClick={() => onSave((cur) => ({ status: nextStatus(cur.status) }))} />
      <span className="todo-title">{task.title}</span>
      {projectOf && (
        <span className="todo-tag">
          <span className="todo-dot" style={{ background: projectOf.color || "var(--text-muted)" }} />
          {projectOf.name}
        </span>
      )}
      {/* The action chip is a plain select, so changing it is one click and
          works from the keyboard too. */}
      <select
        className={"todo-action todo-action-select" + (action ? "" : " empty")}
        style={{ "--c": action?.color || "var(--text-muted)" } as React.CSSProperties}
        value={task.actionId ?? ""}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onSave({ actionId: e.target.value ? Number(e.target.value) : null })}
        aria-label={t("todoAction")}
      >
        <option value="">{action ? t("todoNoAction") : `+ ${t("todoAction")}`}</option>
        {actions.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </select>
      {task.followUp && <DateLabel date={task.followUp} today={today} />}
      {task.mail && (
        <button
          className="icon-btn todo-mail"
          onClick={(e) => {
            e.stopPropagation();
            if (task.mail) onOpenMail(task.mail);
          }}
          title={tip("todoOpenMail")}
          aria-label={t("todoOpenMail")}
        >
          <MailIcon size={16} />
        </button>
      )}
    </div>
  );
}

function TaskDetail({
  task,
  data,
  today,
  titleRef,
  onSave,
  onDelete,
  onOpenMail,
}: {
  task: Task;
  data: TodoData;
  today: string;
  titleRef: React.RefObject<HTMLInputElement | null>;
  onSave: (patch: TaskPatch) => Promise<void>;
  onDelete: () => void;
  onOpenMail: (m: MailLink) => void;
}) {
  const { t, settings } = useApp();
  const [title, setTitle] = useState(task.title);
  const [note, setNote] = useState(task.note);
  // Follow outside changes (e.g. a status click in the list) without losing
  // what is being typed: only reset when the stored value changes.
  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setNote(task.note), [task.note]);
  const [due, setDue] = useState(task.followUp ?? "");
  useEffect(() => setDue(task.followUp ?? ""), [task.followUp]);

  const projects = data.projects
    .filter((p) => !p.archived || p.id === task.projectId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(settings.lang === "en" ? "en-GB" : "nl-NL", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  function commitTitle() {
    const v = title.trim();
    if (!v) setTitle(task.title);
    else if (v !== task.title) void onSave({ title: v });
  }

  return (
    <div className="todo-detail-body">
      <input
        ref={titleRef}
        className="todo-detail-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setTitle(task.title);
            window.setTimeout(() => e.currentTarget?.blur(), 0);
          }
        }}
        aria-label={t("todoTitle")}
      />

      <div className="todo-seg" role="group" aria-label="Status">
        {STATUSES.map((s) => (
          <button
            key={s}
            className={"btn" + (task.status === s ? " primary" : "")}
            onClick={() => void onSave({ status: s })}
          >
            {t(`todoStatus_${s}` as TextKey)}
          </button>
        ))}
      </div>

      <label className="todo-field">
        <span>{t("todoProject")}</span>
        <select
          value={task.projectId ?? ""}
          onChange={(e) =>
            void onSave({ projectId: e.target.value ? Number(e.target.value) : null })
          }
        >
          <option value="">{t("todoNoProject")}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="todo-field">
        <span>{t("todoAction")}</span>
        <select
          value={task.actionId ?? ""}
          onChange={(e) =>
            void onSave({ actionId: e.target.value ? Number(e.target.value) : null })
          }
        >
          <option value="">{t("todoNoAction")}</option>
          {data.actions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>

      <div className="todo-field">
        <span>{t("todoFollowUp")}</span>
        <input
          type="date"
          value={due}
          onChange={(e) => {
            // Typing a year passes through dates like 0002-11-25: save only a
            // plausible date right away, anything else when leaving the field.
            const v = e.target.value;
            setDue(v);
            if (v === "" || Number(v.slice(0, 4)) >= 2000) void onSave({ followUp: v || null });
          }}
          onBlur={() => due !== (task.followUp ?? "") && void onSave({ followUp: due || null })}
        />
        <div className="todo-quick-dates">
          <button className="btn small" onClick={() => void onSave({ followUp: today })}>
            {t("todoToday")}
          </button>
          <button
            className="btn small"
            onClick={() => void onSave({ followUp: isoDate(addDays(new Date(), 1)) })}
          >
            {t("todoTomorrow")}
          </button>
          <button
            className="btn small"
            onClick={() => void onSave({ followUp: isoDate(addDays(new Date(), 7)) })}
          >
            {t("todoNextWeek")}
          </button>
          {task.followUp && (
            <button className="btn ghost small" onClick={() => void onSave({ followUp: null })}>
              {t("todoClear")}
            </button>
          )}
        </div>
      </div>

      <label className="todo-field">
        <span>{t("todoNote")}</span>
        <textarea
          rows={6}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== task.note && void onSave({ note })}
        />
      </label>

      {task.mail && (
        <div className="todo-field">
          <span>{t("todoLinkedMail")}</span>
          <div className="todo-mail-card">
            <div className="todo-mail-subject">{task.mail.subject || "-"}</div>
            <div className="muted small">
              {task.mail.from}
              {task.mail.address && task.mail.address !== task.mail.from
                ? ` <${task.mail.address}>`
                : ""}
            </div>
            <button
              className="btn small"
              onClick={() => task.mail && onOpenMail(task.mail)}
            >
              <MailIcon size={16} /> {t("todoOpenMail")}
            </button>
          </div>
        </div>
      )}

      <p className="muted small todo-meta">
        {t("todoCreatedOn")}: {fmt(task.createdAt)}
        {task.doneAt && (
          <>
            <br />
            {t("todoDoneOn")}: {fmt(task.doneAt)}
          </>
        )}
      </p>

      <button className="btn danger" onClick={onDelete}>
        <TrashIcon size={16} /> {t("delete")}
      </button>
    </div>
  );
}
