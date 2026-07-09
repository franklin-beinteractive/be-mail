// Mailteksten voor de opdrachten-module - ALLEEN klaarzetten om te kopiëren.
// Bewust géén mailto, géén koppeling met ComposeDialog en géén send-commands:
// versturen gebeurt altijd handmatig (tekst kopiëren → zelf in een reply plakken).
// De teksten zelf zijn bewerkbaar in Instellingen → Opdrachten ({merge-tags}).
import type { OpdrachtMailSjabloon } from "./settings";
import type { KaartDetail } from "./opdrachten-types";
import { formatteerDatum } from "./opdrachten-types";

export interface MailTekst {
  soort: "planning" | "klant";
  titel: string;
  onderwerp: string;
  tekst: string;
}

export interface MailSjablonen {
  planning: OpdrachtMailSjabloon;
  klant: OpdrachtMailSjabloon;
}

/** Merge-tags die in beide sjablonen beschikbaar zijn (getoond in Instellingen). */
export const OPDR_MERGE_TAGS = [
  "klant",
  "naam",
  "bedrijf",
  "omschrijving",
  "uren",
  "ronde",
  "datum",
  "planner",
  "uitvoerder",
] as const;

/** Waarden voor alle merge-tags, afgeleid van de kaart + huidige ronde. */
function tagWaarden(detail: KaartDetail): Record<string, string> {
  const { aanvraag, rondes } = detail;
  const ronde = rondes.find((r) => r.rondenummer === aanvraag.huidige_ronde);
  const klant = aanvraag.klant_bedrijf
    ? `${aanvraag.klant_naam} (${aanvraag.klant_bedrijf})`
    : aanvraag.klant_naam;
  return {
    klant,
    naam: aanvraag.klant_naam,
    bedrijf: aanvraag.klant_bedrijf ?? "",
    omschrijving: aanvraag.omschrijving?.trim() || "opdracht",
    uren: ronde?.geschatte_uren != null ? `${ronde.geschatte_uren} uur` : "nog in te schatten",
    ronde: aanvraag.huidige_ronde > 1 ? ` (correctie, ronde ${aanvraag.huidige_ronde})` : "",
    datum: ronde?.ingeplande_datum ? formatteerDatum(ronde.ingeplande_datum) : "(datum volgt)",
    planner: ronde?.planner?.trim() || "planning",
    uitvoerder: ronde?.uitvoerder ?? "",
  };
}

function vulTags(sjabloon: string, waarden: Record<string, string>): string {
  return sjabloon.replace(/\{(\w+)\}/g, (heel, tag: string) => waarden[tag] ?? heel);
}

function vulSjabloon(
  soort: MailTekst["soort"],
  titel: string,
  sjabloon: OpdrachtMailSjabloon,
  detail: KaartDetail,
): MailTekst {
  const waarden = tagWaarden(detail);
  return {
    soort,
    titel,
    onderwerp: vulTags(sjabloon.onderwerp, waarden),
    // Windows-regeleindes zodat plakken in Outlook/mailclients goed gaat.
    tekst: vulTags(sjabloon.tekst, waarden).replace(/\r?\n/g, "\r\n"),
  };
}

/** "Naar planning": zichtbaar bij Tijd inschatten / Bij planning. */
export function tekstNaarPlanning(detail: KaartDetail, sjabloon: OpdrachtMailSjabloon): MailTekst {
  return vulSjabloon("planning", "Naar planning", sjabloon, detail);
}

/** "Naar klant": zichtbaar bij Klant informeren / Ingepland. */
export function tekstNaarKlant(detail: KaartDetail, sjabloon: OpdrachtMailSjabloon): MailTekst {
  return vulSjabloon("klant", "Naar klant", sjabloon, detail);
}

/** Welke teksten zijn relevant voor de huidige status? */
export function mailTekstenVoor(detail: KaartDetail, sjablonen: MailSjablonen): MailTekst[] {
  switch (detail.aanvraag.status) {
    case "tijd_inschatten":
    case "bij_planning":
      return [tekstNaarPlanning(detail, sjablonen.planning)];
    case "klant_informeren":
    case "ingepland":
      return [tekstNaarKlant(detail, sjablonen.klant)];
    default:
      return [];
  }
}
