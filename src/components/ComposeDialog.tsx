// Opstellen / beantwoorden / doorsturen. Eenvoudige teksteditor (rich-text = TODO).
import { useRef, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/ctx";
import { fileSize } from "../lib/format";
import { CloseIcon, PaperclipIcon, SendIcon } from "./Icons";

// Graph sendMail accepteert max ~3 MB aan inline bijlagen per bericht.
const MAX_ATTACH_BYTES = 3 * 1024 * 1024;

interface PendingAttachment {
  name: string;
  contentType?: string;
  contentBase64: string;
  size: number; // alleen voor weergave/limiet
}

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

/** Leest een bestand in als base64 (zonder data:-prefix). */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
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
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const quoted = initial.bodyHtml ?? "";

  function split(v: string): string[] {
    return v
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const current = attachments.reduce((n, a) => n + a.size, 0);
    let total = current;
    const extra: PendingAttachment[] = [];
    for (const file of Array.from(list)) {
      total += file.size;
      if (total > MAX_ATTACH_BYTES) {
        notify(t("attachTooLarge"), "error");
        break;
      }
      extra.push({
        name: file.name,
        contentType: file.type || undefined,
        contentBase64: await toBase64(file),
        size: file.size,
      });
    }
    if (extra.length) setAttachments((prev) => [...prev, ...extra]);
    if (fileInput.current) fileInput.current.value = "";
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
        attachments: attachments.map(({ name, contentType, contentBase64 }) => ({
          name,
          contentType,
          contentBase64,
        })),
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
          {attachments.length > 0 && (
            <div className="attachments-bar" style={{ margin: 0 }}>
              {attachments.map((a, i) => (
                <span key={i} className="attachment-chip" title={a.name}>
                  <PaperclipIcon size={14} />
                  <span className="attachment-name">{a.name}</span>
                  <span className="muted small">{fileSize(a.size)}</span>
                  <button
                    className="icon-btn"
                    onClick={() =>
                      setAttachments((prev) => prev.filter((_, j) => j !== i))
                    }
                    aria-label={t("delete")}
                  >
                    <CloseIcon size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {quoted && (
            <div
              className="quoted"
              dangerouslySetInnerHTML={{ __html: quoted }}
            />
          )}
        </div>
        <footer className="dialog-foot">
          <input
            ref={fileInput}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => addFiles(e.target.files)}
          />
          <button className="btn" onClick={() => fileInput.current?.click()}>
            <PaperclipIcon size={18} /> {t("attach")}
          </button>
          <span className="spacer" />
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
