import type { Statistiek as Stats } from "../../lib/opdrachten-types";

/**
 * Statistiekoverzicht (spec §10 Fase 3). Vormkeuzes volgens de dataviz-richtlijn:
 * staaflijsten voor aantallen (één reeks, één tint), stat-tegels voor losse
 * kerngetallen, en een twee-reeksen-vergelijking (geschat vs. werkelijk) met
 * legenda + waarden als tekst. Kleuren --opdr-chart-1/2 zijn gevalideerd voor
 * licht én donker thema.
 */
export default function Statistiek({ stats }: { stats: Stats }) {
  const weekMax = Math.max(1, ...stats.per_week.map((w) => w.aantal));
  const urenMax = Math.max(
    1,
    ...stats.uren_kaarten.flatMap((k) => [k.geschat, k.werkelijk]),
  );
  const rondes = [
    { label: "1 ronde", aantal: stats.kaarten_1_ronde },
    { label: "2 rondes", aantal: stats.kaarten_2_rondes },
    { label: "3+ rondes", aantal: stats.kaarten_3plus_rondes },
  ];
  const rondeMax = Math.max(1, ...rondes.map((r) => r.aantal));

  return (
    <div className="opdr-stats">
      <div className="opdr-stat-kaart">
        <h3>Kaarten</h3>
        <p className="opdr-stat-sub">Totaal in de administratie</p>
        <div className="opdr-stat-rij3">
          <div>
            <div className="opdr-stat-groot">{stats.open}</div>
            <div className="muted small">open</div>
          </div>
          <div>
            <div className="opdr-stat-groot">{stats.afgerond}</div>
            <div className="muted small">afgerond</div>
          </div>
          <div>
            <div className="opdr-stat-groot">{stats.geannuleerd}</div>
            <div className="muted small">geannuleerd</div>
          </div>
        </div>
      </div>

      <div className="opdr-stat-kaart">
        <h3>Doorlooptijd planning</h3>
        <p className="opdr-stat-sub">
          Gemiddeld aantal werkdagen tot een antwoord van planning
          {stats.doorlooptijd_meetpunten > 0 && ` (${stats.doorlooptijd_meetpunten} metingen)`}
        </p>
        <div className="opdr-stat-groot">
          {stats.gem_doorlooptijd_planning != null
            ? `${stats.gem_doorlooptijd_planning.toFixed(1)} wd`
            : "—"}
        </div>
      </div>

      <div className="opdr-stat-kaart">
        <h3>Nieuwe aanvragen per week</h3>
        <p className="opdr-stat-sub">Laatste 12 weken, op datum van binnenkomst</p>
        {stats.per_week.map((w) => (
          <div className="opdr-staaf-rij" key={w.start} title={`Week van ${w.start}: ${w.aantal} aanvragen`}>
            <span className="opdr-staaf-label">{w.label}</span>
            <div className="opdr-staaf-baan">
              <div
                className="opdr-staaf"
                style={{ width: `${(w.aantal / weekMax) * 100}%`, opacity: w.aantal === 0 ? 0 : 1 }}
              />
            </div>
            <span className="opdr-staaf-waarde">{w.aantal}</span>
          </div>
        ))}
      </div>

      <div className="opdr-stat-kaart">
        <h3>Rondes per opdracht</h3>
        <p className="opdr-stat-sub">Opdrachten die terugkomen kosten méér dan de schatting</p>
        {rondes.map((r) => (
          <div className="opdr-staaf-rij" key={r.label} title={`${r.label}: ${r.aantal} kaarten`}>
            <span className="opdr-staaf-label">{r.label}</span>
            <div className="opdr-staaf-baan">
              <div
                className="opdr-staaf"
                style={{ width: `${(r.aantal / rondeMax) * 100}%`, opacity: r.aantal === 0 ? 0 : 1 }}
              />
            </div>
            <span className="opdr-staaf-waarde">{r.aantal}</span>
          </div>
        ))}
      </div>

      <div className="opdr-stat-kaart" style={{ gridColumn: "1 / -1" }}>
        <h3>Geschat versus werkelijk</h3>
        <p className="opdr-stat-sub">
          Kaarten met geregistreerde werkelijke uren · totaal geschat{" "}
          <strong>{stats.totaal_geschat}</strong> uur, werkelijk{" "}
          <strong>{stats.totaal_werkelijk}</strong> uur
        </p>
        {stats.uren_kaarten.length === 0 ? (
          <p className="muted small">
            Nog geen werkelijke uren ingevuld — dat kan op de kaart zodra een opdracht in
            uitvoering is.
          </p>
        ) : (
          <>
            <div className="opdr-legenda">
              <span>
                <i style={{ background: "var(--opdr-chart-1)" }} /> Geschat
              </span>
              <span>
                <i style={{ background: "var(--opdr-chart-2)" }} /> Werkelijk
              </span>
            </div>
            <div className="opdr-uren-rij kop">
              <span>Opdracht</span>
              <span className="num">Geschat</span>
              <span className="num">Werkelijk</span>
            </div>
            {stats.uren_kaarten.map((k, i) => {
              const over = k.werkelijk > k.geschat && k.geschat > 0;
              return (
                <div key={i}>
                  <div className="opdr-uren-rij" title={`${k.klant}: geschat ${k.geschat} uur, werkelijk ${k.werkelijk} uur`}>
                    <span>
                      <strong>{k.klant}</strong>
                      {k.omschrijving && <span className="muted"> — {k.omschrijving}</span>}
                    </span>
                    <span className="num">{k.geschat > 0 ? `${k.geschat} u` : "—"}</span>
                    <span className={`num ${over ? "over" : "onder"}`}>{k.werkelijk} u</span>
                  </div>
                  <div className="opdr-duo-baan" style={{ margin: "4px 0 10px" }}>
                    <div className="opdr-staaf-baan">
                      <div className="opdr-staaf" style={{ width: `${(k.geschat / urenMax) * 100}%`, opacity: k.geschat === 0 ? 0 : 1 }} />
                    </div>
                    <div className="opdr-staaf-baan">
                      <div className="opdr-staaf vergelijk" style={{ width: `${(k.werkelijk / urenMax) * 100}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
