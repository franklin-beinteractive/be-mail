import { useState } from "react";

import { opdrachtenApi } from "../../lib/opdrachten-api";
import type { KaartDetail as Detail, Ronde } from "../../lib/opdrachten-types";
import { formatteerDatum, formatteerTijdstip } from "../../lib/opdrachten-types";
import KopieerMail from "./KopieerMail";
import StatusBadge from "./StatusBadge";
import StatusKnoppen from "./StatusKnoppen";
import Tijdlijn from "./Tijdlijn";

function RondeBlok({ ronde, actief }: { ronde: Ronde; actief: boolean }) {
  return (
    <div className={`opdr-ronde-blok${actief ? " actief" : ""}`}>
      <div className="opdr-ronde-kop">
        Ronde {ronde.rondenummer}
        {actief && <span className="opdr-ronde-nu">huidig</span>}
      </div>
      <dl className="opdr-ronde-velden">
        <dt>Geschat</dt>
        <dd>{ronde.geschatte_uren != null ? `${ronde.geschatte_uren} uur` : "—"}</dd>
        <dt>Werkelijk</dt>
        <dd>{ronde.werkelijke_uren != null ? `${ronde.werkelijke_uren} uur` : "—"}</dd>
        <dt>Naar planning</dt>
        <dd>{formatteerDatum(ronde.datum_naar_planning)}</dd>
        <dt>Ingepland op</dt>
        <dd>{formatteerDatum(ronde.ingeplande_datum)}</dd>
        <dt>Klant geïnformeerd</dt>
        <dd>{formatteerDatum(ronde.datum_klant_geinformeerd)}</dd>
        <dt>Uitvoering gestart</dt>
        <dd>{formatteerDatum(ronde.datum_uitvoering_start)}</dd>
        {ronde.uitvoerder && (
          <>
            <dt>Uitvoerder</dt>
            <dd>{ronde.uitvoerder}</dd>
          </>
        )}
        {ronde.feedback_tekst && (
          <>
            <dt>Feedback</dt>
            <dd style={{ fontStyle: "italic" }}>“{ronde.feedback_tekst}”</dd>
          </>
        )}
        {ronde.afgerond_op && (
          <>
            <dt>Afgerond</dt>
            <dd>{formatteerTijdstip(ronde.afgerond_op)}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

interface Props {
  detail: Detail;
  onGewijzigd: (detail: Detail) => void;
  onSluit: () => void;
  onFout: (melding: string) => void;
}

export default function KaartDetail({ detail, onGewijzigd, onSluit, onFout }: Props) {
  const { aanvraag, rondes, logboek } = detail;
  const [notitieTekst, setNotitieTekst] = useState("");
  const huidigeRonde = rondes.find((r) => r.rondenummer === aanvraag.huidige_ronde);
  // Werkelijke uren zijn zinvol vanaf de uitvoering.
  const toonWerkelijkeUren = ["in_uitvoering", "feedback_controle", "afgerond"].includes(
    aanvraag.status,
  );

  async function bewaarAanvraag(veld: string, waarde: string) {
    try {
      onGewijzigd(await opdrachtenApi.updateAanvraag(aanvraag.id, { [veld]: waarde }));
    } catch (e) {
      onFout(String(e));
    }
  }

  async function bewaarRonde(velden: { geschatte_uren?: number; uitvoerder?: string; werkelijke_uren?: number }) {
    try {
      onGewijzigd(await opdrachtenApi.updateRonde(aanvraag.id, velden));
    } catch (e) {
      onFout(String(e));
    }
  }

  const veld = (naam: string, huidig: string | null) => ({
    defaultValue: huidig ?? "",
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.target.value !== (huidig ?? "")) void bewaarAanvraag(naam, e.target.value);
    },
  });

  return (
    <aside className="opdr-detail">
      <header className="opdr-detail-kop">
        <div>
          <h2>{aanvraag.klant_naam}</h2>
          <StatusBadge status={aanvraag.status} ronde={aanvraag.huidige_ronde} />
          {aanvraag.gearchiveerd && <span className="opdr-badge dood">gearchiveerd</span>}
        </div>
        <button className="icon-btn" onClick={onSluit} title="Sluiten (Esc)">
          ✕
        </button>
      </header>

      <StatusKnoppen
        key={`${aanvraag.id}-${aanvraag.status}`}
        detail={detail}
        onGewijzigd={onGewijzigd}
      />

      <KopieerMail detail={detail} />

      <section>
        <h3>Klant</h3>
        <div className="opdr-veldrooster">
          <label>Naam</label>
          <input key={`naam-${aanvraag.id}`} type="text" {...veld("klant_naam", aanvraag.klant_naam)} />
          <label>Bedrijf</label>
          <input key={`bedrijf-${aanvraag.id}`} type="text" {...veld("klant_bedrijf", aanvraag.klant_bedrijf)} />
          <label>Telefoon</label>
          <input key={`tel-${aanvraag.id}`} type="text" {...veld("klant_telefoon", aanvraag.klant_telefoon)} />
          <label>E-mail</label>
          <input key={`mail-${aanvraag.id}`} type="text" {...veld("klant_email", aanvraag.klant_email)} />
          <label>Kanaal</label>
          <select
            key={`kanaal-${aanvraag.id}`}
            defaultValue={aanvraag.kanaal ?? ""}
            onChange={(e) => e.target.value && void bewaarAanvraag("kanaal", e.target.value)}
          >
            <option value="" disabled>
              — kies —
            </option>
            <option value="telefoon">Telefoon</option>
            <option value="email">E-mail</option>
          </select>
          <label>Binnengekomen</label>
          <span>{formatteerDatum(aanvraag.datum_binnen)}</span>
        </div>
        <label className="opdr-veld-blok">
          Omschrijving
          <textarea
            key={`omschrijving-${aanvraag.id}`}
            rows={2}
            {...veld("omschrijving", aanvraag.omschrijving)}
          />
        </label>
      </section>

      {huidigeRonde && (
        <section>
          <h3>Huidige ronde</h3>
          <div className="opdr-veldrooster">
            <label>Geschatte uren</label>
            <input
              key={`uren-${aanvraag.id}-${huidigeRonde.rondenummer}`}
              type="number"
              min="0"
              step="0.5"
              defaultValue={huidigeRonde.geschatte_uren ?? ""}
              onBlur={(e) => {
                const v = e.target.value === "" ? null : Number(e.target.value);
                if (v !== null && v !== huidigeRonde.geschatte_uren) {
                  void bewaarRonde({ geschatte_uren: v });
                }
              }}
            />
            {toonWerkelijkeUren && (
              <>
                <label>Werkelijke uren</label>
                <input
                  key={`wuren-${aanvraag.id}-${huidigeRonde.rondenummer}`}
                  type="number"
                  min="0"
                  step="0.5"
                  defaultValue={huidigeRonde.werkelijke_uren ?? ""}
                  onBlur={(e) => {
                    const v = e.target.value === "" ? null : Number(e.target.value);
                    if (v !== null && v !== huidigeRonde.werkelijke_uren) {
                      void bewaarRonde({ werkelijke_uren: v });
                    }
                  }}
                />
              </>
            )}
            <label>Uitvoerder</label>
            <input
              key={`uitvoerder-${aanvraag.id}-${huidigeRonde.rondenummer}`}
              type="text"
              defaultValue={huidigeRonde.uitvoerder ?? ""}
              onBlur={(e) => {
                if (e.target.value !== (huidigeRonde.uitvoerder ?? "")) {
                  void bewaarRonde({ uitvoerder: e.target.value });
                }
              }}
            />
          </div>
        </section>
      )}

      {rondes.length > 1 && (
        <section>
          <h3>Rondes ({rondes.length})</h3>
          {[...rondes].reverse().map((r) => (
            <RondeBlok key={r.id} ronde={r} actief={r.rondenummer === aanvraag.huidige_ronde} />
          ))}
        </section>
      )}

      <section>
        <h3>Tijdlijn</h3>
        <input
          type="text"
          placeholder="Notitie toevoegen…"
          value={notitieTekst}
          style={{ width: "100%", font: "inherit", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", background: "var(--bg-raised)", color: "var(--text)" }}
          onChange={(e) => setNotitieTekst(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === "Enter" && notitieTekst.trim()) {
              try {
                onGewijzigd(await opdrachtenApi.voegNotitieToe(aanvraag.id, notitieTekst));
                setNotitieTekst("");
              } catch (err) {
                onFout(String(err));
              }
            }
          }}
        />
        <Tijdlijn regels={logboek} />
      </section>
    </aside>
  );
}
