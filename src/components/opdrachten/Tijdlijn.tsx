import { useApp } from "../../lib/ctx";
import type { LogboekRegel } from "../../lib/opdrachten-types";
import { formatteerTijdstip } from "../../lib/opdrachten-types";

const TYPE_ICOON: Record<string, string> = {
  status_wijziging: "→",
  notitie: "✎",
  herinnering: "🔔",
};

/** Logboek-teksten zelf zijn opgeslagen data (NL); alleen de UI eromheen vertaalt. */
export default function Tijdlijn({ regels }: { regels: LogboekRegel[] }) {
  const { t } = useApp();
  if (regels.length === 0) return <p className="muted small">{t("opdrGeenGebeurtenissen")}</p>;
  return (
    <ol className="opdr-tijdlijn">
      {regels.map((r) => (
        <li key={r.id}>
          <span className="opdr-tijdlijn-icoon">{TYPE_ICOON[r.type] ?? "•"}</span>
          <div>
            <div>{r.tekst}</div>
            <div className="opdr-tijdlijn-meta">
              {formatteerTijdstip(r.tijdstip)}
              {r.rondenummer != null && r.rondenummer > 1 && ` · ${t("opdrRondeWoord")} ${r.rondenummer}`}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
