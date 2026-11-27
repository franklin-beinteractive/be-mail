// The follow-up date of a card: a date field plus Today, Tomorrow and Next
// week, and Clear once a date is set. Used in the open card and in the
// "tasks for today" dialog, so both look and behave the same.
import { useEffect, useState } from "react";
import { useApp } from "../../lib/ctx";
import { addDays, isoDate } from "../../lib/todo";

export default function FollowUpField({
  value,
  today,
  onChange,
  label = true,
}: {
  value: string | null;
  today: string;
  onChange: (followUp: string | null) => void;
  /** Show the "Opvolgen" heading above the field. */
  label?: boolean;
}) {
  const { t } = useApp();
  const [due, setDue] = useState(value ?? "");
  // Follow outside changes without losing what is being typed: only reset
  // when the stored value changes.
  useEffect(() => setDue(value ?? ""), [value]);

  return (
    <div className="todo-field">
      {label && <span>{t("todoFollowUp")}</span>}
      <div className="todo-quick-dates">
        <input
          type="date"
          value={due}
          onChange={(e) => {
            // Typing a year passes through dates like 0002-11-25: save
            // only a plausible date right away, the rest on leaving.
            const v = e.target.value;
            setDue(v);
            if (v === "" || Number(v.slice(0, 4)) >= 2000) onChange(v || null);
          }}
          onBlur={() => due !== (value ?? "") && onChange(due || null)}
          aria-label={t("todoFollowUp")}
        />
        <button className="btn small" onClick={() => onChange(today)}>
          {t("todoToday")}
        </button>
        <button className="btn small" onClick={() => onChange(isoDate(addDays(new Date(), 1)))}>
          {t("todoTomorrow")}
        </button>
        <button className="btn small" onClick={() => onChange(isoDate(addDays(new Date(), 7)))}>
          {t("todoNextWeek")}
        </button>
        {value && (
          <button className="btn ghost small" onClick={() => onChange(null)}>
            {t("todoClear")}
          </button>
        )}
      </div>
    </div>
  );
}
