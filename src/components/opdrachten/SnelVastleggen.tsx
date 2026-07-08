import { useState } from "react";

import { opdrachtenApi } from "../../lib/opdrachten-api";

interface Props {
  onSluit: () => void;
  onAangemaakt: (id: number, openDetail: boolean) => void;
}

/** Nieuwe kaart in seconden: naam + één zin, Enter = opslaan (spec §6.2). */
export default function SnelVastleggen({ onSluit, onAangemaakt }: Props) {
  const [naam, setNaam] = useState("");
  const [omschrijving, setOmschrijving] = useState("");
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  async function opslaan(openDetail: boolean) {
    if (!naam.trim()) {
      setFout("Klantnaam is verplicht");
      return;
    }
    setBezig(true);
    try {
      const detail = await opdrachtenApi.snelVastleggen(naam, omschrijving);
      onAangemaakt(detail.aanvraag.id, openDetail);
      onSluit();
    } catch (e) {
      setFout(String(e));
    } finally {
      setBezig(false);
    }
  }

  function toets(e: React.KeyboardEvent) {
    if (e.key === "Enter") void opslaan(e.ctrlKey);
    if (e.key === "Escape") onSluit();
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={onSluit}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} onKeyDown={toets} style={{ width: 460 }}>
        <header className="dialog-head">
          <h2>Nieuwe aanvraag</h2>
        </header>
        <div className="dialog-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            type="text"
            placeholder="Klantnaam *"
            value={naam}
            autoFocus
            onChange={(e) => setNaam(e.target.value)}
          />
          <input
            type="text"
            placeholder="Waar gaat het over? (één zin is genoeg)"
            value={omschrijving}
            onChange={(e) => setOmschrijving(e.target.value)}
          />
          {fout && <p className="opdr-fout">{fout}</p>}
          <p className="muted small">
            De rest vul je later aan — Enter slaat op, Ctrl+Enter opent de kaart direct.
          </p>
        </div>
        <footer className="dialog-foot">
          <button className="btn ghost" onClick={onSluit}>
            Sluiten
          </button>
          <button className="btn" onClick={() => void opslaan(true)} disabled={bezig}>
            Vastleggen + openen
          </button>
          <button className="btn primary" onClick={() => void opslaan(false)} disabled={bezig}>
            Vastleggen
          </button>
        </footer>
      </div>
    </div>
  );
}
