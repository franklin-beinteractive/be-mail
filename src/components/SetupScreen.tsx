// Eenmalig instelscherm: Client-ID + Tenant-ID (van de beheerder).
import { useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/ctx";

export default function SetupScreen({
  onSaved,
  initial,
}: {
  onSaved: () => void;
  initial?: { clientId: string; tenantId: string } | null;
}) {
  const { t, notify } = useApp();
  const [clientId, setClientId] = useState(initial?.clientId ?? "");
  const [tenantId, setTenantId] = useState(initial?.tenantId ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!clientId.trim()) {
      notify(t("clientId") + "?", "error");
      return;
    }
    setBusy(true);
    try {
      await api.saveConfig(clientId.trim(), tenantId.trim());
      notify(t("saved"), "info");
      onSaved();
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="centered">
      <div className="card">
        <h1>{t("setupTitle")}</h1>
        <p className="muted">{t("setupIntro")}</p>
        <label className="field">
          <span>{t("clientId")}</span>
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            autoFocus
          />
        </label>
        <label className="field">
          <span>{t("tenantId")}</span>
          <input
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="organizations"
          />
        </label>
        <button className="btn primary big" onClick={save} disabled={busy}>
          {t("save")}
        </button>
      </div>
    </div>
  );
}
