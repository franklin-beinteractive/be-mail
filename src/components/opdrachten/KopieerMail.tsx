import { useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import type { KaartDetail } from "../../lib/opdrachten-types";
import { mailTekstenVoor } from "../../lib/opdrachten-mail";

/**
 * Kant-en-klare mailteksten om te KOPIËREN (spec §6.7).
 * Bewust alleen een kopieerknop: versturen gebeurt altijd handmatig —
 * tekst kopiëren en zelf in een reply plakken. Geen mailto, geen compose.
 */
export default function KopieerMail({ detail }: { detail: KaartDetail }) {
  const [gekopieerd, setGekopieerd] = useState<string | null>(null);
  const teksten = mailTekstenVoor(detail);
  if (teksten.length === 0) return null;

  return (
    <section>
      <h3>Mailtekst (kopiëren → zelf plakken in een reply)</h3>
      {teksten.map((m) => (
        <div key={m.soort} className="opdr-mail-blok">
          <strong>{m.titel}</strong>
          <pre className="opdr-mail-tekst">{`${m.onderwerp}\n\n${m.tekst}`}</pre>
          <button
            className="btn"
            onClick={async () => {
              await writeText(`${m.onderwerp}\r\n\r\n${m.tekst}`);
              setGekopieerd(m.soort);
              setTimeout(() => setGekopieerd(null), 2000);
            }}
          >
            {gekopieerd === m.soort ? "✓ Gekopieerd" : "📋 Kopieer tekst"}
          </button>
        </div>
      ))}
    </section>
  );
}
