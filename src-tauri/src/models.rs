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
    /// bij een vergaderuitnodiging). Naar de frontend gaat dit als `odataType`.
    #[serde(rename(deserialize = "@odata.type", serialize = "odataType"), default)]
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

/// Mappen per gekoppeld account (voor de zijbalk).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountFolders {
    pub account: crate::config::StoredAccount,
    pub folders: Vec<MailFolder>,
}

/// Overzicht van gekoppelde accounts + welk account actief is.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountsInfo {
    pub accounts: Vec<crate::config::StoredAccount>,
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
