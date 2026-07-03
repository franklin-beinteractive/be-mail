// Herbruikbare rich-text editor (contentEditable + document.execCommand):
// vet/cursief/onderstrepen, lijsten, links en afbeeldingen (als data-URI).
// Gebruikt door het opstelvenster en de handtekeningen in Instellingen.
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/ctx";
import type { Person } from "../lib/types";

// Afbeeldingen (logo's e.d.) klein houden: localStorage en de mail-limiet
// (~3 MB inline bijlagen) zijn snel vol met grote foto's.
const MAX_IMAGE_BYTES = 1024 * 1024;

export default function RichTextEditor({
  editorRef,
  initialHtml,
  onChange,
  minHeight,
  onMention,
}: {
  /** Optionele externe ref naar de editor-div (voor o.a. handtekening-wissel). */
  editorRef?: React.RefObject<HTMLDivElement | null>;
  /** Alleen bij de eerste render gebruikt; daarna is de editor-DOM de waarheid. */
  initialHtml: string;
  onChange: (html: string) => void;
  minHeight?: number;
  /** Zet @-vermeldingen aan: bij een keuze wordt dit aangeroepen met het
   *  e-mailadres (het opstelvenster voegt de persoon dan toe aan Aan). */
  onMention?: (address: string) => void;
}) {
  const { t, tip, notify } = useApp();
  // Bevries de start-HTML: de editor-DOM is daarna de waarheid. Zou de prop
  // live meebewegen (parent slaat onChange-waarde op), dan schrijft React de
  // innerHTML opnieuw en springt de cursor naar het begin.
  const [frozenInitial] = useState(initialHtml);
  const innerRef = useRef<HTMLDivElement>(null);
  const ref = editorRef ?? innerRef;
  const imgInput = useRef<HTMLInputElement>(null);
  // Link invoegen: inline invoer + bewaarde selectie (de invoer steelt focus).
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const savedRange = useRef<Range | null>(null);
  // @-vermeldingen: getypte zoekterm achter "@" + suggesties + plek in de DOM.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentions, setMentions] = useState<Person[]>([]);
  const mentionSpot = useRef<{ node: Text; end: number; query: string } | null>(null);

  function sync() {
    onChange(ref.current?.innerHTML ?? "");
  }

  // ---- @-vermeldingen ----

  /** Kijkt of er direct vóór de cursor "@zoekterm" staat. */
  function detectMention() {
    if (!onMention) return;
    const sel = window.getSelection();
    const n = sel?.anchorNode;
    if (!sel || !n || n.nodeType !== Node.TEXT_NODE || !ref.current?.contains(n)) {
      setMentionQuery(null);
      return;
    }
    const upto = (n.textContent ?? "").slice(0, sel.anchorOffset);
    const m = /(?:^|\s)@([^\s@]{1,30})$/.exec(upto);
    if (!m) {
      setMentionQuery(null);
      return;
    }
    mentionSpot.current = { node: n as Text, end: sel.anchorOffset, query: m[1] };
    setMentionQuery(m[1]);
  }

  useEffect(() => {
    if (!onMention || mentionQuery === null || mentionQuery.length < 2) {
      setMentions([]);
      return;
    }
    const h = setTimeout(() => {
      api
        .searchPeople(mentionQuery)
        .then(setMentions)
        .catch(() => setMentions([]));
    }, 250);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionQuery]);

  /** Vervangt het getypte "@zoekterm" door een vermelding en meldt het adres. */
  function applyMention(address: string, name: string) {
    const spot = mentionSpot.current;
    setMentionQuery(null);
    setMentions([]);
    if (!spot) return;
    const start = spot.end - spot.query.length - 1;
    if (start < 0) return;
    const range = document.createRange();
    range.setStart(spot.node, start);
    range.setEnd(spot.node, spot.end);
    range.deleteContents();
    const a = document.createElement("a");
    a.href = `mailto:${address}`;
    a.dataset.mention = address;
    a.textContent = `@${name}`;
    range.insertNode(a);
    const space = document.createTextNode(" ");
    a.after(space);
    const sel = window.getSelection();
    const caret = document.createRange();
    caret.setStartAfter(space);
    caret.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(caret);
    onMention?.(address);
    sync();
  }

  function exec(cmd: string, value?: string) {
    ref.current?.focus();
    document.execCommand(cmd, false, value);
    sync();
  }

  function saveSelection() {
    const sel = window.getSelection();
    savedRange.current =
      sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
  }

  function restoreSelection() {
    ref.current?.focus();
    const sel = window.getSelection();
    if (savedRange.current) {
      sel?.removeAllRanges();
      sel?.addRange(savedRange.current);
    }
  }

  function openLink() {
    saveSelection();
    setLinkUrl("");
    setLinkOpen(true);
  }

  function applyLink() {
    const raw = linkUrl.trim();
    setLinkOpen(false);
    if (!raw) return;
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      document.execCommand("insertHTML", false, `<a href="${url}">${url}</a>`);
    } else {
      document.execCommand("createLink", false, url);
    }
    sync();
  }

  async function addImage(list: FileList | null) {
    const file = list?.[0];
    if (imgInput.current) imgInput.current.value = "";
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      notify(t("imageTooLarge"), "error");
      return;
    }
    const dataUri = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    restoreSelection();
    document.execCommand("insertImage", false, dataUri);
    sync();
  }

  return (
    <>
      <div className="editor-toolbar">
        <button className="tool-btn" onClick={() => exec("bold")} title={tip("bold")}>
          <strong>B</strong>
        </button>
        <button className="tool-btn" onClick={() => exec("italic")} title={tip("italic")}>
          <em>I</em>
        </button>
        <button
          className="tool-btn"
          onClick={() => exec("underline")}
          title={tip("underline")}
        >
          <span style={{ textDecoration: "underline" }}>U</span>
        </button>
        <span className="tool-sep" />
        <button
          className="tool-btn"
          onClick={() => exec("insertUnorderedList")}
          title={tip("bullets")}
        >
          ••
        </button>
        <button
          className="tool-btn"
          onClick={() => exec("insertOrderedList")}
          title={tip("numbering")}
        >
          1.
        </button>
        <span className="tool-sep" />
        <button className="tool-btn" onClick={openLink} title={tip("insertLink")}>
          🔗
        </button>
        <button
          className="tool-btn"
          onClick={() => {
            saveSelection();
            imgInput.current?.click();
          }}
          title={tip("insertImage")}
        >
          🖼
        </button>
        <input
          ref={imgInput}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => void addImage(e.target.files)}
        />
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
      <span className="editor-wrap">
        <div
          ref={ref}
          className="editor"
          style={minHeight ? { minHeight } : undefined}
          contentEditable
          suppressContentEditableWarning
          onInput={() => {
            sync();
            detectMention();
          }}
          onKeyDown={(e) => {
            if (mentionQuery === null) return;
            if (e.key === "Escape") {
              setMentionQuery(null);
              setMentions([]);
            } else if (e.key === "Enter" && mentions.length > 0) {
              // Enter kiest de eerste suggestie i.p.v. een nieuwe regel.
              e.preventDefault();
              const p = mentions[0];
              const addr = p.scoredEmailAddresses[0]?.address ?? "";
              if (addr) applyMention(addr, p.displayName || addr);
            }
          }}
          dangerouslySetInnerHTML={{ __html: frozenInitial }}
        />
        {mentions.length > 0 && (
          <span className="suggest-list mention-list">
            {mentions.map((p, i) => {
              const addr = p.scoredEmailAddresses[0]?.address ?? "";
              if (!addr) return null;
              return (
                <button
                  key={i}
                  className="suggest-item"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyMention(addr, p.displayName || addr);
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
    </>
  );
}
