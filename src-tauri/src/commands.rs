//! Tauri-commands: de brug tussen de React-frontend en de Rust-kern.
//! Alle functies geven `Result<T, String>` terug zodat fouten netjes in de UI
//! belanden (in mensentaal, geen stacktraces).

use crate::auth;
use crate::config::{self, AppConfig};
use crate::graph::GraphClient;
use crate::models::*;

/// Kleine helper: laad een volledige config of geef een nette fout.
fn require_config() -> Result<AppConfig, String> {
    match config::load().map_err(|e| e.to_string())? {
        Some(cfg) if cfg.is_complete() => Ok(cfg),
        _ => Err("Nog geen verbinding ingesteld. Vul eerst je Client-ID in.".into()),
    }
}

async fn client() -> Result<GraphClient, String> {
    let cfg = require_config()?;
    GraphClient::new(&cfg).await.map_err(|e| e.to_string())
}

// ---- Configuratie ----

#[tauri::command]
pub fn get_config() -> Result<Option<AppConfig>, String> {
    config::load().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_config(client_id: String, tenant_id: String) -> Result<(), String> {
    let cfg = AppConfig {
        client_id: client_id.trim().to_string(),
        tenant_id: tenant_id.trim().to_string(),
    };
    if !cfg.is_complete() {
        return Err("Client-ID mag niet leeg zijn.".into());
    }
    config::save(&cfg).map_err(|e| e.to_string())
}

// ---- Authenticatie ----

#[tauri::command]
pub fn auth_status() -> bool {
    auth::is_logged_in()
}

#[tauri::command]
pub async fn login() -> Result<Account, String> {
    let cfg = require_config()?;
    auth::login(&cfg).await.map_err(|e| e.to_string())?;
    let gc = GraphClient::new(&cfg).await.map_err(|e| e.to_string())?;
    gc.me().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn logout() -> Result<(), String> {
    auth::logout().map_err(|e| e.to_string())
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

#[tauri::command]
pub async fn list_attachments(message_id: String) -> Result<Vec<Attachment>, String> {
    client()
        .await?
        .list_attachments(&message_id)
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

#[tauri::command]
pub async fn delete_event(id: String) -> Result<(), String> {
    client().await?.delete_event(&id).await.map_err(|e| e.to_string())
}
