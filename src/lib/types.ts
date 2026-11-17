// Types die 1-op-1 mappen op de Rust-modellen / Microsoft Graph.

export interface AppConfig {
  clientId: string;
  tenantId: string;
  notificationsEnabled?: boolean;
}

/** Soort account: Office 365 (Graph) of IMAP/SMTP (+ optioneel CalDAV). */
export type AccountKind = "office365" | "imap";

/** Beveiliging van een IMAP-/SMTP-verbinding. */
export type TlsMode = "implicitTls" | "startTls";

export interface Account {
  id: string;
  displayName?: string | null;
  mail?: string | null;
  userPrincipalName?: string | null;
  kind?: AccountKind;
}

/** Gekoppeld account zoals opgeslagen in de config (multi-account). */
export interface StoredAccount {
  id: string;
  mail?: string | null;
  displayName?: string | null;
  kind?: AccountKind;
  /** Afgeleid door de kern: heeft dit account een agenda? */
  hasCalendar?: boolean;
  /** Afgeleid door de kern: ondersteunt het genodigden-autocomplete? */
  supportsPeople?: boolean;
}

export interface AccountsInfo {
  accounts: StoredAccount[];
  active?: string | null;
}

/** Opgeloste bijzondere mappen van een IMAP-account. */
export interface SpecialFolders {
  sent?: string | null;
  drafts?: string | null;
  junk?: string | null;
  trash?: string | null;
  archive?: string | null;
  delimiter?: string | null;
}

/** CalDAV-agenda die bij een IMAP-account hoort (best-effort). */
export interface CaldavSettings {
  calendarUrl: string;
  principalUrl?: string | null;
  homeSetUrl?: string | null;
  displayName?: string | null;
  caldavHost?: string | null;
  supportsExpand?: boolean;
  discoveredAt?: number;
  caldavUsername?: string | null;
}

/** IMAP-/SMTP-instellingen zoals opgeslagen (wachtwoord staat in de keychain). */
export interface ImapSettings {
  imapHost: string;
  imapPort: number;
  imapSecurity: TlsMode;
  imapUsername: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: TlsMode;
  smtpUsername: string;
  email: string;
  saveToSent?: boolean;
  folders?: SpecialFolders | null;
  caldav?: CaldavSettings | null;
}

/** Invoer vanuit het "IMAP-account toevoegen"-formulier naar de Rust-kern. */
export interface ImapAccountInput {
  displayName?: string | null;
  email: string;
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: TlsMode;
  imapUsername: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: TlsMode;
  smtpUsername: string;
  saveToSent?: boolean;
  /** Handmatige CalDAV-URL; leeg = automatisch detecteren. */
  caldavUrl?: string | null;
}

/** Voorinstellingen (host/poort) op basis van het e-maildomein. */
export interface ImapPreset {
  imapHost: string;
  imapPort: number;
  imapSecurity: TlsMode;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: TlsMode;
  /** Optionele hint, bv. dat Gmail/Microsoft een app-wachtwoord vereist. */
  hint?: string | null;
}

/** Wat het actieve account wel/niet kan (voor UI-gating). */
export interface Capabilities {
  kind: AccountKind;
  hasCalendar: boolean;
  supportsPeople: boolean;
  /** Graph-only mailfuncties (regels, categorieen, afwezigheid, rsvp, blokkeren,
   * later-verzenden). Voor IMAP-accounts false. */
  graphOnly: boolean;
}

export interface AccountFolders {
  account: StoredAccount;
  folders: MailFolder[];
}

export interface MailFolder {
  id: string;
  displayName?: string | null;
  unreadItemCount?: number | null;
  totalItemCount?: number | null;
  parentFolderId?: string | null;
  childFolderCount?: number | null;
}

export interface EmailAddress {
  name?: string | null;
  address?: string | null;
}

export interface Recipient {
  emailAddress: EmailAddress;
}

export interface ItemBody {
  contentType: string;
  content: string;
}

export interface FollowupFlag {
  flagStatus?: string | null;
}

export interface Message {
  /** Graph-subtype, bv. "#microsoft.graph.eventMessageRequest" (uitnodiging). */
  odataType?: string | null;
  id: string;
  subject?: string | null;
  from?: Recipient | null;
  toRecipients?: Recipient[] | null;
  ccRecipients?: Recipient[] | null;
  bccRecipients?: Recipient[] | null;
  receivedDateTime?: string | null;
  sentDateTime?: string | null;
  isRead?: boolean | null;
  hasAttachments?: boolean | null;
  bodyPreview?: string | null;
  importance?: string | null;
  flag?: FollowupFlag | null;
  body?: ItemBody | null;
  webLink?: string | null;
  isDraft?: boolean | null;
  /** Alleen gevuld bij het openen van één bericht (o.a. List-Unsubscribe). */
  internetMessageHeaders?: { name?: string | null; value?: string | null }[] | null;
  categories?: string[] | null;
  /** Gespreks-id voor threading. */
  conversationId?: string | null;
  /** Folder the message is in (labels "Sent Items"/"Archive" in a thread). */
  parentFolderId?: string | null;
  /** Who actually sent it when that is not `from` ("X on behalf of Y").
   *  Only filled for an opened message. */
  sender?: Recipient | null;
}

/** Meeting details of an invitation/update/cancellation, see
 *  `api.inviteDetails`. Times are local wall-clock ("2026-11-16T14:30:00"). */
export interface InviteDetails {
  eventId?: string | null;
  start?: string | null;
  end?: string | null;
  isAllDay: boolean;
  location?: string | null;
  /** Set only when the meeting was moved: the old values. */
  previousStart?: string | null;
  previousEnd?: string | null;
  previousLocation?: string | null;
  meetingMessageType?: string | null;
  /** "none" | "notResponded" | "accepted" | "tentativelyAccepted" | "declined" | "organizer" */
  response?: string | null;
  isCancelled: boolean;
}

/** All recent mail with one company (or one person), see `api.companyMail`. */
export interface CompanyMail {
  /** "domain" = everyone at the company; "address" = this one person
   *  (free-mail providers, and colleagues on your own domain). */
  scope: "domain" | "address";
  /** The domain or address that was searched for. */
  key: string;
  /** Newest first; no deleted items, junk or drafts. */
  messages: Message[];
}

export interface MessagesPage {
  messages: Message[];
  hasMore: boolean;
  /** True als dit uit de offline cache komt (geen netwerk). */
  fromCache?: boolean;
}

export interface Attachment {
  id: string;
  name?: string | null;
  contentType?: string | null;
  size?: number | null;
  isInline?: boolean | null;
}

// Inbox-regel (messageRule) voor het regels-beheer in Instellingen.
export interface MessageRule {
  id: string;
  displayName?: string | null;
  isEnabled?: boolean | null;
  isReadOnly?: boolean | null;
}

// Afwezigheid / automatisch antwoord.
export interface AutoReplySettings {
  status: string; // "disabled" | "alwaysEnabled" | "scheduled"
  externalAudience?: string | null; // "none" | "contactsOnly" | "all"
  scheduledStartDateTime?: DateTimeTimeZone | null;
  scheduledEndDateTime?: DateTimeTimeZone | null;
  internalReplyMessage?: string | null;
  externalReplyMessage?: string | null;
}

// Outlook-categorie (kleurlabel).
export interface OutlookCategory {
  id: string;
  displayName?: string | null;
  color?: string | null; // "preset0" t/m "preset24"
}

// Inline (cid:) afbeelding met inhoud, voor weergave in het leesvenster.
export interface InlineImage {
  contentId: string;
  contentType: string;
  contentBytes: string;
}

// Bijlage om mee te sturen (inhoud als base64). contentId + isInline maken er
// een ingesloten (cid:) afbeelding van waar de body-HTML naar verwijst.
export interface AttachmentInput {
  name: string;
  contentType?: string;
  contentBase64: string;
  contentId?: string;
  isInline?: boolean;
}

export interface DateTimeTimeZone {
  dateTime: string;
  timeZone: string;
}

export interface CalendarEvent {
  id: string;
  subject?: string | null;
  bodyPreview?: string | null;
  start: DateTimeTimeZone;
  end: DateTimeTimeZone;
  isAllDay?: boolean | null;
  location?: { displayName?: string | null } | null;
  organizer?: Recipient | null;
  isCancelled?: boolean | null;
}

/** Velden van het uitgebreide zoekformulier; alles optioneel.
 *  `isRead`: null = alles, true = alleen gelezen, false = alleen ongelezen. */
export interface SearchQuery {
  text?: string;
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  /** "JJJJ-MM-DD", beide grenzen inclusief. */
  since?: string;
  until?: string;
  isRead?: boolean | null;
  hasAttachments?: boolean;
}

export interface ComposeInput {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyHtml: string;
  importance?: string;
  attachments?: AttachmentInput[];
}

export interface Person {
  displayName?: string | null;
  scoredEmailAddresses: { address?: string | null }[];
}

export interface RecurrenceInput {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval?: number;
  /** Einddatum "YYYY-MM-DD"; weglaten = geen einde. */
  until?: string;
}

export interface EventInput {
  subject: string;
  start: string;
  end: string;
  timeZone?: string;
  isAllDay: boolean;
  location?: string;
  body?: string;
  attendees: string[];
  reminderMinutes?: number | null;
  recurrence?: RecurrenceInput | null;
}
