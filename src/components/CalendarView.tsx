// Agenda: maand-, week- en lijstweergave.
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/ctx";
import type { CalendarEvent } from "../lib/types";
import { timeOnly } from "../lib/format";
import EventDialog from "./EventDialog";
import { ChevronLeft, ChevronRight, CloseIcon, PlusIcon, TrashIcon } from "./Icons";

type ViewMode = "month" | "week" | "list";

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function isoLocal(d: Date): string {
  return `${ymd(d)}T${String(d.getHours()).padStart(2, "0")}:00:00`;
}
function startOfWeek(d: Date): Date {
  const r = new Date(d);
  const off = (r.getDay() + 6) % 7; // maandag = 0
  r.setDate(r.getDate() - off);
  r.setHours(0, 0, 0, 0);
  return r;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export default function CalendarView() {
  const { t, settings, notify } = useApp();
  const [mode, setMode] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [creating, setCreating] = useState<string | null>(null);
  const [detail, setDetail] = useState<CalendarEvent | null>(null);
  const locale = settings.lang === "nl" ? "nl-NL" : "en-GB";

  const range = useMemo(() => {
    if (mode === "week") {
      const s = startOfWeek(anchor);
      return { start: s, end: addDays(s, 7) };
    }
    if (mode === "list") {
      const s = new Date(anchor);
      s.setHours(0, 0, 0, 0);
      return { start: s, end: addDays(s, 30) };
    }
    // maand: eerste zichtbare (maandag) t/m 6 weken
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const s = startOfWeek(first);
    return { start: s, end: addDays(s, 42) };
  }, [mode, anchor]);

  useEffect(() => {
    api
      .listEvents(isoLocal(range.start), isoLocal(range.end))
      .then(setEvents)
      .catch((e) => notify(String(e), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.start, range.end]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const key = e.start.dateTime.slice(0, 10);
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return map;
  }, [events]);

  function move(dir: number) {
    const d = new Date(anchor);
    if (mode === "month") d.setMonth(d.getMonth() + dir);
    else if (mode === "week") d.setDate(d.getDate() + 7 * dir);
    else d.setDate(d.getDate() + 30 * dir);
    setAnchor(d);
  }

  async function removeEvent(ev: CalendarEvent) {
    if (!confirm(t("confirmDelete"))) return;
    try {
      await api.deleteEvent(ev.id);
      setEvents((prev) => prev.filter((x) => x.id !== ev.id));
      setDetail(null);
    } catch (e) {
      notify(String(e), "error");
    }
  }

  function reload() {
    api
      .listEvents(isoLocal(range.start), isoLocal(range.end))
      .then(setEvents)
      .catch((e) => notify(String(e), "error"));
    setCreating(null);
  }

  const title =
    mode === "month"
      ? anchor.toLocaleDateString(locale, { month: "long", year: "numeric" })
      : mode === "week"
      ? `${startOfWeek(anchor).toLocaleDateString(locale, {
          day: "numeric",
          month: "short",
        })} – ${addDays(startOfWeek(anchor), 6).toLocaleDateString(locale, {
          day: "numeric",
          month: "short",
        })}`
      : t("agenda");

  const today = ymd(new Date());
  const weekdayNames =
    settings.lang === "nl"
      ? ["ma", "di", "wo", "do", "vr", "za", "zo"]
      : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="calendar">
      <div className="cal-toolbar">
        <button className="btn primary" onClick={() => setCreating(ymd(anchor))}>
          <PlusIcon size={18} /> {t("newEvent")}
        </button>
        <button className="btn" onClick={() => setAnchor(new Date())}>
          {t("today")}
        </button>
        <button className="icon-btn" onClick={() => move(-1)} aria-label={t("prev")}>
          <ChevronLeft />
        </button>
        <button className="icon-btn" onClick={() => move(1)} aria-label={t("next")}>
          <ChevronRight />
        </button>
        <h2 className="cal-title">{title}</h2>
        <span className="spacer" />
        <div className="seg">
          {(["month", "week", "list"] as ViewMode[]).map((m) => (
            <button
              key={m}
              className={"seg-btn" + (mode === m ? " active" : "")}
              onClick={() => setMode(m)}
            >
              {t(m === "month" ? "month" : m === "week" ? "week" : "agenda")}
            </button>
          ))}
        </div>
      </div>

      {mode === "month" && (
        <div className="month-grid">
          {weekdayNames.map((w) => (
            <div key={w} className="dow">
              {w}
            </div>
          ))}
          {Array.from({ length: 42 }).map((_, i) => {
            const d = addDays(range.start, i);
            const key = ymd(d);
            const inMonth = d.getMonth() === anchor.getMonth();
            const dayEvents = byDay.get(key) ?? [];
            return (
              <div
                key={key}
                className={"cell" + (inMonth ? "" : " dim") + (key === today ? " today" : "")}
                onDoubleClick={() => setCreating(key)}
              >
                <div className="cell-num">{d.getDate()}</div>
                <div className="cell-events">
                  {dayEvents.slice(0, 4).map((e) => (
                    <button key={e.id} className="chip" onClick={() => setDetail(e)}>
                      {!e.isAllDay && <span className="chip-time">{timeOnly(e.start.dateTime)}</span>}{" "}
                      {e.subject || "(—)"}
                    </button>
                  ))}
                  {dayEvents.length > 4 && (
                    <span className="more">+{dayEvents.length - 4}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {mode === "week" && (
        <div className="week-grid">
          {Array.from({ length: 7 }).map((_, i) => {
            const d = addDays(range.start, i);
            const key = ymd(d);
            const dayEvents = byDay.get(key) ?? [];
            return (
              <div key={key} className={"week-col" + (key === today ? " today" : "")}>
                <div className="week-head" onDoubleClick={() => setCreating(key)}>
                  <span className="dow">{weekdayNames[i]}</span>
                  <span className="week-num">{d.getDate()}</span>
                </div>
                <div className="week-events">
                  {dayEvents.map((e) => (
                    <button key={e.id} className="chip block" onClick={() => setDetail(e)}>
                      {!e.isAllDay && (
                        <span className="chip-time">{timeOnly(e.start.dateTime)}</span>
                      )}{" "}
                      {e.subject || "(—)"}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {mode === "list" && (
        <div className="agenda-list">
          {events.length === 0 && <p className="empty">{t("noEvents")}</p>}
          {events.map((e) => (
            <button key={e.id} className="agenda-item" onClick={() => setDetail(e)}>
              <div className="agenda-date">
                {new Date(e.start.dateTime).toLocaleDateString(locale, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
              </div>
              <div className="agenda-time">
                {e.isAllDay ? t("allDay") : timeOnly(e.start.dateTime)}
              </div>
              <div className="agenda-subject">
                {e.subject || "(—)"}
                {e.location?.displayName && (
                  <span className="muted"> · {e.location.displayName}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {creating && (
        <EventDialog
          defaultDate={creating}
          onClose={() => setCreating(null)}
          onCreated={reload}
        />
      )}

      {detail && (
        <div className="overlay" role="dialog" aria-modal="true" onClick={() => setDetail(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <header className="dialog-head">
              <h2>{detail.subject || "(—)"}</h2>
              <button className="icon-btn" onClick={() => setDetail(null)} aria-label={t("cancel")}>
                <CloseIcon />
              </button>
            </header>
            <div className="dialog-body">
              <p>
                <strong>{t("start")}:</strong>{" "}
                {new Date(detail.start.dateTime).toLocaleString(locale, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
              {detail.location?.displayName && (
                <p>
                  <strong>{t("location")}:</strong> {detail.location.displayName}
                </p>
              )}
              {detail.bodyPreview && <p className="muted">{detail.bodyPreview}</p>}
            </div>
            <footer className="dialog-foot">
              <button className="btn danger" onClick={() => removeEvent(detail)}>
                <TrashIcon size={18} /> {t("delete")}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
