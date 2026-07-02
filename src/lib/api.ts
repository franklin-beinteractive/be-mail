// Dunne wrappers rond de Tauri-commands. Alle communicatie met Office 365
// loopt via de Rust-kern; hier roepen we die alleen aan.

import { invoke } from "@tauri-apps/api/core";
import type {
  Account,
  AppConfig,
  CalendarEvent,
  ComposeInput,
  EventInput,
  MailFolder,
  Message,
  MessagesPage,
} from "./types";

export const api = {
  // Configuratie
  getConfig: () => invoke<AppConfig | null>("get_config"),
  saveConfig: (clientId: string, tenantId: string) =>
    invoke<void>("save_config", { clientId, tenantId }),

  // Authenticatie
  authStatus: () => invoke<boolean>("auth_status"),
  login: () => invoke<Account>("login"),
  logout: () => invoke<void>("logout"),
  getAccount: () => invoke<Account>("get_account"),

  // Mail
  listFolders: () => invoke<MailFolder[]>("list_folders"),
  listMessages: (folderId: string, top = 25, skip = 0) =>
    invoke<MessagesPage>("list_messages", { folderId, top, skip }),
  getMessage: (id: string) => invoke<Message>("get_message", { id }),
  setRead: (id: string, isRead: boolean) =>
    invoke<void>("set_read", { id, isRead }),
  setFlag: (id: string, flagged: boolean) =>
    invoke<void>("set_flag", { id, flagged }),
  deleteMessage: (id: string) => invoke<void>("delete_message", { id }),
  moveMessage: (id: string, destinationId: string) =>
    invoke<void>("move_message", { id, destinationId }),
  sendMessage: (input: ComposeInput) =>
    invoke<void>("send_message", { input }),

  // Agenda
  listEvents: (start: string, end: string) =>
    invoke<CalendarEvent[]>("list_events", { start, end }),
  createEvent: (input: EventInput) =>
    invoke<CalendarEvent>("create_event", { input }),
  deleteEvent: (id: string) => invoke<void>("delete_event", { id }),
};
