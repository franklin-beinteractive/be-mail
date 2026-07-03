//! Tauri-commands: de brug tussen de React-frontend en de Rust-kern.
//! Alle functies geven `Result<T, String>` terug zodat fouten netjes in de UI
//! belanden (in mensentaal, geen stacktraces).

use crate::auth;
use crate::config::{self, AppConfig, StoredAccount};
use crate::graph::GraphClient;
use crate::models::*;
use crate::token_store;

/// Kleine helper: laad een volledige config of geef een nette fout.
fn require_config() -> Result<AppConfig, String> {
    match config::load().map_err(|e| e.to_string())? {
        Some(cfg) if cfg.is_complete() => Ok(cfg),
        _ => Err("Nog geen verbinding ingesteld. Vul eerst je Client-ID in.".into()),
    }
}

/// Graph-client voor het actieve account.
async fn client() -> Result<GraphClient, String> {
    let cfg = require_config()?;
    let account = cfg
        .active_account
        .clone()
        .ok_or_else(|| "Niet ingelogd.".to_string())?;
    GraphClient::new(&cfg, &account).await.map_err(|e| e.to_string())
}

// ---- Configuratie ----

#[tauri::command]
pub fn get_config() -> Result<Option<AppConfig>, String> {
    config::load().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_config(client_id: String, tenant_id: String) -> Result<(), String> {
    // Bestaande overige instellingen (notificaties, accounts) bewaren.
    let existing = config::load().ok().flatten();
    let cfg = AppConfig {
        client_id: client_id.trim().to_string(),
        tenant_id: tenant_id.trim().to_string(),
        notifications_enabled: existing
            .as_ref()
            .map(|c| c.notifications_enabled)
            .unwrap_or(true),
        accounts: existing.as_ref().map(|c| c.accounts.clone()).unwrap_or_default(),
        active_account: existing.and_then(|c| c.active_account),
    };
    if !cfg.is_complete() {
        return Err("Client-ID mag niet leeg zijn.".into());
    }
    config::save(&cfg).map_err(|e| e.to_string())
}

/// Zet desktop-notificaties aan/uit (de poller leest dit elke ronde opnieuw).
#[tauri::command]
pub fn set_notifications_enabled(enabled: bool) -> Result<(), String> {
    let Some(mut cfg) = config::load().map_err(|e| e.to_string())? else {
        return Err("Nog geen verbinding ingesteld.".into());
    };
    cfg.notifications_enabled = enabled;
    config::save(&cfg).map_err(|e| e.to_string())
}

// ---- Authenticatie & accounts ----

#[tauri::command]
pub fn auth_status() -> bool {
    let Ok(Some(cfg)) = config::load() else { return false };
    match &cfg.active_account {
        Some(id) => auth::is_logged_in(id),
        None => false,
    }
}

/// Inloggen = een account koppelen (of opnieuw koppelen). Het nieuwe account
/// wordt meteen het actieve account.
#[tauri::command]
pub async fn login() -> Result<Account, String> {
    let cfg = require_config()?;
    let tokens = auth::login(&cfg).await.map_err(|e| e.to_string())?;
    // Wie is dit? Daarna pas opslaan, onder het juiste account-id.
    let gc = GraphClient::from_token(tokens.access_token.clone());
    let me = gc.me().await.map_err(|e| e.to_string())?;
    token_store::save(&me.id, &tokens).map_err(|e| e.to_string())?;

    let mut cfg = require_config()?;
    if !cfg.accounts.iter().any(|a| a.id == me.id) {
        cfg.accounts.push(StoredAccount {
            id: me.id.clone(),
            mail: me.mail.clone().or_else(|| me.user_principal_name.clone()),
            display_name: me.display_name.clone(),
        });
    }
    cfg.active_account = Some(me.id.clone());
    config::save(&cfg).map_err(|e| e.to_string())?;
    Ok(me)
}

/// Ontkoppel een account (of het actieve account als er geen id meegegeven is).
#[tauri::command]
pub fn logout(account_id: Option<String>) -> Result<(), String> {
    let mut cfg = require_config()?;
    let Some(id) = account_id.or_else(|| cfg.active_account.clone()) else {
        return Ok(());
    };
    auth::logout(&id).map_err(|e| e.to_string())?;
    cfg.accounts.retain(|a| a.id != id);
    if cfg.active_account.as_deref() == Some(id.as_str()) {
        cfg.active_account = cfg.accounts.first().map(|a| a.id.clone());
    }
    config::save(&cfg).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_accounts() -> Result<AccountsInfo, String> {
    let cfg = require_config()?;
    Ok(AccountsInfo {
        accounts: cfg.accounts,
        active: cfg.active_account,
    })
}

/// Wissel het actieve account (mail-/agenda-acties werken daarna hierop).
#[tauri::command]
pub fn set_active_account(id: String) -> Result<(), String> {
    let mut cfg = require_config()?;
    if !cfg.accounts.iter().any(|a| a.id == id) {
        return Err("Onbekend account.".into());
    }
    cfg.active_account = Some(id);
    config::save(&cfg).map_err(|e| e.to_string())
}

/// Mappen van álle gekoppelde accounts (voor de zijbalk). Accounts waarvan de
/// sessie stuk is, komen terug met een lege mappenlijst i.p.v. een harde fout.
#[tauri::command]
pub async fn list_all_folders() -> Result<Vec<AccountFolders>, String> {
    let cfg = require_config()?;
    let mut out = Vec::new();
    for acc in &cfg.accounts {
        let folders = match GraphClient::new(&cfg, &acc.id).await {
            Ok(gc) => gc.list_folders().await.unwrap_or_default(),
            Err(_) => Vec::new(),
        };
        out.push(AccountFolders {
            account: acc.clone(),
            folders,
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn get_account() -> Result<Account, String> {
    client().await?.me().await.map_err(|e| e.to_string())
}

// ---- Mail ----

#[tauri::command]
pub async fn list_folders() -> Result<Vec<MailFolder>, String> {
    client().await?.list_folders().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_folder(name: String) -> Result<MailFolder, String> {
    client().await?.create_folder(&name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_folder(id: String, name: String) -> Result<(), String> {
    client().await?.rename_folder(&id, &name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_folder(id: String) -> Result<(), String> {
    client().await?.delete_folder(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn move_folder(id: String, destination_id: String) -> Result<(), String> {
    client()
        .await?
        .move_folder(&id, &destination_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_messages(
    folder_id: String,
    top: Option<u32>,
    skip: Option<u32>,
) -> Result<MessagesPage, String> {
    client()
        .await?
        .list_messages(&folder_id, top.unwrap_or(25), skip.unwrap_or(0))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_message(id: String) -> Result<Message, String> {
    client().await?.get_message(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_read(id: String, is_read: bool) -> Result<(), String> {
    client().await?.set_read(&id, is_read).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_flag(id: String, flagged: bool) -> Result<(), String> {
    client().await?.set_flag(&id, flagged).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_message(id: String) -> Result<(), String> {
    client().await?.delete_message(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn move_message(id: String, destination_id: String) -> Result<(), String> {
    client()
        .await?
        .move_message(&id, &destination_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_message(input: ComposeInput) -> Result<(), String> {
    client().await?.send_mail(&input).await.map_err(|e| e.to_string())
}

/// Blokkeer een afzender (inbox-regel → Ongewenste e-mail).
#[tauri::command]
pub async fn block_sender(address: String) -> Result<(), String> {
    client().await?.block_sender(&address).await.map_err(|e| e.to_string())
}

/// Antwoord op een vergaderuitnodiging: "accept" | "tentative" | "decline".
#[tauri::command]
pub async fn rsvp_message(message_id: String, response: String) -> Result<(), String> {
    client().await?.rsvp(&message_id, &response).await.map_err(|e| e.to_string())
}

// ---- Concepten ----

#[tauri::command]
pub async fn create_draft(input: ComposeInput) -> Result<Message, String> {
    client().await?.create_draft(&input).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_draft(id: String, input: ComposeInput) -> Result<(), String> {
    client().await?.update_draft(&id, &input).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_draft(
    id: String,
    input: ComposeInput,
    scheduled_utc: Option<String>,
) -> Result<(), String> {
    client()
        .await?
        .send_draft(&id, &input, scheduled_utc.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_attachments(message_id: String) -> Result<Vec<Attachment>, String> {
    client()
        .await?
        .list_attachments(&message_id)
        .await
        .map_err(|e| e.to_string())
}

/// Verplaatst een bericht en geeft het verplaatste bericht (nieuw id) terug.
#[tauri::command]
pub async fn move_message_returning(
    message_id: String,
    destination_id: String,
) -> Result<Message, String> {
    client()
        .await?
        .move_message_returning(&message_id, &destination_id)
        .await
        .map_err(|e| e.to_string())
}

/// Inbox-regels (voor het regels-beheer in Instellingen).
#[tauri::command]
pub async fn list_rules() -> Result<Vec<MessageRule>, String> {
    client().await?.list_rules().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_rule_enabled(rule_id: String, enabled: bool) -> Result<(), String> {
    client()
        .await?
        .set_rule_enabled(&rule_id, enabled)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_rule(rule_id: String) -> Result<(), String> {
    client()
        .await?
        .delete_rule(&rule_id)
        .await
        .map_err(|e| e.to_string())
}

/// Afwezigheid / automatisch antwoord (vereist MailboxSettings-consent).
#[tauri::command]
pub async fn get_auto_reply() -> Result<AutoReplySettings, String> {
    client().await?.get_auto_reply().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_auto_reply(settings: AutoReplySettings) -> Result<(), String> {
    client()
        .await?
        .set_auto_reply(&settings)
        .await
        .map_err(|e| e.to_string())
}

/// Master-categorieën (kleurlabels) van het postvak.
#[tauri::command]
pub async fn list_categories() -> Result<Vec<OutlookCategory>, String> {
    client().await?.list_categories().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_message_categories(
    message_id: String,
    categories: Vec<String>,
) -> Result<(), String> {
    client()
        .await?
        .set_message_categories(&message_id, &categories)
        .await
        .map_err(|e| e.to_string())
}

/// Inline (cid:) afbeeldingen van een bericht, voor weergave in het leesvenster.
#[tauri::command]
pub async fn inline_images(message_id: String) -> Result<Vec<InlineImage>, String> {
    client()
        .await?
        .inline_images(&message_id)
        .await
        .map_err(|e| e.to_string())
}

/// Downloadt een bijlage naar de Downloads-map; geeft het opgeslagen pad terug.
#[tauri::command]
pub async fn download_attachment(
    message_id: String,
    attachment_id: String,
) -> Result<String, String> {
    client()
        .await?
        .download_attachment(&message_id, &attachment_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_messages(query: String, top: Option<u32>) -> Result<MessagesPage, String> {
    client()
        .await?
        .search_messages(&query, top.unwrap_or(50))
        .await
        .map_err(|e| e.to_string())
}

// ---- Agenda ----

#[tauri::command]
pub async fn list_events(start: String, end: String) -> Result<Vec<Event>, String> {
    client()
        .await?
        .list_events(&start, &end)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_event(input: EventInput) -> Result<Event, String> {
    client().await?.create_event(&input).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_event(id: String, input: EventInput) -> Result<Event, String> {
    client().await?.update_event(&id, &input).await.map_err(|e| e.to_string())
}

/// Alleen de tijden verschuiven (slepen in de agenda).
#[tauri::command]
pub async fn update_event_times(id: String, start: String, end: String) -> Result<(), String> {
    client()
        .await?
        .update_event_times(&id, &start, &end)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_people(query: String) -> Result<Vec<Person>, String> {
    client().await?.search_people(&query).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_event(id: String) -> Result<(), String> {
    client().await?.delete_event(&id).await.map_err(|e| e.to_string())
}
