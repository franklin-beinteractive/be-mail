// Backup/transfer: export & import of settings and assignments as .json.
// The file dialog is opened by the Rust core (bewaar_json/kies_json), so the
// webview never passes a file path. That keeps a script injection in the
// webview from reading or overwriting arbitrary files on disk.
// One-PC model: importing = overwriting.
import { invoke } from "@tauri-apps/api/core";

/**
 * Lets the user choose a save location and writes `inhoud` there.
 * Returns the chosen path, or null when the user cancelled.
 */
export async function bewaarJson(basisnaam: string, inhoud: string): Promise<string | null> {
  return invoke<string | null>("bewaar_json", { basisnaam, inhoud });
}

/**
 * Lets the user pick a .json file and returns its contents as text,
 * or null when the user cancelled.
 */
export async function kiesJson(): Promise<string | null> {
  return invoke<string | null>("kies_json");
}
