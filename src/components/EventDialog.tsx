// Afspraak aanmaken of bewerken.
import { useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/ctx";
import type { CalendarEvent } from "../lib/types";
import { CloseIcon } from "./Icons";

export default function EventDialog({
  defaultDate,
  event,
  onClose,
  onSaved,
}: {
  defaultDate: string; // "YYYY-MM-DD"
  event?: CalendarEvent | null; // indien gezet: bewerkmodus
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, notify } = useApp();
  const editing = !!event;
  const [subject, setSubject] = useState(event?.subject ?? "");
  const [date, setDate] = useState(event ? event.start.dateTime.slice(0, 10) : defaultDate);
  const [startTime, setStartTime] = useState(
    event && !event.isAllDay ? event.start.dateTime.slice(11, 16) : "09:00"
  );
  const [endTime, setEndTime] = useState(
    event && !event.isAllDay ? event.end.dateTime.slice(11, 16) : "10:00"
  );
  const [allDay, setAllDay] = useState(event?.isAllDay ?? false);
  const [location, setLocation] = useState(event?.location?.displayName ?? "");
  const [attendees, setAttendees] = useState("");
  const [reminder, setReminder] = useState("15");
  const [body, setBody] = useState(event?.bodyPreview ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!subject.trim()) {
      notify(t("eventTitle") + "?", "error");
      return;
    }
    setBusy(true);
    const start = allDay ? `${date}T00:00:00` : `${date}T${startTime}:00`;
    const end = allDay ? `${nextDay(date)}T00:00:00` : `${date}T${endTime}:00`;
    const input = {
      subject: subject.trim(),
      start,
      end,
      isAllDay: allDay,
      location: location.trim() || undefined,
      body: body.trim() || undefined,
      // Genodigden alleen bij aanmaken; bij bewerken laten we ze ongemoeid.
      attendees: editing
        ? []
        : attendees
            .split(/[,;]/)
            .map((s) => s.trim())
            .filter(Boolean),
      reminderMinutes: reminder ? parseInt(reminder, 10) : null,
    };
    try {
      if (editing) {
        await api.updateEvent(event!.id, input);
      } else {
        await api.createEvent(input);
      }
      notify(t("save") + " ✓", "info");
      onSaved();
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
          <h2>{editing ? t("editEvent") : t("newEvent")}</h2>
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
          {!editing && (
            <label className="row">
              <span>{t("attendees")}</span>
              <input value={attendees} onChange={(e) => setAttendees(e.target.value)} />
            </label>
          )}
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
          <button className="btn primary" onClick={save} disabled={busy}>
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
