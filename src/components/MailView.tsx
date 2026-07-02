// E-mailweergave: 3 kolommen — mappen | berichtenlijst | leesvenster.
import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../lib/api";
import { useApp } from "../lib/ctx";
import type { Account, Attachment, MailFolder, Message, Recipient } from "../lib/types";
import {
  fileSize,
  longDateTime,
  sanitizeEmail,
  senderAddress,
  senderName,
  shortDate,
} from "../lib/format";
import ComposeDialog, { type ComposeInitial } from "./ComposeDialog";
import {
  ArchiveIcon,
  BanIcon,
  CloseIcon,
  ComposeIcon,
  EditIcon,
  FlagIcon,
  ForwardIcon,
  PaperclipIcon,
  PlusIcon,
  ReplyAllIcon,
  ReplyIcon,
  SearchIcon,
  TrashIcon,
} from "./Icons";

const PAGE = 25;

// Systeemmappen (NL/EN) krijgen geen hernoem-/verwijderknoppen; Graph weigert
// het toch en dit voorkomt verwarring. Eigen mappen matchen hier nooit op.
const SYSTEM_FOLDER =
  /^(postvak in|inbox|verzonden items|sent items|concepten|drafts|verwijderde items|deleted items|ongewenste e-?mail|junk e-?mail|archief|archive|postvak uit|outbox|conversation history|gespreksgeschiedenis)$/i;

function isSystemFolder(f: MailFolder): boolean {
  return SYSTEM_FOLDER.test((f.displayName ?? "").trim());
}

export default function MailView({ account }: { account: Account | null }) {
  const { t, settings, notify, confirm } = useApp();
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [folderId, setFolderId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<Message | null>(null);
  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  // Server-side zoekresultaten (hele mailbox). null = geen zoekopdracht actief.
  const [searchResult, setSearchResult] = useState<Message[] | null>(null);
  const [allowImages, setAllowImages] = useState(false);
  const [compose, setCompose] = useState<ComposeInitial | null>(null);
  // Bijlagen van het geopende bericht; id van de bijlage die nu downloadt.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  // Mappenbeheer-dialoog (nieuw of hernoemen) + invoerveld.
  const [folderDialog, setFolderDialog] = useState<
    { mode: "create" } | { mode: "rename"; folder: MailFolder } | null
  >(null);
  const [folderName, setFolderName] = useState("");
  // Bulkacties: ids van aangevinkte berichten.
  const [checked, setChecked] = useState<Set<string>>(new Set());

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
    setChecked(new Set());
    loadPage(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId]);

  // Nieuwe-mail-event vanuit de Rust-poller: tellers verversen en, als
  // Postvak IN open staat (zonder zoekopdracht), de lijst opnieuw laden.
  useEffect(() => {
    const un = listen("new-mail", () => {
      api.listFolders().then(setFolders).catch(() => {});
      const inbox = folders.find((f) => /inbox|postvak in/i.test(f.displayName ?? ""));
      if (!searchResult && folderId && folderId === inbox?.id) loadPage(0, true);
    });
    return () => {
      un.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders, folderId, searchResult]);

  // Server-side zoeken door de héle mailbox, met korte debounce zodat we niet
  // bij elke toetsaanslag een call doen. Leeg zoekvak → terug naar de mapweergave.
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setSearchResult(null);
      setChecked(new Set());
      return;
    }
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const page = await api.searchMessages(q, 50);
        setSearchResult(page.messages);
        setChecked(new Set());
      } catch (e) {
        notify(String(e), "error");
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

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
    setAttachments([]);
    try {
      const full = await api.getMessage(m.id);
      if (full.isDraft) {
        // Concepten open je niet in het leesvenster maar in het opstelvenster.
        setCompose({
          draftId: full.id,
          to: joinAddresses(full.toRecipients),
          cc: joinAddresses(full.ccRecipients),
          bcc: joinAddresses(full.bccRecipients),
          subject: full.subject ?? "",
          html: sanitizeEmail(full.body?.content ?? "", true),
        });
        return;
      }
      setSelected(full);
      if (full.hasAttachments) {
        // Losse call; falen hiervan mag het lezen niet blokkeren.
        api
          .listAttachments(m.id)
          .then((list) => setAttachments(list.filter((a) => !a.isInline)))
          .catch(() => {});
      }
      if (!m.isRead) {
        await api.setRead(m.id, true).catch(() => {});
        patch(m.id, { isRead: true });
        refreshFolderUnread(-1);
      }
    } catch (e) {
      notify(String(e), "error");
    }
  }

  /** Spam melden: bericht naar Ongewenste e-mail. */
  async function reportJunk(m: Message) {
    try {
      await api.reportJunk(m.id);
      notify(t("junkReported") + " ✓", "info");
      dropFromLists(m.id);
      api.listFolders().then(setFolders).catch(() => {});
    } catch (e) {
      notify(String(e), "error");
    }
  }

  /** Afzender blokkeren (inbox-regel) + dit bericht naar Ongewenste e-mail. */
  async function blockSender(m: Message) {
    const addr = senderAddress(m.from?.emailAddress);
    if (!addr) return;
    if (!(await confirm(t("confirmBlock")))) return;
    try {
      await api.blockSender(addr);
      await api.reportJunk(m.id).catch(() => {});
      notify(t("senderBlocked") + " ✓", "info");
      dropFromLists(m.id);
      api.listFolders().then(setFolders).catch(() => {});
    } catch (e) {
      notify(String(e), "error");
    }
  }

  /** Leest het List-Unsubscribe-doel uit de headers (https heeft voorrang). */
  function unsubscribeTarget(m: Message): { url?: string; mailto?: string } | null {
    const h = (m.internetMessageHeaders ?? []).find(
      (x) => (x.name ?? "").toLowerCase() === "list-unsubscribe"
    );
    if (!h?.value) return null;
    const url = h.value.match(/<(https?:[^>]+)>/i)?.[1];
    const mailto = h.value.match(/<mailto:([^>?]+)[^>]*>/i)?.[1];
    if (!url && !mailto) return null;
    return { url, mailto };
  }

  function unsubscribe(m: Message) {
    const tgt = unsubscribeTarget(m);
    if (!tgt) return;
    if (tgt.url) {
      openUrl(tgt.url).catch(() => {});
    } else if (tgt.mailto) {
      setCompose({ to: tgt.mailto, subject: "unsubscribe" });
    }
  }

  /** Antwoord op een vergaderuitnodiging; daarna verdwijnt de mail uit de lijst. */
  async function rsvp(m: Message, response: "accept" | "tentative" | "decline") {
    try {
      await api.rsvpMessage(m.id, response);
      notify(t("responseSent") + " ✓", "info");
      dropFromLists(m.id);
      api.listFolders().then(setFolders).catch(() => {});
    } catch (e) {
      notify(String(e), "error");
    }
  }

  async function downloadAttachment(a: Attachment) {
    if (!selected || downloading) return;
    setDownloading(a.id);
    try {
      const path = await api.downloadAttachment(selected.id, a.id);
      notify(`${t("attachmentSaved")}: ${path.split(/[\\/]/).pop()}`, "info");
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setDownloading(null);
    }
  }

  function patch(id: string, p: Partial<Message>) {
    setMessages((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));
    setSearchResult((prev) =>
      prev ? prev.map((x) => (x.id === id ? { ...x, ...p } : x)) : prev
    );
    setSelected((s) => (s && s.id === id ? { ...s, ...p } : s));
  }

  // Haalt een bericht uit beide lijsten (map- én zoekresultaat) na verwijderen,
  // archiveren of verplaatsen.
  function dropFromLists(id: string) {
    setMessages((prev) => prev.filter((x) => x.id !== id));
    setSearchResult((prev) => (prev ? prev.filter((x) => x.id !== id) : prev));
    if (selected?.id === id) setSelected(null);
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
    if (!(await confirm(t("confirmDelete")))) return;
    try {
      await api.deleteMessage(m.id);
      dropFromLists(m.id);
    } catch (e) {
      notify(String(e), "error");
    }
  }

  async function archive(m: Message) {
    try {
      await api.archiveMessage(m.id);
      dropFromLists(m.id);
    } catch (e) {
      notify(String(e), "error");
    }
  }

  async function moveTo(m: Message, dest: string) {
    if (!dest) return;
    try {
      await api.moveMessage(m.id, dest);
      dropFromLists(m.id);
    } catch (e) {
      notify(String(e), "error");
    }
  }

  // ---- Mappenbeheer ----

  async function saveFolderDialog() {
    const name = folderName.trim();
    if (!name || !folderDialog) return;
    try {
      if (folderDialog.mode === "create") {
        const f = await api.createFolder(name);
        setFolders((prev) => [...prev, f]);
      } else {
        await api.renameFolder(folderDialog.folder.id, name);
        setFolders((prev) =>
          prev.map((x) =>
            x.id === folderDialog.folder.id ? { ...x, displayName: name } : x
          )
        );
      }
      setFolderDialog(null);
    } catch (e) {
      notify(String(e), "error");
    }
  }

  async function removeFolder(f: MailFolder) {
    if (!(await confirm(t("confirmDeleteFolder")))) return;
    try {
      await api.deleteFolder(f.id);
      const rest = folders.filter((x) => x.id !== f.id);
      setFolders(rest);
      if (folderId === f.id) {
        // Terug naar Postvak IN (of de eerste overgebleven map).
        const inbox =
          rest.find((x) => /inbox|postvak in/i.test(x.displayName ?? "")) ?? rest[0];
        if (inbox) setFolderId(inbox.id);
      }
    } catch (e) {
      notify(String(e), "error");
    }
  }

  // ---- Bulkacties ----

  function toggleCheck(id: string, on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function bulk(action: "read" | "unread" | "archive" | "delete" | "move", destId?: string) {
    const ids = [...checked];
    if (ids.length === 0) return;
    if (action === "delete" && !(await confirm(t("confirmDelete")))) return;
    setLoading(true);
    try {
      for (const id of ids) {
        if (action === "read") await api.setRead(id, true);
        else if (action === "unread") await api.setRead(id, false);
        else if (action === "archive") await api.archiveMessage(id);
        else if (action === "delete") await api.deleteMessage(id);
        else if (action === "move" && destId) await api.moveMessage(id, destId);
      }
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setChecked(new Set());
      if (selected && ids.includes(selected.id) && action !== "read" && action !== "unread") {
        setSelected(null);
      }
      // Zoekresultaten lokaal bijwerken; mapinhoud en tellers opnieuw laden.
      if (searchResult) {
        if (action === "read" || action === "unread") {
          setSearchResult((prev) =>
            prev ? prev.map((m) => (ids.includes(m.id) ? { ...m, isRead: action === "read" } : m)) : prev
          );
        } else {
          setSearchResult((prev) => (prev ? prev.filter((m) => !ids.includes(m.id)) : prev));
        }
      }
      api.listFolders().then(setFolders).catch(() => {});
      loadPage(0, true);
    }
  }

  // Na sluiten/verzenden van het opstelvenster: Concepten-map verversen,
  // want autosave kan daar een concept hebben aangemaakt of verwijderd.
  function composeClosed() {
    setCompose(null);
    const drafts = folders.find((f) => /concepten|drafts/i.test(f.displayName ?? ""));
    if (folderId && folderId === drafts?.id) loadPage(0, true);
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
      kind: "reply" as const,
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
      kind: "forward" as const,
      to: "",
      subject: `FW: ${stripPrefix(m.subject ?? "")}`,
      bodyHtml: header + (m.body?.content ?? ""),
    };
  }

  // Toon zoekresultaten (hele mailbox) als er gezocht wordt, anders de mapinhoud.
  const shown = searchResult ?? messages;

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
        <div className="account-label" title={account?.mail ?? account?.userPrincipalName ?? ""}>
          {account?.mail ?? account?.userPrincipalName ?? ""}
        </div>
        <div className="folders-head">
          <span className="muted small">{t("folders")}</span>
          <button
            className="icon-btn"
            onClick={() => {
              setFolderName("");
              setFolderDialog({ mode: "create" });
            }}
            aria-label={t("newFolder")}
            title={t("newFolder")}
          >
            <PlusIcon size={16} />
          </button>
        </div>
        <nav>
          {folders.map((f) => (
            <div key={f.id} className={"folder" + (f.id === folderId ? " active" : "")}>
              <button className="folder-main" onClick={() => setFolderId(f.id)}>
                <span className="folder-name">{f.displayName}</span>
                {!!f.unreadItemCount && (
                  <span className="badge">{f.unreadItemCount}</span>
                )}
              </button>
              {!isSystemFolder(f) && (
                <span className="folder-actions">
                  <button
                    className="icon-btn"
                    onClick={() => {
                      setFolderName(f.displayName ?? "");
                      setFolderDialog({ mode: "rename", folder: f });
                    }}
                    aria-label={t("renameFolder")}
                    title={t("renameFolder")}
                  >
                    <EditIcon size={14} />
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => removeFolder(f)}
                    aria-label={t("deleteFolder")}
                    title={t("deleteFolder")}
                  >
                    <TrashIcon size={14} />
                  </button>
                </span>
              )}
            </div>
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
        {checked.size > 0 && (
          <div className="bulk-bar">
            <span className="bulk-count">
              {checked.size} {t("selected")}
            </span>
            <button className="btn" onClick={() => bulk("read")} title={t("markRead")}>
              {t("markRead")}
            </button>
            <button className="btn" onClick={() => bulk("unread")} title={t("markUnread")}>
              {t("markUnread")}
            </button>
            <button className="btn" onClick={() => bulk("archive")} title={t("archive")}>
              <ArchiveIcon size={16} />
            </button>
            <select
              className="move-select"
              value=""
              onChange={(e) => bulk("move", e.target.value)}
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
            <button className="btn danger" onClick={() => bulk("delete")} title={t("delete")}>
              <TrashIcon size={16} />
            </button>
            <button
              className="icon-btn"
              onClick={() => setChecked(new Set())}
              aria-label={t("clearSelection")}
              title={t("clearSelection")}
            >
              <CloseIcon size={16} />
            </button>
          </div>
        )}
        <div className="list-scroll">
          {shown.length === 0 && !loading && (
            <p className="empty">{t("noMessages")}</p>
          )}
          {shown.map((m) => (
            <div
              key={m.id}
              role="button"
              tabIndex={0}
              className={
                "msg" +
                (m.isRead ? "" : " unread") +
                (selected?.id === m.id ? " active" : "") +
                (checked.has(m.id) ? " checked" : "")
              }
              onClick={() => openMessage(m)}
              onKeyDown={(e) => {
                if (e.key === "Enter") openMessage(m);
              }}
            >
              <input
                type="checkbox"
                className="msg-check"
                checked={checked.has(m.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => toggleCheck(m.id, e.target.checked)}
                aria-label={m.subject ?? ""}
              />
              <div className="msg-main">
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
              </div>
            </div>
          ))}
          {loading && <p className="empty">{t("loading")}</p>}
          {!searchResult && hasMore && !loading && (
            <button className="btn ghost load-more" onClick={() => loadPage(skip, false)}>
              {t("loadMore")}
            </button>
          )}
        </div>
      </section>

      {/* Kolom 3: leesvenster */}
      <section className="reader">
        <div className="reader-actions">
          <button className="btn primary" onClick={() => setCompose({})}>
            <ComposeIcon size={18} /> {t("compose")}
          </button>
          {selected && (
            <>
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
              {unsubscribeTarget(selected) && (
                <button className="btn" onClick={() => unsubscribe(selected)}>
                  {t("unsubscribe")}
                </button>
              )}
              <button
                className="btn"
                onClick={() => reportJunk(selected)}
                title={t("reportJunk")}
              >
                Spam
              </button>
              <button
                className="btn"
                onClick={() => blockSender(selected)}
                title={t("blockSender")}
              >
                <BanIcon size={18} />
              </button>
              <button className="btn" onClick={() => toggleFlag(selected)} title={t("flag")}>
                <FlagIcon size={18} />
              </button>
              <button className="btn" onClick={() => toggleRead(selected)}>
                {selected.isRead ? t("markUnread") : t("markRead")}
              </button>
              <button className="btn" onClick={() => archive(selected)} title={t("archive")}>
                <ArchiveIcon size={18} />
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
            </>
          )}
        </div>
        {!selected ? (
          <div className="reader-empty">{t("selectMessage")}</div>
        ) : (
          <>
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
            {selected.odataType?.includes("eventMessageRequest") && (
              <div className="rsvp-bar">
                <span className="rsvp-label">{t("invitation")}:</span>
                <button className="btn primary" onClick={() => rsvp(selected, "accept")}>
                  ✓ {t("acceptInvite")}
                </button>
                <button className="btn" onClick={() => rsvp(selected, "tentative")}>
                  ? {t("tentativeInvite")}
                </button>
                <button className="btn danger" onClick={() => rsvp(selected, "decline")}>
                  ✕ {t("declineInvite")}
                </button>
              </div>
            )}
            {attachments.length > 0 && (
              <div className="attachments-bar">
                {attachments.map((a) => (
                  <button
                    key={a.id}
                    className="attachment-chip"
                    onClick={() => downloadAttachment(a)}
                    disabled={downloading !== null}
                    title={downloading === a.id ? t("downloading") : t("attachmentSaved")}
                  >
                    <PaperclipIcon size={14} />
                    <span className="attachment-name">{a.name}</span>
                    <span className="muted small">
                      {downloading === a.id ? t("downloading") : fileSize(a.size)}
                    </span>
                  </button>
                ))}
              </div>
            )}
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
          onClose={composeClosed}
          onSent={composeClosed}
        />
      )}

      {folderDialog && (
        <div className="overlay" role="dialog" aria-modal="true" onClick={() => setFolderDialog(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <header className="dialog-head">
              <h2>{folderDialog.mode === "create" ? t("newFolder") : t("renameFolder")}</h2>
              <button
                className="icon-btn"
                onClick={() => setFolderDialog(null)}
                aria-label={t("cancel")}
              >
                <CloseIcon />
              </button>
            </header>
            <div className="dialog-body">
              <label className="row">
                <span>{t("folderName")}</span>
                <input
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveFolderDialog();
                  }}
                  autoFocus
                />
              </label>
            </div>
            <footer className="dialog-foot">
              <button className="btn" onClick={() => setFolderDialog(null)}>
                {t("cancel")}
              </button>
              <button className="btn primary" onClick={saveFolderDialog} disabled={!folderName.trim()}>
                {t("save")}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

function stripPrefix(s: string): string {
  return s.replace(/^(re|fw|fwd)\s*:\s*/i, "");
}

function joinAddresses(rs?: Recipient[] | null): string {
  return (rs ?? [])
    .map((r) => r.emailAddress.address ?? "")
    .filter(Boolean)
    .join(", ");
}

function isExternal(m: Message, account: Account | null): boolean {
  const from = senderAddress(m.from?.emailAddress).toLowerCase();
  const me = (account?.mail ?? account?.userPrincipalName ?? "").toLowerCase();
  const domain = me.split("@")[1];
  if (!domain || !from.includes("@")) return false;
  return !from.endsWith("@" + domain);
}
