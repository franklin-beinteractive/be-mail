use serde::{Deserialize, Serialize};

/// De negen statussen die een kaart kan hebben (zie spec §4).
/// Volgorde van de hoofdflow: Binnengekomen → TijdInschatten → BijPlanning →
/// KlantInformeren → Ingepland → InUitvoering → FeedbackControle → Afgerond.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Binnengekomen,
    TijdInschatten,
    BijPlanning,
    KlantInformeren,
    Ingepland,
    InUitvoering,
    FeedbackControle,
    Afgerond,
    Geannuleerd,
}

impl Status {
    pub fn als_str(&self) -> &'static str {
        match self {
            Status::Binnengekomen => "binnengekomen",
            Status::TijdInschatten => "tijd_inschatten",
            Status::BijPlanning => "bij_planning",
            Status::KlantInformeren => "klant_informeren",
            Status::Ingepland => "ingepland",
            Status::InUitvoering => "in_uitvoering",
            Status::FeedbackControle => "feedback_controle",
            Status::Afgerond => "afgerond",
            Status::Geannuleerd => "geannuleerd",
        }
    }

    pub fn uit_str(s: &str) -> Option<Status> {
        Some(match s {
            "binnengekomen" => Status::Binnengekomen,
            "tijd_inschatten" => Status::TijdInschatten,
            "bij_planning" => Status::BijPlanning,
            "klant_informeren" => Status::KlantInformeren,
            "ingepland" => Status::Ingepland,
            "in_uitvoering" => Status::InUitvoering,
            "feedback_controle" => Status::FeedbackControle,
            "afgerond" => Status::Afgerond,
            "geannuleerd" => Status::Geannuleerd,
            _ => return None,
        })
    }

    /// Nederlandse weergavenaam, o.a. voor logboekteksten.
    pub fn naam(&self) -> &'static str {
        match self {
            Status::Binnengekomen => "Binnengekomen",
            Status::TijdInschatten => "Tijd inschatten",
            Status::BijPlanning => "Bij planning",
            Status::KlantInformeren => "Klant informeren",
            Status::Ingepland => "Ingepland",
            Status::InUitvoering => "In uitvoering",
            Status::FeedbackControle => "Feedback & controle",
            Status::Afgerond => "Afgerond",
            Status::Geannuleerd => "Geannuleerd",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Aanvraag {
    pub id: i64,
    pub klant_naam: String,
    pub klant_bedrijf: Option<String>,
    pub klant_telefoon: Option<String>,
    pub klant_email: Option<String>,
    pub kanaal: Option<String>, // 'telefoon' | 'email'
    pub omschrijving: Option<String>,
    pub status: Status,
    pub huidige_ronde: i64,
    pub datum_binnen: String,   // lokale datum YYYY-MM-DD
    pub aangemaakt_op: String,  // UTC RFC3339
    pub bijgewerkt_op: String,  // UTC RFC3339
    pub gearchiveerd: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Ronde {
    pub id: i64,
    pub aanvraag_id: i64,
    pub rondenummer: i64,
    pub geschatte_uren: Option<f64>,
    pub datum_naar_planning: Option<String>,      // lokale datum
    pub datum_planning_antwoord: Option<String>,  // lokale datum (moment dat planning de datum teruggaf)
    pub ingeplande_datum: Option<String>,         // lokale datum, door planning teruggegeven
    pub datum_klant_geinformeerd: Option<String>, // lokale datum
    pub datum_uitvoering_start: Option<String>,   // lokale datum
    pub uitvoerder: Option<String>,
    /// Wie de opdracht inplant (naam; autoaanvullen uit Instellingen).
    pub planner: Option<String>,
    pub feedback_tekst: Option<String>,
    pub afgerond_op: Option<String>, // UTC RFC3339
    /// Werkelijk bestede uren (invulbaar vanaf In uitvoering) — voedt de
    /// statistiek "geschat versus werkelijk".
    pub werkelijke_uren: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogboekRegel {
    pub id: i64,
    pub aanvraag_id: i64,
    pub rondenummer: Option<i64>,
    pub tijdstip: String, // UTC RFC3339
    pub r#type: String,   // 'status_wijziging' | 'notitie' | 'herinnering'
    pub tekst: String,
}

/// Volledige kaart voor het detailpaneel.
#[derive(Debug, Clone, Serialize)]
pub struct KaartDetail {
    pub aanvraag: Aanvraag,
    pub rondes: Vec<Ronde>,
    pub logboek: Vec<LogboekRegel>,
}

/// Eén regel in de actielijst ("Wat moet ik nu doen?").
#[derive(Debug, Clone, Serialize)]
pub struct ActieKaart {
    pub aanvraag: Aanvraag,
    pub ronde: Ronde,
    pub actie_soort: String,
    pub actie_label: String,
    /// 0 = verlopen herinnering (rood), 1 = ⚠️-status (oranje), 2 = gewone actie.
    pub urgentieklasse: u8,
    pub werkdagen_wachtend: u32,
}

/// Eén regel in de wachtkamer (wacht op planning / datum / uitvoering).
#[derive(Debug, Clone, Serialize)]
pub struct WachtKaart {
    pub aanvraag: Aanvraag,
    pub ronde: Ronde,
    pub wacht_op: String, // 'planning' | 'uitvoeringsdatum' | 'uitvoering'
    pub wacht_label: String,
    pub sinds: Option<String>, // lokale datum
    pub werkdagen: u32,
}

/// Recent afgeronde kaart die nog heropend kan worden.
#[derive(Debug, Clone, Serialize)]
pub struct HeropenbareKaart {
    pub aanvraag: Aanvraag,
    pub dagen_resterend: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Actielijst {
    pub acties: Vec<ActieKaart>,
    pub heropenbaar: Vec<HeropenbareKaart>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Instellingen {
    pub werkdagen_planning_herinnering: u32,
    pub werkdagen_klant_informeren_herhaal: u32,
    pub dagen_heropenbaar: i64,
    pub werkdagen_op_schema_check: u32,
}

impl Default for Instellingen {
    fn default() -> Self {
        Instellingen {
            werkdagen_planning_herinnering: 3,
            werkdagen_klant_informeren_herhaal: 1,
            dagen_heropenbaar: 14,
            werkdagen_op_schema_check: 3,
        }
    }
}

/// Bewerkbare aanvraag-velden (contactgegevens e.d.).
#[derive(Debug, Clone, Deserialize)]
pub struct AanvraagUpdate {
    pub klant_naam: Option<String>,
    pub klant_bedrijf: Option<String>,
    pub klant_telefoon: Option<String>,
    pub klant_email: Option<String>,
    pub kanaal: Option<String>,
    pub omschrijving: Option<String>,
}

/// Bewerkbare ronde-velden.
#[derive(Debug, Clone, Deserialize)]
pub struct RondeUpdate {
    pub geschatte_uren: Option<f64>,
    pub uitvoerder: Option<String>,
    pub planner: Option<String>,
    pub werkelijke_uren: Option<f64>,
}

/// Context bij een statusovergang.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct StatusPayload {
    pub ingeplande_datum: Option<String>, // vereist bij BijPlanning → KlantInformeren
    pub reden: Option<String>,            // vereist bij → Geannuleerd
    pub feedback_tekst: Option<String>,   // vereist bij FeedbackControle → TijdInschatten
}
