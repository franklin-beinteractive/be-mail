// Kleine formatteringshelpers (datum, naam, HTML-veiligheid).

import DOMPurify from "dompurify";
import type { Lang } from "./i18n";

export function senderName(addr?: { name?: string | null; address?: string | null } | null): string {
  if (!addr) return "";
  return addr.name || addr.address || "";
}

export function senderAddress(addr?: { address?: string | null } | null): string {
  return addr?.address || "";
}

/** Korte, mensvriendelijke datum voor de berichtenlijst. */
export function shortDate(iso?: string | null, lang: Lang = "nl"): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const locale = lang === "nl" ? "nl-NL" : "en-GB";
  if (sameDay) {
    return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString(locale, { day: "2-digit", month: "short" });
}

export function longDateTime(iso?: string | null, lang: Lang = "nl"): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const locale = lang === "nl" ? "nl-NL" : "en-GB";
  return d.toLocaleString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Tijd HH:MM uit een Graph dateTime (geen tijdzone-conversie: Graph levert al lokaal). */
export function timeOnly(iso?: string | null): string {
  if (!iso) return "";
  // Graph geeft "2026-07-01T09:00:00.0000000"
  const m = iso.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "";
}

/**
 * Maakt e-mail-HTML veilig voor weergave. Blokkeert scripts en optioneel
 * externe afbeeldingen (tracking-pixels) tot de gebruiker ze wil zien.
 */
export function sanitizeEmail(html: string, allowImages: boolean): string {
  const clean = DOMPurify.sanitize(html, {
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["onerror", "onload", "onclick"],
    ALLOW_DATA_ATTR: false,
  });
  if (allowImages) return clean;
  // Strip externe (http/https) afbeeldingen; laat ingesloten cid:/data: staan.
  const doc = new DOMParser().parseFromString(clean, "text/html");
  let blocked = false;
  doc.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (/^https?:/i.test(src)) {
      img.removeAttribute("src");
      img.setAttribute("alt", "🔒");
      blocked = true;
    }
  });
  return blocked ? doc.body.innerHTML : clean;
}

export function hasExternalImages(html: string): boolean {
  return /<img[^>]+src=["']https?:/i.test(html);
}
