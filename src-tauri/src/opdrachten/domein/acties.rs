use chrono::NaiveDate;

use crate::opdrachten::domein::werkdagen::werkdagen_sinds;
use crate::opdrachten::models::{Instellingen, Ronde, Status};

/// Waar hoort een kaart thuis, afgeleid uit status + datums + drempels?
/// Puur en deterministisch: `vandaag` wordt geïnjecteerd.
#[derive(Debug, Clone, PartialEq)]
pub enum Plek {
    Actie {
        soort: &'static str,
        label: String,
        /// 0 = verlopen herinnering (rood), 1 = ⚠️-status (oranje), 2 = gewone actie.
        urgentieklasse: u8,
        /// Hoeveel werkdagen over de drempel; voor sortering binnen een klasse.
        dagen_over_drempel: i64,
        werkdagen_wachtend: u32,
    },
    Wachtkamer {
        wacht_op: &'static str, // 'planning' | 'uitvoeringsdatum' | 'uitvoering'
        label: String,
        sinds: Option<NaiveDate>,
        werkdagen: u32,
    },
    /// Afgerond, nog binnen de heropen-periode.
    Heropenbaar { dagen_resterend: i64 },
    /// Geannuleerd of definitief gearchiveerd: alleen zichtbaar onder "Alle kaarten".
    Rust,
}

fn parse_datum(d: &Option<String>) -> Option<NaiveDate> {
    d.as_deref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
}

pub fn bepaal_plek(
    status: Status,
    ronde: &Ronde,
    afgerond_op_datum: Option<NaiveDate>, // lokale datum van afronding (uit UTC-timestamp)
    inst: &Instellingen,
    vandaag: NaiveDate,
) -> Plek {
    match status {
        Status::Binnengekomen => Plek::Actie {
            soort: "verwerken",
            label: "Verwerken en tijd inschatten".into(),
            urgentieklasse: 2,
            dagen_over_drempel: 0,
            werkdagen_wachtend: 0,
        },
        Status::TijdInschatten => Plek::Actie {
            soort: "inschatten",
            label: "Uren inschatten en naar planning sturen".into(),
            urgentieklasse: 2,
            dagen_over_drempel: 0,
            werkdagen_wachtend: 0,
        },
        Status::BijPlanning => {
            let sinds = parse_datum(&ronde.datum_naar_planning);
            let w = sinds.map_or(0, |d| werkdagen_sinds(d, vandaag));
            let drempel = inst.werkdagen_planning_herinnering;
            if w >= drempel {
                Plek::Actie {
                    soort: "planning_herinneren",
                    label: format!("Planning herinneren — al {w} werkdagen geen reactie"),
                    urgentieklasse: 0,
                    dagen_over_drempel: i64::from(w) - i64::from(drempel),
                    werkdagen_wachtend: w,
                }
            } else {
                Plek::Wachtkamer {
                    wacht_op: "planning",
                    label: format!("Wacht op planning ({w} werkdagen)"),
                    sinds,
                    werkdagen: w,
                }
            }
        }
        // Klant informeren staat ALTIJD in de actielijst (de meest vergeten stap,
        // spec §6.4); na de herhaal-drempel schaalt hij op naar rood.
        Status::KlantInformeren => {
            let sinds = parse_datum(&ronde.datum_planning_antwoord);
            let w = sinds.map_or(0, |d| werkdagen_sinds(d, vandaag));
            let drempel = inst.werkdagen_klant_informeren_herhaal;
            if w >= drempel {
                Plek::Actie {
                    soort: "klant_informeren",
                    label: format!("Klant informeren — staat al {w} werkdagen open!"),
                    urgentieklasse: 0,
                    dagen_over_drempel: i64::from(w) - i64::from(drempel),
                    werkdagen_wachtend: w,
                }
            } else {
                Plek::Actie {
                    soort: "klant_informeren",
                    label: "Klant informeren over de ingeplande datum".into(),
                    urgentieklasse: 1,
                    dagen_over_drempel: 0,
                    werkdagen_wachtend: w,
                }
            }
        }
        Status::Ingepland => {
            let datum = parse_datum(&ronde.ingeplande_datum);
            match datum {
                Some(d) if d <= vandaag => Plek::Actie {
                    soort: "uitvoering_starten",
                    label: format!("Uitvoeringsdatum ({d}) bereikt — is de uitvoering gestart?"),
                    urgentieklasse: 2,
                    dagen_over_drempel: (vandaag - d).num_days(),
                    werkdagen_wachtend: werkdagen_sinds(d, vandaag),
                },
                _ => Plek::Wachtkamer {
                    wacht_op: "uitvoeringsdatum",
                    label: match datum {
                        Some(d) => format!("Ingepland op {d}"),
                        None => "Ingepland (datum onbekend)".into(),
                    },
                    sinds: parse_datum(&ronde.datum_klant_geinformeerd),
                    werkdagen: 0,
                },
            }
        }
        Status::InUitvoering => {
            let sinds = parse_datum(&ronde.datum_uitvoering_start);
            let w = sinds.map_or(0, |d| werkdagen_sinds(d, vandaag));
            let drempel = inst.werkdagen_op_schema_check;
            if w >= drempel {
                // §6.5: na de drempel actief seinen "staat dit nog op schema?"
                Plek::Actie {
                    soort: "op_schema_check",
                    label: format!("Al {w} werkdagen in uitvoering — loopt het nog op schema?"),
                    urgentieklasse: 1,
                    dagen_over_drempel: i64::from(w) - i64::from(drempel),
                    werkdagen_wachtend: w,
                }
            } else {
                Plek::Wachtkamer {
                    wacht_op: "uitvoering",
                    label: format!("In uitvoering ({w} werkdagen)"),
                    sinds,
                    werkdagen: w,
                }
            }
        }
        Status::FeedbackControle => Plek::Actie {
            soort: "feedback_vragen",
            label: "Klant om akkoord of feedback vragen".into(),
            urgentieklasse: 1,
            dagen_over_drempel: 0,
            werkdagen_wachtend: 0,
        },
        Status::Afgerond => match afgerond_op_datum {
            Some(d) => {
                let resterend = inst.dagen_heropenbaar - (vandaag - d).num_days();
                if resterend > 0 {
                    Plek::Heropenbaar {
                        dagen_resterend: resterend,
                    }
                } else {
                    Plek::Rust // wordt door archiveer_verlopen() gearchiveerd
                }
            }
            None => Plek::Rust,
        },
        Status::Geannuleerd => Plek::Rust,
    }
}

/// Sorteersleutel voor de actielijst: eerst urgentieklasse (0 = rood bovenaan),
/// dan het langst over de drempel, dan de oudste aanvraag.
pub fn sorteersleutel(
    urgentieklasse: u8,
    dagen_over_drempel: i64,
    datum_binnen: &str,
) -> (u8, i64, String) {
    (urgentieklasse, -dagen_over_drempel, datum_binnen.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn ronde() -> Ronde {
        Ronde {
            id: 1,
            aanvraag_id: 1,
            rondenummer: 1,
            geschatte_uren: None,
            datum_naar_planning: None,
            datum_planning_antwoord: None,
            ingeplande_datum: None,
            datum_klant_geinformeerd: None,
            datum_uitvoering_start: None,
            uitvoerder: None,
            feedback_tekst: None,
            afgerond_op: None,
            werkelijke_uren: None,
        }
    }

    fn inst() -> Instellingen {
        Instellingen::default() // 3 / 1 / 14
    }

    #[test]
    fn binnengekomen_is_gewone_actie() {
        let p = bepaal_plek(Status::Binnengekomen, &ronde(), None, &inst(), d("2026-07-08"));
        assert!(matches!(p, Plek::Actie { urgentieklasse: 2, .. }));
    }

    #[test]
    fn bij_planning_binnen_drempel_wacht() {
        let mut r = ronde();
        r.datum_naar_planning = Some("2026-07-06".into()); // ma
        // wo = 2 werkdagen verstreken, drempel 3 → wachtkamer
        let p = bepaal_plek(Status::BijPlanning, &r, None, &inst(), d("2026-07-08"));
        assert!(matches!(p, Plek::Wachtkamer { wacht_op: "planning", werkdagen: 2, .. }));
    }

    #[test]
    fn bij_planning_over_drempel_wordt_rode_actie() {
        let mut r = ronde();
        r.datum_naar_planning = Some("2026-07-06".into()); // ma
        // do = 3 werkdagen verstreken → herinnering (rood)
        let p = bepaal_plek(Status::BijPlanning, &r, None, &inst(), d("2026-07-09"));
        match p {
            Plek::Actie { soort, urgentieklasse, dagen_over_drempel, .. } => {
                assert_eq!(soort, "planning_herinneren");
                assert_eq!(urgentieklasse, 0);
                assert_eq!(dagen_over_drempel, 0);
            }
            _ => panic!("verwachtte actie, kreeg {p:?}"),
        }
    }

    #[test]
    fn weekend_stelt_planning_herinnering_uit() {
        let mut r = ronde();
        r.datum_naar_planning = Some("2026-07-09".into()); // do
        // do → zo: 1 werkdag (vr) → nog wachtkamer, ondanks 3 kalenderdagen
        let p = bepaal_plek(Status::BijPlanning, &r, None, &inst(), d("2026-07-12"));
        assert!(matches!(p, Plek::Wachtkamer { .. }));
        // do → di erop: vr + ma + di = 3 werkdagen → herinnering
        let p = bepaal_plek(Status::BijPlanning, &r, None, &inst(), d("2026-07-14"));
        assert!(matches!(p, Plek::Actie { urgentieklasse: 0, .. }));
    }

    #[test]
    fn klant_informeren_staat_altijd_in_actielijst() {
        let mut r = ronde();
        r.datum_planning_antwoord = Some("2026-07-08".into());
        let p = bepaal_plek(Status::KlantInformeren, &r, None, &inst(), d("2026-07-08"));
        assert!(matches!(p, Plek::Actie { soort: "klant_informeren", urgentieklasse: 1, .. }));
    }

    #[test]
    fn klant_informeren_escaleert_na_een_werkdag() {
        let mut r = ronde();
        r.datum_planning_antwoord = Some("2026-07-08".into()); // wo
        let p = bepaal_plek(Status::KlantInformeren, &r, None, &inst(), d("2026-07-09"));
        assert!(matches!(p, Plek::Actie { urgentieklasse: 0, .. }));
    }

    #[test]
    fn ingepland_wacht_tot_de_datum_en_activeert_daarna() {
        let mut r = ronde();
        r.ingeplande_datum = Some("2026-07-10".into());
        let wacht = bepaal_plek(Status::Ingepland, &r, None, &inst(), d("2026-07-08"));
        assert!(matches!(wacht, Plek::Wachtkamer { wacht_op: "uitvoeringsdatum", .. }));
        let actief = bepaal_plek(Status::Ingepland, &r, None, &inst(), d("2026-07-10"));
        assert!(matches!(actief, Plek::Actie { soort: "uitvoering_starten", .. }));
    }

    #[test]
    fn in_uitvoering_wacht_binnen_drempel() {
        let mut r = ronde();
        r.datum_uitvoering_start = Some("2026-07-06".into()); // ma
        // wo = 2 werkdagen, drempel 3 → wachtkamer
        let p = bepaal_plek(Status::InUitvoering, &r, None, &inst(), d("2026-07-08"));
        assert!(matches!(p, Plek::Wachtkamer { wacht_op: "uitvoering", werkdagen: 2, .. }));
    }

    #[test]
    fn in_uitvoering_over_drempel_vraagt_op_schema_check() {
        let mut r = ronde();
        r.datum_uitvoering_start = Some("2026-07-06".into()); // ma
        // do = 3 werkdagen → op-schema-check (oranje)
        let p = bepaal_plek(Status::InUitvoering, &r, None, &inst(), d("2026-07-09"));
        match p {
            Plek::Actie { soort, urgentieklasse, dagen_over_drempel, .. } => {
                assert_eq!(soort, "op_schema_check");
                assert_eq!(urgentieklasse, 1);
                assert_eq!(dagen_over_drempel, 0);
            }
            _ => panic!("verwachtte actie, kreeg {p:?}"),
        }
    }

    #[test]
    fn feedback_controle_is_oranje_actie() {
        let p = bepaal_plek(Status::FeedbackControle, &ronde(), None, &inst(), d("2026-07-08"));
        assert!(matches!(p, Plek::Actie { soort: "feedback_vragen", urgentieklasse: 1, .. }));
    }

    #[test]
    fn afgerond_is_heropenbaar_binnen_14_dagen() {
        let p = bepaal_plek(Status::Afgerond, &ronde(), Some(d("2026-07-01")), &inst(), d("2026-07-08"));
        assert!(matches!(p, Plek::Heropenbaar { dagen_resterend: 7 }));
        let p = bepaal_plek(Status::Afgerond, &ronde(), Some(d("2026-06-01")), &inst(), d("2026-07-08"));
        assert!(matches!(p, Plek::Rust));
    }

    #[test]
    fn sortering_rood_boven_oranje_boven_gewoon() {
        let mut sleutels = vec![
            sorteersleutel(2, 0, "2026-07-01"),
            sorteersleutel(0, 2, "2026-07-05"),
            sorteersleutel(1, 0, "2026-07-03"),
            sorteersleutel(0, 5, "2026-07-06"),
        ];
        sleutels.sort();
        assert_eq!(sleutels[0].0, 0);
        assert_eq!(sleutels[0].1, -5); // langst over drempel eerst
        assert_eq!(sleutels[3].0, 2);
    }
}
