// Nieuwe afspraak aanmaken.
import { useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/ctx";
import { CloseIcon } from "./Icons";

export default function EventDialog({
  defaultDate,
  onClose,
  onCreated,
}: {
  defaultDate: string; // "YYYY-MM-DD"
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, notify } = useApp();
  const [subject, setSubject] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState("");
  const [attendees, setAttendees] = useState("");
  const [reminder, setReminder] = useState("15");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!subject.trim()) {
      notify(t("eventTitle") + "?", "error");
      return;
    }
    setBusy(true);
    const start = allDay ? `${date}T00:00:00` : `${date}T${startTime}:00`;
    const end = allDay ? `${nextDay(date)}T00:00:00` : `${date}T${endTime}:00`;
    try {
      await api.createEvent({
        subject: subject.trim(),
        start,
        end,
        isAllDay: allDay,
        location: location.trim() || undefined,
        body: body.trim() || undefined,
        attendees: attendees
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean),
        reminderMinutes: reminder ? parseInt(reminder, 10) : null,
      });
      notify(t("save") + " ✓", "info");
      onCreated();
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="dialog">
        <header className="dialog-head">
          <h2>{t("newEvent")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("cancel")}>
            <CloseIcon />
          </button>
        </header>
        <div className="dialog-body">
          <label className="row">
            <span>{t("eventTitle")}</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} autoFocus />
          </label>
          <label className="row">
            <span>{t("start")}</span>
            <span className="inline-inputs">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              {!allDay && (
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              )}
            </span>
          </label>
          {!allDay && (
            <label className="row">
              <span>{t("end")}</span>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </label>
          )}
          <label className="row check">
            <span>{t("allDay")}</span>
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          </label>
          <label className="row">
            <span>{t("location")}</span>
            <input value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
          <label className="row">
            <span>{t("attendees")}</span>
            <input value={attendees} onChange={(e) => setAttendees(e.target.value)} />
          </label>
          <label className="row">
            <span>{t("reminder")}</span>
            <input
              type="number"
              min="0"
              value={reminder}
              onChange={(e) => setReminder(e.target.value)}
            />
          </label>
          <textarea
            className="compose-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            placeholder="…"
          />
        </div>
        <footer className="dialog-foot">
          <button className="btn" onClick={onClose}>
            {t("cancel")}
          </button>
          <button className="btn primary" onClick={create} disabled={busy}>
            {t("save")}
          </button>
        </footer>
      </div>
    </div>
  );
}

function nextDay(date: string): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
