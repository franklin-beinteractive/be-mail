// Vertaalde weergave-labels voor de opdrachten-module. De Rust-kern levert
// alleen soorten en getallen; de zinnen worden hier per taal opgebouwd.
import type { TextKey } from "./i18n";
import type { ActieKaart, OpdrachtStatus, WachtKaart } from "./opdrachten-types";
import { formatteerDatum } from "./opdrachten-types";

type T = (key: TextKey) => string;

/** Simpele {x}-placeholders invullen. */
export function vul(sjabloon: string, waarden: Record<string, string | number>): string {
  return Object.entries(waarden).reduce(
    (s, [k, v]) => s.split(`{${k}}`).join(String(v)),
    sjabloon,
  );
}

const STATUS_KEY: Record<OpdrachtStatus, TextKey> = {
  binnengekomen: "opdrStatusBinnengekomen",
  tijd_inschatten: "opdrStatusTijdInschatten",
  bij_planning: "opdrStatusBijPlanning",
  klant_informeren: "opdrStatusKlantInformeren",
  ingepland: "opdrStatusIngepland",
  in_uitvoering: "opdrStatusInUitvoering",
  feedback_controle: "opdrStatusFeedback",
  afgerond: "opdrStatusAfgerond",
  geannuleerd: "opdrStatusGeannuleerd",
};

export function statusNaam(t: T, status: OpdrachtStatus): string {
  return t(STATUS_KEY[status]);
}

export function actieLabel(t: T, k: ActieKaart): string {
  const n = k.werkdagen_wachtend;
  switch (k.actie_soort) {
    case "verwerken":
      return t("opdrActieVerwerken");
    case "inschatten":
      return t("opdrActieInschatten");
    case "planning_herinneren":
      return vul(t("opdrActiePlanningHerinneren"), { n });
    case "klant_informeren":
      return k.urgentieklasse === 0
        ? vul(t("opdrActieKlantInformerenLaat"), { n })
        : t("opdrActieKlantInformeren");
    case "uitvoering_starten":
      return vul(t("opdrActieUitvoeringStarten"), {
        d: formatteerDatum(k.ronde.ingeplande_datum),
      });
    case "op_schema_check":
      return vul(t("opdrActieOpSchema"), { n });
    case "feedback_vragen":
      return t("opdrActieFeedback");
    default:
      return k.actie_label; // fallback: Rust-label (NL)
  }
}

export function wachtLabel(t: T, k: WachtKaart): string {
  switch (k.wacht_op) {
    case "planning":
      return vul(t("opdrWachtPlanning"), { n: k.werkdagen });
    case "uitvoeringsdatum":
      return vul(t("opdrWachtDatum"), { d: formatteerDatum(k.ronde.ingeplande_datum) });
    case "uitvoering":
      return vul(t("opdrWachtUitvoering"), { n: k.werkdagen });
    default:
      return k.wacht_label;
  }
}
