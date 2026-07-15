// Inlogscherm: opent de officiële Microsoft-inlogpagina via de Rust-kern, of
// koppelt een IMAP-account (een verse installatie kan zonder Office 365 starten).
import { useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/ctx";
import AddImapAccountDialog from "./AddImapAccountDialog";
import { MailIcon } from "./Icons";

export default function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { t, notify } = useApp();
  const [busy, setBusy] = useState(false);
  const [imapOpen, setImapOpen] = useState(false);

  async function login() {
    setBusy(true);
    try {
      await api.login();
      onLoggedIn();
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="centered">
      <div className="card login">
        <div className="brand">
          <MailIcon size={40} />
          <span>{t("appName")}</span>
        </div>
        <button className="btn primary big" onClick={login} disabled={busy}>
          {busy ? t("loggingIn") : t("login")}
        </button>
        <button
          className="btn ghost big"
          onClick={() => setImapOpen(true)}
          disabled={busy}
        >
          {t("imapAddTitle")}
        </button>
        <p className="muted small">{t("loginHint")}</p>
      </div>
      {imapOpen && (
        <AddImapAccountDialog
          onClose={() => setImapOpen(false)}
          onAdded={() => {
            setImapOpen(false);
            onLoggedIn();
          }}
        />
      )}
    </div>
  );
}
