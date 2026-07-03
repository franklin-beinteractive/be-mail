// UI-voorkeuren (niet-gevoelig) — lokaal opgeslagen in localStorage en toegepast
// op de <html>-tag via data-attributen en CSS-variabelen.

import type { Lang } from "./i18n";

export type Theme = "light" | "dark";

/** Handtekening in platte tekst (past bij de eenvoudige editor). */
export interface Signature {
  id: string;
  name: string;
  text: string;
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
}

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
