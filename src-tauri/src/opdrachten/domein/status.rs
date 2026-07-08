use crate::opdrachten::error::{AppError, AppResult};
use crate::opdrachten::models::{Status, StatusPayload};

/// Eén bron van waarheid: welke statusovergangen zijn toegestaan?
/// (Heropenen vanaf Afgerond kent bovendien een tijdslimiet; die wordt in
/// `commands::wijzig_status` gecontroleerd omdat daar de afronddatum bekend is.)
pub fn overgang_toegestaan(van: Status, naar: Status) -> bool {
    use Status::*;
    match (van, naar) {
        // Hoofdflow
        (Binnengekomen, TijdInschatten) => true,
        (TijdInschatten, BijPlanning) => true,
        (BijPlanning, KlantInformeren) => true, // planning geeft datum terug
        (KlantInformeren, Ingepland) => true,   // gebruiker vinkt "klant geïnformeerd" af
        (Ingepland, InUitvoering) => true,
        (InUitvoering, FeedbackControle) => true,
        (FeedbackControle, Afgerond) => true,
        // Feedback-lus en heropenen: terug naar Tijd inschatten (nieuwe ronde)
        (FeedbackControle, TijdInschatten) => true,
        (Afgerond, TijdInschatten) => true,
        // Annuleren kan vanuit elke status behalve Geannuleerd zelf
        (Geannuleerd, _) => false,
        (_, Geannuleerd) => true,
        _ => false,
    }
}

/// De "stap terug" voor misklik-correcties: één stap terug in de hoofdflow.
pub fn vorige_status(huidige: Status) -> Option<Status> {
    use Status::*;
    match huidige {
        TijdInschatten => Some(Binnengekomen),
        BijPlanning => Some(TijdInschatten),
        KlantInformeren => Some(BijPlanning),
        Ingepland => Some(KlantInformeren),
        InUitvoering => Some(Ingepland),
        FeedbackControle => Some(InUitvoering),
        Afgerond => Some(FeedbackControle),
        Binnengekomen | Geannuleerd => None,
    }
}

/// Valideert dat de payload de context bevat die deze overgang vereist.
pub fn valideer_payload(van: Status, naar: Status, payload: &StatusPayload) -> AppResult<()> {
    use Status::*;
    match (van, naar) {
        (BijPlanning, KlantInformeren) => {
            let datum = payload
                .ingeplande_datum
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| {
                    AppError::Validatie(
                        "Vul de ingeplande datum in die de planning heeft teruggegeven".into(),
                    )
                })?;
            chrono::NaiveDate::parse_from_str(datum, "%Y-%m-%d").map_err(|_| {
                AppError::Validatie(format!("'{datum}' is geen geldige datum (JJJJ-MM-DD)"))
            })?;
            Ok(())
        }
        (FeedbackControle, TijdInschatten) => {
            if payload
                .feedback_tekst
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .is_none()
            {
                return Err(AppError::Validatie(
                    "Noteer kort wat de klant terugkoppelde".into(),
                ));
            }
            Ok(())
        }
        (_, Geannuleerd) => {
            if payload
                .reden
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .is_none()
            {
                return Err(AppError::Validatie(
                    "Geef een reden op voor het annuleren".into(),
                ));
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

/// Controleert overgang + payload in één keer.
pub fn valideer_overgang(van: Status, naar: Status, payload: &StatusPayload) -> AppResult<()> {
    if !overgang_toegestaan(van, naar) {
        return Err(AppError::OngeldigeOvergang {
            van: van.naam().into(),
            naar: naar.naam().into(),
        });
    }
    valideer_payload(van, naar, payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use Status::*;

    const ALLE: [Status; 9] = [
        Binnengekomen,
        TijdInschatten,
        BijPlanning,
        KlantInformeren,
        Ingepland,
        InUitvoering,
        FeedbackControle,
        Afgerond,
        Geannuleerd,
    ];

    #[test]
    fn hoofdflow_is_toegestaan() {
        let flow = [
            Binnengekomen,
            TijdInschatten,
            BijPlanning,
            KlantInformeren,
            Ingepland,
            InUitvoering,
            FeedbackControle,
            Afgerond,
        ];
        for paar in flow.windows(2) {
            assert!(
                overgang_toegestaan(paar[0], paar[1]),
                "{:?} → {:?} zou moeten mogen",
                paar[0],
                paar[1]
            );
        }
    }

    #[test]
    fn stappen_overslaan_mag_niet() {
        assert!(!overgang_toegestaan(Binnengekomen, BijPlanning));
        assert!(!overgang_toegestaan(TijdInschatten, KlantInformeren));
        assert!(!overgang_toegestaan(BijPlanning, Afgerond));
        assert!(!overgang_toegestaan(Binnengekomen, Afgerond));
    }

    #[test]
    fn feedback_lus_en_heropenen() {
        assert!(overgang_toegestaan(FeedbackControle, TijdInschatten));
        assert!(overgang_toegestaan(Afgerond, TijdInschatten));
        assert!(!overgang_toegestaan(Afgerond, Binnengekomen));
        assert!(!overgang_toegestaan(InUitvoering, TijdInschatten));
    }

    #[test]
    fn annuleren_kan_overal_behalve_vanuit_geannuleerd() {
        for s in ALLE {
            if s == Geannuleerd {
                assert!(!overgang_toegestaan(s, Geannuleerd));
            } else {
                assert!(overgang_toegestaan(s, Geannuleerd), "{s:?} → Geannuleerd");
            }
        }
        for s in ALLE {
            assert!(!overgang_toegestaan(Geannuleerd, s), "Geannuleerd → {s:?}");
        }
    }

    #[test]
    fn planning_antwoord_vereist_geldige_datum() {
        let leeg = StatusPayload::default();
        assert!(valideer_overgang(BijPlanning, KlantInformeren, &leeg).is_err());

        let fout = StatusPayload {
            ingeplande_datum: Some("15-07-2026".into()),
            ..Default::default()
        };
        assert!(valideer_overgang(BijPlanning, KlantInformeren, &fout).is_err());

        let goed = StatusPayload {
            ingeplande_datum: Some("2026-07-15".into()),
            ..Default::default()
        };
        assert!(valideer_overgang(BijPlanning, KlantInformeren, &goed).is_ok());
    }

    #[test]
    fn feedback_vereist_tekst() {
        let leeg = StatusPayload::default();
        assert!(valideer_overgang(FeedbackControle, TijdInschatten, &leeg).is_err());

        let goed = StatusPayload {
            feedback_tekst: Some("Kleur klopt niet".into()),
            ..Default::default()
        };
        assert!(valideer_overgang(FeedbackControle, TijdInschatten, &goed).is_ok());
    }

    #[test]
    fn annuleren_vereist_reden() {
        let leeg = StatusPayload::default();
        assert!(valideer_overgang(BijPlanning, Geannuleerd, &leeg).is_err());

        let goed = StatusPayload {
            reden: Some("Klant haakt af".into()),
            ..Default::default()
        };
        assert!(valideer_overgang(BijPlanning, Geannuleerd, &goed).is_ok());
    }

    #[test]
    fn stap_terug_volgt_hoofdflow() {
        assert_eq!(vorige_status(BijPlanning), Some(TijdInschatten));
        assert_eq!(vorige_status(Ingepland), Some(KlantInformeren));
        assert_eq!(vorige_status(Afgerond), Some(FeedbackControle));
        assert_eq!(vorige_status(Binnengekomen), None);
        assert_eq!(vorige_status(Geannuleerd), None);
    }
}
