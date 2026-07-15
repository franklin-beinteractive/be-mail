// Gedeelde app-context: vertaalfunctie, UI-instellingen en een simpele toaster.

import { createContext, useContext } from "react";
import type { TextKey } from "./i18n";
import type { UiSettings } from "./settings";
import type { Capabilities } from "./types";

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
  /** Id van het actieve account (mailfuncties werken hierop). */
  activeAccountId: string | null;
  /** Wat het actieve account wel/niet kan (voor UI-gating). Null tot de
   *  accounts geladen zijn. */
  capabilities: Capabilities | null;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppContext ontbreekt");
  return ctx;
}
