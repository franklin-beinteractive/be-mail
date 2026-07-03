// Gedeelde app-context: vertaalfunctie, UI-instellingen en een simpele toaster.

import { createContext, useContext } from "react";
import type { TextKey } from "./i18n";
import type { UiSettings } from "./settings";

export interface AppContextValue {
  t: (k: TextKey) => string;
  /** Als t(), maar voor title-attributen: undefined als tooltips uitstaan. */
  tip: (k: TextKey) => string | undefined;
  settings: UiSettings;
  setSettings: (patch: Partial<UiSettings>) => void;
  /** Toon een korte melding (fout of info) onderin het scherm. */
  notify: (message: string, kind?: "info" | "error") => void;
  /** Eigen bevestigings-modal (geen browser-confirm). */
  confirm: (message: string) => Promise<boolean>;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppContext ontbreekt");
  return ctx;
}
