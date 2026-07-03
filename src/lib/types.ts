// Types die 1-op-1 mappen op de Rust-modellen / Microsoft Graph.

export interface AppConfig {
  clientId: string;
  tenantId: string;
  notificationsEnabled?: boolean;
}

export interface Account {
  id: string;
  displayName?: string | null;
  mail?: string | null;
  userPrincipalName?: string | null;
}

/** Gekoppeld account zoals opgeslagen in de config (multi-account). */
export interface StoredAccount {
  id: string;
  mail?: string | null;
  displayName?: string | null;
}

export interface AccountsInfo {
  accounts: StoredAccount[];
  active?: string | null;
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
