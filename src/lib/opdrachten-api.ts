// Invoke-wrappers van de opdrachten-module (zelfde patroon als lib/api.ts).
// Let op: Tauri verwacht command-argumenten in camelCase.
// Deze module verstuurt NOOIT e-mail — alleen data lezen/schrijven in de
// eigen opdrachten-database.
import { invoke } from "@tauri-apps/api/core";

import type {
  Aanvraag,
  AanvraagUpdate,
  Actielijst,
  KaartDetail,
  OpdrachtInstellingen,
  OpdrachtStatus,
  RondeUpdate,
  Statistiek,
  StatusPayload,
  WachtKaart,
} from "./opdrachten-types";

export const opdrachtenApi = {
  snelVastleggen: (klantNaam: string, omschrijving: string) =>
    invoke<KaartDetail>("snel_vastleggen", { klantNaam, omschrijving }),

  /** Kaart aanmaken vanuit een geopende e-mail (leest alleen; verstuurt niets). */
  opdrachtVanMail: (klantNaam: string, klantEmail: string, omschrijving: string) =>
    invoke<KaartDetail>("opdracht_van_mail", { klantNaam, klantEmail, omschrijving }),

  updateAanvraag: (id: number, velden: AanvraagUpdate) =>
    invoke<KaartDetail>("update_aanvraag", { id, velden }),

  updateRonde: (aanvraagId: number, velden: RondeUpdate) =>
    invoke<KaartDetail>("update_ronde", { aanvraagId, velden }),

  wijzigStatus: (aanvraagId: number, doel: OpdrachtStatus, payload?: StatusPayload) =>
    invoke<KaartDetail>("wijzig_status", { aanvraagId, doel, payload }),

  stapTerug: (aanvraagId: number) =>
    invoke<KaartDetail>("stap_terug", { aanvraagId }),

  planningHerinnerd: (aanvraagId: number) =>
    invoke<KaartDetail>("planning_herinnerd", { aanvraagId }),

  getActielijst: () => invoke<Actielijst>("get_actielijst"),
  getWachtkamer: () => invoke<WachtKaart[]>("get_wachtkamer"),
  getKaarten: () => invoke<Aanvraag[]>("get_kaarten"),
  getKaartDetail: (id: number) => invoke<KaartDetail>("get_kaart_detail", { id }),

  voegNotitieToe: (id: number, tekst: string) =>
    invoke<KaartDetail>("voeg_notitie_toe", { id, tekst }),

  getInstellingen: () => invoke<OpdrachtInstellingen>("get_opdracht_instellingen"),
  zetInstelling: (sleutel: string, waarde: string) =>
    invoke<OpdrachtInstellingen>("zet_opdracht_instelling", { sleutel, waarde }),

  getStatistiek: () => invoke<Statistiek>("get_statistiek"),

  seedDemo: () => invoke<void>("seed_opdrachten_demo"),
};
