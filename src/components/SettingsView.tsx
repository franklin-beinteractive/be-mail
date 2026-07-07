// Instellingen: weergave (thema, tekstgrootte, contrast, taal), gedrag,
// handtekeningen + account.
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/ctx";
import {
  FONT_CHOICES,
  HIDEABLE_FOLDERS,
  signatureHtml,
  type AiSkill,
  type Signature,
} from "../lib/settings";
import type {
  Account,
  AccountsInfo,
  AutoReplySettings,
  MessageRule,
} from "../lib/types";
import RichTextEditor from "./RichTextEditor";
import { PlusIcon, TrashIcon } from "./Icons";

// Zelfde tijdzone als de Rust-kern (graph.rs DEFAULT_TZ).
const TZ = "W. Europe Standard Time";

/** Graph-dateTime → waarde voor <input type="datetime-local">. */
function toLocalInput(dt?: { dateTime: string } | null): string {
  return dt?.dateTime?.slice(0, 16) ?? "";
}

export default function SettingsView({
  account,
  onLogout,
  onEditConnection,
}: {
  account: Account | null;
  onLogout: () => void;
  onEditConnection: () => void;
}) {
  const { t, tip, settings, setSettings, notify, confirm } = useApp();
  // Notificatie-instelling leeft in config.json (de Rust-poller leest die).
  const [notifEnabled, setNotifEnabled] = useState(true);
  // Gekoppelde accounts (multi-account).
  const [accInfo, setAccInfo] = useState<AccountsInfo>({ accounts: [], active: null });
  const [linking, setLinking] = useState(false);
  // Inbox-regels; null = nog aan het laden.
  const [rules, setRules] = useState<MessageRule[] | null>(null);
  // Afwezigheid; null = laden of geen MailboxSettings-consent (oofBlocked).
  const [oof, setOof] = useState<AutoReplySettings | null>(null);
  const [oofBlocked, setOofBlocked] = useState(false);
  const [oofBusy, setOofBusy] = useState(false);
  // Claude API-sleutel: staat in de keychain; hier alleen "is er een sleutel?"
  // en het invoerveld voor een nieuwe waarde.
  const [aiKeySet, setAiKeySet] = useState(false);
  const [aiKeyInput, setAiKeyInput] = useState("");

  useEffect(() => {
    api
      .getConfig()
      .then((cfg) => setNotifEnabled(cfg?.notificationsEnabled ?? true))
      .catch(() => {});
    api.listAccounts().then(setAccInfo).catch(() => {});
    api.listRules().then(setRules).catch(() => setRules([]));
    api
      .getAutoReply()
      .then(setOof)
      .catch(() => setOofBlocked(true));
    api.claudeKeyStatus().then(setAiKeySet).catch(() => {});
  }, []);

  async function saveClaudeKey() {
    try {
      await api.setClaudeKey(aiKeyInput.trim());
      setAiKeySet(aiKeyInput.trim() !== "");
      setAiKeyInput("");
      notify(t("saved"), "info");
    } catch (e) {
      notify(String(e), "error");
    }
  }

  function patchAiSkill(id: string, patch: Partial<AiSkill>) {
    setSettings({
      aiSkills: settings.aiSkills.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  }

  function addAiSkill() {
    setSettings({
      aiSkills: [
        ...settings.aiSkills,
        { id: crypto.randomUUID(), name: "", prompt: "" },
      ],
    });
  }

  function removeAiSkill(id: string) {
    setSettings({ aiSkills: settings.aiSkills.filter((s) => s.id !== id) });
  }

  async function toggleRule(r: MessageRule, on: boolean) {
    setRules((prev) =>
      prev?.map((x) => (x.id === r.id ? { ...x, isEnabled: on } : x)) ?? prev
    );
    try {
      await api.setRuleEnabled(r.id, on);
    } catch (e) {
      notify(String(e), "error");
      setRules((prev) =>
        prev?.map((x) => (x.id === r.id ? { ...x, isEnabled: !on } : x)) ?? prev
      );
    }
  }

  async function removeRule(r: MessageRule) {
    if (!(await confirm(t("confirmDelete")))) return;
    try {
      await api.deleteRule(r.id);
      setRules((prev) => prev?.filter((x) => x.id !== r.id) ?? prev);
    } catch (e) {
      notify(String(e), "error");
    }
  }

  async function saveOof(next: AutoReplySettings) {
    setOof(next);
    setOofBusy(true);
    try {
      await api.setAutoReply(next);
      notify(t("save") + " ✓", "info");
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setOofBusy(false);
    }
  }

  async function addAccount() {
    setLinking(true);
    try {
      await api.login();
      setAccInfo(await api.listAccounts());
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setLinking(false);
    }
  }

  async function removeAccount(id: string) {
    try {
      await api.logout(id);
      const info = await api.listAccounts();
      setAccInfo(info);
      if (info.accounts.length === 0) onLogout();
    } catch (e) {
      notify(String(e), "error");
    }
  }

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
      html: "",
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

      <div className="settings-cols">
      <section className="settings-block">
        <h2>{t("accounts")}</h2>
        {accInfo.accounts.length === 0 && account && (
          <p>
            <strong>{account.displayName}</strong>
            <br />
            <span className="muted">{account.mail ?? account.userPrincipalName}</span>
          </p>
        )}
        {accInfo.accounts.map((a) => (
          <div key={a.id} className="setting-row">
            <span>
              <strong>{a.displayName ?? a.mail}</strong>
              <br />
              <span className="muted small">
                {a.mail}
                {accInfo.active === a.id ? ` - ${t("activeAccount")}` : ""}
              </span>
            </span>
            <button className="btn" onClick={() => removeAccount(a.id)}>
              {t("logout")}
            </button>
          </div>
        ))}
        <button className="btn primary" onClick={addAccount} disabled={linking}>
          <PlusIcon size={18} /> {t("addAccount")}
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
          <span>{t("font")}</span>
          <select
            value={settings.fontFamily}
            onChange={(e) => setSettings({ fontFamily: e.target.value })}
            style={{ fontFamily: settings.fontFamily }}
          >
            {FONT_CHOICES.map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>
                {f}
              </option>
            ))}
          </select>
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
        <div className="setting-row">
          <span>{t("tooltipsSetting")}</span>
          <input
            type="checkbox"
            checked={settings.showTooltips}
            onChange={(e) => setSettings({ showTooltips: e.target.checked })}
          />
        </div>
      </section>

      <section className="settings-block">
        <h2>{t("folders")}</h2>
        <p className="muted small">{t("hideFoldersHint")}</p>
        {HIDEABLE_FOLDERS.map((c) => {
          const hidden = settings.hiddenFolders ?? [];
          const visible = !hidden.includes(c.key);
          return (
            <div key={c.key} className="setting-row">
              <input
                type="checkbox"
                checked={visible}
                onChange={(e) =>
                  setSettings({
                    hiddenFolders: e.target.checked
                      ? hidden.filter((k) => k !== c.key)
                      : [...hidden, c.key],
                  })
                }
              />
              <span>{settings.lang === "nl" ? c.nl : c.en}</span>
            </div>
          );
        })}
      </section>

      <section className="settings-block">
        <h2>{t("mailList")}</h2>
        <p className="muted small">{t("mailListHint")}</p>
        {(
          [
            ["listShowName", t("listFieldName")],
            ["listShowEmail", t("listFieldEmail")],
            ["listShowSubject", t("listFieldSubject")],
            ["listShowPreview", t("listFieldPreview")],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="setting-row">
            <input
              type="checkbox"
              checked={settings[key]}
              onChange={(e) => setSettings({ [key]: e.target.checked })}
            />
            <span>{label}</span>
          </div>
        ))}
      </section>

      <section className="settings-block">
        <h2>{t("rules")}</h2>
        {rules !== null && rules.length === 0 && (
          <p className="muted">{t("noRules")}</p>
        )}
        {(rules ?? []).map((r) => (
          <div key={r.id} className="setting-row">
            <input
              type="checkbox"
              checked={r.isEnabled ?? false}
              disabled={r.isReadOnly ?? false}
              onChange={(e) => toggleRule(r, e.target.checked)}
            />
            <span style={{ flex: 1 }}>{r.displayName ?? r.id}</span>
            {!(r.isReadOnly ?? false) && (
              <button
                className="icon-btn"
                onClick={() => removeRule(r)}
                aria-label={t("delete")}
                title={tip("delete")}
              >
                <TrashIcon size={16} />
              </button>
            )}
          </div>
        ))}
      </section>

      <section className="settings-block">
        <h2>{t("autoReply")}</h2>
        {oofBlocked && <p className="muted">{t("needsMailboxConsent")}</p>}
        {oof && (
          <>
            <div className="setting-row">
              <div className="seg">
                {(
                  [
                    ["disabled", t("oofOff")],
                    ["alwaysEnabled", t("oofOn")],
                    ["scheduled", t("oofScheduled")],
                  ] as const
                ).map(([val, label]) => (
                  <button
                    key={val}
                    className={"seg-btn" + (oof.status === val ? " active" : "")}
                    onClick={() => setOof({ ...oof, status: val })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {oof.status === "scheduled" && (
              <>
                <div className="setting-row">
                  <span>{t("oofStart")}</span>
                  <input
                    type="datetime-local"
                    value={toLocalInput(oof.scheduledStartDateTime)}
                    onChange={(e) =>
                      setOof({
                        ...oof,
                        scheduledStartDateTime: {
                          dateTime: `${e.target.value}:00`,
                          timeZone: TZ,
                        },
                      })
                    }
                  />
                </div>
                <div className="setting-row">
                  <span>{t("oofEnd")}</span>
                  <input
                    type="datetime-local"
                    value={toLocalInput(oof.scheduledEndDateTime)}
                    onChange={(e) =>
                      setOof({
                        ...oof,
                        scheduledEndDateTime: {
                          dateTime: `${e.target.value}:00`,
                          timeZone: TZ,
                        },
                      })
                    }
                  />
                </div>
              </>
            )}
            {oof.status !== "disabled" && (
              <>
                <div className="setting-col">
                  <span className="muted small">{t("oofInternal")}</span>
                  <RichTextEditor
                    initialHtml={oof.internalReplyMessage ?? ""}
                    onChange={(html) =>
                      setOof((prev) =>
                        prev ? { ...prev, internalReplyMessage: html } : prev
                      )
                    }
                    minHeight={90}
                  />
                </div>
                <div className="setting-row">
                  <span>{t("oofAudience")}</span>
                  <select
                    value={oof.externalAudience ?? "none"}
                    onChange={(e) =>
                      setOof({ ...oof, externalAudience: e.target.value })
                    }
                  >
                    <option value="none">{t("audNone")}</option>
                    <option value="contactsOnly">{t("audContacts")}</option>
                    <option value="all">{t("audAll")}</option>
                  </select>
                </div>
                {(oof.externalAudience ?? "none") !== "none" && (
                  <div className="setting-col">
                    <span className="muted small">{t("oofExternal")}</span>
                    <RichTextEditor
                      initialHtml={oof.externalReplyMessage ?? ""}
                      onChange={(html) =>
                        setOof((prev) =>
                          prev ? { ...prev, externalReplyMessage: html } : prev
                        )
                      }
                      minHeight={90}
                    />
                  </div>
                )}
              </>
            )}
            <div className="setting-row">
              <button
                className="btn primary"
                onClick={() => saveOof(oof)}
                disabled={oofBusy}
              >
                {t("save")}
              </button>
            </div>
          </>
        )}
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
                title={tip("delete")}
              >
                <TrashIcon size={18} />
              </button>
            </div>
            <RichTextEditor
              initialHtml={signatureHtml(sig)}
              onChange={(html) => patchSignature(sig.id, { html })}
              minHeight={90}
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
        <h2>{t("aiSection")}</h2>
        <p className="muted small">{t("aiKeyHint")}</p>
        <div className="setting-row">
          <span>{t("aiKeyLabel")}</span>
          <input
            type="password"
            style={{ flex: 1 }}
            value={aiKeyInput}
            onChange={(e) => setAiKeyInput(e.target.value)}
            placeholder="sk-ant-…"
            autoComplete="off"
          />
          <button className="btn" onClick={saveClaudeKey}>
            {t("save")}
          </button>
        </div>
        <p className="muted small">{aiKeySet ? t("aiKeySet") : t("aiKeyMissing")}</p>

        <p className="muted small">{t("aiSkillsHint")}</p>
        {settings.aiSkills.map((s) => (
          <div key={s.id} className="sig-item">
            <div className="sig-head">
              <label className="sig-name">
                <span className="muted small">{t("aiSkillName")}</span>
                <input
                  value={s.name}
                  onChange={(e) => patchAiSkill(s.id, { name: e.target.value })}
                />
              </label>
              <button
                className="icon-btn"
                onClick={() => removeAiSkill(s.id)}
                aria-label={t("delete")}
                title={tip("delete")}
              >
                <TrashIcon size={18} />
              </button>
            </div>
            <label className="setting-col">
              <span className="muted small">{t("aiSkillPrompt")}</span>
              <textarea
                rows={3}
                value={s.prompt}
                onChange={(e) => patchAiSkill(s.id, { prompt: e.target.value })}
              />
            </label>
          </div>
        ))}
        <button className="btn" onClick={addAiSkill}>
          <PlusIcon size={18} /> {t("addAiSkill")}
        </button>
      </section>

      <section className="settings-block">
        <h2>{t("connection")}</h2>
        <button className="btn" onClick={onEditConnection}>
          {t("setupTitle")}
        </button>
      </section>
      </div>
    </div>
  );
}
