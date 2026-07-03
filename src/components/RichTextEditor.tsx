// Herbruikbare rich-text editor (contentEditable + document.execCommand):
// vet/cursief/onderstrepen, lijsten, links en afbeeldingen (als data-URI).
// Gebruikt door het opstelvenster en de handtekeningen in Instellingen.
import { useRef, useState } from "react";
import { useApp } from "../lib/ctx";

// Afbeeldingen (logo's e.d.) klein houden: localStorage en de mail-limiet
// (~3 MB inline bijlagen) zijn snel vol met grote foto's.
const MAX_IMAGE_BYTES = 1024 * 1024;

export default function RichTextEditor({
  editorRef,
  initialHtml,
  onChange,
  minHeight,
}: {
  /** Optionele externe ref naar de editor-div (voor o.a. handtekening-wissel). */
  editorRef?: React.RefObject<HTMLDivElement | null>;
  /** Alleen bij de eerste render gebruikt; daarna is de editor-DOM de waarheid. */
  initialHtml: string;
  onChange: (html: string) => void;
  minHeight?: number;
}) {
  const { t, notify } = useApp();
  const innerRef = useRef<HTMLDivElement>(null);
  const ref = editorRef ?? innerRef;
  const imgInput = useRef<HTMLInputElement>(null);
  // Link invoegen: inline invoer + bewaarde selectie (de invoer steelt focus).
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const savedRange = useRef<Range | null>(null);

  function sync() {
    onChange(ref.current?.innerHTML ?? "");
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
        <button
          className="tool-btn"
          onClick={() => {
            saveSelection();
            imgInput.current?.click();
          }}
          title={t("insertImage")}
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
      <div
        ref={ref}
        className="editor"
        style={minHeight ? { minHeight } : undefined}
        contentEditable
        suppressContentEditableWarning
        onInput={sync}
        dangerouslySetInnerHTML={{ __html: initialHtml }}
      />
    </>
  );
}
