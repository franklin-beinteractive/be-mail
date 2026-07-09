import { useApp } from "../../lib/ctx";
import { vul } from "../../lib/opdrachten-labels";
import type { Statistiek as Stats } from "../../lib/opdrachten-types";
import { formatteerDatum } from "../../lib/opdrachten-types";

/**
 * Statistiekoverzicht (spec §10 Fase 3). Vormkeuzes volgens de dataviz-richtlijn:
 * staaflijsten voor aantallen (één reeks, één tint), stat-tegels voor losse
 * kerngetallen, en een twee-reeksen-vergelijking (geschat vs. werkelijk) met
 * legenda + waarden als tekst. Kleuren --opdr-chart-1/2 zijn gevalideerd voor
 * licht én donker thema.
 */
export default function Statistiek({ stats }: { stats: Stats }) {
  const { t } = useApp();
  const weekMax = Math.max(1, ...stats.per_week.map((w) => w.aantal));
  const urenMax = Math.max(
    1,
    ...stats.uren_kaarten.flatMap((k) => [k.geschat, k.werkelijk]),
  );
  const rondes = [
    { label: t("opdrStatsRonde1"), aantal: stats.kaarten_1_ronde },
    { label: t("opdrStatsRonde2"), aantal: stats.kaarten_2_rondes },
    { label: t("opdrStatsRonde3"), aantal: stats.kaarten_3plus_rondes },
  ];
  const rondeMax = Math.max(1, ...rondes.map((r) => r.aantal));

  return (
    <div className="opdr-stats">
      <div className="opdr-stat-kaart">
        <h3>{t("opdrStatsKaarten")}</h3>
        <p className="opdr-stat-sub">{t("opdrStatsKaartenSub")}</p>
        <div className="opdr-stat-rij3">
          <div>
            <div className="opdr-stat-groot">{stats.open}</div>
            <div className="muted small">{t("opdrStatsOpen")}</div>
          </div>
          <div>
            <div className="opdr-stat-groot">{stats.afgerond}</div>
            <div className="muted small">{t("opdrStatsAfgerondWoord")}</div>
          </div>
          <div>
            <div className="opdr-stat-groot">{stats.geannuleerd}</div>
            <div className="muted small">{t("opdrStatsGeannuleerdWoord")}</div>
          </div>
        </div>
      </div>

      <div className="opdr-stat-kaart">
        <h3>{t("opdrStatsDoorlooptijd")}</h3>
        <p className="opdr-stat-sub">
          {t("opdrStatsDoorlooptijdSub")}
          {stats.doorlooptijd_meetpunten > 0 &&
            ` ${vul(t("opdrStatsMetingen"), { n: stats.doorlooptijd_meetpunten })}`}
        </p>
        <div className="opdr-stat-groot">
          {stats.gem_doorlooptijd_planning != null
            ? `${stats.gem_doorlooptijd_planning.toFixed(1)} wd`
            : "—"}
        </div>
      </div>

      <div className="opdr-stat-kaart">
        <h3>{t("opdrStatsPerWeek")}</h3>
        <p className="opdr-stat-sub">{t("opdrStatsPerWeekSub")}</p>
        {stats.per_week.map((w) => (
          <div
            className="opdr-staaf-rij"
            key={w.start}
            title={vul(t("opdrStatsWeekTip"), { d: formatteerDatum(w.start), n: w.aantal })}
          >
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
        <h3>{t("opdrStatsRondes")}</h3>
        <p className="opdr-stat-sub">{t("opdrStatsRondesSub")}</p>
        {rondes.map((r) => (
          <div className="opdr-staaf-rij" key={r.label} title={`${r.label}: ${r.aantal}`}>
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
        <h3>{t("opdrStatsUren")}</h3>
        <p className="opdr-stat-sub">
          {vul(t("opdrStatsUrenSub"), { g: stats.totaal_geschat, w: stats.totaal_werkelijk })}
        </p>
        {stats.uren_kaarten.length === 0 ? (
          <p className="muted small">{t("opdrStatsUrenLeeg")}</p>
        ) : (
          <>
            <div className="opdr-legenda">
              <span>
                <i style={{ background: "var(--opdr-chart-1)" }} /> {t("opdrGeschat")}
              </span>
              <span>
                <i style={{ background: "var(--opdr-chart-2)" }} /> {t("opdrWerkelijk")}
              </span>
            </div>
            <div className="opdr-uren-rij kop">
              <span>{t("opdrStatsOpdracht")}</span>
              <span className="num">{t("opdrGeschat")}</span>
              <span className="num">{t("opdrWerkelijk")}</span>
            </div>
            {stats.uren_kaarten.map((k, i) => {
              const over = k.werkelijk > k.geschat && k.geschat > 0;
              return (
                <div key={i}>
                  <div className="opdr-uren-rij">
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
