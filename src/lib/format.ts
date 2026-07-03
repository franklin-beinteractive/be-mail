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

/** Mensvriendelijke bestandsgrootte: 824 B, 3,1 kB, 2,4 MB. */
export function fileSize(bytes?: number | null): string {
  if (bytes == null || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
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
 * `inlineImages` (cid → data-URI) vult ingesloten afbeeldingen in: de browser
 * kan `src="cid:…"` zelf niet laden, dus zonder deze map blijven ze kapot.
 */
export function sanitizeEmail(
  html: string,
  allowImages: boolean,
  inlineImages?: Record<string, string>
): string {
  const clean = DOMPurify.sanitize(html, {
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["onerror", "onload", "onclick"],
    ALLOW_DATA_ATTR: false,
  });
  const hasInline = !!inlineImages && Object.keys(inlineImages).length > 0;
  if (allowImages && !hasInline) return clean;
  const doc = new DOMParser().parseFromString(clean, "text/html");
  let changed = false;
  doc.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") || "";
    const cid = /^cid:(.+)$/i.exec(src)?.[1];
    if (cid) {
      const key = decodeSafe(cid).replace(/^<|>$/g, "");
      const data = inlineImages?.[key];
      if (data) {
        img.setAttribute("src", data);
        changed = true;
      }
      return; // ingesloten afbeelding: nooit als "extern" blokkeren
    }
    if (!allowImages && /^https?:/i.test(src)) {
      img.removeAttribute("src");
      img.setAttribute("alt", "🔒");
      changed = true;
    }
  });
  return changed ? doc.body.innerHTML : clean;
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function hasExternalImages(html: string): boolean {
  return /<img[^>]+src=["']https?:/i.test(html);
}

/**
 * Zet e-mail-HTML om naar platte tekst voor de eenvoudige editor
 * (gebruikt bij het heropenen van een concept). Opmaak gaat verloren.
 */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n");
  const doc = new DOMParser().parseFromString(withBreaks, "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}
