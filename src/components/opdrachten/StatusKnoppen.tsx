import { useState } from "react";

import { useApp } from "../../lib/ctx";
import type { TextKey } from "../../lib/i18n";
import { opdrachtenApi } from "../../lib/opdrachten-api";
import type {
  KaartDetail,
  OpdrachtStatus,
  StatusPayload,
} from "../../lib/opdrachten-types";

type ExtraVeld = "datum" | "feedback" | undefined;

interface Overgang {
  doel: OpdrachtStatus;
  labelKey: TextKey;
  veld?: ExtraVeld;
  primair?: boolean;
}

/** TS-spiegel van de toegestane overgangen (opdrachten/domein/status.rs). */
const OVERGANGEN: Record<OpdrachtStatus, Overgang[]> = {
  binnengekomen: [{ doel: "tijd_inschatten", labelKey: "opdrOvergangBehandelen", primair: true }],
  tijd_inschatten: [{ doel: "bij_planning", labelKey: "opdrOvergangNaarPlanning", primair: true }],
  bij_planning: [
    { doel: "klant_informeren", labelKey: "opdrOvergangDatumTerug", veld: "datum", primair: true },
  ],
  klant_informeren: [{ doel: "ingepland", labelKey: "opdrOvergangKlantGeinformeerd", primair: true }],
  ingepland: [{ doel: "in_uitvoering", labelKey: "opdrOvergangUitvoeringGestart", primair: true }],
  in_uitvoering: [{ doel: "feedback_controle", labelKey: "opdrOvergangKlaar", primair: true }],
  feedback_controle: [
    { doel: "afgerond", labelKey: "opdrOvergangAkkoord", primair: true },
    { doel: "tijd_inschatten", labelKey: "opdrOvergangFeedbackRonde", veld: "feedback" },
  ],
  afgerond: [{ doel: "tijd_inschatten", labelKey: "opdrOvergangHeropenen" }],
  geannuleerd: [],
};

interface Props {
  detail: KaartDetail;
  onGewijzigd: (detail: KaartDetail) => void;
  /** Na definitief verwijderen: paneel sluiten + lijsten verversen. */
  onVerwijderd: () => void;
}

export default function StatusKnoppen({ detail, onGewijzigd, onVerwijderd }: Props) {
  const { t, confirm, notify } = useApp();
  const { aanvraag } = detail;
  const [openVeld, setOpenVeld] = useState<null | { doel: OpdrachtStatus; veld: "datum" | "feedback" | "reden" }>(null);
  const [waarde, setWaarde] = useState("");
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  const overgangen = OVERGANGEN[aanvraag.status];
  const kanAnnuleren = aanvraag.status !== "geannuleerd";
  const kanTerug = !["binnengekomen", "geannuleerd"].includes(aanvraag.status);

  async function voerUit(doel: OpdrachtStatus, payload?: StatusPayload) {
    setFout(null);
    setBezig(true);
    try {
      const nieuw = await opdrachtenApi.wijzigStatus(aanvraag.id, doel, payload);
      setOpenVeld(null);
      setWaarde("");
      onGewijzigd(nieuw);
    } catch (e) {
      setFout(String(e));
    } finally {
      setBezig(false);
    }
  }

  async function terug() {
    setFout(null);
    setBezig(true);
    try {
      onGewijzigd(await opdrachtenApi.stapTerug(aanvraag.id));
    } catch (e) {
      setFout(String(e));
    } finally {
      setBezig(false);
    }
  }

  function klik(o: Overgang) {
    if (o.veld) {
      setOpenVeld({ doel: o.doel, veld: o.veld });
      setWaarde("");
      setFout(null);
    } else {
      void voerUit(o.doel);
    }
  }

  function bevestig() {
    if (!openVeld) return;
    const payload: StatusPayload =
      openVeld.veld === "datum"
        ? { ingeplande_datum: waarde }
        : openVeld.veld === "feedback"
          ? { feedback_tekst: waarde }
          : { reden: waarde };
    void voerUit(openVeld.doel, payload);
  }

  return (
    <div className="opdr-statusknoppen">
      <div className="opdr-knoppenrij">
        {overgangen.map((o) => (
          <button
            key={o.doel + o.labelKey}
            className={o.primair ? "btn primary" : "btn"}
            onClick={() => klik(o)}
            disabled={bezig}
          >
            {t(o.labelKey)}
          </button>
        ))}
        {kanTerug && (
          <button className="btn ghost" title={t("opdrStapTerugTip")} onClick={() => void terug()} disabled={bezig}>
            {t("opdrStapTerug")}
          </button>
        )}
        {kanAnnuleren && (
          <button
            className="btn danger"
            onClick={() => {
              setOpenVeld({ doel: "geannuleerd", veld: "reden" });
              setWaarde("");
              setFout(null);
            }}
          >
            {t("opdrAnnulerenKnop")}
          </button>
        )}
        <button
          className="btn danger"
          onClick={async () => {
            if (!(await confirm(t("opdrVerwijderBevestig")))) return;
            setBezig(true);
            try {
              await opdrachtenApi.verwijderAanvragen([aanvraag.id]);
              notify(t("opdrVerwijderd"));
              onVerwijderd();
            } catch (e) {
              setFout(String(e));
            } finally {
              setBezig(false);
            }
          }}
          disabled={bezig}
        >
          {t("opdrVerwijderen")}
        </button>
      </div>

      {openVeld && (
        <div className="opdr-extra-veld">
          {openVeld.veld === "datum" ? (
            <>
              <label>{t("opdrIngeplandeDatum")}</label>
              <input
                type="date"
                value={waarde}
                autoFocus
                onChange={(e) => setWaarde(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && bevestig()}
              />
            </>
          ) : (
            <>
              <label>{openVeld.veld === "feedback" ? t("opdrFeedbackVraag") : t("opdrRedenAnnuleren")}</label>
              <input
                type="text"
                value={waarde}
                autoFocus
                placeholder={openVeld.veld === "feedback" ? t("opdrFeedbackPlaceholder") : t("opdrRedenPlaceholder")}
                onChange={(e) => setWaarde(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && bevestig()}
              />
            </>
          )}
          <button className="btn primary" onClick={bevestig} disabled={bezig}>
            {t("opdrBevestigen")}
          </button>
          <button className="btn ghost" onClick={() => setOpenVeld(null)}>
            {t("opdrAnnuleer")}
          </button>
        </div>
      )}

      {fout && <p className="opdr-fout">{fout}</p>}
    </div>
  );
}
