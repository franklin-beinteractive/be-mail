//! Microsoft Graph API-client (v1.0). Alle netwerkverkeer naar Office 365 loopt
//! hier, in de Rust-kern - nooit vanuit de webview.

use crate::auth;
use crate::config::AppConfig;
use crate::models::*;
use anyhow::{bail, Context, Result};
use serde::de::DeserializeOwned;
use serde_json::json;

const BASE: &str = "https://graph.microsoft.com/v1.0";
/// Standaard tijdzone (Windows-notatie zoals Graph die verwacht).
const DEFAULT_TZ: &str = "W. Europe Standard Time";

const MSG_SELECT: &str = "id,subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,sentDateTime,isRead,hasAttachments,bodyPreview,importance,flag,webLink,isDraft";

pub struct GraphClient {
    token: String,
    http: reqwest::Client,
}

impl GraphClient {
    pub async fn new(config: &AppConfig, account_id: &str) -> Result<Self> {
        let token = auth::valid_access_token(config, account_id).await?;
        Ok(Self {
            token,
            http: reqwest::Client::new(),
        })
    }

    /// Client op basis van een al verkregen access-token (direct na login,
    /// vóórdat bekend is bij welk account de tokens horen).
    pub fn from_token(token: String) -> Self {
        Self {
            token,
            http: reqwest::Client::new(),
        }
    }

    async fn get_json<T: DeserializeOwned>(&self, url: &str) -> Result<T> {
        let resp = self
            .http
            .get(url)
            .bearer_auth(&self.token)
            .send()
            .await
            .context("Netwerkfout richting Office 365")?;
        self.parse(resp).await
    }

    async fn parse<T: DeserializeOwned>(&self, resp: reqwest::Response) -> Result<T> {
        let status = resp.status();
        let text = resp.text().await.context("Kon antwoord niet lezen")?;
        if !status.is_success() {
            bail!("Office 365 gaf een fout (HTTP {status}): {}", short(&text));
        }
        serde_json::from_str::<T>(&text).context("Onverwacht antwoord van Office 365")
    }

    async fn expect_ok(&self, resp: reqwest::Response) -> Result<()> {
        let status = resp.status();
        if status.is_success() {
            Ok(())
        } else {
            let text = resp.text().await.unwrap_or_default();
            bail!("Office 365 gaf een fout (HTTP {status}): {}", short(&text));
        }
    }

    // ---- Account ----
    pub async fn me(&self) -> Result<Account> {
        self.get_json(&format!(
            "{BASE}/me?$select=id,displayName,mail,userPrincipalName"
        ))
        .await
    }

    // ---- Mappen ----

    /// Alle mappen, inclusief submappen (tot 3 niveaus diep), als platte lijst;
    /// de frontend bouwt er een boom van via `parentFolderId`.
    pub async fn list_folders(&self) -> Result<Vec<MailFolder>> {
        const SEL: &str =
            "id,displayName,unreadItemCount,totalItemCount,parentFolderId,childFolderCount";
        let top: GraphList<MailFolder> = self
            .get_json(&format!("{BASE}/me/mailFolders?$top=100&$select={SEL}"))
            .await?;

        let mut all = Vec::new();
        let mut queue: Vec<String> = top
            .value
            .iter()
            .filter(|f| f.child_folder_count.unwrap_or(0) > 0)
            .map(|f| f.id.clone())
            .collect();
        all.extend(top.value);

        let mut depth = 0;
        while !queue.is_empty() && depth < 3 {
            let mut next = Vec::new();
            for id in queue {
                let kids: GraphList<MailFolder> = self
                    .get_json(&format!(
                        "{BASE}/me/mailFolders/{id}/childFolders?$top=100&$select={SEL}"
                    ))
                    .await?;
                next.extend(
                    kids.value
                        .iter()
                        .filter(|f| f.child_folder_count.unwrap_or(0) > 0)
                        .map(|f| f.id.clone()),
                );
                all.extend(kids.value);
            }
            queue = next;
            depth += 1;
        }
        Ok(all)
    }

    /// Verplaatst een map in een andere map ("msgfolderroot" = hoofdniveau).
    pub async fn move_folder(&self, id: &str, destination_id: &str) -> Result<()> {
        let resp = self
            .http
            .post(format!("{BASE}/me/mailFolders/{id}/move"))
            .bearer_auth(&self.token)
            .json(&json!({ "destinationId": destination_id }))
            .send()
            .await?;
        self.expect_ok(resp).await
    }

    /// Nieuwe map op hoofdniveau.
    pub async fn create_folder(&self, name: &str) -> Result<MailFolder> {
        let resp = self
            .http
            .post(format!("{BASE}/me/mailFolders"))
            .bearer_auth(&self.token)
            .json(&json!({ "displayName": name }))
            .send()
            .await?;
        self.parse(resp).await
    }

    pub async fn rename_folder(&self, id: &str, name: &str) -> Result<()> {
        let resp = self
            .http
            .patch(format!("{BASE}/me/mailFolders/{id}"))
            .bearer_auth(&self.token)
            .json(&json!({ "displayName": name }))
            .send()
            .await?;
        self.expect_ok(resp).await
    }

    /// Verwijdert een map (inclusief inhoud; Graph verplaatst naar Verwijderde items).
    pub async fn delete_folder(&self, id: &str) -> Result<()> {
        let resp = self
            .http
            .delete(format!("{BASE}/me/mailFolders/{id}"))
            .bearer_auth(&self.token)
            .send()
            .await?;
        self.expect_ok(resp).await
    }

    // ---- Berichten ----
    pub async fn list_messages(
        &self,
        folder_id: &str,
        top: u32,
        skip: u32,
    ) -> Result<MessagesPage> {
        let url = format!(
            "{BASE}/me/mailFolders/{folder}/messages?$select={sel}&$top={top}&$skip={skip}&$orderby=receivedDateTime%20desc",
            folder = folder_id,
            sel = MSG_SELECT,
        );
        let list: GraphList<Message> = self.get_json(&url).await?;
        Ok(MessagesPage {
            has_more: list.next_link.is_some(),
            messages: list.value,
        })
    }

    pub async fn get_message(&self, id: &str) -> Result<Message> {
        // internetMessageHeaders alleen hier (niet in lijsten): nodig voor
        // o.a. de List-Unsubscribe-header, maar relatief zwaar.
        let url = format!(
            "{BASE}/me/messages/{id}?$select={MSG_SELECT},body,internetMessageHeaders",
        );
        self.get_json(&url).await
    }

    /// Blokkeert een afzender via een inbox-regel: nieuwe berichten van dit
    /// adres gaan voortaan rechtstreeks naar Ongewenste e-mail.
    pub async fn block_sender(&self, address: &str) -> Result<()> {
        #[derive(serde::Deserialize)]
        struct Folder {
            id: String,
        }
        let junk: Folder = self
            .get_json(&format!("{BASE}/me/mailFolders/junkemail?$select=id"))
            .await?;

        let rule = json!({
            "displayName": format!("BE-Mail: {address} geblokkeerd"),
            "sequence": 1,
            "isEnabled": true,
            "conditions": {
                "fromAddresses": [ { "emailAddress": { "address": address } } ]
            },
            "actions": {
                "moveToFolder": junk.id,
                "stopProcessingRules": true
            }
        });
        let resp = self
            .http
            .post(format!("{BASE}/me/mailFolders/inbox/messageRules"))
            .bearer_auth(&self.token)
            .json(&rule)
            .send()
            .await?;
        self.expect_ok(resp).await
    }

    /// Doorzoekt de héle mailbox (alle mappen) via Graph `$search`.
    /// Let op: `$search` mag niet met `$orderby` gecombineerd worden - Graph
    /// sorteert zelf op relevantie.
    pub async fn search_messages(&self, query: &str, top: u32) -> Result<MessagesPage> {
        // Dubbele quotes in de zoekterm breken de `$search="…"`-syntax; strip ze.
        let search = format!("\"{}\"", query.replace('"', " "));
        let top = top.to_string();
        let resp = self
            .http
            .get(format!("{BASE}/me/messages"))
            .bearer_auth(&self.token)
            .query(&[
                ("$search", search.as_str()),
                ("$select", MSG_SELECT),
                ("$top", top.as_str()),
            ])
            .send()
            .await?;
        let list: GraphList<Message> = self.parse(resp).await?;
        Ok(MessagesPage {
            has_more: list.next_link.is_some(),
            messages: list.value,
        })
    }

    pub async fn set_read(&self, id: &str, is_read: bool) -> Result<()> {
        let resp = self
            .http
            .patch(format!("{BASE}/me/messages/{id}"))
            .bearer_auth(&self.token)
            .json(&json!({ "isRead": is_read }))
            .send()
            .await?;
        self.expect_ok(resp).await
    }

    pub async fn set_flag(&self, id: &str, flagged: bool) -> Result<()> {
        let status = if flagged { "flagged" } else { "notFlagged" };
        let resp = self
            .http
            .patch(format!("{BASE}/me/messages/{id}"))
            .bearer_auth(&self.token)
            .json(&json!({ "flag": { "flagStatus": status } }))
            .send()
            .await?;
        self.expect_ok(resp).await
    }

    /// Verwijdert een bericht (Graph verplaatst het naar Verwijderde items).
    pub async fn delete_message(&self, id: &str) -> Result<()> {
        let resp = self
            .http
            .delete(format!("{BASE}/me/messages/{id}"))
            .bearer_auth(&self.token)
            .send()
            .await?;
        self.expect_ok(resp).await
    }

    pub async fn move_message(&self, id: &str, destination_id: &str) -> Result<()> {
        let resp = self
            .http
            .post(format!("{BASE}/me/messages/{id}/move"))
            .bearer_auth(&self.token)
            .json(&json!({ "destinationId": destination_id }))
            .send()
            .await?;
        self.expect_ok(resp).await
    }

    /// Beantwoordt een vergaderuitnodiging (eventMessageRequest) namens de
    /// gebruiker: zoekt het bijbehorende event op en accepteert/weigert dat.
    pub async fn rsvp(&self, message_id: &str, response: &str) -> Result<()> {
        let action = match response {
            "accept" => "accept",
            "tentative" => "tentativelyAccept",
            "decline" => "decline",
            _ => bail!("Onbekend antwoord op uitnodiging: {response}"),
        };

        #[derive(serde::Deserialize)]
        struct Ev {
            id: String,
        }
        #[derive(serde::Deserialize)]
        struct Msg {
            event: Option<Ev>,
        }
        // Cast naar eventMessage om de gekoppelde afspraak te kunnen expanden.
        let url = format!(
            "{BASE}/me/messages/{message_id}?$select=id&$expand=microsoft.graph.eventMessage/event($select=id)"
        );
        let m: Msg = self.get_json(&url).await?;
        let ev = m.event.ok_or_else(|| {
            anyhow::anyhow!("Geen afspraak gevonden bij deze uitnodiging (mogelijk al verlopen).")
        })?;

        let resp = self
            .http
            .post(format!("{BASE}/me/events/{}/{action}", ev.id))
            .bearer_auth(&self.token)
            .json(&json!({ "sendResponse": true }))
            .send()
            .await?;
        self.expect_ok(resp).await
    }

    // ---- Bijlagen ----

    /// Bijlage-metadata van een bericht (zonder inhoud - die kan groot zijn).
    pub async fn list_attachments(&self, message_id: &str) -> Result<Vec<Attachment>> {
        let url = format!(
            "{BASE}/me/messages/{message_id}/attachments?$select=id,name,contentType,size,isInline"
        );
        let list: GraphList<Attachment> = self.get_json(&url).await?;
        Ok(list.value)
    }

    /// Downloadt een bijlage naar de Downloads-map en geeft het volledige pad terug.
    pub async fn download_attachment(&self, message_id: &str, attachment_id: &str) -> Result<String> {
        /// Antwoord van Graph mét inhoud (alleen fileAttachment heeft contentBytes).
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Content {
            #[serde(default)]
            name: Option<String>,
            #[serde(default)]
            content_bytes: Option<String>,
        }

        let url = format!("{BASE}/me/messages/{message_id}/attachments/{attachment_id}");
        let att: Content = self.get_json(&url).await?;
        let b64 = att.content_bytes.ok_or_else(|| {
            anyhow::anyhow!("Deze bijlage is geen los bestand (bv. een bijgevoegde mail) en kan niet worden gedownload.")
        })?;

        use base64::Engine as _;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64.as_bytes())
            .context("Kon de bijlage-inhoud niet decoderen")?;

        let dir = dirs::download_dir()
            .ok_or_else(|| anyhow::anyhow!("Kon de Downloads-map niet vinden"))?;
        let path = unique_path(&dir, &sanitize_filename(att.name.as_deref().unwrap_or("bijlage")));
        std::fs::write(&path, bytes).context("Kon het bestand niet opslaan in Downloads")?;
        Ok(path.to_string_lossy().into_owned())
    }

    /// Inline (cid:) afbeeldingen van een bericht, met inhoud als base64.
    /// De HTML-body verwijst met `src="cid:<contentId>"` naar deze bijlagen;
    /// de frontend zet ze om naar data-URI's zodat ze echt zichtbaar zijn.
    pub async fn inline_images(&self, message_id: &str) -> Result<Vec<InlineImage>> {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Content {
            #[serde(default)]
            content_id: Option<String>,
            #[serde(default)]
            content_type: Option<String>,
            #[serde(default)]
            content_bytes: Option<String>,
        }

        let mut out = Vec::new();
        for a in self.list_attachments(message_id).await? {
            if a.is_inline != Some(true) {
                continue;
            }
            if !a.content_type.as_deref().unwrap_or("").starts_with("image/") {
                continue;
            }
            let url = format!("{BASE}/me/messages/{message_id}/attachments/{}", a.id);
            let full: Content = self.get_json(&url).await?;
            if let (Some(cid), Some(bytes)) = (full.content_id, full.content_bytes) {
                out.push(InlineImage {
                    // Graph levert de contentId soms met omringende <>.
                    content_id: cid.trim_matches(|c| c == '<' || c == '>').to_string(),
                    content_type: full
                        .content_type
                        .unwrap_or_else(|| "image/png".to_string()),
                    content_bytes: bytes,
                });
            }
        }
        Ok(out)
    }

    /// Berichtvelden voor sendMail/concepten (zonder bijlagen).
    fn message_json(input: &ComposeInput) -> serde_json::Value {
        let importance = match input.importance.as_deref() {
            Some("high") => "high",
            Some("low") => "low",
            _ => "normal",
        };
        json!({
            "subject": input.subject,
            "importance": importance,
            "body": { "contentType": "HTML", "content": input.body_html },
            "toRecipients": recipients(&input.to),
            "ccRecipients": recipients(&input.cc),
            "bccRecipients": recipients(&input.bcc),
        })
    }

    fn attachment_json(a: &AttachmentInput) -> serde_json::Value {
        let mut v = json!({
            "@odata.type": "#microsoft.graph.fileAttachment",
            "name": a.name,
            "contentType": a.content_type.clone().unwrap_or_else(|| "application/octet-stream".into()),
            "contentBytes": a.content_base64,
        });
        // Ingesloten (cid:) afbeelding: de body-HTML verwijst met src="cid:...".
        if let Some(cid) = &a.content_id {
            v["contentId"] = json!(cid);
            v["isInline"] = json!(a.is_inline.unwrap_or(true));
        }
        v
    }

    pub async fn send_mail(&self, input: &ComposeInput) -> Result<()> {
        let mut message = Self::message_json(input);
        let attachments: Vec<_> = input.attachments.iter().map(Self::attachment_json).collect();
        message["attachments"] = json!(attachments);
        let body = json!({ "message": message, "saveToSentItems": true });
        let resp = self
            .http
            .post(format!("{BASE}/me/sendMail"))
            .bearer_auth(&self.token)
            .json(&body)
            .send()
            .await?;
        self.expect_ok(resp).await
    }

    // ---- Concepten ----

    /// Maakt een concept aan in de Concepten-map; geeft het bericht (met id) terug.
    pub async fn create_draft(&self, input: &ComposeInput) -> Result<Message> {
        let resp = self
            .http
            .post(format!("{BASE}/me/messages"))
            .bearer_auth(&self.token)
            .json(&Self::message_json(input))
            .send()
            .await?;
        self.parse(resp).await
    }

    /// Werkt een bestaand concept bij (alleen tekstvelden; bijlagen gaan pas mee bij verzenden).
    pub async fn update_draft(&self, id: &str, input: &ComposeInput) -> Result<()> {
        let resp = self
            .http
            .patch(format!("{BASE}/me/messages/{id}"))
            .bearer_auth(&self.token)
            .json(&Self::message_json(input))
            .send()
            .await?;
        self.expect_ok(resp).await
    }

    /// Verstuurt een bestaand concept: laatste velden bijwerken, bijlagen
    /// toevoegen, dan versturen. Het concept verdwijnt naar Verzonden items.
    /// Met `defer_utc` (ISO 8601 UTC) stelt Exchange de bezorging uit
    /// (PidTagDeferredSendTime, "later verzenden").
    pub async fn send_draft(&self, id: &str, input: &ComposeInput, defer_utc: Option<&str>) -> Result<()> {
        self.update_draft(id, input).await?;
        if let Some(when) = defer_utc {
            let resp = self
                .http
                .patch(format!("{BASE}/me/messages/{id}"))
                .bearer_auth(&self.token)
                .json(&json!({
                    "singleValueExtendedProperties": [
                        { "id": "SystemTime 0x3FEF", "value": when }
                    ]
                }))
                .send()
                .await?;
            self.expect_ok(resp).await?;
        }
        // Bijlagen die al op het concept staan eerst weghalen, zodat een eerdere
        // (mislukte) verzendpoging geen dubbele bijlagen oplevert.
        for existing in self.list_attachments(id).await? {
            let resp = self
                .http
                .delete(format!("{BASE}/me/messages/{id}/attachments/{}", existing.id))
                .bearer_auth(&self.token)
                .send()
                .await?;
            self.expect_ok(resp).await?;
        }
        for a in &input.attachments {
            let resp = self
                .http
                .post(format!("{BASE}/me/messages/{id}/attachments"))
                .bearer_auth(&self.token)
                .json(&Self::attachment_json(a))
                .send()
                .await?;
            self.expect_ok(resp).await?;
        }
        let resp = self
            .http
            .post(format!("{BASE}/me/messages/{id}/send"))
            .bearer_auth(&self.token)
            .send()
            .await?;
        self.expect_ok(resp).await
    }

    // ---- Agenda ----
    pub async fn list_events(&self, start_iso: &str, end_iso: &str) -> Result<Vec<Event>> {
        let url = format!("{BASE}/me/calendarView");
        let resp = self
            .http
            .get(&url)
            .bearer_auth(&self.token)
            .header("Prefer", format!("outlook.timezone=\"{DEFAULT_TZ}\""))
            .query(&[
                ("startDateTime", start_iso),
                ("endDateTime", end_iso),
                ("$select", "id,subject,bodyPreview,start,end,isAllDay,location,organizer,isCancelled"),
                ("$orderby", "start/dateTime"),
                ("$top", "200"),
            ])
            .send()
            .await?;
        let list: GraphList<Event> = self.parse(resp).await?;
        Ok(list.value)
    }

    /// Bouwt de Graph-JSON voor een afspraak; gedeeld door aanmaken en bewerken.
    fn event_body(input: &EventInput) -> serde_json::Value {
        let tz = input.time_zone.clone().unwrap_or_else(|| DEFAULT_TZ.to_string());
        let attendees: Vec<_> = input
            .attendees
            .iter()
            .filter(|a| !a.trim().is_empty())
            .map(|a| json!({ "emailAddress": { "address": a }, "type": "required" }))
            .collect();

        let mut body = json!({
            "subject": input.subject,
            "isAllDay": input.is_all_day,
            "start": { "dateTime": input.start, "timeZone": tz },
            "end": { "dateTime": input.end, "timeZone": tz },
            "body": { "contentType": "HTML", "content": input.body.clone().unwrap_or_default() },
        });
        // Bij een PATCH vervangt een lege attendees-lijst álle genodigden; laat het
        // veld dan weg zodat bestaande genodigden intact blijven.
        if !attendees.is_empty() {
            body["attendees"] = json!(attendees);
        }
        // Locatie altijd meesturen: een lege waarde wist een eerdere locatie bewust.
        body["location"] = json!({ "displayName": input.location.clone().unwrap_or_default() });
        match input.reminder_minutes {
            Some(min) => {
                body["isReminderOn"] = json!(true);
                body["reminderMinutesBeforeStart"] = json!(min);
            }
            None => body["isReminderOn"] = json!(false),
        }
        if let Some(rec) = &input.recurrence {
            if let Some(recurrence) = recurrence_json(rec, &input.start) {
                body["recurrence"] = recurrence;
            }
        }
        body
    }

    pub async fn create_event(&self, input: &EventInput) -> Result<Event> {
        let resp = self
            .http
            .post(format!("{BASE}/me/events"))
            .bearer_auth(&self.token)
            .json(&Self::event_body(input))
            .send()
            .await?;
        self.parse(resp).await
    }

    /// Verschuift alleen de tijden van een afspraak (voor slepen in de agenda).
    /// Exchange stuurt genodigden automatisch een bijgewerkte uitnodiging.
    pub async fn update_event_times(&self, id: &str, start: &str, end: &str) -> Result<()> {
        let resp = self
            .http
            .patch(format!("{BASE}/me/events/{id}"))
            .bearer_auth(&self.token)
            .json(&json!({
                "start": { "dateTime": start, "timeZone": DEFAULT_TZ },
                "end": { "dateTime": end, "timeZone": DEFAULT_TZ },
            }))
            .send()
            .await?;
        self.expect_ok(resp).await
    }

    /// Personen uit de organisatie/contacten zoeken (autoaanvullen genodigden).
    pub async fn search_people(&self, query: &str) -> Result<Vec<Person>> {
        let q = format!("\"{}\"", query.replace('"', " "));
        let resp = self
            .http
            .get(format!("{BASE}/me/people"))
            .bearer_auth(&self.token)
            .query(&[
                ("$search", q.as_str()),
                ("$select", "displayName,scoredEmailAddresses"),
                ("$top", "8"),
            ])
            .send()
            .await?;
        let list: GraphList<Person> = self.parse(resp).await?;
        Ok(list.value)
    }

    pub async fn update_event(&self, id: &str, input: &EventInput) -> Result<Event> {
        let resp = self
            .http
            .patch(format!("{BASE}/me/events/{id}"))
            .bearer_auth(&self.token)
            .json(&Self::event_body(input))
            .send()
            .await?;
        self.parse(resp).await
    }

    pub async fn delete_event(&self, id: &str) -> Result<()> {
        let resp = self
            .http
            .delete(format!("{BASE}/me/events/{id}"))
            .bearer_auth(&self.token)
            .send()
            .await?;
        self.expect_ok(resp).await
    }
}

fn recipients(addresses: &[String]) -> Vec<serde_json::Value> {
    addresses
        .iter()
        .filter(|a| !a.trim().is_empty())
        .map(|a| json!({ "emailAddress": { "address": a.trim() } }))
        .collect()
}

/// Bouwt de Graph `recurrence`-JSON. Weekdag/dag-van-de-maand komen uit de
/// startdatum ("YYYY-MM-DD…"); onherkenbare invoer levert None (geen herhaling).
fn recurrence_json(rec: &crate::models::RecurrenceInput, start: &str) -> Option<serde_json::Value> {
    use chrono::Datelike;
    let date = chrono::NaiveDate::parse_from_str(start.get(..10)?, "%Y-%m-%d").ok()?;
    let interval = rec.interval.unwrap_or(1).max(1);

    let mut pattern = json!({ "interval": interval });
    match rec.frequency.as_str() {
        "daily" => pattern["type"] = json!("daily"),
        "weekly" => {
            pattern["type"] = json!("weekly");
            let dow = match date.weekday() {
                chrono::Weekday::Mon => "monday",
                chrono::Weekday::Tue => "tuesday",
                chrono::Weekday::Wed => "wednesday",
                chrono::Weekday::Thu => "thursday",
                chrono::Weekday::Fri => "friday",
                chrono::Weekday::Sat => "saturday",
                chrono::Weekday::Sun => "sunday",
            };
            pattern["daysOfWeek"] = json!([dow]);
        }
        "monthly" => {
            pattern["type"] = json!("absoluteMonthly");
            pattern["dayOfMonth"] = json!(date.day());
        }
        "yearly" => {
            pattern["type"] = json!("absoluteYearly");
            pattern["dayOfMonth"] = json!(date.day());
            pattern["month"] = json!(date.month());
        }
        _ => return None,
    }

    let range = match rec.until.as_deref().filter(|s| !s.trim().is_empty()) {
        Some(end) => json!({
            "type": "endDate",
            "startDate": date.to_string(),
            "endDate": end,
        }),
        None => json!({ "type": "noEnd", "startDate": date.to_string() }),
    };

    Some(json!({ "pattern": pattern, "range": range }))
}

/// Haalt tekens uit een bestandsnaam die op Windows niet mogen (en padscheiders).
fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "bijlage".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Geeft een pad dat nog niet bestaat: "naam.pdf", anders "naam (1).pdf", enz.
fn unique_path(dir: &std::path::Path, filename: &str) -> std::path::PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match filename.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (filename.to_string(), String::new()),
    };
    for i in 1..1000 {
        let p = dir.join(format!("{stem} ({i}){ext}"));
        if !p.exists() {
            return p;
        }
    }
    dir.join(filename)
}

/// Kort een lange (fout)tekst in zodat foutmeldingen leesbaar blijven.
fn short(text: &str) -> String {
    let t = text.trim();
    if t.chars().count() > 400 {
        let cut: String = t.chars().take(400).collect();
        format!("{cut}…")
    } else {
        t.to_string()
    }
}
