import { useRef, useState } from "react";

export interface Suggestie {
  id: string;
  label: string;
  /** Grijze subregel, bijv. e-mailadres of contactpersoon. */
  sub?: string;
}

interface Props {
  beginwaarde: string;
  suggesties: Suggestie[];
  placeholder?: string;
  /** Gekozen uit de lijst (Instellingen → Opdrachten). */
  onKies: (s: Suggestie) => void;
  /** Vrije tekst bevestigd (blur), zoals de andere kaartvelden. */
  onTekst: (tekst: string) => void;
}

/**
 * Tekstveld met autoaanvullen uit een vooraf ingevulde lijst (uitvoerders,
 * planners, klanten - beheerd in Instellingen). Vrije tekst blijft mogelijk;
 * kiezen uit de lijst vult gekoppelde velden in één keer.
 */
export default function AutoAanvullen({ beginwaarde, suggesties, placeholder, onKies, onTekst }: Props) {
  const [tekst, setTekst] = useState(beginwaarde);
  const [open, setOpen] = useState(false);
  const [actief, setActief] = useState(0);
  const gekozenRef = useRef(false);

  const term = tekst.trim().toLowerCase();
  const matches = suggesties
    .filter((s) => !term || s.label.toLowerCase().includes(term) || s.sub?.toLowerCase().includes(term))
    .slice(0, 8);

  function kies(s: Suggestie) {
    gekozenRef.current = true;
    setTekst(s.label);
    setOpen(false);
    onKies(s);
  }

  return (
    <div className="opdr-suggest">
      <input
        type="text"
        value={tekst}
        placeholder={placeholder}
        onChange={(e) => {
          gekozenRef.current = false;
          setTekst(e.target.value);
          setOpen(true);
          setActief(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          // Na een keuze bewaart onKies alles al; geen losse tekst-commit erachteraan.
          if (gekozenRef.current) return;
          if (tekst !== beginwaarde) onTekst(tekst);
        }}
        onKeyDown={(e) => {
          if (!open || matches.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActief((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActief((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            kies(matches[Math.min(actief, matches.length - 1)]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && matches.length > 0 && (
        <ul className="opdr-suggest-lijst" role="listbox">
          {matches.map((s, i) => (
            <li
              key={s.id}
              role="option"
              aria-selected={i === actief}
              className={i === actief ? "actief" : ""}
              // onMouseDown i.p.v. onClick: vóór de blur van het invoerveld.
              onMouseDown={(e) => {
                e.preventDefault();
                kies(s);
              }}
              onMouseEnter={() => setActief(i)}
            >
              <span>{s.label}</span>
              {s.sub && <span className="opdr-suggest-sub">{s.sub}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
