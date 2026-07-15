import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./lib/api";
import { AppContext, type AppContextValue } from "./lib/ctx";
import { translator } from "./lib/i18n";
import {
  applySettings,
  loadSettings,
  saveSettings,
  type UiSettings,
} from "./lib/settings";
import type {
  Account,
  AppConfig,
  Capabilities,
  StoredAccount,
} from "./lib/types";
import SetupScreen from "./components/SetupScreen";
import LoginScreen from "./components/LoginScreen";
import MailView from "./components/MailView";
import CalendarView from "./components/CalendarView";
import OpdrachtenView from "./components/opdrachten/OpdrachtenView";
import SettingsView from "./components/SettingsView";
import HelpView from "./components/HelpView";
import {
  CalendarIcon,
  HelpIcon,
  MailIcon,
  OpdrachtenIcon,
  SettingsIcon,
} from "./components/Icons";

type Phase = "loading" | "setup" | "login" | "app";
type Section = "mail" | "calendar" | "opdrachten" | "settings" | "help";

export default function App() {
  const [settings, setSettingsState] = useState<UiSettings>(() => loadSettings());
  const [phase, setPhase] = useState<Phase>("loading");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  // Gekoppelde accounts + het actieve account: nodig om functies te gaten
  // (Agenda, genodigden, IMAP-only mailfuncties) en reactief mee te wisselen.
  const [accounts, setAccounts] = useState<StoredAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("mail");
  const [toast, setToast] = useState<{ msg: string; kind: "info" | "error" } | null>(null);
  // Kaart die de opdrachten-sectie direct moet openen (mail → opdracht).
  const [opdrachtFocus, setOpdrachtFocus] = useState<number | null>(null);

  const t = translator(settings.lang);
  // Voor title-attributen: geen tooltip als de gebruiker ze uitzet.
  const tip = (k: Parameters<typeof t>[0]) =>
    settings.showTooltips ? t(k) : undefined;

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

  // Eigen bevestigings-modal (i.p.v. browser-confirm met "localhost zegt…").
  const [confirmReq, setConfirmReq] = useState<{
    msg: string;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const confirm = useCallback(
    (msg: string) =>
      new Promise<boolean>((resolve) => setConfirmReq({ msg, resolve })),
    []
  );
  function answerConfirm(ok: boolean) {
    confirmReq?.resolve(ok);
    setConfirmReq(null);
  }

  // Accounts + actief account ophalen; ook aanroepen na toevoegen/verwijderen/
  // wisselen zodat de gating (Agenda, genodigden, IMAP-only) meebeweegt.
  const refreshAccounts = useCallback(async () => {
    try {
      const info = await api.listAccounts();
      setAccounts(info.accounts);
      setActiveAccountId(info.active ?? info.accounts[0]?.id ?? null);
    } catch {
      // Stil: de rest van de app werkt ook zonder deze lijst.
    }
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
      await refreshAccounts();
      setPhase("app");
    } catch (e) {
      notify(String(e), "error");
      setPhase("login");
    }
  }, [notify, refreshAccounts]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  async function afterLogin() {
    try {
      const acc = await api.getAccount();
      setAccount(acc);
      await refreshAccounts();
      setSection("mail");
      setPhase("app");
    } catch (e) {
      notify(String(e), "error");
    }
  }

  async function logout() {
    await api.logout().catch(() => {});
    setAccount(null);
    setAccounts([]);
    setActiveAccountId(null);
    setPhase("login");
  }

  // Capabilities van het actieve account, met veilige fallbacks (de kern vult
  // hasCalendar/supportsPeople mogelijk nog niet): een IMAP-account heeft geen
  // agenda/genodigden tenzij expliciet aangegeven, een Office 365-account wel.
  const capabilities: Capabilities | null = useMemo(() => {
    const acc = accounts.find((a) => a.id === activeAccountId);
    if (!acc) return null;
    const isImap = acc.kind === "imap";
    return {
      kind: acc.kind ?? "office365",
      hasCalendar: acc.hasCalendar ?? !isImap,
      supportsPeople: acc.supportsPeople ?? !isImap,
      graphOnly: !isImap,
    };
  }, [accounts, activeAccountId]);

  // Agenda tonen zodra minstens één account een agenda heeft (een installatie
  // met alleen een agendaloos IMAP-account verbergt Agenda; gemengd O365+IMAP
  // houdt Agenda). Bij nog niet geladen accounts niet verbergen.
  const anyHasCalendar =
    accounts.length === 0 ||
    accounts.some((a) => a.hasCalendar ?? a.kind !== "imap");

  // Sta niet op de (verborgen) Agenda-sectie als geen enkel account een agenda
  // heeft.
  useEffect(() => {
    if (!anyHasCalendar && section === "calendar") setSection("mail");
  }, [anyHasCalendar, section]);

  const ctx: AppContextValue = {
    t,
    tip,
    settings,
    setSettings,
    notify,
    confirm,
    activeAccountId,
    capabilities,
  };

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        {phase === "loading" && <div className="centered">{t("loading")}</div>}

        {phase === "setup" && (
          <SetupScreen
            initial={config}
            onSaved={bootstrap}
            // Terugknop alleen als er al een werkende verbinding is (vanuit
            // Instellingen); bij de allereerste start valt er niets terug.
            onCancel={config?.clientId ? () => setPhase("app") : undefined}
          />
        )}

        {phase === "login" && <LoginScreen onLoggedIn={afterLogin} />}

        {phase === "app" && (
          <div className="shell">
            <nav className="rail" aria-label={t("appName")}>
              <button
                className={"rail-btn" + (section === "mail" ? " active" : "")}
                onClick={() => setSection("mail")}
                title={tip("mail")}
              >
                <MailIcon size={24} />
                <span>{t("mail")}</span>
              </button>
              {anyHasCalendar && (
                <button
                  className={"rail-btn" + (section === "calendar" ? " active" : "")}
                  onClick={() => setSection("calendar")}
                  title={tip("calendar")}
                >
                  <CalendarIcon size={24} />
                  <span>{t("calendar")}</span>
                </button>
              )}
              <button
                className={"rail-btn" + (section === "opdrachten" ? " active" : "")}
                onClick={() => setSection("opdrachten")}
                title={tip("opdrachten")}
              >
                <OpdrachtenIcon size={24} />
                <span>{t("opdrachten")}</span>
              </button>
              <span className="rail-spacer" />
              <button
                className={"rail-btn" + (section === "settings" ? " active" : "")}
                onClick={() => setSection("settings")}
                title={tip("settings")}
              >
                <SettingsIcon size={24} />
                <span>{t("settings")}</span>
              </button>
              <button
                className={"rail-btn" + (section === "help" ? " active" : "")}
                onClick={() => setSection("help")}
                title={tip("help")}
              >
                <HelpIcon size={24} />
                <span>{t("help")}</span>
              </button>
            </nav>

            <main className="content">
              {section === "mail" && (
                <MailView
                  onOpdrachtAangemaakt={(id) => {
                    setOpdrachtFocus(id);
                    setSection("opdrachten");
                  }}
                  onActiveAccountChange={setActiveAccountId}
                />
              )}
              {section === "calendar" && anyHasCalendar && <CalendarView />}
              {section === "opdrachten" && (
                <OpdrachtenView
                  focusKaartId={opdrachtFocus}
                  onFocusVerwerkt={() => setOpdrachtFocus(null)}
                />
              )}
              {section === "help" && <HelpView />}
              {section === "settings" && (
                <SettingsView
                  account={account}
                  onLogout={logout}
                  onEditConnection={() => setPhase("setup")}
                  onAccountsChanged={refreshAccounts}
                />
              )}
            </main>
          </div>
        )}

        {confirmReq && (
          <div className="overlay" role="alertdialog" aria-modal="true">
            <div className="dialog confirm-dialog">
              <div className="dialog-body">
                <p>{confirmReq.msg}</p>
              </div>
              <footer className="dialog-foot">
                <button className="btn" onClick={() => answerConfirm(false)}>
                  {t("cancel")}
                </button>
                <button className="btn primary" onClick={() => answerConfirm(true)} autoFocus>
                  {t("ok")}
                </button>
              </footer>
            </div>
          </div>
        )}

        {toast && <div className={"toast " + toast.kind}>{toast.msg}</div>}
      </div>
    </AppContext.Provider>
  );
}
