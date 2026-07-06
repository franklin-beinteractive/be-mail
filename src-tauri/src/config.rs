//! App-configuratie: het (niet-geheime) Azure Client-ID en Tenant-ID.
//! Wordt als JSON opgeslagen in de configmap van de gebruiker, zodat je de app
//! kunt instellen zonder opnieuw te compileren. Zonder config.json vallen we
//! terug op de ingebakken standaardwaarden hieronder: een nieuwe installatie
//! slaat daardoor het instelscherm over en kan direct via de browser inloggen.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

fn default_true() -> bool {
    true
}

/// Ingebakken Client-ID en Tenant-ID van de Azure App Registration (geen
/// geheimen; zie docs/Azure-App-Registration.md). Via Instellingen ->
/// Verbinding blijven ze te overschrijven; een opgeslagen config.json wint.
/// Leeg laten = instelscherm tonen bij de eerste start (oude gedrag).
const DEFAULT_CLIENT_ID: &str = "3e37ac32-2e67-441e-b925-79fab2684451";
const DEFAULT_TENANT_ID: &str = "58cc86ad-a1e7-4880-a8e8-8d31f68240b3";

fn default_config() -> AppConfig {
    AppConfig {
        client_id: DEFAULT_CLIENT_ID.to_string(),
        tenant_id: DEFAULT_TENANT_ID.to_string(),
        notifications_enabled: true,
        accounts: Vec::new(),
        active_account: None,
    }
}

/// Gekoppeld Office 365-account (tokens staan apart in de keychain).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAccount {
    /// Graph user-id; tevens de sleutel in de token-store.
    pub id: String,
    #[serde(default)]
    pub mail: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// Application (client) ID uit de Azure App Registration.
    pub client_id: String,
    /// Tenant-ID (GUID) of "organizations" / "common". Leeg => "organizations".
    #[serde(default)]
    pub tenant_id: String,
    /// Desktop-notificaties bij nieuwe mail (poller leest dit elke ronde).
    #[serde(default = "default_true")]
    pub notifications_enabled: bool,
    /// Gekoppelde accounts (multi-account).
    #[serde(default)]
    pub accounts: Vec<StoredAccount>,
    /// Id van het account waar mail-/agenda-acties op werken.
    #[serde(default)]
    pub active_account: Option<String>,
}

impl AppConfig {
    /// De authority-URL voor OAuth2 (login.microsoftonline.com/{tenant}).
    pub fn authority(&self) -> String {
        let tenant = if self.tenant_id.trim().is_empty() {
            "organizations"
        } else {
            self.tenant_id.trim()
        };
        format!("https://login.microsoftonline.com/{tenant}")
    }

    pub fn is_complete(&self) -> bool {
        !self.client_id.trim().is_empty()
    }
}

/// De app-map van de gebruiker (%APPDATA%\BE-Mail); ook voor de offline cache.
pub fn data_dir() -> Result<PathBuf> {
    let base = dirs::config_dir().context("Kon de configmap van de gebruiker niet vinden")?;
    Ok(base.join("BE-Mail"))
}

fn config_dir() -> Result<PathBuf> {
    data_dir()
}

fn config_path() -> Result<PathBuf> {
    Ok(config_dir()?.join("config.json"))
}

/// Leest de config van schijf. Zonder config.json vallen we terug op de
/// ingebakken standaardwaarden; `None` alleen als die ook leeg zijn.
pub fn load() -> Result<Option<AppConfig>> {
    let path = config_path()?;
    if !path.exists() {
        if DEFAULT_CLIENT_ID.trim().is_empty() {
            return Ok(None);
        }
        return Ok(Some(default_config()));
    }
    let text = std::fs::read_to_string(&path)
        .with_context(|| format!("Kon config niet lezen: {}", path.display()))?;
    let cfg: AppConfig = serde_json::from_str(&text).context("Config-bestand is ongeldig")?;
    Ok(Some(cfg))
}

/// Schrijft de config naar schijf.
pub fn save(cfg: &AppConfig) -> Result<()> {
    let dir = config_dir()?;
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("Kon configmap niet aanmaken: {}", dir.display()))?;
    let text = serde_json::to_string_pretty(cfg)?;
    std::fs::write(config_path()?, text).context("Kon config niet opslaan")?;
    Ok(())
}
