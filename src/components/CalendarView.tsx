// Agenda: maand-, week- en lijstweergave.
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/ctx";
import type { CalendarEvent } from "../lib/types";
import { timeOnly } from "../lib/format";
import { CALENDAR_VIEWS, type CalendarViewMode as ViewMode } from "../lib/settings";
import EventDialog from "./EventDialog";
import { ChevronLeft, ChevronRight, CloseIcon, EditIcon, PlusIcon, TrashIcon } from "./Icons";

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

// ---- Tijdgrid (dag/werkweek/week) ----

/** Hoogte van één uur in px; moet gelijk zijn aan --hour-h in app.css. */
const HOUR_H = 48;
const DAY_MINUTES = 24 * 60;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
/** Kortste blokhoogte in minuten: een afspraak van 5 minuten blijft leesbaar. */
const MIN_SLOT = 20;

/** Minuten sinds middernacht uit een Graph-dateTime ("2026-07-27T09:30:00"). */
function minutesOfDay(dt: string): number {
  const m = /T(\d{2}):(\d{2})/.exec(dt);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/**
 * Every day (YYYY-MM-DD) an event touches, from its first through its last day.
 * An end at exactly midnight does not add a day: Graph gives a single-day
 * all-day event an end of 00:00 on the day after.
 *
 * Needed because `/me/calendarView` returns everything that *overlaps* the
 * window, including an event that started before the visible week. Bucketing on
 * the start day alone made such an event disappear altogether.
 */
export function daysOfEvent(ev: CalendarEvent): string[] {
  const first = ev.start.dateTime.slice(0, 10);
  let last = ev.end.dateTime.slice(0, 10);
  if (last > first && minutesOfDay(ev.end.dateTime) === 0) {
    last = ymd(addDays(new Date(last + "T00:00:00"), -1));
  }
  if (last <= first) return [first];
  const out: string[] = [];
  // Upper bound: an event running longer than a year is cut off here.
  for (let d = new Date(first + "T00:00:00"), i = 0; i < 366; i++) {
    const key = ymd(d);
    if (key > last) break;
    out.push(key);
    d = addDays(d, 1);
  }
  return out;
}

/** Start time in minutes within `dayKey`; 0 if the event started earlier. */
function startMinutesInDay(ev: CalendarEvent, dayKey: string): number {
  if (ev.start.dateTime.slice(0, 10) < dayKey) return 0;
  return Math.min(minutesOfDay(ev.start.dateTime), DAY_MINUTES);
}

/** End time in minutes within `dayKey`; an event running into the next day is
 *  cut off at midnight. */
function endMinutesInDay(ev: CalendarEvent, dayKey: string): number {
  if (ev.end.dateTime.slice(0, 10) > dayKey) return DAY_MINUTES;
  return minutesOfDay(ev.end.dateTime);
}

/** Positie van één afspraak in de dagkolom; maten in px (verticaal) en
 *  procenten van de kolombreedte (horizontaal). */
export interface PlacedEvent {
  ev: CalendarEvent;
  top: number;
  height: number;
  left: number;
  width: number;
  /** Started on an earlier day and continues here from midnight. */
  continued: boolean;
}

/**
 * Places the events of day `dayKey` in the time grid: vertically at their start
 * time with the height of their duration, and overlapping events next to each
 * other (like Outlook). Events that do not touch each other all get the full
 * width. An event running across midnight is clipped on every day it covers.
 */
export function layoutDay(events: CalendarEvent[], dayKey: string): PlacedEvent[] {
  interface Slot {
    ev: CalendarEvent;
    s: number;
    e: number;
  }
  const slots: Slot[] = events
    .map((ev) => {
      const s = startMinutesInDay(ev, dayKey);
      const e = Math.min(Math.max(endMinutesInDay(ev, dayKey), s + MIN_SLOT), DAY_MINUTES);
      return { ev, s, e };
    })
    // Op starttijd; bij gelijke start de langste eerst (die wordt de linker kolom).
    .sort((a, b) => a.s - b.s || b.e - a.e);

  const out: PlacedEvent[] = [];
  // Een "tros" is een groep afspraken die elkaar (indirect) overlappen; de
  // breedte wordt per tros bepaald, zodat een losse afspraak verderop op de
  // dag niet smaller wordt door een dubbele boeking in de ochtend.
  let cluster: Slot[] = [];
  let clusterEnd = -1;

  const flush = () => {
    const colEnds: number[] = []; // eindtijd per kolom binnen deze tros
    const colOf = new Map<Slot, number>();
    for (const it of cluster) {
      let c = colEnds.findIndex((end) => end <= it.s);
      if (c === -1) {
        c = colEnds.length;
        colEnds.push(it.e);
      } else {
        colEnds[c] = it.e;
      }
      colOf.set(it, c);
    }
    const n = colEnds.length || 1;
    for (const it of cluster) {
      const c = colOf.get(it) ?? 0;
      out.push({
        ev: it.ev,
        top: (it.s / 60) * HOUR_H,
        height: ((it.e - it.s) / 60) * HOUR_H,
        left: (c / n) * 100,
        width: 100 / n,
        continued: it.ev.start.dateTime.slice(0, 10) < dayKey,
      });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const it of slots) {
    if (cluster.length > 0 && it.s >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  if (cluster.length > 0) flush();
  return out;
}

/** Bar in the all-day strip: which day columns it covers (`col` is the index
 *  into the visible days) and which row it ends up on. */
export interface AllDayBar {
  ev: CalendarEvent;
  col: number;
  span: number;
  lane: number;
}

/**
 * Lays out the all-day events in the strip above the time grid: one bar per
 * event across every day it covers (like Outlook), with overlapping bars
 * stacked underneath each other. Days outside the view are clipped; an event
 * carried in from before the window simply starts at the left edge.
 */
export function layoutAllDay(events: CalendarEvent[], dayKeys: string[]): AllDayBar[] {
  const index = new Map(dayKeys.map((k, i) => [k, i]));
  const bars: AllDayBar[] = [];
  // Per row, the last column already taken; a row only exists once it is used.
  const laneEnds: number[] = [];
  for (const ev of events) {
    let first = Infinity;
    let last = -Infinity;
    for (const key of daysOfEvent(ev)) {
      const i = index.get(key);
      if (i === undefined) continue;
      if (i < first) first = i;
      if (i > last) last = i;
    }
    if (last < first) continue; // falls entirely outside the visible days
    let lane = laneEnds.findIndex((end) => end < first);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(last);
    } else {
      laneEnds[lane] = last;
    }
    bars.push({ ev, col: first, span: last - first + 1, lane });
  }
  return bars;
}

/** Minuten sinds middernacht, nu. */
function nowMinutes(): number {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

export default function CalendarView() {
  const { t, settings, setSettings, notify, confirm, capabilities } = useApp();
  // Actief account zonder agenda (bv. een IMAP-account zonder CalDAV): geen
  // events ophalen, lege staat tonen. Null = accounts nog niet geladen.
  const hasCalendar = capabilities ? capabilities.hasCalendar : true;
  // De weergave staat in de instellingen, niet in lokale state: dit component
  // wordt ontkoppeld zodra je naar Mail gaat, en dan zou de keuze verdampen.
  // Onbekende waarde (oude of handmatig aangepaste opslag) → terug naar maand.
  const mode = CALENDAR_VIEWS.includes(settings.calendarView)
    ? settings.calendarView
    : "month";
  const setMode = (m: ViewMode) => setSettings({ calendarView: m });
  const [anchor, setAnchor] = useState(() => new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  // Nieuwe afspraak: dag + (in het tijdgrid) de aangeklikte begintijd.
  const [creating, setCreating] = useState<{ date: string; time?: string } | null>(null);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [detail, setDetail] = useState<CalendarEvent | null>(null);
  // Slepen van een afspraak naar een andere dag.
  const [dragEventId, setDragEventId] = useState<string | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);
  const locale = settings.lang === "nl" ? "nl-NL" : "en-GB";
  // Tijdgrid: scrollpositie bijsturen en de "nu"-lijn elke minuut verzetten.
  const gridRef = useRef<HTMLDivElement>(null);
  const [nowMin, setNowMin] = useState(nowMinutes);

  const range = useMemo(() => {
    if (mode === "week") {
      const s = startOfWeek(anchor);
      return { start: s, end: addDays(s, 7) };
    }
    if (mode === "workweek") {
      const s = startOfWeek(anchor);
      return { start: s, end: addDays(s, 5) };
    }
    if (mode === "day") {
      const s = new Date(anchor);
      s.setHours(0, 0, 0, 0);
      return { start: s, end: addDays(s, 1) };
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
    // Wacht tot de accounts geladen zijn (geen flits met een foutmelding) en
    // sla het ophalen over voor een agendaloos account.
    if (!capabilities) return;
    if (!hasCalendar) {
      setEvents([]);
      return;
    }
    api
      .listEvents(isoLocal(range.start), isoLocal(range.end))
      .then(setEvents)
      .catch((e) => {
        // Een "geen agenda"-fout van de kern is geen echte fout: toon de lege
        // staat i.p.v. een rode melding.
        if (/geen agenda|no calendar/i.test(String(e))) {
          setEvents([]);
          return;
        }
        notify(String(e), "error");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.start, range.end, hasCalendar, capabilities]);

  // An event is filed under EVERY day it covers, not just its start day:
  // otherwise a multi-day event that started before the visible window drops
  // out of sight completely.
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      for (const key of daysOfEvent(e)) {
        const arr = map.get(key) ?? [];
        arr.push(e);
        map.set(key, arr);
      }
    }
    return map;
  }, [events]);

  // ---- Tijdgrid (dag/werkweek/week) ----
  const isTimeGrid = mode === "day" || mode === "workweek" || mode === "week";
  const dayCount = mode === "week" ? 7 : mode === "workweek" ? 5 : 1;
  const days = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => addDays(range.start, i)),
    [range.start, dayCount]
  );
  const dayKeys = useMemo(() => days.map(ymd), [days]);
  /** Per dag: de afspraken met een tijd, al ingedeeld in het grid. */
  const dayLayouts = useMemo(
    () =>
      dayKeys.map((key) =>
        layoutDay((byDay.get(key) ?? []).filter((e) => !e.isAllDay), key)
      ),
    [dayKeys, byDay]
  );
  /** All-day events do not belong in the time grid but in the strip above it,
   *  as a bar across every day they cover. */
  const allDayBars = useMemo(() => {
    const seen = new Set<string>();
    const list: CalendarEvent[] = [];
    for (const key of dayKeys) {
      for (const e of byDay.get(key) ?? []) {
        if (!e.isAllDay || seen.has(e.id)) continue;
        seen.add(e.id);
        list.push(e);
      }
    }
    return layoutAllDay(list, dayKeys);
  }, [dayKeys, byDay]);
  const allDayLanes = allDayBars.reduce((n, b) => Math.max(n, b.lane + 1), 0);

  // Bij 24 uur in beeld staat de werkdag onderaan: scroll naar de eerste
  // afspraak (of 08:00 op een lege dag) zodra de weergave of periode wijzigt.
  useEffect(() => {
    const el = gridRef.current;
    if (!el || !isTimeGrid) return;
    // An event carried over from the previous day starts here at 00:00; it does
    // not count, otherwise the grid would scroll to midnight.
    const starts = dayLayouts
      .flat()
      .filter((p) => !p.continued)
      .map((p) => p.top);
    const first = starts.length > 0 ? Math.min(...starts) : 8 * HOUR_H;
    // De vastgezette kop bedekt tijdens het scrollen precies zijn eigen hoogte,
    // dus scrollTop komt overeen met de bovenste zichtbare regel in het rooster.
    el.scrollTop = Math.max(0, first - 24);
  }, [isTimeGrid, dayLayouts]);

  // "Nu"-lijn: elke minuut verzetten.
  useEffect(() => {
    if (!isTimeGrid) return;
    const h = setInterval(() => setNowMin(nowMinutes()), 60_000);
    return () => clearInterval(h);
  }, [isTimeGrid]);

  function move(dir: number) {
    const d = new Date(anchor);
    if (mode === "month") d.setMonth(d.getMonth() + dir);
    else if (mode === "week" || mode === "workweek") d.setDate(d.getDate() + 7 * dir);
    else if (mode === "day") d.setDate(d.getDate() + dir);
    else d.setDate(d.getDate() + 30 * dir);
    setAnchor(d);
  }

  async function removeEvent(ev: CalendarEvent) {
    if (!(await confirm(t("confirmDelete")))) return;
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
    setEditing(null);
    setDetail(null);
  }

  /** Verplaatst een afspraak naar een andere dag (tijden blijven gelijk).
   *  Exchange stuurt genodigden automatisch een bijgewerkte uitnodiging. */
  async function moveEventToDay(eventId: string, dateKey: string) {
    const ev = events.find((x) => x.id === eventId);
    if (!ev) return;
    const startDate = ev.start.dateTime.slice(0, 10);
    if (startDate === dateKey) return;
    const days = Math.round(
      (new Date(dateKey + "T00:00:00").getTime() -
        new Date(startDate + "T00:00:00").getTime()) /
        86400000
    );
    const shift = (dt: string) => {
      const d = new Date(dt.slice(0, 10) + "T00:00:00");
      d.setDate(d.getDate() + days);
      return ymd(d) + dt.slice(10);
    };
    try {
      await api.updateEventTimes(ev.id, shift(ev.start.dateTime), shift(ev.end.dateTime));
      reload();
    } catch (e) {
      notify(String(e), "error");
    }
  }

  /** Drag & drop-handlers voor een dagcel/kolom. */
  function dayDropProps(dateKey: string) {
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!dragEventId) return;
        e.preventDefault();
        setDropDay((d) => (d === dateKey ? d : dateKey));
      },
      onDragLeave: () => setDropDay((d) => (d === dateKey ? null : d)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        const id = dragEventId;
        setDragEventId(null);
        setDropDay(null);
        if (id) void moveEventToDay(id, dateKey);
      },
    };
  }

  /** Drag-props voor een afspraak-chip. */
  function chipDragProps(ev: CalendarEvent) {
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        setDragEventId(ev.id);
        e.dataTransfer.effectAllowed = "move";
      },
      onDragEnd: () => {
        setDragEventId(null);
        setDropDay(null);
      },
    };
  }

  const title =
    mode === "month"
      ? anchor.toLocaleDateString(locale, { month: "long", year: "numeric" })
      : mode === "week" || mode === "workweek"
      ? `${startOfWeek(anchor).toLocaleDateString(locale, {
          day: "numeric",
          month: "short",
        })} – ${addDays(startOfWeek(anchor), mode === "workweek" ? 4 : 6).toLocaleDateString(locale, {
          day: "numeric",
          month: "short",
        })}`
      : mode === "day"
      ? anchor.toLocaleDateString(locale, {
          weekday: "long",
          day: "numeric",
          month: "long",
        })
      : t("agenda");

  const today = ymd(new Date());
  const weekdayNames =
    settings.lang === "nl"
      ? ["ma", "di", "wo", "do", "vr", "za", "zo"]
      : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // Agendaloos account: alleen een lege staat, geen toolbar/roosters.
  if (capabilities && !hasCalendar) {
    return (
      <div className="calendar">
        <p className="empty">{t("noCalendarForAccount")}</p>
      </div>
    );
  }

  return (
    <div className="calendar">
      <div className="cal-toolbar">
        <button className="btn primary" onClick={() => setCreating({ date: ymd(anchor) })}>
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
          {CALENDAR_VIEWS.map((m) => (
            <button
              key={m}
              className={"seg-btn" + (mode === m ? " active" : "")}
              onClick={() => setMode(m)}
            >
              {t(
                m === "day"
                  ? "day"
                  : m === "workweek"
                  ? "workweek"
                  : m === "week"
                  ? "week"
                  : m === "month"
                  ? "month"
                  : "agenda"
              )}
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
                className={
                  "cell" +
                  (inMonth ? "" : " dim") +
                  (key === today ? " today" : "") +
                  (dropDay === key ? " drop-target" : "")
                }
                onDoubleClick={() => setCreating({ date: key })}
                {...dayDropProps(key)}
              >
                <div className="cell-num">{d.getDate()}</div>
                <div className="cell-events">
                  {dayEvents.slice(0, 4).map((e) => (
                    <button
                      key={e.id}
                      className="chip"
                      onClick={() => setDetail(e)}
                      {...chipDragProps(e)}
                    >
                      {!e.isAllDay && <span className="chip-time">{timeOnly(e.start.dateTime)}</span>}{" "}
                      {e.subject || "(-)"}
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

      {isTimeGrid && (
        <div className="time-grid" ref={gridRef} style={{ "--days": dayCount } as React.CSSProperties}>
          {/* Dagkoppen (+ hele-dag-strook) blijven staan tijdens het scrollen. */}
          <div className="tg-sticky">
            <div className="tg-row tg-head">
              <div className="tg-gutter" />
              {days.map((d) => {
                const key = ymd(d);
                return (
                  <div
                    key={key}
                    className={"tg-dayhead" + (key === today ? " today" : "")}
                    onDoubleClick={() => setCreating({ date: key })}
                  >
                    <span className="dow">{weekdayNames[(d.getDay() + 6) % 7]}</span>
                    <span className="week-num">{d.getDate()}</span>
                  </div>
                );
              })}
            </div>
            {allDayLanes > 0 && (
              <div
                className="tg-row tg-allday"
                style={{ "--lanes": allDayLanes } as React.CSSProperties}
              >
                <div className="tg-gutter tg-allday-label">{t("allDay")}</div>
                {/* Day cells first (background + drop target), then the bars on
                    top of them: those may span several columns. */}
                {dayKeys.map((key, i) => (
                  <div
                    key={key}
                    className={"tg-allday-cell" + (dropDay === key ? " drop-target" : "")}
                    style={{ gridColumn: i + 2 }}
                    {...dayDropProps(key)}
                  />
                ))}
                {allDayBars.map((b) => (
                  <button
                    key={b.ev.id}
                    className="chip block tg-allday-bar"
                    style={{
                      gridColumn: `${b.col + 2} / span ${b.span}`,
                      gridRow: b.lane + 1,
                    }}
                    onClick={() => setDetail(b.ev)}
                    title={b.ev.subject || "(-)"}
                    {...chipDragProps(b.ev)}
                  >
                    {b.ev.subject || "(-)"}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="tg-row tg-body" style={{ height: 24 * HOUR_H }}>
            <div className="tg-gutter tg-hours">
              {HOURS.map((h) => (
                <div key={h} className="tg-hour">
                  <span>{String(h).padStart(2, "0")}</span>
                </div>
              ))}
            </div>
            {days.map((d, i) => {
              const key = ymd(d);
              return (
                <div
                  key={key}
                  className={
                    "tg-col" +
                    (key === today ? " today" : "") +
                    (dropDay === key ? " drop-target" : "")
                  }
                  {...dayDropProps(key)}
                >
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      className="tg-slot"
                      // Dubbelklik op een uur: nieuwe afspraak op dat tijdstip.
                      onDoubleClick={() =>
                        setCreating({ date: key, time: `${String(h).padStart(2, "0")}:00` })
                      }
                    />
                  ))}
                  {key === today && (
                    <div className="tg-now" style={{ top: (nowMin / 60) * HOUR_H }} />
                  )}
                  {dayLayouts[i].map((p) => (
                    <button
                      key={p.ev.id}
                      // Korter dan een uur: alles op één regel met puntjes.
                      // Anders snijdt de blokrand door de tweede tekstregel.
                      className={"tg-event" + (p.height < HOUR_H ? " tight" : "")}
                      style={{
                        top: p.top,
                        height: p.height,
                        left: `${p.left}%`,
                        width: `${p.width}%`,
                      }}
                      onClick={() => setDetail(p.ev)}
                      title={p.ev.subject || "(-)"}
                      {...chipDragProps(p.ev)}
                    >
                      <span className="tg-event-time">{timeOnly(p.ev.start.dateTime)}</span>{" "}
                      <span className="tg-event-title">{p.ev.subject || "(-)"}</span>
                      {/* Locatie krijgt een eigen regel, dus alleen tonen als
                          het blok minstens een uur hoog is; korter wordt het
                          toch afgekapt. */}
                      {p.height >= HOUR_H && p.ev.location?.displayName && (
                        <span className="tg-event-loc">{p.ev.location.displayName}</span>
                      )}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
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
                {e.subject || "(-)"}
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
          defaultDate={creating.date}
          defaultStartTime={creating.time}
          onClose={() => setCreating(null)}
          onSaved={reload}
        />
      )}

      {editing && (
        <EventDialog
          defaultDate={editing.start.dateTime.slice(0, 10)}
          event={editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}

      {detail && (
        <div className="overlay" role="dialog" aria-modal="true" onClick={() => setDetail(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <header className="dialog-head">
              <h2>{detail.subject || "(-)"}</h2>
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
              <button
                className="btn primary"
                onClick={() => {
                  setEditing(detail);
                  setDetail(null);
                }}
              >
                <EditIcon size={18} /> {t("edit")}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
