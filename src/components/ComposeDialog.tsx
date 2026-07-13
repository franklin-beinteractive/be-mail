// Opstellen / beantwoorden / doorsturen, met eenvoudige rich-text editor
// (vet/cursief/onderstrepen/lijsten/link), automatische concepten, undo-send
// (korte aftelling) en "later verzenden" (Exchange bezorgt op gekozen moment).
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/ctx";
import { composeFontCss, signatureHtml } from "../lib/settings";
import type { AttachmentInput, ComposeInput, Person } from "../lib/types";
import { fileSize } from "../lib/format";
import RichTextEditor from "./RichTextEditor";
import { ClockIcon, CloseIcon, PaperclipIcon, SendIcon } from "./Icons";

// Totale bijlagelimiet per bericht. Boven ~2,5 MB per bijlage schakelt de
// Rust-kern automatisch over op Graph upload-sessions; 25 MB is de gangbare
// Exchange-berichtlimiet.
const MAX_ATTACH_BYTES = 25 * 1024 * 1024;
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
  /** HTML om de editor mee te vullen (bij het openen van een concept). */
  html?: string;
  /** Id van een bestaand concept; wijzigingen worden dan dáárin opgeslagen. */
  draftId?: string;
  /** Bepaalt welke standaard-handtekening wordt ingevoegd. */
  kind?: "new" | "reply" | "forward";
}

/**
 * Zet data:-afbeeldingen (uit de editor/handtekening) om naar cid:-verwijzingen
 * met bijbehorende inline bijlagen. Nodig bij verzenden: mailclients van
 * ontvangers (Outlook, Gmail) blokkeren data-URI's in mail-HTML.
 */
function extractInlineImages(html: string): {
  html: string;
  attachments: AttachmentInput[];
} {
  if (!html.includes("data:")) return { html, attachments: [] };
  const doc = new DOMParser().parseFromString(html, "text/html");
  const attachments: AttachmentInput[] = [];
  let i = 0;
  doc.querySelectorAll("img").forEach((img) => {
    const m = /^data:([^;,]+);base64,(.+)$/.exec(img.getAttribute("src") ?? "");
    if (!m) return;
    i += 1;
    const cid = `img${i}@be-mail`;
    const ext = (m[1].split("/")[1] ?? "png").split("+")[0];
    attachments.push({
      name: `afbeelding-${i}.${ext}`,
      contentType: m[1],
      contentBase64: m[2],
      contentId: cid,
      isInline: true,
    });
    img.setAttribute("src", `cid:${cid}`);
  });
  return { html: doc.body.innerHTML, attachments };
}

/**
 * Ontvangerveld (Aan/CC/BCC) met autoaanvullen uit de organisatie (/me/people).
 * De waarde blijft een kommagescheiden string; alleen het laatst getypte deel
 * wordt gezocht en bij een keuze vervangen door het gekozen adres.
 */
function RecipientInput({
  value,
  onChange,
  autoFocus = false,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<Person[]>([]);
  const [open, setOpen] = useState(false);
  const tail = value.split(/[,;]/).pop()?.trim() ?? "";

  useEffect(() => {
    if (tail.length < 2 || tail.includes("@")) {
      setSuggestions([]);
      return;
    }
    const h = setTimeout(() => {
      api
        .searchPeople(tail)
        .then((list) => {
          setSuggestions(list);
          setOpen(true);
        })
        .catch(() => setSuggestions([]));
    }, 300);
    return () => clearTimeout(h);
  }, [tail]);

  function pick(addr: string) {
    const items = value
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (tail) items.pop(); // het getypte deel vervangen door de keuze
    onChange([...items, addr].join(", ") + ", ");
    setSuggestions([]);
  }

  return (
    <span className="attendee-box">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        autoFocus={autoFocus}
      />
      {open && suggestions.length > 0 && (
        <span className="suggest-list">
          {suggestions.map((p, i) => {
            const addr = p.scoredEmailAddresses[0]?.address ?? "";
            if (!addr) return null;
            return (
              <button
                key={i}
                className="suggest-item"
                // onMouseDown: vóór de blur van het invoerveld.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(addr);
                }}
              >
                <strong>{p.displayName || addr}</strong>{" "}
                <span className="muted small">{addr}</span>
              </button>
            );
          })}
        </span>
      )}
    </span>
  );
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
  inline = false,
}: {
  initial: ComposeInitial;
  onClose: () => void;
  onSent: () => void;
  /** In de leesvenster-kolom (geen modal-overlay); kruisje sluit. */
  inline?: boolean;
}) {
  const { t, tip, notify, settings } = useApp();

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
      ? `<div><br></div><div data-sig="1">${signatureHtml(defaultSig)}</div>`
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

  /**
   * `forSend`: data:-afbeeldingen worden dan omgezet naar cid: + inline
   * bijlagen. Bij concept-opslag juist niet, zodat een heropend concept de
   * afbeeldingen nog gewoon in de editor toont.
   */
  function buildInput(forSend = false): ComposeInput {
    const body = forSend
      ? extractInlineImages(editorHtml())
      : { html: editorHtml(), attachments: [] as AttachmentInput[] };
    // Standaardopmaak om het eigen tekstdeel heen; de geciteerde mail
    // (onder de <hr>) behoudt zijn oorspronkelijke opmaak.
    const bodyHtml =
      `<div style="${composeFontCss(settings)}">${body.html}</div>` +
      (quoted ? `<hr>${quoted}` : "");
    return {
      to: split(to),
      cc: split(cc),
      bcc: split(bcc),
      subject,
      bodyHtml,
      importance,
      attachments: [
        ...attachments.map(({ name, contentType, contentBase64 }) => ({
          name,
          contentType,
          contentBase64,
        })),
        ...body.attachments,
      ],
    };
  }

  function hasContent(): boolean {
    const bodyText = editorRef.current?.textContent ?? "";
    return !!(to.trim() || cc.trim() || bcc.trim() || subject.trim() || bodyText.trim());
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
      if (block) block.innerHTML = signatureHtml(nextSig);
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

  /** Start de aftelling (instelbaar in Instellingen); 0 = direct verzenden. */
  function startSend() {
    if (!validRecipients()) return;
    const delay = Math.max(0, settings.sendDelaySeconds ?? 5);
    if (delay === 0) {
      void reallySend();
    } else {
      setUndoLeft(delay);
    }
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
      const input = buildInput(true);
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
      const input = buildInput(true);
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

  const panel = (
      <div className={inline ? "compose-inline" : "dialog compose"}>
        <header className="dialog-head">
          <h2>{t("compose")}</h2>
          <button className="icon-btn" onClick={closeAndSave} aria-label={t("cancel")}>
            <CloseIcon />
          </button>
        </header>
        <div className="dialog-body">
          <label className="row">
            <span>{t("to")}</span>
            <RecipientInput value={to} onChange={setTo} autoFocus />
          </label>
          <label className="row">
            <span>{t("cc")}</span>
            <RecipientInput value={cc} onChange={setCc} />
          </label>
          <label className="row">
            <span>{t("bcc")}</span>
            <RecipientInput value={bcc} onChange={setBcc} />
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

          <RichTextEditor
            editorRef={editorRef}
            initialHtml={initialHtml}
            onChange={setHtml}
            // Standaardopmaak uitgaande mail (Instellingen -> Mail). Witte
            // achtergrond ook in donker thema: de gekozen tekstkleur is wat
            // de ontvanger op een witte ondergrond te zien krijgt.
            textStyle={{
              fontFamily: settings.composeFontFamily,
              fontSize: `${settings.composeFontSizePt}pt`,
              color: settings.composeFontColor,
              background: "#fff",
            }}
            // @-vermelding: genoemde persoon automatisch aan "Aan" toevoegen.
            onMention={(addr) =>
              setTo((prev) =>
                prev.toLowerCase().includes(addr.toLowerCase())
                  ? prev
                  : (prev.trim() ? prev.replace(/[,;\s]+$/, "") + ", " : "") + addr + ", "
              )
            }
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
              title={tip("signature")}
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
            title={tip("sendLater")}
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
  );

  if (inline) return panel;
  return (
    <div className="overlay" role="dialog" aria-modal="true">
      {panel}
    </div>
  );
}
