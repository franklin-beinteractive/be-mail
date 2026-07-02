// Types die 1-op-1 mappen op de Rust-modellen / Microsoft Graph.

export interface AppConfig {
  clientId: string;
  tenantId: string;
}

export interface Account {
  id: string;
  displayName?: string | null;
  mail?: string | null;
  userPrincipalName?: string | null;
}

export interface MailFolder {
  id: string;
  displayName?: string | null;
  unreadItemCount?: number | null;
  totalItemCount?: number | null;
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
}

export interface MessagesPage {
  messages: Message[];
  hasMore: boolean;
}

export interface Attachment {
  id: string;
  name?: string | null;
  contentType?: string | null;
  size?: number | null;
  isInline?: boolean | null;
}

// Bijlage om mee te sturen (inhoud als base64).
export interface AttachmentInput {
  name: string;
  contentType?: string;
  contentBase64: string;
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
