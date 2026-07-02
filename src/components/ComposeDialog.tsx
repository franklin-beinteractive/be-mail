// Opstellen / beantwoorden / doorsturen, met eenvoudige rich-text editor
// (vet/cursief/onderstrepen/lijsten/link), automatische concepten, undo-send
// (korte aftelling) en "later verzenden" (Exchange bezorgt op gekozen moment).
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/ctx";
import type { ComposeInput } from "../lib/types";
import { fileSize } from "../lib/format";
import { ClockIcon, CloseIcon, PaperclipIcon, SendIcon } from "./Icons";

// Graph sendMail accepteert max ~3 MB aan inline bijlagen per bericht.
const MAX_ATTACH_BYTES = 3 * 1024 * 1024;
// Autosave-vertraging na de laatste wijziging.
const AUTOSAVE_MS = 3000;
// Bedenktijd (undo send) in seconden.
const UNDO_SECONDS = 5;

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
  /** HTML om de editor mee te vullen (bij het openen van een concept). */
  html?: string;
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

/** Platte handtekeningtekst → veilige HTML. */
function textToHtml(s: string): string {
  return escapeHtml(s).replace(/\n/g, "<br>");
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
  // (daar zit de handtekening al in de inhoud).
  const defaultSig = (() => {
    if (initial.draftId) return null;
    const id =
      initial.kind === "reply" || initial.kind === "forward"
        ? settings.signatureReplyId
        : settings.signatureNewId;
    return settings.signatures.find((s) => s.id === id) ?? null;
  })();

  // Startinhoud van de editor. Handtekening in een gemarkeerd blok zodat
  // wisselen hem kan terugvinden. Alleen bij de eerste render gebruikt.
  const [initialHtml] = useState(() => {
    if (initial.html) return initial.html;
    return defaultSig
      ? `<div><br></div><div data-sig="1">${textToHtml(defaultSig.text)}</div>`
      : "";
  });

  const [to, setTo] = useState(initial.to ?? "");
  const [cc, setCc] = useState(initial.cc ?? "");
  const [bcc, setBcc] = useState(initial.bcc ?? "");
  const [subject, setSubject] = useState(initial.subject ?? "");
  // `html` is alleen de autosave-trigger; de bron van waarheid is de editor-DOM.
  const [html, setHtml] = useState(initialHtml);
  const [sigId, setSigId] = useState(defaultSig?.id ?? "");
  const [importance, setImportance] = useState("normal");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  // Undo-send: resterende seconden; null = geen aftelling bezig.
  const [undoLeft, setUndoLeft] = useState<number | null>(null);
  // "Later verzenden": inline kiezer open + gekozen tijdstip (datetime-local).
  const [laterOpen, setLaterOpen] = useState(false);
  const [laterAt, setLaterAt] = useState("");
  // Link invoegen: inline invoer + bewaarde selectie.
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const savedRange = useRef<Range | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  // Concept-administratie. Refs zodat de autosave-timer altijd de actuele
  // stand ziet zonder de effect-afhankelijkheden op te blazen.
  const draftIdRef = useRef<string | null>(initial.draftId ?? null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const busyRef = useRef(false);
  busyRef.current = busy || undoLeft !== null;

  const quoted = initial.bodyHtml ?? "";

  function split(v: string): string[] {
    return v
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function editorHtml(): string {
    return editorRef.current?.innerHTML ?? html;
  }

  function syncHtml() {
    setHtml(editorRef.current?.innerHTML ?? "");
  }

  function buildInput(): ComposeInput {
    const bodyHtml = `<div>${editorHtml()}</div>` + (quoted ? `<hr>${quoted}` : "");
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
    const bodyText = editorRef.current?.textContent ?? "";
    return !!(to.trim() || cc.trim() || bcc.trim() || subject.trim() || bodyText.trim());
  }

  // ---- Editor-werkbalk ----

  function exec(cmd: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    syncHtml();
  }

  function openLink() {
    const sel = window.getSelection();
    savedRange.current =
      sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    setLinkUrl("");
    setLinkOpen(true);
  }

  function applyLink() {
    const raw = linkUrl.trim();
    setLinkOpen(false);
    if (!raw) return;
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    editorRef.current?.focus();
    const sel = window.getSelection();
    if (savedRange.current) {
      sel?.removeAllRanges();
      sel?.addRange(savedRange.current);
    }
    if (!sel || sel.isCollapsed) {
      document.execCommand("insertHTML", false, `<a href="${url}">${url}</a>`);
    } else {
      document.execCommand("createLink", false, url);
    }
    syncHtml();
  }

  // ---- Concepten ----

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
  }, [to, cc, bcc, subject, html, importance]);

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

  /** Wisselt van handtekening via het gemarkeerde blok in de editor. */
  function switchSignature(newId: string) {
    const ed = editorRef.current;
    if (!ed) return;
    const nextSig = settings.signatures.find((s) => s.id === newId);
    let block = ed.querySelector("[data-sig]");
    if (nextSig) {
      if (!block) {
        ed.insertAdjacentHTML("beforeend", `<div><br></div><div data-sig="1"></div>`);
        block = ed.querySelector("[data-sig]");
      }
      if (block) block.innerHTML = textToHtml(nextSig.text);
    } else if (block) {
      block.remove();
    }
    setSigId(newId);
    syncHtml();
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

  // ---- Verzenden (met bedenktijd) ----

  function validRecipients(): boolean {
    if (split(to).length === 0) {
      notify(t("to") + "?", "error");
      return false;
    }
    return true;
  }

  /** Start de aftelling; de echte verzending volgt na UNDO_SECONDS. */
  function startSend() {
    if (!validRecipients()) return;
    setUndoLeft(UNDO_SECONDS);
  }

  useEffect(() => {
    if (undoLeft === null) return;
    if (undoLeft <= 0) {
      setUndoLeft(null);
      void reallySend();
      return;
    }
    const h = setTimeout(
      () => setUndoLeft((p) => (p === null ? null : p - 1)),
      1000
    );
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoLeft]);

  async function reallySend() {
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

  /** Later verzenden: Exchange bezorgt op het gekozen moment (uit Concepten). */
  async function sendLater() {
    if (!validRecipients()) return;
    const when = new Date(laterAt);
    if (!laterAt || Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 60_000) {
      notify(t("laterInvalid"), "error");
      return;
    }
    setBusy(true);
    try {
      const input = buildInput();
      if (!draftIdRef.current) {
        const m = await api.createDraft(input);
        draftIdRef.current = m.id;
      }
      await api.sendDraft(draftIdRef.current, input, when.toISOString());
      dirtyRef.current = false;
      const locale = settings.lang === "nl" ? "nl-NL" : "en-GB";
      notify(
        `${t("scheduledFor")} ${when.toLocaleString(locale, {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })} ✓`,
        "info"
      );
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

          <div className="editor-toolbar">
            <button className="tool-btn" onClick={() => exec("bold")} title={t("bold")}>
              <strong>B</strong>
            </button>
            <button className="tool-btn" onClick={() => exec("italic")} title={t("italic")}>
              <em>I</em>
            </button>
            <button
              className="tool-btn"
              onClick={() => exec("underline")}
              title={t("underline")}
            >
              <span style={{ textDecoration: "underline" }}>U</span>
            </button>
            <span className="tool-sep" />
            <button
              className="tool-btn"
              onClick={() => exec("insertUnorderedList")}
              title={t("bullets")}
            >
              ••
            </button>
            <button
              className="tool-btn"
              onClick={() => exec("insertOrderedList")}
              title={t("numbering")}
            >
              1.
            </button>
            <span className="tool-sep" />
            <button className="tool-btn" onClick={openLink} title={t("insertLink")}>
              🔗
            </button>
            {linkOpen && (
              <span className="link-input">
                <input
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder={t("linkUrl")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") applyLink();
                    if (e.key === "Escape") setLinkOpen(false);
                  }}
                  autoFocus
                />
                <button className="btn" onClick={applyLink}>
                  {t("ok")}
                </button>
              </span>
            )}
          </div>
          <div
            ref={editorRef}
            className="editor"
            contentEditable
            suppressContentEditableWarning
            onInput={syncHtml}
            dangerouslySetInnerHTML={{ __html: initialHtml }}
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

        {laterOpen && undoLeft === null && (
          <div className="later-bar">
            <ClockIcon size={16} />
            <span>{t("sendLater")}:</span>
            <input
              type="datetime-local"
              value={laterAt}
              onChange={(e) => setLaterAt(e.target.value)}
            />
            <button className="btn primary" onClick={sendLater} disabled={busy}>
              {t("ok")}
            </button>
            <button className="icon-btn" onClick={() => setLaterOpen(false)} aria-label={t("cancel")}>
              <CloseIcon size={16} />
            </button>
          </div>
        )}

        {undoLeft !== null && (
          <div className="undo-bar">
            <span>
              {t("sendingIn")} {undoLeft} {t("seconds")}…
            </span>
            <button className="btn" onClick={() => setUndoLeft(null)}>
              {t("undoSend")}
            </button>
          </div>
        )}

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
          <button
            className="btn"
            onClick={() => setLaterOpen((v) => !v)}
            title={t("sendLater")}
          >
            <ClockIcon size={18} />
          </button>
          <span className="spacer" />
          <button className="btn" onClick={closeAndSave}>
            {t("cancel")}
          </button>
          <button
            className="btn primary"
            onClick={startSend}
            disabled={busy || undoLeft !== null}
          >
            <SendIcon size={18} /> {t("send")}
          </button>
        </footer>
      </div>
    </div>
  );
}
