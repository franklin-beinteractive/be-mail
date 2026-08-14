//! Offline cache: SQLite-bestand (cache.db) naast config.json.
//! Bewaart per account de mappen, berichtenlijsten en gelezen berichten
//! (mét body), plus delta-links per map voor Graph delta-sync.
//!
//! Model: cache-through. Elke geslaagde Graph-call ververst de cache; valt
//! het netwerk weg, dan wordt eruit geserveerd (alleen-lezen - acties zoals
//! verzenden of verplaatsen vereisen netwerk en falen dan gewoon).

use crate::config;
use crate::models::{MailFolder, Message};
use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use std::sync::{Mutex, OnceLock};

static DB: OnceLock<Mutex<Connection>> = OnceLock::new();

fn db() -> Result<&'static Mutex<Connection>> {
    if let Some(m) = DB.get() {
        return Ok(m);
    }
    let dir = config::data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let conn = Connection::open(dir.join("cache.db"))
        .context("Kon de offline cache niet openen")?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS folders (
           account_id TEXT NOT NULL,
           id         TEXT NOT NULL,
           json       TEXT NOT NULL,
           PRIMARY KEY (account_id, id)
         );
         CREATE TABLE IF NOT EXISTS messages (
           account_id TEXT NOT NULL,
           id         TEXT NOT NULL,
           folder_id  TEXT NOT NULL DEFAULT '',
           received   TEXT NOT NULL DEFAULT '',
           has_body   INTEGER NOT NULL DEFAULT 0,
           json       TEXT NOT NULL,
           PRIMARY KEY (account_id, id)
         );
         CREATE INDEX IF NOT EXISTS idx_messages_folder
           ON messages (account_id, folder_id, received DESC);
         CREATE TABLE IF NOT EXISTS sync_state (
           account_id TEXT NOT NULL,
           folder_id  TEXT NOT NULL,
           delta_link TEXT,
           synced_at  INTEGER NOT NULL DEFAULT 0,
           PRIMARY KEY (account_id, folder_id)
         );
         CREATE TABLE IF NOT EXISTS photos (
           account_id TEXT NOT NULL,
           address    TEXT NOT NULL,
           data_uri   TEXT NOT NULL,
           fetched_at INTEGER NOT NULL,
           PRIMARY KEY (account_id, address)
         );",
    )
    .context("Kon het cache-schema niet aanmaken")?;
    // Race bij gelijktijdige eerste aanroep: de verliezer gooit z'n conn weg.
    let _ = DB.set(Mutex::new(conn));
    Ok(DB.get().expect("cache-db is zojuist gezet"))
}

fn now_ts() -> i64 {
    chrono::Utc::now().timestamp()
}

// ---- Mappen ----

/// Vervangt de gecachte mappenlijst van een account.
pub fn save_folders(account_id: &str, folders: &[MailFolder]) -> Result<()> {
    let m = db()?;
    let mut conn = m.lock().unwrap();
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM folders WHERE account_id = ?1", params![account_id])?;
    for f in folders {
        tx.execute(
            "INSERT INTO folders (account_id, id, json) VALUES (?1, ?2, ?3)",
            params![account_id, f.id, serde_json::to_string(f)?],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn load_folders(account_id: &str) -> Result<Vec<MailFolder>> {
    let m = db()?;
    let conn = m.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT json FROM folders WHERE account_id = ?1 ORDER BY rowid",
    )?;
    let rows = stmt.query_map(params![account_id], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for row in rows {
        if let Ok(f) = serde_json::from_str::<MailFolder>(&row?) {
            out.push(f);
        }
    }
    Ok(out)
}

// ---- Berichten ----

/// Upsert van lijst-berichten (zonder body). Bij een bestaand bericht mét
/// body blijft de volledige json staan; alleen de plaats wordt bijgewerkt.
pub fn save_messages(account_id: &str, folder_id: &str, msgs: &[Message]) -> Result<()> {
    if msgs.is_empty() {
        return Ok(());
    }
    let m = db()?;
    let mut conn = m.lock().unwrap();
    let tx = conn.transaction()?;
    for msg in msgs {
        tx.execute(
            "INSERT INTO messages (account_id, id, folder_id, received, has_body, json)
             VALUES (?1, ?2, ?3, ?4, 0, ?5)
             ON CONFLICT (account_id, id) DO UPDATE SET
               folder_id = excluded.folder_id,
               received  = excluded.received,
               json      = CASE WHEN messages.has_body = 1 THEN messages.json ELSE excluded.json END",
            params![
                account_id,
                msg.id,
                folder_id,
                msg.received_date_time.clone().unwrap_or_default(),
                serde_json::to_string(msg)?
            ],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Volledig bericht (met body) opslaan; de map blijft wat hij was als we die
/// hier niet weten.
pub fn save_full_message(account_id: &str, msg: &Message) -> Result<()> {
    let m = db()?;
    let conn = m.lock().unwrap();
    conn.execute(
        "INSERT INTO messages (account_id, id, folder_id, received, has_body, json)
         VALUES (?1, ?2, '', ?3, 1, ?4)
         ON CONFLICT (account_id, id) DO UPDATE SET
           received = excluded.received,
           has_body = 1,
           json     = excluded.json",
        params![
            account_id,
            msg.id,
            msg.received_date_time.clone().unwrap_or_default(),
            serde_json::to_string(msg)?
        ],
    )?;
    Ok(())
}

/// Berichtenlijst uit de cache. Geeft ook terug of er nog meer is (voor
/// "meer laden"). Sortering en filter volgen de lijstweergave.
pub fn load_messages(
    account_id: &str,
    folder_id: &str,
    top: u32,
    skip: u32,
    ascending: bool,
    filter: Option<&str>, // "unread" | "flagged"
) -> Result<(Vec<Message>, bool)> {
    let m = db()?;
    let conn = m.lock().unwrap();
    let order = if ascending { "ASC" } else { "DESC" };
    let extra = match filter {
        Some("unread") => " AND json_extract(json, '$.isRead') = 0",
        Some("flagged") => " AND json_extract(json, '$.flag.flagStatus') = 'flagged'",
        _ => "",
    };
    let sql = format!(
        "SELECT json FROM messages
         WHERE account_id = ?1 AND folder_id = ?2{extra}
         ORDER BY received {order} LIMIT ?3 OFFSET ?4"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        params![account_id, folder_id, top + 1, skip],
        |r| r.get::<_, String>(0),
    )?;
    let mut out = Vec::new();
    for row in rows {
        if let Ok(msg) = serde_json::from_str::<Message>(&row?) {
            out.push(msg);
        }
    }
    let has_more = out.len() > top as usize;
    out.truncate(top as usize);
    Ok((out, has_more))
}

/// Volledig bericht (met body) uit de cache; None als alleen de lijstversie
/// bekend is.
pub fn load_message(account_id: &str, id: &str) -> Result<Option<Message>> {
    let m = db()?;
    let conn = m.lock().unwrap();
    let json: Option<String> = conn
        .query_row(
            "SELECT json FROM messages WHERE account_id = ?1 AND id = ?2 AND has_body = 1",
            params![account_id, id],
            |r| r.get(0),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;
    Ok(json.and_then(|j| serde_json::from_str(&j).ok()))
}

pub fn delete_message(account_id: &str, id: &str) -> Result<()> {
    let m = db()?;
    let conn = m.lock().unwrap();
    conn.execute(
        "DELETE FROM messages WHERE account_id = ?1 AND id = ?2",
        params![account_id, id],
    )?;
    Ok(())
}

/// Alles van een account weggooien (bij uitloggen).
pub fn clear_account(account_id: &str) -> Result<()> {
    let m = db()?;
    let conn = m.lock().unwrap();
    conn.execute("DELETE FROM folders WHERE account_id = ?1", params![account_id])?;
    conn.execute("DELETE FROM messages WHERE account_id = ?1", params![account_id])?;
    conn.execute("DELETE FROM sync_state WHERE account_id = ?1", params![account_id])?;
    conn.execute("DELETE FROM photos WHERE account_id = ?1", params![account_id])?;
    Ok(())
}

// ---- Profielfoto's (avatars) ----

/// How long a photo we found stays valid. People rarely change their picture,
/// so a week keeps the list snappy without freezing a new photo out for long.
const PHOTO_TTL: i64 = 7 * 24 * 3600;
/// How long "this address has no photo" stays valid. Shorter, because this is
/// also the answer when the tenant has not (yet) consented to the scope.
const NO_PHOTO_TTL: i64 = 24 * 3600;

/// A cached profile photo: `Some(Some(uri))` = photo found, `Some(None)` = known
/// to have no photo, `None` = never fetched or expired, so ask Graph again.
pub fn photo(account_id: &str, address: &str) -> Option<Option<String>> {
    let m = db().ok()?;
    let conn = m.lock().ok()?;
    let (uri, fetched_at): (String, i64) = conn
        .query_row(
            "SELECT data_uri, fetched_at FROM photos WHERE account_id = ?1 AND address = ?2",
            params![account_id, address],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok()?;
    let ttl = if uri.is_empty() { NO_PHOTO_TTL } else { PHOTO_TTL };
    if now_ts() - fetched_at > ttl {
        return None;
    }
    Some(Some(uri).filter(|u| !u.is_empty()))
}

/// Stores a photo, or the fact that there is none (`None`), for this address.
pub fn save_photo(account_id: &str, address: &str, data_uri: Option<&str>) -> Result<()> {
    let m = db()?;
    let conn = m.lock().unwrap();
    conn.execute(
        "INSERT INTO photos (account_id, address, data_uri, fetched_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (account_id, address) DO UPDATE SET
           data_uri   = excluded.data_uri,
           fetched_at = excluded.fetched_at",
        params![account_id, address, data_uri.unwrap_or(""), now_ts()],
    )?;
    Ok(())
}

// ---- Delta-sync-status ----

pub fn get_delta_link(account_id: &str, folder_id: &str) -> Result<Option<String>> {
    let m = db()?;
    let conn = m.lock().unwrap();
    let link: Option<Option<String>> = conn
        .query_row(
            "SELECT delta_link FROM sync_state WHERE account_id = ?1 AND folder_id = ?2",
            params![account_id, folder_id],
            |r| r.get(0),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;
    Ok(link.flatten())
}

pub fn set_delta_link(account_id: &str, folder_id: &str, link: &str) -> Result<()> {
    let m = db()?;
    let conn = m.lock().unwrap();
    conn.execute(
        "INSERT INTO sync_state (account_id, folder_id, delta_link, synced_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (account_id, folder_id) DO UPDATE SET
           delta_link = excluded.delta_link,
           synced_at  = excluded.synced_at",
        params![account_id, folder_id, link, now_ts()],
    )?;
    Ok(())
}

/// Is deze map toe aan een nieuwe delta-run? (throttle: 1x per minuut)
pub fn delta_due(account_id: &str, folder_id: &str) -> Result<bool> {
    let m = db()?;
    let conn = m.lock().unwrap();
    let synced_at: i64 = conn
        .query_row(
            "SELECT synced_at FROM sync_state WHERE account_id = ?1 AND folder_id = ?2",
            params![account_id, folder_id],
            |r| r.get(0),
        )
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(0),
            other => Err(other),
        })?;
    Ok(now_ts() - synced_at >= 60)
}
