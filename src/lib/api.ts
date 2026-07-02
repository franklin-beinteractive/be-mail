// Dunne wrappers rond de Tauri-commands. Alle communicatie met Office 365
// loopt via de Rust-kern; hier roepen we die alleen aan.

import { invoke } from "@tauri-apps/api/core";
import type {
  Account,
  AppConfig,
  Attachment,
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
  createFolder: (name: string) => invoke<MailFolder>("create_folder", { name }),
  renameFolder: (id: string, name: string) =>
    invoke<void>("rename_folder", { id, name }),
  deleteFolder: (id: string) => invoke<void>("delete_folder", { id }),
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
  // Archiveren = verplaatsen naar de bekende map "archive" (well-known folder).
  archiveMessage: (id: string) =>
    invoke<void>("move_message", { id, destinationId: "archive" }),
  sendMessage: (input: ComposeInput) =>
    invoke<void>("send_message", { input }),
  searchMessages: (query: string, top = 50) =>
    invoke<MessagesPage>("search_messages", { query, top }),
  // Concepten: aanmaken geeft het bericht (met id) terug; verzenden van een
  // concept werkt eerst de velden/bijlagen bij zodat er geen duplicaat ontstaat.
  createDraft: (input: ComposeInput) =>
    invoke<Message>("create_draft", { input }),
  updateDraft: (id: string, input: ComposeInput) =>
    invoke<void>("update_draft", { id, input }),
  // scheduledUtc (ISO, UTC) = "later verzenden": Exchange bezorgt op dat moment.
  sendDraft: (id: string, input: ComposeInput, scheduledUtc?: string) =>
    invoke<void>("send_draft", { id, input, scheduledUtc: scheduledUtc ?? null }),
  listAttachments: (messageId: string) =>
    invoke<Attachment[]>("list_attachments", { messageId }),
  // Downloadt naar de Downloads-map; geeft het opgeslagen pad terug.
  downloadAttachment: (messageId: string, attachmentId: string) =>
    invoke<string>("download_attachment", { messageId, attachmentId }),
  // Antwoord op een vergaderuitnodiging.
  rsvpMessage: (messageId: string, response: "accept" | "tentative" | "decline") =>
    invoke<void>("rsvp_message", { messageId, response }),
  // Spam melden = verplaatsen naar de bekende map "junkemail".
  reportJunk: (id: string) =>
    invoke<void>("move_message", { id, destinationId: "junkemail" }),
  // Afzender blokkeren via een inbox-regel.
  blockSender: (address: string) => invoke<void>("block_sender", { address }),

  // Agenda
  listEvents: (start: string, end: string) =>
    invoke<CalendarEvent[]>("list_events", { start, end }),
  createEvent: (input: EventInput) =>
    invoke<CalendarEvent>("create_event", { input }),
  updateEvent: (id: string, input: EventInput) =>
    invoke<CalendarEvent>("update_event", { id, input }),
  deleteEvent: (id: string) => invoke<void>("delete_event", { id }),
};
