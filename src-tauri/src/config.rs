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

/// Soort account. Bepaalt welke backend de mail-/agenda-acties uitvoert.
/// Standaard `Office365` zodat bestaande config.json (zonder dit veld) ongewijzigd
/// laadt als een Graph-account.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AccountKind {
    #[default]
    Office365,
    Imap,
}

/// Beveiliging van een IMAP-/SMTP-verbinding. Geen plaintext-variant: we weigeren
/// onversleutelde aanmelding bewust.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TlsMode {
    /// TLS direct bij het verbinden (IMAP 993 / SMTP 465).
    ImplicitTls,
    /// Plain verbinden, daarna STARTTLS (IMAP 143 / SMTP 587).
    StartTls,
}

/// Opgeloste bijzondere mappen van een IMAP-account, zodat "inbox"/"archive"/
/// "sentitems" enz. (de Graph well-known namen die de frontend gebruikt) naar de
/// echte IMAP-mappaden vertaald kunnen worden. Wordt bij het toevoegen bepaald
/// (RFC 6154 SPECIAL-USE + naam-heuristiek) en daarna hergebruikt.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecialFolders {
    #[serde(default)]
    pub sent: Option<String>,
    #[serde(default)]
    pub drafts: Option<String>,
    #[serde(default)]
    pub junk: Option<String>,
    #[serde(default)]
    pub trash: Option<String>,
    #[serde(default)]
    pub archive: Option<String>,
    /// Hierarchie-scheidingsteken van de server (bv. "/" of ".").
    #[serde(default)]
    pub delimiter: Option<String>,
}

/// CalDAV-agenda die bij een IMAP-account hoort (best-effort auto-gedetecteerd).
/// `None` = dit account heeft geen agenda (bv. Outlook.com of geen CalDAV).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaldavSettings {
    /// Absolute URL van de gekozen agenda-collectie.
    pub calendar_url: String,
    #[serde(default)]
    pub principal_url: Option<String>,
    #[serde(default)]
    pub home_set_url: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    /// Host waarop de agenda uiteindelijk leeft (na eventuele redirect).
    #[serde(default)]
    pub caldav_host: Option<String>,
    /// Ondersteunt de server server-side `<C:expand>` van herhalingen?
    #[serde(default)]
    pub supports_expand: bool,
    /// Unix-tijd van de laatste succesvolle discovery.
    #[serde(default)]
    pub discovered_at: i64,
    /// Afwijkende CalDAV-gebruikersnaam (leeg = de IMAP-gebruikersnaam).
    #[serde(default)]
    pub caldav_username: Option<String>,
}

/// Verbindingsinstellingen van een IMAP-account (het wachtwoord staat NIET hier
/// maar in de keychain, net als de O365-tokens).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImapSettings {
    pub imap_host: String,
    pub imap_port: u16,
    pub imap_security: TlsMode,
    pub imap_username: String,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_security: TlsMode,
    pub smtp_username: String,
    /// Het e-mailadres (afzender) van dit account.
    pub email: String,
    /// Na verzenden een kopie in Verzonden bewaren (IMAP APPEND).
    #[serde(default)]
    pub save_to_sent: bool,
    /// Opgeloste bijzondere mappen (sent/drafts/junk/trash/archive + delimiter).
    #[serde(default)]
    pub folders: Option<SpecialFolders>,
    /// Bijbehorende CalDAV-agenda (None = geen agenda voor dit account).
    #[serde(default)]
    pub caldav: Option<CaldavSettings>,
}

/// Gekoppeld account. Tokens/wachtwoorden staan apart in de keychain.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAccount {
    /// Graph user-id (O365) of "imap:{gebruiker}@{host}" (IMAP); tevens de sleutel
    /// in de token-store en de cache-partitie.
    pub id: String,
    #[serde(default)]
    pub mail: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    /// Soort account (standaard Office365 voor back-compat).
    #[serde(default)]
    pub kind: AccountKind,
    /// IMAP-/SMTP-/CalDAV-instellingen; alleen gevuld voor `kind == Imap`.
    #[serde(default)]
    pub imap: Option<ImapSettings>,
}

impl StoredAccount {
    /// Bouwt een Office 365-account (zodat we niet overal de nieuwe velden hoeven
    /// mee te geven en de struct kan groeien zonder call-sites te breken).
    pub fn office365(id: String, mail: Option<String>, display_name: Option<String>) -> Self {
        Self {
            id,
            mail,
            display_name,
            kind: AccountKind::Office365,
            imap: None,
        }
    }

    /// Bouwt een IMAP-account (spiegelt `office365`, maar met IMAP-instellingen).
    pub fn imap(
        id: String,
        mail: Option<String>,
        display_name: Option<String>,
        settings: ImapSettings,
    ) -> Self {
        Self {
            id,
            mail,
            display_name,
            kind: AccountKind::Imap,
            imap: Some(settings),
        }
    }

    /// Heeft dit account een agenda? Office 365 altijd; IMAP alleen met CalDAV.
    pub fn has_calendar(&self) -> bool {
        match self.kind {
            AccountKind::Office365 => true,
            AccountKind::Imap => self
                .imap
                .as_ref()
                .map(|i| i.caldav.is_some())
                .unwrap_or(false),
        }
    }

    /// Ondersteunt dit account genodigden-autocomplete (Graph /me/people)?
    pub fn supports_people(&self) -> bool {
        self.kind == AccountKind::Office365
    }
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
    let mut cfg: AppConfig = serde_json::from_str(&text).context("Config-bestand is ongeldig")?;
    // Config zonder Client-ID (oude of onvolledige installatie): vul de
    // ingebakken waarden in, maar behoud accounts en overige instellingen.
    if cfg.client_id.trim().is_empty() && !DEFAULT_CLIENT_ID.trim().is_empty() {
        cfg.client_id = DEFAULT_CLIENT_ID.to_string();
        cfg.tenant_id = DEFAULT_TENANT_ID.to_string();
    }
    Ok(Some(cfg))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Zonder config.json moet load() de ingebakken standaardwaarden geven
    /// (verse installatie slaat het instelscherm over). De test kan alleen
    /// draaien als er op deze machine geen config.json staat; anders no-op.
    #[test]
    fn defaults_gelden_zonder_config() {
        if config_path().map(|p| p.exists()).unwrap_or(true) {
            return;
        }
        let cfg = load()
            .expect("load() faalde")
            .expect("ingebakken defaults verwacht als config.json ontbreekt");
        assert_eq!(cfg.client_id, DEFAULT_CLIENT_ID);
        assert_eq!(cfg.tenant_id, DEFAULT_TENANT_ID);
        assert!(cfg.is_complete(), "defaults moeten het instelscherm overslaan");
        assert!(cfg.accounts.is_empty());
    }

    /// Een pre-IMAP config.json (account zonder `kind`/`imap`) moet blijven laden
    /// als een Office365-account en ongewijzigd terug-round-trippen.
    #[test]
    fn pre_imap_config_blijft_office365() {
        let oud = r#"{
            "clientId": "abc",
            "tenantId": "org",
            "accounts": [{ "id": "user-guid", "mail": "a@b.nl", "displayName": "A B" }],
            "activeAccount": "user-guid"
        }"#;
        let cfg: AppConfig = serde_json::from_str(oud).expect("oude config moet laden");
        let acc = &cfg.accounts[0];
        assert_eq!(acc.kind, AccountKind::Office365, "default = Office365");
        assert!(acc.imap.is_none());
        assert!(acc.has_calendar());
        assert!(acc.supports_people());
    }

    /// Enum-serialisatie moet camelCase-strings geven (frontend rekent hierop).
    #[test]
    fn account_kind_serialiseert_camelcase() {
        assert_eq!(
            serde_json::to_string(&AccountKind::Office365).unwrap(),
            "\"office365\""
        );
        assert_eq!(serde_json::to_string(&AccountKind::Imap).unwrap(), "\"imap\"");
        assert_eq!(
            serde_json::to_string(&TlsMode::ImplicitTls).unwrap(),
            "\"implicitTls\""
        );
        assert_eq!(
            serde_json::to_string(&TlsMode::StartTls).unwrap(),
            "\"startTls\""
        );
    }

    /// Een IMAP-account round-trip't volledig (incl. geneste settings).
    #[test]
    fn imap_account_roundtrip() {
        let acc = StoredAccount {
            id: "imap:jan@mail.example.nl".into(),
            mail: Some("jan@example.nl".into()),
            display_name: Some("Jan".into()),
            kind: AccountKind::Imap,
            imap: Some(ImapSettings {
                imap_host: "mail.example.nl".into(),
                imap_port: 993,
                imap_security: TlsMode::ImplicitTls,
                imap_username: "jan@example.nl".into(),
                smtp_host: "mail.example.nl".into(),
                smtp_port: 465,
                smtp_security: TlsMode::ImplicitTls,
                smtp_username: "jan@example.nl".into(),
                email: "jan@example.nl".into(),
                save_to_sent: true,
                folders: None,
                caldav: None,
            }),
        };
        let json = serde_json::to_string(&acc).unwrap();
        let terug: StoredAccount = serde_json::from_str(&json).unwrap();
        assert_eq!(terug.kind, AccountKind::Imap);
        assert_eq!(terug.imap.as_ref().unwrap().imap_port, 993);
        assert!(!terug.has_calendar(), "IMAP zonder caldav heeft geen agenda");
        assert!(!terug.supports_people());
    }
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
