// IMAP/SMTP-account toevoegen (+ optioneel CalDAV). Gemodelleerd op de
// EventDialog-formuliermodal. Het wachtwoord gaat naar de Rust-kern (keychain);
// de webview bewaart het nooit.
import { useRef, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/ctx";
import type { ImapAccountInput, TlsMode } from "../lib/types";
import { CloseIcon } from "./Icons";

export default function AddImapAccountDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const { t } = useApp();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [advanced, setAdvanced] = useState(false);
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [imapSecurity, setImapSecurity] = useState<TlsMode>("implicitTls");
  const [imapUsername, setImapUsername] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpSecurity, setSmtpSecurity] = useState<TlsMode>("startTls");
  const [smtpUsername, setSmtpUsername] = useState("");
  const [caldavUrl, setCaldavUrl] = useState("");

  // Zodra de gebruiker zelf een serverveld aanraakt, overschrijven we het niet
  // meer met een preset.
  const hostsTouched = useRef(false);
  // Preset-hint (bv. dat Gmail/Microsoft een app-wachtwoord vraagt).
  const [presetHint, setPresetHint] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function markHostsTouched() {
    hostsTouched.current = true;
  }

  /** Op e-mail-blur: presets ophalen en (indien niet handmatig aangeraakt)
   *  host/poort/beveiliging invullen. */
  async function applyPreset() {
    const mail = email.trim();
    if (!mail.includes("@")) return;
    try {
      const preset = await api.imapPresetsFor(mail);
      if (!preset) {
        setPresetHint(null);
        return;
      }
      setPresetHint(preset.hint ?? null);
      if (!hostsTouched.current) {
        setImapHost(preset.imapHost);
        setImapPort(String(preset.imapPort));
        setImapSecurity(preset.imapSecurity);
        setSmtpHost(preset.smtpHost);
        setSmtpPort(String(preset.smtpPort));
        setSmtpSecurity(preset.smtpSecurity);
        if (!imapUsername.trim()) setImapUsername(mail);
        if (!smtpUsername.trim()) setSmtpUsername(mail);
      }
    } catch {
      // Presets zijn optioneel; stil falen, de gebruiker vult zelf in.
    }
  }

  /** Bouwt de invoer voor de kern; usernames vallen terug op het e-mailadres. */
  function buildInput(): ImapAccountInput {
    const mail = email.trim();
    return {
      displayName: displayName.trim() || null,
      email: mail,
      password,
      imapHost: imapHost.trim(),
      imapPort: parseInt(imapPort, 10) || 993,
      imapSecurity,
      imapUsername: imapUsername.trim() || mail,
      smtpHost: smtpHost.trim(),
      smtpPort: parseInt(smtpPort, 10) || 587,
      smtpSecurity,
      smtpUsername: smtpUsername.trim() || mail,
      saveToSent: true,
      caldavUrl: caldavUrl.trim() || null,
    };
  }

  function validate(): boolean {
    if (!email.trim() || !password) {
      setErrorMsg(t("imapMissingFields"));
      return false;
    }
    return true;
  }

  async function test() {
    setTestOk(false);
    setErrorMsg(null);
    if (!validate()) return;
    setTesting(true);
    try {
      await api.testImapConnection(buildInput());
      setTestOk(true);
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setTesting(false);
    }
  }

  async function add() {
    setErrorMsg(null);
    if (!validate()) return;
    setBusy(true);
    try {
      await api.addImapAccount(buildInput());
      onAdded();
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  function SecuritySeg({
    value,
    onChange,
  }: {
    value: TlsMode;
    onChange: (v: TlsMode) => void;
  }) {
    return (
      <div className="seg">
        <button
          type="button"
          className={"seg-btn" + (value === "implicitTls" ? " active" : "")}
          onClick={() => {
            markHostsTouched();
            onChange("implicitTls");
          }}
        >
          {t("imapSecSsl")}
        </button>
        <button
          type="button"
          className={"seg-btn" + (value === "startTls" ? " active" : "")}
          onClick={() => {
            markHostsTouched();
            onChange("startTls");
          }}
        >
          {t("imapSecStartTls")}
        </button>
      </div>
    );
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="dialog">
        <header className="dialog-head">
          <h2>{t("imapAddTitle")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("cancel")}>
            <CloseIcon />
          </button>
        </header>
        <div className="dialog-body">
          <label className="row">
            <span>{t("imapDisplayName")}</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoFocus
            />
          </label>
          <label className="row">
            <span>{t("imapEmail")}</span>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setTestOk(false);
              }}
              onBlur={() => void applyPreset()}
              placeholder="naam@voorbeeld.nl"
            />
          </label>
          <label className="row">
            <span>{t("imapPassword")}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setTestOk(false);
              }}
              autoComplete="off"
            />
          </label>
          {presetHint && <p className="muted small">{presetHint}</p>}

          <div className="row" style={{ borderTop: "none" }}>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setAdvanced((v) => !v)}
              aria-expanded={advanced}
            >
              {advanced ? "▾" : "▸"} {t("imapAdvanced")}
            </button>
          </div>

          {advanced && (
            <>
              <p className="muted small">{t("imapServers")}</p>
              <label className="row">
                <span>{t("imapHost")}</span>
                <span className="inline-inputs">
                  <input
                    value={imapHost}
                    onChange={(e) => {
                      markHostsTouched();
                      setImapHost(e.target.value);
                    }}
                    placeholder="imap.voorbeeld.nl"
                  />
                  <input
                    type="number"
                    style={{ width: 90, flex: "none" }}
                    value={imapPort}
                    onChange={(e) => {
                      markHostsTouched();
                      setImapPort(e.target.value);
                    }}
                    aria-label={t("imapPort")}
                  />
                </span>
              </label>
              <div className="row">
                <span>{t("imapSecurity")}</span>
                <SecuritySeg value={imapSecurity} onChange={setImapSecurity} />
              </div>
              <label className="row">
                <span>{t("imapUsername")}</span>
                <input
                  value={imapUsername}
                  onChange={(e) => setImapUsername(e.target.value)}
                  placeholder={email.trim() || undefined}
                />
              </label>
              <label className="row">
                <span>{t("smtpHost")}</span>
                <span className="inline-inputs">
                  <input
                    value={smtpHost}
                    onChange={(e) => {
                      markHostsTouched();
                      setSmtpHost(e.target.value);
                    }}
                    placeholder="smtp.voorbeeld.nl"
                  />
                  <input
                    type="number"
                    style={{ width: 90, flex: "none" }}
                    value={smtpPort}
                    onChange={(e) => {
                      markHostsTouched();
                      setSmtpPort(e.target.value);
                    }}
                    aria-label={t("imapPort")}
                  />
                </span>
              </label>
              <div className="row">
                <span>{t("imapSecurity")}</span>
                <SecuritySeg value={smtpSecurity} onChange={setSmtpSecurity} />
              </div>
              <label className="row">
                <span>{t("smtpUsername")}</span>
                <input
                  value={smtpUsername}
                  onChange={(e) => setSmtpUsername(e.target.value)}
                  placeholder={email.trim() || undefined}
                />
              </label>
              <label className="row">
                <span>{t("caldavUrl")}</span>
                <input
                  value={caldavUrl}
                  onChange={(e) => setCaldavUrl(e.target.value)}
                  placeholder="https://…"
                />
              </label>
            </>
          )}

          {testOk && (
            <p className="test-ok">✓ {t("imapTestOk")}</p>
          )}
          {errorMsg && <p className="test-error">{errorMsg}</p>}
        </div>
        <footer className="dialog-foot">
          <button
            className="btn"
            onClick={test}
            disabled={testing || busy}
          >
            {testing ? t("imapTesting") : t("imapTest")}
          </button>
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </button>
          <button className="btn primary" onClick={add} disabled={busy || testing}>
            {busy ? t("imapAdding") : t("imapAdd")}
          </button>
        </footer>
      </div>
    </div>
  );
}
