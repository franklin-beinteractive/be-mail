//! Datamodellen die 1-op-1 mappen op Microsoft Graph JSON (v1.0).
//! Onbekende velden worden door serde genegeerd, dus we hoeven niet alles te modelleren.

use serde::{Deserialize, Serialize};

/// Generieke Graph-collectie met paginering.
#[derive(Debug, Deserialize)]
pub struct GraphList<T> {
    pub value: Vec<T>,
    #[serde(rename = "@odata.nextLink")]
    pub next_link: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EmailAddress {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub address: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recipient {
    pub email_address: EmailAddress,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemBody {
    #[serde(default)]
    pub content_type: String,
    #[serde(default)]
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowupFlag {
    #[serde(default)]
    pub flag_status: Option<String>,
}

/// Ingelogd account (uit /me).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub mail: Option<String>,
    #[serde(default)]
    pub user_principal_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailFolder {
    pub id: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub unread_item_count: Option<i64>,
    #[serde(default)]
    pub total_item_count: Option<i64>,
    /// Voor de boomweergave: id van de bovenliggende map.
    #[serde(default)]
    pub parent_folder_id: Option<String>,
    #[serde(default)]
    pub child_folder_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    /// Graph zet hier het subtype in (bv. "#microsoft.graph.eventMessageRequest"
    /// bij een vergaderuitnodiging). Naar de frontend gaat dit als `odataType`;
    /// het alias laat onze eigen serialisatie (offline cache) ook weer inlezen.
    #[serde(
        rename(deserialize = "@odata.type", serialize = "odataType"),
        alias = "odataType",
        default
    )]
    pub odata_type: Option<String>,
    pub id: String,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub from: Option<Recipient>,
    #[serde(default)]
    pub to_recipients: Option<Vec<Recipient>>,
    #[serde(default)]
    pub cc_recipients: Option<Vec<Recipient>>,
    #[serde(default)]
    pub bcc_recipients: Option<Vec<Recipient>>,
    #[serde(default)]
    pub received_date_time: Option<String>,
    #[serde(default)]
    pub sent_date_time: Option<String>,
    #[serde(default)]
    pub is_read: Option<bool>,
    #[serde(default)]
    pub has_attachments: Option<bool>,
    #[serde(default)]
    pub body_preview: Option<String>,
    #[serde(default)]
    pub importance: Option<String>,
    #[serde(default)]
    pub flag: Option<FollowupFlag>,
    #[serde(default)]
    pub body: Option<ItemBody>,
    #[serde(default)]
    pub web_link: Option<String>,
    #[serde(default)]
    pub is_draft: Option<bool>,
    /// Alleen gevuld bij het openen van één bericht (o.a. List-Unsubscribe).
    #[serde(default)]
    pub internet_message_headers: Option<Vec<MessageHeader>>,
    #[serde(default)]
    pub categories: Option<Vec<String>>,
    /// Gespreks-id voor threading (berichten groeperen).
    #[serde(default)]
    pub conversation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageHeader {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
}

/// Eén pagina berichten voor de frontend.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagesPage {
    pub messages: Vec<Message>,
    /// Zijn er meer berichten? (voor "meer laden")
    pub has_more: bool,
    /// True als dit uit de offline cache komt (geen netwerk).
    #[serde(default)]
    pub from_cache: bool,
}

/// Bijlage-metadata (zonder inhoud; die halen we pas op bij downloaden).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub content_type: Option<String>,
    #[serde(default)]
    pub size: Option<i64>,
    #[serde(default)]
    pub is_inline: Option<bool>,
}

/// Afwezigheid / automatisch antwoord (mailboxSettings.automaticRepliesSetting).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoReplySettings {
    /// "disabled" | "alwaysEnabled" | "scheduled"
    pub status: String,
    /// "none" | "contactsOnly" | "all"
    #[serde(default)]
    pub external_audience: Option<String>,
    #[serde(default)]
    pub scheduled_start_date_time: Option<DateTimeTimeZone>,
    #[serde(default)]
    pub scheduled_end_date_time: Option<DateTimeTimeZone>,
    #[serde(default)]
    pub internal_reply_message: Option<String>,
    #[serde(default)]
    pub external_reply_message: Option<String>,
}

/// Outlook-categorie (kleurlabel) uit de master-lijst.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlookCategory {
    pub id: String,
    #[serde(default)]
    pub display_name: Option<String>,
    /// "preset0" t/m "preset24" of "none".
    #[serde(default)]
    pub color: Option<String>,
}

/// Inbox-regel (messageRule); alleen de velden die de beheer-UI nodig heeft.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRule {
    pub id: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub is_enabled: Option<bool>,
    #[serde(default)]
    pub is_read_only: Option<bool>,
}

/// Inline (cid:) afbeelding met inhoud, voor weergave in het leesvenster.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineImage {
    pub content_id: String,
    pub content_type: String,
    pub content_bytes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DateTimeTimeZone {
    pub date_time: String,
    pub time_zone: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EventLocation {
    #[serde(default)]
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub body_preview: Option<String>,
    pub start: DateTimeTimeZone,
    pub end: DateTimeTimeZone,
    #[serde(default)]
    pub is_all_day: Option<bool>,
    #[serde(default)]
    pub location: Option<EventLocation>,
    #[serde(default)]
    pub organizer: Option<Recipient>,
    #[serde(default)]
    pub is_cancelled: Option<bool>,
}

/// Publiek accountoverzicht voor de frontend: alleen wat de UI nodig heeft, en
/// bewust ZONDER de IMAP-host/gebruikersnaam/instellingen (die blijven in de
/// Rust-kern). `kind` serialiseert als "office365"/"imap"; `hasCalendar` en
/// `supportsPeople` sturen de gating in de UI (agenda-tab, genodigden-autocomplete).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub id: String,
    #[serde(default)]
    pub mail: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    pub kind: crate::config::AccountKind,
    pub has_calendar: bool,
    pub supports_people: bool,
}

impl AccountInfo {
    pub fn from_stored(a: &crate::config::StoredAccount) -> Self {
        Self {
            id: a.id.clone(),
            mail: a.mail.clone(),
            display_name: a.display_name.clone(),
            kind: a.kind,
            has_calendar: a.has_calendar(),
            supports_people: a.supports_people(),
        }
    }
}

/// Mappen per gekoppeld account (voor de zijbalk).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountFolders {
    pub account: AccountInfo,
    pub folders: Vec<MailFolder>,
}

/// Overzicht van gekoppelde accounts + welk account actief is.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountsInfo {
    pub accounts: Vec<AccountInfo>,
    pub active: Option<String>,
}

/// Persoon uit /me/people (voor autoaanvullen van genodigden).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub scored_email_addresses: Vec<ScoredEmail>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoredEmail {
    #[serde(default)]
    pub address: Option<String>,
}

// ---- Invoer vanuit de frontend ----

/// Bijlage vanuit de frontend (inhoud als base64). content_id + is_inline
/// maken er een ingesloten (cid:) afbeelding van waar de body naar verwijst.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInput {
    pub name: String,
    #[serde(default)]
    pub content_type: Option<String>,
    pub content_base64: String,
    #[serde(default)]
    pub content_id: Option<String>,
    #[serde(default)]
    pub is_inline: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeInput {
    pub to: Vec<String>,
    #[serde(default)]
    pub cc: Vec<String>,
    #[serde(default)]
    pub bcc: Vec<String>,
    #[serde(default)]
    pub subject: String,
    #[serde(default)]
    pub body_html: String,
    /// "low" | "normal" | "high"
    #[serde(default)]
    pub importance: Option<String>,
    #[serde(default)]
    pub attachments: Vec<AttachmentInput>,
}

/// Invoer voor het toevoegen/testen van een IMAP-account (vanuit de frontend).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImapAccountInput {
    #[serde(default)]
    pub display_name: Option<String>,
    pub email: String,
    pub password: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub imap_security: crate::config::TlsMode,
    pub imap_username: String,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_security: crate::config::TlsMode,
    pub smtp_username: String,
    /// Kopie in Verzonden bewaren (standaard aan als niet meegegeven).
    #[serde(default)]
    pub save_to_sent: Option<bool>,
    /// Optionele handmatige CalDAV-URL (anders auto-detectie op het e-maildomein).
    #[serde(default)]
    pub caldav_url: Option<String>,
}

/// Voorgestelde IMAP-/SMTP-instellingen op basis van het e-maildomein.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImapPreset {
    pub imap_host: String,
    pub imap_port: u16,
    pub imap_security: crate::config::TlsMode,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_security: crate::config::TlsMode,
    /// Extra uitleg (bv. dat er een app-wachtwoord nodig is).
    #[serde(default)]
    pub hint: Option<String>,
}

/// Herhaalpatroon voor een afspraak (eenvoudig model; details zoals
/// weekdag/dag-van-de-maand worden uit de startdatum afgeleid).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurrenceInput {
    /// "daily" | "weekly" | "monthly" | "yearly"
    pub frequency: String,
    /// Om de hoeveel dagen/weken/maanden/jaren (standaard 1).
    #[serde(default)]
    pub interval: Option<i32>,
    /// Einddatum "YYYY-MM-DD"; leeg = geen einde.
    #[serde(default)]
    pub until: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventInput {
    pub subject: String,
    /// ISO 8601 lokaal, bv. "2026-07-01T09:00:00"
    pub start: String,
    pub end: String,
    #[serde(default)]
    pub time_zone: Option<String>,
    #[serde(default)]
    pub is_all_day: bool,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    /// E-mailadressen van genodigden.
    #[serde(default)]
    pub attendees: Vec<String>,
    /// Herinnering in minuten voor aanvang.
    #[serde(default)]
    pub reminder_minutes: Option<i32>,
    /// Herhaalpatroon; alleen bij aanmaken meegestuurd.
    #[serde(default)]
    pub recurrence: Option<RecurrenceInput>,
}
