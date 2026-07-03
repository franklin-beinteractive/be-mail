// UI-voorkeuren (niet-gevoelig) - lokaal opgeslagen in localStorage en toegepast
// op de <html>-tag via data-attributen en CSS-variabelen.

import type { Lang } from "./i18n";

export type Theme = "light" | "dark";

/** Handtekening. Nieuwe bewerkingen vullen `html` (wysiwyg, incl. afbeeldingen
 *  als data-URI); `text` is de oude platte-tekst-opslag en blijft de fallback. */
export interface Signature {
  id: string;
  name: string;
  text: string;
  html?: string;
}

/** HTML van een handtekening; oude platte-tekst-handtekeningen worden omgezet. */
export function signatureHtml(s: Signature): string {
  if (s.html != null) return s.html;
  return s.text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

export interface UiSettings {
  theme: Theme;
  /** Schaalfactor voor tekst: 1 = normaal, tot 1.5 voor slechtzienden. */
  fontScale: number;
  /** Lettertype voor de hele app; Calibri is de standaard. */
  fontFamily: string;
  highContrast: boolean;
  lang: Lang;
  signatures: Signature[];
  /** Standaard handtekening (id) bij een nieuw bericht; null = geen. */
  signatureNewId: string | null;
  /** Standaard handtekening (id) bij beantwoorden/doorsturen; null = geen. */
  signatureReplyId: string | null;
  /** Bedenktijd (undo send) in seconden; 0 = direct verzenden. */
  sendDelaySeconds: number;
  /** Kolombreedtes (px) in de mailweergave; instelbaar door te slepen. */
  foldersWidth: number;
  listWidth: number;
  /** Eigen mapvolgorde per bovenliggende map ("root" = hoofdniveau). */
  folderOrder: Record<string, string[]>;
  /** Map-id's die uitgeklapt zijn; alles is standaard ingeklapt. Onthouden
   *  over herstarts heen. */
  expandedFolders: string[];
  /** Account-id's waarvan de mappengroep is ingeklapt (standaard uitgeklapt). */
  collapsedAccounts: string[];
  /** Sleutels (uit HIDEABLE_FOLDERS) van standaardmappen die verborgen zijn. */
  hiddenFolders: string[];
  /** Tooltips (uitleg bij knoppen) tonen; standaard aan. */
  showTooltips: boolean;
}

/** Standaardmappen die de gebruiker kan verbergen (Postvak IN nooit).
 *  Herkenning op naam, NL en EN. */
export const HIDEABLE_FOLDERS = [
  { key: "archive", nl: "Archief", en: "Archive", re: /^(archief|archive)$/i },
  { key: "drafts", nl: "Concepten", en: "Drafts", re: /^(concepten|drafts)$/i },
  { key: "sent", nl: "Verzonden items", en: "Sent Items", re: /^(verzonden items|sent items)$/i },
  { key: "deleted", nl: "Verwijderde items", en: "Deleted Items", re: /^(verwijderde items|deleted items)$/i },
  { key: "junk", nl: "Ongewenste e-mail", en: "Junk Email", re: /^(ongewenste e-?mail|junk e-?mail)$/i },
  { key: "outbox", nl: "Postvak UIT", en: "Outbox", re: /^(postvak uit|outbox)$/i },
  { key: "history", nl: "Gespreksgeschiedenis (conversation history)", en: "Conversation History", re: /^(conversation history|gespreksgeschiedenis)$/i },
  { key: "rss", nl: "RSS-abonnementen", en: "RSS Feeds", re: /^rss[- ]?(abonnementen|feeds|subscriptions)$/i },
  { key: "snoozed", nl: "Uitgesteld (snoozed)", en: "Snoozed", re: /^(uitgesteld|snoozed)$/i },
  { key: "syncissues", nl: "Synchronisatieproblemen", en: "Sync Issues", re: /^(synchronisatieproblemen|sync issues)$/i },
] as const;

const KEY = "BE-Mail.ui";

/** Gangbare lettertypen (Windows) voor de keuzelijst in Instellingen. */
export const FONT_CHOICES = [
  "Calibri",
  "Segoe UI",
  "Arial",
  "Verdana",
  "Tahoma",
  "Georgia",
  "Times New Roman",
  "Courier New",
] as const;

export const defaultSettings: UiSettings = {
  theme: "light",
  fontScale: 1,
  fontFamily: "Calibri",
  highContrast: false,
  lang: "nl",
  signatures: [],
  signatureNewId: null,
  signatureReplyId: null,
  sendDelaySeconds: 5,
  foldersWidth: 240,
  listWidth: 340,
  folderOrder: {},
  expandedFolders: [],
  collapsedAccounts: [],
  hiddenFolders: [],
  showTooltips: true,
};

export function loadSettings(): UiSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultSettings };
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(s: UiSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* opslag niet beschikbaar: geen ramp */
  }
}

export function applySettings(s: UiSettings): void {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.dataset.contrast = s.highContrast ? "high" : "normal";
  root.style.setProperty("--font-scale", String(s.fontScale));
  root.style.setProperty("--font-family", s.fontFamily || "Calibri");
  root.lang = s.lang;
}
