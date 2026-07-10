// Back-up/overzetten: export & import van instellingen en assignments naar .json.
// De bestandskiezer komt van tauri-plugin-dialog; het lezen/schrijven zelf loopt
// via de Rust-kern (schrijf_tekstbestand/lees_tekstbestand) zodat we geen
// fs-scope-permissies nodig hebben. Eén-pc-model: importeren = overschrijven.
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

const JSON_FILTER = [{ name: "JSON", extensions: ["json"] }];

/** Datumstempel YYYY-MM-DD voor in de standaard-bestandsnaam. */
function vandaag(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Laat de gebruiker een opslaglocatie kiezen en schrijft `inhoud` daarheen.
 * Geeft het gekozen pad terug, of null als de gebruiker annuleerde.
 */
export async function bewaarJson(basisnaam: string, inhoud: string): Promise<string | null> {
  const pad = await save({
    defaultPath: `${basisnaam}-${vandaag()}.json`,
    filters: JSON_FILTER,
  });
  if (!pad) return null;
  await invoke("schrijf_tekstbestand", { pad, inhoud });
  return pad;
}

/**
 * Laat de gebruiker een .json kiezen en geeft de inhoud als tekst terug,
 * of null als de gebruiker annuleerde.
 */
export async function kiesJson(): Promise<string | null> {
  const pad = await open({ multiple: false, directory: false, filters: JSON_FILTER });
  if (typeof pad !== "string") return null;
  return invoke<string>("lees_tekstbestand", { pad });
}
