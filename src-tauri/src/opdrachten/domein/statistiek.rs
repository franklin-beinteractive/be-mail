//! Statistiek (spec §10, Fase 3): pure berekeningen, datum geïnjecteerd.

use chrono::{Datelike, Duration, NaiveDate};
use serde::Serialize;

use crate::opdrachten::domein::werkdagen::werkdagen_sinds;
use crate::opdrachten::models::Status;

/// Invoer per kaart, verzameld door de db-laag.
pub struct KaartInvoer {
    pub klant_naam: String,
    pub omschrijving: Option<String>,
    pub status: Status,
    pub datum_binnen: Option<NaiveDate>,
    pub rondes: Vec<RondeInvoer>,
}

pub struct RondeInvoer {
    pub datum_naar_planning: Option<NaiveDate>,
    pub datum_planning_antwoord: Option<NaiveDate>,
    pub geschatte_uren: Option<f64>,
    pub werkelijke_uren: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WeekTelling {
    pub label: String, // "wk 28"
    pub start: String, // maandag, YYYY-MM-DD
    pub aantal: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct UrenKaart {
    pub klant: String,
    pub omschrijving: String,
    pub geschat: f64,
    pub werkelijk: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Statistiek {
    /// Nieuwe aanvragen per week, oudste eerst (laatste 12 weken incl. huidige).
    pub per_week: Vec<WeekTelling>,
    /// Gemiddelde werkdagen tussen "naar planning" en het planningsantwoord.
    pub gem_doorlooptijd_planning: Option<f64>,
    /// Aantal rondes waarop de doorlooptijd gebaseerd is.
    pub doorlooptijd_meetpunten: u32,
    /// Kaarten met geregistreerde werkelijke uren.
    pub uren_kaarten: Vec<UrenKaart>,
    pub totaal_geschat: f64,
    pub totaal_werkelijk: f64,
    /// Verdeling van het aantal rondes per kaart.
    pub kaarten_1_ronde: u32,
    pub kaarten_2_rondes: u32,
    pub kaarten_3plus_rondes: u32,
    pub open: u32,
    pub afgerond: u32,
    pub geannuleerd: u32,
}

pub fn bereken(kaarten: &[KaartInvoer], vandaag: NaiveDate) -> Statistiek {
    // Weken: maandag als weekstart.
    let deze_maandag =
        vandaag - Duration::days(i64::from(vandaag.weekday().num_days_from_monday()));
    let mut per_week: Vec<WeekTelling> = (0..12)
        .rev()
        .map(|terug| {
            let start = deze_maandag - Duration::days(7 * terug);
            WeekTelling {
                label: format!("wk {}", start.iso_week().week()),
                start: start.to_string(),
                aantal: 0,
            }
        })
        .collect();
    let eerste_start = deze_maandag - Duration::days(7 * 11);

    let mut doorlooptijden: Vec<u32> = Vec::new();
    let mut uren_kaarten: Vec<UrenKaart> = Vec::new();
    let (mut r1, mut r2, mut r3) = (0u32, 0u32, 0u32);
    let (mut open, mut afgerond, mut geannuleerd) = (0u32, 0u32, 0u32);

    for kaart in kaarten {
        if let Some(binnen) = kaart.datum_binnen {
            if binnen >= eerste_start && binnen < deze_maandag + Duration::days(7) {
                let index = ((binnen - eerste_start).num_days() / 7) as usize;
                if let Some(week) = per_week.get_mut(index) {
                    week.aantal += 1;
                }
            }
        }

        match kaart.rondes.len() {
            0 | 1 => r1 += 1,
            2 => r2 += 1,
            _ => r3 += 1,
        }

        match kaart.status {
            Status::Afgerond => afgerond += 1,
            Status::Geannuleerd => geannuleerd += 1,
            _ => open += 1,
        }

        let mut geschat = 0.0;
        let mut werkelijk = 0.0;
        for ronde in &kaart.rondes {
            if let (Some(naar), Some(antwoord)) =
                (ronde.datum_naar_planning, ronde.datum_planning_antwoord)
            {
                doorlooptijden.push(werkdagen_sinds(naar, antwoord));
            }
            geschat += ronde.geschatte_uren.unwrap_or(0.0);
            werkelijk += ronde.werkelijke_uren.unwrap_or(0.0);
        }
        if werkelijk > 0.0 {
            uren_kaarten.push(UrenKaart {
                klant: kaart.klant_naam.clone(),
                omschrijving: kaart.omschrijving.clone().unwrap_or_default(),
                geschat,
                werkelijk,
            });
        }
    }

    let totaal_geschat = uren_kaarten.iter().map(|k| k.geschat).sum();
    let totaal_werkelijk = uren_kaarten.iter().map(|k| k.werkelijk).sum();
    let gem_doorlooptijd_planning = if doorlooptijden.is_empty() {
        None
    } else {
        Some(doorlooptijden.iter().sum::<u32>() as f64 / doorlooptijden.len() as f64)
    };

    Statistiek {
        per_week,
        doorlooptijd_meetpunten: doorlooptijden.len() as u32,
        gem_doorlooptijd_planning,
        uren_kaarten,
        totaal_geschat,
        totaal_werkelijk,
        kaarten_1_ronde: r1,
        kaarten_2_rondes: r2,
        kaarten_3plus_rondes: r3,
        open,
        afgerond,
        geannuleerd,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn kaart(binnen: &str, status: Status, rondes: Vec<RondeInvoer>) -> KaartInvoer {
        KaartInvoer {
            klant_naam: "Test".into(),
            omschrijving: Some("Opdracht".into()),
            status,
            datum_binnen: Some(d(binnen)),
            rondes,
        }
    }

    fn ronde(naar: Option<&str>, antwoord: Option<&str>, geschat: Option<f64>, werkelijk: Option<f64>) -> RondeInvoer {
        RondeInvoer {
            datum_naar_planning: naar.map(d),
            datum_planning_antwoord: antwoord.map(d),
            geschatte_uren: geschat,
            werkelijke_uren: werkelijk,
        }
    }

    #[test]
    fn telt_aanvragen_per_week() {
        // vandaag = wo 2026-07-08; deze maandag = 2026-07-06
        let kaarten = vec![
            kaart("2026-07-07", Status::Binnengekomen, vec![]), // deze week
            kaart("2026-07-06", Status::Binnengekomen, vec![]), // deze week
            kaart("2026-06-30", Status::Binnengekomen, vec![]), // vorige week
            kaart("2020-01-01", Status::Binnengekomen, vec![]), // ver buiten venster
        ];
        let s = bereken(&kaarten, d("2026-07-08"));
        assert_eq!(s.per_week.len(), 12);
        assert_eq!(s.per_week[11].aantal, 2); // huidige week achteraan
        assert_eq!(s.per_week[10].aantal, 1);
        assert_eq!(s.per_week[11].label, "wk 28");
        assert_eq!(s.per_week[11].start, "2026-07-06");
    }

    #[test]
    fn gemiddelde_doorlooptijd_in_werkdagen() {
        let kaarten = vec![
            // ma → do = 3 werkdagen; ma → di = 1 werkdag → gemiddeld 2
            kaart("2026-07-01", Status::Afgerond, vec![
                ronde(Some("2026-07-06"), Some("2026-07-09"), None, None),
                ronde(Some("2026-07-06"), Some("2026-07-07"), None, None),
            ]),
            // Geen antwoord → telt niet mee
            kaart("2026-07-01", Status::BijPlanning, vec![
                ronde(Some("2026-07-06"), None, None, None),
            ]),
        ];
        let s = bereken(&kaarten, d("2026-07-10"));
        assert_eq!(s.doorlooptijd_meetpunten, 2);
        assert_eq!(s.gem_doorlooptijd_planning, Some(2.0));
    }

    #[test]
    fn geschat_versus_werkelijk_alleen_met_werkelijke_uren() {
        let kaarten = vec![
            kaart("2026-07-01", Status::Afgerond, vec![
                ronde(None, None, Some(6.0), Some(9.5)),
                ronde(None, None, Some(2.0), Some(1.0)), // correctie-ronde telt mee
            ]),
            kaart("2026-07-01", Status::InUitvoering, vec![
                ronde(None, None, Some(4.0), None), // geen werkelijke uren → niet in de lijst
            ]),
        ];
        let s = bereken(&kaarten, d("2026-07-08"));
        assert_eq!(s.uren_kaarten.len(), 1);
        assert_eq!(s.uren_kaarten[0].geschat, 8.0);
        assert_eq!(s.uren_kaarten[0].werkelijk, 10.5);
        assert_eq!(s.totaal_geschat, 8.0);
        assert_eq!(s.totaal_werkelijk, 10.5);
    }

    #[test]
    fn rondes_verdeling_en_statustellers() {
        let kaarten = vec![
            kaart("2026-07-01", Status::Afgerond, vec![ronde(None, None, None, None)]),
            kaart("2026-07-01", Status::TijdInschatten, vec![
                ronde(None, None, None, None),
                ronde(None, None, None, None),
            ]),
            kaart("2026-07-01", Status::Geannuleerd, vec![
                ronde(None, None, None, None),
                ronde(None, None, None, None),
                ronde(None, None, None, None),
            ]),
        ];
        let s = bereken(&kaarten, d("2026-07-08"));
        assert_eq!((s.kaarten_1_ronde, s.kaarten_2_rondes, s.kaarten_3plus_rondes), (1, 1, 1));
        assert_eq!((s.open, s.afgerond, s.geannuleerd), (1, 1, 1));
    }
}
