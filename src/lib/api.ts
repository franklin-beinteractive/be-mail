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
  CompanyMail,
  ComposeInput,
  EventInput,
  ImapAccountInput,
  ImapPreset,
  InlineImage,
  InviteDetails,
  MailFolder,
  Message,
  MessageRule,
  MessagesPage,
  OutlookCategory,
  Person,
  SearchQuery,
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
  // IMAP/SMTP-account koppelen (+ optioneel CalDAV). Het wachtwoord gaat naar
  // de keychain in de Rust-kern; de webview bewaart het nooit.
  addImapAccount: (input: ImapAccountInput) =>
    invoke<Account>("add_imap_account", { input }),
  // Test IMAP + SMTP (en CalDAV indien opgegeven) zonder iets op te slaan.
  testImapConnection: (input: ImapAccountInput) =>
    invoke<void>("test_imap_connection", { input }),
  // Voorinstellingen (host/poort/beveiliging) op basis van het e-maildomein.
  imapPresetsFor: (email: string) =>
    invoke<ImapPreset | null>("imap_presets_for", { email }),

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
  // Zonder folderId: hele mailbox; met folderId: alleen die map.
  searchMessages: (query: string, top = 50, folderId?: string) =>
    invoke<MessagesPage>("search_messages", {
      query,
      top,
      folderId: folderId ?? null,
    }),
  // Uitgebreid zoeken: losse velden; de Rust-kern vertaalt ze naar KQL (Graph)
  // of IMAP SEARCH.
  searchAdvanced: (query: SearchQuery, top = 50, folderId?: string) =>
    invoke<MessagesPage>("search_advanced", {
      query,
      top,
      folderId: folderId ?? null,
    }),
  // The whole conversation from every folder (incl. your replies in Sent
  // Items), newest first.
  getConversation: (conversationId: string) =>
    invoke<Message[]>("get_conversation", { conversationId }),
  // All recent mail with the company behind an address (null = unusable address).
  companyMail: (address: string) =>
    invoke<CompanyMail | null>("company_mail", { address }),
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
  // Profile photo of a sender as a data-URI, or null when there is none
  // (external sender, IMAP account, or no consent for User.ReadBasic.All).
  // Cached in the core, so calling this per list row is cheap.
  senderPhoto: (address: string) => invoke<string | null>("sender_photo", { address }),
  // Heel bericht opslaan als .eml in Downloads; geeft het pad terug.
  downloadMessage: (messageId: string) =>
    invoke<string>("download_message", { messageId }),
  // Externe afbeelding ophalen als data-URI. De webview mag externe URL's niet
  // zelf laden (CSP), dus dit loopt via de Rust-kern - pas na toestemming.
  fetchRemoteImage: (url: string) => invoke<string>("fetch_remote_image", { url }),
  // Uitgesteld bericht terugzetten in Postvak IN van een specifiek account
  // (de wekker moet ook niet-actieve accounts kunnen wekken).
  wakeSnoozed: (accountId: string, messageId: string) =>
    invoke<void>("wake_snoozed", { accountId, messageId }),
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
  // Time, place (and the old time when moved) of a meeting message; null
  // for any other message.
  inviteDetails: (messageId: string) =>
    invoke<InviteDetails | null>("invite_details", { messageId }),
  // Spam melden = verplaatsen naar de bekende map "junkemail".
  reportJunk: (id: string) =>
    invoke<void>("move_message", { id, destinationId: "junkemail" }),
  // Afzender blokkeren via een inbox-regel.
  blockSender: (address: string) => invoke<void>("block_sender", { address }),

  // AI-antwoorden (Claude). De API-sleutel leeft in de keychain (Rust-kern).
  claudeKeyStatus: () => invoke<boolean>("claude_key_status"),
  setClaudeKey: (key: string) => invoke<void>("set_claude_key", { key }),
  aiReply: (input: {
    stylePrompt: string;
    userName: string;
    lang: string;
    from: string;
    subject: string;
    bodyText: string;
  }) => invoke<string>("ai_reply", { ...input }),

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
