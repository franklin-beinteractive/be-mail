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
    /// Who actually sent it, when that differs from `from`: a secretary or
    /// delegate sending "on behalf of" someone. Only filled for one opened
    /// message (Graph), not in lists.
    #[serde(default)]
    pub sender: Option<Recipient>,
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
    /// Folder the message lives in. A conversation is gathered from every
    /// folder, so the reader can label "Sent Items" or "Archive" per message.
    /// IMAP: the mailbox path (the same value as the folder id).
    #[serde(default)]
    pub parent_folder_id: Option<String>,
}

/// Meeting details of an invitation, update or cancellation (a Graph
/// eventMessage), for the block above the RSVP buttons. All times are local
/// wall-clock times in the account time zone ("2026-11-16T14:30:00"), the
/// same convention the calendar view uses.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteDetails {
    /// Id of the meeting in your calendar (to highlight it in the day view).
    pub event_id: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub is_all_day: bool,
    pub location: Option<String>,
    /// Only set when the organiser moved the meeting: the old times/place,
    /// shown struck through (like Outlook).
    pub previous_start: Option<String>,
    pub previous_end: Option<String>,
    pub previous_location: Option<String>,
    /// Graph's meetingMessageType: "meetingRequest", "meetingCancelled", ...
    pub meeting_message_type: Option<String>,
    /// Your answer so far: "none", "notResponded", "accepted",
    /// "tentativelyAccepted", "declined" or "organizer".
    pub response: Option<String>,
    pub is_cancelled: bool,
}

/// All recent mail with one company (or one person), for the "everything
/// with this customer" panel in the reader.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanyMail {
    /// "domain" (everyone at the company) or "address" (one person: free-mail
    /// providers such as gmail.com, and colleagues on your own domain).
    pub scope: String,
    /// The domain or address that was searched for.
    pub key: String,
    /// Newest first, across Inbox, Sent Items and the other folders. Deleted
    /// items, junk and drafts are left out.
    pub messages: Vec<Message>,
}

/// Domains of free-mail and consumer ISP mailboxes. Grouping on one of these
/// would lump unrelated private customers together, so those fall back to the
/// sender's own address.
const FREE_MAIL_DOMAINS: &[&str] = &[
    "gmail.com", "googlemail.com", "hotmail.com", "hotmail.nl", "hotmail.be", "outlook.com",
    "outlook.nl", "outlook.be", "live.com", "live.nl", "live.be", "msn.com", "yahoo.com",
    "yahoo.nl", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com", "gmx.com", "gmx.net",
    "gmx.de", "proton.me", "protonmail.com", "pm.me", "ziggo.nl", "kpnmail.nl", "kpnplanet.nl",
    "planet.nl", "hetnet.nl", "home.nl", "xs4all.nl", "telfort.nl", "upcmail.nl", "chello.nl",
    "casema.nl", "online.nl", "tele2.nl", "quicknet.nl", "zeelandnet.nl", "freeler.nl",
    "caiway.nl", "solcon.nl", "telenet.be", "skynet.be", "proximus.be",
];

/// Decides what "this customer" means for an address: `("domain", domain)`
/// for a company, `("address", address)` for free-mail and for colleagues on
/// your own domain (otherwise "the company" would be all of your mail).
/// `None` when the input is not a usable e-mail address.
pub fn company_scope(address: &str, own_address: Option<&str>) -> Option<(&'static str, String)> {
    let addr = address.trim().to_ascii_lowercase();
    let (local, domain) = addr.rsplit_once('@')?;
    let valid = |s: &str| {
        !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+'))
    };
    if !valid(local) || !valid(domain) || !domain.contains('.') {
        return None;
    }
    let own_domain = own_address
        .and_then(|o| o.trim().to_ascii_lowercase().rsplit_once('@').map(|(_, d)| d.to_string()));
    if FREE_MAIL_DOMAINS.contains(&domain) || own_domain.as_deref() == Some(domain) {
        Some(("address", addr.clone()))
    } else {
        Some(("domain", domain.to_string()))
    }
}

#[cfg(test)]
mod company_scope_tests {
    use super::company_scope;

    #[test]
    fn a_company_groups_on_its_domain() {
        assert_eq!(
            company_scope("Jan@Acme.nl", Some("me@be-interactive.nl")),
            Some(("domain", "acme.nl".to_string()))
        );
    }

    #[test]
    fn free_mail_and_colleagues_group_on_the_address() {
        assert_eq!(
            company_scope("piet@gmail.com", Some("me@be-interactive.nl")),
            Some(("address", "piet@gmail.com".to_string()))
        );
        assert_eq!(
            company_scope("collega@be-interactive.nl", Some("me@be-interactive.nl")),
            Some(("address", "collega@be-interactive.nl".to_string()))
        );
    }

    #[test]
    fn rejects_anything_that_is_not_a_plain_address() {
        assert_eq!(company_scope("Jan Jansen", None), None);
        assert_eq!(company_scope("a@b", None), None);
        assert_eq!(company_scope("x\"y@acme.nl", None), None);
        assert_eq!(company_scope("x@acme.nl OR subject:x", None), None);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageHeader {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
}

/// Uitgebreid zoeken: losse velden in plaats van één zoekregel.
///
/// Bewust gestructureerd en niet als kant-en-klare zoekstring: Graph wil KQL
/// (`from:… AND subject:…`) en IMAP wil zijn eigen SEARCH-syntax. Elke backend
/// vertaalt dit zelf, zodat hetzelfde formulier voor beide accounttypen werkt.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchQuery {
    /// Vrije trefwoorden (onderwerp + inhoud).
    pub text: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub cc: Option<String>,
    pub subject: Option<String>,
    /// Datumgrenzen als "JJJJ-MM-DD"; beide inclusief.
    pub since: Option<String>,
    pub until: Option<String>,
    /// None = alles, Some(true) = alleen gelezen, Some(false) = alleen ongelezen.
    pub is_read: Option<bool>,
    /// Alleen berichten met bijlagen. IMAP kan hier niet op zoeken.
    pub has_attachments: Option<bool>,
}

impl SearchQuery {
    /// Leeg formulier: dan is er niets te zoeken.
    pub fn is_empty(&self) -> bool {
        let blank = |s: &Option<String>| s.as_deref().map(str::trim).unwrap_or("").is_empty();
        blank(&self.text)
            && blank(&self.from)
            && blank(&self.to)
            && blank(&self.cc)
            && blank(&self.subject)
            && blank(&self.since)
            && blank(&self.until)
            && self.is_read.is_none()
            && self.has_attachments != Some(true)
    }
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
