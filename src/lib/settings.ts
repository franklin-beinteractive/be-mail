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
}

const KEY = "BE-Mail.ui";

export const defaultSettings: UiSettings = {
  theme: "light",
  fontScale: 1,
  highContrast: false,
  lang: "nl",
  signatures: [],
  signatureNewId: null,
  signatureReplyId: null,
  sendDelaySeconds: 5,
  foldersWidth: 240,
  listWidth: 340,
  folderOrder: {},
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
  root.lang = s.lang;
}
