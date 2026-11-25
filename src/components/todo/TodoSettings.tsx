// Settings -> Tasks: the action labels (name, colour, "waiting on others")
// and their order. The three statuses are fixed.
import { useEffect, useState } from "react";
import { useApp } from "../../lib/ctx";
import { COLORS, todoApi, useTodo, type TodoAction } from "../../lib/todo";
import { TrashIcon } from "../Icons";

function ActionRow({
  action,
  first,
  last,
  onMove,
}: {
  action: TodoAction;
  first: boolean;
  last: boolean;
  onMove: (delta: number) => void;
}) {
  const { t, tip, notify, confirm } = useApp();
  const [label, setLabel] = useState(action.label);
  useEffect(() => setLabel(action.label), [action.label]);

  async function save(patch: Partial<TodoAction>) {
    try {
      await todoApi.saveAction({ ...action, ...patch });
    } catch (e) {
      notify(String(e), "error");
      setLabel(action.label);
    }
  }

  async function remove() {
    if (!(await confirm(t("todoDeleteActionConfirm")))) return;
    try {
      await todoApi.deleteAction(action.id);
    } catch (e) {
      notify(String(e), "error");
    }
  }

  return (
    <div className="setting-row todo-action-row">
      <input
        type="color"
        className="todo-color-input"
        value={action.color || COLORS[0]}
        onChange={(e) => void save({ color: e.target.value })}
        aria-label={t("todoColor")}
      />
      <input
        className="todo-action-label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => label.trim() !== action.label && void save({ label })}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        aria-label={t("todoName")}
      />
      <label className="todo-waiting-check small">
        <input
          type="checkbox"
          checked={action.waiting}
          onChange={(e) => void save({ waiting: e.target.checked })}
        />
        {t("todoActionWaiting")}
      </label>
      <button
        className="icon-btn"
        disabled={first}
        onClick={() => onMove(-1)}
        title={tip("quickActionUp")}
        aria-label={t("quickActionUp")}
      >
        ↑
      </button>
      <button
        className="icon-btn"
        disabled={last}
        onClick={() => onMove(1)}
        title={tip("quickActionDown")}
        aria-label={t("quickActionDown")}
      >
        ↓
      </button>
      <button
        className="icon-btn todo-action-delete"
        onClick={() => void remove()}
        title={tip("delete")}
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
  const actions = data?.actions ?? [];

  async function move(index: number, delta: number) {
    const ids = actions.map((a) => a.id);
    const to = index + delta;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    try {
      await todoApi.reorder("action", ids);
    } catch (e) {
      notify(String(e), "error");
    }
  }

  async function add() {
    try {
      await todoApi.saveAction({
        label: t("todoNewAction"),
        waiting: false,
        color: COLORS[actions.length % COLORS.length],
      });
    } catch (e) {
      notify(String(e), "error");
    }
  }

  return (
    <section className="settings-block">
      <h2>{t("todoActions")}</h2>
      <p className="muted small">{t("todoActionsHint")}</p>
      {actions.map((a, i) => (
        <ActionRow
          key={a.id}
          action={a}
          first={i === 0}
          last={i === actions.length - 1}
          onMove={(d) => void move(i, d)}
        />
      ))}
      <button className="btn" onClick={() => void add()}>
        + {t("add")}
      </button>
      <p className="muted small">{t("todoStatusesHint")}</p>
    </section>
  );
}
