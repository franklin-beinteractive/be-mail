//! Tauri-commands van de opdrachten-module. Dun: delegeert naar `_impl`-functies
//! die een `&Connection` + geïnjecteerde klok krijgen (unit-testbaar, zoals de
//! rest van de module). Fouten gaan als nette NL-string naar de UI (be-mail-idioom).
//!
//! BELANGRIJK: deze module verstuurt NOOIT e-mail en roept nergens
//! `send_message`/`send_draft`/Graph-sendMail aan. Mailteksten worden alleen
//! klaargezet om handmatig te kopiëren.

use chrono::{DateTime, Local, NaiveDate, SecondsFormat, Utc};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::opdrachten::db;
use crate::opdrachten::domein::{acties, statistiek, status};
use crate::opdrachten::error::{AppError, AppResult};
use crate::opdrachten::models::{
    Aanvraag, AanvraagUpdate, ActieKaart, Actielijst, HeropenbareKaart, Instellingen,
    KaartDetail, LogboekRegel, Ronde, RondeUpdate, Status, StatusPayload, WachtKaart,
};

/// Het enige punt waar de klok wordt afgelezen.
fn klok() -> (String, NaiveDate) {
    let nu = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let vandaag = Local::now().date_naive();
    (nu, vandaag)
}

fn utc_naar_lokale_datum(rfc3339: &str) -> Option<NaiveDate> {
    DateTime::parse_from_rfc3339(rfc3339)
        .ok()
        .map(|dt| dt.with_timezone(&Local).date_naive())
}

fn parse_lokale_datum(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

// ── Interne helpers ────────────────────────────────────────────────

fn log(
    conn: &Connection,
    aanvraag_id: i64,
    rondenummer: Option<i64>,
    soort: &str,
    tekst: &str,
    nu: &str,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO logboek (aanvraag_id, rondenummer, tijdstip, type, tekst)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        (aanvraag_id, rondenummer, nu, soort, tekst),
    )?;
    Ok(())
}

fn raak_aan(conn: &Connection, aanvraag_id: i64, nu: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE aanvraag SET bijgewerkt_op = ?1 WHERE id = ?2",
        (nu, aanvraag_id),
    )?;
    Ok(())
}

fn haal_aanvraag(conn: &Connection, id: i64) -> AppResult<Aanvraag> {
    conn.query_row("SELECT * FROM aanvraag WHERE id = ?1", [id], db::map_aanvraag)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NietGevonden(id),
            e => e.into(),
        })
}

fn haal_huidige_ronde(conn: &Connection, aanvraag: &Aanvraag) -> AppResult<Ronde> {
    Ok(conn.query_row(
        "SELECT * FROM ronde WHERE aanvraag_id = ?1 AND rondenummer = ?2",
        (aanvraag.id, aanvraag.huidige_ronde),
        db::map_ronde,
    )?)
}

fn haal_detail(conn: &Connection, id: i64) -> AppResult<KaartDetail> {
    let aanvraag = haal_aanvraag(conn, id)?;
    let mut stmt =
        conn.prepare("SELECT * FROM ronde WHERE aanvraag_id = ?1 ORDER BY rondenummer")?;
    let rondes = stmt
        .query_map([id], db::map_ronde)?
        .collect::<Result<Vec<_>, _>>()?;
    let mut stmt = conn
        .prepare("SELECT * FROM logboek WHERE aanvraag_id = ?1 ORDER BY tijdstip DESC, id DESC")?;
    let logboek = stmt
        .query_map([id], db::map_logboek)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(KaartDetail {
        aanvraag,
        rondes,
        logboek,
    })
}

fn zet_status(conn: &Connection, aanvraag_id: i64, naar: Status, nu: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE aanvraag SET status = ?1, bijgewerkt_op = ?2 WHERE id = ?3",
        (naar.als_str(), nu, aanvraag_id),
    )?;
    Ok(())
}

fn nieuwe_ronde(conn: &Connection, aanvraag_id: i64, rondenummer: i64) -> AppResult<()> {
    conn.execute(
        "INSERT INTO ronde (aanvraag_id, rondenummer) VALUES (?1, ?2)",
        (aanvraag_id, rondenummer),
    )?;
    conn.execute(
        "UPDATE aanvraag SET huidige_ronde = ?1 WHERE id = ?2",
        (rondenummer, aanvraag_id),
    )?;
    Ok(())
}

// ── Kernoperaties ──────────────────────────────────────────────────

fn maak_kaart_impl(
    conn: &Connection,
    klant_naam: &str,
    klant_email: Option<&str>,
    kanaal: Option<&str>,
    omschrijving: &str,
    logtekst: &str,
    nu: &str,
    vandaag: NaiveDate,
) -> AppResult<KaartDetail> {
    let naam = klant_naam.trim();
    if naam.is_empty() {
        return Err(AppError::Validatie("Klantnaam is verplicht".into()));
    }
    conn.execute(
        "INSERT INTO aanvraag (klant_naam, klant_email, kanaal, omschrijving, status,
                               huidige_ronde, datum_binnen, aangemaakt_op, bijgewerkt_op)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?7)",
        (
            naam,
            klant_email.map(str::trim).filter(|s| !s.is_empty()),
            kanaal,
            omschrijving.trim(),
            Status::Binnengekomen.als_str(),
            vandaag.to_string(),
            nu,
        ),
    )?;
    let id = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO ronde (aanvraag_id, rondenummer) VALUES (?1, 1)",
        [id],
    )?;
    log(conn, id, Some(1), "status_wijziging", logtekst, nu)?;
    haal_detail(conn, id)
}

fn wijzig_status_impl(
    conn: &Connection,
    aanvraag_id: i64,
    doel: Status,
    payload: &StatusPayload,
    inst: &Instellingen,
    nu: &str,
    vandaag: NaiveDate,
) -> AppResult<KaartDetail> {
    let aanvraag = haal_aanvraag(conn, aanvraag_id)?;
    let van = aanvraag.status;
    status::valideer_overgang(van, doel, payload)?;

    let ronde = haal_huidige_ronde(conn, &aanvraag)?;
    let rnr = ronde.rondenummer;
    use Status::*;
    match (van, doel) {
        (TijdInschatten, BijPlanning) => {
            conn.execute(
                "UPDATE ronde SET datum_naar_planning = ?1 WHERE id = ?2",
                (vandaag.to_string(), ronde.id),
            )?;
            let uren = ronde
                .geschatte_uren
                .map(|u| format!(" (geschat: {u} uur)"))
                .unwrap_or_default();
            log(conn, aanvraag_id, Some(rnr), "status_wijziging",
                &format!("Naar planning gestuurd{uren}"), nu)?;
        }
        (BijPlanning, KlantInformeren) => {
            let datum = payload.ingeplande_datum.as_deref().unwrap().trim();
            conn.execute(
                "UPDATE ronde SET ingeplande_datum = ?1, datum_planning_antwoord = ?2 WHERE id = ?3",
                (datum, vandaag.to_string(), ronde.id),
            )?;
            log(conn, aanvraag_id, Some(rnr), "status_wijziging",
                &format!("Planning heeft de opdracht ingepland op {datum} — klant informeren!"), nu)?;
        }
        (KlantInformeren, Ingepland) => {
            conn.execute(
                "UPDATE ronde SET datum_klant_geinformeerd = ?1 WHERE id = ?2",
                (vandaag.to_string(), ronde.id),
            )?;
            let datum = ronde.ingeplande_datum.as_deref().unwrap_or("?").to_string();
            log(conn, aanvraag_id, Some(rnr), "status_wijziging",
                &format!("Klant geïnformeerd over de ingeplande datum ({datum})"), nu)?;
        }
        (Ingepland, InUitvoering) => {
            conn.execute(
                "UPDATE ronde SET datum_uitvoering_start = ?1 WHERE id = ?2",
                (vandaag.to_string(), ronde.id),
            )?;
            log(conn, aanvraag_id, Some(rnr), "status_wijziging", "Uitvoering gestart", nu)?;
        }
        (InUitvoering, FeedbackControle) => {
            log(conn, aanvraag_id, Some(rnr), "status_wijziging",
                "Uitvoering klaar — controleren of de klant tevreden is", nu)?;
        }
        (FeedbackControle, Afgerond) => {
            conn.execute(
                "UPDATE ronde SET afgerond_op = ?1 WHERE id = ?2",
                (nu, ronde.id),
            )?;
            log(conn, aanvraag_id, Some(rnr), "status_wijziging",
                "Klant akkoord — aanvraag afgerond", nu)?;
        }
        (FeedbackControle, TijdInschatten) => {
            let feedback = payload.feedback_tekst.as_deref().unwrap().trim();
            conn.execute(
                "UPDATE ronde SET feedback_tekst = ?1 WHERE id = ?2",
                (feedback, ronde.id),
            )?;
            nieuwe_ronde(conn, aanvraag_id, rnr + 1)?;
            log(conn, aanvraag_id, Some(rnr), "status_wijziging",
                &format!("Feedback van klant: \"{feedback}\" — ronde {} gestart", rnr + 1), nu)?;
        }
        (Afgerond, TijdInschatten) => {
            let afgerond_op = ronde
                .afgerond_op
                .as_deref()
                .and_then(utc_naar_lokale_datum);
            let binnen_periode = afgerond_op
                .map(|d| (vandaag - d).num_days() <= inst.dagen_heropenbaar)
                .unwrap_or(false);
            if aanvraag.gearchiveerd || !binnen_periode {
                return Err(AppError::Validatie(
                    "Deze kaart is definitief gearchiveerd en kan niet meer heropend worden"
                        .into(),
                ));
            }
            if let Some(feedback) = payload
                .feedback_tekst
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                conn.execute(
                    "UPDATE ronde SET feedback_tekst = ?1 WHERE id = ?2",
                    (feedback, ronde.id),
                )?;
            }
            nieuwe_ronde(conn, aanvraag_id, rnr + 1)?;
            log(conn, aanvraag_id, Some(rnr), "status_wijziging",
                &format!("Heropend na late feedback — ronde {} gestart", rnr + 1), nu)?;
        }
        (_, Geannuleerd) => {
            let reden = payload.reden.as_deref().unwrap().trim();
            log(conn, aanvraag_id, Some(rnr), "status_wijziging",
                &format!("Geannuleerd: {reden}"), nu)?;
        }
        (Binnengekomen, TijdInschatten) => {
            log(conn, aanvraag_id, Some(rnr), "status_wijziging",
                "In behandeling genomen — tijd inschatten", nu)?;
        }
        _ => unreachable!("valideer_overgang liet een onbekende overgang door"),
    }

    zet_status(conn, aanvraag_id, doel, nu)?;
    haal_detail(conn, aanvraag_id)
}

/// Misklik-correctie: één stap terug; wist de datums die de heenstap zette.
fn stap_terug_impl(conn: &Connection, aanvraag_id: i64, nu: &str) -> AppResult<KaartDetail> {
    let aanvraag = haal_aanvraag(conn, aanvraag_id)?;
    let van = aanvraag.status;
    let naar = status::vorige_status(van).ok_or_else(|| {
        AppError::Validatie(format!("Vanuit '{}' is er geen stap terug", van.naam()))
    })?;
    let ronde = haal_huidige_ronde(conn, &aanvraag)?;

    use Status::*;
    let wis: &[&str] = match van {
        BijPlanning => &["datum_naar_planning"],
        KlantInformeren => &["datum_planning_antwoord", "ingeplande_datum"],
        Ingepland => &["datum_klant_geinformeerd"],
        InUitvoering => &["datum_uitvoering_start"],
        Afgerond => &["afgerond_op"],
        _ => &[],
    };
    for kolom in wis {
        conn.execute(
            &format!("UPDATE ronde SET {kolom} = NULL WHERE id = ?1"),
            [ronde.id],
        )?;
    }
    zet_status(conn, aanvraag_id, naar, nu)?;
    log(conn, aanvraag_id, Some(ronde.rondenummer), "status_wijziging",
        &format!("Teruggezet naar '{}' (gecorrigeerd)", naar.naam()), nu)?;
    haal_detail(conn, aanvraag_id)
}

/// Idempotent: archiveert afgeronde kaarten waarvan de heropen-periode voorbij is.
pub(crate) fn archiveer_verlopen_impl(
    conn: &Connection,
    inst: &Instellingen,
    nu: &str,
    vandaag: NaiveDate,
) -> AppResult<u32> {
    let mut stmt = conn.prepare(
        "SELECT a.id, r.afgerond_op FROM aanvraag a
         JOIN ronde r ON r.aanvraag_id = a.id AND r.rondenummer = a.huidige_ronde
         WHERE a.status = 'afgerond' AND a.gearchiveerd = 0",
    )?;
    let kandidaten = stmt
        .query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut aantal = 0;
    for (id, afgerond_op) in kandidaten {
        let verlopen = afgerond_op
            .as_deref()
            .and_then(utc_naar_lokale_datum)
            .map(|d| (vandaag - d).num_days() > inst.dagen_heropenbaar)
            .unwrap_or(false);
        if verlopen {
            conn.execute("UPDATE aanvraag SET gearchiveerd = 1 WHERE id = ?1", [id])?;
            log(conn, id, None, "status_wijziging",
                &format!("Automatisch gearchiveerd ({} dagen na afronding)", inst.dagen_heropenbaar),
                nu)?;
            aantal += 1;
        }
    }
    Ok(aantal)
}

pub(crate) fn actielijst_impl(
    conn: &Connection,
    inst: &Instellingen,
    vandaag: NaiveDate,
) -> AppResult<Actielijst> {
    let mut stmt = conn.prepare(
        "SELECT * FROM aanvraag WHERE gearchiveerd = 0 AND status != 'geannuleerd'",
    )?;
    let aanvragen = stmt
        .query_map([], db::map_aanvraag)?
        .collect::<Result<Vec<_>, _>>()?;

    let mut acties = Vec::new();
    let mut heropenbaar = Vec::new();
    for aanvraag in aanvragen {
        let ronde = haal_huidige_ronde(conn, &aanvraag)?;
        let afgerond_datum = ronde
            .afgerond_op
            .as_deref()
            .and_then(utc_naar_lokale_datum);
        match acties::bepaal_plek(aanvraag.status, &ronde, afgerond_datum, inst, vandaag) {
            acties::Plek::Actie {
                soort,
                label,
                urgentieklasse,
                dagen_over_drempel,
                werkdagen_wachtend,
            } => acties.push((
                dagen_over_drempel,
                ActieKaart {
                    actie_soort: soort.into(),
                    actie_label: label,
                    urgentieklasse,
                    werkdagen_wachtend,
                    aanvraag,
                    ronde,
                },
            )),
            acties::Plek::Heropenbaar { dagen_resterend } => heropenbaar.push(HeropenbareKaart {
                aanvraag,
                dagen_resterend,
            }),
            _ => {}
        }
    }
    acties.sort_by(|(da, a), (db_, b)| {
        acties::sorteersleutel(a.urgentieklasse, *da, &a.aanvraag.datum_binnen)
            .cmp(&acties::sorteersleutel(b.urgentieklasse, *db_, &b.aanvraag.datum_binnen))
    });
    heropenbaar.sort_by_key(|k| k.dagen_resterend);
    Ok(Actielijst {
        acties: acties.into_iter().map(|(_, a)| a).collect(),
        heropenbaar,
    })
}

fn wachtkamer_impl(
    conn: &Connection,
    inst: &Instellingen,
    vandaag: NaiveDate,
) -> AppResult<Vec<WachtKaart>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM aanvraag WHERE gearchiveerd = 0 AND status != 'geannuleerd'",
    )?;
    let aanvragen = stmt
        .query_map([], db::map_aanvraag)?
        .collect::<Result<Vec<_>, _>>()?;

    let mut wacht = Vec::new();
    for aanvraag in aanvragen {
        let ronde = haal_huidige_ronde(conn, &aanvraag)?;
        if let acties::Plek::Wachtkamer {
            wacht_op,
            label,
            sinds,
            werkdagen,
        } = acties::bepaal_plek(aanvraag.status, &ronde, None, inst, vandaag)
        {
            wacht.push(WachtKaart {
                wacht_op: wacht_op.into(),
                wacht_label: label,
                sinds: sinds.map(|d| d.to_string()),
                werkdagen,
                aanvraag,
                ronde,
            });
        }
    }
    wacht.sort_by(|a, b| b.werkdagen.cmp(&a.werkdagen));
    Ok(wacht)
}

fn statistiek_impl(conn: &Connection, vandaag: NaiveDate) -> AppResult<statistiek::Statistiek> {
    let mut stmt = conn.prepare("SELECT * FROM aanvraag")?;
    let aanvragen = stmt
        .query_map([], db::map_aanvraag)?
        .collect::<Result<Vec<_>, _>>()?;
    let mut kaarten = Vec::with_capacity(aanvragen.len());
    for aanvraag in aanvragen {
        let mut stmt =
            conn.prepare("SELECT * FROM ronde WHERE aanvraag_id = ?1 ORDER BY rondenummer")?;
        let rondes = stmt
            .query_map([aanvraag.id], db::map_ronde)?
            .collect::<Result<Vec<_>, _>>()?;
        kaarten.push(statistiek::KaartInvoer {
            klant_naam: aanvraag.klant_naam.clone(),
            omschrijving: aanvraag.omschrijving.clone(),
            status: aanvraag.status,
            datum_binnen: parse_lokale_datum(&aanvraag.datum_binnen),
            rondes: rondes
                .iter()
                .map(|r| statistiek::RondeInvoer {
                    datum_naar_planning: r.datum_naar_planning.as_deref().and_then(parse_lokale_datum),
                    datum_planning_antwoord: r
                        .datum_planning_antwoord
                        .as_deref()
                        .and_then(parse_lokale_datum),
                    geschatte_uren: r.geschatte_uren,
                    werkelijke_uren: r.werkelijke_uren,
                })
                .collect(),
        });
    }
    Ok(statistiek::bereken(&kaarten, vandaag))
}

// ── Tauri-commands (dunne wrappers; fouten als NL-string, be-mail-idioom) ──

#[tauri::command]
pub fn snel_vastleggen(klant_naam: String, omschrijving: String) -> Result<KaartDetail, String> {
    let conn = db::conn();
    let (nu, vandaag) = klok();
    maak_kaart_impl(&conn, &klant_naam, None, None, &omschrijving,
        "Aanvraag binnengekomen", &nu, vandaag)
    .map_err(|e| e.to_string())
}

/// Kaart aanmaken vanuit een geopende e-mail (leesvenster).
/// Leest alleen; verstuurt niets.
#[tauri::command]
pub fn opdracht_van_mail(
    klant_naam: String,
    klant_email: String,
    omschrijving: String,
) -> Result<KaartDetail, String> {
    let conn = db::conn();
    let (nu, vandaag) = klok();
    let logtekst = format!("Aanvraag binnengekomen via e-mail: \"{}\"", omschrijving.trim());
    maak_kaart_impl(&conn, &klant_naam, Some(&klant_email), Some("email"),
        &omschrijving, &logtekst, &nu, vandaag)
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_aanvraag(id: i64, velden: AanvraagUpdate) -> Result<KaartDetail, String> {
    let conn = db::conn();
    let (nu, _) = klok();
    update_aanvraag_impl(&conn, id, &velden, &nu).map_err(|e| e.to_string())
}

fn update_aanvraag_impl(
    conn: &Connection,
    id: i64,
    velden: &AanvraagUpdate,
    nu: &str,
) -> AppResult<KaartDetail> {
    haal_aanvraag(conn, id)?;
    if let Some(naam) = &velden.klant_naam {
        if naam.trim().is_empty() {
            return Err(AppError::Validatie("Klantnaam mag niet leeg zijn".into()));
        }
        conn.execute("UPDATE aanvraag SET klant_naam = ?1 WHERE id = ?2", (naam.trim(), id))?;
    }
    if let Some(v) = &velden.klant_bedrijf {
        conn.execute("UPDATE aanvraag SET klant_bedrijf = ?1 WHERE id = ?2", (v, id))?;
    }
    if let Some(v) = &velden.klant_telefoon {
        conn.execute("UPDATE aanvraag SET klant_telefoon = ?1 WHERE id = ?2", (v, id))?;
    }
    if let Some(v) = &velden.klant_email {
        conn.execute("UPDATE aanvraag SET klant_email = ?1 WHERE id = ?2", (v, id))?;
    }
    if let Some(v) = &velden.kanaal {
        if !matches!(v.as_str(), "telefoon" | "email") {
            return Err(AppError::Validatie("Kanaal moet 'telefoon' of 'email' zijn".into()));
        }
        conn.execute("UPDATE aanvraag SET kanaal = ?1 WHERE id = ?2", (v, id))?;
    }
    if let Some(v) = &velden.omschrijving {
        conn.execute("UPDATE aanvraag SET omschrijving = ?1 WHERE id = ?2", (v, id))?;
    }
    raak_aan(conn, id, nu)?;
    haal_detail(conn, id)
}

#[tauri::command]
pub fn update_ronde(aanvraag_id: i64, velden: RondeUpdate) -> Result<KaartDetail, String> {
    let conn = db::conn();
    let (nu, _) = klok();
    (|| -> AppResult<KaartDetail> {
        let aanvraag = haal_aanvraag(&conn, aanvraag_id)?;
        let ronde = haal_huidige_ronde(&conn, &aanvraag)?;
        if let Some(uren) = velden.geschatte_uren {
            conn.execute("UPDATE ronde SET geschatte_uren = ?1 WHERE id = ?2", (uren, ronde.id))?;
        }
        if let Some(uitvoerder) = &velden.uitvoerder {
            conn.execute("UPDATE ronde SET uitvoerder = ?1 WHERE id = ?2", (uitvoerder, ronde.id))?;
        }
        if let Some(planner) = &velden.planner {
            conn.execute("UPDATE ronde SET planner = ?1 WHERE id = ?2", (planner, ronde.id))?;
        }
        if let Some(uren) = velden.werkelijke_uren {
            conn.execute("UPDATE ronde SET werkelijke_uren = ?1 WHERE id = ?2", (uren, ronde.id))?;
        }
        raak_aan(&conn, aanvraag_id, &nu)?;
        haal_detail(&conn, aanvraag_id)
    })()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn wijzig_status(
    aanvraag_id: i64,
    doel: Status,
    payload: Option<StatusPayload>,
) -> Result<KaartDetail, String> {
    let conn = db::conn();
    let (nu, vandaag) = klok();
    let inst = db::lees_instellingen(&conn).map_err(|e| e.to_string())?;
    wijzig_status_impl(&conn, aanvraag_id, doel, &payload.unwrap_or_default(), &inst, &nu, vandaag)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stap_terug(aanvraag_id: i64) -> Result<KaartDetail, String> {
    let conn = db::conn();
    let (nu, _) = klok();
    stap_terug_impl(&conn, aanvraag_id, &nu).map_err(|e| e.to_string())
}

/// Teller resetten nadat de gebruiker planning herinnerd heeft.
#[tauri::command]
pub fn planning_herinnerd(aanvraag_id: i64) -> Result<KaartDetail, String> {
    let conn = db::conn();
    let (nu, vandaag) = klok();
    (|| -> AppResult<KaartDetail> {
        let aanvraag = haal_aanvraag(&conn, aanvraag_id)?;
        if aanvraag.status != Status::BijPlanning {
            return Err(AppError::Validatie("Deze kaart ligt niet bij de planning".into()));
        }
        let ronde = haal_huidige_ronde(&conn, &aanvraag)?;
        conn.execute(
            "UPDATE ronde SET datum_naar_planning = ?1 WHERE id = ?2",
            (vandaag.to_string(), ronde.id),
        )?;
        log(&conn, aanvraag_id, Some(ronde.rondenummer), "herinnering",
            "Planning herinnerd aan deze opdracht", &nu)?;
        raak_aan(&conn, aanvraag_id, &nu)?;
        haal_detail(&conn, aanvraag_id)
    })()
    .map_err(|e| e.to_string())
}

/// Definitief verwijderen (één of meer kaarten). ON DELETE CASCADE wist de
/// bijbehorende rondes en logboekregels mee.
#[tauri::command]
pub fn verwijder_aanvragen(ids: Vec<i64>) -> Result<u32, String> {
    let conn = db::conn();
    verwijder_aanvragen_impl(&conn, &ids).map_err(|e| e.to_string())
}

fn verwijder_aanvragen_impl(conn: &Connection, ids: &[i64]) -> AppResult<u32> {
    let mut aantal = 0u32;
    for id in ids {
        aantal += conn.execute("DELETE FROM aanvraag WHERE id = ?1", [id])? as u32;
    }
    Ok(aantal)
}

#[tauri::command]
pub fn get_actielijst() -> Result<Actielijst, String> {
    let conn = db::conn();
    let (nu, vandaag) = klok();
    (|| -> AppResult<Actielijst> {
        let inst = db::lees_instellingen(&conn)?;
        archiveer_verlopen_impl(&conn, &inst, &nu, vandaag)?;
        actielijst_impl(&conn, &inst, vandaag)
    })()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_wachtkamer() -> Result<Vec<WachtKaart>, String> {
    let conn = db::conn();
    let (_, vandaag) = klok();
    (|| -> AppResult<Vec<WachtKaart>> {
        let inst = db::lees_instellingen(&conn)?;
        wachtkamer_impl(&conn, &inst, vandaag)
    })()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_kaarten() -> Result<Vec<Aanvraag>, String> {
    let conn = db::conn();
    (|| -> AppResult<Vec<Aanvraag>> {
        let mut stmt = conn.prepare("SELECT * FROM aanvraag ORDER BY bijgewerkt_op DESC")?;
        let kaarten = stmt
            .query_map([], db::map_aanvraag)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(kaarten)
    })()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_kaart_detail(id: i64) -> Result<KaartDetail, String> {
    let conn = db::conn();
    haal_detail(&conn, id).map_err(|e| e.to_string())
}

// ── Export / import (back-up van alle assignments) ─────────────────
// Termijn-instellingen horen bij de instellingen-export (frontend), niet hier.

/// Volledige assignments-back-up: alle aanvragen, rondes en logboekregels.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpdrachtenExport {
    #[serde(rename = "type")]
    soort: String,
    schema_versie: u32,
    geexporteerd_op: String,
    aanvragen: Vec<Aanvraag>,
    rondes: Vec<Ronde>,
    logboek: Vec<LogboekRegel>,
}

fn bouw_export(conn: &Connection) -> AppResult<OpdrachtenExport> {
    let (nu, _) = klok();
    let mut stmt = conn.prepare("SELECT * FROM aanvraag ORDER BY id")?;
    let aanvragen = stmt.query_map([], db::map_aanvraag)?.collect::<Result<Vec<_>, _>>()?;
    let mut stmt = conn.prepare("SELECT * FROM ronde ORDER BY id")?;
    let rondes = stmt.query_map([], db::map_ronde)?.collect::<Result<Vec<_>, _>>()?;
    let mut stmt = conn.prepare("SELECT * FROM logboek ORDER BY id")?;
    let logboek = stmt.query_map([], db::map_logboek)?.collect::<Result<Vec<_>, _>>()?;
    Ok(OpdrachtenExport {
        soort: "bemail-opdrachten".into(),
        schema_versie: 1,
        geexporteerd_op: nu,
        aanvragen,
        rondes,
        logboek,
    })
}

/// Geeft de hele assignments-administratie als (mooi opgemaakte) JSON terug.
#[tauri::command]
pub fn export_opdrachten() -> Result<String, String> {
    let conn = db::conn();
    let payload = bouw_export(&conn).map_err(|e| e.to_string())?;
    serde_json::to_string_pretty(&payload).map_err(|e| format!("Kon de export niet maken: {e}"))
}

/// Overschrijft ALLE assignments met de inhoud van een eerder gemaakte export.
/// Eén-pc-model: laatste import wint. Geeft het aantal ingelezen kaarten terug.
#[tauri::command]
pub fn import_opdrachten(json: String) -> Result<u32, String> {
    let conn = db::conn();
    import_opdrachten_impl(&conn, &json).map_err(|e| e.to_string())
}

fn import_opdrachten_impl(conn: &Connection, json: &str) -> AppResult<u32> {
    let data: OpdrachtenExport = serde_json::from_str(json)
        .map_err(|e| AppError::Validatie(format!("Ongeldig back-upbestand: {e}")))?;
    if data.soort != "bemail-opdrachten" {
        return Err(AppError::Validatie(
            "Dit bestand is geen assignments-export.".into(),
        ));
    }
    // Alles-of-niets: één transactie, kinderen eerst wissen.
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM logboek", [])?;
    tx.execute("DELETE FROM ronde", [])?;
    tx.execute("DELETE FROM aanvraag", [])?;
    for a in &data.aanvragen {
        tx.execute(
            "INSERT INTO aanvraag (id, klant_naam, klant_bedrijf, klant_telefoon, klant_email,
                                   kanaal, omschrijving, status, huidige_ronde, datum_binnen,
                                   aangemaakt_op, bijgewerkt_op, gearchiveerd)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            rusqlite::params![
                a.id, a.klant_naam, a.klant_bedrijf, a.klant_telefoon, a.klant_email,
                a.kanaal, a.omschrijving, a.status.als_str(), a.huidige_ronde, a.datum_binnen,
                a.aangemaakt_op, a.bijgewerkt_op, a.gearchiveerd as i64
            ],
        )?;
    }
    for r in &data.rondes {
        tx.execute(
            "INSERT INTO ronde (id, aanvraag_id, rondenummer, geschatte_uren, datum_naar_planning,
                                datum_planning_antwoord, ingeplande_datum, datum_klant_geinformeerd,
                                datum_uitvoering_start, uitvoerder, planner, feedback_tekst,
                                afgerond_op, werkelijke_uren)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            rusqlite::params![
                r.id, r.aanvraag_id, r.rondenummer, r.geschatte_uren, r.datum_naar_planning,
                r.datum_planning_antwoord, r.ingeplande_datum, r.datum_klant_geinformeerd,
                r.datum_uitvoering_start, r.uitvoerder, r.planner, r.feedback_tekst,
                r.afgerond_op, r.werkelijke_uren
            ],
        )?;
    }
    for l in &data.logboek {
        tx.execute(
            "INSERT INTO logboek (id, aanvraag_id, rondenummer, tijdstip, type, tekst)
             VALUES (?1,?2,?3,?4,?5,?6)",
            rusqlite::params![
                l.id, l.aanvraag_id, l.rondenummer, l.tijdstip, l.r#type, l.tekst
            ],
        )?;
    }
    tx.commit()?;
    Ok(data.aanvragen.len() as u32)
}

#[tauri::command]
pub fn get_opdracht_instellingen() -> Result<Instellingen, String> {
    let conn = db::conn();
    db::lees_instellingen(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn zet_opdracht_instelling(sleutel: String, waarde: String) -> Result<Instellingen, String> {
    let conn = db::conn();
    (|| -> AppResult<Instellingen> {
        if !matches!(
            sleutel.as_str(),
            "werkdagen_planning_herinnering"
                | "werkdagen_klant_informeren_herhaal"
                | "dagen_heropenbaar"
                | "werkdagen_op_schema_check"
        ) {
            return Err(AppError::Validatie(format!("Onbekende instelling '{sleutel}'")));
        }
        if waarde.parse::<i64>().map(|v| v < 0).unwrap_or(true) {
            return Err(AppError::Validatie("Waarde moet een positief getal zijn".into()));
        }
        db::schrijf_instelling(&conn, &sleutel, &waarde)?;
        db::lees_instellingen(&conn)
    })()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_statistiek() -> Result<statistiek::Statistiek, String> {
    let conn = db::conn();
    let (_, vandaag) = klok();
    statistiek_impl(&conn, vandaag).map_err(|e| e.to_string())
}

/// Demo-data met geantidateerde datums; alleen in dev-builds, wist de dev-data.
#[cfg(debug_assertions)]
#[tauri::command]
pub fn seed_opdrachten_demo() -> Result<(), String> {
    let conn = db::conn();
    let (nu, vandaag) = klok();
    seed_impl(&conn, &nu, vandaag).map_err(|e| e.to_string())
}

#[cfg(debug_assertions)]
fn seed_impl(conn: &Connection, nu: &str, vandaag: NaiveDate) -> AppResult<()> {
    conn.execute_batch("DELETE FROM logboek; DELETE FROM ronde; DELETE FROM aanvraag;")?;
    let inst = db::lees_instellingen(conn)?;

    let dagen = |n: i64| (vandaag - chrono::Duration::days(n)).to_string();
    let utc_dagen = |n: i64| {
        (Utc::now() - chrono::Duration::days(n)).to_rfc3339_opts(SecondsFormat::Secs, true)
    };

    let nieuw = |naam: &str, bedrijf: &str, kanaal: &str, omschrijving: &str,
                 dagen_terug: i64| -> AppResult<i64> {
        conn.execute(
            "INSERT INTO aanvraag (klant_naam, klant_bedrijf, kanaal, omschrijving, status,
                                   huidige_ronde, datum_binnen, aangemaakt_op, bijgewerkt_op)
             VALUES (?1, ?2, ?3, ?4, 'binnengekomen', 1, ?5, ?6, ?6)",
            (naam, bedrijf, kanaal, omschrijving, dagen(dagen_terug), utc_dagen(dagen_terug)),
        )?;
        let id = conn.last_insert_rowid();
        conn.execute("INSERT INTO ronde (aanvraag_id, rondenummer) VALUES (?1, 1)", [id])?;
        log(conn, id, Some(1), "status_wijziging", "Aanvraag binnengekomen", &utc_dagen(dagen_terug))?;
        Ok(id)
    };
    let ga_naar = |id: i64, doel: Status, payload: StatusPayload| -> AppResult<()> {
        wijzig_status_impl(conn, id, doel, &payload, &inst, nu, vandaag)?;
        Ok(())
    };
    let zet_ronde = |id: i64, kolom: &str, waarde: &str| -> AppResult<()> {
        conn.execute(
            &format!(
                "UPDATE ronde SET {kolom} = ?1 WHERE aanvraag_id = ?2
                 AND rondenummer = (SELECT huidige_ronde FROM aanvraag WHERE id = ?2)"
            ),
            (waarde, id),
        )?;
        Ok(())
    };

    // 1. Net binnengekomen
    nieuw("Jan Willems", "Bakkerij Willems", "telefoon", "Nieuwe toonbank plaatsen", 0)?;

    // 2. Tijd inschatten
    let id = nieuw("Sophie Vermeer", "Vermeer Optiek", "email", "Verlichting etalage vervangen", 1)?;
    ga_naar(id, Status::TijdInschatten, StatusPayload::default())?;

    // 3. Bij planning, binnen drempel
    let id = nieuw("Ahmed El Idrissi", "El Idrissi Advocatuur", "email", "Kantoorwand verplaatsen", 3)?;
    ga_naar(id, Status::TijdInschatten, StatusPayload::default())?;
    ga_naar(id, Status::BijPlanning, StatusPayload::default())?;
    zet_ronde(id, "datum_naar_planning", &dagen(1))?;

    // 4. Bij planning, drempel verstreken → rood
    let id = nieuw("Karin Bos", "Bos & Zonen", "telefoon", "Dakgoot herstellen na storm", 10)?;
    ga_naar(id, Status::TijdInschatten, StatusPayload::default())?;
    ga_naar(id, Status::BijPlanning, StatusPayload::default())?;
    zet_ronde(id, "datum_naar_planning", &dagen(7))?;

    // 5. Klant informeren → oranje, afgedwongen
    let id = nieuw("Peter de Jong", "", "telefoon", "Airco onderhoud", 4)?;
    ga_naar(id, Status::TijdInschatten, StatusPayload::default())?;
    ga_naar(id, Status::BijPlanning, StatusPayload::default())?;
    ga_naar(id, Status::KlantInformeren, StatusPayload {
        ingeplande_datum: Some(dagen(-10)), ..Default::default()
    })?;

    // 6. Klant informeren, al 2 werkdagen open → rood
    let id = nieuw("Linda Faber", "Faber Interieur", "email", "Showroomvloer egaliseren", 8)?;
    ga_naar(id, Status::TijdInschatten, StatusPayload::default())?;
    ga_naar(id, Status::BijPlanning, StatusPayload::default())?;
    ga_naar(id, Status::KlantInformeren, StatusPayload {
        ingeplande_datum: Some(dagen(-14)), ..Default::default()
    })?;
    zet_ronde(id, "datum_planning_antwoord", &dagen(4))?;

    // 7. Ingepland, toekomst → wachtkamer
    let id = nieuw("Mark Visser", "Visser Vastgoed", "email", "Sleutelkluisjes monteren", 6)?;
    ga_naar(id, Status::TijdInschatten, StatusPayload::default())?;
    ga_naar(id, Status::BijPlanning, StatusPayload::default())?;
    ga_naar(id, Status::KlantInformeren, StatusPayload {
        ingeplande_datum: Some(dagen(-7)), ..Default::default()
    })?;
    ga_naar(id, Status::Ingepland, StatusPayload::default())?;

    // 8. Ingepland, datum bereikt → actie
    let id = nieuw("Fatima Yilmaz", "Yilmaz Catering", "telefoon", "Afzuiging keuken uitbreiden", 9)?;
    ga_naar(id, Status::TijdInschatten, StatusPayload::default())?;
    ga_naar(id, Status::BijPlanning, StatusPayload::default())?;
    ga_naar(id, Status::KlantInformeren, StatusPayload {
        ingeplande_datum: Some(dagen(0)), ..Default::default()
    })?;
    ga_naar(id, Status::Ingepland, StatusPayload::default())?;

    // 9. In uitvoering (4 werkdagen bezig → op-schema-check bij default drempel 3)
    let id = nieuw("Rob Hendriks", "Hendriks Transport", "email", "Laadperron verbreden", 12)?;
    ga_naar(id, Status::TijdInschatten, StatusPayload::default())?;
    ga_naar(id, Status::BijPlanning, StatusPayload::default())?;
    ga_naar(id, Status::KlantInformeren, StatusPayload {
        ingeplande_datum: Some(dagen(6)), ..Default::default()
    })?;
    ga_naar(id, Status::Ingepland, StatusPayload::default())?;
    ga_naar(id, Status::InUitvoering, StatusPayload::default())?;
    zet_ronde(id, "datum_uitvoering_start", &dagen(6))?;

    // 10. Feedback & controle
    let id = nieuw("Esther Smit", "Smit Fysiotherapie", "telefoon", "Behandelkamer geluidsisolatie", 15)?;
    ga_naar(id, Status::TijdInschatten, StatusPayload::default())?;
    ga_naar(id, Status::BijPlanning, StatusPayload::default())?;
    ga_naar(id, Status::KlantInformeren, StatusPayload {
        ingeplande_datum: Some(dagen(3)), ..Default::default()
    })?;
    ga_naar(id, Status::Ingepland, StatusPayload::default())?;
    ga_naar(id, Status::InUitvoering, StatusPayload::default())?;
    ga_naar(id, Status::FeedbackControle, StatusPayload::default())?;

    // 11. Tweede ronde na feedback, met uren voor de statistiek
    let id = nieuw("Tom Dekker", "Dekker Fietsen", "email", "Werkplaatsstelling ombouwen", 20)?;
    ga_naar(id, Status::TijdInschatten, StatusPayload::default())?;
    zet_ronde(id, "geschatte_uren", "8")?;
    ga_naar(id, Status::BijPlanning, StatusPayload::default())?;
    ga_naar(id, Status::KlantInformeren, StatusPayload {
        ingeplande_datum: Some(dagen(8)), ..Default::default()
    })?;
    ga_naar(id, Status::Ingepland, StatusPayload::default())?;
    ga_naar(id, Status::InUitvoering, StatusPayload::default())?;
    zet_ronde(id, "werkelijke_uren", "11")?;
    ga_naar(id, Status::FeedbackControle, StatusPayload::default())?;
    ga_naar(id, Status::TijdInschatten, StatusPayload {
        feedback_tekst: Some("Bovenste plank zit te hoog, graag 20 cm lager".into()),
        ..Default::default()
    })?;

    // 12. Afgerond met geschat + werkelijk (statistiek), 5 dagen geleden → heropenbaar
    let id = nieuw("Nina Peters", "Peters Boekhandel", "telefoon", "Kassameubel aanpassen", 25)?;
    ga_naar(id, Status::TijdInschatten, StatusPayload::default())?;
    zet_ronde(id, "geschatte_uren", "5")?;
    ga_naar(id, Status::BijPlanning, StatusPayload::default())?;
    ga_naar(id, Status::KlantInformeren, StatusPayload {
        ingeplande_datum: Some(dagen(10)), ..Default::default()
    })?;
    ga_naar(id, Status::Ingepland, StatusPayload::default())?;
    ga_naar(id, Status::InUitvoering, StatusPayload::default())?;
    zet_ronde(id, "werkelijke_uren", "4.5")?;
    ga_naar(id, Status::FeedbackControle, StatusPayload::default())?;
    ga_naar(id, Status::Afgerond, StatusPayload::default())?;
    zet_ronde(id, "afgerond_op", &utc_dagen(5))?;

    // 13. Geannuleerd
    let id = nieuw("Bas Kuipers", "", "email", "Offerte tuinoverkapping", 5)?;
    ga_naar(id, Status::Geannuleerd, StatusPayload {
        reden: Some("Klant kiest voor een andere aannemer".into()),
        ..Default::default()
    })?;

    Ok(())
}

// ── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    const NU: &str = "2026-07-08T10:00:00Z";
    const VANDAAG: &str = "2026-07-08"; // woensdag

    fn setup() -> (Connection, Instellingen) {
        let conn = Connection::open_in_memory().unwrap();
        db::init_conn(&conn).unwrap();
        (conn, Instellingen::default())
    }

    fn kaart(conn: &Connection) -> i64 {
        maak_kaart_impl(conn, "Testklant", None, None, "Testopdracht",
            "Aanvraag binnengekomen", NU, d(VANDAAG))
            .unwrap()
            .aanvraag
            .id
    }

    #[test]
    fn maak_kaart_en_van_mail() {
        let (conn, _) = setup();
        let detail = maak_kaart_impl(&conn, "  Jan  ", Some("jan@bakkerij.nl"), Some("email"),
            "Toonbank", "Aanvraag binnengekomen via e-mail: \"Toonbank\"", NU, d(VANDAAG)).unwrap();
        assert_eq!(detail.aanvraag.klant_naam, "Jan");
        assert_eq!(detail.aanvraag.klant_email.as_deref(), Some("jan@bakkerij.nl"));
        assert_eq!(detail.aanvraag.kanaal.as_deref(), Some("email"));
        assert_eq!(detail.aanvraag.status, Status::Binnengekomen);
        assert_eq!(detail.rondes.len(), 1);
        assert!(detail.logboek[0].tekst.contains("via e-mail"));
        // Lege naam geweigerd
        assert!(maak_kaart_impl(&conn, "  ", None, None, "x", "log", NU, d(VANDAAG)).is_err());
    }

    #[test]
    fn volledige_hoofdflow_zet_alle_datums() {
        let (conn, inst) = setup();
        let id = kaart(&conn);
        let stap = |doel, payload| wijzig_status_impl(&conn, id, doel, &payload, &inst, NU, d(VANDAAG));

        stap(Status::TijdInschatten, StatusPayload::default()).unwrap();
        stap(Status::BijPlanning, StatusPayload::default()).unwrap();
        stap(Status::KlantInformeren, StatusPayload {
            ingeplande_datum: Some("2026-07-20".into()), ..Default::default()
        }).unwrap();
        stap(Status::Ingepland, StatusPayload::default()).unwrap();
        stap(Status::InUitvoering, StatusPayload::default()).unwrap();
        stap(Status::FeedbackControle, StatusPayload::default()).unwrap();
        let detail = stap(Status::Afgerond, StatusPayload::default()).unwrap();

        let ronde = &detail.rondes[0];
        assert_eq!(ronde.datum_naar_planning.as_deref(), Some(VANDAAG));
        assert_eq!(ronde.ingeplande_datum.as_deref(), Some("2026-07-20"));
        assert_eq!(ronde.datum_klant_geinformeerd.as_deref(), Some(VANDAAG));
        assert_eq!(ronde.afgerond_op.as_deref(), Some(NU));
        assert_eq!(detail.logboek.len(), 8);
    }

    #[test]
    fn ongeldige_overgang_geweigerd_en_status_onveranderd() {
        let (conn, inst) = setup();
        let id = kaart(&conn);
        assert!(wijzig_status_impl(&conn, id, Status::Afgerond,
            &StatusPayload::default(), &inst, NU, d(VANDAAG)).is_err());
        assert_eq!(haal_aanvraag(&conn, id).unwrap().status, Status::Binnengekomen);
    }

    #[test]
    fn feedback_start_nieuwe_ronde_met_behoud_gegevens() {
        let (conn, inst) = setup();
        let id = kaart(&conn);
        let stap = |doel, payload| wijzig_status_impl(&conn, id, doel, &payload, &inst, NU, d(VANDAAG));
        stap(Status::TijdInschatten, StatusPayload::default()).unwrap();
        stap(Status::BijPlanning, StatusPayload::default()).unwrap();
        stap(Status::KlantInformeren, StatusPayload {
            ingeplande_datum: Some("2026-07-20".into()), ..Default::default()
        }).unwrap();
        stap(Status::Ingepland, StatusPayload::default()).unwrap();
        stap(Status::InUitvoering, StatusPayload::default()).unwrap();
        stap(Status::FeedbackControle, StatusPayload::default()).unwrap();
        let detail = stap(Status::TijdInschatten, StatusPayload {
            feedback_tekst: Some("Kleur klopt niet".into()), ..Default::default()
        }).unwrap();

        assert_eq!(detail.aanvraag.huidige_ronde, 2);
        assert_eq!(detail.rondes.len(), 2);
        assert_eq!(detail.rondes[0].feedback_tekst.as_deref(), Some("Kleur klopt niet"));
        assert_eq!(detail.aanvraag.klant_naam, "Testklant");
    }

    #[test]
    fn werkelijke_uren_opslaan_en_statistiek() {
        let (conn, inst) = setup();
        let id = kaart(&conn);
        let stap = |doel, payload| wijzig_status_impl(&conn, id, doel, &payload, &inst, NU, d(VANDAAG));
        stap(Status::TijdInschatten, StatusPayload::default()).unwrap();
        conn.execute("UPDATE ronde SET geschatte_uren = 6 WHERE aanvraag_id = ?1", [id]).unwrap();
        stap(Status::BijPlanning, StatusPayload::default()).unwrap();
        stap(Status::KlantInformeren, StatusPayload {
            ingeplande_datum: Some("2026-07-09".into()), ..Default::default()
        }).unwrap();
        stap(Status::Ingepland, StatusPayload::default()).unwrap();
        stap(Status::InUitvoering, StatusPayload::default()).unwrap();
        conn.execute("UPDATE ronde SET werkelijke_uren = 7.5 WHERE aanvraag_id = ?1", [id]).unwrap();

        let s = statistiek_impl(&conn, d(VANDAAG)).unwrap();
        assert_eq!(s.uren_kaarten.len(), 1);
        assert_eq!(s.uren_kaarten[0].geschat, 6.0);
        assert_eq!(s.uren_kaarten[0].werkelijk, 7.5);
        // Doorlooptijd: naar planning en antwoord op dezelfde dag → 0 werkdagen
        assert_eq!(s.doorlooptijd_meetpunten, 1);
        assert_eq!(s.gem_doorlooptijd_planning, Some(0.0));
        assert_eq!(s.per_week.last().map(|w| w.aantal), Some(1));
    }

    #[test]
    fn verwijderen_wist_kaart_rondes_en_logboek() {
        let (conn, inst) = setup();
        let id1 = kaart(&conn);
        let id2 = kaart(&conn);
        // Kaart 1 een eind door de flow zodat er meerdere logregels zijn
        wijzig_status_impl(&conn, id1, Status::TijdInschatten,
            &StatusPayload::default(), &inst, NU, d(VANDAAG)).unwrap();

        let n = verwijder_aanvragen_impl(&conn, &[id1]).unwrap();
        assert_eq!(n, 1);
        assert!(haal_aanvraag(&conn, id1).is_err());
        // CASCADE: rondes en logboek weg
        let rondes: i64 = conn.query_row(
            "SELECT COUNT(*) FROM ronde WHERE aanvraag_id = ?1", [id1], |r| r.get(0)).unwrap();
        let logs: i64 = conn.query_row(
            "SELECT COUNT(*) FROM logboek WHERE aanvraag_id = ?1", [id1], |r| r.get(0)).unwrap();
        assert_eq!((rondes, logs), (0, 0));
        // Andere kaart onaangetast; onbekend id is geen fout (0 verwijderd)
        assert!(haal_aanvraag(&conn, id2).is_ok());
        assert_eq!(verwijder_aanvragen_impl(&conn, &[9999]).unwrap(), 0);
        // Multiselect: meerdere tegelijk
        let id3 = kaart(&conn);
        assert_eq!(verwijder_aanvragen_impl(&conn, &[id2, id3]).unwrap(), 2);
    }

    #[test]
    fn archiveren_na_verlopen_heropen_periode() {
        let (conn, inst) = setup();
        let id = kaart(&conn);
        let stap = |doel, payload| wijzig_status_impl(&conn, id, doel, &payload, &inst, NU, d(VANDAAG));
        stap(Status::TijdInschatten, StatusPayload::default()).unwrap();
        stap(Status::BijPlanning, StatusPayload::default()).unwrap();
        stap(Status::KlantInformeren, StatusPayload {
            ingeplande_datum: Some("2026-07-09".into()), ..Default::default()
        }).unwrap();
        stap(Status::Ingepland, StatusPayload::default()).unwrap();
        stap(Status::InUitvoering, StatusPayload::default()).unwrap();
        stap(Status::FeedbackControle, StatusPayload::default()).unwrap();
        stap(Status::Afgerond, StatusPayload::default()).unwrap();

        let n = archiveer_verlopen_impl(&conn, &inst, "2026-07-18T10:00:00Z", d("2026-07-18")).unwrap();
        assert_eq!(n, 0);
        let n = archiveer_verlopen_impl(&conn, &inst, "2026-07-28T10:00:00Z", d("2026-07-28")).unwrap();
        assert_eq!(n, 1);
        assert!(haal_aanvraag(&conn, id).unwrap().gearchiveerd);
    }

    #[test]
    fn export_en_import_overschrijft_alles() {
        let (conn, _) = setup();
        let id = kaart(&conn);
        conn.execute(
            "UPDATE ronde SET uitvoerder = 'Tim', planner = 'Ilse' WHERE aanvraag_id = ?1",
            [id],
        )
        .unwrap();
        let json = serde_json::to_string(&bouw_export(&conn).unwrap()).unwrap();

        // Verse database met ándere data die volledig overschreven moet worden.
        let conn2 = Connection::open_in_memory().unwrap();
        db::init_conn(&conn2).unwrap();
        kaart(&conn2);
        kaart(&conn2);

        let n = import_opdrachten_impl(&conn2, &json).unwrap();
        assert_eq!(n, 1);
        let count: i64 = conn2
            .query_row("SELECT COUNT(*) FROM aanvraag", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1, "import moet de bestaande kaarten wissen");
        let detail = haal_detail(&conn2, id).unwrap();
        assert_eq!(detail.aanvraag.klant_naam, "Testklant");
        assert_eq!(detail.rondes[0].uitvoerder.as_deref(), Some("Tim"));
        assert_eq!(detail.rondes[0].planner.as_deref(), Some("Ilse"));

        // Rommel en een verkeerd exporttype worden netjes geweigerd.
        assert!(import_opdrachten_impl(&conn2, "{}").is_err());
        assert!(import_opdrachten_impl(
            &conn2,
            r#"{"type":"iets-anders","schemaVersie":1,"geexporteerdOp":"x","aanvragen":[],"rondes":[],"logboek":[]}"#
        )
        .is_err());
    }

    #[cfg(debug_assertions)]
    #[test]
    fn seed_levert_alle_toestanden_incl_statistiek() {
        let (conn, inst) = setup();
        seed_impl(&conn, NU, d(VANDAAG)).unwrap();
        let lijst = actielijst_impl(&conn, &inst, d(VANDAAG)).unwrap();
        let wacht = wachtkamer_impl(&conn, &inst, d(VANDAAG)).unwrap();
        assert!(lijst.acties.len() >= 6);
        assert!(!lijst.heropenbaar.is_empty());
        assert!(wacht.len() >= 2);
        assert_eq!(lijst.acties[0].urgentieklasse, 0);
        // Op-schema-check zit ertussen (Rob Hendriks, 4 werkdagen bezig)
        assert!(lijst.acties.iter().any(|a| a.actie_soort == "op_schema_check"));
        let s = statistiek_impl(&conn, d(VANDAAG)).unwrap();
        assert!(s.uren_kaarten.len() >= 2);
        assert!(s.totaal_werkelijk > 0.0);
        assert!(s.gem_doorlooptijd_planning.is_some());
    }
}
