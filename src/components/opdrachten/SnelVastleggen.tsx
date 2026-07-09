import { useState } from "react";

import { useApp } from "../../lib/ctx";
import { opdrachtenApi } from "../../lib/opdrachten-api";

interface Props {
  onSluit: () => void;
  onAangemaakt: (id: number, openDetail: boolean) => void;
}

/** Nieuwe kaart in seconden: naam + één zin, Enter = opslaan (spec §6.2). */
export default function SnelVastleggen({ onSluit, onAangemaakt }: Props) {
  const { t } = useApp();
  const [naam, setNaam] = useState("");
  const [omschrijving, setOmschrijving] = useState("");
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  async function opslaan(openDetail: boolean) {
    if (!naam.trim()) {
      setFout(t("opdrKlantnaamVerplicht"));
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
          <h2>{t("opdrNieuweAanvraagTitel")}</h2>
        </header>
        <div className="dialog-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            type="text"
            placeholder={t("opdrPlaceholderKlantnaam")}
            value={naam}
            autoFocus
            onChange={(e) => setNaam(e.target.value)}
          />
          <input
            type="text"
            placeholder={t("opdrPlaceholderOmschrijving")}
            value={omschrijving}
            onChange={(e) => setOmschrijving(e.target.value)}
          />
          {fout && <p className="opdr-fout">{fout}</p>}
          <p className="muted small">{t("opdrHintSnel")}</p>
        </div>
        <footer className="dialog-foot">
          <button className="btn ghost" onClick={onSluit}>
            {t("opdrSluiten")}
          </button>
          <button className="btn" onClick={() => void opslaan(true)} disabled={bezig}>
            {t("opdrVastleggenOpen")}
          </button>
          <button className="btn primary" onClick={() => void opslaan(false)} disabled={bezig}>
            {t("opdrVastleggen")}
          </button>
        </footer>
      </div>
    </div>
  );
}
