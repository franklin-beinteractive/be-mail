// Instellingen: weergave (thema, tekstgrootte, contrast, taal), gedrag,
// handtekeningen + account.
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/ctx";
import type { Signature } from "../lib/settings";
import type { Account } from "../lib/types";
import { PlusIcon, TrashIcon } from "./Icons";

export default function SettingsView({
  account,
  onLogout,
  onEditConnection,
}: {
  account: Account | null;
  onLogout: () => void;
  onEditConnection: () => void;
}) {
  const { t, settings, setSettings, notify } = useApp();
  // Notificatie-instelling leeft in config.json (de Rust-poller leest die).
  const [notifEnabled, setNotifEnabled] = useState(true);

  useEffect(() => {
    api
      .getConfig()
      .then((cfg) => setNotifEnabled(cfg?.notificationsEnabled ?? true))
      .catch(() => {});
  }, []);

  async function toggleNotifications(on: boolean) {
    setNotifEnabled(on);
    try {
      await api.setNotificationsEnabled(on);
    } catch (e) {
      notify(String(e), "error");
      setNotifEnabled(!on);
    }
  }

  function patchSignature(id: string, patch: Partial<Signature>) {
    setSettings({
      signatures: settings.signatures.map((s) =>
        s.id === id ? { ...s, ...patch } : s
      ),
    });
  }

  function addSignature() {
    const sig: Signature = {
      id: crypto.randomUUID(),
      name: `${t("signature")} ${settings.signatures.length + 1}`,
      text: "",
    };
    setSettings({ signatures: [...settings.signatures, sig] });
  }

  function removeSignature(id: string) {
    setSettings({
      signatures: settings.signatures.filter((s) => s.id !== id),
      // Verwijzingen naar een verwijderde handtekening opruimen.
      signatureNewId: settings.signatureNewId === id ? null : settings.signatureNewId,
      signatureReplyId: settings.signatureReplyId === id ? null : settings.signatureReplyId,
    });
  }

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
        <h2>{t("behavior")}</h2>
        <div className="setting-row">
          <span>{t("sendDelay")}</span>
          <input
            type="number"
            min="0"
            max="60"
            style={{ width: 80 }}
            value={settings.sendDelaySeconds}
            onChange={(e) =>
              setSettings({
                sendDelaySeconds: Math.max(0, parseInt(e.target.value, 10) || 0),
              })
            }
          />
        </div>
        <div className="setting-row">
          <span>{t("notifications")}</span>
          <input
            type="checkbox"
            checked={notifEnabled}
            onChange={(e) => toggleNotifications(e.target.checked)}
          />
        </div>
      </section>

      <section className="settings-block">
        <h2>{t("signatures")}</h2>

        {settings.signatures.map((sig) => (
          <div key={sig.id} className="sig-item">
            <div className="sig-head">
              <label className="sig-name">
                <span className="muted small">{t("sigName")}</span>
                <input
                  value={sig.name}
                  onChange={(e) => patchSignature(sig.id, { name: e.target.value })}
                />
              </label>
              <button
                className="icon-btn"
                onClick={() => removeSignature(sig.id)}
                aria-label={t("delete")}
                title={t("delete")}
              >
                <TrashIcon size={18} />
              </button>
            </div>
            <textarea
              rows={4}
              value={sig.text}
              onChange={(e) => patchSignature(sig.id, { text: e.target.value })}
              placeholder="Met vriendelijke groet,&#10;…"
            />
          </div>
        ))}

        <button className="btn" onClick={addSignature}>
          <PlusIcon size={18} /> {t("addSignature")}
        </button>

        {settings.signatures.length > 0 && (
          <>
            <div className="setting-row">
              <span>{t("sigForNew")}</span>
              <select
                value={settings.signatureNewId ?? ""}
                onChange={(e) => setSettings({ signatureNewId: e.target.value || null })}
              >
                <option value="">{t("none")}</option>
                {settings.signatures.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="setting-row">
              <span>{t("sigForReply")}</span>
              <select
                value={settings.signatureReplyId ?? ""}
                onChange={(e) => setSettings({ signatureReplyId: e.target.value || null })}
              >
                <option value="">{t("none")}</option>
                {settings.signatures.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
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
