// Deleting a board column. A column with cards in it (counted over every
// project, archived ones too) cannot just disappear: the user picks the
// column the cards move to, and only then is the column deleted.
import { useState } from "react";
import { useApp } from "../../lib/ctx";
import { todoApi, useTodo, type Column } from "../../lib/todo";
import { CloseIcon } from "../Icons";

export default function DeleteColumnDialog({
  column,
  onCancel,
  onDeleted,
}: {
  column: Column;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const { t, notify } = useApp();
  const data = useTodo();
  const [target, setTarget] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const count = data?.tasks.filter((x) => x.columnId === column.id).length ?? 0;
  const others = (data?.columns ?? []).filter((c) => c.id !== column.id);
  const cards = count === 1 ? t("todoCardOne") : t("todoCardMany").replace("{n}", String(count));
  const ready = count === 0 || target != null;

  async function remove() {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await todoApi.deleteColumn(column.id, count > 0 ? target : null);
      onDeleted();
    } catch (e) {
      notify(String(e), "error");
      setBusy(false);
    }
  }

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="todo-delete-column-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="dialog todo-dialog">
        <header className="dialog-head">
          <h2 id="todo-delete-column-title">{t("todoDeleteColumnTitle")}</h2>
          <button className="icon-btn" onClick={onCancel} aria-label={t("cancel")}>
            <CloseIcon size={18} />
          </button>
        </header>
        <div className="dialog-body">
          {count === 0 ? (
            <p>{t("todoDeleteColumnConfirm").replace("{name}", column.name)}</p>
          ) : (
            <>
              <p>{t("todoDeleteColumnHasCards").replace("{name}", column.name).replace("{cards}", cards)}</p>
              <label className="row">
                <span>{t("todoMoveCardsTo")}</span>
                <select
                  autoFocus
                  value={target ?? ""}
                  onChange={(e) => setTarget(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="" disabled>
                    {t("todoChooseColumn")}
                  </option>
                  {others.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
        <footer className="dialog-foot">
          <span className="spacer" />
          <button className="btn" onClick={onCancel} autoFocus={count === 0}>
            {t("cancel")}
          </button>
          <button className="btn danger" onClick={() => void remove()} disabled={!ready || busy}>
            {count === 0 ? t("delete") : t("todoMoveAndDelete")}
          </button>
        </footer>
      </div>
    </div>
  );
}
