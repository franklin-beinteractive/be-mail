// Task list ("Taken"): types, the Tauri commands, one shared in-memory copy
// of the data for every view, the quick-add parser and the project
// suggestion for a task made from a mail.

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export type TaskStatus = "todo" | "doing" | "done";
export const STATUSES: TaskStatus[] = ["todo", "doing", "done"];

export interface Project {
  id: number;
  name: string;
  color: string;
  archived: boolean;
  sort: number;
}

export interface TodoAction {
  id: number;
  label: string;
  /** The ball is with someone else: the task shows up under "Wachten". */
  waiting: boolean;
  color: string;
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
  status: TaskStatus;
  actionId: number | null;
  /** YYYY-MM-DD: the day to look at the task again. */
  followUp: string | null;
  note: string;
  mail: MailLink | null;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
}

export type TaskInput = Omit<Task, "id" | "createdAt" | "updatedAt" | "doneAt"> & {
  id?: number;
};

export interface TodoData {
  projects: Project[];
  actions: TodoAction[];
  tasks: Task[];
}

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

/** A change to a task: fixed values, or computed from the stored task (for
 *  "next status", so two quick clicks really step twice). */
export type TaskPatch = Partial<TaskInput> | ((current: Task) => Partial<TaskInput>);

// Saves per task run one after the other, each on top of the freshly
// reloaded task. Otherwise a blur that saves the note and a click on a
// status right after it both send the whole task, and the second one -
// still holding the old note - overwrites the first.
const taskQueues = new Map<number, Promise<unknown>>();

function patchTask(id: number, patch: TaskPatch): Promise<Task> {
  const prev = taskQueues.get(id) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      await ensureLoaded();
      const current = cache?.tasks.find((x) => x.id === id);
      if (!current) throw new Error("Deze taak bestaat niet meer.");
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

export const todoApi = {
  saveTask: (task: TaskInput) => mutate<Task>("todo_save_task", { task }),
  patchTask,
  deleteTask: (id: number) => mutate<void>("todo_delete_task", { id }),
  saveProject: (project: Partial<Project> & { name: string }) =>
    mutate<Project>("todo_save_project", { project }),
  deleteProject: (id: number) => mutate<void>("todo_delete_project", { id }),
  saveAction: (action: Partial<TodoAction> & { label: string }) =>
    mutate<TodoAction>("todo_save_action", { action }),
  deleteAction: (id: number) => mutate<void>("todo_delete_action", { id }),
  reorder: (kind: "project" | "action", ids: number[]) =>
    mutate<void>("todo_reorder", { kind, ids }),
};

/** Task as input for saving, with some fields replaced. */
export function withChanges(t: Task, patch: Partial<TaskInput>): TaskInput {
  const { createdAt: _c, updatedAt: _u, doneAt: _d, ...rest } = t;
  return { ...rest, ...patch };
}

export function nextStatus(s: TaskStatus): TaskStatus {
  return s === "todo" ? "doing" : s === "doing" ? "done" : "todo";
}

/** Ids of archived projects: their tasks leave the cross-project lists. */
export function archivedProjectIds(data: TodoData | null): Set<number> {
  return new Set((data?.projects ?? []).filter((p) => p.archived).map((p) => p.id));
}

/** Open tasks outside archived projects whose follow-up day has come. */
export function dueCount(data: TodoData | null, today: string): number {
  const archived = archivedProjectIds(data);
  return (data?.tasks ?? []).filter(
    (x) =>
      x.status !== "done" &&
      x.followUp != null &&
      x.followUp <= today &&
      (x.projectId == null || !archived.has(x.projectId))
  ).length;
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

const WEEKDAYS: Record<string, number> = {
  zo: 0, zondag: 0, sun: 0, sunday: 0,
  ma: 1, maandag: 1, mon: 1, monday: 1,
  di: 2, dinsdag: 2, tue: 2, tuesday: 2,
  wo: 3, woensdag: 3, wed: 3, wednesday: 3,
  do: 4, donderdag: 4, thu: 4, thursday: 4,
  vr: 5, vrijdag: 5, fri: 5, friday: 5,
  za: 6, zaterdag: 6, sat: 6, saturday: 6,
};

/** A typed date word ("morgen", "vr", "28-11") as YYYY-MM-DD, or null. */
export function parseDateWord(word: string, today = new Date()): string | null {
  const w = word.toLowerCase();
  if (w === "vandaag" || w === "today") return isoDate(today);
  if (w === "morgen" || w === "tomorrow") return isoDate(addDays(today, 1));
  if (w === "overmorgen") return isoDate(addDays(today, 2));
  if (w in WEEKDAYS) {
    // The coming one; on that weekday itself, the one a week later.
    const diff = (WEEKDAYS[w] - today.getDay() + 7) % 7 || 7;
    return isoDate(addDays(today, diff));
  }
  const m = /^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2}|\d{4}))?$/.exec(w);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year = m[3] ? Number(m[3]) : today.getFullYear();
    if (year < 100) year += 2000;
    const d = new Date(year, month - 1, day);
    if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    // Without a year, a date that has passed means next year.
    if (!m[3] && isoDate(d) < isoDate(today)) d.setFullYear(year + 1);
    return isoDate(d);
  }
  return null;
}

// ---- Quick add: "DNS checken #klant-x !live vr" ----

/** Lowercase without spaces, dashes and underscores, for loose matching. */
export function norm(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, "");
}

export interface ParsedQuickAdd {
  title: string;
  projectId: number | null;
  /** `#name` that matches no project: created on save. */
  newProject: string | null;
  actionId: number | null;
  followUp: string | null;
}

function findProject(token: string, projects: Project[]): Project | undefined {
  const n = norm(token);
  if (!n) return undefined;
  const open = projects.filter((p) => !p.archived);
  return (
    open.find((p) => norm(p.name) === n) ??
    open.find((p) => norm(p.name).startsWith(n)) ??
    projects.find((p) => norm(p.name) === n)
  );
}

function findAction(token: string, actions: TodoAction[]): TodoAction | undefined {
  const n = norm(token);
  if (!n) return undefined;
  return (
    actions.find((a) => norm(a.label) === n) ??
    actions.find((a) => norm(a.label).startsWith(n)) ??
    actions.find((a) => norm(a.label).includes(n))
  );
}

/** Splits one typed line into title, project (#), action (!) and a closing
 *  date word. Only the title is required; unknown `!words` stay in it. */
export function parseQuickAdd(
  input: string,
  projects: Project[],
  actions: TodoAction[],
  today = new Date()
): ParsedQuickAdd {
  const out: ParsedQuickAdd = {
    title: "",
    projectId: null,
    newProject: null,
    actionId: null,
    followUp: null,
  };
  const words: string[] = [];
  for (const tok of input.trim().split(/\s+/).filter(Boolean)) {
    if (tok.length > 1 && tok.startsWith("#")) {
      const p = findProject(tok.slice(1), projects);
      if (p) {
        out.projectId = p.id;
        out.newProject = null;
      } else {
        out.projectId = null;
        out.newProject = tok.slice(1).replace(/_/g, " ");
      }
      continue;
    }
    if (tok.length > 1 && tok.startsWith("!")) {
      const a = findAction(tok.slice(1), actions);
      if (a) {
        out.actionId = a.id;
        continue;
      }
    }
    words.push(tok);
  }
  // A date only counts as the last word, so "di" or "do" inside a sentence
  // stays text; it never eats the whole title.
  if (words.length > 1) {
    const d = parseDateWord(words[words.length - 1], today);
    if (d) {
      out.followUp = d;
      words.pop();
    }
  }
  out.title = words.join(" ");
  return out;
}

// ---- Project suggestion for a task made from a mail ----

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
 *  of the latest task from the same domain, else a project named after the
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

/** Palette offered for projects and actions. */
export const COLORS = [
  "#0f6cbd", "#8764b8", "#ca5010", "#498205", "#c19c00",
  "#d13438", "#038387", "#5c2e91", "#69797e", "#e3008c",
];
