//! Tauri-commands: de brug tussen de React-frontend en de Rust-kern.
//! Alle functies geven `Result<T, String>` terug zodat fouten netjes in de UI
//! belanden (in mensentaal, geen stacktraces).

use crate::auth;
use crate::backend::{Backend, Calendar};
use crate::cache;
use crate::caldav::CaldavClient;
use crate::config::{self, AccountKind, AppConfig, StoredAccount};
use crate::graph::GraphClient;
use crate::models::*;
use crate::token_store;

/// Id van het actieve account (voor de offline cache).
fn active_account() -> Result<String, String> {
    require_config()?
        .active_account
        .ok_or_else(|| "Niet ingelogd.".to_string())
}

/// Kleine helper: laad een volledige config of geef een nette fout.
fn require_config() -> Result<AppConfig, String> {
    match config::load().map_err(|e| e.to_string())? {
        Some(cfg) if cfg.is_complete() => Ok(cfg),
        _ => Err("Nog geen verbinding ingesteld. Vul eerst je Client-ID in.".into()),
    }
}

/// Backend (Graph of IMAP) voor het actieve account.
async fn client() -> Result<Backend, String> {
    let cfg = require_config()?;
    let id = cfg
        .active_account
        .clone()
        .ok_or_else(|| "Niet ingelogd.".to_string())?;
    let acc = cfg
        .accounts
        .iter()
        .find(|a| a.id == id)
        .ok_or_else(|| "Onbekend account.".to_string())?;
    Backend::for_account(&cfg, acc).await
}

/// Agenda-backend voor het actieve account: Graph (Office 365) of CalDAV (IMAP
/// met een ontdekte agenda). Een IMAP-account zonder CalDAV geeft een nette fout.
async fn calendar() -> Result<Calendar, String> {
    let cfg = require_config()?;
    let id = cfg
        .active_account
        .clone()
        .ok_or_else(|| "Niet ingelogd.".to_string())?;
    let acc = cfg
        .accounts
        .iter()
        .find(|a| a.id == id)
        .ok_or_else(|| "Onbekend account.".to_string())?;
    match acc.kind {
        AccountKind::Office365 => {
            let gc = GraphClient::new(&cfg, &acc.id)
                .await
                .map_err(|e| e.to_string())?;
            Ok(Calendar::Graph(gc))
        }
        AccountKind::Imap => {
            let imap = acc
                .imap
                .as_ref()
                .ok_or_else(|| "Dit account heeft geen agenda.".to_string())?;
            let caldav = imap
                .caldav
                .as_ref()
                .ok_or_else(|| "Dit account heeft geen agenda.".to_string())?;
            let username = caldav
                .caldav_username
                .clone()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| imap.imap_username.clone());
            let password = token_store::load_secret(&acc.id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Geen wachtwoord gevonden voor dit account.".to_string())?;
            let client =
                CaldavClient::new(caldav.calendar_url.clone(), username, password, caldav.supports_expand)?;
            Ok(Calendar::Caldav(client))
        }
    }
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
    let Some(id) = &cfg.active_account else { return false };
    match cfg.accounts.iter().find(|a| &a.id == id) {
        // IMAP: "ingelogd" = er staat een wachtwoord in de keychain.
        Some(acc) if acc.kind == AccountKind::Imap => {
            token_store::load_secret(id).map(|s| s.is_some()).unwrap_or(false)
        }
        // Office 365 (of nog geen account-record): OAuth-tokencheck.
        _ => auth::is_logged_in(id),
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
        cfg.accounts.push(StoredAccount::office365(
            me.id.clone(),
            me.mail.clone().or_else(|| me.user_principal_name.clone()),
            me.display_name.clone(),
        ));
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
    // Het juiste geheim opruimen: IMAP-wachtwoord of OAuth-tokens.
    let kind = cfg
        .accounts
        .iter()
        .find(|a| a.id == id)
        .map(|a| a.kind)
        .unwrap_or(AccountKind::Office365);
    match kind {
        AccountKind::Imap => {
            let _ = token_store::clear_secret(&id);
            // Close the pooled, still logged-in session as well.
            crate::imap::forget_connection(&id);
        }
        AccountKind::Office365 => auth::logout(&id).map_err(|e| e.to_string())?,
    }
    let _ = cache::clear_account(&id); // geen mail achterlaten van een ontkoppeld account
    cfg.accounts.retain(|a| a.id != id);
    if cfg.active_account.as_deref() == Some(id.as_str()) {
        cfg.active_account = cfg.accounts.first().map(|a| a.id.clone());
    }
    config::save(&cfg).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_accounts() -> Result<AccountsInfo, String> {
    let cfg = require_config()?;
    // In the background: quietly pick up missing optional scopes (People.Read,
    // MailboxSettings, User.ReadBasic.All for profile photos) as soon as the
    // administrator has consented - even while the access token is still valid.
    // That way autocomplete and avatars work right after startup, without
    // waiting for the token to expire or making the user sign in again.
    for a in &cfg.accounts {
        let cfg2 = cfg.clone();
        let id = a.id.clone();
        tauri::async_runtime::spawn(async move {
            auth::upgrade_scopes_now(&cfg2, &id).await;
        });
    }
    Ok(AccountsInfo {
        accounts: cfg.accounts.iter().map(AccountInfo::from_stored).collect(),
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

// ---- IMAP-accounts toevoegen/testen ----

/// Bouwt `ImapSettings` uit de frontend-invoer (nog zonder mappen/CalDAV).
fn imap_settings_from_input(input: &ImapAccountInput) -> (config::ImapSettings, String) {
    let settings = config::ImapSettings {
        imap_host: input.imap_host.trim().to_string(),
        imap_port: input.imap_port,
        imap_security: input.imap_security,
        imap_username: input.imap_username.trim().to_string(),
        smtp_host: input.smtp_host.trim().to_string(),
        smtp_port: input.smtp_port,
        smtp_security: input.smtp_security,
        smtp_username: input.smtp_username.trim().to_string(),
        email: input.email.trim().to_string(),
        save_to_sent: input.save_to_sent.unwrap_or(true),
        folders: None,
        // CalDAV wordt pas na een geslaagde IMAP-verificatie ontdekt (zie
        // add_imap_account); hier bewust nog geen agenda.
        caldav: None,
    };
    (settings, input.password.clone())
}

/// Voegt een IMAP-account toe: verifieert IMAP-login + SMTP-handshake, lost de
/// bijzondere mappen op, bewaart het wachtwoord in de keychain en maakt het account actief.
#[tauri::command]
pub async fn add_imap_account(input: ImapAccountInput) -> Result<Account, String> {
    let mut cfg = require_config()?;
    let (mut settings, password) = imap_settings_from_input(&input);

    // Verbinding testen én de bijzondere mappen bepalen.
    let folders = crate::imap::verify_imap_settings(settings.clone(), password.clone())
        .await
        .map_err(|e| e.to_string())?;
    settings.folders = Some(folders);

    // CalDAV-agenda best-effort ontdekken; faalt dit, dan krijgt het account
    // gewoon geen agenda (geen harde fout bij het toevoegen).
    if let Ok(Some(caldav)) = crate::caldav::discover(
        input.email.trim(),
        input.imap_host.trim(),
        input.imap_username.trim(),
        &password,
        input.caldav_url.clone(),
    )
    .await
    {
        settings.caldav = Some(caldav);
    }

    let id = format!(
        "imap:{}@{}",
        input.imap_username.trim().to_lowercase(),
        input.imap_host.trim().to_lowercase()
    );
    token_store::save_secret(&id, &password).map_err(|e| e.to_string())?;

    let mail = Some(input.email.trim().to_string());
    let display_name = input
        .display_name
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if let Some(acc) = cfg.accounts.iter_mut().find(|a| a.id == id) {
        // Opnieuw koppelen: instellingen bijwerken.
        acc.mail = mail.clone();
        acc.display_name = display_name.clone();
        acc.kind = AccountKind::Imap;
        acc.imap = Some(settings);
    } else {
        cfg.accounts.push(StoredAccount::imap(
            id.clone(),
            mail.clone(),
            display_name.clone(),
            settings,
        ));
    }
    cfg.active_account = Some(id.clone());
    config::save(&cfg).map_err(|e| e.to_string())?;

    Ok(Account {
        id,
        display_name: display_name.or_else(|| mail.clone()),
        mail: mail.clone(),
        user_principal_name: mail,
    })
}

/// Test een IMAP-/SMTP-verbinding zonder iets op te slaan ("Verbinding testen").
#[tauri::command]
pub async fn test_imap_connection(input: ImapAccountInput) -> Result<(), String> {
    let (settings, password) = imap_settings_from_input(&input);
    crate::imap::verify_imap_settings(settings, password)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Voorgestelde server-instellingen op basis van het e-maildomein (bekende providers
/// hardcoded, anders een generieke gok). None als er geen domein te herleiden is.
#[tauri::command]
pub fn imap_presets_for(email: String) -> Result<Option<ImapPreset>, String> {
    use config::TlsMode::{ImplicitTls, StartTls};
    let domain = email
        .rsplit('@')
        .next()
        .unwrap_or("")
        .trim()
        .to_lowercase();
    if domain.is_empty() {
        return Ok(None);
    }
    let preset = match domain.as_str() {
        "gmail.com" | "googlemail.com" => ImapPreset {
            imap_host: "imap.gmail.com".into(),
            imap_port: 993,
            imap_security: ImplicitTls,
            smtp_host: "smtp.gmail.com".into(),
            smtp_port: 465,
            smtp_security: ImplicitTls,
            hint: Some(
                "Gmail vereist een app-wachtwoord (met tweestapsverificatie); je gewone wachtwoord werkt niet.".into(),
            ),
        },
        "outlook.com" | "hotmail.com" | "live.com" => ImapPreset {
            imap_host: "outlook.office365.com".into(),
            imap_port: 993,
            imap_security: ImplicitTls,
            smtp_host: "smtp.office365.com".into(),
            smtp_port: 587,
            smtp_security: StartTls,
            hint: Some("Microsoft-accounts vereisen meestal een app-wachtwoord.".into()),
        },
        "icloud.com" | "me.com" => ImapPreset {
            imap_host: "imap.mail.me.com".into(),
            imap_port: 993,
            imap_security: ImplicitTls,
            smtp_host: "smtp.mail.me.com".into(),
            smtp_port: 587,
            smtp_security: StartTls,
            hint: Some("iCloud vereist een app-wachtwoord (aan te maken op appleid.apple.com).".into()),
        },
        "fastmail.com" => ImapPreset {
            imap_host: "imap.fastmail.com".into(),
            imap_port: 993,
            imap_security: ImplicitTls,
            smtp_host: "smtp.fastmail.com".into(),
            smtp_port: 465,
            smtp_security: ImplicitTls,
            hint: Some("Fastmail vereist een app-wachtwoord.".into()),
        },
        other => ImapPreset {
            imap_host: format!("imap.{other}"),
            imap_port: 993,
            imap_security: ImplicitTls,
            smtp_host: format!("smtp.{other}"),
            smtp_port: 587,
            smtp_security: StartTls,
            hint: None,
        },
    };
    Ok(Some(preset))
}

/// Mappen van álle gekoppelde accounts (voor de zijbalk). Accounts waarvan de
/// sessie stuk is, komen terug met een lege mappenlijst i.p.v. een harde fout.
#[tauri::command]
pub async fn list_all_folders() -> Result<Vec<AccountFolders>, String> {
    let cfg = require_config()?;
    let mut out = Vec::new();
    for acc in &cfg.accounts {
        // Online: verse mappen + cache verversen; offline: uit de cache.
        let folders = match Backend::for_account(&cfg, acc).await {
            Ok(be) => match be.list_folders().await {
                Ok(f) => {
                    let _ = cache::save_folders(&acc.id, &f);
                    f
                }
                Err(_) => cache::load_folders(&acc.id).unwrap_or_default(),
            },
            Err(_) => cache::load_folders(&acc.id).unwrap_or_default(),
        };
        out.push(AccountFolders {
            account: AccountInfo::from_stored(acc),
            folders,
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn get_account() -> Result<Account, String> {
    // Offline: val terug op het opgeslagen account, anders blijft de app op
    // het loginscherm hangen terwijl de cache prima kan serveren.
    match client().await {
        Ok(gc) => match gc.me().await {
            Ok(a) => Ok(a),
            Err(e) => stored_account(e.to_string()),
        },
        Err(e) => stored_account(e),
    }
}

/// Accountgegevens uit config.json (voor offline gebruik).
fn stored_account(err: String) -> Result<Account, String> {
    let cfg = require_config()?;
    let id = cfg.active_account.clone().ok_or_else(|| err.clone())?;
    cfg.accounts
        .iter()
        .find(|a| a.id == id)
        .map(|a| Account {
            id: a.id.clone(),
            display_name: a.display_name.clone(),
            mail: a.mail.clone(),
            user_principal_name: a.mail.clone(),
        })
        .ok_or(err)
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
    ascending: Option<bool>,
    filter: Option<String>,
) -> Result<MessagesPage, String> {
    let account = active_account()?;
    let (top, skip) = (top.unwrap_or(25), skip.unwrap_or(0));
    let asc = ascending.unwrap_or(false);
    let filt = filter.as_deref().filter(|f| !f.is_empty() && *f != "all");
    match client().await {
        Ok(gc) => match gc.list_messages(&folder_id, top, skip, asc, filt).await {
            Ok(page) => {
                // Cache-through + achtergrond-delta (throttled) zodat de
                // cache ook buiten deze pagina compleet raakt.
                let _ = cache::save_messages(&account, &folder_id, &page.messages);
                if cache::delta_due(&account, &folder_id).unwrap_or(false) {
                    if let Ok(cfg) = require_config() {
                        let (acc, fid) = (account.clone(), folder_id.clone());
                        tauri::async_runtime::spawn(async move {
                            if let Some(sa) = cfg.accounts.iter().find(|a| a.id == acc) {
                                if let Ok(be) = Backend::for_account(&cfg, sa).await {
                                    let _ = be.sync_folder_to_cache(&acc, &fid).await;
                                }
                            }
                        });
                    }
                }
                Ok(page)
            }
            Err(e) => cached_messages(&account, &folder_id, top, skip, asc, filt, e.to_string()),
        },
        Err(e) => cached_messages(&account, &folder_id, top, skip, asc, filt, e),
    }
}

/// Fallback op de offline cache; alleen als daar iets in zit.
#[allow(clippy::too_many_arguments)]
fn cached_messages(
    account: &str,
    folder_id: &str,
    top: u32,
    skip: u32,
    ascending: bool,
    filter: Option<&str>,
    err: String,
) -> Result<MessagesPage, String> {
    match cache::load_messages(account, folder_id, top, skip, ascending, filter) {
        Ok((messages, has_more)) if !messages.is_empty() || skip > 0 => Ok(MessagesPage {
            messages,
            has_more,
            from_cache: true,
        }),
        _ => Err(err),
    }
}

#[tauri::command]
pub async fn get_message(id: String) -> Result<Message, String> {
    let account = active_account()?;
    match client().await {
        Ok(gc) => match gc.get_message(&id).await {
            Ok(m) => {
                let _ = cache::save_full_message(&account, &m);
                Ok(m)
            }
            // Deleted or moved in another mail app: the server says so, so
            // the cached copy is stale too. Drop it instead of showing it.
            Err(e) if e.to_string().contains(crate::graph::ITEM_GONE_MARKER) => {
                let _ = cache::delete_message(&account, &id);
                Err(e.to_string())
            }
            Err(e) => cache::load_message(&account, &id)
                .ok()
                .flatten()
                .ok_or_else(|| e.to_string()),
        },
        Err(e) => cache::load_message(&account, &id).ok().flatten().ok_or(e),
    }
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
    client().await?.graph()?.block_sender(&address).await.map_err(|e| e.to_string())
}

/// Antwoord op een vergaderuitnodiging: "accept" | "tentative" | "decline".
#[tauri::command]
pub async fn rsvp_message(message_id: String, response: String) -> Result<(), String> {
    client().await?.graph()?.rsvp(&message_id, &response).await.map_err(|e| e.to_string())
}

/// Meeting details (time, place, previous time when moved, your response)
/// of an invitation, update or cancellation. `None` for any other message
/// and for IMAP accounts (no meeting messages there yet).
#[tauri::command]
pub async fn invite_details(message_id: String) -> Result<Option<InviteDetails>, String> {
    match client().await? {
        Backend::Graph(g) => g.invite_details(&message_id).await.map_err(|e| e.to_string()),
        Backend::Imap(_) => Ok(None),
    }
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
    client().await?.graph()?.list_rules().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_rule_enabled(rule_id: String, enabled: bool) -> Result<(), String> {
    client()
        .await?
        .graph()?
        .set_rule_enabled(&rule_id, enabled)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_rule(rule_id: String) -> Result<(), String> {
    client()
        .await?
        .graph()?
        .delete_rule(&rule_id)
        .await
        .map_err(|e| e.to_string())
}

/// Afwezigheid / automatisch antwoord (vereist MailboxSettings-consent).
#[tauri::command]
pub async fn get_auto_reply() -> Result<AutoReplySettings, String> {
    client().await?.graph()?.get_auto_reply().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_auto_reply(settings: AutoReplySettings) -> Result<(), String> {
    client()
        .await?
        .graph()?
        .set_auto_reply(&settings)
        .await
        .map_err(|e| e.to_string())
}

/// Master-categorieën (kleurlabels) van het postvak.
#[tauri::command]
pub async fn list_categories() -> Result<Vec<OutlookCategory>, String> {
    client().await?.graph()?.list_categories().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_message_categories(
    message_id: String,
    categories: Vec<String>,
) -> Result<(), String> {
    client()
        .await?
        .graph()?
        .set_message_categories(&message_id, &categories)
        .await
        .map_err(|e| e.to_string())
}

/// Profile photo of a sender as a `data:` URI, or null when there is none.
///
/// Never returns an error: no photo is the normal case (external senders are
/// not in the directory, IMAP accounts have no directory at all, and the
/// optional `User.ReadBasic.All` scope may not be consented to), and the
/// message list must not turn red over a missing avatar.
///
/// Answers are cached in cache.db - including "no photo" - because the list
/// asks for one per visible row and Graph would otherwise be hit on every
/// scroll.
#[tauri::command]
pub async fn sender_photo(address: String) -> Result<Option<String>, String> {
    let address = address.trim().to_lowercase();
    if address.is_empty() {
        return Ok(None);
    }
    let Ok(account_id) = active_account() else {
        return Ok(None);
    };
    if let Some(hit) = cache::photo(&account_id, &address) {
        return Ok(hit);
    }
    // An IMAP account has no directory to ask; that stays initials.
    let Ok(Backend::Graph(graph)) = client().await else {
        return Ok(None);
    };
    // Your own photo goes through /me/photo, which works without the directory
    // scope, so your own messages show a real picture in every tenant.
    let own = config::load()
        .ok()
        .flatten()
        .and_then(|cfg| {
            cfg.accounts
                .iter()
                .find(|a| a.id == account_id)
                .and_then(|a| a.mail.clone())
        })
        .map(|m| m.trim().to_lowercase());
    let photo = if own.as_deref() == Some(address.as_str()) {
        graph.my_photo().await
    } else {
        graph.user_photo(&address).await
    };
    let _ = cache::save_photo(&account_id, &address, photo.as_deref());
    Ok(photo)
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

/// Zet een uitgesteld bericht terug in Postvak IN (ongelezen) van het opgegeven
/// account.
///
/// Bewust met een expliciet account-id in plaats van het actieve account: de
/// snooze-wekker moet berichten op tijd terugzetten, ook in een account waar je
/// op dat moment niet in werkt. Verplaatsen + ongelezen zetten zit in één
/// command zodat de wekker maar één keer hoeft te wachten op de verbinding.
#[tauri::command]
pub async fn wake_snoozed(account_id: String, message_id: String) -> Result<(), String> {
    let cfg = require_config()?;
    let acc = cfg
        .accounts
        .iter()
        .find(|a| a.id == account_id)
        .ok_or_else(|| "Onbekend account.".to_string())?;
    let be = Backend::for_account(&cfg, acc).await?;
    let moved = be
        .move_message_returning(&message_id, "inbox")
        .await
        .map_err(|e| e.to_string())?;
    // Ongelezen zetten is een nettigheid; mislukt dat, dan staat het bericht
    // er nog steeds - geen reden om de wekker te laten falen.
    let _ = be.set_read(&moved.id, false).await;
    Ok(())
}

/// Haalt één externe (http/https) afbeelding op en geeft die terug als data-URI.
///
/// De webview mag door de CSP geen externe URL's laden (zie tauri.conf.json).
/// Dat is bewust: laadde de webview ze zelf, dan zou een tracking-pixel het
/// IP-adres, de user-agent en eventuele cookies van de gebruiker zien - ook via
/// CSS-achtergronden, die de "afbeeldingen tonen"-knop omzeilen. Na expliciete
/// toestemming haalt de Rust-kern de afbeelding op (zonder cookies, zonder
/// referer) en gaat alleen de `data:`-URI naar de webview.
#[tauri::command]
pub async fn fetch_remote_image(url: String) -> Result<String, String> {
    /// Ruime bovengrens; voorkomt dat één afbeelding het geheugen opvreet.
    const MAX_BYTES: usize = 10 * 1024 * 1024;

    let parsed = url::Url::parse(&url).map_err(|_| "Ongeldige afbeeldings-URL.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Alleen http(s)-afbeeldingen worden opgehaald.".into());
    }
    // The URL comes from an e-mail: never let it reach the local network.
    // Hostnames and redirects are checked by the client itself (see net.rs).
    if !crate::net::is_public_url(&parsed) {
        return Err("Afbeeldingen van een lokaal adres worden niet opgehaald.".into());
    }

    // Shared client: a newsletter with 40 images reuses its connections.
    let resp = crate::net::remote_images()
        .get(parsed)
        .header(reqwest::header::ACCEPT, "image/*")
        // Sommige CDN's weigeren verzoeken zonder user-agent.
        .header(reqwest::header::USER_AGENT, "Mozilla/5.0 (compatible; BE-Mail)")
        .send()
        .await
        .map_err(|e| format!("Kon de afbeelding niet ophalen: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("De server gaf status {}.", resp.status()));
    }

    let header_mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or("").trim().to_ascii_lowercase())
        .unwrap_or_default();

    if let Some(len) = resp.content_length() {
        if len as usize > MAX_BYTES {
            return Err("De afbeelding is te groot.".into());
        }
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Kon de afbeelding niet lezen: {e}"))?;
    if bytes.len() > MAX_BYTES {
        return Err("De afbeelding is te groot.".into());
    }

    // Alleen echte afbeeldingen doorlaten: een foutpagina of ander bestand mag
    // nooit als data-URI in het leesvenster belanden.
    let mime = if header_mime.starts_with("image/") {
        header_mime
    } else {
        sniff_image_mime(&bytes)
            .ok_or_else(|| "Dit is geen afbeelding.".to_string())?
            .to_string()
    };

    use base64::Engine as _;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

/// Herkent het afbeeldingstype aan de magic bytes (als de server geen of een
/// verkeerd Content-Type meestuurt). `None` = geen herkenbare afbeelding.
fn sniff_image_mime(bytes: &[u8]) -> Option<&'static str> {
    let b = bytes;
    if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if b.len() > 12 && b.starts_with(b"RIFF") && &b[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    if b.starts_with(b"BM") {
        return Some("image/bmp");
    }
    if b.starts_with(&[0x00, 0x00, 0x01, 0x00]) {
        return Some("image/x-icon");
    }
    // SVG: tekstformaat, dus op de eerste niet-witruimte-tekens kijken.
    let head = String::from_utf8_lossy(&b[..b.len().min(256)]);
    let head = head.trim_start();
    if head.starts_with("<svg") || (head.starts_with("<?xml") && head.contains("<svg")) {
        return Some("image/svg+xml");
    }
    None
}

/// Uitgebreid zoeken (losse velden). Een leeg formulier geeft niets terug in
/// plaats van de hele mailbox.
#[tauri::command]
pub async fn search_advanced(
    query: SearchQuery,
    top: Option<u32>,
    folder_id: Option<String>,
) -> Result<MessagesPage, String> {
    if query.is_empty() {
        return Ok(MessagesPage {
            messages: Vec::new(),
            has_more: false,
            from_cache: false,
        });
    }
    client()
        .await?
        .search_advanced(&query, top.unwrap_or(50), folder_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

/// Slaat een heel bericht op als .eml in de Downloads-map; geeft het pad terug.
#[tauri::command]
pub async fn download_message(message_id: String) -> Result<String, String> {
    client()
        .await?
        .download_message(&message_id)
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

/// Lets the user pick where to save a backup and writes `inhoud` there.
/// Returns the chosen path, or `None` when the user cancelled.
///
/// The save dialog is opened here in the Rust core on purpose: the webview
/// never hands us a path. If it could, a single script injection (for example
/// through a malicious e-mail) could overwrite any file the user can write
/// to, such as a script in the Startup folder.
#[tauri::command]
pub async fn bewaar_json(
    app: tauri::AppHandle,
    basisnaam: String,
    inhoud: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let today = chrono::Local::now().format("%Y-%m-%d");
    let name: String = basisnaam
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        .take(60)
        .collect();
    let picked = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .set_file_name(format!("{name}-{today}.json"))
        .blocking_save_file();
    let Some(picked) = picked else { return Ok(None) };
    let path = picked
        .into_path()
        .map_err(|e| format!("Kon het bestand niet opslaan: {e}"))?;
    std::fs::write(&path, inhoud).map_err(|e| format!("Kon het bestand niet opslaan: {e}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Lets the user pick a backup file and returns its contents, or `None` when
/// the user cancelled. Same reasoning as `bewaar_json`: the path comes from
/// the dialog, never from the webview, so this cannot be used to read
/// arbitrary files (SSH keys, browser profiles, other apps' data).
#[tauri::command]
pub async fn kies_json(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    /// A backup is a few hundred kB at most; refuse anything absurd.
    const MAX_BYTES: u64 = 50 * 1024 * 1024;
    let picked = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .blocking_pick_file();
    let Some(picked) = picked else { return Ok(None) };
    let path = picked
        .into_path()
        .map_err(|e| format!("Kon het bestand niet lezen: {e}"))?;
    let len = std::fs::metadata(&path)
        .map_err(|e| format!("Kon het bestand niet lezen: {e}"))?
        .len();
    if len > MAX_BYTES {
        return Err("Dit bestand is te groot voor een back-up.".into());
    }
    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Kon het bestand niet lezen: {e}"))
}

/// All messages of a conversation, from every folder (Inbox, Sent Items,
/// Archive, ...), newest first. Deleted items, junk and drafts are left out.
#[tauri::command]
pub async fn get_conversation(conversation_id: String) -> Result<Vec<Message>, String> {
    let id = conversation_id.trim();
    if id.is_empty() {
        return Ok(Vec::new());
    }
    client()
        .await?
        .conversation(id)
        .await
        .map_err(|e| e.to_string())
}

/// Everything with the company behind `address`: all recent mail in which
/// someone from that domain takes part. Free-mail addresses (gmail.com, ...)
/// and colleagues on your own domain are searched as that one address.
/// `None` when the address is unusable.
#[tauri::command]
pub async fn company_mail(address: String) -> Result<Option<CompanyMail>, String> {
    let cfg = require_config()?;
    let own = cfg
        .active_account
        .as_ref()
        .and_then(|id| cfg.accounts.iter().find(|a| &a.id == id))
        .and_then(|a| a.mail.clone());
    let Some((scope, key)) = company_scope(&address, own.as_deref()) else {
        return Ok(None);
    };
    let messages = client()
        .await?
        .participant_mail(&key)
        .await
        .map_err(|e| e.to_string())?;
    Ok(Some(CompanyMail {
        scope: scope.to_string(),
        key,
        messages,
    }))
}

#[tauri::command]
pub async fn search_messages(
    query: String,
    top: Option<u32>,
    folder_id: Option<String>,
) -> Result<MessagesPage, String> {
    client()
        .await?
        .search_messages(&query, top.unwrap_or(50), folder_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

// ---- AI-antwoorden (Claude) ----

/// Is er een Claude API-sleutel opgeslagen?
#[tauri::command]
pub fn claude_key_status() -> Result<bool, String> {
    crate::claude::load_key()
        .map(|k| k.is_some())
        .map_err(|e| e.to_string())
}

/// Slaat de Claude API-sleutel op in de keychain; leeg = verwijderen.
#[tauri::command]
pub fn set_claude_key(key: String) -> Result<(), String> {
    let k = key.trim();
    if k.is_empty() {
        crate::claude::clear_key()
    } else {
        crate::claude::save_key(k)
    }
    .map_err(|e| e.to_string())
}

/// Genereert een antwoord-e-mail in de gekozen stijl.
#[tauri::command]
pub async fn ai_reply(
    style_prompt: String,
    user_name: String,
    lang: String,
    from: String,
    subject: String,
    body_text: String,
) -> Result<String, String> {
    crate::claude::generate_reply(&style_prompt, &user_name, &lang, &from, &subject, &body_text)
        .await
        .map_err(|e| e.to_string())
}

// ---- Agenda ----

#[tauri::command]
pub async fn list_events(start: String, end: String) -> Result<Vec<Event>, String> {
    calendar()
        .await?
        .list_events(&start, &end)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_event(input: EventInput) -> Result<Event, String> {
    calendar().await?.create_event(&input).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_event(id: String, input: EventInput) -> Result<Event, String> {
    calendar().await?.update_event(&id, &input).await.map_err(|e| e.to_string())
}

/// Alleen de tijden verschuiven (slepen in de agenda).
#[tauri::command]
pub async fn update_event_times(id: String, start: String, end: String) -> Result<(), String> {
    calendar()
        .await?
        .update_event_times(&id, &start, &end)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_people(query: String) -> Result<Vec<Person>, String> {
    calendar().await?.search_people(&query).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_event(id: String) -> Result<(), String> {
    calendar().await?.delete_event(&id).await.map_err(|e| e.to_string())
}

// =====================================================================
// Tests
// =====================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniff_herkent_afbeeldingen() {
        assert_eq!(sniff_image_mime(b"\x89PNG\r\n\x1a\nrest"), Some("image/png"));
        assert_eq!(sniff_image_mime(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(sniff_image_mime(b"GIF89a..."), Some("image/gif"));
        assert_eq!(sniff_image_mime(b"RIFF....WEBPVP8 "), Some("image/webp"));
        assert_eq!(sniff_image_mime(b"  <svg xmlns=\"...\">"), Some("image/svg+xml"));
        // Een foutpagina of ander bestand mag nooit als afbeelding doorgaan.
        assert_eq!(sniff_image_mime(b"<!doctype html><html>"), None);
        assert_eq!(sniff_image_mime(b""), None);
    }

    #[tokio::test]
    async fn weigert_niet_http_schemas() {
        // Geen file:// of javascript: - alleen echt externe afbeeldingen.
        assert!(fetch_remote_image("file:///C:/geheim.txt".into()).await.is_err());
        assert!(fetch_remote_image("javascript:alert(1)".into()).await.is_err());
        assert!(fetch_remote_image("niet eens een url".into()).await.is_err());
    }
}
