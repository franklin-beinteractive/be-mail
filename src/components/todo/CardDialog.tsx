// The open card: title, colour, column, project, follow-up date, the
// description and the attachments. Screenshots can be pasted (Ctrl+V)
// anywhere in the dialog; files come from the picker or are dropped on it.
import { useEffect, useRef, useState } from "react";
import { useApp } from "../../lib/ctx";
import {
  addDays,
  COLORS,
  formatSize,
  isImage,
  isoDate,
  MAX_ATTACHMENT_BYTES,
  todoApi,
  useAttachmentUrl,
  type Attachment,
  type MailLink,
  type Task,
  type TaskPatch,
  type TodoData,
} from "../../lib/todo";
import { CloseIcon, DownloadIcon, MailIcon, PaperclipIcon, TrashIcon } from "../Icons";

/** "screenshot-2026-11-25-142233.png" for a pasted image without a real name. */
function screenshotName(file: File): string {
  const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
  if (file.name && !/^image\.\w+$/i.test(file.name)) return file.name;
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `screenshot-${isoDate(d)}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

export default function CardDialog({
  card,
  isNew,
  data,
  today,
  onClose,
  onOpenMail,
}: {
  card: Task;
  /** Just added from the board: start typing the description right away. */
  isNew?: boolean;
  data: TodoData;
  today: string;
  onClose: () => void;
  onOpenMail: (m: MailLink) => void;
}) {
  const { t, tip, notify, confirm, settings } = useApp();
  const [title, setTitle] = useState(card.title);
  const [note, setNote] = useState(card.note);
  const [due, setDue] = useState(card.followUp ?? "");
  // Follow outside changes without losing what is being typed: only reset
  // when the stored value changes.
  useEffect(() => setTitle(card.title), [card.title]);
  useEffect(() => setNote(card.note), [card.note]);
  useEffect(() => setDue(card.followUp ?? ""), [card.followUp]);
  const [uploading, setUploading] = useState(0);
  const [dropping, setDropping] = useState(false);
  const [lightbox, setLightbox] = useState<Attachment | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const attachments = data.attachments.filter((a) => a.taskId === card.id);
  const projects = data.projects
    .filter((p) => !p.archived || p.id === card.projectId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const column = data.columns.find((c) => c.id === card.columnId);

  function save(patch: TaskPatch) {
    return todoApi.patchTask(card.id, patch).catch((e) => notify(String(e), "error"));
  }

  // The latest typed values, so closing with Esc still saves them.
  const latest = useRef({ title, note });
  latest.current = { title, note };
  function commitText() {
    const v = latest.current.title.trim();
    const changes: { title?: string; note?: string } = {};
    if (v && v !== card.title) changes.title = v;
    if (latest.current.note !== card.note) changes.note = latest.current.note;
    if (Object.keys(changes).length) void save(changes);
  }
  function close() {
    commitText();
    onClose();
  }

  async function upload(files: File[]) {
    for (const file of files) {
      if (file.size === 0) continue;
      if (file.size > MAX_ATTACHMENT_BYTES) {
        notify(`${file.name}: ${t("todoAttachTooLarge")}`, "error");
        continue;
      }
      setUploading((n) => n + 1);
      try {
        await todoApi.addAttachment(card.id, file, screenshotName(file));
      } catch (e) {
        notify(String(e), "error");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  // Ctrl+V of a screenshot anywhere in the dialog. Text pasted into a text
  // field stays text, even when the clipboard also holds a picture of it.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length) return;
      const el = document.activeElement as HTMLElement | null;
      const inText = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
      if (inText && e.clipboardData?.types.includes("text/plain")) return;
      e.preventDefault();
      void upload(files);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  async function removeCard() {
    if (!(await confirm(t("todoDeleteCardConfirm")))) return;
    try {
      await todoApi.deleteTask(card.id);
      onClose();
    } catch (e) {
      notify(String(e), "error");
    }
  }

  async function removeAttachment(a: Attachment) {
    if (!(await confirm(`${t("todoDeleteAttachmentConfirm")} ${a.name}`))) return;
    if (lightbox?.id === a.id) setLightbox(null);
    try {
      await todoApi.deleteAttachment(a.id);
    } catch (e) {
      notify(String(e), "error");
    }
  }

  async function saveAttachment(a: Attachment) {
    try {
      const path = await todoApi.saveAttachment(a.id);
      notify(`${t("todoSavedTo")} ${path}`, "info");
    } catch (e) {
      notify(String(e), "error");
    }
  }

  async function openAttachment(a: Attachment) {
    if (isImage(a)) {
      setLightbox(a);
      return;
    }
    try {
      await todoApi.openAttachment(a.id);
    } catch (e) {
      notify(String(e), "error");
    }
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(settings.lang === "en" ? "en-GB" : "nl-NL", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label={card.title}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        if (lightbox) setLightbox(null);
        else close();
      }}
    >
      <div
        className={"dialog card-dialog" + (dropping ? " dropping" : "")}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDropping(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDropping(false);
          void upload([...e.dataTransfer.files]);
        }}
      >
        {card.color && <div className="card-dialog-band" style={{ background: card.color }} />}
        <header className="dialog-head card-dialog-head">
          <input
            autoFocus={card.title === ""}
            className="card-dialog-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (!title.trim()) setTitle(card.title);
              else commitText();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            aria-label={t("todoTitle")}
          />
          <button className="icon-btn" onClick={close} aria-label={t("todoClose")} title={tip("todoClose")}>
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="dialog-body card-dialog-body">
          <div className="card-dialog-grid">
            <label className="todo-field">
              <span>{t("todoColumn")}</span>
              <select
                value={card.columnId}
                onChange={(e) => void save({ columnId: Number(e.target.value), sort: null })}
              >
                {data.columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="todo-field">
              <span>{t("todoProject")}</span>
              <select
                value={card.projectId ?? ""}
                onChange={(e) => void save({ projectId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">{t("todoNoProject")}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="todo-field">
            <span>{t("todoColor")}</span>
            <div className="todo-swatches">
              <button
                className={"todo-swatch none" + (!card.color ? " active" : "")}
                onClick={() => void save({ color: "" })}
                aria-label={t("todoNoColor")}
                aria-pressed={!card.color}
                title={tip("todoNoColor")}
              />
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={"todo-swatch" + (c === card.color ? " active" : "")}
                  style={{ background: c }}
                  onClick={() => void save({ color: c })}
                  aria-label={c}
                  aria-pressed={c === card.color}
                />
              ))}
            </div>
          </div>

          <label className="todo-field">
            <span>{t("todoDescription")}</span>
            <textarea
              rows={6}
              autoFocus={isNew}
              value={note}
              placeholder={t("todoDescriptionHint")}
              onChange={(e) => setNote(e.target.value)}
              onBlur={commitText}
            />
          </label>

          <div className="todo-field">
            <span>{t("todoFollowUp")}</span>
            <div className="todo-quick-dates">
              <input
                type="date"
                value={due}
                onChange={(e) => {
                  // Typing a year passes through dates like 0002-11-25: save
                  // only a plausible date right away, the rest on leaving.
                  const v = e.target.value;
                  setDue(v);
                  if (v === "" || Number(v.slice(0, 4)) >= 2000) void save({ followUp: v || null });
                }}
                onBlur={() => due !== (card.followUp ?? "") && void save({ followUp: due || null })}
                aria-label={t("todoFollowUp")}
              />
              <button className="btn small" onClick={() => void save({ followUp: today })}>
                {t("todoToday")}
              </button>
              <button className="btn small" onClick={() => void save({ followUp: isoDate(addDays(new Date(), 1)) })}>
                {t("todoTomorrow")}
              </button>
              <button className="btn small" onClick={() => void save({ followUp: isoDate(addDays(new Date(), 7)) })}>
                {t("todoNextWeek")}
              </button>
              {card.followUp && (
                <button className="btn ghost small" onClick={() => void save({ followUp: null })}>
                  {t("todoClear")}
                </button>
              )}
            </div>
          </div>

          <div className="todo-field">
            <span>
              {t("todoAttachments")}
              {attachments.length > 0 && <span className="muted"> {attachments.length}</span>}
            </span>
            {attachments.length > 0 && (
              <div className="card-attachments">
                {attachments.map((a) => (
                  <AttachmentTile
                    key={a.id}
                    a={a}
                    onOpen={() => void openAttachment(a)}
                    onSave={() => void saveAttachment(a)}
                    onDelete={() => void removeAttachment(a)}
                  />
                ))}
              </div>
            )}
            <div className="card-attach-bar">
              <button className="btn small" onClick={() => fileInput.current?.click()}>
                <PaperclipIcon size={15} /> {t("todoAddAttachment")}
              </button>
              <span className="muted small">
                {uploading > 0 ? t("todoUploading") : t("todoPasteHint")}
              </span>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = "";
                  void upload(files);
                }}
              />
            </div>
          </div>

          {card.mail && (
            <div className="todo-field">
              <span>{t("todoLinkedMail")}</span>
              <div className="todo-mail-card">
                <div className="todo-mail-subject">{card.mail.subject || "-"}</div>
                <div className="muted small">
                  {card.mail.from}
                  {card.mail.address && card.mail.address !== card.mail.from ? ` <${card.mail.address}>` : ""}
                </div>
                <button className="btn small" onClick={() => card.mail && onOpenMail(card.mail)}>
                  <MailIcon size={16} /> {t("todoOpenMail")}
                </button>
              </div>
            </div>
          )}

          <p className="muted small todo-meta">
            {t("todoCreatedOn")}: {fmt(card.createdAt)}
            {card.doneAt && column?.done && (
              <>
                {" · "}
                {t("todoDoneOn")}: {fmt(card.doneAt)}
              </>
            )}
          </p>
        </div>

        <footer className="dialog-foot">
          <button className="btn danger" onClick={() => void removeCard()}>
            <TrashIcon size={16} /> {t("todoDeleteCard")}
          </button>
          <span className="spacer" />
          <button className="btn primary" onClick={close}>
            {t("todoClose")}
          </button>
        </footer>
        {dropping && <div className="card-drop-hint">{t("todoDropFiles")}</div>}
      </div>

      {lightbox && <Lightbox a={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function AttachmentTile({
  a,
  onOpen,
  onSave,
  onDelete,
}: {
  a: Attachment;
  onOpen: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const { t, tip } = useApp();
  const image = isImage(a);
  const url = useAttachmentUrl(image ? a : undefined);
  return (
    <div className="card-attachment">
      <button className="card-attachment-preview" onClick={onOpen} title={a.name}>
        {image ? (
          url ? <img src={url} alt={a.name} /> : <span className="muted small">…</span>
        ) : (
          <span className="card-attachment-ext">{(a.name.split(".").pop() || "?").slice(0, 5)}</span>
        )}
      </button>
      <div className="card-attachment-info">
        <span className="card-attachment-name" title={a.name}>
          {a.name}
        </span>
        <span className="muted small">{formatSize(a.size)}</span>
      </div>
      <div className="card-attachment-actions">
        <button className="icon-btn" onClick={onSave} title={tip("todoSaveAttachment")} aria-label={t("todoSaveAttachment")}>
          <DownloadIcon size={15} />
        </button>
        <button className="icon-btn danger-hover" onClick={onDelete} title={tip("delete")} aria-label={`${t("delete")}: ${a.name}`}>
          <TrashIcon size={15} />
        </button>
      </div>
    </div>
  );
}

function Lightbox({ a, onClose }: { a: Attachment; onClose: () => void }) {
  const url = useAttachmentUrl(a);
  return (
    <div className="card-lightbox" onMouseDown={onClose} role="presentation">
      {url && <img src={url} alt={a.name} onMouseDown={(e) => e.stopPropagation()} />}
      <div className="card-lightbox-name">{a.name}</div>
    </div>
  );
}
