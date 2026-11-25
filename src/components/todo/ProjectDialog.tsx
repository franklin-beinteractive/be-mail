// Create or edit a project: name, colour, archived; deleting moves its
// tasks to the Inbox.
import { useState } from "react";
import { useApp } from "../../lib/ctx";
import { COLORS, todoApi, type Project } from "../../lib/todo";
import { CloseIcon } from "../Icons";

export default function ProjectDialog({
  project,
  onClose,
  onSaved,
  onDeleted,
}: {
  project: Project | null;
  onClose: () => void;
  onSaved: (p: Project) => void;
  onDeleted: () => void;
}) {
  const { t, notify, confirm } = useApp();
  const [name, setName] = useState(project?.name ?? "");
  const [color, setColor] = useState(project?.color || COLORS[0]);
  const [archived, setArchived] = useState(project?.archived ?? false);

  async function save() {
    if (!name.trim()) return;
    try {
      const p = await todoApi.saveProject({ id: project?.id, name, color, archived });
      onSaved(p);
    } catch (e) {
      notify(String(e), "error");
    }
  }

  async function remove() {
    if (!project || !(await confirm(t("todoDeleteProjectConfirm")))) return;
    try {
      await todoApi.deleteProject(project.id);
      onDeleted();
    } catch (e) {
      notify(String(e), "error");
    }
  }

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="dialog todo-dialog">
        <header className="dialog-head">
          <h2>{project ? t("todoEditProject") : t("todoNewProject")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("cancel")}>
            <CloseIcon size={18} />
          </button>
        </header>
        <div className="dialog-body">
          <label className="row">
            <span>{t("todoName")}</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void save()}
            />
          </label>
          <div className="row">
            <span>{t("todoColor")}</span>
            <div className="todo-swatches">
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={"todo-swatch" + (c === color ? " active" : "")}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  aria-label={c}
                  aria-pressed={c === color}
                />
              ))}
            </div>
          </div>
          {project && (
            <label className="row check">
              <span>{t("todoArchived")}</span>
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => setArchived(e.target.checked)}
              />
            </label>
          )}
        </div>
        <footer className="dialog-foot">
          {project && (
            <button className="btn danger" onClick={() => void remove()}>
              {t("delete")}
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            {t("cancel")}
          </button>
          <button className="btn primary" onClick={() => void save()} disabled={!name.trim()}>
            {t("save")}
          </button>
        </footer>
      </div>
    </div>
  );
}
