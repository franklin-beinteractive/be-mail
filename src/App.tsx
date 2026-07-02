import { useCallback, useEffect, useState } from "react";
import { api } from "./lib/api";
import { AppContext, type AppContextValue } from "./lib/ctx";
import { translator } from "./lib/i18n";
import {
  applySettings,
  loadSettings,
  saveSettings,
  type UiSettings,
} from "./lib/settings";
import type { Account, AppConfig } from "./lib/types";
import SetupScreen from "./components/SetupScreen";
import LoginScreen from "./components/LoginScreen";
import MailView from "./components/MailView";
import CalendarView from "./components/CalendarView";
import SettingsView from "./components/SettingsView";
import { CalendarIcon, MailIcon, SettingsIcon } from "./components/Icons";

type Phase = "loading" | "setup" | "login" | "app";
type Section = "mail" | "calendar" | "settings";

export default function App() {
  const [settings, setSettingsState] = useState<UiSettings>(() => loadSettings());
  const [phase, setPhase] = useState<Phase>("loading");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [section, setSection] = useState<Section>("mail");
  const [toast, setToast] = useState<{ msg: string; kind: "info" | "error" } | null>(null);

  const t = translator(settings.lang);

  useEffect(() => applySettings(settings), [settings]);

  const setSettings = useCallback((patch: Partial<UiSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const notify = useCallback((message: string, kind: "info" | "error" = "info") => {
    setToast({ msg: message, kind });
    window.setTimeout(() => setToast(null), 4500);
  }, []);

  const bootstrap = useCallback(async () => {
    setPhase("loading");
    try {
      const cfg = await api.getConfig();
      setConfig(cfg);
      if (!cfg || !cfg.clientId) {
        setPhase("setup");
        return;
      }
      const authed = await api.authStatus();
      if (!authed) {
        setPhase("login");
        return;
      }
      const acc = await api.getAccount();
      setAccount(acc);
      setPhase("app");
    } catch (e) {
      notify(String(e), "error");
      setPhase("login");
    }
  }, [notify]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  async function afterLogin() {
    try {
      const acc = await api.getAccount();
      setAccount(acc);
      setSection("mail");
      setPhase("app");
    } catch (e) {
      notify(String(e), "error");
    }
  }

  async function logout() {
    await api.logout().catch(() => {});
    setAccount(null);
    setPhase("login");
  }

  const ctx: AppContextValue = { t, settings, setSettings, notify };

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        {phase === "loading" && <div className="centered">{t("loading")}</div>}

        {phase === "setup" && (
          <SetupScreen
            initial={config}
            onSaved={bootstrap}
          />
        )}

        {phase === "login" && <LoginScreen onLoggedIn={afterLogin} />}

        {phase === "app" && (
          <div className="shell">
            <nav className="rail" aria-label={t("appName")}>
              <button
                className={"rail-btn" + (section === "mail" ? " active" : "")}
                onClick={() => setSection("mail")}
                title={t("mail")}
              >
                <MailIcon size={24} />
                <span>{t("mail")}</span>
              </button>
              <button
                className={"rail-btn" + (section === "calendar" ? " active" : "")}
                onClick={() => setSection("calendar")}
                title={t("calendar")}
              >
                <CalendarIcon size={24} />
                <span>{t("calendar")}</span>
              </button>
              <span className="rail-spacer" />
              <button
                className={"rail-btn" + (section === "settings" ? " active" : "")}
                onClick={() => setSection("settings")}
                title={t("settings")}
              >
                <SettingsIcon size={24} />
                <span>{t("settings")}</span>
              </button>
            </nav>

            <main className="content">
              {section === "mail" && <MailView account={account} />}
              {section === "calendar" && <CalendarView />}
              {section === "settings" && (
                <SettingsView
                  account={account}
                  onLogout={logout}
                  onEditConnection={() => setPhase("setup")}
                />
              )}
            </main>
          </div>
        )}

        {toast && <div className={"toast " + toast.kind}>{toast.msg}</div>}
      </div>
    </AppContext.Provider>
  );
}
