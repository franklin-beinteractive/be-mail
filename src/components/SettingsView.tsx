// Instellingen: weergave (thema, tekstgrootte, contrast, taal) + account.
import { useApp } from "../lib/ctx";
import type { Account } from "../lib/types";

export default function SettingsView({
  account,
  onLogout,
  onEditConnection,
}: {
  account: Account | null;
  onLogout: () => void;
  onEditConnection: () => void;
}) {
  const { t, settings, setSettings } = useApp();

  return (
    <div className="settings">
      <h1>{t("settings")}</h1>

      <section className="settings-block">
        <h2>{t("account")}</h2>
        <p>
          <strong>{account?.displayName}</strong>
          <br />
          <span className="muted">{account?.mail ?? account?.userPrincipalName}</span>
        </p>
        <button className="btn" onClick={onLogout}>
          {t("logout")}
        </button>
      </section>

      <section className="settings-block">
        <h2>{t("appearance")}</h2>

        <div className="setting-row">
          <span>{t("theme")}</span>
          <div className="seg">
            <button
              className={"seg-btn" + (settings.theme === "light" ? " active" : "")}
              onClick={() => setSettings({ theme: "light" })}
            >
              {t("light")}
            </button>
            <button
              className={"seg-btn" + (settings.theme === "dark" ? " active" : "")}
              onClick={() => setSettings({ theme: "dark" })}
            >
              {t("dark")}
            </button>
          </div>
        </div>

        <div className="setting-row">
          <span>{t("fontSize")}</span>
          <input
            type="range"
            min="1"
            max="1.5"
            step="0.05"
            value={settings.fontScale}
            onChange={(e) => setSettings({ fontScale: parseFloat(e.target.value) })}
          />
          <span className="muted">{Math.round(settings.fontScale * 100)}%</span>
        </div>

        <div className="setting-row">
          <span>{t("highContrast")}</span>
          <input
            type="checkbox"
            checked={settings.highContrast}
            onChange={(e) => setSettings({ highContrast: e.target.checked })}
          />
        </div>

        <div className="setting-row">
          <span>{t("language")}</span>
          <div className="seg">
            <button
              className={"seg-btn" + (settings.lang === "nl" ? " active" : "")}
              onClick={() => setSettings({ lang: "nl" })}
            >
              Nederlands
            </button>
            <button
              className={"seg-btn" + (settings.lang === "en" ? " active" : "")}
              onClick={() => setSettings({ lang: "en" })}
            >
              English
            </button>
          </div>
        </div>
      </section>

      <section className="settings-block">
        <h2>{t("connection")}</h2>
        <button className="btn" onClick={onEditConnection}>
          {t("setupTitle")}
        </button>
      </section>
    </div>
  );
}
