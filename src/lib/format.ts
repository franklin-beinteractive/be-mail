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

/** Korte, mensvriendelijke datum + tijd voor de berichtenlijst.
 *  Vandaag → "Vandaag 10:15", anders "04 jul 10:15". */
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
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (sameDay) {
    return `${lang === "nl" ? "Vandaag" : "Today"} ${time}`;
  }
  return `${d.toLocaleDateString(locale, { day: "2-digit", month: "short" })} ${time}`;
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

/** Scripts eruit, opmaak erin. Eén plek zodat weergave en URL-inventarisatie
 *  gegarandeerd naar dezelfde HTML kijken. */
function purify(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["onerror", "onload", "onclick"],
    ALLOW_DATA_ATTR: false,
  });
}

const EXTERNAL = /^https?:/i;
/** `url(...)` in een inline style; groep 1 = de URL zonder quotes. */
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;

/** Loopt door alles wat een externe afbeelding kan laden: `<img src>`,
 *  `<img srcset>`, het legacy `background`-attribuut en `url(...)` in een
 *  inline style. `fn` krijgt de URL en geeft de vervanging terug, of `null`
 *  om de verwijzing te verwijderen. */
function eachExternalRef(
  doc: Document,
  fn: (url: string) => string | null
): boolean {
  let changed = false;

  doc.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (EXTERNAL.test(src)) {
      const next = fn(src);
      if (next) img.setAttribute("src", next);
      else {
        img.removeAttribute("src");
        img.setAttribute("alt", "🔒");
      }
      changed = true;
    }
    // srcset zou de src overrulen en is altijd extern: weg ermee.
    if (img.hasAttribute("srcset")) {
      img.removeAttribute("srcset");
      changed = true;
    }
  });

  doc.querySelectorAll("[background]").forEach((el) => {
    const bg = el.getAttribute("background") || "";
    if (!EXTERNAL.test(bg)) return;
    const next = fn(bg);
    if (next) el.setAttribute("background", next);
    else el.removeAttribute("background");
    changed = true;
  });

  doc.querySelectorAll("[style]").forEach((el) => {
    const style = el.getAttribute("style") || "";
    if (!/url\(/i.test(style)) return;
    const next = style.replace(CSS_URL, (whole, dq, sq, bare) => {
      const url = (dq ?? sq ?? bare ?? "").trim();
      if (!EXTERNAL.test(url)) return whole;
      const repl = fn(url);
      // Geen vervanging? "none" laat de rest van de shorthand heel
      // (`background: #fff url(x) no-repeat` → `background: #fff none no-repeat`).
      return repl ? `url("${repl.replace(/"/g, "%22")}")` : "none";
    });
    if (next !== style) {
      el.setAttribute("style", next);
      changed = true;
    }
  });

  return changed;
}

/**
 * Maakt e-mail-HTML veilig voor weergave. Blokkeert scripts en - tot de
 * gebruiker ze wil zien - externe afbeeldingen (tracking-pixels).
 *
 * `inlineImages` (cid → data-URI) vult ingesloten afbeeldingen in: de webview
 * kan `src="cid:…"` zelf niet laden, dus zonder deze map blijven ze kapot.
 * `remoteImages` (externe URL → data-URI) doet hetzelfde voor externe
 * afbeeldingen: de CSP verbiedt de webview om externe URL's op te halen, dus
 * die worden door de Rust-kern gehaald (zie `api.fetchRemoteImage`). Een URL
 * die nog niet in de map staat, blijft leeg - hij is nog onderweg of mislukt.
 */
export function sanitizeEmail(
  html: string,
  allowImages: boolean,
  inlineImages?: Record<string, string>,
  remoteImages?: Record<string, string>
): string {
  const clean = purify(html);
  const doc = new DOMParser().parseFromString(clean, "text/html");
  let changed = false;

  // Ingesloten (cid:) afbeeldingen: nooit "extern", altijd invullen.
  doc.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") || "";
    const cid = /^cid:(.+)$/i.exec(src)?.[1];
    if (!cid) return;
    const key = decodeSafe(cid).replace(/^<|>$/g, "");
    const data = inlineImages?.[key];
    if (data) {
      img.setAttribute("src", data);
      changed = true;
    }
  });

  changed =
    eachExternalRef(doc, (url) =>
      allowImages ? remoteImages?.[url] ?? null : null
    ) || changed;

  return changed ? doc.body.innerHTML : clean;
}

/** Alle externe afbeeldings-URL's in een bericht (ontdubbeld), zodat de
 *  Rust-kern precies die kan ophalen zodra de gebruiker toestemming geeft. */
export function externalImageUrls(html: string): string[] {
  const doc = new DOMParser().parseFromString(purify(html), "text/html");
  const urls = new Set<string>();
  eachExternalRef(doc, (url) => {
    urls.add(url);
    return null; // niets vervangen; we inventariseren alleen
  });
  return [...urls];
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function hasExternalImages(html: string): boolean {
  return externalImageUrls(html).length > 0;
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
