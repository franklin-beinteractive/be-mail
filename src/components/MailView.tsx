// E-mailweergave: 3 kolommen - mappen | berichtenlijst | leesvenster.
import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../lib/api";
import { opdrachtenApi } from "../lib/opdrachten-api";
import { useApp } from "../lib/ctx";
import type {
  Account,
  AccountFolders,
  Attachment,
  MailFolder,
  Message,
  OutlookCategory,
  Recipient,
  SearchQuery,
  StoredAccount,
} from "../lib/types";
import {
  externalImageUrls,
  fileSize,
  htmlToText,
  longDateTime,
  sanitizeEmail,
  senderAddress,
  senderName,
  shortDate,
} from "../lib/format";
import {
  HIDEABLE_FOLDERS,
  signatureHtml,
  type AiSkill,
  type QuickAction,
} from "../lib/settings";
import Avatar from "./Avatar";
import ComposeDialog, { type ComposeInitial } from "./ComposeDialog";
import {
  ArchiveIcon,
  BanIcon,
  ChevronDown,
  ClockIcon,
  ChevronRight,
  CloseIcon,
  ComposeIcon,
  DownloadIcon,
  EditIcon,
  FlagIcon,
  FolderIcon,
  ForwardIcon,
  MailIcon,
  MailOpenIcon,
  OpdrachtenIcon,
  PaperclipIcon,
  PlusIcon,
  ReplyAllIcon,
  ReplyIcon,
  SearchIcon,
  SpamIcon,
  TrashIcon,
} from "./Icons";

const PAGE = 25;

// ---- Snoozen ("toon later") ----
// Registratie lokaal (localStorage); de app zet het bericht op het gekozen
// moment terug in Postvak IN (controle bij start en elke minuut; werkt dus
// alleen terwijl de app draait).
interface SnoozeEntry {
  id: string; // bericht-id ná verplaatsing naar de Uitgesteld-map
  accountId: string;
  due: string; // ISO-tijdstip
  /** Mislukte pogingen om het bericht terug te zetten. Een tik van de wekker
   *  kan mislukken doordat het netwerk plat ligt; de registratie blijft dan
   *  staan zodat de volgende tik het opnieuw probeert. */
  tries?: number;
}
const SNOOZE_KEY = "BE-Mail.snoozes";
/** Na zoveel mislukte pogingen (één per minuut) geeft de wekker het op. Zonder
 *  bovengrens zou een bericht dat er niet meer is elke minuut blijven proberen. */
const SNOOZE_MAX_TRIES = 10;
function loadSnoozes(): SnoozeEntry[] {
  try {
    return JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? "[]") as SnoozeEntry[];
  } catch {
    return [];
  }
}
function saveSnoozes(list: SnoozeEntry[]): void {
  localStorage.setItem(SNOOZE_KEY, JSON.stringify(list));
}
function laterToday(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 3, 0, 0, 0);
  return d;
}
function tomorrowMorning(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}
function nextMondayMorning(): Date {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  d.setHours(9, 0, 0, 0);
  return d;
}
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
/** Date → waarde voor <input type="datetime-local"> (lokale tijd, geen UTC:
 *  `toISOString()` zou er een uur of twee naast zitten). */
function toDateTimeInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Outlook-presetkleuren voor categorieën (preset0 t/m preset24).
const CATEGORY_COLORS: Record<string, string> = {
  preset0: "#e74856", preset1: "#ff8c00", preset2: "#ffab45", preset3: "#fff100",
  preset4: "#47d041", preset5: "#30c6cc", preset6: "#73aa24", preset7: "#00bcf2",
  preset8: "#8764b8", preset9: "#f495bf", preset10: "#a0aeb2", preset11: "#004b60",
  preset12: "#b1adab", preset13: "#5d5a58", preset14: "#444444", preset15: "#750b1c",
  preset16: "#ca5010", preset17: "#ab620d", preset18: "#c19c00", preset19: "#004b1c",
  preset20: "#004b50", preset21: "#0b6a0b", preset22: "#002050", preset23: "#32145a",
  preset24: "#5a005a",
};

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

interface MailViewProps {
  /** Callback nadat vanuit een mail een opdracht-kaart is aangemaakt. */
  onOpdrachtAangemaakt?: (id: number) => void;
  /** Meld een wissel van actief account aan de App (voor capability-gating). */
  onActiveAccountChange?: (accountId: string) => void;
}

export default function MailView({
  onOpdrachtAangemaakt,
  onActiveAccountChange,
}: MailViewProps = {}) {
  const { t, tip, settings, setSettings, notify, confirm } = useApp();
  // Multi-account: mappen per account; acties werken op het actieve account.
  const [accounts, setAccounts] = useState<StoredAccount[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [accountFolders, setAccountFolders] = useState<AccountFolders[]>([]);
  // Ingeklapte accountgroepen: persistent in Instellingen (standaard uitgeklapt).
  const collapsedAccounts = useMemo(
    () => new Set(settings.collapsedAccounts ?? []),
    [settings.collapsedAccounts]
  );
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

  // IMAP-account: Graph-only mailfuncties (RSVP, afzender blokkeren, categorieen,
  // zoeken over alle mappen) verbergen.
  const isImap = useMemo(
    () => accounts.find((x) => x.id === activeId)?.kind === "imap",
    [accounts, activeId]
  );

  /** Staat de open map zelf Archief te zijn? Dan is archiveren zinloos: het
   *  bericht zou naar zijn eigen map verhuizen. Naam-herkenning op NL en EN,
   *  net als bij de andere standaardmappen. */
  const inArchiveFolder = useMemo(() => {
    const name = folders.find((f) => f.id === folderId)?.displayName?.trim() ?? "";
    return !!name && HIDEABLE_FOLDERS.find((h) => h.key === "archive")!.re.test(name);
  }, [folders, folderId]);

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
  // Lijst komt uit de offline cache (geen netwerk): toon een hint-balk.
  const [offline, setOffline] = useState(false);
  // Sortering (false = nieuwste eerst) en filter voor de berichtenlijst.
  const [sortAsc, setSortAsc] = useState(false);
  const [filterMode, setFilterMode] = useState<"all" | "unread" | "flagged">("all");
  const [selected, setSelected] = useState<Message | null>(null);
  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  // Server-side zoekresultaten. null = geen zoekopdracht actief.
  const [searchResult, setSearchResult] = useState<Message[] | null>(null);
  // Zoekbereik: hele mailbox of alleen de geopende map.
  const [searchScope, setSearchScope] = useState<"all" | "folder">("all");
  // Uitgebreid zoeken: paneel open/dicht en de ingevulde velden.
  const [advOpen, setAdvOpen] = useState(false);
  const [adv, setAdv] = useState<SearchQuery>({});
  // Volgnummer tegen verouderde zoekresultaten (trage respons die een
  // nieuwere overschrijft).
  const searchSeq = useRef(0);
  // AI-antwoord (Claude) wordt gegenereerd.
  const [aiBusy, setAiBusy] = useState(false);
  const [allowImages, setAllowImages] = useState(false);
  const [compose, setCompose] = useState<ComposeInitial | null>(null);
  // Bijlagen van het geopende bericht; id van de bijlage die nu downloadt.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  // Ingesloten (cid:) afbeeldingen van het geopende bericht: cid → data-URI.
  const [inlineImages, setInlineImages] = useState<Record<string, string>>({});
  // Externe afbeeldingen na toestemming: originele URL → data-URI (opgehaald
  // door de Rust-kern; de webview mag externe URL's niet zelf laden).
  const [remoteImages, setRemoteImages] = useState<Record<string, string>>({});
  const [loadingImages, setLoadingImages] = useState(false);
  // Volgnummer: laadt er nog een ouder bericht terwijl je doorklikt, dan mogen
  // die afbeeldingen niet in het nieuwe bericht belanden.
  const imageSeq = useRef(0);
  // Categorieën (kleurlabels): masterlijst van het postvak; leeg zonder
  // MailboxSettings-consent (de UI verschijnt dan gewoon niet).
  const [masterCats, setMasterCats] = useState<OutlookCategory[]>([]);
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
  // Mappenboom: uitgeklapte mappen (persistent in Instellingen; standaard
  // alles ingeklapt) + drag & drop-status.
  const expandedFolders = useMemo(
    () => new Set(settings.expandedFolders ?? []),
    [settings.expandedFolders]
  );
  const [dragFolderId, setDragFolderId] = useState<string | null>(null);
  // Berichten die versleept worden (de aangeklikte, of de hele selectie).
  const [dragMsgIds, setDragMsgIds] = useState<string[] | null>(null);
  const [dropHint, setDropHint] = useState<{
    id: string;
    pos: "before" | "after" | "into";
  } | null>(null);
  // Bulkacties: ids van aangevinkte berichten.
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // Contextmenu (rechtermuisknop) op een bericht in de lijst.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; msg: Message } | null>(null);

  // Contextmenu sluiten bij een klik of Escape, waar dan ook.
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  // Accounts + mappen laden bij start; Postvak IN van het actieve account openen.
  useEffect(() => {
    (async () => {
      try {
        const info = await api.listAccounts();
        setAccounts(info.accounts);
        const active = info.active ?? info.accounts[0]?.id ?? "";
        setActiveId(active);
        if (active) onActiveAccountChange?.(active);
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

  /** Map kiezen - zo nodig eerst van account wisselen. */
  async function selectFolder(accountId: string, fId: string) {
    try {
      if (accountId !== activeId) {
        await api.setActiveAccount(accountId);
        setActiveId(accountId);
        onActiveAccountChange?.(accountId);
        setSearch("");
        setSearchResult(null);
      }
      setFolderId(fId);
    } catch (e) {
      notify(String(e), "error");
    }
  }

  // Berichten laden bij mapwissel of gewijzigde sortering/filter.
  useEffect(() => {
    if (!folderId) return;
    setMessages([]);
    setSelected(null);
    setSkip(0);
    setChecked(new Set());
    loadPage(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId, sortAsc, filterMode]);

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

  // Server-side zoeken (hele mailbox of huidige map), met korte debounce zodat
  // we niet bij elke toetsaanslag een call doen. Leeg zoekvak → mapweergave.
  // Het volgnummer voorkomt dat een traag, ouder resultaat een nieuwer
  // resultaat overschrijft (race bij snel doortypen).
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setSearchResult(null);
      setChecked(new Set());
      return;
    }
    const handle = setTimeout(async () => {
      const seq = ++searchSeq.current;
      setLoading(true);
      try {
        // IMAP kan niet over de hele mailbox zoeken: altijd op de huidige map.
        const folderScoped = searchScope === "folder" || isImap;
        const page = await api.searchMessages(
          q,
          50,
          folderScoped ? folderId ?? undefined : undefined
        );
        if (seq !== searchSeq.current) return; // verouderd resultaat
        setSearchResult(page.messages);
        setChecked(new Set());
      } catch (e) {
        if (seq === searchSeq.current) notify(String(e), "error");
      } finally {
        if (seq === searchSeq.current) setLoading(false);
      }
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, searchScope, folderId, isImap]);

  /** Uitgebreid zoeken uitvoeren. Het snelle zoekvak wordt geleegd zodat de
   *  twee elkaars resultaten niet overschrijven. */
  async function runAdvancedSearch() {
    const seq = ++searchSeq.current;
    setSearch("");
    setLoading(true);
    try {
      const folderScoped = searchScope === "folder" || isImap;
      const page = await api.searchAdvanced(
        adv,
        50,
        folderScoped ? folderId ?? undefined : undefined
      );
      if (seq !== searchSeq.current) return;
      setSearchResult(page.messages);
      setChecked(new Set());
    } catch (e) {
      if (seq === searchSeq.current) notify(String(e), "error");
    } finally {
      if (seq === searchSeq.current) setLoading(false);
    }
  }

  function clearAdvancedSearch() {
    setAdv({});
    searchSeq.current++;
    setSearchResult(null);
    setChecked(new Set());
  }

  async function loadPage(from: number, replace: boolean) {
    if (!folderId) return;
    setLoading(true);
    try {
      const page = await api.listMessages(
        folderId,
        PAGE,
        from,
        sortAsc,
        filterMode === "all" ? undefined : filterMode
      );
      setMessages((prev) => (replace ? page.messages : [...prev, ...page.messages]));
      setHasMore(page.hasMore);
      setSkip(from + PAGE);
      setOffline(!!page.fromCache);
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setLoading(false);
    }
  }

  async function openMessage(m: Message) {
    setAllowImages(false);
    setAttachments([]);
    setInlineImages({});
    setRemoteImages({});
    setLoadingImages(false);
    imageSeq.current++;
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
      // Ingesloten (cid:) afbeeldingen ophalen en als data-URI invullen.
      // Los van hasAttachments: bij alleen-inline bijlagen staat die soms op false.
      if ((full.body?.content ?? "").includes("cid:")) {
        api
          .inlineImages(m.id)
          .then((list) =>
            setInlineImages(
              Object.fromEntries(
                list.map((i) => [
                  i.contentId,
                  `data:${i.contentType};base64,${i.contentBytes}`,
                ])
              )
            )
          )
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

  // ---- Snoozen ----

  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [snoozeAt, setSnoozeAt] = useState("");
  const snoozeRef = useRef<HTMLSpanElement>(null);
  // Registraties ook in state: de lijst en het leesvenster tonen wanneer een
  // bericht terugkomt, dus een wijziging moet opnieuw tekenen.
  const [snoozes, setSnoozes] = useState<SnoozeEntry[]>(loadSnoozes);
  // Verse verwijzing naar "huidige lijst verversen" voor de snooze-wekker
  // (de interval-closure zou anders een verouderde folderId zien).
  const reloadListRef = useRef<() => void>(() => {});
  reloadListRef.current = () => {
    if (!searchResult) void loadPage(0, true);
  };

  function putSnoozes(next: SnoozeEntry[]) {
    saveSnoozes(next);
    setSnoozes(next);
  }
  /** Altijd vanuit localStorage rekenen: de wekker draait in een interval en
   *  zou met een verouderde state-kopie registraties kunnen wegpoetsen. */
  function updateSnoozes(fn: (list: SnoozeEntry[]) => SnoozeEntry[]) {
    putSnoozes(fn(loadSnoozes()));
  }

  /** Openstaande uitstel-registratie van een bericht in het actieve account. */
  const snoozeOf = useMemo(() => {
    const map = new Map<string, SnoozeEntry>();
    for (const s of snoozes) if (s.accountId === activeId) map.set(s.id, s);
    return map;
  }, [snoozes, activeId]);

  async function ensureSnoozeFolder(): Promise<string> {
    // Op naam zoeken in beide talen: wie de app op Engels zet, mag geen tweede
    // map ("Snoozed" naast "Uitgesteld") krijgen met een halve voorraad erin.
    const re = HIDEABLE_FOLDERS.find((h) => h.key === "snoozed")!.re;
    const existing = folders.find((f) => re.test((f.displayName ?? "").trim()));
    if (existing) return existing.id;
    const f = await api.createFolder(t("snoozed"));
    patchActiveFolders((prev) => [...prev, f]);
    return f.id;
  }

  async function snooze(m: Message, due: Date) {
    setSnoozeOpen(false);
    try {
      // Opnieuw uitstellen van een al uitgesteld bericht verplaatst niets: het
      // staat al in de map. Wél verplaatsen zou een tweede id opleveren en de
      // oude registratie op een spookbericht laten wachten.
      let id = m.id;
      if (!snoozeOf.has(m.id)) {
        const dest = await ensureSnoozeFolder();
        id = (await api.moveMessageReturning(m.id, dest)).id;
        dropFromLists(m.id);
      }
      updateSnoozes((list) => [
        ...list.filter((s) => s.id !== id && s.id !== m.id),
        { id, accountId: activeId, due: due.toISOString() },
      ]);
      notify(`${t("snoozedUntil")} ${longDateTime(due.toISOString(), settings.lang)}`, "info");
      void reloadAllFolders();
    } catch (e) {
      notify(String(e), "error");
    }
  }

  /** Uitstellen ongedaan maken: het bericht gaat nu meteen terug naar Postvak
   *  IN, met hetzelfde command als de wekker. */
  async function unsnooze(m: Message) {
    setSnoozeOpen(false);
    try {
      await api.wakeSnoozed(activeId, m.id);
      updateSnoozes((list) => list.filter((s) => s.id !== m.id));
      dropFromLists(m.id);
      notify(t("snoozeCancelled"), "info");
      void reloadAllFolders();
    } catch (e) {
      notify(String(e), "error");
    }
  }

  // Wekker: uitgestelde berichten terugzetten in Postvak IN (ongelezen) zodra
  // hun tijd voorbij is. Over ALLE accounts, niet alleen het actieve: anders
  // blijft een bericht liggen zolang je in een ander account werkt, terwijl de
  // gebruiker een tijdstip heeft afgesproken.
  const wakeBusy = useRef(false);
  useEffect(() => {
    if (!activeId) return;
    async function wake() {
      // Een trage ronde mag niet overlappen met de volgende tik; dan zou
      // hetzelfde bericht twee keer worden teruggezet.
      if (wakeBusy.current) return;
      const now = Date.now();
      const due = loadSnoozes().filter((s) => new Date(s.due).getTime() <= now);
      if (!due.length) return;
      wakeBusy.current = true;
      const done = new Set<string>();
      const failed = new Set<string>();
      let activeWoken = false;
      for (const s of due) {
        try {
          await api.wakeSnoozed(s.accountId, s.id);
          done.add(s.id);
          if (s.accountId === activeId) activeWoken = true;
        } catch {
          // Netwerk plat of bericht intussen verwijderd: registratie bewaren
          // en het straks opnieuw proberen (tot SNOOZE_MAX_TRIES).
          failed.add(s.id);
        }
      }
      const next: SnoozeEntry[] = [];
      let gaveUp = 0;
      for (const s of loadSnoozes()) {
        if (done.has(s.id)) continue;
        if (!failed.has(s.id)) {
          next.push(s);
          continue;
        }
        const tries = (s.tries ?? 0) + 1;
        if (tries >= SNOOZE_MAX_TRIES) gaveUp++;
        else next.push({ ...s, tries });
      }
      putSnoozes(next);
      wakeBusy.current = false;
      if (gaveUp) notify(t("snoozeWakeFailed"), "error");
      // Alleen het beeld verversen als er iets in het zichtbare account wijzigde.
      if (activeWoken) {
        void reloadAllFolders();
        reloadListRef.current();
      }
    }
    void wake();
    const h = window.setInterval(() => void wake(), 60_000);
    return () => window.clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Uitstel-menu sluiten bij een klik ernaast of Escape (het menu bevat een
  // invoerveld, dus een klik erbinnen mag het juist niet sluiten).
  useEffect(() => {
    if (!snoozeOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!snoozeRef.current?.contains(e.target as Node)) setSnoozeOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSnoozeOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [snoozeOpen]);

  // ---- Categorieën ----

  useEffect(() => {
    api.listCategories().then(setMasterCats).catch(() => setMasterCats([]));
  }, [activeId]);

  function catColor(name: string): string {
    const c = masterCats.find((x) => x.displayName === name)?.color;
    return (c && CATEGORY_COLORS[c]) || "#a0aeb2";
  }

  /** Categorie aan/uit zetten. Geeft false terug als het misging (de melding
   *  is dan al getoond), zodat een aanroeper geen "gelukt" meer meldt. */
  async function toggleCategory(m: Message, name: string): Promise<boolean> {
    const cur = m.categories ?? [];
    const next = cur.includes(name)
      ? cur.filter((x) => x !== name)
      : [...cur, name];
    try {
      await api.setMessageCategories(m.id, next);
      patch(m.id, { categories: next });
      setSelected((s) => (s && s.id === m.id ? { ...s, categories: next } : s));
      return true;
    } catch (e) {
      notify(String(e), "error");
      return false;
    }
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

  /** Hele bericht als .eml in Downloads (te openen in elke mailclient). */
  async function downloadMessage(m: Message) {
    setDownloading(m.id);
    try {
      const path = await api.downloadMessage(m.id);
      notify(`${t("messageSaved")}: ${path}`, "info");
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setDownloading(null);
    }
  }

  /** Een bericht verdwijnt uit de open map: de ongelezen-teller ernaast moet
   *  mee. Binnen zoekresultaten kan het bericht uit een andere map komen, dus
   *  halen we de tellers daar bij de server op. */
  function dropUnreadCount(m: Message) {
    if (searchResult) void reloadAllFolders();
    else if (!m.isRead) refreshFolderUnread(-1);
  }

  async function remove(m: Message) {
    if (!(await confirm(t("confirmDelete")))) return;
    try {
      await api.deleteMessage(m.id);
      dropFromLists(m.id);
      dropUnreadCount(m);
    } catch (e) {
      notify(String(e), "error");
    }
  }

  async function archive(m: Message) {
    // Archiveren terwijl je ín Archief staat verplaatst het bericht naar zijn
    // eigen map: Graph geeft het een nieuw id en de rij staat er bij de
    // volgende verversing gewoon weer. Zeg dat liever.
    if (inArchiveFolder) {
      notify(t("quickActionAlreadyThere"), "info");
      return;
    }
    try {
      await api.archiveMessage(m.id);
      dropFromLists(m.id);
      dropUnreadCount(m);
    } catch (e) {
      notify(String(e), "error");
    }
  }

  /** Snelle actie uit de instellingen op het geopende bericht toepassen:
   *  verplaatsen naar een map of een categorie toekennen. */
  async function runQuickAction(m: Message, qa: QuickAction) {
    if (qa.kind === "category") {
      // Categorieën bestaan alleen in Office 365; bij IMAP is er niets te zetten.
      if (isImap) {
        notify(t("quickActionNoCategories"), "error");
        return;
      }
      // De knop schakelt: had het bericht de categorie al, dan haalt hij hem
      // eraf. Zonder melding zie je alleen de chip veranderen, en die staat
      // buiten beeld zodra je naar beneden hebt gescrold.
      const had = (m.categories ?? []).includes(qa.target);
      if (await toggleCategory(m, qa.target)) {
        notify(`${t(had ? "categoryRemoved" : "categoryAdded")}: ${qa.target}`, "info");
      }
      return;
    }
    const target = folders.find(
      (f) => (f.displayName ?? "").trim().toLowerCase() === qa.target.trim().toLowerCase()
    );
    if (!target) {
      notify(`${t("quickActionNoFolder")}: ${qa.target}`, "error");
      return;
    }
    if (target.id === folderId) {
      notify(`${t("quickActionAlreadyThere")}: ${qa.target}`, "info");
      return;
    }
    try {
      await api.moveMessage(m.id, target.id);
      dropFromLists(m.id);
      notify(`${t("move")} ✓`, "info");
      void reloadAllFolders();
    } catch (e) {
      notify(String(e), "error");
    }
  }

  /** Versleepte berichten in een map laten vallen. */
  async function dropMessagesOn(target: MailFolder) {
    const ids = dragMsgIds ?? [];
    setDragMsgIds(null);
    setDropHint(null);
    if (!ids.length || target.id === folderId) return;
    try {
      for (const id of ids) {
        await api.moveMessage(id, target.id);
        dropFromLists(id);
      }
      setChecked(new Set());
      notify(`${t("move")} ✓`, "info");
      void reloadAllFolders();
    } catch (e) {
      notify(String(e), "error");
    }
  }

  // ---- Sneltoetsen ----
  // Alleen actief als de focus niet in een invoerveld/editor staat en er geen
  // opstelvenster open is. Bewust zonder deps: goedkoop, altijd verse closures.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const inField =
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable);
      // Ctrl+A vinkt alle zichtbare mails aan wanneer de cursor (muis of
      // focus) in de maillijst staat; in invoervelden blijft Ctrl+A gewoon
      // tekst selecteren.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "a") {
        const inList =
          document.querySelector(".list-scroll:hover") != null ||
          el?.closest(".list-scroll") != null;
        if (!compose && !inField && inList) {
          e.preventDefault();
          setChecked(new Set((searchResult ?? messages).map((m) => m.id)));
        }
        return;
      }
      if (compose || e.ctrlKey || e.metaKey || e.altKey) return;
      if (inField) return;
      const k = e.key;
      if (k === "n") {
        e.preventDefault();
        setCompose({ kind: "new" });
        return;
      }
      if (k === "/") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".list-search input")?.focus();
        return;
      }
      const list = searchResult ?? messages;
      if (k === "ArrowDown" || k === "j" || k === "ArrowUp" || k === "k") {
        e.preventDefault();
        const idx = selected ? list.findIndex((x) => x.id === selected.id) : -1;
        const next =
          k === "ArrowDown" || k === "j"
            ? list[Math.min(idx + 1, list.length - 1)]
            : list[Math.max(idx - 1, 0)];
        if (next && next.id !== selected?.id) void openMessage(next);
        return;
      }
      if (!selected) return;
      if (k === "r") setCompose(buildReply(selected, false));
      else if (k === "a") setCompose(buildReply(selected, true));
      else if (k === "f") setCompose(buildForward(selected));
      else if (k === "e") void archive(selected);
      else if (k === "Delete") void remove(selected);
      else if (k === "u") void toggleRead(selected);
      else if (k === "m") void toggleFlag(selected);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- Mappenboom ----

  const folderTree = useMemo(
    () => buildTree(folders, settings.folderOrder ?? {}),
    [folders, settings.folderOrder]
  );

  // Boom per account (voor de zijbalk met accountgroepen). Verborgen
  // standaardmappen (Instellingen → Mappen) worden hier weggefilterd; alle
  // acties (archiveren, concepten, snoozen) blijven gewoon werken.
  const treeByAccount = useMemo(() => {
    const hidden = settings.hiddenFolders ?? [];
    const isHidden = (f: MailFolder) =>
      HIDEABLE_FOLDERS.some(
        (c) => hidden.includes(c.key) && c.re.test((f.displayName ?? "").trim())
      );
    const map = new Map<string, FolderTree>();
    for (const g of accountFolders) {
      // Ook nakomelingen van een verborgen map weglaten, anders zouden bv. de
      // submappen van Synchronisatieproblemen als losse hoofdmappen opduiken.
      const byId = new Map(g.folders.map((f) => [f.id, f]));
      const hiddenIds = new Set(g.folders.filter(isHidden).map((f) => f.id));
      const underHidden = (f: MailFolder): boolean => {
        let cur: MailFolder | undefined = f;
        for (let i = 0; cur && i < 10; i++) {
          if (hiddenIds.has(cur.id)) return true;
          cur = cur.parentFolderId ? byId.get(cur.parentFolderId) : undefined;
        }
        return false;
      };
      map.set(
        g.account.id,
        buildTree(g.folders.filter((f) => !underHidden(f)), settings.folderOrder ?? {})
      );
    }
    return map;
  }, [accountFolders, settings.folderOrder, settings.hiddenFolders]);

  function toggleAccountCollapse(id: string) {
    const next = new Set(settings.collapsedAccounts ?? []);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSettings({ collapsedAccounts: [...next] });
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

  /** Drop-positie direct uit het event: boven = ervoor, onder = erna, midden =
   *  erin. Systeemmappen (Postvak IN e.d.) kunnen alleen gesorteerd worden,
   *  dus dan telt alleen boven/onder. */
  function dropPos(e: React.DragEvent, dragId: string | null): "before" | "after" | "into" {
    const r = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - r.top;
    const dragged = dragId ? folders.find((x) => x.id === dragId) : null;
    if (dragged && isSystemFolder(dragged)) {
      return y < r.height / 2 ? "before" : "after";
    }
    return y < r.height * 0.35 ? "before" : y > r.height * 0.65 ? "after" : "into";
  }

  async function handleFolderDrop(
    target: MailFolder,
    pos: "before" | "after" | "into",
    dataId?: string
  ) {
    // Positie en gesleepte map komen uit het dropevent zelf (dataTransfer als
    // fallback), niet uit React-state: die kan bij een snelle drop achterlopen.
    const dragId = dragFolderId ?? (dataId || null);
    setDropHint(null);
    setDragFolderId(null);
    if (!dragId || dragId === target.id) return;
    const hint = { pos };
    const dragged = folders.find((x) => x.id === dragId);
    if (!dragged) return;
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

    // Systeemmappen (Postvak IN e.d.): alleen sorteren op hun eigen niveau;
    // nooit in een andere map nesten of naar een ander niveau verplaatsen.
    if (isSystemFolder(dragged) && (hint.pos === "into" || parentKey !== dragParentKey)) {
      return;
    }

    try {
      if (hint.pos === "into") {
        await api.moveFolder(dragId, target.id);
        // Doelmap openklappen zodat de verplaatste map meteen zichtbaar is.
        setSettings({
          expandedFolders: [...new Set([...(settings.expandedFolders ?? []), target.id])],
        });
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
    const next = new Set(settings.expandedFolders ?? []);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSettings({ expandedFolders: [...next] });
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
    const header = `<p>- ${senderName(m.from?.emailAddress)} (${longDateTime(
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

  /** Laat Claude een antwoord schrijven in de gekozen stijl en open het
   *  opstelvenster met die tekst boven het aangehaalde origineel. */
  async function aiReply(m: Message, skill: AiSkill) {
    setAiBusy(true);
    notify(t("aiGenerating"), "info");
    try {
      const text = await api.aiReply({
        stylePrompt: skill.prompt,
        userName: account?.displayName ?? account?.mail ?? "",
        lang: settings.lang,
        from: `${senderName(m.from?.emailAddress)} <${senderAddress(m.from?.emailAddress)}>`,
        subject: m.subject ?? "",
        bodyText: htmlToText(m.body?.content ?? "") || m.bodyPreview || "",
      });
      // Platte tekst → editor-HTML (alinea's op lege regels).
      const esc = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const aiHtml = esc
        .split(/\n{2,}/)
        .map((p) => `<div>${p.replace(/\n/g, "<br>")}</div><div><br></div>`)
        .join("");
      const sig = settings.signatures.find(
        (s) => s.id === settings.signatureReplyId
      );
      const html = aiHtml + (sig ? `<div data-sig="1">${signatureHtml(sig)}</div>` : "");
      setCompose({ ...buildReply(m, false), html });
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setAiBusy(false);
    }
  }

  function buildForward(m: Message): ComposeInitial {
    const header = `<p>- ${senderName(m.from?.emailAddress)} (${longDateTime(
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

  // Threading: geladen berichten groeperen op conversationId. Het nieuwste
  // bericht is de kop; oudere berichten klappen eronder uit.
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  const threads = useMemo(() => {
    const byConv = new Map<string, Message[]>();
    const order: { key: string; items: Message[] }[] = [];
    for (const m of shown) {
      const key = m.conversationId || m.id;
      let arr = byConv.get(key);
      if (!arr) {
        arr = [];
        byConv.set(key, arr);
        order.push({ key, items: arr });
      }
      arr.push(m);
    }
    return order;
  }, [shown]);

  /** De conversatie rond het geopende bericht, oudste eerst. Bevat alleen wat
   *  in de lijst geladen is: eigen antwoorden uit Verzonden items zitten er
   *  dus niet bij zolang je in Postvak IN kijkt. */
  const convo = useMemo(() => {
    if (!selected) return [];
    const key = selected.conversationId || selected.id;
    const items = shown.filter((m) => (m.conversationId || m.id) === key);
    if (!items.some((m) => m.id === selected.id)) items.push(selected);
    return items.sort(
      (a, b) =>
        new Date(a.receivedDateTime ?? 0).getTime() -
        new Date(b.receivedDateTime ?? 0).getTime()
    );
  }, [selected, shown]);

  function toggleThread(key: string) {
    setExpandedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const bodyHtml = useMemo(() => {
    if (!selected?.body) return "";
    if (selected.body.contentType?.toLowerCase() === "text") {
      return `<pre class="plain">${selected.body.content
        .replace(/</g, "&lt;")}</pre>`;
    }
    return sanitizeEmail(
      selected.body.content,
      allowImages,
      inlineImages,
      remoteImages
    );
  }, [selected, allowImages, inlineImages, remoteImages]);

  // Externe afbeeldingen in het geopende bericht (alleen HTML-berichten).
  const externalUrls = useMemo(() => {
    if (!selected?.body) return [];
    if (selected.body.contentType?.toLowerCase() === "text") return [];
    return externalImageUrls(selected.body.content);
  }, [selected]);

  const externalBlocked = !allowImages && externalUrls.length > 0;

  /** Toestemming voor externe afbeeldingen: haal ze via de Rust-kern op en
   *  vul ze als data-URI in. Rechtstreeks laden kan niet (CSP) en zou het
   *  IP-adres en cookies van de gebruiker aan trackers prijsgeven. */
  async function showExternalImages() {
    setAllowImages(true);
    if (externalUrls.length === 0) return;
    const seq = ++imageSeq.current;
    setLoadingImages(true);
    // Handjevol tegelijk: een nieuwsbrief met 40 afbeeldingen mag de app niet
    // laten stotteren, maar één voor één duurt te lang.
    const queue = [...externalUrls];
    const worker = async () => {
      while (queue.length > 0 && seq === imageSeq.current) {
        const url = queue.shift()!;
        try {
          const data = await api.fetchRemoteImage(url);
          if (seq === imageSeq.current) {
            // Per afbeelding invullen: ze verschijnen zo een voor een.
            setRemoteImages((prev) => ({ ...prev, [url]: data }));
          }
        } catch {
          // Kapotte of onbereikbare afbeelding: overslaan, geen foutmelding.
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(4, queue.length) }, worker)
    );
    if (seq === imageSeq.current) setLoadingImages(false);
  }

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
    const isCollapsed = !expandedFolders.has(f.id);
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
          draggable={isActiveGroup}
          onDragStart={(e) => {
            setDragFolderId(f.id);
            // Zonder data start WebView2/Chromium de sleep niet altijd.
            e.dataTransfer.setData("text/plain", f.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            if (!isActiveGroup) return;
            // Berichten slepen: hele map is doel ("into").
            if (dragMsgIds) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDropHint((h) =>
                h?.id === f.id && h.pos === "into" ? h : { id: f.id, pos: "into" }
              );
              return;
            }
            if (!dragFolderId || dragFolderId === f.id) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const pos = dropPos(e, dragFolderId);
            setDropHint((h) => (h?.id === f.id && h.pos === pos ? h : { id: f.id, pos }));
          }}
          onDragLeave={() => setDropHint((h) => (h?.id === f.id ? null : h))}
          onDrop={(e) => {
            e.preventDefault();
            if (dragMsgIds) {
              void dropMessagesOn(f);
              return;
            }
            const dataId = e.dataTransfer.getData("text/plain") || undefined;
            void handleFolderDrop(
              f,
              dropPos(e, dragFolderId ?? dataId ?? null),
              dataId
            );
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
          {/* Bewust geen <button>: vanaf een button start de browser de sleep
              van de (draggable) ouder-rij niet, en dan valt er niets te sorteren. */}
          <div
            className="folder-main"
            role="button"
            tabIndex={0}
            onClick={() => void selectFolder(accountId, f.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                void selectFolder(accountId, f.id);
              }
            }}
          >
            <span className="folder-name">{f.displayName}</span>
            {!!f.unreadItemCount && <span className="badge">{f.unreadItemCount}</span>}
          </div>
          {isActiveGroup && !isSystemFolder(f) && (
            <span className="folder-actions">
              <button
                className="icon-btn"
                onClick={() => {
                  setFolderName(f.displayName ?? "");
                  setFolderDialog({ mode: "rename", folder: f });
                }}
                aria-label={t("renameFolder")}
                title={tip("renameFolder")}
              >
                <EditIcon size={14} />
              </button>
              <button
                className="icon-btn"
                onClick={() => removeFolder(f)}
                aria-label={t("deleteFolder")}
                title={tip("deleteFolder")}
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
            title={tip("newFolder")}
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
          {search !== "" && (
            <button
              type="button"
              className="search-clear"
              onClick={() => setSearch("")}
              title={tip("clearSearch")}
              aria-label={t("clearSearch")}
            >
              <CloseIcon size={16} />
            </button>
          )}
          <button
            type="button"
            className={"search-adv-toggle" + (advOpen ? " active" : "")}
            onClick={() => setAdvOpen((v) => !v)}
            title={tip("advancedSearch")}
            aria-label={t("advancedSearch")}
            aria-expanded={advOpen}
          >
            <ChevronDown size={16} />
          </button>
        </div>
        {advOpen && (
          <div className="search-adv">
            {(
              [
                ["from", t("from")],
                ["to", t("to")],
                ["cc", "CC"],
                ["subject", t("subject")],
                ["text", t("keywords")],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="adv-row">
                <span>{label}</span>
                <input
                  value={adv[key] ?? ""}
                  onChange={(e) => setAdv((p) => ({ ...p, [key]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void runAdvancedSearch();
                  }}
                />
              </label>
            ))}
            <label className="adv-row">
              <span>{t("date")}</span>
              <span className="adv-dates">
                <input
                  type="date"
                  value={adv.since ?? ""}
                  onChange={(e) => setAdv((p) => ({ ...p, since: e.target.value }))}
                />
                <input
                  type="date"
                  value={adv.until ?? ""}
                  onChange={(e) => setAdv((p) => ({ ...p, until: e.target.value }))}
                />
              </span>
            </label>
            <label className="adv-row">
              <span>{t("readState")}</span>
              <select
                value={adv.isRead == null ? "" : adv.isRead ? "read" : "unread"}
                onChange={(e) =>
                  setAdv((p) => ({
                    ...p,
                    isRead: e.target.value === "" ? null : e.target.value === "read",
                  }))
                }
              >
                <option value="">{t("all")}</option>
                <option value="read">{t("markRead")}</option>
                <option value="unread">{t("markUnread")}</option>
              </select>
            </label>
            {/* IMAP kent geen zoekcriterium voor bijlagen; dan niet aanbieden. */}
            {!isImap && (
              <label className="adv-row">
                <span>{t("attachments")}</span>
                <input
                  type="checkbox"
                  checked={adv.hasAttachments ?? false}
                  onChange={(e) =>
                    setAdv((p) => ({ ...p, hasAttachments: e.target.checked }))
                  }
                />
              </label>
            )}
            <div className="adv-buttons">
              <button className="btn primary" onClick={() => void runAdvancedSearch()}>
                {t("searchNow")}
              </button>
              <button className="btn" onClick={clearAdvancedSearch}>
                {t("clearFilters")}
              </button>
            </div>
          </div>
        )}
        {search.trim() !== "" && (
          <div className="search-scope">
            <div className="seg">
              <button
                className={"seg-btn" + (searchScope === "all" && !isImap ? " active" : "")}
                onClick={() => setSearchScope("all")}
                disabled={isImap}
                title={isImap ? tip("searchImapFolderOnly") : undefined}
              >
                {t("searchEverywhere")}
              </button>
              <button
                className={"seg-btn" + (searchScope === "folder" || isImap ? " active" : "")}
                onClick={() => setSearchScope("folder")}
              >
                {t("searchThisFolder")}
              </button>
            </div>
            {isImap && (
              <span className="muted small">{t("searchImapFolderOnly")}</span>
            )}
          </div>
        )}
        <div className="list-controls">
          <select
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value as typeof filterMode)}
            title={tip("filter")}
          >
            <option value="all">{t("filterAll")}</option>
            <option value="unread">{t("filterUnread")}</option>
            <option value="flagged">{t("filterFlagged")}</option>
          </select>
          <select
            value={sortAsc ? "asc" : "desc"}
            onChange={(e) => setSortAsc(e.target.value === "asc")}
            title={tip("sort")}
          >
            <option value="desc">{t("sortNewest")}</option>
            <option value="asc">{t("sortOldest")}</option>
          </select>
        </div>
        {offline && <div className="offline-bar">{t("offlineCache")}</div>}
        {checked.size > 0 && (
          <div className="bulk-bar">
            <span className="bulk-count">
              {checked.size} {t("selected")}
            </span>
            <button
              className="btn"
              onClick={() => setChecked(new Set(shown.map((m) => m.id)))}
              title={tip("tipSelectAll")}
            >
              {t("selectAll")}
            </button>
            {checked.size > 1 && (
              <button
                className="btn"
                onClick={() => setChecked(new Set())}
                title={tip("tipDeselectAll")}
              >
                {t("deselectAll")}
              </button>
            )}
            <button className="btn" onClick={() => bulk("read")} title={tip("tipBulkRead")}>
              {t("markRead")}
            </button>
            <button className="btn" onClick={() => bulk("unread")} title={tip("tipBulkUnread")}>
              {t("markUnread")}
            </button>
            <button className="btn" onClick={() => bulk("archive")} title={tip("tipBulkArchive")}>
              <ArchiveIcon size={16} />
            </button>
            {/* Verplaatsen gaat door de selectie naar een map te slepen. */}
            <button className="btn danger" onClick={() => bulk("delete")} title={tip("tipBulkDelete")}>
              <TrashIcon size={16} />
            </button>
            <button
              className="icon-btn"
              onClick={() => setChecked(new Set())}
              aria-label={t("clearSelection")}
              title={tip("tipClearSelection")}
            >
              <CloseIcon size={16} />
            </button>
          </div>
        )}
        <div className="list-scroll">
          {shown.length === 0 && !loading && (
            <p className="empty">{t("noMessages")}</p>
          )}
          {threads.map(({ key, items }) => {
            const isOpen = expandedThreads.has(key);
            const renderMsg = (m: Message, sub: boolean) => (
              <div
                key={m.id}
                role="button"
                tabIndex={0}
                className={
                  "msg" +
                  (sub ? " msg-sub" : "") +
                  (m.isRead ? "" : " unread") +
                  (selected?.id === m.id ? " active" : "") +
                  (checked.has(m.id) ? " checked" : "")
                }
                onClick={() => openMessage(m)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") openMessage(m);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu({
                    x: Math.min(e.clientX, window.innerWidth - 200),
                    y: Math.min(e.clientY, window.innerHeight - 220),
                    msg: m,
                  });
                }}
                draggable
                onDragStart={(e) => {
                  // Aangevinkte selectie sleept mee als het bericht erin zit.
                  const ids = checked.has(m.id) ? [...checked] : [m.id];
                  setDragMsgIds(ids);
                  e.dataTransfer.setData("application/x-bemail-message", ids.join("\n"));
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  setDragMsgIds(null);
                  setDropHint(null);
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
                {settings.listShowAvatar && (
                  <Avatar
                    name={senderName(m.from?.emailAddress)}
                    address={senderAddress(m.from?.emailAddress)}
                    size={30}
                  />
                )}
                <div className="msg-main">
                  <div className="msg-top">
                    <span className="msg-from">
                      {settings.listShowName && senderName(m.from?.emailAddress)}
                      {settings.listShowEmail && (
                        <span className="msg-from-email">
                          {settings.listShowName
                            ? ` <${senderAddress(m.from?.emailAddress)}>`
                            : senderAddress(m.from?.emailAddress)}
                        </span>
                      )}
                    </span>
                    {!sub && items.length > 1 && (
                      <button
                        className="thread-chip"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleThread(key);
                        }}
                        title={`${items.length}`}
                      >
                        {isOpen ? (
                          <ChevronDown size={12} />
                        ) : (
                          <ChevronRight size={12} />
                        )}
                        {items.length}
                      </button>
                    )}
                    {(m.categories ?? []).length > 0 && (
                      <span className="msg-cats">
                        {(m.categories ?? []).slice(0, 3).map((c) => (
                          <span
                            key={c}
                            className="cat-dot"
                            style={{ background: catColor(c) }}
                            title={c}
                          />
                        ))}
                      </span>
                    )}
                    <span className="msg-date">{shortDate(m.receivedDateTime, settings.lang)}</span>
                  </div>
                  {(settings.listShowSubject ||
                    m.flag?.flagStatus === "flagged" ||
                    m.importance === "high" ||
                    m.hasAttachments ||
                    snoozeOf.has(m.id)) && (
                    <div className="msg-subject">
                      {m.flag?.flagStatus === "flagged" && <span className="flagdot">⚑</span>}
                      {m.importance === "high" && <span className="hi">!</span>}
                      {/* Eigen span: als losse tekst in een flexrij kapt het
                          onderwerp niet af maar duwt het de paperclip en de
                          uitstel-tijd het beeld uit. */}
                      {settings.listShowSubject && (
                        <span className="msg-subject-text">
                          {m.subject || "(geen onderwerp)"}
                        </span>
                      )}
                      {m.hasAttachments && <PaperclipIcon size={14} style={{ flexShrink: 0 }} />}
                      {/* Uitgesteld bericht: laat zien wanneer het terugkomt,
                          anders is de Uitgesteld-map een zwart gat. Op deze
                          regel, want de hover-acties dekken de bovenste af. */}
                      {snoozeOf.has(m.id) && (
                        <span
                          className="msg-snooze"
                          title={`${t("snoozedUntil")} ${longDateTime(
                            snoozeOf.get(m.id)!.due,
                            settings.lang
                          )}`}
                        >
                          <ClockIcon size={12} />
                          {shortDate(snoozeOf.get(m.id)!.due, settings.lang)}
                        </span>
                      )}
                    </div>
                  )}
                  {settings.listShowPreview && (
                    <div className="msg-preview">{m.bodyPreview}</div>
                  )}
                </div>
                {/* Contextacties bij hover (en bij toetsenbordfocus), zoals
                    Outlook. stopPropagation: een klik hierop mag het bericht
                    niet openen. */}
                <div className="msg-actions">
                  {[
                    // In Archief zelf kan archiveren niets doen; dan geen knop.
                    ...(inArchiveFolder
                      ? []
                      : [
                          {
                            key: "archive",
                            label: t("archive"),
                            hint: tip("tipArchive"),
                            icon: <ArchiveIcon size={16} />,
                            on: false,
                            run: () => void archive(m),
                          },
                        ]),
                    {
                      key: "read",
                      label: m.isRead ? t("markUnread") : t("markRead"),
                      hint: tip("tipRead"),
                      icon: m.isRead ? <MailIcon size={16} /> : <MailOpenIcon size={16} />,
                      on: false,
                      run: () => void toggleRead(m),
                    },
                    {
                      // Schakelknop: laat zien of het bericht al een vlag heeft,
                      // anders is een tweede klik een gok.
                      key: "flag",
                      label: m.flag?.flagStatus === "flagged" ? t("unflag") : t("flag"),
                      hint: tip("tipFlag"),
                      icon: <FlagIcon size={16} />,
                      on: m.flag?.flagStatus === "flagged",
                      run: () => void toggleFlag(m),
                    },
                    {
                      key: "delete",
                      label: t("delete"),
                      hint: tip("tipDelete"),
                      icon: <TrashIcon size={16} />,
                      on: false,
                      run: () => void remove(m),
                    },
                  ].map((a) => (
                    <button
                      key={a.key}
                      className={
                        "icon-btn" + (a.key === "delete" ? " danger" : "") + (a.on ? " on" : "")
                      }
                      // hint volgt de tooltip-instelling; het label is er altijd
                      // voor schermlezers.
                      title={a.hint}
                      aria-label={a.label}
                      aria-pressed={a.key === "flag" ? a.on : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        a.run();
                      }}
                    >
                      {a.icon}
                    </button>
                  ))}
                </div>
              </div>
            );
            return (
              <div key={key}>
                {renderMsg(items[0], false)}
                {isOpen && items.slice(1).map((m) => renderMsg(m, true))}
              </div>
            );
          })}
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
          <button
            className="btn primary"
            onClick={() => setCompose({})}
            title={tip("tipCompose")}
          >
            <ComposeIcon size={18} /> {t("compose")}
          </button>
          {selected && (
            <>
              <button
                className="btn"
                onClick={() => setCompose(buildReply(selected, false))}
                title={tip("tipReply")}
              >
                <ReplyIcon size={18} /> {t("reply")}
              </button>
              <button
                className="btn"
                onClick={() => setCompose(buildReply(selected, true))}
                title={tip("tipReplyAll")}
              >
                <ReplyAllIcon size={18} /> {t("replyAll")}
              </button>
              <button
                className="btn"
                onClick={() => setCompose(buildForward(selected))}
                title={tip("tipForward")}
              >
                <ForwardIcon size={18} /> {t("forward")}
              </button>
              <button
                className="btn"
                onClick={async () => {
                  // Maakt een opdracht-kaart van deze mail (alleen lezen —
                  // er wordt nooit iets verstuurd).
                  try {
                    const detail = await opdrachtenApi.opdrachtVanMail(
                      senderName(selected.from?.emailAddress),
                      senderAddress(selected.from?.emailAddress),
                      selected.subject ?? "",
                    );
                    notify(t("opdrachtAangemaakt"));
                    onOpdrachtAangemaakt?.(detail.aanvraag.id);
                  } catch (e) {
                    notify(String(e), "error");
                  }
                }}
                title={tip("maakOpdracht")}
              >
                <OpdrachtenIcon size={18} /> {t("maakOpdracht")}
              </button>
              {/* Eigen snelle acties (Instellingen -> Snelle acties). Een actie
                  zonder gekozen map/categorie is nog niet af en krijgt geen
                  knop; anders staat er een naamloze knop die alleen een fout
                  kan geven. */}
              {settings.quickActions
                .filter(
                  (qa) => qa.target.trim() !== "" && !(isImap && qa.kind === "category")
                )
                .map((qa) => {
                  // Categorie-acties schakelen, dus laat zien of het bericht de
                  // categorie al heeft - in de kleur van de categorie zelf.
                  const on =
                    qa.kind === "category" &&
                    (selected.categories ?? []).includes(qa.target);
                  return (
                    <button
                      key={qa.id}
                      className={"btn quick-action" + (on ? " on" : "")}
                      onClick={() => void runQuickAction(selected, qa)}
                      aria-pressed={qa.kind === "category" ? on : undefined}
                      title={
                        qa.kind === "move"
                          ? `${t("moveTo")}: ${qa.target}`
                          : `${t(on ? "categoryRemove" : "categoryAdd")}: ${qa.target}`
                      }
                    >
                      {qa.kind === "move" ? (
                        <FolderIcon size={18} />
                      ) : (
                        <span
                          className="qa-dot"
                          style={{ background: catColor(qa.target) }}
                        />
                      )}
                      <span className="qa-label">{qa.target}</span>
                    </button>
                  );
                })}
              {settings.aiSkills.length > 0 && (
                <select
                  className="ai-reply"
                  value=""
                  disabled={aiBusy}
                  onChange={(e) => {
                    const skill = settings.aiSkills.find(
                      (s) => s.id === e.target.value
                    );
                    if (skill) void aiReply(selected, skill);
                  }}
                  title={tip("tipAiReply")}
                >
                  <option value="">{aiBusy ? `✨ ${t("aiGenerating")}` : "✨"}</option>
                  {settings.aiSkills.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
              <span className="spacer" />
              {unsubscribeTarget(selected) && (
                <button
                  className="btn"
                  onClick={() => unsubscribe(selected)}
                  title={tip("tipUnsubscribe")}
                >
                  {t("unsubscribe")}
                </button>
              )}
              <button
                className="btn"
                onClick={() => reportJunk(selected)}
                title={tip("tipSpam")}
              >
                <SpamIcon size={18} />
              </button>
              {!isImap && (
                <button
                  className="btn"
                  onClick={() => blockSender(selected)}
                  title={tip("tipBlock")}
                >
                  <BanIcon size={18} />
                </button>
              )}
              <button className="btn" onClick={() => toggleFlag(selected)} title={tip("tipFlag")}>
                <FlagIcon size={18} />
              </button>
              <button
                className="btn"
                onClick={() => toggleRead(selected)}
                title={tip("tipRead")}
              >
                {selected.isRead ? <MailIcon size={18} /> : <MailOpenIcon size={18} />}
              </button>
              <button
                className="btn"
                onClick={() => void downloadMessage(selected)}
                disabled={downloading === selected.id}
                title={tip("tipDownloadMessage")}
                aria-label={t("downloadMessage")}
              >
                <DownloadIcon size={18} />
              </button>
              <span className="snooze-wrap" ref={snoozeRef}>
                <button
                  className={"btn snooze-btn" + (snoozeOf.has(selected.id) ? " on" : "")}
                  aria-pressed={snoozeOf.has(selected.id)}
                  onClick={() => {
                    setSnoozeOpen((v) => {
                      // Bij openen het veld vast vullen: zo is de eigen keuze
                      // een aanpassing i.p.v. een leeg formulier.
                      if (!v) {
                        const cur = snoozeOf.get(selected.id);
                        setSnoozeAt(
                          toDateTimeInput(cur ? new Date(cur.due) : tomorrowMorning())
                        );
                      }
                      return !v;
                    });
                  }}
                  title={
                    snoozeOf.has(selected.id)
                      ? `${t("snoozedUntil")} ${longDateTime(
                          snoozeOf.get(selected.id)!.due,
                          settings.lang
                        )}`
                      : tip("tipSnooze")
                  }
                  aria-label={t("snooze")}
                >
                  <ClockIcon size={18} />
                </button>
                {snoozeOpen && (
                  <div className="snooze-menu">
                    {snoozeOf.has(selected.id) && (
                      <div className="snooze-due">
                        {t("snoozedUntil")}{" "}
                        <strong>
                          {longDateTime(snoozeOf.get(selected.id)!.due, settings.lang)}
                        </strong>
                      </div>
                    )}
                    {/* "Later vandaag" is drie uur verder; na 21:00 valt dat op
                        morgen en zou de knop iets anders beloven dan hij doet. */}
                    {isSameDay(laterToday(), new Date()) && (
                      <button
                        className="suggest-item"
                        onClick={() => void snooze(selected, laterToday())}
                      >
                        {t("laterToday")}
                      </button>
                    )}
                    <button
                      className="suggest-item"
                      onClick={() => void snooze(selected, tomorrowMorning())}
                    >
                      {t("tomorrowMorning")}
                    </button>
                    <button
                      className="suggest-item"
                      onClick={() => void snooze(selected, nextMondayMorning())}
                    >
                      {t("nextWeekMorning")}
                    </button>
                    <div className="snooze-custom">
                      <input
                        type="datetime-local"
                        value={snoozeAt}
                        min={toDateTimeInput(new Date())}
                        onChange={(e) => setSnoozeAt(e.target.value)}
                      />
                      <button
                        className="btn"
                        onClick={() => {
                          const d = new Date(snoozeAt);
                          if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) {
                            void snooze(selected, d);
                          } else {
                            notify(t("laterInvalid"), "error");
                          }
                        }}
                      >
                        {t("ok")}
                      </button>
                    </div>
                    {snoozeOf.has(selected.id) && (
                      <button
                        className="suggest-item"
                        onClick={() => void unsnooze(selected)}
                      >
                        {t("unsnooze")}
                      </button>
                    )}
                  </div>
                )}
              </span>
              {/* Verplaatsen gaat door het bericht naar een map te slepen. */}
              <button className="btn danger" onClick={() => remove(selected)} title={tip("tipDelete")}>
                <TrashIcon size={18} />
              </button>
            </>
          )}
        </div>
        {!selected ? (
          <div className="reader-empty">{t("selectMessage")}</div>
        ) : (
          <div className="thread">
            {/* Elk bericht uit de conversatie is een eigen kaart. Alleen het
                geopende bericht toont de volledige inhoud; de rest staat
                ingeklapt op volgorde van tijd (Outlook-stijl). */}
            {convo.map((cm) =>
              cm.id !== selected.id ? (
                <button
                  key={cm.id}
                  className={"thread-card collapsed" + (cm.isRead ? "" : " unread")}
                  onClick={() => openMessage(cm)}
                >
                  <Avatar
                    name={senderName(cm.from?.emailAddress)}
                    address={senderAddress(cm.from?.emailAddress)}
                    size={28}
                  />
                  <span className="tc-main">
                    <span className="tc-top">
                      <span className="tc-from">{senderName(cm.from?.emailAddress)}</span>
                      <span className="tc-date">
                        {shortDate(cm.receivedDateTime, settings.lang)}
                      </span>
                    </span>
                    <span className="tc-preview">{cm.bodyPreview}</span>
                  </span>
                </button>
              ) : (
                <article key={cm.id} className="thread-card open">
            <div className="reader-head">
              <h2>{selected.subject || "(geen onderwerp)"}</h2>
              <div className="reader-meta">
                <Avatar
                  name={senderName(selected.from?.emailAddress)}
                  address={senderAddress(selected.from?.emailAddress)}
                  size={40}
                />
                <div className="reader-meta-main">
                  <strong>{senderName(selected.from?.emailAddress)}</strong>{" "}
                  <span className="muted">
                    &lt;{senderAddress(selected.from?.emailAddress)}&gt;
                  </span>
                  <div className="muted small">
                    {longDateTime(selected.receivedDateTime, settings.lang)}
                  </div>
                  {!isImap && (selected.categories ?? []).length > 0 && (
                    <div className="cat-row">
                      {(selected.categories ?? []).map((c) => (
                        <span
                          key={c}
                          className="cat-chip"
                          style={{ background: catColor(c) }}
                        >
                          {c}
                          <button
                            className="cat-x"
                            onClick={() => void toggleCategory(selected, c)}
                            aria-label={t("delete")}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {isExternal(selected, account) && (
                    <div className="warn">{t("externalSender")}</div>
                  )}
                </div>
                {/* Rechts uitgelijnd op de afzenderregel. */}
                {!isImap && masterCats.length > 0 && (
                  <select
                    className="cat-add"
                    value=""
                    onChange={(e) => {
                      if (e.target.value)
                        void toggleCategory(selected, e.target.value);
                    }}
                    title={tip("category")}
                  >
                    <option value="">{t("category")}…</option>
                    {masterCats
                      .filter(
                        (c) =>
                          !(selected.categories ?? []).includes(
                            c.displayName ?? ""
                          )
                      )
                      .map((c) => (
                        <option key={c.id} value={c.displayName ?? ""}>
                          {c.displayName}
                        </option>
                      ))}
                  </select>
                )}
              </div>
            </div>
            {!isImap && selected.odataType?.includes("eventMessageRequest") && (
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
                <button className="btn ghost" onClick={showExternalImages}>
                  {t("showImages")}
                </button>
              </div>
            )}
            {loadingImages && <div className="images-bar">{t("loadingImages")}</div>}
            <div
              className="reader-body"
              onClick={onBodyClick}
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
                </article>
              )
            )}
          </div>
        )}
          </>
        )}
      </section>

      {ctxMenu && (
        <div
          className="ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          role="menu"
          // mousedown sluit het menu globaal; hier tegenhouden zodat de
          // klik op een menu-item nog aankomt.
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="suggest-item"
            onClick={() => {
              void reportJunk(ctxMenu.msg);
              setCtxMenu(null);
            }}
          >
            {t("reportJunk")}
          </button>
          {!isImap && (
            <button
              className="suggest-item"
              onClick={() => {
                void blockSender(ctxMenu.msg);
                setCtxMenu(null);
              }}
            >
              {t("blockSender")}
            </button>
          )}
          <button
            className="suggest-item"
            onClick={() => {
              void toggleRead(ctxMenu.msg);
              setCtxMenu(null);
            }}
          >
            {ctxMenu.msg.isRead ? t("markUnread") : t("markRead")}
          </button>
          {!inArchiveFolder && (
            <button
              className="suggest-item"
              onClick={() => {
                void archive(ctxMenu.msg);
                setCtxMenu(null);
              }}
            >
              {t("archive")}
            </button>
          )}
          <button
            className="suggest-item"
            onClick={() => {
              void remove(ctxMenu.msg);
              setCtxMenu(null);
            }}
          >
            {t("delete")}
          </button>
        </div>
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
