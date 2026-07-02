// Opstellen / beantwoorden / doorsturen. Eenvoudige teksteditor (rich-text = TODO).
// Concepten worden automatisch opgeslagen (debounced) en bij sluiten bewaard.
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/ctx";
import type { ComposeInput } from "../lib/types";
import { fileSize } from "../lib/format";
import { CloseIcon, PaperclipIcon, SendIcon } from "./Icons";

// Graph sendMail accepteert max ~3 MB aan inline bijlagen per bericht.
const MAX_ATTACH_BYTES = 3 * 1024 * 1024;
// Autosave-vertraging na de laatste wijziging.
const AUTOSAVE_MS = 3000;

interface PendingAttachment {
  name: string;
  contentType?: string;
  contentBase64: string;
  size: number; // alleen voor weergave/limiet
}

export interface ComposeInitial {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  bodyHtml?: string;
  /** Platte tekst om de editor mee te vullen (bij het openen van een concept). */
  text?: string;
  /** Id van een bestaand concept; wijzigingen worden dan dáárin opgeslagen. */
  draftId?: string;
  /** Bepaalt welke standaard-handtekening wordt ingevoegd. */
  kind?: "new" | "reply" | "forward";
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
  const { t, notify, settings } = useApp();

  // Standaard-handtekening: per soort bericht; niet bij een heropend concept
  // (daar zit de handtekening al in de tekst).
  const defaultSig = (() => {
    if (initial.draftId) return null;
    const id =
      initial.kind === "reply" || initial.kind === "forward"
        ? settings.signatureReplyId
        : settings.signatureNewId;
    return settings.signatures.find((s) => s.id === id) ?? null;
  })();

  const [to, setTo] = useState(initial.to ?? "");
  const [cc, setCc] = useState(initial.cc ?? "");
  const [bcc, setBcc] = useState(initial.bcc ?? "");
  const [subject, setSubject] = useState(initial.subject ?? "");
  const [text, setText] = useState(
    (initial.text ?? "") + (defaultSig ? `\n\n${defaultSig.text}` : "")
  );
  const [sigId, setSigId] = useState(defaultSig?.id ?? "");
  const [importance, setImportance] = useState("normal");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Concept-administratie. Refs zodat de autosave-timer altijd de actuele
  // stand ziet zonder de effect-afhankelijkheden op te blazen.
  const draftIdRef = useRef<string | null>(initial.draftId ?? null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const busyRef = useRef(false);
  busyRef.current = busy;

  const quoted = initial.bodyHtml ?? "";

  function split(v: string): string[] {
    return v
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function buildInput(): ComposeInput {
    const bodyHtml =
      `<div>${escapeHtml(text).replace(/\n/g, "<br>")}</div>` +
      (quoted ? `<hr>${quoted}` : "");
    return {
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
    };
  }

  function hasContent(): boolean {
    return !!(to.trim() || cc.trim() || bcc.trim() || subject.trim() || text.trim());
  }

  /** Slaat het concept op (eerste keer aanmaken, daarna bijwerken). */
  async function saveDraft() {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const input = buildInput();
      if (draftIdRef.current) {
        await api.updateDraft(draftIdRef.current, input);
      } else {
        const m = await api.createDraft(input);
        draftIdRef.current = m.id;
      }
      dirtyRef.current = false;
    } finally {
      savingRef.current = false;
    }
  }

  // Autosave: na elke wijziging een timer; stil falen (geen toast-spam).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    dirtyRef.current = true;
    const h = setTimeout(() => {
      if (!busyRef.current && hasContent()) saveDraft().catch(() => {});
    }, AUTOSAVE_MS);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, cc, bcc, subject, text, importance]);

  /** Sluiten: laatste wijzigingen als concept bewaren en dat even melden. */
  async function closeAndSave() {
    if (hasContent() && (dirtyRef.current || draftIdRef.current)) {
      try {
        if (dirtyRef.current) await saveDraft();
        notify(t("draftSaved") + " ✓", "info");
      } catch (e) {
        notify(String(e), "error");
      }
    }
    onClose();
  }

  /** Wisselt van handtekening: oude (indien ongewijzigd aan het eind) eruit, nieuwe erin. */
  function switchSignature(newId: string) {
    const oldSig = settings.signatures.find((s) => s.id === sigId);
    const nextSig = settings.signatures.find((s) => s.id === newId);
    setText((prev) => {
      let base = prev;
      if (oldSig) {
        const block = `\n\n${oldSig.text}`;
        if (base.endsWith(block)) base = base.slice(0, -block.length);
        else if (base.trim() === oldSig.text.trim()) base = "";
      }
      return nextSig ? `${base}\n\n${nextSig.text}` : base;
    });
    setSigId(newId);
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
    try {
      const input = buildInput();
      if (draftIdRef.current) {
        // Bestaand concept versturen: geen duplicaat, concept → Verzonden items.
        await api.sendDraft(draftIdRef.current, input);
      } else {
        await api.sendMessage(input);
      }
      dirtyRef.current = false;
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
          <button className="icon-btn" onClick={closeAndSave} aria-label={t("cancel")}>
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
          {settings.signatures.length > 0 && (
            <select
              value={sigId}
              onChange={(e) => switchSignature(e.target.value)}
              title={t("signature")}
            >
              <option value="">{t("signature")}: {t("none").toLowerCase()}</option>
              {settings.signatures.map((s) => (
                <option key={s.id} value={s.id}>
                  {t("signature")}: {s.name}
                </option>
              ))}
            </select>
          )}
          <span className="spacer" />
          <button className="btn" onClick={closeAndSave}>
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
