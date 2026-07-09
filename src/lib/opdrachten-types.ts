// TS-spiegel van de Rust-modellen van de opdrachten-module
// (src-tauri/src/opdrachten/models.rs). Veldnamen zijn snake_case (serde).

export type OpdrachtStatus =
  | "binnengekomen"
  | "tijd_inschatten"
  | "bij_planning"
  | "klant_informeren"
  | "ingepland"
  | "in_uitvoering"
  | "feedback_controle"
  | "afgerond"
  | "geannuleerd";

export interface Aanvraag {
  id: number;
  klant_naam: string;
  klant_bedrijf: string | null;
  klant_telefoon: string | null;
  klant_email: string | null;
  kanaal: "telefoon" | "email" | null;
  omschrijving: string | null;
  status: OpdrachtStatus;
  huidige_ronde: number;
  datum_binnen: string;
  aangemaakt_op: string;
  bijgewerkt_op: string;
  gearchiveerd: boolean;
}

export interface Ronde {
  id: number;
  aanvraag_id: number;
  rondenummer: number;
  geschatte_uren: number | null;
  datum_naar_planning: string | null;
  datum_planning_antwoord: string | null;
  ingeplande_datum: string | null;
  datum_klant_geinformeerd: string | null;
  datum_uitvoering_start: string | null;
  uitvoerder: string | null;
  planner: string | null;
  feedback_tekst: string | null;
  afgerond_op: string | null;
  werkelijke_uren: number | null;
}

export interface LogboekRegel {
  id: number;
  aanvraag_id: number;
  rondenummer: number | null;
  tijdstip: string;
  type: "status_wijziging" | "notitie" | "herinnering";
  tekst: string;
}

export interface KaartDetail {
  aanvraag: Aanvraag;
  rondes: Ronde[];
  logboek: LogboekRegel[];
}

export interface ActieKaart {
  aanvraag: Aanvraag;
  ronde: Ronde;
  actie_soort: string;
  actie_label: string;
  urgentieklasse: 0 | 1 | 2;
  werkdagen_wachtend: number;
}

export interface WachtKaart {
  aanvraag: Aanvraag;
  ronde: Ronde;
  wacht_op: "planning" | "uitvoeringsdatum" | "uitvoering";
  wacht_label: string;
  sinds: string | null;
  werkdagen: number;
}

export interface HeropenbareKaart {
  aanvraag: Aanvraag;
  dagen_resterend: number;
}

export interface Actielijst {
  acties: ActieKaart[];
  heropenbaar: HeropenbareKaart[];
}

export interface OpdrachtInstellingen {
  werkdagen_planning_herinnering: number;
  werkdagen_klant_informeren_herhaal: number;
  dagen_heropenbaar: number;
  werkdagen_op_schema_check: number;
}

export interface StatusPayload {
  ingeplande_datum?: string;
  reden?: string;
  feedback_tekst?: string;
}

export interface AanvraagUpdate {
  klant_naam?: string;
  klant_bedrijf?: string;
  klant_telefoon?: string;
  klant_email?: string;
  kanaal?: string;
  omschrijving?: string;
}

export interface RondeUpdate {
  geschatte_uren?: number;
  uitvoerder?: string;
  planner?: string;
  werkelijke_uren?: number;
}

export interface WeekTelling {
  label: string;
  start: string;
  aantal: number;
}

export interface UrenKaart {
  klant: string;
  omschrijving: string;
  geschat: number;
  werkelijk: number;
}

export interface Statistiek {
  per_week: WeekTelling[];
  gem_doorlooptijd_planning: number | null;
  doorlooptijd_meetpunten: number;
  uren_kaarten: UrenKaart[];
  totaal_geschat: number;
  totaal_werkelijk: number;
  kaarten_1_ronde: number;
  kaarten_2_rondes: number;
  kaarten_3plus_rondes: number;
  open: number;
  afgerond: number;
  geannuleerd: number;
}

// ── Weergave-helpers ───────────────────────────────────────────────

export const STATUS_NAAM: Record<OpdrachtStatus, string> = {
  binnengekomen: "Binnengekomen",
  tijd_inschatten: "Tijd inschatten",
  bij_planning: "Bij planning",
  klant_informeren: "Klant informeren",
  ingepland: "Ingepland",
  in_uitvoering: "In uitvoering",
  feedback_controle: "Feedback & controle",
  afgerond: "Afgerond",
  geannuleerd: "Geannuleerd",
};

/** ⚠️-statussen waar de app de gebruiker actief port (oranje). */
export const WAARSCHUWING_STATUSSEN: OpdrachtStatus[] = [
  "bij_planning",
  "klant_informeren",
  "feedback_controle",
];

export function formatteerDatum(isoDatum: string | null): string {
  if (!isoDatum) return "—";
  // 'T00:00:00' erbij zodat de datum lokaal geparsed wordt (geen dag-ervoor-bug).
  return new Date(`${isoDatum}T00:00:00`).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatteerTijdstip(rfc3339: string): string {
  return new Date(rfc3339).toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
