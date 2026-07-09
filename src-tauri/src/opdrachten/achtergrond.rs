//! Achtergrond-poller van de opdrachten-module: stuurt Windows-toasts voor
//! herinneringen en seint de frontend. Los van de mail-notifier (`notifier.rs`).
//! Verstuurt uitsluitend NOTIFICATIES — nooit e-mail.

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use chrono::Local;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

use crate::opdrachten::commands;
use crate::opdrachten::db;
use crate::opdrachten::error::AppResult;
use crate::opdrachten::models::ActieKaart;

/// Reeds gemelde acties, per app-sessie. De sleutel bevat de urgentieklasse,
/// zodat een escalatie (oranje → rood) opnieuw een melding geeft.
static GEMELD: OnceLock<Mutex<HashSet<(i64, String, u8)>>> = OnceLock::new();

pub struct Melding {
    pub titel: String,
    pub tekst: String,
}

/// Puur en testbaar: welke acties zijn nieuw t.o.v. de vorige tick?
/// De set wordt per tick volledig vervangen (verdwenen-en-terug meldt dus
/// terecht opnieuw). Alleen urgentieklasse 0 en 1; klasse 2 is ruis.
pub fn bepaal_meldingen(
    vorige: &HashSet<(i64, String, u8)>,
    acties: &[ActieKaart],
) -> (HashSet<(i64, String, u8)>, Vec<Melding>) {
    let mut nieuwe_set = HashSet::new();
    let mut meldingen = Vec::new();
    for actie in acties {
        if actie.urgentieklasse > 1 {
            continue;
        }
        let sleutel = (
            actie.aanvraag.id,
            actie.actie_soort.clone(),
            actie.urgentieklasse,
        );
        if !vorige.contains(&sleutel) {
            let wie = match &actie.aanvraag.klant_bedrijf {
                Some(b) if !b.is_empty() => format!("{} ({})", actie.aanvraag.klant_naam, b),
                _ => actie.aanvraag.klant_naam.clone(),
            };
            meldingen.push(Melding {
                titel: titel_voor(&actie.actie_soort),
                tekst: format!("{wie} — {}", actie.actie_label),
            });
        }
        nieuwe_set.insert(sleutel);
    }
    (nieuwe_set, meldingen)
}

fn titel_voor(soort: &str) -> String {
    match soort {
        "planning_herinneren" => "Planning herinneren",
        "klant_informeren" => "Klant informeren",
        "uitvoering_starten" => "Uitvoeringsdatum bereikt",
        "op_schema_check" => "Op schema?",
        "feedback_vragen" => "Feedback controleren",
        _ => "Actie nodig",
    }
    .to_string()
}

fn tick(app: &AppHandle) -> AppResult<()> {
    // Fase 1: kort onder de db-lock alleen data ophalen.
    let lijst = {
        let conn = db::conn();
        let inst = db::lees_instellingen(&conn)?;
        let nu = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let vandaag = Local::now().date_naive();
        commands::archiveer_verlopen_impl(&conn, &inst, &nu, vandaag)?;
        commands::actielijst_impl(&conn, &inst, vandaag)?
    };

    // Fase 2: zonder lock melden en de UI seinen.
    let meldingen = {
        let mut gemeld = GEMELD.get_or_init(Default::default).lock().unwrap();
        let (nieuwe_set, meldingen) = bepaal_meldingen(&gemeld, &lijst.acties);
        *gemeld = nieuwe_set;
        meldingen
    };

    for melding in &meldingen {
        if let Err(e) = app
            .notification()
            .builder()
            .title(&melding.titel)
            .body(&melding.tekst)
            .show()
        {
            eprintln!("opdracht-notificatie mislukt: {e}");
        }
    }

    if !meldingen.is_empty() {
        let _ = app.emit("opdrachten-ververst", ());
    }
    Ok(())
}

/// Start de poller; aanroepen in setup() nadat `db::init()` is gelukt.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        if let Err(e) = tick(&app) {
            eprintln!("opdrachten-tick mislukt: {e}");
        }
        std::thread::sleep(std::time::Duration::from_secs(60));
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::opdrachten::models::{Aanvraag, Ronde, Status};

    fn actie(id: i64, soort: &str, klasse: u8) -> ActieKaart {
        ActieKaart {
            aanvraag: Aanvraag {
                id,
                klant_naam: format!("Klant {id}"),
                klant_bedrijf: None,
                klant_telefoon: None,
                klant_email: None,
                kanaal: None,
                omschrijving: None,
                status: Status::BijPlanning,
                huidige_ronde: 1,
                datum_binnen: "2026-07-01".into(),
                aangemaakt_op: "2026-07-01T08:00:00Z".into(),
                bijgewerkt_op: "2026-07-01T08:00:00Z".into(),
                gearchiveerd: false,
            },
            ronde: Ronde {
                id,
                aanvraag_id: id,
                rondenummer: 1,
                geschatte_uren: None,
                datum_naar_planning: None,
                datum_planning_antwoord: None,
                ingeplande_datum: None,
                datum_klant_geinformeerd: None,
                datum_uitvoering_start: None,
                uitvoerder: None,
                planner: None,
                feedback_tekst: None,
                afgerond_op: None,
                werkelijke_uren: None,
            },
            actie_soort: soort.into(),
            actie_label: "test".into(),
            urgentieklasse: klasse,
            werkdagen_wachtend: 0,
        }
    }

    #[test]
    fn nieuwe_actie_meldt_en_daarna_stil() {
        let acties = vec![actie(1, "planning_herinneren", 0)];
        let (set, m1) = bepaal_meldingen(&HashSet::new(), &acties);
        assert_eq!(m1.len(), 1);
        let (_, m2) = bepaal_meldingen(&set, &acties);
        assert!(m2.is_empty());
    }

    #[test]
    fn escalatie_meldt_opnieuw() {
        let (set, _) = bepaal_meldingen(&HashSet::new(), &[actie(1, "klant_informeren", 1)]);
        let (_, m) = bepaal_meldingen(&set, &[actie(1, "klant_informeren", 0)]);
        assert_eq!(m.len(), 1);
    }

    #[test]
    fn klasse_2_is_stil_en_verdwenen_en_terug_meldt() {
        let (set, m) = bepaal_meldingen(&HashSet::new(), &[actie(1, "verwerken", 2)]);
        assert!(m.is_empty() && set.is_empty());

        let acties = vec![actie(2, "op_schema_check", 1)];
        let (set, _) = bepaal_meldingen(&HashSet::new(), &acties);
        let (lege, m) = bepaal_meldingen(&set, &[]);
        assert!(m.is_empty() && lege.is_empty());
        let (_, m2) = bepaal_meldingen(&lege, &acties);
        assert_eq!(m2.len(), 1);
        assert_eq!(m2[0].titel, "Op schema?");
    }
}
