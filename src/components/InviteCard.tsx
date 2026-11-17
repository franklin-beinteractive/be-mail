// Meeting block in the reader for an invitation, update or cancellation:
// when and where, the old time struck through when the meeting was moved,
// your response so far, and a small day view of your own calendar around the
// meeting (like Outlook), so a clash is visible before you accept.

import type { ReactNode } from "react";
import { useApp } from "../lib/ctx";
import { timeOnly } from "../lib/format";
import type { CalendarEvent, InviteDetails } from "../lib/types";
import { HOUR_H, layoutDay } from "./CalendarView";
import { ClockIcon } from "./Icons";

/** Pixels per hour in the mini day view (the calendar view uses HOUR_H). */
const MINI_HOUR = 36;
const SCALE = MINI_HOUR / HOUR_H;
/** At most this many hours are shown, also for a long meeting. */
const MAX_HOURS = 8;

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** The calendar window to fetch for the day of a meeting: [day 00:00, next day 00:00). */
export function dayWindow(start: string): [string, string] {
  const day = start.slice(0, 10);
  const next = new Date(day + "T00:00:00");
  next.setDate(next.getDate() + 1);
  return [`${day}T00:00:00`, `${ymd(next)}T00:00:00`];
}

function minutesOf(dt: string): number {
  const m = /T(\d{2}):(\d{2})/.exec(dt);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/** "maandag 16 november 2026 14:30-15:00" (or a range over days / all day). */
function formatRange(
  start: string,
  end: string,
  allDay: boolean,
  lang: string,
  allDayLabel: string
): string {
  const locale = lang === "nl" ? "nl-NL" : "en-GB";
  const day = (d: Date) =>
    d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "";
  if (allDay) {
    // Graph's all-day end is midnight after the last day.
    const last = new Date(e.getTime() - 1);
    return ymd(s) === ymd(last) ? `${day(s)} (${allDayLabel})` : `${day(s)} - ${day(last)}`;
  }
  if (start.slice(0, 10) === end.slice(0, 10)) {
    return `${day(s)} ${timeOnly(start)}-${timeOnly(end)}`;
  }
  return `${day(s)} ${timeOnly(start)} - ${day(e)} ${timeOnly(end)}`;
}

/** Is `ev` the calendar item of this invitation? By id, or - for a recurring
 *  meeting, where the calendar holds an occurrence with its own id - by
 *  subject and times. */
function isSelf(ev: CalendarEvent, d: InviteDetails, subject: string): boolean {
  if (d.eventId && ev.id === d.eventId) return true;
  return (
    (ev.subject ?? "") === subject &&
    ev.start.dateTime.slice(0, 16) === (d.start ?? "").slice(0, 16) &&
    ev.end.dateTime.slice(0, 16) === (d.end ?? "").slice(0, 16)
  );
}

export default function InviteCard({
  details,
  subject,
  dayEvents,
  actions,
}: {
  details: InviteDetails;
  subject: string;
  /** Your calendar for the meeting's day; null while loading or unavailable. */
  dayEvents: CalendarEvent[] | null;
  /** The accept/tentative/decline buttons (only for an invitation). */
  actions?: ReactNode;
}) {
  const { t, settings } = useApp();
  const { start, end } = details;
  const moved = !!(details.previousStart && details.previousEnd);
  const when =
    start && end ? formatRange(start, end, details.isAllDay, settings.lang, t("allDay")) : "";
  const before =
    moved ? formatRange(details.previousStart!, details.previousEnd!, details.isAllDay, settings.lang, t("allDay")) : "";

  const responseText = details.isCancelled
    ? t("inviteCancelled")
    : (
        {
          accepted: t("inviteRespAccepted"),
          tentativelyAccepted: t("inviteRespTentative"),
          declined: t("inviteRespDeclined"),
          organizer: t("inviteRespOrganizer"),
          none: t("inviteRespNone"),
          notResponded: t("inviteRespNone"),
        } as Record<string, string>
      )[details.response ?? ""] ?? "";

  // ---- Mini day view ----
  let grid: ReactNode = null;
  let conflicts: CalendarEvent[] = [];
  if (start && end && !details.isAllDay && dayEvents && !details.isCancelled) {
    const dayKey = start.slice(0, 10);
    const self: CalendarEvent = {
      id: details.eventId ?? "__invite",
      subject,
      start: { dateTime: start, timeZone: "" },
      end: { dateTime: end, timeZone: "" },
      location: { displayName: details.location ?? null },
    };
    const others = dayEvents.filter(
      (ev) => !ev.isAllDay && !ev.isCancelled && !isSelf(ev, details, subject)
    );
    const placed = layoutDay([...others, self], dayKey);

    const startMin = minutesOf(start);
    const endMin = end.slice(0, 10) > dayKey ? 24 * 60 : minutesOf(end);
    const fromH = Math.max(0, Math.floor(startMin / 60) - 1);
    const toH = Math.min(24, fromH + MAX_HOURS, Math.ceil(endMin / 60) + 1);
    const top0 = fromH * HOUR_H;
    const bottom0 = toH * HOUR_H;

    conflicts = others.filter((ev) => {
      const s = ev.start.dateTime.slice(0, 10) < dayKey ? 0 : minutesOf(ev.start.dateTime);
      const e = ev.end.dateTime.slice(0, 10) > dayKey ? 24 * 60 : minutesOf(ev.end.dateTime);
      return s < endMin && e > startMin;
    });

    grid = (
      <div className="invite-day" style={{ height: (toH - fromH) * MINI_HOUR }}>
        {Array.from({ length: toH - fromH }, (_, i) => (
          <div key={i} className="invite-hour" style={{ top: i * MINI_HOUR }}>
            <span className="invite-hour-label">{String(fromH + i).padStart(2, "0")}:00</span>
          </div>
        ))}
        <div className="invite-lane">
          {placed
            .filter((p) => p.top < bottom0 && p.top + p.height > top0)
            .map((p) => {
              const mine = p.ev === self;
              const top = Math.max(p.top, top0);
              const bottom = Math.min(p.top + p.height, bottom0);
              return (
                <div
                  key={p.ev.id + p.ev.start.dateTime}
                  className={"invite-ev" + (mine ? " self" : "")}
                  style={{
                    top: (top - top0) * SCALE,
                    height: Math.max((bottom - top) * SCALE - 2, 18),
                    left: `${p.left}%`,
                    width: `calc(${p.width}% - 4px)`,
                  }}
                  title={`${timeOnly(p.ev.start.dateTime)}-${timeOnly(p.ev.end.dateTime)} ${p.ev.subject ?? ""}`}
                >
                  <strong>{p.ev.subject || "-"}</strong>
                  {p.ev.location?.displayName ? ` ; ${p.ev.location.displayName}` : ""}
                </div>
              );
            })}
        </div>
      </div>
    );
  }

  return (
    <div className={"invite-card" + (details.isCancelled ? " cancelled" : "")}>
      {when && (
        <div className="invite-when">
          <ClockIcon size={16} />
          <span className={moved ? "invite-new" : undefined}>{when}</span>
          {moved && (
            <span className="invite-old" title={t("inviteMovedFrom")}>
              ({before})
            </span>
          )}
        </div>
      )}
      {(details.location || details.previousLocation) && (
        <div className="invite-where">
          <span className="muted">{t("location")}:</span>{" "}
          <span className={details.previousLocation ? "invite-new" : undefined}>
            {details.location || "-"}
          </span>
          {details.previousLocation && (
            <span className="invite-old">({details.previousLocation})</span>
          )}
        </div>
      )}
      {responseText && (
        <div className={"invite-response" + (details.isCancelled ? " danger" : "")}>
          {responseText}
        </div>
      )}
      {conflicts.length > 0 && (
        <div className="invite-conflict">
          {conflicts.length === 1
            ? t("inviteConflictOne")
            : t("inviteConflictMany").replace("{n}", String(conflicts.length))}
        </div>
      )}
      {grid}
      {actions && (
        <div className="invite-actions">
          <span className="rsvp-label">{t("invitation")}:</span>
          {actions}
        </div>
      )}
    </div>
  );
}
