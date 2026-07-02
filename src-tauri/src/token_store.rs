//! Veilige opslag van OAuth2-tokens in de OS-keychain (Windows Credential Manager),
//! met een aparte token-set per account (sleutel = Graph user-id).
//! De tokens raken de webview/JavaScript nooit; alleen de Rust-kern leest ze.
//!
//! Let op: Windows Credential Manager begrenst één credential-blob tot 2560 bytes
//! (UTF-16, dus ~1280 tekens). Microsoft-tokens zijn vaak groter dan dat, daarom
//! splitsen we de JSON in stukken over meerdere credential-items. Item
//! `office365-tokens-{account}` bevat het aantal stukken (de "index");
//! `office365-tokens-{account}-0`, `-1`, ... bevatten de stukken zelf.

use anyhow::{Context, Result};
use keyring::Entry;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "BE-Mail";
const PREFIX: &str = "office365-tokens";
/// Aantal tekens per stuk. UTF-16 = 2 bytes/teken, dus 1000 tekens = 2000 bytes,
/// ruim onder de Windows-limiet van 2560 bytes per credential-blob.
const CHUNK_CHARS: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenSet {
    pub access_token: String,
    pub refresh_token: String,
    /// Unix-tijd (seconden) waarop het access_token verloopt (met veiligheidsmarge).
    pub expires_at: i64,
    #[serde(default)]
    pub scope: String,
}

fn entry(account: &str) -> Result<Entry> {
    Entry::new(SERVICE, account).context("Kon keychain-item niet openen")
}

fn index_name(key: &str) -> String {
    format!("{PREFIX}-{key}")
}

fn chunk_name(key: &str, i: usize) -> String {
    format!("{PREFIX}-{key}-{i}")
}

pub fn save(key: &str, tokens: &TokenSet) -> Result<()> {
    let json = serde_json::to_string(tokens)?;
    let chars: Vec<char> = json.chars().collect();
    let chunks: Vec<String> = chars
        .chunks(CHUNK_CHARS)
        .map(|c| c.iter().collect())
        .collect();

    // Eerst de losse stukken wegschrijven...
    for (i, chunk) in chunks.iter().enumerate() {
        entry(&chunk_name(key, i))?
            .set_password(chunk)
            .context("Kon tokens niet opslaan in de keychain")?;
    }
    // ...daarna het aantal stukken als index (markeert pas nu een geldige set).
    entry(&index_name(key))?
        .set_password(&chunks.len().to_string())
        .context("Kon tokens niet opslaan in de keychain")?;

    // Ruim eventuele stukken van een eerdere, langere set op.
    let mut i = chunks.len();
    while let Ok(e) = entry(&chunk_name(key, i)) {
        match e.delete_credential() {
            Ok(()) => i += 1,
            Err(_) => break,
        }
    }
    Ok(())
}

/// Laadt tokens voor een account. `None` als er (nog) niets opgeslagen is.
pub fn load(key: &str) -> Result<Option<TokenSet>> {
    let count: usize = match entry(&index_name(key))?.get_password() {
        Ok(s) => s.trim().parse().context("Opgeslagen tokens zijn beschadigd")?,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => return Err(e).context("Kon tokens niet uit de keychain lezen"),
    };

    let mut json = String::new();
    for i in 0..count {
        let part = entry(&chunk_name(key, i))?
            .get_password()
            .context("Kon tokens niet uit de keychain lezen")?;
        json.push_str(&part);
    }

    let tokens: TokenSet =
        serde_json::from_str(&json).context("Opgeslagen tokens zijn beschadigd")?;
    Ok(Some(tokens))
}

pub fn clear(key: &str) -> Result<()> {
    // Aantal stukken opzoeken; lukt dat niet, dan best-effort opruimen.
    let count = match entry(&index_name(key))?.get_password() {
        Ok(s) => s.trim().parse::<usize>().unwrap_or(0),
        _ => 0,
    };

    // Index verwijderen.
    match entry(&index_name(key))?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(e).context("Kon tokens niet verwijderen"),
    }
    // Alle stukken verwijderen.
    for i in 0..count {
        match entry(&chunk_name(key, i))?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(e).context("Kon tokens niet verwijderen"),
        }
    }
    Ok(())
}
