// Edit a board column: name, colour and whether its cards count as done.
// Deleting goes through DeleteColumnDialog, which asks where its cards go.
import { useState } from "react";
import { useApp } from "../../lib/ctx";
import { COLORS, todoApi, type Column } from "../../lib/todo";
import { CloseIcon } from "../Icons";
import DeleteColumnDialog from "./DeleteColumnDialog";

export default function ColumnDialog({
  column,
  last,
  onClose,
}: {
  column: Column;
  /** The only column left: it cannot be deleted. */
  last: boolean;
  onClose: () => void;
}) {
  const { t, notify } = useApp();
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(column.name);
  const [color, setColor] = useState(column.color || COLORS[0]);
  const [done, setDone] = useState(column.done);

  async function save() {
    if (!name.trim()) return;
    try {
      await todoApi.saveColumn({ id: column.id, name, color, done });
      onClose();
    } catch (e) {
      notify(String(e), "error");
    }
  }

  if (deleting) {
    return <DeleteColumnDialog column={column} onCancel={() => setDeleting(false)} onDeleted={onClose} />;
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
          <h2>{t("todoEditColumn")}</h2>
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
          <label className="row check">
            <span>{t("todoColumnDone")}</span>
            <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} />
          </label>
          <p className="muted small todo-dialog-note">{t("todoColumnDoneHint")}</p>
        </div>
        <footer className="dialog-foot">
          <button
            className="btn danger"
            onClick={() => setDeleting(true)}
            disabled={last}
            title={last ? t("todoLastColumn") : undefined}
          >
            {t("delete")}
          </button>
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
