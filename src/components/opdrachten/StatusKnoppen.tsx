import { useState } from "react";

import { opdrachtenApi } from "../../lib/opdrachten-api";
import type {
  KaartDetail,
  OpdrachtStatus,
  StatusPayload,
} from "../../lib/opdrachten-types";

type ExtraVeld = "datum" | "feedback" | undefined;

interface Overgang {
  doel: OpdrachtStatus;
  label: string;
  veld?: ExtraVeld;
  primair?: boolean;
}

/** TS-spiegel van de toegestane overgangen (opdrachten/domein/status.rs). */
const OVERGANGEN: Record<OpdrachtStatus, Overgang[]> = {
  binnengekomen: [{ doel: "tijd_inschatten", label: "In behandeling nemen", primair: true }],
  tijd_inschatten: [{ doel: "bij_planning", label: "Naar planning sturen", primair: true }],
  bij_planning: [
    { doel: "klant_informeren", label: "Planning gaf een datum terug…", veld: "datum", primair: true },
  ],
  klant_informeren: [{ doel: "ingepland", label: "✓ Klant geïnformeerd", primair: true }],
  ingepland: [{ doel: "in_uitvoering", label: "Uitvoering gestart", primair: true }],
  in_uitvoering: [{ doel: "feedback_controle", label: "Uitvoering klaar → controle", primair: true }],
  feedback_controle: [
    { doel: "afgerond", label: "✓ Klant akkoord — afronden", primair: true },
    { doel: "tijd_inschatten", label: "Feedback → nieuwe ronde", veld: "feedback" },
  ],
  afgerond: [{ doel: "tijd_inschatten", label: "Heropenen (nieuwe ronde)" }],
  geannuleerd: [],
};

interface Props {
  detail: KaartDetail;
  onGewijzigd: (detail: KaartDetail) => void;
}

export default function StatusKnoppen({ detail, onGewijzigd }: Props) {
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
            key={o.doel + o.label}
            className={o.primair ? "btn primary" : "btn"}
            onClick={() => klik(o)}
            disabled={bezig}
          >
            {o.label}
          </button>
        ))}
        {kanTerug && (
          <button className="btn ghost" title="Misklik? Eén stap terug in de flow" onClick={() => void terug()} disabled={bezig}>
            ↩ Stap terug
          </button>
        )}
        {kanAnnuleren && (
          <button
            className="btn ghost"
            style={{ color: "var(--danger)" }}
            onClick={() => {
              setOpenVeld({ doel: "geannuleerd", veld: "reden" });
              setWaarde("");
              setFout(null);
            }}
          >
            Annuleren…
          </button>
        )}
      </div>

      {openVeld && (
        <div className="opdr-extra-veld">
          {openVeld.veld === "datum" ? (
            <>
              <label>Ingeplande datum</label>
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
              <label>{openVeld.veld === "feedback" ? "Wat koppelde de klant terug?" : "Reden van annuleren"}</label>
              <input
                type="text"
                value={waarde}
                autoFocus
                placeholder={openVeld.veld === "feedback" ? "bijv. kleur klopt niet" : "bijv. klant haakt af"}
                onChange={(e) => setWaarde(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && bevestig()}
              />
            </>
          )}
          <button className="btn primary" onClick={bevestig} disabled={bezig}>
            Bevestigen
          </button>
          <button className="btn ghost" onClick={() => setOpenVeld(null)}>
            Annuleer
          </button>
        </div>
      )}

      {fout && <p className="opdr-fout">{fout}</p>}
    </div>
  );
}
