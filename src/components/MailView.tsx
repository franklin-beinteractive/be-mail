// E-mailweergave: 3 kolommen — mappen | berichtenlijst | leesvenster.
import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../lib/api";
import { useApp } from "../lib/ctx";
import type {
  Account,
  AccountFolders,
  Attachment,
  MailFolder,
  Message,
  Recipient,
  StoredAccount,
} from "../lib/types";
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
  ChevronDown,
  ChevronRight,
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

interface FolderTree {
  roots: MailFolder[];
  kidsOf: (id: string) => MailFolder[];
  hasKids: (id: string) => boolean;
}

/** Bouwt een boom uit de platte mappenlijst, met eigen (gesleepte) volgorde. */
function buildTree(list: MailFolder[], order: Record<string, string[]>): FolderTree {
  const ids = new Set(list.map((f) => f.id));
  const kids = new Map<string, MailFolder[]>();
  const roots: MailFolder[] = [];
  for (const f of list) {
    if (f.parentFolderId && ids.has(f.parentFolderId)) {
      const arr = kids.get(f.parentFolderId) ?? [];
      arr.push(f);
      kids.set(f.parentFolderId, arr);
    } else {
      roots.push(f);
    }
  }
  const sortLevel = (fs: MailFolder[], parentKey: string) => {
    const seq = order[parentKey];
    if (!seq) return fs;
    return [...fs].sort((a, b) => {
      const ia = seq.indexOf(a.id);
      const ib = seq.indexOf(b.id);
      return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
    });
  };
  return {
    roots: sortLevel(roots, "root"),
    kidsOf: (id: string) => sortLevel(kids.get(id) ?? [], id),
    hasKids: (id: string) => (kids.get(id) ?? []).length > 0,
  };
}

export default function MailView() {
  const { t, settings, setSettings, notify, confirm } = useApp();
  // Multi-account: mappen per account; acties werken op het actieve account.
  const [accounts, setAccounts] = useState<StoredAccount[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [accountFolders, setAccountFolders] = useState<AccountFolders[]>([]);
  const [collapsedAccounts, setCollapsedAccounts] = useState<Set<string>>(new Set());
  const [folderId, setFolderId] = useState<string>("");

  // Mappen van het actieve account (alle bestaande logica werkt hierop).
  const folders = useMemo(
    () => accountFolders.find((g) => g.account.id === activeId)?.folders ?? [],
    [accountFolders, activeId]
  );

  // Adapter voor bestaande plekken die het account-object gebruiken.
  const account: Account | null = useMemo(() => {
    const a = accounts.find((x) => x.id === activeId);
    return a
      ? {
          id: a.id,
          mail: a.mail ?? null,
          displayName: a.displayName ?? null,
          userPrincipalName: a.mail ?? null,
        }
      : null;
  }, [accounts, activeId]);

  /** Wijzig alleen de mappen van het actieve account. */
  function patchActiveFolders(fn: (fs: MailFolder[]) => MailFolder[]) {
    setAccountFolders((prev) =>
      prev.map((g) =>
        g.account.id === activeId ? { ...g, folders: fn(g.folders) } : g
      )
    );
  }

  /** Ververs mappen + tellers van alle accounts. */
  function reloadAllFolders() {
    return api
      .listAllFolders()
      .then(setAccountFolders)
      .catch((e) => notify(String(e), "error"));
  }
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
  // Kolombreedtes (px); tijdens slepen lokaal, bij loslaten opgeslagen.
  const [colW, setColW] = useState({
    folders: settings.foldersWidth,
    list: settings.listWidth,
  });

  function startResize(which: "folders" | "list", e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = colW[which];
    const min = which === "folders" ? 160 : 240;
    const max = which === "folders" ? 440 : 640;
    const clamp = (x: number) => Math.min(max, Math.max(min, x));
    const onMove = (ev: MouseEvent) =>
      setColW((p) => ({ ...p, [which]: clamp(startW + ev.clientX - startX) }));
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const w = clamp(startW + ev.clientX - startX);
      setSettings(which === "folders" ? { foldersWidth: w } : { listWidth: w });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // Mappenbeheer-dialoog (nieuw of hernoemen) + invoerveld.
  const [folderDialog, setFolderDialog] = useState<
    { mode: "create" } | { mode: "rename"; folder: MailFolder } | null
  >(null);
  const [folderName, setFolderName] = useState("");
  // Mappenboom: ingeklapte mappen + drag & drop-status.
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [dragFolderId, setDragFolderId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{
    id: string;
    pos: "before" | "after" | "into";
  } | null>(null);
  // Bulkacties: ids van aangevinkte berichten.
  const [checked, setChecked] = useState<Set<string>>(new Set());

  // Accounts + mappen laden bij start; Postvak IN van het actieve account openen.
  useEffect(() => {
    (async () => {
      try {
        const info = await api.listAccounts();
        setAccounts(info.accounts);
        const active = info.active ?? info.accounts[0]?.id ?? "";
        setActiveId(active);
        const groups = await api.listAllFolders();
        setAccountFolders(groups);
        const g = groups.find((x) => x.account.id === active);
        const inbox =
          g?.folders.find((x) => /inbox|postvak in/i.test(x.displayName ?? "")) ??
          g?.folders[0];
        if (inbox) setFolderId(inbox.id);
      } catch (e) {
        notify(String(e), "error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Map kiezen — zo nodig eerst van account wisselen. */
  async function selectFolder(accountId: string, fId: string) {
    try {
      if (accountId !== activeId) {
        await api.setActiveAccount(accountId);
        setActiveId(accountId);
        setSearch("");
        setSearchResult(null);
      }
      setFolderId(fId);
    } catch (e) {
      notify(String(e), "error");
    }
  }

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
      void reloadAllFolders();
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
      void reloadAllFolders();
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
      void reloadAllFolders();
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
      void reloadAllFolders();
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
    patchActiveFolders((prev) =>
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

  // ---- Mappenboom ----

  const folderTree = useMemo(
    () => buildTree(folders, settings.folderOrder ?? {}),
    [folders, settings.folderOrder]
  );

  // Boom per account (voor de zijbalk met accountgroepen).
  const treeByAccount = useMemo(() => {
    const map = new Map<string, FolderTree>();
    for (const g of accountFolders) {
      map.set(g.account.id, buildTree(g.folders, settings.folderOrder ?? {}));
    }
    return map;
  }, [accountFolders, settings.folderOrder]);

  function toggleAccountCollapse(id: string) {
    setCollapsedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Is `candidateId` een nakomeling van `ancestorId`? (voorkomt zelf-nesting) */
  function isDescendant(candidateId: string, ancestorId: string): boolean {
    let cur = folders.find((f) => f.id === candidateId);
    for (let i = 0; cur && i < 10; i++) {
      if (cur.parentFolderId === ancestorId) return true;
      cur = folders.find((f) => f.id === cur!.parentFolderId);
    }
    return false;
  }

  function reloadFolders() {
    return reloadAllFolders();
  }

  async function handleFolderDrop(target: MailFolder) {
    const hint = dropHint;
    const dragId = dragFolderId;
    setDropHint(null);
    setDragFolderId(null);
    if (!hint || !dragId || dragId === target.id) return;
    const dragged = folders.find((x) => x.id === dragId);
    if (!dragged || isSystemFolder(dragged)) return;
    if (isDescendant(target.id, dragId)) return;

    const idSet = new Set(folders.map((f) => f.id));
    const parentKey =
      target.parentFolderId && idSet.has(target.parentFolderId)
        ? target.parentFolderId
        : "root";
    const dragParentKey =
      dragged.parentFolderId && idSet.has(dragged.parentFolderId)
        ? dragged.parentFolderId
        : "root";

    try {
      if (hint.pos === "into") {
        await api.moveFolder(dragId, target.id);
        await reloadFolders();
        return;
      }
      // Ervoor/erna: eerst naar dezelfde bovenliggende map (indien nodig),
      // daarna de lokale volgorde bijwerken.
      if (parentKey !== dragParentKey) {
        await api.moveFolder(dragId, parentKey === "root" ? "msgfolderroot" : parentKey);
      }
      const siblings = (parentKey === "root"
        ? folderTree.roots
        : folderTree.kidsOf(parentKey)
      )
        .map((x) => x.id)
        .filter((id) => id !== dragId);
      const idx = siblings.indexOf(target.id);
      siblings.splice(hint.pos === "before" ? idx : idx + 1, 0, dragId);
      setSettings({
        folderOrder: { ...(settings.folderOrder ?? {}), [parentKey]: siblings },
      });
      if (parentKey !== dragParentKey) await reloadFolders();
    } catch (e) {
      notify(String(e), "error");
    }
  }

  function toggleCollapse(id: string) {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ---- Mappenbeheer ----

  async function saveFolderDialog() {
    const name = folderName.trim();
    if (!name || !folderDialog) return;
    try {
      if (folderDialog.mode === "create") {
        const f = await api.createFolder(name);
        patchActiveFolders((prev) => [...prev, f]);
      } else {
        await api.renameFolder(folderDialog.folder.id, name);
        patchActiveFolders((prev) =>
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
      patchActiveFolders(() => rest);
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
      void reloadAllFolders();
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

  /** Eén map-rij (recursief, met inklappen en drag & drop). */
  function renderFolder(
    accountId: string,
    tree: FolderTree,
    f: MailFolder,
    depth: number
  ): React.ReactNode {
    const isActiveGroup = accountId === activeId;
    const hasKids = tree.hasKids(f.id);
    const isCollapsed = collapsedFolders.has(f.id);
    const hintHere = isActiveGroup && dropHint?.id === f.id ? dropHint.pos : null;
    return (
      <div key={f.id}>
        <div
          className={
            "folder" +
            (isActiveGroup && f.id === folderId ? " active" : "") +
            (hintHere ? ` drop-${hintHere}` : "")
          }
          style={{ paddingLeft: depth * 14 }}
          draggable={isActiveGroup && !isSystemFolder(f)}
          onDragStart={(e) => {
            setDragFolderId(f.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            if (!isActiveGroup || !dragFolderId || dragFolderId === f.id) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            const y = e.clientY - r.top;
            const pos = y < r.height * 0.3 ? "before" : y > r.height * 0.7 ? "after" : "into";
            setDropHint((h) => (h?.id === f.id && h.pos === pos ? h : { id: f.id, pos }));
          }}
          onDragLeave={() => setDropHint((h) => (h?.id === f.id ? null : h))}
          onDrop={(e) => {
            e.preventDefault();
            void handleFolderDrop(f);
          }}
          onDragEnd={() => {
            setDragFolderId(null);
            setDropHint(null);
          }}
        >
          {hasKids ? (
            <button
              className="icon-btn fold-toggle"
              onClick={() => toggleCollapse(f.id)}
              aria-label={isCollapsed ? t("next") : t("prev")}
            >
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
          ) : (
            <span className="fold-spacer" />
          )}
          <button className="folder-main" onClick={() => void selectFolder(accountId, f.id)}>
            <span className="folder-name">{f.displayName}</span>
            {!!f.unreadItemCount && <span className="badge">{f.unreadItemCount}</span>}
          </button>
          {isActiveGroup && !isSystemFolder(f) && (
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
        {hasKids &&
          !isCollapsed &&
          tree.kidsOf(f.id).map((k) => renderFolder(accountId, tree, k, depth + 1))}
      </div>
    );
  }

  return (
    <div
      className="mail"
      style={
        {
          "--col-folders": `${colW.folders}px`,
          "--col-list": `${colW.list}px`,
        } as React.CSSProperties
      }
    >
      {/* Kolom 1: mappen, gegroepeerd per account */}
      <aside className="folders">
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
          {accountFolders.map((g) => {
            const tree = treeByAccount.get(g.account.id);
            const isCollapsed = collapsedAccounts.has(g.account.id);
            return (
              <div key={g.account.id} className="account-group">
                <button
                  className="account-head"
                  onClick={() => toggleAccountCollapse(g.account.id)}
                  title={g.account.mail ?? ""}
                >
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  <span className="account-label">
                    {g.account.mail ?? g.account.displayName ?? "?"}
                  </span>
                </button>
                {!isCollapsed &&
                  tree?.roots.map((f) => renderFolder(g.account.id, tree, f, 0))}
              </div>
            );
          })}
        </nav>
      </aside>

      <div
        className="col-resizer"
        onMouseDown={(e) => startResize("folders", e)}
        role="separator"
        aria-orientation="vertical"
      />

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

      <div
        className="col-resizer"
        onMouseDown={(e) => startResize("list", e)}
        role="separator"
        aria-orientation="vertical"
      />

      {/* Kolom 3: leesvenster (of het opstelvenster, inline) */}
      <section className="reader">
        {compose ? (
          <ComposeDialog
            inline
            initial={compose}
            onClose={composeClosed}
            onSent={composeClosed}
          />
        ) : (
          <>
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
          </>
        )}
      </section>

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
