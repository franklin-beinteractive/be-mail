// E-mailweergave: 3 kolommen — mappen | berichtenlijst | leesvenster.
import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../lib/api";
import { useApp } from "../lib/ctx";
import type { Account, MailFolder, Message } from "../lib/types";
import {
  longDateTime,
  sanitizeEmail,
  senderAddress,
  senderName,
  shortDate,
} from "../lib/format";
import ComposeDialog, { type ComposeInitial } from "./ComposeDialog";
import {
  ComposeIcon,
  FlagIcon,
  ForwardIcon,
  PaperclipIcon,
  ReplyAllIcon,
  ReplyIcon,
  SearchIcon,
  TrashIcon,
} from "./Icons";

const PAGE = 25;

export default function MailView({ account }: { account: Account | null }) {
  const { t, settings, notify } = useApp();
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [folderId, setFolderId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<Message | null>(null);
  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [allowImages, setAllowImages] = useState(false);
  const [compose, setCompose] = useState<ComposeInitial | null>(null);

  // Mappen laden bij start.
  useEffect(() => {
    api
      .listFolders()
      .then((f) => {
        setFolders(f);
        const inbox =
          f.find((x) => /inbox|postvak in/i.test(x.displayName ?? "")) ?? f[0];
        if (inbox) setFolderId(inbox.id);
      })
      .catch((e) => notify(String(e), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Berichten laden bij mapwissel.
  useEffect(() => {
    if (!folderId) return;
    setMessages([]);
    setSelected(null);
    setSkip(0);
    loadPage(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId]);

  async function loadPage(from: number, replace: boolean) {
    if (!folderId) return;
    setLoading(true);
    try {
      const page = await api.listMessages(folderId, PAGE, from);
      setMessages((prev) => (replace ? page.messages : [...prev, ...page.messages]));
      setHasMore(page.hasMore);
      setSkip(from + PAGE);
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setLoading(false);
    }
  }

  async function openMessage(m: Message) {
    setAllowImages(false);
    try {
      const full = await api.getMessage(m.id);
      setSelected(full);
      if (!m.isRead) {
        await api.setRead(m.id, true).catch(() => {});
        patch(m.id, { isRead: true });
        refreshFolderUnread(-1);
      }
    } catch (e) {
      notify(String(e), "error");
    }
  }

  function patch(id: string, p: Partial<Message>) {
    setMessages((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));
    setSelected((s) => (s && s.id === id ? { ...s, ...p } : s));
  }

  function refreshFolderUnread(delta: number) {
    setFolders((prev) =>
      prev.map((f) =>
        f.id === folderId
          ? { ...f, unreadItemCount: Math.max(0, (f.unreadItemCount ?? 0) + delta) }
          : f
      )
    );
  }

  async function toggleFlag(m: Message) {
    const flagged = m.flag?.flagStatus === "flagged";
    try {
      await api.setFlag(m.id, !flagged);
      patch(m.id, { flag: { flagStatus: flagged ? "notFlagged" : "flagged" } });
    } catch (e) {
      notify(String(e), "error");
    }
  }

  async function toggleRead(m: Message) {
    const next = !m.isRead;
    try {
      await api.setRead(m.id, next);
      patch(m.id, { isRead: next });
      refreshFolderUnread(next ? -1 : 1);
    } catch (e) {
      notify(String(e), "error");
    }
  }

  async function remove(m: Message) {
    if (!confirm(t("confirmDelete"))) return;
    try {
      await api.deleteMessage(m.id);
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
      if (selected?.id === m.id) setSelected(null);
    } catch (e) {
      notify(String(e), "error");
    }
  }

  async function moveTo(m: Message, dest: string) {
    if (!dest) return;
    try {
      await api.moveMessage(m.id, dest);
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
      if (selected?.id === m.id) setSelected(null);
    } catch (e) {
      notify(String(e), "error");
    }
  }

  // Reply / forward-voorvulling.
  function buildReply(m: Message, all: boolean): ComposeInitial {
    const me = account?.mail?.toLowerCase();
    const to = senderAddress(m.from?.emailAddress);
    const others = (m.toRecipients ?? [])
      .map((r) => r.emailAddress.address ?? "")
      .filter((a) => a && a.toLowerCase() !== me && a.toLowerCase() !== to.toLowerCase());
    const cc = all
      ? (m.ccRecipients ?? []).map((r) => r.emailAddress.address ?? "").filter(Boolean)
      : [];
    const header = `<p>— ${senderName(m.from?.emailAddress)} (${longDateTime(
      m.receivedDateTime,
      settings.lang
    )})</p>`;
    return {
      to: [to, ...(all ? others : [])].join(", "),
      cc: cc.join(", "),
      subject: `RE: ${stripPrefix(m.subject ?? "")}`,
      bodyHtml: header + (m.body?.content ?? ""),
    };
  }

  function buildForward(m: Message): ComposeInitial {
    const header = `<p>— ${senderName(m.from?.emailAddress)} (${longDateTime(
      m.receivedDateTime,
      settings.lang
    )})</p>`;
    return {
      to: "",
      subject: `FW: ${stripPrefix(m.subject ?? "")}`,
      bodyHtml: header + (m.body?.content ?? ""),
    };
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter(
      (m) =>
        (m.subject ?? "").toLowerCase().includes(q) ||
        senderName(m.from?.emailAddress).toLowerCase().includes(q) ||
        (m.bodyPreview ?? "").toLowerCase().includes(q)
    );
  }, [messages, search]);

  const bodyHtml = useMemo(() => {
    if (!selected?.body) return "";
    if (selected.body.contentType?.toLowerCase() === "text") {
      return `<pre class="plain">${selected.body.content
        .replace(/</g, "&lt;")}</pre>`;
    }
    return sanitizeEmail(selected.body.content, allowImages);
  }, [selected, allowImages]);

  const externalBlocked =
    selected?.body?.contentType?.toLowerCase() !== "text" &&
    !allowImages &&
    /<img[^>]+src=["']https?:/i.test(selected?.body?.content ?? "");

  function onBodyClick(e: React.MouseEvent) {
    const a = (e.target as HTMLElement).closest("a");
    if (a && a.getAttribute("href")) {
      e.preventDefault();
      openUrl(a.getAttribute("href")!).catch(() => {});
    }
  }

  return (
    <div className="mail">
      {/* Kolom 1: mappen */}
      <aside className="folders">
        <button className="btn primary compose-btn" onClick={() => setCompose({})}>
          <ComposeIcon size={18} /> {t("compose")}
        </button>
        <nav>
          {folders.map((f) => (
            <button
              key={f.id}
              className={"folder" + (f.id === folderId ? " active" : "")}
              onClick={() => setFolderId(f.id)}
            >
              <span className="folder-name">{f.displayName}</span>
              {!!f.unreadItemCount && (
                <span className="badge">{f.unreadItemCount}</span>
              )}
            </button>
          ))}
        </nav>
      </aside>

      {/* Kolom 2: berichtenlijst */}
      <section className="list">
        <div className="list-search">
          <SearchIcon size={18} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("search")}
          />
        </div>
        <div className="list-scroll">
          {filtered.length === 0 && !loading && (
            <p className="empty">{t("noMessages")}</p>
          )}
          {filtered.map((m) => (
            <button
              key={m.id}
              className={
                "msg" +
                (m.isRead ? "" : " unread") +
                (selected?.id === m.id ? " active" : "")
              }
              onClick={() => openMessage(m)}
            >
              <div className="msg-top">
                <span className="msg-from">{senderName(m.from?.emailAddress)}</span>
                <span className="msg-date">{shortDate(m.receivedDateTime, settings.lang)}</span>
              </div>
              <div className="msg-subject">
                {m.flag?.flagStatus === "flagged" && <span className="flagdot">⚑</span>}
                {m.importance === "high" && <span className="hi">!</span>}
                {m.subject || "(geen onderwerp)"}
                {m.hasAttachments && <PaperclipIcon size={14} style={{ marginLeft: 4 }} />}
              </div>
              <div className="msg-preview">{m.bodyPreview}</div>
            </button>
          ))}
          {loading && <p className="empty">{t("loading")}</p>}
          {hasMore && !loading && (
            <button className="btn ghost load-more" onClick={() => loadPage(skip, false)}>
              {t("loadMore")}
            </button>
          )}
        </div>
      </section>

      {/* Kolom 3: leesvenster */}
      <section className="reader">
        {!selected ? (
          <div className="reader-empty">{t("selectMessage")}</div>
        ) : (
          <>
            <div className="reader-actions">
              <button className="btn" onClick={() => setCompose(buildReply(selected, false))}>
                <ReplyIcon size={18} /> {t("reply")}
              </button>
              <button className="btn" onClick={() => setCompose(buildReply(selected, true))}>
                <ReplyAllIcon size={18} /> {t("replyAll")}
              </button>
              <button className="btn" onClick={() => setCompose(buildForward(selected))}>
                <ForwardIcon size={18} /> {t("forward")}
              </button>
              <span className="spacer" />
              <button className="btn" onClick={() => toggleFlag(selected)} title={t("flag")}>
                <FlagIcon size={18} />
              </button>
              <button className="btn" onClick={() => toggleRead(selected)}>
                {selected.isRead ? t("markUnread") : t("markRead")}
              </button>
              <select
                className="move-select"
                value=""
                onChange={(e) => moveTo(selected, e.target.value)}
                title={t("move")}
              >
                <option value="">{t("move")}…</option>
                {folders
                  .filter((f) => f.id !== folderId)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.displayName}
                    </option>
                  ))}
              </select>
              <button className="btn danger" onClick={() => remove(selected)} title={t("delete")}>
                <TrashIcon size={18} />
              </button>
            </div>
            <div className="reader-head">
              <h2>{selected.subject || "(geen onderwerp)"}</h2>
              <div className="reader-meta">
                <strong>{senderName(selected.from?.emailAddress)}</strong>{" "}
                <span className="muted">
                  &lt;{senderAddress(selected.from?.emailAddress)}&gt;
                </span>
                <div className="muted small">
                  {longDateTime(selected.receivedDateTime, settings.lang)}
                </div>
                {isExternal(selected, account) && (
                  <div className="warn">{t("externalSender")}</div>
                )}
              </div>
            </div>
            {externalBlocked && (
              <div className="images-bar">
                {t("externalImagesBlocked")}{" "}
                <button className="btn ghost" onClick={() => setAllowImages(true)}>
                  {t("showImages")}
                </button>
              </div>
            )}
            <div
              className="reader-body"
              onClick={onBodyClick}
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          </>
        )}
      </section>

      {compose && (
        <ComposeDialog
          initial={compose}
          onClose={() => setCompose(null)}
          onSent={() => setCompose(null)}
        />
      )}
    </div>
  );
}

function stripPrefix(s: string): string {
  return s.replace(/^(re|fw|fwd)\s*:\s*/i, "");
}

function isExternal(m: Message, account: Account | null): boolean {
  const from = senderAddress(m.from?.emailAddress).toLowerCase();
  const me = (account?.mail ?? account?.userPrincipalName ?? "").toLowerCase();
  const domain = me.split("@")[1];
  if (!domain || !from.includes("@")) return false;
  return !from.endsWith("@" + domain);
}
