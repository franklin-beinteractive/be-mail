//! OAuth2 Authorization Code Flow met PKCE voor Microsoft Entra (Office 365).
//! Public/native client: geen client secret. De redirect komt binnen op een
//! loopback-poort (127.0.0.1) die we tijdelijk openen.

use crate::config::AppConfig;
use crate::token_store::{self, TokenSet};
use anyhow::{anyhow, bail, Context, Result};
use base64::Engine;
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// De Graph-rechten die we vragen (delegated). Least privilege voor mail + agenda.
/// People.Read is nodig voor het autoaanvullen van genodigden. Let op: na het
/// toevoegen van een scope moet de gebruiker éénmalig opnieuw inloggen/toestemmen.
const SCOPES: &str = "openid profile offline_access User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite People.Read";

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn random_b64(len: usize) -> String {
    let mut buf = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut buf);
    b64url(&buf)
}

fn pkce_pair() -> (String, String) {
    let verifier = random_b64(32); // 43 tekens, binnen de RFC-limiet
    let challenge = b64url(Sha256::digest(verifier.as_bytes()).as_slice());
    (verifier, challenge)
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
    #[serde(default)]
    scope: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenError {
    error: String,
    #[serde(default)]
    error_description: Option<String>,
}

fn now_ts() -> i64 {
    chrono::Utc::now().timestamp()
}

fn token_set_from(resp: TokenResponse, previous_refresh: Option<&str>) -> TokenSet {
    // 60s marge zodat we niet net op de grens een verlopen token gebruiken.
    let expires_at = now_ts() + resp.expires_in.unwrap_or(3600) - 60;
    let refresh = resp
        .refresh_token
        .or_else(|| previous_refresh.map(|s| s.to_string()))
        .unwrap_or_default();
    TokenSet {
        access_token: resp.access_token,
        refresh_token: refresh,
        expires_at,
        scope: resp.scope.unwrap_or_default(),
    }
}

/// Wacht op de browser-redirect en geeft de `code` (en state) terug.
/// Opent tijdelijk een luisterend socket op 127.0.0.1:<vrije poort>.
async fn capture_redirect(listener: TcpListener, expected_state: &str) -> Result<String> {
    let (mut stream, _) = tokio::time::timeout(Duration::from_secs(300), listener.accept())
        .await
        .context("Time-out: geen antwoord van de browser binnen 5 minuten")?
        .context("Kon de inlog-redirect niet ontvangen")?;

    let mut buf = vec![0u8; 8192];
    let n = stream.read(&mut buf).await.context("Kon redirect niet lezen")?;
    let request = String::from_utf8_lossy(&buf[..n]);

    // Eerste regel: "GET /callback?code=...&state=... HTTP/1.1"
    let first_line = request.lines().next().unwrap_or("");
    let path = first_line.split_whitespace().nth(1).unwrap_or("");
    let query = path.split_once('?').map(|(_, q)| q).unwrap_or("");

    let mut code: Option<String> = None;
    let mut state: Option<String> = None;
    let mut err: Option<String> = None;
    let mut err_desc: Option<String> = None;
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let val = urldecode(v);
        match k {
            "code" => code = Some(val),
            "state" => state = Some(val),
            "error" => err = Some(val),
            "error_description" => err_desc = Some(val),
            _ => {}
        }
    }

    let ok_page = "<!doctype html><html lang=nl><head><meta charset=utf-8><title>BE-Mail</title>\
        <style>body{font-family:Segoe UI,system-ui,sans-serif;background:#f3f4f6;color:#111;\
        display:flex;align-items:center;justify-content:center;height:100vh;margin:0}\
        .card{background:#fff;padding:40px 48px;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.12);text-align:center}\
        h1{margin:0 0 8px;font-size:22px}p{margin:0;color:#555}</style></head>\
        <body><div class=card><h1>&#9989; Inloggen gelukt</h1><p>Je kunt dit tabblad sluiten en teruggaan naar BE-Mail.</p></div></body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        ok_page.len(),
        ok_page
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;

    if let Some(e) = err {
        bail!(
            "Inloggen geweigerd: {} {}",
            e,
            err_desc.unwrap_or_default()
        );
    }
    if state.as_deref() != Some(expected_state) {
        bail!("Beveiligingsfout: onverwachte 'state' bij redirect");
    }
    code.ok_or_else(|| anyhow!("Geen autorisatiecode ontvangen"))
}

fn urldecode(s: &str) -> String {
    let s = s.replace('+', " ");
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Volledige interactieve login. Opent de systeembrowser, vangt de redirect af
/// en wisselt de code in voor tokens. Opslaan gebeurt door de aanroeper (pas
/// nadat bekend is bij welk account de tokens horen).
pub async fn login(config: &AppConfig) -> Result<TokenSet> {
    if !config.is_complete() {
        bail!("Nog geen Client-ID ingesteld. Vul eerst de verbindingsgegevens in.");
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .context("Kon geen lokale poort openen voor de inlog-redirect")?;
    let port = listener.local_addr()?.port();
    let redirect_uri = format!("http://localhost:{port}");

    let (verifier, challenge) = pkce_pair();
    let state = random_b64(16);

    let auth_url = format!(
        "{}/oauth2/v2.0/authorize?client_id={}&response_type=code&redirect_uri={}&response_mode=query&scope={}&state={}&code_challenge={}&code_challenge_method=S256&prompt=select_account",
        config.authority(),
        urlencode(&config.client_id),
        urlencode(&redirect_uri),
        urlencode(SCOPES),
        urlencode(&state),
        challenge,
    );

    webbrowser::open(&auth_url).context("Kon de browser niet openen voor inloggen")?;

    let code = capture_redirect(listener, &state).await?;

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/oauth2/v2.0/token", config.authority()))
        .form(&[
            ("client_id", config.client_id.as_str()),
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("code_verifier", verifier.as_str()),
            ("scope", SCOPES),
        ])
        .send()
        .await
        .context("Token-aanvraag mislukt")?;

    parse_token_response(resp, None).await
}

async fn parse_token_response(
    resp: reqwest::Response,
    previous_refresh: Option<&str>,
) -> Result<TokenSet> {
    let status = resp.status();
    let text = resp.text().await.context("Kon token-antwoord niet lezen")?;
    if status.is_success() {
        let parsed: TokenResponse =
            serde_json::from_str(&text).context("Ongeldig token-antwoord")?;
        Ok(token_set_from(parsed, previous_refresh))
    } else if let Ok(err) = serde_json::from_str::<TokenError>(&text) {
        bail!(
            "Inloggen mislukt ({}): {}",
            err.error,
            err.error_description.unwrap_or_default()
        )
    } else {
        bail!("Inloggen mislukt (HTTP {status})")
    }
}

/// Geeft een geldig access-token voor een account terug; vernieuwt automatisch
/// met het refresh-token.
pub async fn valid_access_token(config: &AppConfig, account_id: &str) -> Result<String> {
    let tokens = token_store::load(account_id)?
        .ok_or_else(|| anyhow!("Niet ingelogd"))?;

    if now_ts() < tokens.expires_at {
        return Ok(tokens.access_token);
    }

    if tokens.refresh_token.is_empty() {
        bail!("Sessie verlopen, log opnieuw in");
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/oauth2/v2.0/token", config.authority()))
        .form(&[
            ("client_id", config.client_id.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", tokens.refresh_token.as_str()),
            ("scope", SCOPES),
        ])
        .send()
        .await
        .context("Vernieuwen van sessie mislukt")?;

    let refreshed = parse_token_response(resp, Some(&tokens.refresh_token)).await?;
    token_store::save(account_id, &refreshed)?;
    Ok(refreshed.access_token)
}

pub fn is_logged_in(account_id: &str) -> bool {
    matches!(token_store::load(account_id), Ok(Some(_)))
}

pub fn logout(account_id: &str) -> Result<()> {
    token_store::clear(account_id)
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}
