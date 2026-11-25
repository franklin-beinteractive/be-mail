// "Taak maken" on an open mail: the subject becomes the title, the project
// is suggested from the sender's domain and the task keeps a link to the
// mail. Enter saves, Esc closes.
import { useMemo, useState } from "react";
import { useApp } from "../../lib/ctx";
import {
  COLORS,
  norm,
  suggestProject,
  todoApi,
  useTodo,
} from "../../lib/todo";
import type { Message } from "../../lib/types";
import { CloseIcon } from "../Icons";

export default function TaskFromMail({
  message,
  initialTitle,
  accountId,
  ownDomains,
  onClose,
}: {
  message: Message;
  /** Subject without reply/forward prefixes. */
  initialTitle: string;
  accountId: string;
  ownDomains: string[];
  onClose: () => void;
}) {
  const { t, notify } = useApp();
  const data = useTodo();
  const address = message.from?.emailAddress?.address ?? "";
  const fromName = message.from?.emailAddress?.name || address;

  const suggestion = useMemo(
    () => (data ? suggestProject(address, data, ownDomains) : null),
    // Only on open: the user's own typing should not be overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data == null]
  );
  const suggestedName = !suggestion
    ? ""
    : "projectId" in suggestion
      ? (data?.projects.find((p) => p.id === suggestion.projectId)?.name ?? "")
      : suggestion.newName;

  const [title, setTitle] = useState(initialTitle);
  const [project, setProject] = useState<string | null>(null);
  const [actionId, setActionId] = useState<number | null>(null);
  const [followUp, setFollowUp] = useState("");
  const [busy, setBusy] = useState(false);

  const projectText = project ?? suggestedName;
  const openProjects = (data?.projects ?? []).filter((p) => !p.archived);
  // An open project first; an archived one with that name becomes active
  // again on save, so the new task does not vanish into the archive.
  const existing =
    openProjects.find((p) => norm(p.name) === norm(projectText)) ??
    (data?.projects ?? []).find((p) => norm(p.name) === norm(projectText));

  async function save() {
    if (!data || !title.trim() || busy) return;
    setBusy(true);
    try {
      let projectId: number | null = existing?.id ?? null;
      if (existing?.archived) await todoApi.saveProject({ ...existing, archived: false });
      if (!existing && projectText.trim()) {
        const color = COLORS[data.projects.length % COLORS.length];
        projectId = (await todoApi.saveProject({ name: projectText, color })).id;
      }
      await todoApi.saveTask({
        title,
        projectId,
        status: "todo",
        actionId,
        followUp: followUp || null,
        note: "",
        mail: {
          accountId,
          messageId: message.id,
          conversationId: message.conversationId ?? null,
          subject: message.subject ?? "",
          from: fromName,
          address,
        },
      });
      notify(t("todoCreated"), "info");
      onClose();
    } catch (e) {
      notify(String(e), "error");
      setBusy(false);
    }
  }

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void save();
    }
  };

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="dialog todo-dialog">
        <header className="dialog-head">
          <h2>{t("todoFromMail")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("cancel")}>
            <CloseIcon size={18} />
          </button>
        </header>
        <div className="dialog-body">
          <label className="row">
            <span>{t("todoTitle")}</span>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={onEnter} />
          </label>
          <label className="row">
            <span>{t("todoProject")}</span>
            <input
              value={projectText}
              onChange={(e) => setProject(e.target.value)}
              onKeyDown={onEnter}
              list="todo-mail-projects"
              placeholder={t("todoNoProject")}
            />
          </label>
          <datalist id="todo-mail-projects">
            {openProjects.map((p) => (
              <option key={p.id} value={p.name} />
            ))}
          </datalist>
          {projectText.trim() && (
            <p className="muted small todo-dialog-note">
              {!existing
                ? `${projectText.trim()}: ${t("todoWillCreate")}`
                : existing.archived
                  ? `${existing.name}: ${t("todoUnarchive")}`
                  : project == null && suggestion
                  ? `${existing.name}: ${t("todoSuggested")}`
                  : ""}
            </p>
          )}
          <label className="row">
            <span>{t("todoAction")}</span>
            <select
              value={actionId ?? ""}
              onChange={(e) => setActionId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{t("todoNoAction")}</option>
              {(data?.actions ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="row">
            <span>{t("todoFollowUp")}</span>
            <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
          </label>
          <p className="muted small todo-dialog-note">
            {t("todoLinkedMail")}: {message.subject || "-"} ({fromName})
          </p>
        </div>
        <footer className="dialog-foot">
          <button className="btn" onClick={onClose}>
            {t("cancel")}
          </button>
          <button className="btn primary" onClick={() => void save()} disabled={!title.trim() || busy}>
            {t("save")}
          </button>
        </footer>
      </div>
    </div>
  );
}
