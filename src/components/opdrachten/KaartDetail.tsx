import { useApp } from "../../lib/ctx";
import { opdrachtenApi } from "../../lib/opdrachten-api";
import type { AanvraagUpdate, KaartDetail as Detail, Ronde } from "../../lib/opdrachten-types";
import { formatteerDatum, formatteerTijdstip } from "../../lib/opdrachten-types";
import AutoAanvullen from "./AutoAanvullen";
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
        {ronde.planner && (
          <>
            <dt>{t("opdrPlanner")}</dt>
            <dd>{ronde.planner}</dd>
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
  const { t, settings } = useApp();
  const { aanvraag, rondes, logboek } = detail;
  const huidigeRonde = rondes.find((r) => r.rondenummer === aanvraag.huidige_ronde);
  // Werkelijke uren zijn zinvol vanaf de uitvoering.
  const toonWerkelijkeUren = ["in_uitvoering", "feedback_controle", "afgerond"].includes(
    aanvraag.status,
  );

  async function bewaarAanvraag(velden: AanvraagUpdate) {
    try {
      onGewijzigd(await opdrachtenApi.updateAanvraag(aanvraag.id, velden));
    } catch (e) {
      onFout(String(e));
    }
  }

  async function bewaarRonde(velden: { geschatte_uren?: number; uitvoerder?: string; planner?: string; werkelijke_uren?: number }) {
    try {
      onGewijzigd(await opdrachtenApi.updateRonde(aanvraag.id, velden));
    } catch (e) {
      onFout(String(e));
    }
  }

  const veld = (naam: keyof AanvraagUpdate, huidig: string | null) => ({
    defaultValue: huidig ?? "",
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.target.value !== (huidig ?? "")) void bewaarAanvraag({ [naam]: e.target.value });
    },
  });

  // Autoaanvullen-suggesties uit Instellingen → Opdrachten. Een klant kiezen
  // vult naam, bedrijf en e-mailadres in één keer.
  const klanten = settings.opdrKlanten.filter((k) => k.bedrijf.trim() || k.contactpersoon.trim());
  const kiesKlant = (id: string) => {
    const k = klanten.find((x) => x.id === id);
    if (!k) return;
    void bewaarAanvraag({
      klant_naam: k.contactpersoon.trim() || k.bedrijf.trim(),
      klant_bedrijf: k.bedrijf,
      klant_email: k.email,
    });
  };
  const persoonSuggesties = (lijst: typeof settings.opdrUitvoerders) =>
    lijst
      .filter((p) => p.naam.trim())
      .map((p) => ({ id: p.id, label: p.naam, sub: p.email || undefined }));

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
          <AutoAanvullen
            key={`naam-${aanvraag.id}-${aanvraag.klant_naam}`}
            beginwaarde={aanvraag.klant_naam}
            suggesties={klanten.map((k) => ({
              id: k.id,
              label: k.contactpersoon.trim() || k.bedrijf,
              sub: k.contactpersoon.trim() ? k.bedrijf || k.email : k.email,
            }))}
            onKies={(s) => kiesKlant(s.id)}
            onTekst={(tekst) => void bewaarAanvraag({ klant_naam: tekst })}
          />
          <label>{t("opdrBedrijf")}</label>
          <AutoAanvullen
            key={`bedrijf-${aanvraag.id}-${aanvraag.klant_bedrijf ?? ""}`}
            beginwaarde={aanvraag.klant_bedrijf ?? ""}
            suggesties={klanten.map((k) => ({
              id: k.id,
              label: k.bedrijf.trim() || k.contactpersoon,
              sub: k.bedrijf.trim() ? k.contactpersoon || k.email : k.email,
            }))}
            onKies={(s) => kiesKlant(s.id)}
            onTekst={(tekst) => void bewaarAanvraag({ klant_bedrijf: tekst })}
          />
          <label>{t("opdrTelefoon")}</label>
          <input key={`tel-${aanvraag.id}`} type="text" {...veld("klant_telefoon", aanvraag.klant_telefoon)} />
          <label>{t("opdrKanaalEmail")}</label>
          <input
            key={`mail-${aanvraag.id}-${aanvraag.klant_email ?? ""}`}
            type="text"
            {...veld("klant_email", aanvraag.klant_email)}
          />
          <label>{t("opdrKanaal")}</label>
          <select
            key={`kanaal-${aanvraag.id}`}
            defaultValue={aanvraag.kanaal ?? ""}
            onChange={(e) => e.target.value && void bewaarAanvraag({ kanaal: e.target.value })}
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
            <AutoAanvullen
              key={`uitvoerder-${aanvraag.id}-${huidigeRonde.rondenummer}-${huidigeRonde.uitvoerder ?? ""}`}
              beginwaarde={huidigeRonde.uitvoerder ?? ""}
              suggesties={persoonSuggesties(settings.opdrUitvoerders)}
              onKies={(s) => void bewaarRonde({ uitvoerder: s.label })}
              onTekst={(tekst) => void bewaarRonde({ uitvoerder: tekst })}
            />
            <label>{t("opdrPlanner")}</label>
            <AutoAanvullen
              key={`planner-${aanvraag.id}-${huidigeRonde.rondenummer}-${huidigeRonde.planner ?? ""}`}
              beginwaarde={huidigeRonde.planner ?? ""}
              suggesties={persoonSuggesties(settings.opdrPlanners)}
              onKies={(s) => void bewaarRonde({ planner: s.label })}
              onTekst={(tekst) => void bewaarRonde({ planner: tekst })}
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
        <Tijdlijn regels={logboek} />
      </section>
    </aside>
  );
}
