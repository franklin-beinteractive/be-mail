// Mailteksten voor de opdrachten-module — ALLEEN klaarzetten om te kopiëren.
// Bewust géén mailto, géén koppeling met ComposeDialog en géén send-commands:
// versturen gebeurt altijd handmatig (tekst kopiëren → zelf in een reply plakken).
import type { KaartDetail } from "./opdrachten-types";
import { formatteerDatum } from "./opdrachten-types";

export interface MailTekst {
  soort: "planning" | "klant";
  titel: string;
  onderwerp: string;
  tekst: string;
}

/** "Naar planning": zichtbaar bij Tijd inschatten / Bij planning. */
export function tekstNaarPlanning(detail: KaartDetail): MailTekst {
  const { aanvraag, rondes } = detail;
  const ronde = rondes.find((r) => r.rondenummer === aanvraag.huidige_ronde);
  const klant = aanvraag.klant_bedrijf
    ? `${aanvraag.klant_naam} (${aanvraag.klant_bedrijf})`
    : aanvraag.klant_naam;
  const uren = ronde?.geschatte_uren != null ? `${ronde.geschatte_uren} uur` : "nog in te schatten";
  const rondeTekst = aanvraag.huidige_ronde > 1 ? ` (correctie, ronde ${aanvraag.huidige_ronde})` : "";
  return {
    soort: "planning",
    titel: "Naar planning",
    onderwerp: `Inplannen: ${klant} — ${aanvraag.omschrijving ?? "opdracht"}${rondeTekst}`,
    tekst: [
      "Hallo planning,",
      "",
      "Graag de volgende opdracht inplannen:",
      `- Klant: ${klant}`,
      `- Opdracht: ${aanvraag.omschrijving ?? "—"}${rondeTekst}`,
      `- Geschatte tijd: ${uren}`,
      "",
      "Horen jullie wanneer dit past?",
      "",
      "Groet",
    ].join("\r\n"),
  };
}

/** "Naar klant": zichtbaar bij Klant informeren / Ingepland. */
export function tekstNaarKlant(detail: KaartDetail): MailTekst {
  const { aanvraag, rondes } = detail;
  const ronde = rondes.find((r) => r.rondenummer === aanvraag.huidige_ronde);
  const datum = ronde?.ingeplande_datum ? formatteerDatum(ronde.ingeplande_datum) : "(datum volgt)";
  return {
    soort: "klant",
    titel: "Naar klant",
    onderwerp: `Uw opdracht is ingepland op ${datum}`,
    tekst: [
      `Beste ${aanvraag.klant_naam},`,
      "",
      `Goed nieuws: uw opdracht${aanvraag.omschrijving ? ` "${aanvraag.omschrijving}"` : ""} wordt opgepakt op ${datum}.`,
      "",
      "Heeft u vragen, dan horen we het graag.",
      "",
      "Met vriendelijke groet",
    ].join("\r\n"),
  };
}

/** Welke teksten zijn relevant voor de huidige status? */
export function mailTekstenVoor(detail: KaartDetail): MailTekst[] {
  switch (detail.aanvraag.status) {
    case "tijd_inschatten":
    case "bij_planning":
      return [tekstNaarPlanning(detail)];
    case "klant_informeren":
    case "ingepland":
      return [tekstNaarKlant(detail)];
    default:
      return [];
  }
}
