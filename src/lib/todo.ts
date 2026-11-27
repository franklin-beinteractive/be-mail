// Task board ("Taken"): types, the Tauri commands, one shared in-memory copy
// of the data for every view, card attachments and the project suggestion
// for a card made from a mail.

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export interface Project {
  id: number;
  name: string;
  color: string;
  archived: boolean;
  sort: number;
}

/** A board column ("Te doen", "Bezig", ...), shared by every project. */
export interface Column {
  id: number;
  name: string;
  color: string;
  /** Cards here count as finished: no follow-up badge, done date set. */
  done: boolean;
  sort: number;
}

export interface MailLink {
  accountId: string;
  messageId: string;
  conversationId?: string | null;
  subject: string;
  from: string;
  address: string;
}

export interface Task {
  id: number;
  title: string;
  projectId: number | null;
  columnId: number;
  /** Card colour: "" or #rrggbb. */
  color: string;
  /** Position within the column. */
  sort: number;
  /** YYYY-MM-DD: the day to look at the card again. */
  followUp: string | null;
  /** The card description. */
  note: string;
  mail: MailLink | null;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
  /** Set when the card was archived by hand ("Archiveren"). */
  archivedAt: string | null;
}

export interface TaskInput {
  id?: number;
  title: string;
  projectId: number | null;
  /** null = the first column. */
  columnId?: number | null;
  color?: string;
  /** null = keep the position (or the end of a new column). */
  sort?: number | null;
  followUp?: string | null;
  note?: string;
  mail?: MailLink | null;
}

export interface Attachment {
  id: number;
  taskId: number;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
}

export interface TodoData {
  projects: Project[];
  columns: Column[];
  tasks: Task[];
  attachments: Attachment[];
}

/** Largest attachment the Rust core accepts. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

// ---- Shared store: one copy, reloaded after every change ----

let cache: TodoData | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

async function reload(): Promise<void> {
  cache = await invoke<TodoData>("todo_load");
  listeners.forEach((l) => l());
}

function ensureLoaded(): Promise<void> {
  if (!loading) loading = reload().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** The task data, shared by every component; null until the first load. */
export function useTodo(): TodoData | null {
  const [data, setData] = useState<TodoData | null>(cache);
  useEffect(() => {
    const l = () => setData(cache);
    listeners.add(l);
    ensureLoaded().then(l, () => {});
    return () => {
      listeners.delete(l);
    };
  }, []);
  return data;
}

/** Runs a command and then refreshes every view. */
async function mutate<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const result = await invoke<T>(cmd, args);
  await reload();
  return result;
}

/** A change to a card: fixed values, or computed from the stored card. */
export type TaskPatch = Partial<TaskInput> | ((current: Task) => Partial<TaskInput>);

// Saves per card run one after the other, each on top of the freshly
// reloaded card. Otherwise a blur that saves the description and a drag
// right after it both send the whole card, and the second one - still
// holding the old description - overwrites the first.
const taskQueues = new Map<number, Promise<unknown>>();

function patchTask(id: number, patch: TaskPatch): Promise<Task> {
  const prev = taskQueues.get(id) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      await ensureLoaded();
      const current = cache?.tasks.find((x) => x.id === id);
      if (!current) throw new Error("Deze kaart bestaat niet meer.");
      const changes = typeof patch === "function" ? patch(current) : patch;
      return mutate<Task>("todo_save_task", { task: withChanges(current, changes) });
    });
  taskQueues.set(id, next);
  void next
    .finally(() => {
      if (taskQueues.get(id) === next) taskQueues.delete(id);
    })
    .catch(() => {});
  return next;
}

/** Card as input for saving, with some fields replaced. */
export function withChanges(t: Task, patch: Partial<TaskInput>): TaskInput {
  const { createdAt: _c, updatedAt: _u, doneAt: _d, archivedAt: _a, ...rest } = t;
  return { ...rest, ...patch };
}

// ---- Attachments ----

// Object URLs per attachment, so a cover image is fetched once per session.
const blobUrls = new Map<number, Promise<string>>();

async function addAttachment(taskId: number, file: Blob, name: string): Promise<Attachment> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const meta = await invoke<Attachment>("todo_add_attachment", bytes, {
    headers: {
      "x-task-id": String(taskId),
      "x-name": encodeURIComponent(name),
      "x-mime": file.type || "",
    },
  });
  await reload();
  return meta;
}

/** Object URL with the attachment's bytes, for <img> and the lightbox. */
export function attachmentUrl(a: Attachment): Promise<string> {
  let p = blobUrls.get(a.id);
  if (!p) {
    p = invoke<ArrayBuffer>("todo_attachment_data", { id: a.id }).then((buf) =>
      URL.createObjectURL(new Blob([buf], { type: a.mime || "application/octet-stream" }))
    );
    p.catch(() => blobUrls.delete(a.id));
    blobUrls.set(a.id, p);
  }
  return p;
}

/** Object URL of an attachment once loaded; null before that or without one. */
export function useAttachmentUrl(a: Attachment | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const id = a?.id;
  useEffect(() => {
    setUrl(null);
    if (!a) return;
    let live = true;
    attachmentUrl(a).then((u) => live && setUrl(u), () => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return url;
}

export function isImage(a: Attachment): boolean {
  return /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(a.mime);
}

/** Releases the cached object URL of an attachment that no longer exists. */
function forgetBlob(attachmentId: number) {
  const url = blobUrls.get(attachmentId);
  blobUrls.delete(attachmentId);
  url?.then(URL.revokeObjectURL, () => {});
}

/** Deletes cards and releases the object URLs of their attachments, which
 *  would otherwise keep the image bytes in memory for the whole session. */
async function deleteTasks(ids: number[]): Promise<void> {
  const gone = new Set(ids);
  const attachments = (cache?.attachments ?? []).filter((a) => gone.has(a.taskId)).map((a) => a.id);
  if (ids.length === 1) await mutate<void>("todo_delete_task", { id: ids[0] });
  else await mutate<void>("todo_delete_tasks", { ids });
  attachments.forEach(forgetBlob);
}

export const todoApi = {
  saveTask: (task: TaskInput) => mutate<Task>("todo_save_task", { task }),
  patchTask,
  deleteTask: (id: number) => deleteTasks([id]),
  /** Deletes several cards at once, all or none (emptying the archive). */
  deleteTasks,
  archiveTask: (id: number, archived: boolean) => mutate<Task>("todo_archive_task", { id, archived }),
  restoreTask,
  saveProject: (project: Partial<Project> & { name: string }) =>
    mutate<Project>("todo_save_project", { project }),
  deleteProject: (id: number) => mutate<void>("todo_delete_project", { id }),
  saveColumn: (column: Partial<Column> & { name: string }) =>
    mutate<Column>("todo_save_column", { column }),
  /** A column with cards needs `moveTo`: the column its cards go to. */
  deleteColumn: (id: number, moveTo?: number | null) =>
    mutate<void>("todo_delete_column", { id, moveTo: moveTo ?? null }),
  reorder: (kind: "project" | "column", ids: number[]) =>
    mutate<void>("todo_reorder", { kind, ids }),
  addAttachment,
  deleteAttachment: async (id: number) => {
    await mutate<void>("todo_delete_attachment", { id });
    forgetBlob(id);
  },
  openAttachment: (id: number) => invoke<void>("todo_open_attachment", { id }),
  saveAttachment: (id: number) => invoke<string>("todo_save_attachment", { id }),
};

/** Ids of the columns whose cards count as finished. */
export function doneColumnIds(data: TodoData | null): Set<number> {
  return new Set((data?.columns ?? []).filter((c) => c.done).map((c) => c.id));
}

/** Ids of archived projects: their cards leave the cross-project board. */
export function archivedProjectIds(data: TodoData | null): Set<number> {
  return new Set((data?.projects ?? []).filter((p) => p.archived).map((p) => p.id));
}

/** Days a card stays in a done column before it moves to the archive. */
export const ARCHIVE_AFTER_DAYS = 2;

/** Cards finished on or before this day (YYYY-MM-DD) are in the archive. */
export function archiveCutoff(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  return isoDate(addDays(new Date(y, m - 1, d), -ARCHIVE_AFTER_DAYS));
}

/** Finished long enough ago: in a done column since `ARCHIVE_AFTER_DAYS`
 *  days or more. Moving the card to another column clears its done date. */
function doneLongAgo(task: Task, done: Set<number>, cutoff: string): boolean {
  return done.has(task.columnId) && task.doneAt != null && task.doneAt.slice(0, 10) <= cutoff;
}

/** In the archive: archived by hand, or finished long enough ago. */
export function isArchived(task: Task, done: Set<number>, cutoff: string): boolean {
  return task.archivedAt != null || doneLongAgo(task, done, cutoff);
}

/** Back on the board: clears the hand-made archive mark, and a card that
 *  would still be archived for being finished long ago moves to the first
 *  column that does not count as done. Returns that column, if it moved. */
async function restoreTask(task: Task, data: TodoData, today: string): Promise<Column | null> {
  if (task.archivedAt != null) await todoApi.archiveTask(task.id, false);
  if (!doneLongAgo(task, doneColumnIds(data), archiveCutoff(today))) return null;
  const back = data.columns.find((c) => !c.done);
  if (!back) return null;
  await todoApi.patchTask(task.id, { columnId: back.id, sort: null });
  return back;
}

/** Whether a card asks for action: unfinished and its follow-up day has come. */
export function isDue(task: Task, today: string, done: Set<number>): boolean {
  return !done.has(task.columnId) && task.followUp != null && task.followUp <= today;
}

/** Unfinished, unarchived cards outside archived projects whose follow-up day has come,
 *  the oldest date first. */
export function dueTasks(data: TodoData | null, today: string): Task[] {
  const archived = archivedProjectIds(data);
  const done = doneColumnIds(data);
  return (data?.tasks ?? [])
    .filter(
      (x) =>
        isDue(x, today, done) &&
        x.archivedAt == null &&
        (x.projectId == null || !archived.has(x.projectId))
    )
    .sort((a, b) => a.followUp!.localeCompare(b.followUp!) || a.sort - b.sort || a.id - b.id);
}

/** Today as YYYY-MM-DD that moves on past midnight while the app stays open
 *  (checked every minute and when the window gets focus). */
export function useToday(): string {
  const [today, setToday] = useState(() => isoDate(new Date()));
  useEffect(() => {
    const tick = () => setToday(isoDate(new Date()));
    const timer = window.setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, []);
  return today;
}

// ---- Dates ----

/** Local date as YYYY-MM-DD. */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

/** "vr 28 nov" style label for a YYYY-MM-DD date. */
export function formatDay(iso: string, lang: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString(lang === "en" ? "en-GB" : "nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** "1,2 MB" style size. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** Lowercase without spaces, dashes and underscores, for loose matching. */
export function norm(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, "");
}

// ---- Project suggestion for a card made from a mail ----

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.nl", "outlook.com",
  "outlook.nl", "live.com", "live.nl", "msn.com", "icloud.com", "me.com",
  "yahoo.com", "ziggo.nl", "kpnmail.nl", "kpnplanet.nl", "planet.nl",
  "home.nl", "xs4all.nl", "telfort.nl", "casema.nl", "chello.nl",
  "upcmail.nl", "proton.me", "protonmail.com",
]);

export function domainOf(address: string): string {
  return (address.split("@")[1] ?? "").trim().toLowerCase();
}

export type ProjectSuggestion =
  | { projectId: number }
  | { newName: string }
  | null;

/** The project a mail from `address` most likely belongs to: the project
 *  of the latest card from the same domain, else a project named after the
 *  domain. Free-mail domains and your own domains give no suggestion. */
export function suggestProject(
  address: string,
  data: TodoData,
  ownDomains: string[]
): ProjectSuggestion {
  const domain = domainOf(address);
  if (!domain || FREE_MAIL.has(domain) || ownDomains.includes(domain)) return null;
  const open = new Map(
    data.projects.filter((p) => !p.archived).map((p) => [p.id, p])
  );
  const earlier = data.tasks
    .filter(
      (t) =>
        t.projectId != null &&
        open.has(t.projectId) &&
        t.mail &&
        domainOf(t.mail.address) === domain
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (earlier?.projectId != null) return { projectId: earlier.projectId };

  const parts = domain.split(".");
  parts.pop();
  if (parts.length > 1 && ["co", "com", "org", "net", "ac", "gov"].includes(parts[parts.length - 1])) {
    parts.pop();
  }
  const base = parts[parts.length - 1];
  if (!base) return null;
  const match = [...open.values()].find((p) => norm(p.name) === norm(base));
  if (match) return { projectId: match.id };
  return { newName: base.charAt(0).toUpperCase() + base.slice(1) };
}

/** Palette offered for projects, columns and cards. */
export const COLORS = [
  "#0f6cbd", "#8764b8", "#ca5010", "#498205", "#c19c00",
  "#d13438", "#038387", "#5c2e91", "#69797e", "#e3008c",
];
