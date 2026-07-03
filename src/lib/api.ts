// Dunne wrappers rond de Tauri-commands. Alle communicatie met Office 365
// loopt via de Rust-kern; hier roepen we die alleen aan.

import { invoke } from "@tauri-apps/api/core";
import type {
  Account,
  AccountFolders,
  AccountsInfo,
  AppConfig,
  Attachment,
  AutoReplySettings,
  CalendarEvent,
  ComposeInput,
  EventInput,
  InlineImage,
  MailFolder,
  Message,
  MessageRule,
  MessagesPage,
  OutlookCategory,
  Person,
} from "./types";

export const api = {
  // Configuratie
  getConfig: () => invoke<AppConfig | null>("get_config"),
  saveConfig: (clientId: string, tenantId: string) =>
    invoke<void>("save_config", { clientId, tenantId }),
  setNotificationsEnabled: (enabled: boolean) =>
    invoke<void>("set_notifications_enabled", { enabled }),

  // Authenticatie & accounts
  authStatus: () => invoke<boolean>("auth_status"),
  // Inloggen = account koppelen; wordt meteen het actieve account.
  login: () => invoke<Account>("login"),
  // Zonder id: het actieve account ontkoppelen.
  logout: (accountId?: string) =>
    invoke<void>("logout", { accountId: accountId ?? null }),
  getAccount: () => invoke<Account>("get_account"),
  listAccounts: () => invoke<AccountsInfo>("list_accounts"),
  setActiveAccount: (id: string) => invoke<void>("set_active_account", { id }),
  listAllFolders: () => invoke<AccountFolders[]>("list_all_folders"),

  // Mail
  listFolders: () => invoke<MailFolder[]>("list_folders"),
  createFolder: (name: string) => invoke<MailFolder>("create_folder", { name }),
  renameFolder: (id: string, name: string) =>
    invoke<void>("rename_folder", { id, name }),
  deleteFolder: (id: string) => invoke<void>("delete_folder", { id }),
  // Map in een andere map slepen; "msgfolderroot" = terug naar hoofdniveau.
  moveFolder: (id: string, destinationId: string) =>
    invoke<void>("move_folder", { id, destinationId }),
  // ascending: oudste eerst; filter: "unread" | "flagged" (anders alles).
  listMessages: (
    folderId: string,
    top = 25,
    skip = 0,
    ascending = false,
    filter?: string
  ) =>
    invoke<MessagesPage>("list_messages", {
      folderId,
      top,
      skip,
      ascending,
      filter: filter ?? null,
    }),
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
  // Inline (cid:) afbeeldingen met inhoud, voor weergave in het leesvenster.
  inlineImages: (messageId: string) =>
    invoke<InlineImage[]>("inline_images", { messageId }),
  // Verplaatst en geeft het verplaatste bericht terug (nieuw id; voor snoozen).
  moveMessageReturning: (messageId: string, destinationId: string) =>
    invoke<Message>("move_message_returning", { messageId, destinationId }),
  // Inbox-regels (regels-beheer in Instellingen).
  listRules: () => invoke<MessageRule[]>("list_rules"),
  setRuleEnabled: (ruleId: string, enabled: boolean) =>
    invoke<void>("set_rule_enabled", { ruleId, enabled }),
  deleteRule: (ruleId: string) => invoke<void>("delete_rule", { ruleId }),
  // Afwezigheid / automatisch antwoord (vereist MailboxSettings-consent).
  getAutoReply: () => invoke<AutoReplySettings>("get_auto_reply"),
  setAutoReply: (settings: AutoReplySettings) =>
    invoke<void>("set_auto_reply", { settings }),
  // Categorieën (kleurlabels).
  listCategories: () => invoke<OutlookCategory[]>("list_categories"),
  setMessageCategories: (messageId: string, categories: string[]) =>
    invoke<void>("set_message_categories", { messageId, categories }),
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
  // Alleen tijden verschuiven (slepen); genodigden krijgen automatisch een update.
  updateEventTimes: (id: string, start: string, end: string) =>
    invoke<void>("update_event_times", { id, start, end }),
  searchPeople: (query: string) => invoke<Person[]>("search_people", { query }),
  deleteEvent: (id: string) => invoke<void>("delete_event", { id }),
};
