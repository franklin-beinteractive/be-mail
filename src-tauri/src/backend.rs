//! Backend-dispatch: kiest op basis van het accounttype (`StoredAccount::kind`)
//! tussen de Graph-client (Office 365) en de IMAP-client. De command-laag praat
//! alleen met `Backend`, zodat de commando's provider-onafhankelijk blijven.
//!
//! Het gedeelde mail-oppervlak (mappen, berichten, verzenden, ...) wordt naar de
//! juiste client doorgestuurd. Graph-only functies (regels, categorieen,
//! afwezigheid, rsvp, agenda, ...) bereik je via [`Backend::graph`], die voor een
//! IMAP-account een nette Nederlandse fout geeft.

use crate::caldav::CaldavClient;
use crate::config::{AccountKind, AppConfig, StoredAccount};
use crate::graph::GraphClient;
use crate::imap::ImapClient;
use crate::models::*;
use anyhow::Result;

pub enum Backend {
    Graph(GraphClient),
    // Geboxt: `ImapClient` is fors (persistente verbinding + buffers), waardoor de
    // enum anders onnodig groot wordt (clippy::large_enum_variant).
    Imap(Box<ImapClient>),
}

/// Agenda-dispatch: parallel aan [`Backend`], maar voor het agenda-oppervlak.
/// Office 365 gaat via Graph, IMAP-accounts via hun CalDAV-agenda. De
/// command-laag praat alleen met `Calendar`, net als met `Backend` bij mail.
pub enum Calendar {
    Graph(GraphClient),
    Caldav(CaldavClient),
}

impl Calendar {
    pub async fn list_events(&self, start_iso: &str, end_iso: &str) -> Result<Vec<Event>> {
        match self {
            Calendar::Graph(g) => g.list_events(start_iso, end_iso).await,
            Calendar::Caldav(c) => c.list_events(start_iso, end_iso).await,
        }
    }
    pub async fn create_event(&self, input: &EventInput) -> Result<Event> {
        match self {
            Calendar::Graph(g) => g.create_event(input).await,
            Calendar::Caldav(c) => c.create_event(input).await,
        }
    }
    pub async fn update_event(&self, id: &str, input: &EventInput) -> Result<Event> {
        match self {
            Calendar::Graph(g) => g.update_event(id, input).await,
            Calendar::Caldav(c) => c.update_event(id, input).await,
        }
    }
    pub async fn update_event_times(&self, id: &str, start: &str, end: &str) -> Result<()> {
        match self {
            Calendar::Graph(g) => g.update_event_times(id, start, end).await,
            Calendar::Caldav(c) => c.update_event_times(id, start, end).await,
        }
    }
    pub async fn search_people(&self, query: &str) -> Result<Vec<Person>> {
        match self {
            Calendar::Graph(g) => g.search_people(query).await,
            Calendar::Caldav(c) => c.search_people(query).await,
        }
    }
    pub async fn delete_event(&self, id: &str) -> Result<()> {
        match self {
            Calendar::Graph(g) => g.delete_event(id).await,
            Calendar::Caldav(c) => c.delete_event(id).await,
        }
    }
}

impl Backend {
    /// Bouwt de juiste backend voor een account. Graph verbindt/vernieuwt het
    /// token; IMAP wordt lui gebouwd (verbindt pas bij de eerste echte call).
    pub async fn for_account(cfg: &AppConfig, acc: &StoredAccount) -> std::result::Result<Self, String> {
        match acc.kind {
            AccountKind::Office365 => {
                let gc = GraphClient::new(cfg, &acc.id)
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(Backend::Graph(gc))
            }
            AccountKind::Imap => Ok(Backend::Imap(Box::new(ImapClient::for_account(acc)?))),
        }
    }

    /// Toegang tot de Graph-client voor Office-365-only functies. Voor een
    /// IMAP-account een leesbare fout i.p.v. een panic of stille no-op.
    pub fn graph(&self) -> std::result::Result<&GraphClient, String> {
        match self {
            Backend::Graph(g) => Ok(g),
            Backend::Imap(_) => Err("Deze functie werkt alleen met Office 365-accounts.".into()),
        }
    }

    // ---- Gedeeld mail-oppervlak (doorsturen naar de juiste client) ----

    pub async fn me(&self) -> Result<Account> {
        match self {
            Backend::Graph(g) => g.me().await,
            Backend::Imap(i) => i.me().await,
        }
    }
    pub async fn list_folders(&self) -> Result<Vec<MailFolder>> {
        match self {
            Backend::Graph(g) => g.list_folders().await,
            Backend::Imap(i) => i.list_folders().await,
        }
    }
    pub async fn move_folder(&self, id: &str, destination_id: &str) -> Result<()> {
        match self {
            Backend::Graph(g) => g.move_folder(id, destination_id).await,
            Backend::Imap(i) => i.move_folder(id, destination_id).await,
        }
    }
    pub async fn create_folder(&self, name: &str) -> Result<MailFolder> {
        match self {
            Backend::Graph(g) => g.create_folder(name).await,
            Backend::Imap(i) => i.create_folder(name).await,
        }
    }
    pub async fn rename_folder(&self, id: &str, name: &str) -> Result<()> {
        match self {
            Backend::Graph(g) => g.rename_folder(id, name).await,
            Backend::Imap(i) => i.rename_folder(id, name).await,
        }
    }
    pub async fn delete_folder(&self, id: &str) -> Result<()> {
        match self {
            Backend::Graph(g) => g.delete_folder(id).await,
            Backend::Imap(i) => i.delete_folder(id).await,
        }
    }
    pub async fn list_messages(
        &self,
        folder_id: &str,
        top: u32,
        skip: u32,
        ascending: bool,
        filter: Option<&str>,
    ) -> Result<MessagesPage> {
        match self {
            Backend::Graph(g) => g.list_messages(folder_id, top, skip, ascending, filter).await,
            Backend::Imap(i) => i.list_messages(folder_id, top, skip, ascending, filter).await,
        }
    }
    pub async fn sync_folder_to_cache(&self, account_id: &str, folder_id: &str) -> Result<()> {
        match self {
            Backend::Graph(g) => g.sync_folder_to_cache(account_id, folder_id).await,
            Backend::Imap(i) => i.sync_folder_to_cache(account_id, folder_id).await,
        }
    }
    pub async fn get_message(&self, id: &str) -> Result<Message> {
        match self {
            Backend::Graph(g) => g.get_message(id).await,
            Backend::Imap(i) => i.get_message(id).await,
        }
    }
    pub async fn search_messages(
        &self,
        query: &str,
        top: u32,
        folder_id: Option<&str>,
    ) -> Result<MessagesPage> {
        match self {
            Backend::Graph(g) => g.search_messages(query, top, folder_id).await,
            Backend::Imap(i) => i.search_messages(query, top, folder_id).await,
        }
    }
    pub async fn set_read(&self, id: &str, is_read: bool) -> Result<()> {
        match self {
            Backend::Graph(g) => g.set_read(id, is_read).await,
            Backend::Imap(i) => i.set_read(id, is_read).await,
        }
    }
    pub async fn set_flag(&self, id: &str, flagged: bool) -> Result<()> {
        match self {
            Backend::Graph(g) => g.set_flag(id, flagged).await,
            Backend::Imap(i) => i.set_flag(id, flagged).await,
        }
    }
    pub async fn delete_message(&self, id: &str) -> Result<()> {
        match self {
            Backend::Graph(g) => g.delete_message(id).await,
            Backend::Imap(i) => i.delete_message(id).await,
        }
    }
    pub async fn move_message(&self, id: &str, destination_id: &str) -> Result<()> {
        match self {
            Backend::Graph(g) => g.move_message(id, destination_id).await,
            Backend::Imap(i) => i.move_message(id, destination_id).await,
        }
    }
    pub async fn move_message_returning(&self, id: &str, destination_id: &str) -> Result<Message> {
        match self {
            Backend::Graph(g) => g.move_message_returning(id, destination_id).await,
            Backend::Imap(i) => i.move_message_returning(id, destination_id).await,
        }
    }
    pub async fn list_attachments(&self, message_id: &str) -> Result<Vec<Attachment>> {
        match self {
            Backend::Graph(g) => g.list_attachments(message_id).await,
            Backend::Imap(i) => i.list_attachments(message_id).await,
        }
    }
    pub async fn download_attachment(
        &self,
        message_id: &str,
        attachment_id: &str,
    ) -> Result<String> {
        match self {
            Backend::Graph(g) => g.download_attachment(message_id, attachment_id).await,
            Backend::Imap(i) => i.download_attachment(message_id, attachment_id).await,
        }
    }
    /// Uitgebreid zoeken met losse velden; elke backend vertaalt het zelf.
    pub async fn search_advanced(
        &self,
        query: &SearchQuery,
        top: u32,
        folder_id: Option<&str>,
    ) -> Result<MessagesPage> {
        match self {
            Backend::Graph(g) => g.search_advanced(query, top, folder_id).await,
            Backend::Imap(i) => i.search_advanced(query, top, folder_id).await,
        }
    }

    /// Het hele bericht als .eml naar Downloads; geeft het opgeslagen pad terug.
    pub async fn download_message(&self, message_id: &str) -> Result<String> {
        match self {
            Backend::Graph(g) => g.download_message(message_id).await,
            Backend::Imap(i) => i.download_message(message_id).await,
        }
    }
    pub async fn inline_images(&self, message_id: &str) -> Result<Vec<InlineImage>> {
        match self {
            Backend::Graph(g) => g.inline_images(message_id).await,
            Backend::Imap(i) => i.inline_images(message_id).await,
        }
    }
    pub async fn send_mail(&self, input: &ComposeInput) -> Result<()> {
        match self {
            Backend::Graph(g) => g.send_mail(input).await,
            Backend::Imap(i) => i.send_mail(input).await,
        }
    }
    pub async fn create_draft(&self, input: &ComposeInput) -> Result<Message> {
        match self {
            Backend::Graph(g) => g.create_draft(input).await,
            Backend::Imap(i) => i.create_draft(input).await,
        }
    }
    pub async fn update_draft(&self, id: &str, input: &ComposeInput) -> Result<()> {
        match self {
            Backend::Graph(g) => g.update_draft(id, input).await,
            Backend::Imap(i) => i.update_draft(id, input).await,
        }
    }
    pub async fn send_draft(
        &self,
        id: &str,
        input: &ComposeInput,
        defer_utc: Option<&str>,
    ) -> Result<()> {
        match self {
            Backend::Graph(g) => g.send_draft(id, input, defer_utc).await,
            Backend::Imap(i) => i.send_draft(id, input, defer_utc).await,
        }
    }
}
