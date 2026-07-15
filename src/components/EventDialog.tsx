// Afspraak aanmaken of bewerken.
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/ctx";
import type { CalendarEvent, Person, RecurrenceInput } from "../lib/types";
import { CloseIcon } from "./Icons";

type RepeatChoice = "none" | RecurrenceInput["frequency"];

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
  const { t, notify, capabilities } = useApp();
  // Genodigden-autocomplete (Graph /me/people) alleen bij accounts die het
  // ondersteunen; anders blijft vrij intypen werken.
  const supportsPeople = capabilities ? capabilities.supportsPeople : true;
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
  // Genodigden als chips + autoaanvullen uit de organisatie (/me/people).
  const [attendees, setAttendees] = useState<string[]>([]);
  const [attQuery, setAttQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Person[]>([]);
  const [reminder, setReminder] = useState("15");
  const [body, setBody] = useState(event?.bodyPreview ?? "");
  // Herhaling: alleen instelbaar bij aanmaken (bewerken raakt de reeks niet aan).
  const [repeat, setRepeat] = useState<RepeatChoice>("none");
  const [repeatInterval, setRepeatInterval] = useState("1");
  const [repeatUntil, setRepeatUntil] = useState("");
  const [busy, setBusy] = useState(false);

  // Autoaanvullen: kort debouncen; stil falen (dan blijft los intypen werken).
  useEffect(() => {
    if (!supportsPeople) return;
    const q = attQuery.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const h = setTimeout(() => {
      api
        .searchPeople(q)
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, 300);
    return () => clearTimeout(h);
  }, [attQuery, supportsPeople]);

  function addAttendee(address: string) {
    const a = address.trim();
    if (a && !attendees.includes(a)) setAttendees((prev) => [...prev, a]);
    setAttQuery("");
    setSuggestions([]);
  }

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
      // Nog niet bevestigde invoer in het zoekveld telt ook mee.
      attendees: editing
        ? []
        : [...attendees, attQuery.trim()].filter(Boolean),
      reminderMinutes: reminder ? parseInt(reminder, 10) : null,
      recurrence:
        !editing && repeat !== "none"
          ? {
              frequency: repeat,
              interval: Math.max(1, parseInt(repeatInterval, 10) || 1),
              until: repeatUntil || undefined,
            }
          : undefined,
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
            <div className="row attendee-row">
              <span>{t("attendees")}</span>
              <div className="attendee-box">
                {attendees.length > 0 && (
                  <div className="attendee-chips">
                    {attendees.map((a) => (
                      <span key={a} className="attachment-chip">
                        <span className="attachment-name">{a}</span>
                        <button
                          className="icon-btn"
                          onClick={() =>
                            setAttendees((prev) => prev.filter((x) => x !== a))
                          }
                          aria-label={t("delete")}
                        >
                          <CloseIcon size={14} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  value={attQuery}
                  onChange={(e) => setAttQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && attQuery.trim()) {
                      e.preventDefault();
                      addAttendee(attQuery);
                    }
                  }}
                  placeholder="naam of e-mailadres…"
                />
                {!supportsPeople && (
                  <span className="muted small">{t("noContactSuggest")}</span>
                )}
                {suggestions.length > 0 && (
                  <div className="suggest-list">
                    {suggestions.map((p, i) => {
                      const addr = p.scoredEmailAddresses[0]?.address ?? "";
                      if (!addr) return null;
                      return (
                        <button
                          key={i}
                          className="suggest-item"
                          onClick={() => addAttendee(addr)}
                        >
                          <strong>{p.displayName || addr}</strong>{" "}
                          <span className="muted small">{addr}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
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
          {!editing && (
            <>
              <label className="row">
                <span>{t("repeat")}</span>
                <span className="inline-inputs">
                  <select
                    value={repeat}
                    onChange={(e) => setRepeat(e.target.value as RepeatChoice)}
                  >
                    <option value="none">{t("none")}</option>
                    <option value="daily">{t("daily")}</option>
                    <option value="weekly">{t("weekly")}</option>
                    <option value="monthly">{t("monthly")}</option>
                    <option value="yearly">{t("yearly")}</option>
                  </select>
                  {repeat !== "none" && (
                    <>
                      <span className="muted small">{t("repeatEvery")}</span>
                      <input
                        type="number"
                        min="1"
                        style={{ width: 64 }}
                        value={repeatInterval}
                        onChange={(e) => setRepeatInterval(e.target.value)}
                      />
                    </>
                  )}
                </span>
              </label>
              {repeat !== "none" && (
                <label className="row">
                  <span>{t("repeatUntil")}</span>
                  <input
                    type="date"
                    value={repeatUntil}
                    min={date}
                    onChange={(e) => setRepeatUntil(e.target.value)}
                  />
                </label>
              )}
            </>
          )}
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
