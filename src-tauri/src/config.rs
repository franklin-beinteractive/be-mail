//! App-configuratie: het (niet-geheime) Azure Client-ID en Tenant-ID.
//! Wordt als JSON opgeslagen in de configmap van de gebruiker, zodat je de app
//! kunt instellen zonder opnieuw te compileren.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

fn default_true() -> bool {
    true
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

fn config_dir() -> Result<PathBuf> {
    let base = dirs::config_dir().context("Kon de configmap van de gebruiker niet vinden")?;
    Ok(base.join("BE-Mail"))
}

fn config_path() -> Result<PathBuf> {
    Ok(config_dir()?.join("config.json"))
}

/// Leest de config van schijf. `None` als er nog niets is ingesteld.
pub fn load() -> Result<Option<AppConfig>> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(None);
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
