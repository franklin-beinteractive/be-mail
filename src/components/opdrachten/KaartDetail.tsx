import { useState } from "react";

import { useApp } from "../../lib/ctx";
import { opdrachtenApi } from "../../lib/opdrachten-api";
import type { KaartDetail as Detail, Ronde } from "../../lib/opdrachten-types";
import { formatteerDatum, formatteerTijdstip } from "../../lib/opdrachten-types";
import KopieerMail from "./KopieerMail";
import StatusBadge from "./StatusBadge";
import StatusKnoppen from "./StatusKnoppen";
import Tijdlijn from "./Tijdlijn";

function RondeBlok({ ronde, actief }: { ronde: Ronde; actief: boolean }) {
  const { t } = useApp();
  const rondeWoord = t("opdrRondeWoord");
  return (
    <div className={`opdr-ronde-blok${actief ? " actief" : ""}`}>
      <div className="opdr-ronde-kop">
        {rondeWoord.charAt(0).toUpperCase() + rondeWoord.slice(1)} {ronde.rondenummer}
        {actief && <span className="opdr-ronde-nu">{t("opdrHuidig")}</span>}
      </div>
      <dl className="opdr-ronde-velden">
        <dt>{t("opdrGeschat")}</dt>
        <dd>{ronde.geschatte_uren != null ? `${ronde.geschatte_uren} u` : "—"}</dd>
        <dt>{t("opdrWerkelijk")}</dt>
        <dd>{ronde.werkelijke_uren != null ? `${ronde.werkelijke_uren} u` : "—"}</dd>
        <dt>{t("opdrNaarPlanningLabel")}</dt>
        <dd>{formatteerDatum(ronde.datum_naar_planning)}</dd>
        <dt>{t("opdrIngeplandOpLabel")}</dt>
        <dd>{formatteerDatum(ronde.ingeplande_datum)}</dd>
        <dt>{t("opdrKlantGeinformeerdLabel")}</dt>
        <dd>{formatteerDatum(ronde.datum_klant_geinformeerd)}</dd>
        <dt>{t("opdrUitvoeringGestartLabel")}</dt>
        <dd>{formatteerDatum(ronde.datum_uitvoering_start)}</dd>
        {ronde.uitvoerder && (
          <>
            <dt>{t("opdrUitvoerder")}</dt>
            <dd>{ronde.uitvoerder}</dd>
          </>
        )}
        {ronde.feedback_tekst && (
          <>
            <dt>{t("opdrFeedbackLabel")}</dt>
            <dd style={{ fontStyle: "italic" }}>“{ronde.feedback_tekst}”</dd>
          </>
        )}
        {ronde.afgerond_op && (
          <>
            <dt>{t("opdrAfgerondLabel")}</dt>
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
  onVerwijderd: () => void;
}

export default function KaartDetail({ detail, onGewijzigd, onSluit, onFout, onVerwijderd }: Props) {
  const { t } = useApp();
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
          {aanvraag.gearchiveerd && <span className="opdr-badge dood">{t("opdrGearchiveerd")}</span>}
        </div>
        <button className="icon-btn" onClick={onSluit} title={t("opdrSluiten")}>
          ✕
        </button>
      </header>

      <StatusKnoppen
        key={`${aanvraag.id}-${aanvraag.status}`}
        detail={detail}
        onGewijzigd={onGewijzigd}
        onVerwijderd={onVerwijderd}
      />

      <KopieerMail detail={detail} />

      <section>
        <h3>{t("opdrKlant")}</h3>
        <div className="opdr-veldrooster">
          <label>{t("opdrNaam")}</label>
          <input key={`naam-${aanvraag.id}`} type="text" {...veld("klant_naam", aanvraag.klant_naam)} />
          <label>{t("opdrBedrijf")}</label>
          <input key={`bedrijf-${aanvraag.id}`} type="text" {...veld("klant_bedrijf", aanvraag.klant_bedrijf)} />
          <label>{t("opdrTelefoon")}</label>
          <input key={`tel-${aanvraag.id}`} type="text" {...veld("klant_telefoon", aanvraag.klant_telefoon)} />
          <label>{t("opdrKanaalEmail")}</label>
          <input key={`mail-${aanvraag.id}`} type="text" {...veld("klant_email", aanvraag.klant_email)} />
          <label>{t("opdrKanaal")}</label>
          <select
            key={`kanaal-${aanvraag.id}`}
            defaultValue={aanvraag.kanaal ?? ""}
            onChange={(e) => e.target.value && void bewaarAanvraag("kanaal", e.target.value)}
          >
            <option value="" disabled>
              {t("opdrKies")}
            </option>
            <option value="telefoon">{t("opdrKanaalTelefoon")}</option>
            <option value="email">{t("opdrKanaalEmail")}</option>
          </select>
          <label>{t("opdrBinnengekomenLabel")}</label>
          <span>{formatteerDatum(aanvraag.datum_binnen)}</span>
        </div>
        <label className="opdr-veld-blok">
          {t("opdrOmschrijving")}
          <textarea
            key={`omschrijving-${aanvraag.id}`}
            rows={2}
            {...veld("omschrijving", aanvraag.omschrijving)}
          />
        </label>
      </section>

      {huidigeRonde && (
        <section>
          <h3>{t("opdrHuidigeRonde")}</h3>
          <div className="opdr-veldrooster">
            <label>{t("opdrGeschatteUren")}</label>
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
                <label>{t("opdrWerkelijkeUren")}</label>
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
            <label>{t("opdrUitvoerder")}</label>
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
          <h3>
            {t("opdrRondes")} ({rondes.length})
          </h3>
          {[...rondes].reverse().map((r) => (
            <RondeBlok key={r.id} ronde={r} actief={r.rondenummer === aanvraag.huidige_ronde} />
          ))}
        </section>
      )}

      <section>
        <h3>{t("opdrTijdlijn")}</h3>
        <input
          type="text"
          placeholder={t("opdrNotitiePlaceholder")}
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
