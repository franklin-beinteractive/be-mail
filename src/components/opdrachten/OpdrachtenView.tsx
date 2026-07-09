// Opdrachten-coördinatie: actielijst ("Wat moet ik nu doen?"), wachtkamer,
// alle kaarten en statistiek. Data via plain state + herladen (geen query-lib),
// zoals de rest van BE-Mail. De Rust-poller seint via "opdrachten-ververst".
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { useApp } from "../../lib/ctx";
import type { TextKey } from "../../lib/i18n";
import { opdrachtenApi } from "../../lib/opdrachten-api";
import { actieLabel, vul, wachtLabel } from "../../lib/opdrachten-labels";
import type {
  Aanvraag,
  ActieKaart,
  Actielijst,
  KaartDetail as Detail,
  Statistiek as Stats,
  WachtKaart,
} from "../../lib/opdrachten-types";
import { formatteerDatum } from "../../lib/opdrachten-types";
import KaartDetail from "./KaartDetail";
import SnelVastleggen from "./SnelVastleggen";
import StatusBadge from "./StatusBadge";
import Statistiek from "./Statistiek";

type Tab = "acties" | "wachtkamer" | "alle" | "stats";

const WACHT_GROEPEN: { sleutel: WachtKaart["wacht_op"]; titelKey: TextKey }[] = [
  { sleutel: "planning", titelKey: "opdrGroepPlanning" },
  { sleutel: "uitvoeringsdatum", titelKey: "opdrGroepDatum" },
  { sleutel: "uitvoering", titelKey: "opdrGroepUitvoering" },
];

const ACTIE_KNOP_KEY: Record<string, TextKey> = {
  verwerken: "opdrKnopInBehandeling",
  inschatten: "opdrKnopInschatten",
  planning_herinneren: "opdrKnopHerinnerd",
  klant_informeren: "opdrKnopGeinformeerd",
  uitvoering_starten: "opdrKnopGestart",
  feedback_vragen: "opdrKnopFeedback",
  op_schema_check: "opdrKnopOpSchema",
};

interface Props {
  /** Kaart die direct geopend moet worden (bijv. net aangemaakt vanuit een mail). */
  focusKaartId: number | null;
  onFocusVerwerkt: () => void;
}

export default function OpdrachtenView({ focusKaartId, onFocusVerwerkt }: Props) {
  const { t, notify, confirm, settings, setSettings } = useApp();
  const [tab, setTab] = useState<Tab>("acties");
  // Breedte (px) van het detailpaneel; tijdens slepen lokaal, bij loslaten
  // opgeslagen (zelfde patroon als de kolommen in MailView).
  const [detailW, setDetailW] = useState(settings.opdrDetailWidth);

  function startDetailResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = detailW;
    const clamp = (x: number) => Math.min(720, Math.max(300, x));
    const onMove = (ev: MouseEvent) => setDetailW(clamp(startW + startX - ev.clientX));
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setSettings({ opdrDetailWidth: clamp(startW + startX - ev.clientX) });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }
  const [actielijst, setActielijst] = useState<Actielijst | null>(null);
  const [wachtkamer, setWachtkamer] = useState<WachtKaart[] | null>(null);
  const [kaarten, setKaarten] = useState<Aanvraag[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [geselecteerd, setGeselecteerd] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [toonNieuw, setToonNieuw] = useState(false);
  const [toonHeropenbaar, setToonHeropenbaar] = useState(false);
  const [zoek, setZoek] = useState("");
  // Multiselect voor definitief verwijderen.
  const [selectie, setSelectie] = useState<Set<number>>(new Set());
  const bezigRef = useRef(false);

  const herlaad = useCallback(async () => {
    if (bezigRef.current) return;
    bezigRef.current = true;
    try {
      const [lijst, wacht, alle, statistiek] = await Promise.all([
        opdrachtenApi.getActielijst(),
        opdrachtenApi.getWachtkamer(),
        opdrachtenApi.getKaarten(),
        opdrachtenApi.getStatistiek(),
      ]);
      setActielijst(lijst);
      setWachtkamer(wacht);
      setKaarten(alle);
      setStats(statistiek);
    } catch (e) {
      notify(String(e), "error");
    } finally {
      bezigRef.current = false;
    }
  }, [notify]);

  // Laden bij openen + elke minuut + wanneer de Rust-poller seint.
  useEffect(() => {
    void herlaad();
    const interval = window.setInterval(() => void herlaad(), 60_000);
    const un = listen("opdrachten-ververst", () => void herlaad());
    return () => {
      window.clearInterval(interval);
      un.then((f) => f());
    };
  }, [herlaad]);

  // Detail laden bij selectie.
  useEffect(() => {
    if (geselecteerd === null) {
      setDetail(null);
      return;
    }
    opdrachtenApi
      .getKaartDetail(geselecteerd)
      .then(setDetail)
      .catch((e) => notify(String(e), "error"));
  }, [geselecteerd, notify]);

  // Vanuit een mail aangemaakte kaart direct openen.
  useEffect(() => {
    if (focusKaartId !== null) {
      setTab("acties");
      setGeselecteerd(focusKaartId);
      onFocusVerwerkt();
      void herlaad();
    }
  }, [focusKaartId, onFocusVerwerkt, herlaad]);

  function naGewijzigd(nieuw: Detail) {
    setDetail(nieuw);
    setGeselecteerd(nieuw.aanvraag.id);
    void herlaad();
  }

  function naVerwijderd() {
    setGeselecteerd(null);
    setSelectie(new Set());
    void herlaad();
  }

  function wisselSelectie(id: number) {
    setSelectie((oud) => {
      const nieuw = new Set(oud);
      if (nieuw.has(id)) nieuw.delete(id);
      else nieuw.add(id);
      return nieuw;
    });
  }

  async function verwijderSelectie() {
    const ids = [...selectie];
    if (ids.length === 0) return;
    const vraag =
      ids.length === 1
        ? t("opdrVerwijderBevestig")
        : vul(t("opdrVerwijderBevestigMeer"), { n: ids.length });
    if (!(await confirm(vraag))) return;
    try {
      await opdrachtenApi.verwijderAanvragen(ids);
      notify(t("opdrVerwijderd"));
      if (geselecteerd !== null && selectie.has(geselecteerd)) setGeselecteerd(null);
      setSelectie(new Set());
      void herlaad();
    } catch (e) {
      notify(String(e), "error");
    }
  }

  /** Checkbox vooraan elke rij; klik selecteert zonder het detail te openen. */
  function SelectieVak({ id }: { id: number }) {
    return (
      <input
        type="checkbox"
        checked={selectie.has(id)}
        style={{ flexShrink: 0 }}
        onClick={(e) => e.stopPropagation()}
        onChange={() => wisselSelectie(id)}
      />
    );
  }

  // Geordende ids van de actieve tab voor ↑/↓-navigatie.
  const ids = useMemo(() => {
    switch (tab) {
      case "acties":
        return [
          ...(actielijst?.acties.map((a) => a.aanvraag.id) ?? []),
          ...(actielijst?.heropenbaar.map((h) => h.aanvraag.id) ?? []),
        ];
      case "wachtkamer":
        return wachtkamer?.map((w) => w.aanvraag.id) ?? [];
      case "alle":
        return kaarten?.map((k) => k.id) ?? [];
      case "stats":
        return [];
    }
  }, [tab, actielijst, wachtkamer, kaarten]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const doel = e.target as HTMLElement;
      const inInvoer = ["INPUT", "TEXTAREA", "SELECT"].includes(doel.tagName);
      if (e.key === "Escape") {
        if (toonNieuw) setToonNieuw(false);
        else if (geselecteerd !== null && !inInvoer) setGeselecteerd(null);
        return;
      }
      if (inInvoer || toonNieuw) return;
      switch (e.key) {
        case "n":
        case "N":
          e.preventDefault();
          setToonNieuw(true);
          break;
        case "1":
          setTab("acties");
          break;
        case "2":
          setTab("wachtkamer");
          break;
        case "3":
          setTab("alle");
          break;
        case "4":
          setTab("stats");
          break;
        case "ArrowDown":
        case "ArrowUp": {
          if (ids.length === 0) break;
          e.preventDefault();
          const huidige = geselecteerd !== null ? ids.indexOf(geselecteerd) : -1;
          const delta = e.key === "ArrowDown" ? 1 : -1;
          const volgende = Math.min(Math.max(huidige + delta, 0), ids.length - 1);
          setGeselecteerd(ids[volgende]);
          break;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [ids, geselecteerd, toonNieuw]);

  async function primaireActie(k: ActieKaart) {
    try {
      switch (k.actie_soort) {
        case "verwerken":
          naGewijzigd(await opdrachtenApi.wijzigStatus(k.aanvraag.id, "tijd_inschatten"));
          break;
        case "planning_herinneren":
          naGewijzigd(await opdrachtenApi.planningHerinnerd(k.aanvraag.id));
          break;
        case "klant_informeren":
          naGewijzigd(await opdrachtenApi.wijzigStatus(k.aanvraag.id, "ingepland"));
          break;
        case "uitvoering_starten":
          naGewijzigd(await opdrachtenApi.wijzigStatus(k.aanvraag.id, "in_uitvoering"));
          break;
        default:
          setGeselecteerd(k.aanvraag.id);
      }
    } catch (e) {
      notify(String(e), "error");
    }
  }

  const aantalActies = actielijst?.acties.length ?? 0;
  const aantalRood = actielijst?.acties.filter((a) => a.urgentieklasse === 0).length ?? 0;

  const term = zoek.trim().toLowerCase();
  const gefilterd = (kaarten ?? []).filter((a) => {
    if (!term) return true;
    return [a.klant_naam, a.klant_bedrijf, a.omschrijving, a.klant_email]
      .filter(Boolean)
      .some((v) => v!.toLowerCase().includes(term));
  });

  return (
    <div className="opdr-view" style={{ "--opdr-detail-w": `${detailW}px` } as React.CSSProperties}>
      <div className="opdr-hoofd">
        <header className="opdr-kop">
          <nav className="opdr-tabs">
            <button className={`opdr-tab${tab === "acties" ? " active" : ""}`} onClick={() => setTab("acties")}>
              {t("opdrTabActies")}
              {aantalActies > 0 && (
                <span className={`opdr-teller${aantalRood > 0 ? " rood" : ""}`}>{aantalActies}</span>
              )}
            </button>
            <button className={`opdr-tab${tab === "wachtkamer" ? " active" : ""}`} onClick={() => setTab("wachtkamer")}>
              {t("opdrTabWachtkamer")}
              {(wachtkamer?.length ?? 0) > 0 && <span className="opdr-teller" style={{ background: "var(--text-muted)" }}>{wachtkamer!.length}</span>}
            </button>
            <button className={`opdr-tab${tab === "alle" ? " active" : ""}`} onClick={() => setTab("alle")}>
              {t("opdrTabAlle")}
            </button>
            <button className={`opdr-tab${tab === "stats" ? " active" : ""}`} onClick={() => setTab("stats")}>
              {t("opdrTabStats")}
            </button>
          </nav>
          {selectie.size > 0 && (
            <>
              <span className="muted small">
                {selectie.size} {t("selected")}
              </span>
              <button className="btn danger" onClick={() => void verwijderSelectie()}>
                {t("opdrVerwijderen")}
              </button>
              <button className="btn ghost" onClick={() => setSelectie(new Set())}>
                {t("clearSelection")}
              </button>
            </>
          )}
          <button className="btn primary" onClick={() => setToonNieuw(true)} title="N">
            {t("opdrNieuweAanvraag")}
          </button>
        </header>

        {tab === "stats" ? (
          stats ? (
            <Statistiek stats={stats} />
          ) : (
            <p className="opdr-leeg">{t("opdrLaden")}</p>
          )
        ) : (
          <div className="opdr-lijst">
            {tab === "acties" && actielijst && (
              <>
                {actielijst.acties.length === 0 ? (
                  <div className="opdr-leeg">
                    <p className="opdr-leeg-groot">{t("opdrNietsTeDoen")}</p>
                    <p>{t("opdrNietsTeDoenSub")}</p>
                  </div>
                ) : (
                  actielijst.acties.map((k) => (
                    <div
                      key={k.aanvraag.id}
                      className={`opdr-rij urgentie-${k.urgentieklasse}${geselecteerd === k.aanvraag.id ? " actief" : ""}`}
                      onClick={() => setGeselecteerd(k.aanvraag.id)}
                    >
                      <SelectieVak id={k.aanvraag.id} />
                      <div className="opdr-rij-midden">
                        <div className="opdr-rij-kop">
                          <strong>{k.aanvraag.klant_naam}</strong>
                          {k.aanvraag.klant_bedrijf && <span className="muted">{k.aanvraag.klant_bedrijf}</span>}
                          <StatusBadge status={k.aanvraag.status} ronde={k.aanvraag.huidige_ronde} />
                        </div>
                        <div className="opdr-rij-omschrijving">{k.aanvraag.omschrijving || "—"}</div>
                        <div className={`opdr-rij-actie klasse-${k.urgentieklasse}`}>{actieLabel(t, k)}</div>
                      </div>
                      <button
                        className="btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          void primaireActie(k);
                        }}
                      >
                        {ACTIE_KNOP_KEY[k.actie_soort] ? t(ACTIE_KNOP_KEY[k.actie_soort]) : t("opdrKnopOpenen")}
                      </button>
                    </div>
                  ))
                )}
                {actielijst.heropenbaar.length > 0 && (
                  <>
                    <button className="btn ghost" style={{ alignSelf: "flex-start" }} onClick={() => setToonHeropenbaar(!toonHeropenbaar)}>
                      {toonHeropenbaar ? "▾" : "▸"} {t("opdrHeropenbaarKop")} ({actielijst.heropenbaar.length})
                    </button>
                    {toonHeropenbaar &&
                      actielijst.heropenbaar.map((h) => (
                        <div
                          key={h.aanvraag.id}
                          className={`opdr-rij heropenbaar${geselecteerd === h.aanvraag.id ? " actief" : ""}`}
                          onClick={() => setGeselecteerd(h.aanvraag.id)}
                        >
                          <SelectieVak id={h.aanvraag.id} />
                          <div className="opdr-rij-midden">
                            <div className="opdr-rij-kop">
                              <strong>{h.aanvraag.klant_naam}</strong>
                              <span className="muted">{h.aanvraag.omschrijving}</span>
                            </div>
                            <div className="opdr-rij-actie klasse-2">
                              {vul(t("opdrNogDagenHeropenbaar"), { n: h.dagen_resterend })}
                            </div>
                          </div>
                        </div>
                      ))}
                  </>
                )}
              </>
            )}

            {tab === "wachtkamer" &&
              (wachtkamer && wachtkamer.length > 0 ? (
                WACHT_GROEPEN.map(({ sleutel, titelKey }) => {
                  const groep = wachtkamer.filter((k) => k.wacht_op === sleutel);
                  if (groep.length === 0) return null;
                  return (
                    <section key={sleutel}>
                      <h3 className="opdr-groep-titel">{t(titelKey)}</h3>
                      {groep.map((k) => (
                        <div
                          key={k.aanvraag.id}
                          className={`opdr-rij${geselecteerd === k.aanvraag.id ? " actief" : ""}`}
                          style={{ marginBottom: 8 }}
                          onClick={() => setGeselecteerd(k.aanvraag.id)}
                        >
                          <SelectieVak id={k.aanvraag.id} />
                          <div className="opdr-rij-midden">
                            <div className="opdr-rij-kop">
                              <strong>{k.aanvraag.klant_naam}</strong>
                              {k.aanvraag.klant_bedrijf && <span className="muted">{k.aanvraag.klant_bedrijf}</span>}
                              <StatusBadge status={k.aanvraag.status} ronde={k.aanvraag.huidige_ronde} />
                            </div>
                            <div className="opdr-rij-omschrijving">{k.aanvraag.omschrijving || "—"}</div>
                            <div className="opdr-rij-actie klasse-2">
                              {wachtLabel(t, k)}
                              {k.sinds && ` · ${vul(t("opdrSinds"), { d: formatteerDatum(k.sinds) })}`}
                            </div>
                          </div>
                        </div>
                      ))}
                    </section>
                  );
                })
              ) : (
                <div className="opdr-leeg">
                  <p className="opdr-leeg-groot">{t("opdrWachtkamerLeeg")}</p>
                  <p>{t("opdrWachtkamerLeegSub")}</p>
                </div>
              ))}

            {tab === "alle" && (
              <>
                <input
                  type="search"
                  placeholder={t("opdrZoeken")}
                  value={zoek}
                  style={{ font: "inherit", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 10px", background: "var(--bg-raised)", color: "var(--text)" }}
                  onChange={(e) => setZoek(e.target.value)}
                />
                {gefilterd.length === 0 ? (
                  <p className="opdr-leeg">{t("opdrGeenKaarten")}</p>
                ) : (
                  gefilterd.map((a) => (
                    <div
                      key={a.id}
                      className={`opdr-rij${geselecteerd === a.id ? " actief" : ""}${a.gearchiveerd ? " gearchiveerd" : ""}`}
                      onClick={() => setGeselecteerd(a.id)}
                    >
                      <SelectieVak id={a.id} />
                      <div className="opdr-rij-midden">
                        <div className="opdr-rij-kop">
                          <strong>{a.klant_naam}</strong>
                          {a.klant_bedrijf && <span className="muted">{a.klant_bedrijf}</span>}
                          <StatusBadge status={a.status} ronde={a.huidige_ronde} />
                          {a.gearchiveerd && <span className="opdr-badge dood">{t("opdrGearchiveerd")}</span>}
                        </div>
                        <div className="opdr-rij-omschrijving">{a.omschrijving || "—"}</div>
                        <div className="opdr-rij-actie klasse-2">
                          {vul(t("opdrBinnengekomenOp"), { d: formatteerDatum(a.datum_binnen) })}
                        </div>
                      </div>
                    </div>
                  ))
                )}
                {import.meta.env.DEV && (
                  <button
                    className="btn ghost"
                    style={{ alignSelf: "flex-start", color: "var(--danger)" }}
                    onClick={async () => {
                      try {
                        await opdrachtenApi.seedDemo();
                        notify(t("opdrSeedKlaar"));
                        void herlaad();
                      } catch (e) {
                        notify(String(e), "error");
                      }
                    }}
                  >
                    {t("opdrSeed")}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {detail && (
        <div
          className="col-resizer"
          onMouseDown={startDetailResize}
          role="separator"
          aria-orientation="vertical"
        />
      )}
      {detail && (
        <KaartDetail
          detail={detail}
          onGewijzigd={naGewijzigd}
          onSluit={() => setGeselecteerd(null)}
          onFout={(m) => notify(m, "error")}
          onVerwijderd={naVerwijderd}
        />
      )}

      {toonNieuw && (
        <SnelVastleggen
          onSluit={() => setToonNieuw(false)}
          onAangemaakt={(id, openDetail) => {
            if (openDetail) setGeselecteerd(id);
            void herlaad();
          }}
        />
      )}
    </div>
  );
}
