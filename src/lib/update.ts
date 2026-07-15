// In-app auto-updater. Controleert bij het opstarten en periodiek op een nieuwe
// versie via tauri-plugin-updater (endpoints/pubkey staan in tauri.conf.json),
// en downloadt + installeert op verzoek, gevolgd door een herstart. Buiten Tauri
// (gewone browser-dev) doet alles niets.

import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getCurrentWindow } from "@tauri-apps/api/window";

const isTauri = "__TAURI_INTERNALS__" in window;
// Achtergrond-check elke 30 minuten; ook bij terugkeren naar het venster.
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

export type UpdateStatus =
  | "idle"
  | "available"
  | "downloading"
  | "installing"
  | "error";

export interface AppUpdate {
  status: UpdateStatus;
  /** Beschikbare versie (als er een update klaarstaat), anders null. */
  version: string | null;
  /** Downloadvoortgang 0-100 tijdens "downloading". */
  progress: number;
  /** Download + installeer de update en herstart de app. */
  install: () => Promise<void>;
  /** Verberg de melding tot er een nieuwere versie verschijnt. */
  dismiss: () => void;
}

export function useAppUpdate(): AppUpdate {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const updateRef = useRef<Update | null>(null);
  const lastCheckAt = useRef(0);
  // Versie die de gebruiker heeft weggeklikt; niet opnieuw tonen.
  const dismissedVersion = useRef<string | null>(null);

  const runCheck = useCallback(async () => {
    if (!isTauri) return;
    lastCheckAt.current = Date.now();
    try {
      const upd = await check();
      if (upd && upd.version !== dismissedVersion.current) {
        updateRef.current = upd;
        setVersion(upd.version);
        setStatus("available");
      }
    } catch {
      // Stil falen bij een achtergrond-check (bijv. offline).
    }
  }, []);

  const install = useCallback(async () => {
    const upd = updateRef.current;
    if (!upd) return;
    setStatus("downloading");
    setProgress(0);
    try {
      let total = 0;
      let done = 0;
      await upd.downloadAndInstall((e) => {
        if (e.event === "Started") {
          total = e.data.contentLength ?? 0;
        } else if (e.event === "Progress") {
          done += e.data.chunkLength;
          if (total > 0) setProgress(Math.round((done / total) * 100));
        } else if (e.event === "Finished") {
          setStatus("installing");
        }
      });
      await relaunch();
    } catch {
      setStatus("error");
    }
  }, []);

  const dismiss = useCallback(() => {
    dismissedVersion.current = version;
    setStatus("idle");
  }, [version]);

  useEffect(() => {
    if (!isTauri) return;
    void runCheck();

    const id = window.setInterval(() => void runCheck(), CHECK_INTERVAL_MS);

    // Bij terugkeren naar het venster opnieuw checken, maar hooguit eens per
    // interval (focus/zichtbaar-worden vuurt veel vaker dan 30 minuten).
    const maybeCheck = () => {
      if (Date.now() - lastCheckAt.current > CHECK_INTERVAL_MS) void runCheck();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") maybeCheck();
    };
    document.addEventListener("visibilitychange", onVisible);
    const unfocus = getCurrentWindow().onFocusChanged(({ payload }) => {
      if (payload) maybeCheck();
    });

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      void unfocus.then((f) => f());
    };
  }, [runCheck]);

  return { status, version, progress, install, dismiss };
}
