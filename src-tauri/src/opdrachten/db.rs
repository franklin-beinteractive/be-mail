//! SQLite-opslag voor de opdrachten-module. Eigen bestand (`opdrachten.db`)
//! naast de weggooibare Graph-cache: opdrachten zijn primaire data.
//! Zelfde OnceLock-patroon als `cache.rs`.

use std::sync::{Mutex, MutexGuard, OnceLock};

use anyhow::Context;
use rusqlite::Connection;

use crate::opdrachten::error::AppResult;
use crate::opdrachten::models::{Aanvraag, Instellingen, LogboekRegel, Ronde, Status};

static DB: OnceLock<Mutex<Connection>> = OnceLock::new();

/// Migraties op volgorde; `PRAGMA user_version` houdt bij welke al draaiden.
/// Migratie 1 is het Milky-schema — een bestaande `milky.db` kan dus als
/// `opdrachten.db` neergezet worden en upgradet automatisch verder.
const MIGRATIES: &[&str] = &[
    // v1: basis-schema (identiek aan Milky v1)
    r#"
    CREATE TABLE aanvraag (
        id                INTEGER PRIMARY KEY,
        klant_naam        TEXT NOT NULL,
        klant_bedrijf     TEXT,
        klant_telefoon    TEXT,
        klant_email       TEXT,
        kanaal            TEXT CHECK (kanaal IN ('telefoon','email') OR kanaal IS NULL),
        omschrijving      TEXT,
        status            TEXT NOT NULL CHECK (status IN (
                              'binnengekomen','tijd_inschatten','bij_planning',
                              'klant_informeren','ingepland','in_uitvoering',
                              'feedback_controle','afgerond','geannuleerd')),
        huidige_ronde     INTEGER NOT NULL DEFAULT 1,
        datum_binnen      TEXT NOT NULL,
        aangemaakt_op     TEXT NOT NULL,
        bijgewerkt_op     TEXT NOT NULL,
        gearchiveerd      INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE ronde (
        id                INTEGER PRIMARY KEY,
        aanvraag_id       INTEGER NOT NULL REFERENCES aanvraag(id) ON DELETE CASCADE,
        rondenummer       INTEGER NOT NULL,
        geschatte_uren    REAL,
        datum_naar_planning      TEXT,
        datum_planning_antwoord  TEXT,
        ingeplande_datum         TEXT,
        datum_klant_geinformeerd TEXT,
        datum_uitvoering_start   TEXT,
        uitvoerder        TEXT,
        feedback_tekst    TEXT,
        afgerond_op       TEXT,
        UNIQUE (aanvraag_id, rondenummer)
    );

    CREATE TABLE logboek (
        id                INTEGER PRIMARY KEY,
        aanvraag_id       INTEGER NOT NULL REFERENCES aanvraag(id) ON DELETE CASCADE,
        rondenummer       INTEGER,
        tijdstip          TEXT NOT NULL,
        type              TEXT NOT NULL,
        tekst             TEXT NOT NULL
    );

    CREATE TABLE instelling (
        sleutel           TEXT PRIMARY KEY,
        waarde            TEXT NOT NULL
    );

    CREATE INDEX idx_aanvraag_status ON aanvraag(status, gearchiveerd);
    CREATE INDEX idx_ronde_aanvraag  ON ronde(aanvraag_id);
    CREATE INDEX idx_logboek_aanvraag ON logboek(aanvraag_id, tijdstip);
    "#,
    // v2: werkelijke uren per ronde (statistiek geschat vs. werkelijk)
    "ALTER TABLE ronde ADD COLUMN werkelijke_uren REAL;",
    // v3: planner per ronde (wie de opdracht inplant; naam, vrij tekstveld)
    "ALTER TABLE ronde ADD COLUMN planner TEXT;",
];

/// Opent (of maakt) de database; aanroepen in setup() vóór de poller start.
pub fn init() -> anyhow::Result<()> {
    let dir = crate::config::data_dir()?;
    std::fs::create_dir_all(&dir).context("Kon de datamap niet aanmaken")?;
    let naam = if cfg!(debug_assertions) { "opdrachten-dev.db" } else { "opdrachten.db" };
    let conn = Connection::open(dir.join(naam)).context("Kon opdrachten.db niet openen")?;
    init_conn(&conn).context("Kon het opdrachten-schema niet migreren")?;
    let _ = DB.set(Mutex::new(conn));
    Ok(())
}

pub fn conn() -> MutexGuard<'static, Connection> {
    DB.get()
        .expect("opdrachten-db niet geïnitialiseerd (init() hoort in setup)")
        .lock()
        .unwrap()
}

pub(crate) fn init_conn(conn: &Connection) -> AppResult<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    let huidige: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, script) in MIGRATIES.iter().enumerate() {
        let versie = (i + 1) as i64;
        if versie > huidige {
            conn.execute_batch(&format!(
                "BEGIN; {script}; PRAGMA user_version = {versie}; COMMIT;"
            ))?;
        }
    }
    Ok(())
}

// ── Rij-mappers ────────────────────────────────────────────────────

pub fn map_aanvraag(row: &rusqlite::Row) -> rusqlite::Result<Aanvraag> {
    let status_str: String = row.get("status")?;
    Ok(Aanvraag {
        id: row.get("id")?,
        klant_naam: row.get("klant_naam")?,
        klant_bedrijf: row.get("klant_bedrijf")?,
        klant_telefoon: row.get("klant_telefoon")?,
        klant_email: row.get("klant_email")?,
        kanaal: row.get("kanaal")?,
        omschrijving: row.get("omschrijving")?,
        status: Status::uit_str(&status_str).unwrap_or(Status::Binnengekomen),
        huidige_ronde: row.get("huidige_ronde")?,
        datum_binnen: row.get("datum_binnen")?,
        aangemaakt_op: row.get("aangemaakt_op")?,
        bijgewerkt_op: row.get("bijgewerkt_op")?,
        gearchiveerd: row.get::<_, i64>("gearchiveerd")? != 0,
    })
}

pub fn map_ronde(row: &rusqlite::Row) -> rusqlite::Result<Ronde> {
    Ok(Ronde {
        id: row.get("id")?,
        aanvraag_id: row.get("aanvraag_id")?,
        rondenummer: row.get("rondenummer")?,
        geschatte_uren: row.get("geschatte_uren")?,
        datum_naar_planning: row.get("datum_naar_planning")?,
        datum_planning_antwoord: row.get("datum_planning_antwoord")?,
        ingeplande_datum: row.get("ingeplande_datum")?,
        datum_klant_geinformeerd: row.get("datum_klant_geinformeerd")?,
        datum_uitvoering_start: row.get("datum_uitvoering_start")?,
        uitvoerder: row.get("uitvoerder")?,
        planner: row.get("planner")?,
        feedback_tekst: row.get("feedback_tekst")?,
        afgerond_op: row.get("afgerond_op")?,
        werkelijke_uren: row.get("werkelijke_uren")?,
    })
}

pub fn map_logboek(row: &rusqlite::Row) -> rusqlite::Result<LogboekRegel> {
    Ok(LogboekRegel {
        id: row.get("id")?,
        aanvraag_id: row.get("aanvraag_id")?,
        rondenummer: row.get("rondenummer")?,
        tijdstip: row.get("tijdstip")?,
        r#type: row.get("type")?,
        tekst: row.get("tekst")?,
    })
}

// ── Instellingen ───────────────────────────────────────────────────

pub fn lees_instellingen(conn: &Connection) -> AppResult<Instellingen> {
    let mut inst = Instellingen::default();
    let mut stmt = conn.prepare("SELECT sleutel, waarde FROM instelling")?;
    let rijen = stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })?;
    for rij in rijen {
        let (sleutel, waarde) = rij?;
        match sleutel.as_str() {
            "werkdagen_planning_herinnering" => {
                if let Ok(v) = waarde.parse() {
                    inst.werkdagen_planning_herinnering = v;
                }
            }
            "werkdagen_klant_informeren_herhaal" => {
                if let Ok(v) = waarde.parse() {
                    inst.werkdagen_klant_informeren_herhaal = v;
                }
            }
            "dagen_heropenbaar" => {
                if let Ok(v) = waarde.parse() {
                    inst.dagen_heropenbaar = v;
                }
            }
            "werkdagen_op_schema_check" => {
                if let Ok(v) = waarde.parse() {
                    inst.werkdagen_op_schema_check = v;
                }
            }
            _ => {}
        }
    }
    Ok(inst)
}

pub fn schrijf_instelling(conn: &Connection, sleutel: &str, waarde: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO instelling (sleutel, waarde) VALUES (?1, ?2)
         ON CONFLICT(sleutel) DO UPDATE SET waarde = excluded.waarde",
        (sleutel, waarde),
    )?;
    Ok(())
}
