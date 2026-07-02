// Opstellen / beantwoorden / doorsturen. Eenvoudige teksteditor (rich-text = TODO).
import { useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/ctx";
import { CloseIcon, SendIcon } from "./Icons";

export interface ComposeInitial {
  to?: string;
  cc?: string;
  subject?: string;
  bodyHtml?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export default function ComposeDialog({
  initial,
  onClose,
  onSent,
}: {
  initial: ComposeInitial;
  onClose: () => void;
  onSent: () => void;
}) {
  const { t, notify } = useApp();
  const [to, setTo] = useState(initial.to ?? "");
  const [cc, setCc] = useState(initial.cc ?? "");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(initial.subject ?? "");
  const [text, setText] = useState("");
  const [importance, setImportance] = useState("normal");
  const [busy, setBusy] = useState(false);

  const quoted = initial.bodyHtml ?? "";

  function split(v: string): string[] {
    return v
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function send() {
    if (split(to).length === 0) {
      notify(t("to") + "?", "error");
      return;
    }
    setBusy(true);
    const bodyHtml =
      `<div>${escapeHtml(text).replace(/\n/g, "<br>")}</div>` +
      (quoted ? `<hr>${quoted}` : "");
    try {
      await api.sendMessage({
        to: split(to),
        cc: split(cc),
        bcc: split(bcc),
        subject,
        bodyHtml,
        importance,
      });
      notify(t("send") + " ✓", "info");
      onSent();
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="dialog compose">
        <header className="dialog-head">
          <h2>{t("compose")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("cancel")}>
            <CloseIcon />
          </button>
        </header>
        <div className="dialog-body">
          <label className="row">
            <span>{t("to")}</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} autoFocus />
          </label>
          <label className="row">
            <span>{t("cc")}</span>
            <input value={cc} onChange={(e) => setCc(e.target.value)} />
          </label>
          <label className="row">
            <span>{t("bcc")}</span>
            <input value={bcc} onChange={(e) => setBcc(e.target.value)} />
          </label>
          <label className="row">
            <span>{t("subject")}</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label className="row">
            <span>{t("importance")}</span>
            <select value={importance} onChange={(e) => setImportance(e.target.value)}>
              <option value="normal">{t("normal")}</option>
              <option value="high">{t("high")}</option>
              <option value="low">{t("low")}</option>
            </select>
          </label>
          <textarea
            className="compose-body"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="…"
            rows={12}
          />
          {quoted && (
            <div
              className="quoted"
              dangerouslySetInnerHTML={{ __html: quoted }}
            />
          )}
        </div>
        <footer className="dialog-foot">
          <button className="btn" onClick={onClose}>
            {t("cancel")}
          </button>
          <button className="btn primary" onClick={send} disabled={busy}>
            <SendIcon size={18} /> {t("send")}
          </button>
        </footer>
      </div>
    </div>
  );
}
