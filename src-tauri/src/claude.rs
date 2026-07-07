//! Claude API-integratie: antwoord-e-mails genereren in een gekozen stijl.
//! De API-sleutel staat in de OS-keychain (net als de Office-tokens) en raakt
//! de webview/JavaScript nooit; alle calls lopen via de Rust-kern.

use anyhow::{anyhow, Context, Result};
use keyring::Entry;
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;

const SERVICE: &str = "BE-Mail";
const KEY_NAME: &str = "anthropic-api-key";
const API_URL: &str = "https://api.anthropic.com/v1/messages";
/// Claude Opus 4.8: het meest capabele model voor tekstkwaliteit.
const MODEL: &str = "claude-opus-4-8";

fn entry() -> Result<Entry> {
    Entry::new(SERVICE, KEY_NAME).context("Kon keychain-item niet openen")
}

/// Slaat de API-sleutel op (past in één credential-item; sleutels zijn ~110
/// tekens, ruim onder de Windows-limiet van 2560 bytes).
pub fn save_key(key: &str) -> Result<()> {
    entry()?
        .set_password(key)
        .context("Kon de API-sleutel niet opslaan in de keychain")
}

pub fn clear_key() -> Result<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e).context("Kon de API-sleutel niet verwijderen"),
    }
}

pub fn load_key() -> Result<Option<String>> {
    match entry()?.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e).context("Kon de API-sleutel niet uit de keychain lezen"),
    }
}

#[derive(Deserialize)]
struct ApiResponse {
    #[serde(default)]
    content: Vec<ContentBlock>,
    #[serde(default)]
    stop_reason: Option<String>,
}

#[derive(Deserialize)]
struct ContentBlock {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: String,
}

#[derive(Deserialize)]
struct ApiError {
    error: ApiErrorBody,
}

#[derive(Deserialize)]
struct ApiErrorBody {
    #[serde(default)]
    message: String,
}

/// Genereert een antwoord op een e-mail in de gevraagde stijl.
/// Geeft platte tekst terug (alinea's gescheiden door lege regels).
pub async fn generate_reply(
    style_prompt: &str,
    user_name: &str,
    lang: &str,
    from: &str,
    subject: &str,
    body_text: &str,
) -> Result<String> {
    let key = load_key()?.ok_or_else(|| {
        anyhow!("Geen Claude API-sleutel ingesteld. Voeg die toe bij Instellingen.")
    })?;

    let language = if lang == "nl" { "Nederlands" } else { "English" };
    let system = format!(
        "Je schrijft namens {user_name} een antwoord op een binnengekomen e-mail. \
         Geef alleen de tekst van de antwoordmail terug: geen onderwerpregel, geen \
         aanhaling van het originele bericht en geen uitleg eromheen. Onderteken met \
         de voornaam van {user_name}. Schrijf in het {language}, tenzij de \
         stijlinstructie iets anders vraagt.\n\nStijlinstructie: {style_prompt}"
    );
    let user = format!(
        "Van: {from}\nOnderwerp: {subject}\n\n{body_text}\n\n---\nSchrijf het antwoord."
    );

    let body = json!({
        "model": MODEL,
        "max_tokens": 8192,
        "thinking": {"type": "adaptive"},
        "system": system,
        "messages": [{"role": "user", "content": user}],
    });

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .context("Kon geen HTTP-client maken")?;
    let resp = http
        .post(API_URL)
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .context("Kon de Claude API niet bereiken (geen netwerk?)")?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let detail = serde_json::from_str::<ApiError>(&text)
            .map(|e| e.error.message)
            .unwrap_or_else(|_| text.clone());
        return Err(match status.as_u16() {
            401 => anyhow!("De Claude API-sleutel is ongeldig. Controleer de sleutel bij Instellingen."),
            429 => anyhow!("Claude API: aanvraaglimiet bereikt. Probeer het over een minuut opnieuw."),
            500..=599 => anyhow!("De Claude API is tijdelijk niet beschikbaar. Probeer het zo opnieuw."),
            _ => anyhow!("Claude API-fout: {detail}"),
        });
    }

    let parsed: ApiResponse =
        serde_json::from_str(&text).context("Onverwacht antwoord van de Claude API")?;
    // Refusal = 200 met stop_reason "refusal"; content kan dan leeg zijn.
    if parsed.stop_reason.as_deref() == Some("refusal") {
        return Err(anyhow!("Claude heeft dit verzoek geweigerd."));
    }
    let out = parsed
        .content
        .iter()
        .filter(|b| b.kind == "text")
        .map(|b| b.text.as_str())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    if out.is_empty() {
        return Err(anyhow!("Claude gaf een leeg antwoord."));
    }
    Ok(out)
}
