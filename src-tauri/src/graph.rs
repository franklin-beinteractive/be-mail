//! Microsoft Graph API-client (v1.0). Alle netwerkverkeer naar Office 365 loopt
//! hier, in de Rust-kern — nooit vanuit de webview.

use crate::auth;
use crate::config::AppConfig;
use crate::models::*;
use anyhow::{bail, Context, Result};
use serde::de::DeserializeOwned;
use serde_json::json;

const BASE: &str = "https://graph.microsoft.com/v1.0";
/// Standaard tijdzone (Windows-notatie zoals Graph die verwacht).
const DEFAULT_TZ: &str = "W. Europe Standard Time";

const MSG_SELECT: &str = "id,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isRead,hasAttachments,bodyPreview,importance,flag,webLink";

pub struct GraphClient {
    token: String,
    http: reqwest::Client,
}

impl GraphClient {
    pub async fn new(config: &AppConfig) -> Result<Self> {
        let token = auth::valid_access_token(config).await?;
        Ok(Self {
            token,
            http: reqwest::Client::new(),
        })
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
    pub async fn list_folders(&self) -> Result<Vec<MailFolder>> {
        let url = format!(
            "{BASE}/me/mailFolders?$top=100&$select=id,displayName,unreadItemCount,totalItemCount"
        );
        let list: GraphList<MailFolder> = self.get_json(&url).await?;
        Ok(list.value)
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
        let url = format!(
            "{BASE}/me/messages/{id}?$select={MSG_SELECT},body",
        );
        self.get_json(&url).await
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

    pub async fn send_mail(&self, input: &ComposeInput) -> Result<()> {
        let to = recipients(&input.to);
        let cc = recipients(&input.cc);
        let bcc = recipients(&input.bcc);
        let importance = match input.importance.as_deref() {
            Some("high") => "high",
            Some("low") => "low",
            _ => "normal",
        };
        let body = json!({
            "message": {
                "subject": input.subject,
                "importance": importance,
                "body": { "contentType": "HTML", "content": input.body_html },
                "toRecipients": to,
                "ccRecipients": cc,
                "bccRecipients": bcc,
            },
            "saveToSentItems": true
        });
        let resp = self
            .http
            .post(format!("{BASE}/me/sendMail"))
            .bearer_auth(&self.token)
            .json(&body)
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

    pub async fn create_event(&self, input: &EventInput) -> Result<Event> {
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
            "attendees": attendees,
        });
        if let Some(loc) = &input.location {
            body["location"] = json!({ "displayName": loc });
        }
        if let Some(min) = input.reminder_minutes {
            body["isReminderOn"] = json!(true);
            body["reminderMinutesBeforeStart"] = json!(min);
        }

        let resp = self
            .http
            .post(format!("{BASE}/me/events"))
            .bearer_auth(&self.token)
            .json(&body)
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
