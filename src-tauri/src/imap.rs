//! IMAP-/SMTP-mailclient voor accounts van het type `AccountKind::Imap`.
//!
//! De struct wordt "lui" gebouwd uit de opgeslagen instellingen (geen verbinding
//! in de constructor), zodat offline cache-fallbacks blijven werken. Zowel het
//! leespad (mappen/berichten/bijlagen lezen) als het schrijfpad (vlaggen,
//! verplaatsen/verwijderen, mappen beheren, verzenden via SMTP + Verzonden-kopie,
//! en concepten) draaien over een echte, persistente IMAP-verbinding op rustls.
//!
//! De verbinding wordt per account hergebruikt (een `Mutex<Option<Session>>`):
//! blokkerende IMAP-calls draaien op `spawn_blocking`, geserialiseerd per account,
//! met een herverbind-poging als de verbinding verlopen blijkt. Verzenden loopt
//! asynchroon via lettre (SMTP over rustls), buiten die blokkerende sessie om.

use crate::config::{ImapSettings, SpecialFolders, StoredAccount, TlsMode};
use crate::models::*;
use crate::token_store;
use anyhow::{bail, Context, Result};
use base64::Engine as _;
use imap::types::NameAttribute;
use lettre::AsyncTransport as _;
use mail_parser::{MessageParser, MimeHeaders, PartType};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

/// Scheidingsteken (SOH) binnen een samengestelde bericht-id: `map\u{1}validity\u{1}uid`.
const SOH: char = '\u{1}';

/// Onze rustls-IMAP-stream en -sessie (blokkerend, `Send`).
type ImapStream = rustls::StreamOwned<rustls::ClientConnection, TcpStream>;
type ImapSession = imap::Session<ImapStream>;

pub struct ImapClient {
    id: String,
    display_name: Option<String>,
    settings: ImapSettings,
    password: String,
    /// Persistente, per-account gedeelde verbinding (lui opgezet).
    conn: Arc<Mutex<Option<ImapSession>>>,
}

impl ImapClient {
    /// Bouwt een client uit de opgeslagen instellingen. Verbindt nog NIET: de
    /// (persistente) verbinding wordt pas bij de eerste echte call opgezet, zodat
    /// offline-fallbacks en `me()` zonder netwerk blijven werken.
    pub fn for_account(acc: &StoredAccount) -> std::result::Result<Self, String> {
        let settings = acc
            .imap
            .clone()
            .ok_or_else(|| "IMAP-account mist verbindingsinstellingen.".to_string())?;
        let password = token_store::load_secret(&acc.id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Geen wachtwoord gevonden voor dit IMAP-account.".to_string())?;
        Ok(Self {
            id: acc.id.clone(),
            display_name: acc.display_name.clone(),
            settings,
            password,
            conn: Arc::new(Mutex::new(None)),
        })
    }

    /// Voert `f` uit op een levende IMAP-sessie. Bouwt de verbinding lui op, hergebruikt
    /// hem daarna, en probeert bij een fout eenmalig opnieuw te verbinden (verlopen sessie).
    /// De blokkerende IMAP-calls draaien op `spawn_blocking`, geserialiseerd per account.
    async fn with_session<R, F>(&self, f: F) -> Result<R>
    where
        F: Fn(&mut ImapSession) -> Result<R> + Send + 'static,
        R: Send + 'static,
    {
        let conn = self.conn.clone();
        let settings = self.settings.clone();
        let password = self.password.clone();

        tokio::task::spawn_blocking(move || -> Result<R> {
            let mut guard = conn
                .lock()
                .map_err(|_| anyhow::anyhow!("Interne fout: de IMAP-verbinding is vergrendeld."))?;

            if guard.is_none() {
                *guard = Some(connect_session(&settings, &password)?);
            }

            // Eerste poging op de (mogelijk hergebruikte) sessie.
            let first = {
                let session = guard.as_mut().expect("sessie zojuist gezet");
                f(session)
            };
            match first {
                Ok(v) => Ok(v),
                Err(_) => {
                    // Verbinding kan verlopen zijn: eenmalig opnieuw verbinden en herproberen.
                    let mut fresh = connect_session(&settings, &password)?;
                    let retry = f(&mut fresh);
                    *guard = Some(fresh);
                    retry
                }
            }
        })
        .await
        .map_err(|e| anyhow::anyhow!("Interne fout bij de IMAP-taak: {e}"))?
    }

    /// Vertaalt een frontend-map-id naar het echte IMAP-mailboxpad. De frontend
    /// stuurt of een echt pad (id uit `list_folders`, ruwe wire-naam) of een
    /// Graph well-known alias ("inbox", "sentitems", ...).
    fn resolve_mailbox(&self, folder_id: &str) -> String {
        let folders = self.settings.folders.as_ref();
        let special = |sel: Option<&String>| sel.cloned().unwrap_or_else(|| folder_id.to_string());
        match folder_id {
            "inbox" | "INBOX" => "INBOX".to_string(),
            "msgfolderroot" => String::new(),
            "archive" => special(folders.and_then(|f| f.archive.as_ref())),
            "junkemail" => special(folders.and_then(|f| f.junk.as_ref())),
            "drafts" => special(folders.and_then(|f| f.drafts.as_ref())),
            "sentitems" => special(folders.and_then(|f| f.sent.as_ref())),
            "deleteditems" => special(folders.and_then(|f| f.trash.as_ref())),
            other => other.to_string(),
        }
    }

    /// Haalt het ruwe RFC822-bericht op (BODY.PEEK[]) en controleert de uidvalidity.
    async fn fetch_raw(&self, mailbox: String, uidvalidity: u32, uid: u32) -> Result<Vec<u8>> {
        self.with_session(move |session| {
            select_and_check(session, &mailbox, uidvalidity)?;
            let fetches = session
                .uid_fetch(uid.to_string(), "(BODY.PEEK[])")
                .map_err(|e| anyhow::anyhow!(translate(&e)))?;
            let fetch = fetches
                .iter()
                .next()
                .ok_or_else(|| anyhow::anyhow!("Dit bericht bestaat niet meer."))?;
            let bytes = fetch
                .body()
                .ok_or_else(|| anyhow::anyhow!("Kon de inhoud van het bericht niet ophalen."))?;
            Ok(bytes.to_vec())
        })
        .await
    }

    // ---- Leespad (geimplementeerd) ----

    /// Het ingelogde account. Puur uit de instellingen (geen netwerk), zodat dit
    /// ook offline werkt.
    pub async fn me(&self) -> Result<Account> {
        Ok(Account {
            id: self.id.clone(),
            display_name: self
                .display_name
                .clone()
                .or_else(|| Some(self.settings.email.clone())),
            mail: Some(self.settings.email.clone()),
            user_principal_name: Some(self.settings.email.clone()),
        })
    }

    pub async fn list_folders(&self) -> Result<Vec<MailFolder>> {
        self.with_session(move |session| {
            let names = session
                .list(Some(""), Some("*"))
                .map_err(|e| anyhow::anyhow!(translate(&e)))?;
            let mut out = Vec::new();
            for n in names.iter() {
                let raw = n.name();
                let delim = n.delimiter().unwrap_or("/");
                let decoded = utf7_imap::decode_utf7_imap(raw.to_string());
                let display = decoded
                    .rsplit(delim)
                    .next()
                    .unwrap_or(decoded.as_str())
                    .to_string();
                let parent = raw.rfind(delim).map(|i| raw[..i].to_string());
                out.push(MailFolder {
                    id: raw.to_string(),
                    display_name: Some(display),
                    // STATUS-per-map is te traag voor v1: tellingen laten we leeg.
                    unread_item_count: None,
                    total_item_count: None,
                    parent_folder_id: parent,
                    child_folder_count: None,
                });
            }
            Ok(out)
        })
        .await
    }

    pub async fn list_messages(
        &self,
        folder_id: &str,
        top: u32,
        skip: u32,
        ascending: bool,
        filter: Option<&str>,
    ) -> Result<MessagesPage> {
        let mailbox = self.resolve_mailbox(folder_id);
        let filter = filter.map(|s| s.to_string());
        self.with_session(move |session| {
            let mb = session
                .select(&mailbox)
                .map_err(|e| anyhow::anyhow!(translate(&e)))?;
            let uidvalidity = mb.uid_validity.unwrap_or(0);

            let criteria = match filter.as_deref() {
                Some("unread") => "UNSEEN",
                Some("flagged") => "FLAGGED",
                _ => "ALL",
            };
            let found = session
                .uid_search(criteria)
                .map_err(|e| anyhow::anyhow!(translate(&e)))?;
            let mut uids: Vec<u32> = found.into_iter().collect();
            uids.sort_unstable();
            if !ascending {
                // Nieuwste eerst (hoogste UID bovenaan).
                uids.reverse();
            }

            let start = skip as usize;
            let total = uids.len();
            let window: Vec<u32> = uids.iter().copied().skip(start).take(top as usize).collect();
            let has_more = start + window.len() < total;
            if window.is_empty() {
                return Ok(MessagesPage {
                    messages: Vec::new(),
                    has_more: false,
                    from_cache: false,
                });
            }

            let set = window
                .iter()
                .map(|u| u.to_string())
                .collect::<Vec<_>>()
                .join(",");
            let fetches = session
                .uid_fetch(set, "(UID FLAGS INTERNALDATE BODY.PEEK[HEADER])")
                .map_err(|e| anyhow::anyhow!(translate(&e)))?;

            let mut by_uid: std::collections::HashMap<u32, Message> = std::collections::HashMap::new();
            for fetch in fetches.iter() {
                let Some(uid) = fetch.uid else { continue };
                let (read, draft, flagged) = flag_bools(fetch.flags());
                let parsed = fetch.header().and_then(|h| MessageParser::default().parse(h));
                let msg = build_message(
                    &mailbox,
                    uidvalidity,
                    uid,
                    read,
                    draft,
                    flagged,
                    fetch.internal_date(),
                    parsed.as_ref(),
                    None,
                    None,
                    false,
                );
                by_uid.insert(uid, msg);
            }
            // Vensterordening behouden.
            let messages: Vec<Message> = window.iter().filter_map(|u| by_uid.remove(u)).collect();
            Ok(MessagesPage {
                messages,
                has_more,
                from_cache: false,
            })
        })
        .await
    }

    /// v1: geen achtergrond-sync naar de offline cache voor IMAP (no-op).
    pub async fn sync_folder_to_cache(&self, _account_id: &str, _folder_id: &str) -> Result<()> {
        Ok(())
    }

    pub async fn get_message(&self, id: &str) -> Result<Message> {
        let (mailbox, uidvalidity, uid) = parse_id(id)?;
        let mailbox_for_task = mailbox.clone();
        let raw = self
            .with_session(move |session| {
                select_and_check(session, &mailbox_for_task, uidvalidity)?;
                let fetches = session
                    .uid_fetch(uid.to_string(), "(UID FLAGS INTERNALDATE BODY.PEEK[])")
                    .map_err(|e| anyhow::anyhow!(translate(&e)))?;
                let fetch = fetches
                    .iter()
                    .next()
                    .ok_or_else(|| anyhow::anyhow!("Dit bericht bestaat niet meer."))?;
                let (read, draft, flagged) = flag_bools(fetch.flags());
                let bytes = fetch
                    .body()
                    .ok_or_else(|| anyhow::anyhow!("Kon de inhoud van het bericht niet ophalen."))?
                    .to_vec();
                Ok(RawFull {
                    read,
                    draft,
                    flagged,
                    internal_date: fetch.internal_date(),
                    bytes,
                })
            })
            .await?;

        let parsed = MessageParser::default()
            .parse(raw.bytes.as_slice())
            .ok_or_else(|| anyhow::anyhow!("Kon het bericht niet verwerken."))?;

        let body = if let Some(html) = parsed.body_html(0) {
            ItemBody {
                content_type: "html".to_string(),
                content: html.into_owned(),
            }
        } else if let Some(text) = parsed.body_text(0) {
            ItemBody {
                content_type: "text".to_string(),
                content: text.into_owned(),
            }
        } else {
            ItemBody {
                content_type: "text".to_string(),
                content: String::new(),
            }
        };
        let preview = parsed.body_text(0).map(|t| preview_text(t.as_ref()));

        Ok(build_message(
            &mailbox,
            uidvalidity,
            uid,
            raw.read,
            raw.draft,
            raw.flagged,
            raw.internal_date,
            Some(&parsed),
            Some(body),
            preview,
            true,
        ))
    }

    /// Uitgebreid zoeken, vertaald naar IMAP SEARCH-criteria (RFC 3501).
    /// Losse criteria achter elkaar zijn een impliciete AND.
    ///
    /// Zoeken op bijlagen kan IMAP niet: er is geen HASATTACHMENT-criterium en
    /// alle bodies ophalen om te tellen zou de mailbox leegtrekken. Dat vinkje
    /// wordt hier genegeerd; de UI verbergt het bij IMAP-accounts.
    pub async fn search_advanced(
        &self,
        q: &SearchQuery,
        top: u32,
        folder_id: Option<&str>,
    ) -> Result<MessagesPage> {
        let mut crit: Vec<String> = Vec::new();
        let mut field = |name: &str, value: &Option<String>| {
            if let Some(v) = value.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
                crit.push(format!("{name} {}", imap_quote(v)));
            }
        };
        field("FROM", &q.from);
        field("TO", &q.to);
        field("CC", &q.cc);
        field("SUBJECT", &q.subject);
        field("TEXT", &q.text);
        if let Some(d) = q.since.as_deref().and_then(imap_date) {
            crit.push(format!("SINCE {d}"));
        }
        if let Some(d) = q.until.as_deref().and_then(next_day).as_deref().and_then(imap_date) {
            // BEFORE is exclusief; een dag erbij maakt de einddatum inclusief.
            crit.push(format!("BEFORE {d}"));
        }
        match q.is_read {
            Some(true) => crit.push("SEEN".to_string()),
            Some(false) => crit.push("UNSEEN".to_string()),
            None => {}
        }
        if crit.is_empty() {
            crit.push("ALL".to_string());
        }
        self.search_raw(crit.join(" "), top, folder_id).await
    }

    pub async fn search_messages(
        &self,
        query: &str,
        top: u32,
        folder_id: Option<&str>,
    ) -> Result<MessagesPage> {
        self.search_raw(format!("TEXT {}", imap_quote(query)), top, folder_id)
            .await
    }

    /// Voert een kant-en-klare SEARCH-expressie uit en bouwt er berichten van.
    /// Gedeeld door het eenvoudige en het uitgebreide zoeken.
    async fn search_raw(
        &self,
        criteria: String,
        top: u32,
        folder_id: Option<&str>,
    ) -> Result<MessagesPage> {
        let mailbox = match folder_id {
            Some(f) => self.resolve_mailbox(f),
            None => "INBOX".to_string(),
        };
        self.with_session(move |session| {
            let mb = session
                .select(&mailbox)
                .map_err(|e| anyhow::anyhow!(translate(&e)))?;
            let uidvalidity = mb.uid_validity.unwrap_or(0);

            let found = session
                .uid_search(&criteria)
                .map_err(|e| anyhow::anyhow!(translate(&e)))?;
            let mut uids: Vec<u32> = found.into_iter().collect();
            uids.sort_unstable();
            uids.reverse(); // nieuwste eerst
            uids.truncate(top as usize);
            if uids.is_empty() {
                return Ok(MessagesPage {
                    messages: Vec::new(),
                    has_more: false,
                    from_cache: false,
                });
            }

            let set = uids.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
            let fetches = session
                .uid_fetch(set, "(UID FLAGS INTERNALDATE BODY.PEEK[HEADER])")
                .map_err(|e| anyhow::anyhow!(translate(&e)))?;

            let mut by_uid: std::collections::HashMap<u32, Message> = std::collections::HashMap::new();
            for fetch in fetches.iter() {
                let Some(uid) = fetch.uid else { continue };
                let (read, draft, flagged) = flag_bools(fetch.flags());
                let parsed = fetch.header().and_then(|h| MessageParser::default().parse(h));
                by_uid.insert(
                    uid,
                    build_message(
                        &mailbox,
                        uidvalidity,
                        uid,
                        read,
                        draft,
                        flagged,
                        fetch.internal_date(),
                        parsed.as_ref(),
                        None,
                        None,
                        false,
                    ),
                );
            }
            let messages: Vec<Message> = uids.iter().filter_map(|u| by_uid.remove(u)).collect();
            Ok(MessagesPage {
                messages,
                has_more: false,
                from_cache: false,
            })
        })
        .await
    }

    pub async fn list_attachments(&self, message_id: &str) -> Result<Vec<Attachment>> {
        let (mailbox, uidvalidity, uid) = parse_id(message_id)?;
        let bytes = self.fetch_raw(mailbox, uidvalidity, uid).await?;
        let parsed = MessageParser::default()
            .parse(bytes.as_slice())
            .ok_or_else(|| anyhow::anyhow!("Kon het bericht niet verwerken."))?;

        let mut out = Vec::new();
        for (idx, part) in parsed.attachments().enumerate() {
            out.push(Attachment {
                id: idx.to_string(),
                name: part.attachment_name().map(str::to_string),
                content_type: content_type_string(part),
                size: Some(part.len() as i64),
                is_inline: Some(is_inline_part(part)),
            });
        }
        Ok(out)
    }

    /// Slaat het hele bericht op als .eml in de Downloads-map. IMAP levert de
    /// ruwe RFC822-bytes rechtstreeks, dus die gaan ongewijzigd naar het bestand.
    pub async fn download_message(&self, message_id: &str) -> Result<String> {
        let (mailbox, uidvalidity, uid) = parse_id(message_id)?;
        let raw = self.fetch_raw(mailbox, uidvalidity, uid).await?;
        let subject = mail_parser::MessageParser::default()
            .parse(&raw[..])
            .and_then(|p| p.subject().map(str::to_string));
        crate::graph::write_eml(subject.as_deref(), &raw)
    }

    pub async fn download_attachment(
        &self,
        message_id: &str,
        attachment_id: &str,
    ) -> Result<String> {
        let (mailbox, uidvalidity, uid) = parse_id(message_id)?;
        let want: usize = attachment_id
            .parse()
            .map_err(|_| anyhow::anyhow!("Ongeldige bijlage-verwijzing."))?;

        let bytes = self.fetch_raw(mailbox, uidvalidity, uid).await?;
        let parsed = MessageParser::default()
            .parse(bytes.as_slice())
            .ok_or_else(|| anyhow::anyhow!("Kon het bericht niet verwerken."))?;
        let part = parsed
            .attachments()
            .nth(want)
            .ok_or_else(|| anyhow::anyhow!("Deze bijlage bestaat niet meer."))?;

        let name = sanitize_filename(part.attachment_name().unwrap_or("bijlage"));
        let dir = dirs::download_dir()
            .ok_or_else(|| anyhow::anyhow!("Kon de Downloads-map niet vinden."))?;
        let path = unique_path(&dir, &name);
        std::fs::write(&path, part.contents())
            .context("Kon het bestand niet opslaan in Downloads.")?;
        Ok(path.to_string_lossy().into_owned())
    }

    pub async fn inline_images(&self, message_id: &str) -> Result<Vec<InlineImage>> {
        let (mailbox, uidvalidity, uid) = parse_id(message_id)?;
        let bytes = self.fetch_raw(mailbox, uidvalidity, uid).await?;
        let parsed = MessageParser::default()
            .parse(bytes.as_slice())
            .ok_or_else(|| anyhow::anyhow!("Kon het bericht niet verwerken."))?;

        let mut out = Vec::new();
        for part in parsed.attachments() {
            if !is_inline_part(part) {
                continue;
            }
            let Some(cid) = part.content_id() else { continue };
            let cid = cid.trim().trim_start_matches('<').trim_end_matches('>').to_string();
            if cid.is_empty() {
                continue;
            }
            out.push(InlineImage {
                content_id: cid,
                content_type: content_type_string(part)
                    .unwrap_or_else(|| "application/octet-stream".to_string()),
                content_bytes: base64::engine::general_purpose::STANDARD.encode(part.contents()),
            });
        }
        Ok(out)
    }

    // ---- Schrijfpad ----

    /// Zet de \Seen-vlag (gelezen/ongelezen).
    pub async fn set_read(&self, id: &str, is_read: bool) -> Result<()> {
        let (mailbox, uidvalidity, uid) = parse_id(id)?;
        let query = if is_read {
            "+FLAGS (\\Seen)"
        } else {
            "-FLAGS (\\Seen)"
        };
        self.with_session(move |session| {
            select_and_check(session, &mailbox, uidvalidity)?;
            session
                .uid_store(uid.to_string(), query)
                .map_err(|e| anyhow::anyhow!(translate(&e)))?;
            Ok(())
        })
        .await
    }

    /// Zet de \Flagged-vlag (markering / opvolgvlag).
    pub async fn set_flag(&self, id: &str, flagged: bool) -> Result<()> {
        let (mailbox, uidvalidity, uid) = parse_id(id)?;
        let query = if flagged {
            "+FLAGS (\\Flagged)"
        } else {
            "-FLAGS (\\Flagged)"
        };
        self.with_session(move |session| {
            select_and_check(session, &mailbox, uidvalidity)?;
            session
                .uid_store(uid.to_string(), query)
                .map_err(|e| anyhow::anyhow!(translate(&e)))?;
            Ok(())
        })
        .await
    }

    /// Verwijdert een bericht: naar de Prullenbak als die bekend en anders is,
    /// anders \Deleted + EXPUNGE ter plekke.
    pub async fn delete_message(&self, id: &str) -> Result<()> {
        let (mailbox, uidvalidity, uid) = parse_id(id)?;
        let trash = self
            .settings
            .folders
            .as_ref()
            .and_then(|f| f.trash.clone())
            .filter(|t| !t.is_empty() && *t != mailbox);
        self.with_session(move |session| {
            select_and_check(session, &mailbox, uidvalidity)?;
            let uid_set = uid.to_string();
            match &trash {
                Some(dest) => move_uid(session, &uid_set, dest),
                None => {
                    session
                        .uid_store(&uid_set, "+FLAGS (\\Deleted)")
                        .map_err(|e| anyhow::anyhow!(translate(&e)))?;
                    session
                        .expunge()
                        .map_err(|e| anyhow::anyhow!(translate(&e)))?;
                    Ok(())
                }
            }
        })
        .await
    }

    /// Verplaatst een bericht naar een andere map (UID MOVE, met kopieer-fallback).
    pub async fn move_message(&self, id: &str, destination_id: &str) -> Result<()> {
        let (mailbox, uidvalidity, uid) = parse_id(id)?;
        let dest = self.resolve_mailbox(destination_id);
        if dest.is_empty() {
            bail!("Ongeldige doelmap voor verplaatsen.");
        }
        self.with_session(move |session| {
            select_and_check(session, &mailbox, uidvalidity)?;
            move_uid(session, &uid.to_string(), &dest)
        })
        .await
    }

    /// Als [`move_message`], maar geeft het verplaatste bericht (nieuw id) terug.
    /// Het bericht wordt in de doelmap teruggezocht op zijn Message-ID.
    pub async fn move_message_returning(&self, id: &str, destination_id: &str) -> Result<Message> {
        let (mailbox, uidvalidity, uid) = parse_id(id)?;
        let dest = self.resolve_mailbox(destination_id);
        if dest.is_empty() {
            bail!("Ongeldige doelmap voor verplaatsen.");
        }
        self.with_session(move |session| {
            select_and_check(session, &mailbox, uidvalidity)?;
            // Message-ID vastleggen vóór de verplaatsing (nodig om terug te vinden).
            let message_id = fetch_message_id(session, uid)?;
            move_uid(session, &uid.to_string(), &dest)?;
            let (new_validity, new_uid) = relocate_by_message_id(session, &dest, message_id.as_deref())?;
            Ok(minimal_message(make_id(&dest, new_validity, new_uid), false))
        })
        .await
    }

    /// Maakt een (top-level) map aan. `name` is het ruwe mailboxpad.
    pub async fn create_folder(&self, name: &str) -> Result<MailFolder> {
        let name = name.to_string();
        let delim = self.hierarchy_delimiter();
        let for_task = name.clone();
        self.with_session(move |session| {
            session
                .create(&for_task)
                .map_err(|e| anyhow::anyhow!(translate(&e)))?;
            Ok(())
        })
        .await?;
        let leaf = name.rsplit(delim.as_str()).next().unwrap_or(&name).to_string();
        Ok(MailFolder {
            id: name,
            display_name: Some(leaf),
            unread_item_count: None,
            total_item_count: None,
            parent_folder_id: None,
            child_folder_count: None,
        })
    }

    /// Hernoemt een map: houdt hem op zijn plek, vervangt alleen de bladnaam.
    pub async fn rename_folder(&self, id: &str, name: &str) -> Result<()> {
        let delim = self.hierarchy_delimiter();
        let target = match id.rfind(delim.as_str()) {
            Some(i) => format!("{}{}{}", &id[..i], delim, name),
            None => name.to_string(),
        };
        let (from, to) = (id.to_string(), target);
        self.with_session(move |session| {
            session
                .rename(&from, &to)
                .map_err(|e| anyhow::anyhow!(translate(&e)))?;
            Ok(())
        })
        .await
    }

    /// Verwijdert een map (met inhoud).
    pub async fn delete_folder(&self, id: &str) -> Result<()> {
        let id = id.to_string();
        self.with_session(move |session| {
            session
                .delete(&id)
                .map_err(|e| anyhow::anyhow!(translate(&e)))?;
            Ok(())
        })
        .await
    }

    /// Verplaatst een map onder een andere map ("msgfolderroot" = hoofdniveau).
    pub async fn move_folder(&self, id: &str, destination_id: &str) -> Result<()> {
        let delim = self.hierarchy_delimiter();
        let leaf = id.rsplit(delim.as_str()).next().unwrap_or(id).to_string();
        let dest = self.resolve_mailbox(destination_id);
        let target = if dest.is_empty() {
            leaf
        } else {
            format!("{dest}{delim}{leaf}")
        };
        let (from, to) = (id.to_string(), target);
        self.with_session(move |session| {
            session
                .rename(&from, &to)
                .map_err(|e| anyhow::anyhow!(translate(&e)))?;
            Ok(())
        })
        .await
    }

    /// Verstuurt een e-mail via SMTP en bewaart (indien ingesteld) een kopie in
    /// Verzonden via IMAP APPEND. Mislukt de APPEND, dan blijft het verzenden geldig.
    pub async fn send_mail(&self, input: &ComposeInput) -> Result<()> {
        let message_id = self.generate_message_id();
        let message = self.build_mime(input, &message_id)?;
        let raw = message.formatted();

        let transport = self.smtp_transport()?;
        transport
            .send(message)
            .await
            .map_err(|e| anyhow::anyhow!(smtp_error(&e)))?;

        if self.settings.save_to_sent {
            if let Some(sent) = self.sent_mailbox() {
                // Kopie in Verzonden is "best effort": faalt dit, dan is de mail toch weg.
                let _ = self.append_seen(sent, raw).await;
            }
        }
        Ok(())
    }

    /// Maakt een concept aan (IMAP APPEND met \Draft) en geeft het terug (met nieuw id).
    pub async fn create_draft(&self, input: &ComposeInput) -> Result<Message> {
        let message_id = self.generate_message_id();
        let message = self.build_mime(input, &message_id)?;
        let raw = message.formatted();
        let drafts = self
            .drafts_mailbox()
            .ok_or_else(|| anyhow::anyhow!("Er is geen Concepten-map ingesteld voor dit account."))?;
        self.with_session(move |session| {
            session
                .append_with_flags(&drafts, &raw, &[imap::types::Flag::Draft])
                .map_err(|e| anyhow::anyhow!(translate(&e)))?;
            let (validity, uid) = relocate_by_message_id(session, &drafts, Some(&message_id))?;
            Ok(minimal_message(make_id(&drafts, validity, uid), true))
        })
        .await
    }

    /// Werkt een concept bij: nieuw concept toevoegen en het oude verwijderen.
    pub async fn update_draft(&self, id: &str, input: &ComposeInput) -> Result<()> {
        let message_id = self.generate_message_id();
        let message = self.build_mime(input, &message_id)?;
        let raw = message.formatted();
        let drafts = self
            .drafts_mailbox()
            .ok_or_else(|| anyhow::anyhow!("Er is geen Concepten-map ingesteld voor dit account."))?;
        let (old_mailbox, old_validity, old_uid) = parse_id(id)?;
        self.with_session(move |session| {
            session
                .append_with_flags(&drafts, &raw, &[imap::types::Flag::Draft])
                .map_err(|e| anyhow::anyhow!(translate(&e)))?;
            // Oud concept opruimen (best effort: het nieuwe staat er al).
            if select_and_check(session, &old_mailbox, old_validity).is_ok() {
                let _ = session.uid_store(old_uid.to_string(), "+FLAGS (\\Deleted)");
                let _ = session.expunge();
            }
            Ok(())
        })
        .await
    }

    /// Verstuurt een bestaand concept. Gepland verzenden kan niet via IMAP/SMTP.
    pub async fn send_draft(
        &self,
        id: &str,
        input: &ComposeInput,
        defer_utc: Option<&str>,
    ) -> Result<()> {
        if defer_utc.is_some() {
            bail!("Gepland verzenden wordt niet ondersteund voor IMAP-accounts.");
        }
        // Verzenden + Verzonden-kopie (hergebruikt de send_mail-logica).
        self.send_mail(input).await?;
        // Concept opruimen (best effort).
        let (mailbox, validity, uid) = parse_id(id)?;
        self.with_session(move |session| {
            if select_and_check(session, &mailbox, validity).is_ok() {
                let _ = session.uid_store(uid.to_string(), "+FLAGS (\\Deleted)");
                let _ = session.expunge();
            }
            Ok(())
        })
        .await
    }

    // ---- Interne helpers voor het schrijfpad ----

    /// De ingestelde Verzonden-map (ruwe wire-naam), indien opgelost.
    fn sent_mailbox(&self) -> Option<String> {
        self.settings
            .folders
            .as_ref()
            .and_then(|f| f.sent.clone())
            .filter(|s| !s.is_empty())
    }

    /// De ingestelde Concepten-map (ruwe wire-naam), indien opgelost.
    fn drafts_mailbox(&self) -> Option<String> {
        self.settings
            .folders
            .as_ref()
            .and_then(|f| f.drafts.clone())
            .filter(|s| !s.is_empty())
    }

    /// Het hierarchie-scheidingsteken van de server (uit de opgeloste mappen; "/" default).
    fn hierarchy_delimiter(&self) -> String {
        self.settings
            .folders
            .as_ref()
            .and_then(|f| f.delimiter.clone())
            .filter(|d| !d.is_empty())
            .unwrap_or_else(|| "/".to_string())
    }

    /// Genereert een uniek Message-ID zodat we een APPEND/verzending later kunnen
    /// terugvinden (Gmail e.d. voegen anders zelf een id toe dat wij niet kennen).
    fn generate_message_id(&self) -> String {
        use rand::RngCore;
        let domain = self
            .settings
            .email
            .rsplit('@')
            .next()
            .filter(|d| !d.is_empty())
            .unwrap_or("be-mail.local");
        let ts = chrono::Utc::now().timestamp_millis();
        let rnd = rand::thread_rng().next_u64();
        format!("<{ts:x}.{rnd:x}@{domain}>")
    }

    /// Bouwt de asynchrone SMTP-transport volgens de accountinstellingen.
    fn smtp_transport(&self) -> Result<lettre::AsyncSmtpTransport<lettre::Tokio1Executor>> {
        build_smtp_transport(&self.settings, &self.password)
    }

    /// Bouwt het MIME-bericht uit de compose-invoer (multipart/alternative, met
    /// related-wikkeling bij inline-afbeeldingen en mixed-wikkeling bij bijlagen).
    fn build_mime(&self, input: &ComposeInput, message_id: &str) -> Result<lettre::Message> {
        use lettre::message::{Mailbox, MultiPart, SinglePart};

        let from_addr: lettre::Address = self
            .settings
            .email
            .trim()
            .parse()
            .map_err(|_| anyhow::anyhow!("Ongeldig afzenderadres: {}", self.settings.email))?;
        let from = Mailbox::new(self.display_name.clone(), from_addr);

        let mut builder = lettre::Message::builder()
            .from(from)
            .message_id(Some(message_id.to_string()))
            .subject(input.subject.clone());

        for addr in &input.to {
            if !addr.trim().is_empty() {
                builder = builder.to(parse_mailbox(addr)?);
            }
        }
        for addr in &input.cc {
            if !addr.trim().is_empty() {
                builder = builder.cc(parse_mailbox(addr)?);
            }
        }
        for addr in &input.bcc {
            if !addr.trim().is_empty() {
                builder = builder.bcc(parse_mailbox(addr)?);
            }
        }

        // Prioriteit (Importance/X-Priority) - overslaan bij "normal" of leeg.
        match input.importance.as_deref() {
            Some("high") => {
                if let Some(h) = raw_header("Importance", "High") {
                    builder = builder.raw_header(h);
                }
                if let Some(h) = raw_header("X-Priority", "1") {
                    builder = builder.raw_header(h);
                }
            }
            Some("low") => {
                if let Some(h) = raw_header("Importance", "Low") {
                    builder = builder.raw_header(h);
                }
                if let Some(h) = raw_header("X-Priority", "5") {
                    builder = builder.raw_header(h);
                }
            }
            _ => {}
        }

        let html = input.body_html.clone();
        let text = html_to_text(&html);
        let alternative = MultiPart::alternative()
            .singlepart(SinglePart::plain(text))
            .singlepart(SinglePart::html(html));

        let inline: Vec<&AttachmentInput> = input
            .attachments
            .iter()
            .filter(|a| a.is_inline == Some(true) && a.content_id.is_some())
            .collect();
        let regular: Vec<&AttachmentInput> = input
            .attachments
            .iter()
            .filter(|a| !(a.is_inline == Some(true) && a.content_id.is_some()))
            .collect();

        // Inline-afbeeldingen -> multipart/related rond de alternatieve body.
        let with_inline = if inline.is_empty() {
            alternative
        } else {
            let mut related = MultiPart::related().multipart(alternative);
            for a in &inline {
                related = related.singlepart(inline_part(a)?);
            }
            related
        };

        // Gewone bijlagen -> multipart/mixed eromheen.
        let top = if regular.is_empty() {
            with_inline
        } else {
            let mut mixed = MultiPart::mixed().multipart(with_inline);
            for a in &regular {
                mixed = mixed.singlepart(attachment_part(a)?);
            }
            mixed
        };

        builder
            .multipart(top)
            .map_err(|e| anyhow::anyhow!("Kon het e-mailbericht niet opbouwen: {e}"))
    }

    /// APPEND van ruwe RFC822-bytes (Verzonden-kopie) met de \Seen-vlag.
    async fn append_seen(&self, mailbox: String, raw: Vec<u8>) -> Result<()> {
        self.with_session(move |session| {
            session
                .append_with_flags(&mailbox, &raw, &[imap::types::Flag::Seen])
                .map_err(|e| anyhow::anyhow!(translate(&e)))?;
            Ok(())
        })
        .await
    }
}

/// Vaste velden uit een volledig FETCH-resultaat, los van de sessie-lifetime.
struct RawFull {
    read: bool,
    draft: bool,
    flagged: bool,
    internal_date: Option<chrono::DateTime<chrono::FixedOffset>>,
    bytes: Vec<u8>,
}

// ---- Verbinding & TLS ----

/// Gedeelde rustls-clientconfig (eenmalig opgebouwd).
fn tls_config() -> Result<Arc<rustls::ClientConfig>> {
    static CFG: OnceLock<Arc<rustls::ClientConfig>> = OnceLock::new();
    if let Some(c) = CFG.get() {
        return Ok(c.clone());
    }
    let cfg = build_tls_config()?;
    Ok(CFG.get_or_init(|| cfg).clone())
}

fn build_tls_config() -> Result<Arc<rustls::ClientConfig>> {
    let mut roots = rustls::RootCertStore::empty();
    for c in rustls_native_certs::load_native_certs().certs {
        let _ = roots.add(c);
    }
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let cfg = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|e| anyhow::anyhow!("Kon TLS niet initialiseren: {e}"))?
    .with_root_certificates(roots)
    .with_no_client_auth();
    Ok(Arc::new(cfg))
}

/// Zet een TLS-stream op over een bestaande TCP-verbinding.
fn tls_stream(host: &str, tcp: TcpStream) -> Result<ImapStream> {
    let config = tls_config()?;
    let name = rustls::pki_types::ServerName::try_from(host.to_string())
        .map_err(|_| anyhow::anyhow!("Ongeldige servernaam: {host}"))?;
    let conn = rustls::ClientConnection::new(config, name)
        .map_err(|e| anyhow::anyhow!("Kon de TLS-verbinding niet opzetten: {e}"))?;
    Ok(rustls::StreamOwned::new(conn, tcp))
}

/// Bouwt een ingelogde IMAP-sessie op volgens de TLS-modus van het account.
fn connect_session(settings: &ImapSettings, password: &str) -> Result<ImapSession> {
    let addr = format!("{}:{}", settings.imap_host, settings.imap_port);
    let tcp = TcpStream::connect(&addr)
        .map_err(|e| anyhow::anyhow!("Kon geen verbinding maken met {addr}: {e}"))?;
    tcp.set_read_timeout(Some(Duration::from_secs(30))).ok();
    tcp.set_write_timeout(Some(Duration::from_secs(30))).ok();

    let host = settings.imap_host.as_str();
    let user = settings.imap_username.as_str();

    match settings.imap_security {
        TlsMode::ImplicitTls => {
            let tls = tls_stream(host, tcp)?;
            let mut client = imap::Client::new(tls);
            client
                .read_greeting()
                .map_err(|e| anyhow::anyhow!(translate(&e)))?;
            client
                .login(user, password)
                .map_err(|(e, _)| anyhow::anyhow!(translate(&e)))
        }
        TlsMode::StartTls => {
            // Greeting + STARTTLS byte-voor-byte op de kale socket. GEEN BufReader:
            // die zou over de TLS-handshake heen lezen en die corrupt maken.
            let mut plain = tcp;
            let _greeting = read_line_raw(&mut plain)?;
            plain
                .write_all(b"a001 STARTTLS\r\n")
                .map_err(|e| anyhow::anyhow!("STARTTLS mislukte: {e}"))?;
            plain.flush().ok();
            let resp = read_tagged_raw(&mut plain, "a001")?;
            if !resp.to_ascii_uppercase().contains(" OK") {
                bail!("De server weigerde STARTTLS: {}", resp.trim());
            }
            let tls = tls_stream(host, plain)?;
            let client = imap::Client::new(tls);
            // Na STARTTLS stuurt de server geen nieuwe greeting: direct inloggen.
            client
                .login(user, password)
                .map_err(|(e, _)| anyhow::anyhow!(translate(&e)))
        }
    }
}

/// Leest een enkele regel (t/m `\n`) byte-voor-byte van de kale socket.
fn read_line_raw(stream: &mut impl Read) -> Result<String> {
    let mut buf = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        let n = stream
            .read(&mut byte)
            .map_err(|e| anyhow::anyhow!("Kon niet lezen van de mailserver: {e}"))?;
        if n == 0 {
            break;
        }
        buf.push(byte[0]);
        if byte[0] == b'\n' {
            break;
        }
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// Leest regels tot de tagged reactie (`tag ...`) verschijnt.
fn read_tagged_raw(stream: &mut impl Read, tag: &str) -> Result<String> {
    for _ in 0..50 {
        let line = read_line_raw(stream)?;
        if line.is_empty() {
            bail!("De verbinding werd verbroken tijdens STARTTLS.");
        }
        if line.starts_with(tag) {
            return Ok(line);
        }
    }
    bail!("Onverwacht antwoord van de mailserver tijdens STARTTLS.")
}

/// Vertaalt een IMAP-fout naar een leesbare Nederlandse melding.
fn translate(e: &imap::Error) -> String {
    use imap::Error;
    match e {
        Error::ConnectionLost => "De verbinding met de mailserver ging verloren.".to_string(),
        Error::Io(io) => format!("Netwerkfout bij de mailserver: {io}"),
        Error::No(msg) => format!(
            "De mailserver weigerde de opdracht (mogelijk onjuiste gebruikersnaam of wachtwoord): {}",
            msg.trim()
        ),
        Error::Bad(msg) => format!("De mailserver gaf een fout: {}", msg.trim()),
        Error::Parse(_) => "Kon het antwoord van de mailserver niet verwerken.".to_string(),
        Error::Validate(_) => "Ongeldige invoer voor de mailserver.".to_string(),
        _ => format!("IMAP-fout: {e}"),
    }
}

// ---- Id-codering & mailbox-selectie ----

fn make_id(mailbox: &str, uidvalidity: u32, uid: u32) -> String {
    format!("{mailbox}{SOH}{uidvalidity}{SOH}{uid}")
}

fn parse_id(id: &str) -> Result<(String, u32, u32)> {
    let mut parts = id.split(SOH);
    let mailbox = parts
        .next()
        .ok_or_else(|| anyhow::anyhow!("Ongeldige bericht-verwijzing."))?;
    let uidvalidity = parts
        .next()
        .and_then(|s| s.parse::<u32>().ok())
        .ok_or_else(|| anyhow::anyhow!("Ongeldige bericht-verwijzing."))?;
    let uid = parts
        .next()
        .and_then(|s| s.parse::<u32>().ok())
        .ok_or_else(|| anyhow::anyhow!("Ongeldige bericht-verwijzing."))?;
    Ok((mailbox.to_string(), uidvalidity, uid))
}

/// Selecteert de mailbox en controleert of de uidvalidity nog klopt.
fn select_and_check(session: &mut ImapSession, mailbox: &str, uidvalidity: u32) -> Result<()> {
    let mb = session
        .select(mailbox)
        .map_err(|e| anyhow::anyhow!(translate(&e)))?;
    if mb.uid_validity.unwrap_or(0) != uidvalidity {
        bail!("Dit bericht is verlopen, ververs de map.");
    }
    Ok(())
}

// ---- Bericht-opbouw ----

/// (gelezen, concept, gemarkeerd) uit de IMAP-vlaggen.
fn flag_bools(flags: &[imap::types::Flag]) -> (bool, bool, bool) {
    let read = flags.iter().any(|f| matches!(f, imap::types::Flag::Seen));
    let draft = flags.iter().any(|f| matches!(f, imap::types::Flag::Draft));
    let flagged = flags.iter().any(|f| matches!(f, imap::types::Flag::Flagged));
    (read, draft, flagged)
}

/// Bouwt een `Message`. `parsed` levert de kopvelden; `body`/`body_preview` worden
/// (alleen bij een volledig bericht) apart meegegeven omdat de body-accessors van
/// mail-parser een strakkere lifetime hebben. Bij `full` vullen we ook de kop-lijst
/// en `has_attachments`.
#[allow(clippy::too_many_arguments)]
fn build_message(
    mailbox: &str,
    uidvalidity: u32,
    uid: u32,
    read: bool,
    draft: bool,
    flagged: bool,
    internal_date: Option<chrono::DateTime<chrono::FixedOffset>>,
    parsed: Option<&mail_parser::Message>,
    body: Option<ItemBody>,
    body_preview: Option<String>,
    full: bool,
) -> Message {
    let flag = Some(FollowupFlag {
        flag_status: Some(if flagged { "flagged" } else { "notFlagged" }.to_string()),
    });

    // receivedDateTime moet UTC zijn (de notifier vergelijkt lexicografisch).
    let received = internal_date
        .map(to_utc_rfc3339)
        .or_else(|| parsed.and_then(|p| p.date()).and_then(date_header_utc));

    let subject = parsed.and_then(|p| p.subject()).map(str::to_string);
    let from = parsed.and_then(|p| first_recipient(p.from()));
    let to_recipients = parsed.and_then(|p| recipients(p.to()));
    let cc_recipients = parsed.and_then(|p| recipients(p.cc()));
    let bcc_recipients = parsed.and_then(|p| recipients(p.bcc()));

    // Threading: eerste References-id, anders In-Reply-To, anders het eigen id.
    let conversation_id = parsed.and_then(|p| {
        first_ref_id(p.references())
            .or_else(|| first_ref_id(p.in_reply_to()))
            .or_else(|| p.message_id().map(str::to_string))
    });

    let (has_attachments, internet_message_headers) = if full {
        let has = parsed.map(|p| p.attachment_count() > 0);
        let headers = parsed.map(|p| {
            p.headers_raw()
                .map(|(name, value)| MessageHeader {
                    name: Some(name.to_string()),
                    value: Some(value.trim().to_string()),
                })
                .collect::<Vec<_>>()
        });
        (has, headers)
    } else {
        (None, None)
    };

    Message {
        odata_type: None,
        id: make_id(mailbox, uidvalidity, uid),
        subject,
        from,
        to_recipients,
        cc_recipients,
        bcc_recipients,
        received_date_time: received.clone(),
        sent_date_time: received,
        is_read: Some(read),
        has_attachments,
        body_preview,
        importance: None,
        flag,
        body,
        web_link: None,
        is_draft: Some(draft),
        internet_message_headers,
        categories: None,
        conversation_id,
    }
}

/// Normaliseert een IMAP INTERNALDATE naar UTC RFC3339 (`...+00:00`).
fn to_utc_rfc3339(dt: chrono::DateTime<chrono::FixedOffset>) -> String {
    dt.with_timezone(&chrono::Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, false)
}

/// Zet een geparste Date-kop om naar UTC RFC3339 (fallback als INTERNALDATE ontbreekt).
fn date_header_utc(dt: &mail_parser::DateTime) -> Option<String> {
    chrono::DateTime::from_timestamp(dt.to_timestamp(), 0)
        .map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Secs, false))
}

fn to_recipient(a: &mail_parser::Addr) -> Recipient {
    Recipient {
        email_address: EmailAddress {
            name: a.name().map(str::to_string),
            address: a.address().map(str::to_string),
        },
    }
}

fn first_recipient(addr: Option<&mail_parser::Address>) -> Option<Recipient> {
    addr?.first().map(to_recipient)
}

fn recipients(addr: Option<&mail_parser::Address>) -> Option<Vec<Recipient>> {
    let list: Vec<Recipient> = addr?.iter().map(to_recipient).collect();
    if list.is_empty() {
        None
    } else {
        Some(list)
    }
}

/// Eerste bericht-id uit een References-/In-Reply-To-kop.
fn first_ref_id(hv: &mail_parser::HeaderValue) -> Option<String> {
    match hv {
        mail_parser::HeaderValue::Text(t) => Some(t.trim().to_string()),
        mail_parser::HeaderValue::TextList(list) => list.first().map(|s| s.trim().to_string()),
        _ => None,
    }
}

/// "type/subtype" van een MIME-deel.
fn content_type_string(part: &mail_parser::MessagePart) -> Option<String> {
    part.content_type().map(|ct| match ct.subtype() {
        Some(sub) => format!("{}/{}", ct.ctype(), sub),
        None => ct.ctype().to_string(),
    })
}

/// Is dit deel een ingesloten (inline) bijlage?
fn is_inline_part(part: &mail_parser::MessagePart) -> bool {
    if matches!(part.body, PartType::InlineBinary(_)) {
        return true;
    }
    part.content_disposition()
        .map(|cd| cd.is_inline())
        .unwrap_or(false)
}

/// Eerste ~200 tekens van de platte tekst (witruimte samengevouwen) als preview.
fn preview_text(t: &str) -> String {
    let collapsed = t.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(200).collect()
}

/// Wikkelt een zoekterm veilig in dubbele aanhalingstekens (IMAP quoted string).
fn imap_quote(s: &str) -> String {
    let escaped = s.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

/// Haalt tekens uit een bestandsnaam die op Windows niet mogen (en padscheiders).
/// "2026-07-27" -> "27-Jul-2026", het datumformaat van IMAP SEARCH (RFC 3501).
/// Geeft None bij een onbruikbare datum, zodat het criterium dan wegvalt in
/// plaats van de hele zoekopdracht te laten mislukken.
fn imap_date(ymd: &str) -> Option<String> {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let d = chrono::NaiveDate::parse_from_str(ymd.trim(), "%Y-%m-%d").ok()?;
    use chrono::Datelike;
    Some(format!(
        "{}-{}-{}",
        d.day(),
        MONTHS[(d.month() - 1) as usize],
        d.year()
    ))
}

/// Eén dag later ("2026-07-27" -> "2026-07-28"), om een inclusieve einddatum
/// om te zetten naar het exclusieve BEFORE van IMAP.
fn next_day(ymd: &str) -> Option<String> {
    let d = chrono::NaiveDate::parse_from_str(ymd.trim(), "%Y-%m-%d").ok()?;
    Some(d.succ_opt()?.format("%Y-%m-%d").to_string())
}

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "bijlage".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Geeft een pad dat nog niet bestaat: "naam.pdf", anders "naam (2).pdf", enz.
fn unique_path(dir: &std::path::Path, filename: &str) -> std::path::PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match filename.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (filename.to_string(), String::new()),
    };
    for i in 2..1000 {
        let p = dir.join(format!("{stem} ({i}){ext}"));
        if !p.exists() {
            return p;
        }
    }
    dir.join(filename)
}

// ---- Schrijfpad-helpers (verplaatsen, terugvinden, SMTP, MIME) ----

/// UID MOVE naar `dest`; valt terug op kopie + \Deleted + EXPUNGE als de server
/// geen MOVE-extensie ondersteunt. Werkt op de reeds geselecteerde bronmailbox.
fn move_uid(session: &mut ImapSession, uid_set: &str, dest: &str) -> Result<()> {
    if session.uid_mv(uid_set, dest).is_ok() {
        return Ok(());
    }
    session
        .uid_copy(uid_set, dest)
        .map_err(|e| anyhow::anyhow!(translate(&e)))?;
    session
        .uid_store(uid_set, "+FLAGS (\\Deleted)")
        .map_err(|e| anyhow::anyhow!(translate(&e)))?;
    session
        .expunge()
        .map_err(|e| anyhow::anyhow!(translate(&e)))?;
    Ok(())
}

/// Leest het Message-ID van een bericht in de geselecteerde mailbox.
fn fetch_message_id(session: &mut ImapSession, uid: u32) -> Result<Option<String>> {
    let fetches = session
        .uid_fetch(uid.to_string(), "(BODY.PEEK[HEADER])")
        .map_err(|e| anyhow::anyhow!(translate(&e)))?;
    let Some(fetch) = fetches.iter().next() else {
        return Ok(None);
    };
    let Some(bytes) = fetch.header() else {
        return Ok(None);
    };
    Ok(MessageParser::default()
        .parse(bytes)
        .and_then(|p| p.message_id().map(str::to_string)))
}

/// Selecteert `dest` en vindt het (net toegevoegde/verplaatste) bericht terug op
/// zijn Message-ID; valt best-effort terug op het hoogste UID.
fn relocate_by_message_id(
    session: &mut ImapSession,
    dest: &str,
    message_id: Option<&str>,
) -> Result<(u32, u32)> {
    let mb = session
        .select(dest)
        .map_err(|e| anyhow::anyhow!(translate(&e)))?;
    let uidvalidity = mb.uid_validity.unwrap_or(0);

    let by_mid = message_id.and_then(|mid| {
        let needle = mid.trim().trim_start_matches('<').trim_end_matches('>');
        let query = format!("HEADER MESSAGE-ID {}", imap_quote(needle));
        session
            .uid_search(&query)
            .ok()
            .and_then(|set| set.into_iter().max())
    });
    let uid = match by_mid {
        Some(u) => u,
        None => session
            .uid_search("ALL")
            .ok()
            .and_then(|set| set.into_iter().max())
            .ok_or_else(|| anyhow::anyhow!("Kon het bericht niet terugvinden in de doelmap."))?,
    };
    Ok((uidvalidity, uid))
}

/// Een minimaal `Message` (alleen id + is_read/is_draft) voor snooze/concept-flows.
fn minimal_message(id: String, is_draft: bool) -> Message {
    Message {
        odata_type: None,
        id,
        subject: None,
        from: None,
        to_recipients: None,
        cc_recipients: None,
        bcc_recipients: None,
        received_date_time: None,
        sent_date_time: None,
        is_read: Some(false),
        has_attachments: None,
        body_preview: None,
        importance: None,
        flag: None,
        body: None,
        web_link: None,
        is_draft: Some(is_draft),
        internet_message_headers: None,
        categories: None,
        conversation_id: None,
    }
}

/// Ontleedt een adres (met of zonder weergavenaam) naar een lettre-`Mailbox`.
fn parse_mailbox(addr: &str) -> Result<lettre::message::Mailbox> {
    addr.trim()
        .parse::<lettre::message::Mailbox>()
        .map_err(|_| anyhow::anyhow!("Ongeldig e-mailadres: {addr}"))
}

/// Bouwt een veilige (RFC2047-gecodeerde) headerwaarde; None bij een ongeldige naam.
fn raw_header(name: &str, value: &str) -> Option<lettre::message::header::HeaderValue> {
    use lettre::message::header::{HeaderName, HeaderValue};
    HeaderName::new_from_ascii(name.to_string())
        .ok()
        .map(|n| HeaderValue::new(n, value.to_string()))
}

/// Decodeert base64-bijlage-inhoud.
fn decode_b64(s: &str) -> Result<Vec<u8>> {
    base64::engine::general_purpose::STANDARD
        .decode(s.as_bytes())
        .context("Kon de bijlage-inhoud niet decoderen.")
}

/// Het MIME-type van een bijlage (fallback application/octet-stream).
fn content_type_of(a: &AttachmentInput) -> lettre::message::header::ContentType {
    use lettre::message::header::ContentType;
    a.content_type
        .as_deref()
        .and_then(|ct| ct.parse::<ContentType>().ok())
        .unwrap_or_else(|| {
            ContentType::parse("application/octet-stream").expect("geldig standaard-MIME-type")
        })
}

/// Bouwt een gewone bijlage (Content-Disposition: attachment).
fn attachment_part(a: &AttachmentInput) -> Result<lettre::message::SinglePart> {
    let bytes = decode_b64(&a.content_base64)?;
    Ok(lettre::message::Attachment::new(a.name.clone()).body(bytes, content_type_of(a)))
}

/// Bouwt een inline-bijlage (Content-ID + Content-Disposition: inline).
fn inline_part(a: &AttachmentInput) -> Result<lettre::message::SinglePart> {
    let bytes = decode_b64(&a.content_base64)?;
    let cid = a
        .content_id
        .clone()
        .unwrap_or_default()
        .trim_matches(|c| c == '<' || c == '>')
        .to_string();
    Ok(lettre::message::Attachment::new_inline(cid).body(bytes, content_type_of(a)))
}

/// Best-effort platte-tekst-variant van een HTML-body (voor multipart/alternative).
fn html_to_text(html: &str) -> String {
    let mut text = String::with_capacity(html.len());
    let mut chars = html.chars();
    while let Some(c) = chars.next() {
        if c == '<' {
            let mut tag = String::new();
            for tc in chars.by_ref() {
                if tc == '>' {
                    break;
                }
                tag.push(tc);
            }
            let t = tag.trim().trim_start_matches('/').to_ascii_lowercase();
            // Blok-elementen als regeleinde behandelen.
            if t.starts_with("br")
                || t.starts_with("/p")
                || t == "p"
                || t.starts_with("p ")
                || t.starts_with("div")
                || t.starts_with("tr")
                || t.starts_with("li")
                || t.starts_with("h1")
                || t.starts_with("h2")
                || t.starts_with("h3")
            {
                text.push('\n');
            }
        } else {
            text.push(c);
        }
    }
    let text = text
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");

    // Per regel witruimte samenvouwen en opeenvolgende lege regels reduceren.
    let mut out = String::new();
    let mut blank = false;
    for line in text.split('\n') {
        let collapsed = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if collapsed.is_empty() {
            if !blank {
                out.push('\n');
            }
            blank = true;
        } else {
            out.push_str(&collapsed);
            out.push('\n');
            blank = false;
        }
    }
    let trimmed = out.trim().to_string();
    if trimmed.is_empty() {
        " ".to_string()
    } else {
        trimmed
    }
}

/// Bouwt de asynchrone SMTP-transport (rustls, ring) uit de accountinstellingen.
fn build_smtp_transport(
    settings: &ImapSettings,
    password: &str,
) -> Result<lettre::AsyncSmtpTransport<lettre::Tokio1Executor>> {
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::{AsyncSmtpTransport, Tokio1Executor};

    let host = settings.smtp_host.trim();
    let builder = match settings.smtp_security {
        TlsMode::ImplicitTls => AsyncSmtpTransport::<Tokio1Executor>::relay(host),
        TlsMode::StartTls => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host),
    }
    .map_err(|e| anyhow::anyhow!("Kon de SMTP-verbinding niet voorbereiden: {e}"))?;

    let creds = Credentials::new(settings.smtp_username.clone(), password.to_string());
    Ok(builder
        .port(settings.smtp_port)
        .credentials(creds)
        .build::<Tokio1Executor>())
}

/// Vertaalt een lettre/SMTP-fout naar een leesbare Nederlandse melding.
fn smtp_error(e: &lettre::transport::smtp::Error) -> String {
    let detail = e.to_string();
    if detail.to_lowercase().contains("auth") {
        format!("De SMTP-server weigerde de aanmelding (controleer gebruikersnaam/wachtwoord of gebruik een app-wachtwoord). ({detail})")
    } else {
        format!("Kon de e-mail niet verzenden via SMTP: {detail}")
    }
}

/// Zoekt via `LIST "" "*"` de bijzondere mappen (Sent/Drafts/Junk/Trash/Archive):
/// eerst op RFC 6154 SPECIAL-USE-attributen, dan op een meertalige naam-heuristiek.
/// Slaat de ruwe wire-namen op als id's en legt het scheidingsteken vast.
fn resolve_special_folders(session: &mut ImapSession) -> Result<SpecialFolders> {
    let names = session
        .list(Some(""), Some("*"))
        .map_err(|e| anyhow::anyhow!(translate(&e)))?;

    let mut sf = SpecialFolders::default();
    let mut delimiter: Option<String> = None;

    // 1) SPECIAL-USE-attributen (\Sent, \Drafts, \Junk, \Trash, \Archive).
    for n in names.iter() {
        if delimiter.is_none() {
            if let Some(d) = n.delimiter() {
                delimiter = Some(d.to_string());
            }
        }
        let raw = n.name().to_string();
        for attr in n.attributes() {
            if let NameAttribute::Custom(c) = attr {
                let target = match c.as_ref() {
                    "\\Sent" => &mut sf.sent,
                    "\\Drafts" => &mut sf.drafts,
                    "\\Junk" => &mut sf.junk,
                    "\\Trash" => &mut sf.trash,
                    "\\Archive" => &mut sf.archive,
                    _ => continue,
                };
                if target.is_none() {
                    *target = Some(raw.clone());
                }
            }
        }
    }

    // 2) Naam-heuristiek (meertalig) voor wat nog ontbreekt.
    let delim = delimiter.clone().unwrap_or_else(|| "/".to_string());
    for n in names.iter() {
        let raw = n.name();
        let decoded = utf7_imap::decode_utf7_imap(raw.to_string());
        let leaf = decoded
            .rsplit(delim.as_str())
            .next()
            .unwrap_or(decoded.as_str());
        let lower = leaf.to_lowercase();
        if lower == "inbox" {
            continue;
        }
        if sf.sent.is_none() && contains_any(&lower, &["sent", "verzonden"]) {
            sf.sent = Some(raw.to_string());
        } else if sf.drafts.is_none() && contains_any(&lower, &["draft", "concept"]) {
            sf.drafts = Some(raw.to_string());
        } else if sf.trash.is_none() && contains_any(&lower, &["trash", "prullenbak", "deleted"]) {
            sf.trash = Some(raw.to_string());
        } else if sf.junk.is_none() && contains_any(&lower, &["junk", "spam", "ongewenst"]) {
            sf.junk = Some(raw.to_string());
        } else if sf.archive.is_none() && contains_any(&lower, &["archive", "archief"]) {
            sf.archive = Some(raw.to_string());
        }
    }

    sf.delimiter = Some(delim);
    Ok(sf)
}

fn contains_any(hay: &str, needles: &[&str]) -> bool {
    needles.iter().any(|n| hay.contains(n))
}

/// Verifieert een IMAP-login én SMTP-handshake voor de opgegeven instellingen en
/// levert de opgeloste bijzondere mappen. Gebruikt door `add_imap_account` en
/// `test_imap_connection` (die laatste negeert de mappen).
pub async fn verify_imap_settings(
    settings: ImapSettings,
    password: String,
) -> Result<SpecialFolders> {
    // IMAP: blokkerend verbinden, inloggen en de mappen opsommen/classificeren.
    let imap_settings = settings.clone();
    let imap_password = password.clone();
    let folders = tokio::task::spawn_blocking(move || -> Result<SpecialFolders> {
        let mut session = connect_session(&imap_settings, &imap_password)?;
        let sf = resolve_special_folders(&mut session);
        let _ = session.logout();
        sf
    })
    .await
    .map_err(|e| anyhow::anyhow!("Interne fout bij de IMAP-taak: {e}"))??;

    // SMTP: transport bouwen en een lichte handshake doen (NOOP).
    let transport = build_smtp_transport(&settings, &password)?;
    let ok = transport
        .test_connection()
        .await
        .map_err(|e| anyhow::anyhow!(smtp_error(&e)))?;
    if !ok {
        bail!("De SMTP-server accepteerde de testverbinding niet (controleer host/poort/beveiliging).");
    }
    Ok(folders)
}

// =====================================================================
// Tests
// =====================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imap_date_gebruikt_rfc3501_formaat() {
        assert_eq!(imap_date("2026-07-27").as_deref(), Some("27-Jul-2026"));
        assert_eq!(imap_date("2026-01-01").as_deref(), Some("1-Jan-2026"));
        assert_eq!(imap_date("2026-12-31").as_deref(), Some("31-Dec-2026"));
        // Onbruikbare invoer laat het criterium wegvallen i.p.v. te falen.
        assert_eq!(imap_date("rommel"), None);
        assert_eq!(imap_date(""), None);
    }

    #[test]
    fn next_day_maakt_einddatum_inclusief() {
        assert_eq!(next_day("2026-07-27").as_deref(), Some("2026-07-28"));
        // Maand- en jaargrens (2026 is geen schrikkeljaar).
        assert_eq!(next_day("2026-02-28").as_deref(), Some("2026-03-01"));
        assert_eq!(next_day("2026-12-31").as_deref(), Some("2027-01-01"));
        assert_eq!(next_day("geen datum"), None);
    }
}
