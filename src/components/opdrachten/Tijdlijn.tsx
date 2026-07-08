import type { LogboekRegel } from "../../lib/opdrachten-types";
import { formatteerTijdstip } from "../../lib/opdrachten-types";

const TYPE_ICOON: Record<string, string> = {
  status_wijziging: "→",
  notitie: "✎",
  herinnering: "🔔",
};

export default function Tijdlijn({ regels }: { regels: LogboekRegel[] }) {
  if (regels.length === 0) return <p className="muted small">Nog geen gebeurtenissen.</p>;
  return (
    <ol className="opdr-tijdlijn">
      {regels.map((r) => (
        <li key={r.id}>
          <span className="opdr-tijdlijn-icoon">{TYPE_ICOON[r.type] ?? "•"}</span>
          <div>
            <div>{r.tekst}</div>
            <div className="opdr-tijdlijn-meta">
              {formatteerTijdstip(r.tijdstip)}
              {r.rondenummer != null && r.rondenummer > 1 && ` · ronde ${r.rondenummer}`}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
