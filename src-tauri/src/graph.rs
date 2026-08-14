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

const MSG_SELECT: &str = "id,subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,sentDateTime,isRead,hasAttachments,bodyPreview,importance,flag,webLink,isDraft,categories,conversationId";

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
        ascending: bool,
        filter: Option<&str>, // "unread" | "flagged"
    ) -> Result<MessagesPage> {
        let order = if ascending { "asc" } else { "desc" };
        let mut url = format!(
            "{BASE}/me/mailFolders/{folder}/messages?$select={sel}&$top={top}&$skip={skip}&$orderby=receivedDateTime%20{order}",
            folder = folder_id,
            sel = MSG_SELECT,
        );
        match filter {
            Some("unread") => url.push_str("&$filter=isRead%20eq%20false"),
            Some("flagged") => url.push_str("&$filter=flag/flagStatus%20eq%20'flagged'"),
            _ => {}
        }
        let list: GraphList<Message> = self.get_json(&url).await?;
        Ok(MessagesPage {
            has_more: list.next_link.is_some(),
            messages: list.value,
            from_cache: false,
        })
    }

    /// Delta-sync van één map naar de offline cache. Hervat bij de opgeslagen
    /// delta-/nextLink en volgt max 10 pagina's per run (grote mailboxen raken
    /// zo stap voor stap gevuld; de link is hervatbaar over runs heen).
    pub async fn sync_folder_to_cache(&self, account_id: &str, folder_id: &str) -> Result<()> {
        #[derive(serde::Deserialize)]
        struct DeltaPage {
            #[serde(default)]
            value: Vec<serde_json::Value>,
            #[serde(rename = "@odata.nextLink", default)]
            next: Option<String>,
            #[serde(rename = "@odata.deltaLink", default)]
            delta: Option<String>,
        }

        let mut url = crate::cache::get_delta_link(account_id, folder_id)?
            .unwrap_or_else(|| {
                format!(
                    "{BASE}/me/mailFolders/{folder_id}/messages/delta?$select={MSG_SELECT}&$top=50"
                )
            });
        for _ in 0..10 {
            let resp = self.http.get(&url).bearer_auth(&self.token).send().await?;
            let page: DeltaPage = self.parse(resp).await?;
            let mut upserts = Vec::new();
            for v in page.value {
                if v.get("@removed").is_some() {
                    if let Some(id) = v.get("id").and_then(|x| x.as_str()) {
                        let _ = crate::cache::delete_message(account_id, id);
                    }
                    continue;
                }
                if let Ok(msg) = serde_json::from_value::<Message>(v) {
                    upserts.push(msg);
                }
            }
            let _ = crate::cache::save_messages(account_id, folder_id, &upserts);
            match (page.next, page.delta) {
                (Some(next), _) => {
                    // Halverwege: nextLink opslaan zodat een volgende run verdergaat.
                    crate::cache::set_delta_link(account_id, folder_id, &next)?;
                    url = next;
                }
                (None, Some(delta)) => {
                    crate::cache::set_delta_link(account_id, folder_id, &delta)?;
                    break;
                }
                (None, None) => break,
            }
        }
        Ok(())
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

    /// Inbox-regels (messageRules) van het actieve account.
    pub async fn list_rules(&self) -> Result<Vec<MessageRule>> {
        let list: GraphList<MessageRule> = self
            .get_json(&format!("{BASE}/me/mailFolders/inbox/messageRules"))
            .await?;
        Ok(list.value)
    }

    /// Zet een inbox-regel aan of uit.
    pub async fn set_rule_enabled(&self, rule_id: &str, enabled: bool) -> Result<()> {
        let resp = self
            .http
            .patch(format!("{BASE}/me/mailFolders/inbox/messageRules/{rule_id}"))
            .bearer_auth(&self.token)
            .json(&json!({ "isEnabled": enabled }))
            .send()
            .await?;
        self.expect_ok(resp).await
    }

    /// Verwijdert een inbox-regel.
    pub async fn delete_rule(&self, rule_id: &str) -> Result<()> {
        let resp = self
            .http
            .delete(format!("{BASE}/me/mailFolders/inbox/messageRules/{rule_id}"))
            .bearer_auth(&self.token)
            .send()
            .await?;
        self.expect_ok(resp).await
    }

    // ---- Afwezigheid (automatisch antwoord) ----
    // Vereist de optionele scope MailboxSettings.ReadWrite (zie auth.rs).

    pub async fn get_auto_reply(&self) -> Result<AutoReplySettings> {
        self.get_json(&format!("{BASE}/me/mailboxSettings/automaticRepliesSetting"))
            .await
    }

    pub async fn set_auto_reply(&self, s: &AutoReplySettings) -> Result<()> {
        let resp = self
            .http
            .patch(format!("{BASE}/me/mailboxSettings"))
            .bearer_auth(&self.token)
            .json(&json!({ "automaticRepliesSetting": s }))
            .send()
            .await?;
        self.expect_ok(resp).await
    }

    // ---- Categorieën (kleurlabels) ----

    /// Master-categorieën van het postvak (vereist MailboxSettings-scope).
    pub async fn list_categories(&self) -> Result<Vec<OutlookCategory>> {
        let list: GraphList<OutlookCategory> = self
            .get_json(&format!("{BASE}/me/outlook/masterCategories"))
            .await?;
        Ok(list.value)
    }

    /// Zet de categorieën van een bericht (hele lijst; leeg = geen).
    pub async fn set_message_categories(
        &self,
        message_id: &str,
        categories: &[String],
    ) -> Result<()> {
        let resp = self
            .http
            .patch(format!("{BASE}/me/messages/{message_id}"))
            .bearer_auth(&self.token)
            .json(&json!({ "categories": categories }))
            .send()
            .await?;
        self.expect_ok(resp).await
    }

    /// Doorzoekt de mailbox via Graph `$search`; met `folder_id` alleen die map,
    /// anders alle mappen. Let op: `$search` mag niet met `$orderby`
    /// gecombineerd worden - Graph sorteert zelf op relevantie.
    /// Uitgebreid zoeken: de losse velden worden één KQL-expressie voor
    /// `$search`. Graph kent `from:`, `to:`, `cc:`, `subject:`, `hasAttachment:`,
    /// `isRead:` en `received>=` / `received<=`.
    pub async fn search_advanced(
        &self,
        q: &SearchQuery,
        top: u32,
        folder_id: Option<&str>,
    ) -> Result<MessagesPage> {
        let mut parts: Vec<String> = Vec::new();
        let mut field = |name: &str, value: &Option<String>| {
            if let Some(v) = value.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
                parts.push(format!("{name}:{}", kql_value(v)));
            }
        };
        field("from", &q.from);
        field("to", &q.to);
        field("cc", &q.cc);
        field("subject", &q.subject);
        if let Some(v) = q.text.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
            parts.push(kql_value(v));
        }
        if let Some(d) = q.since.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
            parts.push(format!("received>={d}"));
        }
        if let Some(d) = q.until.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
            parts.push(format!("received<={d}"));
        }
        if let Some(read) = q.is_read {
            parts.push(format!("isRead:{read}"));
        }
        if q.has_attachments == Some(true) {
            parts.push("hasAttachment:true".to_string());
        }
        let kql = parts.join(" AND ");

        let top_s = top.to_string();
        let url = match folder_id {
            Some(id) => format!("{BASE}/me/mailFolders/{id}/messages"),
            None => format!("{BASE}/me/messages"),
        };
        let resp = self
            .http
            .get(url)
            .bearer_auth(&self.token)
            .query(&[
                ("$search", format!("\"{kql}\"").as_str()),
                ("$select", MSG_SELECT),
                ("$top", top_s.as_str()),
            ])
            .send()
            .await?;
        let list: GraphList<Message> = self.parse(resp).await?;
        Ok(MessagesPage {
            has_more: list.next_link.is_some(),
            messages: list.value,
            from_cache: false,
        })
    }

    pub async fn search_messages(
        &self,
        query: &str,
        top: u32,
        folder_id: Option<&str>,
    ) -> Result<MessagesPage> {
        // Dubbele quotes in de zoekterm breken de `$search="…"`-syntax; strip ze.
        let search = format!("\"{}\"", query.replace('"', " "));
        let top = top.to_string();
        let url = match folder_id {
            Some(id) => format!("{BASE}/me/mailFolders/{id}/messages"),
            None => format!("{BASE}/me/messages"),
        };
        let resp = self
            .http
            .get(url)
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
            from_cache: false,
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

    /// Als move_message, maar geeft het verplaatste bericht terug. Het id
    /// verandert bij verplaatsen; snoozen heeft het nieuwe id nodig om het
    /// bericht later terug te kunnen zetten.
    pub async fn move_message_returning(
        &self,
        id: &str,
        destination_id: &str,
    ) -> Result<Message> {
        let resp = self
            .http
            .post(format!("{BASE}/me/messages/{id}/move"))
            .bearer_auth(&self.token)
            .json(&json!({ "destinationId": destination_id }))
            .send()
            .await?;
        self.parse(resp).await
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

        crate::download::save_to_downloads(att.name.as_deref().unwrap_or("bijlage"), &bytes)
    }

    /// Slaat het hele bericht op als .eml (ruwe MIME) in de Downloads-map en
    /// geeft het pad terug. Graph levert de MIME via `/$value`; .eml opent in
    /// Outlook, Thunderbird en de meeste mailclients.
    pub async fn download_message(&self, message_id: &str) -> Result<String> {
        let subject: MessageSubject = self
            .get_json(&format!("{BASE}/me/messages/{message_id}?$select=subject"))
            .await
            .unwrap_or(MessageSubject { subject: None });

        let resp = self
            .http
            .get(format!("{BASE}/me/messages/{message_id}/$value"))
            .bearer_auth(&self.token)
            .send()
            .await
            .context("Netwerkfout richting Office 365")?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            bail!("Office 365 gaf een fout (HTTP {status}): {}", short(&text));
        }
        let bytes = resp
            .bytes()
            .await
            .context("Kon het bericht niet lezen")?;

        crate::download::write_eml(subject.subject.as_deref(), &bytes)
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
        // Grote bijlagen kunnen niet inline mee met sendMail; ga dan via een
        // concept (send_draft regelt upload-sessions per grote bijlage).
        if input.attachments.iter().any(Self::attachment_is_large) {
            let draft = self.create_draft(input).await?;
            return self.send_draft(&draft.id, input, None).await;
        }
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

    /// Te groot om inline mee te sturen? (Graph-limiet ~3 MB; marge houden.)
    fn attachment_is_large(a: &AttachmentInput) -> bool {
        // base64 → bytes: 3/4 van de tekstlengte.
        a.content_base64.len() / 4 * 3 > 2_500_000
    }

    /// Grote bijlage uploaden via een upload-session (stukken van 3,2 MB;
    /// de stukgrootte moet een veelvoud van 320 KiB zijn).
    async fn upload_large_attachment(
        &self,
        message_id: &str,
        a: &AttachmentInput,
    ) -> Result<()> {
        use base64::Engine as _;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(a.content_base64.as_bytes())
            .context("Kon de bijlage-inhoud niet decoderen")?;

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Session {
            upload_url: String,
        }
        let mut item = json!({
            "attachmentType": "file",
            "name": a.name,
            "size": bytes.len(),
        });
        if let Some(cid) = &a.content_id {
            item["contentId"] = json!(cid);
            item["isInline"] = json!(a.is_inline.unwrap_or(true));
        }
        let resp = self
            .http
            .post(format!(
                "{BASE}/me/messages/{message_id}/attachments/createUploadSession"
            ))
            .bearer_auth(&self.token)
            .json(&json!({ "AttachmentItem": item }))
            .send()
            .await?;
        let session: Session = self.parse(resp).await?;

        const CHUNK: usize = 10 * 327_680;
        let total = bytes.len();
        let mut offset = 0;
        while offset < total {
            let end = (offset + CHUNK).min(total);
            let resp = self
                .http
                .put(&session.upload_url)
                .bearer_auth(&self.token)
                .header("Content-Range", format!("bytes {}-{}/{}", offset, end - 1, total))
                .header("Content-Length", (end - offset).to_string())
                .body(bytes[offset..end].to_vec())
                .send()
                .await?;
            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                bail!("Upload van grote bijlage mislukt (HTTP {status}): {text}");
            }
            offset = end;
        }
        Ok(())
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
            if Self::attachment_is_large(a) {
                // Boven de inline-limiet: via een upload-session in stukken.
                self.upload_large_attachment(id, a).await?;
                continue;
            }
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
    /// Profile photo of a colleague as a `data:` URI, or None when there is
    /// none. Never an error: a missing avatar is normal (an external sender is
    /// not in the directory, and the optional `User.ReadBasic.All` scope may
    /// not be consented to), and it must never break the message list.
    pub async fn user_photo(&self, address: &str) -> Option<String> {
        if !is_plain_address(address) {
            return None;
        }
        self.photo_of(&format!("users/{address}")).await
    }

    /// Your own profile photo. Worth a separate call because `/me/photo` only
    /// needs `User.Read`, which every session has: in a tenant without consent
    /// for the directory scope your own messages still show a real photo.
    pub async fn my_photo(&self) -> Option<String> {
        self.photo_of("me").await
    }

    /// Asks for the 64x64 rendition first - a list avatar is 30px, while the
    /// original photo is often several hundred kB. Not every mailbox has the
    /// scaled versions, so the full-size photo is the fallback.
    async fn photo_of(&self, owner: &str) -> Option<String> {
        /// Upper bound; a profile photo is never this big and a runaway
        /// response should not end up in the cache (or in the webview).
        const MAX_BYTES: usize = 4 * 1024 * 1024;

        for size in ["photos/64x64", "photo"] {
            let resp = self
                .http
                .get(format!("{BASE}/{owner}/{size}/$value"))
                .bearer_auth(&self.token)
                .send()
                .await
                .ok()?;
            if !resp.status().is_success() {
                continue; // 404 = no photo (or no such rendition), 403 = no consent
            }
            let mime = resp
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .filter(|v| v.starts_with("image/"))
                .unwrap_or("image/jpeg")
                .to_string();
            let bytes = resp.bytes().await.ok()?;
            if bytes.is_empty() || bytes.len() > MAX_BYTES {
                return None;
            }
            use base64::Engine as _;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            return Some(format!("data:{mime};base64,{b64}"));
        }
        None
    }

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

/// Waarde voor een KQL-veld. Meerdere woorden moeten tussen enkele quotes,
/// anders leest Graph alleen het eerste woord als waarde. De hele expressie
/// zit al in dubbele quotes, dus die halen we hier weg.
fn kql_value(v: &str) -> String {
    let clean = v.replace('"', " ");
    if clean.contains(char::is_whitespace) {
        format!("'{}'", clean.replace('\'', " "))
    } else {
        clean
    }
}

/// Minimale projectie: alleen het onderwerp, voor de bestandsnaam van een .eml.
#[derive(serde::Deserialize)]
struct MessageSubject {
    #[serde(default)]
    subject: Option<String>,
}

/// Is this a plain e-mail address, safe to paste into a Graph URL path?
/// Anything with a slash, a query marker or whitespace could steer the request
/// at a different endpoint, so those are refused rather than escaped.
fn is_plain_address(address: &str) -> bool {
    !address.is_empty()
        && address.len() <= 320
        && address.contains('@')
        && address
            .chars()
            .all(|c| !c.is_whitespace() && !c.is_control() && !"/\\?#%&'\"<>".contains(c))
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

// =====================================================================
// Tests
// =====================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kql_value_quote_alleen_bij_spaties() {
        // Eén woord: onveranderd, anders zou Graph de quotes meezoeken.
        assert_eq!(kql_value("bart@x.nl"), "bart@x.nl");
        // Meerdere woorden moeten samen als één waarde gelezen worden.
        assert_eq!(kql_value("Bart van Esch"), "'Bart van Esch'");
        // Dubbele quotes zouden de omhullende $search="..." breken.
        assert_eq!(kql_value("zeg \"hallo\""), "'zeg  hallo '");
    }

    #[test]
    fn photo_address_must_be_a_plain_address() {
        assert!(is_plain_address("bart@be-interactive.nl"));
        assert!(is_plain_address("timo.de.winter+mail@x.nl"));
        // No name part, no path tricks and no room for a second URL segment.
        assert!(!is_plain_address("Bart van Esch"));
        assert!(!is_plain_address("bart@x.nl/../me/messages"));
        assert!(!is_plain_address("bart@x.nl?$select=id"));
        assert!(!is_plain_address(""));
    }
}
