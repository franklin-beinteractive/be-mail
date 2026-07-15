//! CalDAV-agenda (RFC 4791) voor IMAP-accounts. Office 365 blijft via Graph gaan;
//! IMAP-accounts krijgen best-effort een aparte CalDAV-agenda. Al het HTTP-verkeer
//! loopt via reqwest (rustls/ring) - net als de rest van de app, zonder OpenSSL.
//!
//! De client spiegelt de zes agenda-methodes van [`crate::graph::GraphClient`]
//! (`list_events`, `create_event`, `update_event`, `update_event_times`,
//! `search_people`, `delete_event`) zodat de dispatch in `backend.rs` symmetrisch
//! blijft. Personen zoeken kent geen CalDAV-equivalent en geeft een lege lijst.
//!
//! Belangrijk: reqwest laat bij een cross-host redirect standaard de
//! Authorization-header en body vallen (iCloud stuurt `.well-known/caldav`
//! cross-host door). Daarom staat de redirect-policy op `none()` en volgen we
//! 301/302/307/308 zelf, met behoud van methode, Depth-header, body en basic-auth.

use crate::config::CaldavSettings;
use crate::models::*;
use anyhow::{anyhow, bail, Result};
use base64::Engine as _;
use chrono::{DateTime, Datelike, Duration, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use quick_xml::events::{BytesStart, Event as XmlEvent};
use quick_xml::Reader;
use reqwest::{Client, Method, StatusCode};
use rrule::RRuleSet;
use std::time::Duration as StdDuration;
use url::Url;
use uuid::Uuid;

/// Standaard tijdzone van de agenda (Windows-notatie, zoals Graph die gebruikt).
const DEFAULT_TZ: &str = "W. Europe Standard Time";
/// Prefix + delen van de samengestelde afspraak-id (zie [`make_event_id`]).
const ID_PREFIX: &str = "caldav:";
/// Nederlandse melding bij een 412 (etag-conflict).
const CONFLICT_NL: &str =
    "De afspraak is elders gewijzigd. Vernieuw de agenda en probeer opnieuw.";
/// Nederlandse melding bij een terugkerende reeks. Eén .ics bevat de hele reeks
/// (master-DTSTART + RRULE); een los voorkomen bewerken/verplaatsen/verwijderen
/// zou daardoor de complete reeks herschrijven of wissen. In deze versie zijn
/// reeksen dus niet los te bewerken of te verwijderen.
const RECURRING_NL: &str =
    "Terugkerende afspraken kun je in deze versie niet los bewerken of verwijderen.";
/// Harde bovengrens bij het client-side uitklappen van een herhaling.
const MAX_INSTANCES: u16 = 2000;

/// Tekens die we in een pad-segment percent-encoderen (rest blijft leesbaar).
const PATH_SEG: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'`')
    .add(b'{')
    .add(b'}')
    .add(b'/')
    .add(b'%');

// ---- Vaste XML-body's (PROPFIND/REPORT) ----

const PRINCIPAL_BODY: &str = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<D:propfind xmlns:D=\"DAV:\"><D:prop><D:current-user-principal/></D:prop></D:propfind>";
const HOMESET_BODY: &str = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<D:propfind xmlns:D=\"DAV:\" xmlns:C=\"urn:ietf:params:xml:ns:caldav\"><D:prop><C:calendar-home-set/></D:prop></D:propfind>";
const ENUM_BODY: &str = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<D:propfind xmlns:D=\"DAV:\" xmlns:C=\"urn:ietf:params:xml:ns:caldav\"><D:prop><D:resourcetype/><D:displayname/><C:supported-calendar-component-set/></D:prop></D:propfind>";
const MANUAL_BODY: &str = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<D:propfind xmlns:D=\"DAV:\"><D:prop><D:resourcetype/><D:displayname/></D:prop></D:propfind>";

// =====================================================================
// Client
// =====================================================================

pub struct CaldavClient {
    http: Client,
    calendar_url: String,
    username: String,
    password: String,
    supports_expand: bool,
}

impl CaldavClient {
    /// Bouwt een client voor een reeds ontdekte agenda-collectie.
    pub fn new(
        calendar_url: String,
        username: String,
        password: String,
        supports_expand: bool,
    ) -> std::result::Result<Self, String> {
        let http = build_http()?;
        Ok(Self {
            http,
            calendar_url,
            username,
            password,
            supports_expand,
        })
    }

    /// Verstuurt een verzoek en volgt redirects zelf (behoud van auth + body).
    async fn send(
        &self,
        method: Method,
        url: &str,
        headers: &[(&str, &str)],
        body: Option<&str>,
    ) -> Result<DavResponse> {
        dav_send(
            &self.http,
            &self.username,
            &self.password,
            method,
            url,
            headers,
            body,
        )
        .await
    }

    /// Herstelt een absolute URL uit een (mogelijk relatieve) opgeslagen href.
    fn resolve_href(&self, href: &str) -> Result<String> {
        resolve(&self.calendar_url, href).ok_or_else(|| anyhow!("Ongeldige afspraak-verwijzing."))
    }

    /// Leest de huidige ETag van een resource (fallback als een PUT er geen teruggeeft).
    async fn fetch_etag(&self, url: &str) -> Option<String> {
        self.send(Method::GET, url, &[], None).await.ok()?.etag
    }

    // ---- De zes agenda-methodes (spiegelen GraphClient) ----

    pub async fn list_events(&self, start_iso: &str, end_iso: &str) -> Result<Vec<Event>> {
        let range_start = local_to_utc(
            parse_local_naive(start_iso).ok_or_else(|| anyhow!("Ongeldige begindatum."))?,
        );
        let range_end =
            local_to_utc(parse_local_naive(end_iso).ok_or_else(|| anyhow!("Ongeldige einddatum."))?);
        let start_z = basic_z(range_start);
        let end_z = basic_z(range_end);

        let cal_data = if self.supports_expand {
            format!("<C:calendar-data><C:expand start=\"{start_z}\" end=\"{end_z}\"/></C:calendar-data>")
        } else {
            "<C:calendar-data/>".to_string()
        };
        let body = format!(
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<C:calendar-query xmlns:D=\"DAV:\" xmlns:C=\"urn:ietf:params:xml:ns:caldav\"><D:prop><D:getetag/>{cal_data}</D:prop><C:filter><C:comp-filter name=\"VCALENDAR\"><C:comp-filter name=\"VEVENT\"><C:time-range start=\"{start_z}\" end=\"{end_z}\"/></C:comp-filter></C:comp-filter></C:filter></C:calendar-query>"
        );

        let resp = self
            .send(
                report_method(),
                &self.calendar_url,
                &[
                    ("Depth", "1"),
                    ("Content-Type", "application/xml; charset=utf-8"),
                ],
                Some(&body),
            )
            .await?;
        if !resp.status.is_success() {
            bail!("De agenda-server gaf een fout (HTTP {}).", resp.status.as_u16());
        }

        let mut out = Vec::new();
        for item in parse_multistatus(&resp.body) {
            let (Some(href), Some(data)) = (item.href.as_ref(), item.calendar_data.as_ref()) else {
                continue;
            };
            let etag = item.etag.clone().unwrap_or_default();
            let Ok(cal) = icalendar::parser::read_calendar(data) else {
                continue;
            };
            for comp in &cal.components {
                if comp.name.as_str().eq_ignore_ascii_case("VEVENT") {
                    map_vevent(comp, href, &etag, range_start, range_end, &mut out);
                }
            }
        }
        Ok(out)
    }

    pub async fn create_event(&self, input: &EventInput) -> Result<Event> {
        let uid = Uuid::new_v4().to_string();
        let ics = build_event_ics(input, &uid)?;
        let filename = utf8_percent_encode(&format!("{uid}.ics"), PATH_SEG).to_string();
        let url = join_url(&ensure_trailing_slash(&self.calendar_url), &filename)?;

        let resp = self
            .send(
                Method::PUT,
                &url,
                &[
                    ("If-None-Match", "*"),
                    ("Content-Type", "text/calendar; charset=utf-8"),
                ],
                Some(&ics),
            )
            .await?;
        if resp.status == StatusCode::PRECONDITION_FAILED {
            bail!("{CONFLICT_NL}");
        }
        if !resp.status.is_success() {
            bail!(
                "De afspraak kon niet worden aangemaakt (HTTP {}).",
                resp.status.as_u16()
            );
        }

        let etag = match resp.etag.clone() {
            Some(e) => e,
            None => self.fetch_etag(&url).await.unwrap_or_default(),
        };
        Ok(event_from_input(input, make_event_id(&url, &etag, &uid, None)))
    }

    pub async fn update_event(&self, id: &str, input: &EventInput) -> Result<Event> {
        let (href, etag, uid, _rec) = parse_event_id(id)?;
        let url = self.resolve_href(&href)?;

        let get = self.send(Method::GET, &url, &[], None).await?;
        if !get.status.is_success() {
            bail!("Kon de afspraak niet ophalen (HTTP {}).", get.status.as_u16());
        }
        ensure_not_recurring(&get.body)?;

        let (dtstart, dtend) = build_dt_lines(input)?;
        let patch = IcsPatch {
            summary: Some(ical_text_escape(&input.subject)),
            description: Some(ical_text_escape(input.body.as_deref().unwrap_or(""))),
            location: Some(ical_text_escape(input.location.as_deref().unwrap_or(""))),
            dtstart_line: Some(dtstart),
            dtend_line: Some(dtend),
        };
        let patched = apply_patch(&get.body, &patch);

        let ifm = strip_weak(&etag);
        let put = self
            .send(
                Method::PUT,
                &url,
                &[
                    ("If-Match", ifm.as_str()),
                    ("Content-Type", "text/calendar; charset=utf-8"),
                ],
                Some(&patched),
            )
            .await?;
        if put.status == StatusCode::PRECONDITION_FAILED {
            bail!("{CONFLICT_NL}");
        }
        if !put.status.is_success() {
            bail!(
                "De afspraak kon niet worden bijgewerkt (HTTP {}).",
                put.status.as_u16()
            );
        }

        let new_etag = match put.etag.clone() {
            Some(e) => e,
            None => self.fetch_etag(&url).await.unwrap_or(etag),
        };
        Ok(event_from_input(
            input,
            make_event_id(&href, &new_etag, &uid, None),
        ))
    }

    pub async fn update_event_times(&self, id: &str, start: &str, end: &str) -> Result<()> {
        let (href, etag, _uid, _rec) = parse_event_id(id)?;
        let url = self.resolve_href(&href)?;

        let get = self.send(Method::GET, &url, &[], None).await?;
        if !get.status.is_success() {
            bail!("Kon de afspraak niet ophalen (HTTP {}).", get.status.as_u16());
        }
        ensure_not_recurring(&get.body)?;

        // Slepen in de agenda betreft getimede afspraken; UTC op de draad.
        let s = local_to_utc(parse_local_naive(start).ok_or_else(|| anyhow!("Ongeldige starttijd."))?);
        let e = local_to_utc(parse_local_naive(end).ok_or_else(|| anyhow!("Ongeldige eindtijd."))?);
        let patch = IcsPatch {
            summary: None,
            description: None,
            location: None,
            dtstart_line: Some(format!("DTSTART:{}", basic_z(s))),
            dtend_line: Some(format!("DTEND:{}", basic_z(e))),
        };
        let patched = apply_patch(&get.body, &patch);

        let ifm = strip_weak(&etag);
        let put = self
            .send(
                Method::PUT,
                &url,
                &[
                    ("If-Match", ifm.as_str()),
                    ("Content-Type", "text/calendar; charset=utf-8"),
                ],
                Some(&patched),
            )
            .await?;
        if put.status == StatusCode::PRECONDITION_FAILED {
            bail!("{CONFLICT_NL}");
        }
        if !put.status.is_success() {
            bail!(
                "De afspraak kon niet worden verplaatst (HTTP {}).",
                put.status.as_u16()
            );
        }
        Ok(())
    }

    /// CalDAV kent geen personen-zoekopdracht; lege lijst (frontend valt terug).
    pub async fn search_people(&self, _query: &str) -> Result<Vec<Person>> {
        Ok(Vec::new())
    }

    pub async fn delete_event(&self, id: &str) -> Result<()> {
        let (href, etag, _uid, _rec) = parse_event_id(id)?;
        let url = self.resolve_href(&href)?;

        // Eerst de .ics ophalen: één bestand bevat de hele reeks, dus een reeks
        // verwijderen zou alle voorkomens weggooien. Bestaat de resource al niet
        // meer (404), dan slaan we de check over en laat de DELETE dat afhandelen.
        let get = self.send(Method::GET, &url, &[], None).await?;
        if get.status.is_success() {
            ensure_not_recurring(&get.body)?;
        }

        let ifm = strip_weak(&etag);
        let resp = self
            .send(Method::DELETE, &url, &[("If-Match", ifm.as_str())], None)
            .await?;
        if resp.status == StatusCode::NOT_FOUND {
            return Ok(()); // al weg = klaar
        }
        if resp.status == StatusCode::PRECONDITION_FAILED {
            bail!("{CONFLICT_NL}");
        }
        if !resp.status.is_success() {
            bail!(
                "De afspraak kon niet worden verwijderd (HTTP {}).",
                resp.status.as_u16()
            );
        }
        Ok(())
    }
}

// =====================================================================
// Discovery (best-effort; elke fout => Ok(None) = gewoon geen agenda)
// =====================================================================

/// Detecteert de CalDAV-agenda bij een IMAP-account. Faalt dit (welke reden dan
/// ook), dan krijgt het account simpelweg geen agenda (`Ok(None)`).
pub async fn discover(
    email: &str,
    imap_host: &str,
    username: &str,
    password: &str,
    manual_url: Option<String>,
) -> std::result::Result<Option<CaldavSettings>, String> {
    let http = match build_http() {
        Ok(h) => h,
        Err(_) => return Ok(None),
    };
    let email_l = email.trim().to_lowercase();
    let domain = email_l.rsplit('@').next().unwrap_or("").to_string();

    // 0. Handmatige URL bevestigen (resourcetype = calendar).
    if let Some(m) = manual_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if let Some(cs) = try_manual(&http, username, password, m).await {
            return Ok(Some(cs));
        }
        // Ongeldig? Val alsnog terug op automatische ontdekking.
    }

    // 1. Provider-tabel op e-maildomein, anders kandidaten uit domein/imap-host.
    let seeds: Vec<String> = match domain.as_str() {
        "icloud.com" | "me.com" | "mac.com" => vec!["https://caldav.icloud.com".to_string()],
        "fastmail.com" | "messagingengine.com" => vec!["https://caldav.fastmail.com".to_string()],
        // Google vereist OAuth (geen app-wachtwoord voor CalDAV) -> geen agenda.
        "gmail.com" | "googlemail.com" => return Ok(None),
        // Consumenten-Microsoft heeft geen CalDAV.
        "outlook.com" | "hotmail.com" | "live.com" | "msn.com" => return Ok(None),
        _ => {
            let mut v = Vec::new();
            if !domain.is_empty() {
                v.push(format!("https://{domain}"));
            }
            let host = imap_host.trim();
            let host = host.strip_prefix("imap.").unwrap_or(host);
            if !host.is_empty() && host != domain {
                v.push(format!("https://{host}"));
            }
            v
        }
    };

    for base in seeds {
        if let Some(cs) = discover_from_base(&http, username, password, &base).await {
            return Ok(Some(cs));
        }
    }
    Ok(None)
}

/// Bevestigt een handmatig opgegeven agenda-URL.
async fn try_manual(http: &Client, user: &str, pass: &str, url: &str) -> Option<CaldavSettings> {
    let resp = dav_send(
        http,
        user,
        pass,
        propfind_method(),
        url,
        &[
            ("Depth", "0"),
            ("Content-Type", "application/xml; charset=utf-8"),
        ],
        Some(MANUAL_BODY),
    )
    .await
    .ok()?;
    if !resp.status.is_success() {
        return None;
    }
    let r = parse_multistatus(&resp.body).into_iter().next()?;
    if !r.resourcetype.iter().any(|s| s.eq_ignore_ascii_case("calendar")) {
        return None;
    }
    let cal_url = resp.final_url.clone();
    Some(CaldavSettings {
        display_name: r.displayname.clone(),
        caldav_host: host_of(&cal_url),
        supports_expand: probe_expand(http, user, pass, &cal_url).await,
        discovered_at: Utc::now().timestamp(),
        caldav_username: Some(user.to_string()),
        principal_url: None,
        home_set_url: None,
        calendar_url: cal_url,
    })
}

/// De volledige ontdekkings-pijplijn vanaf een basis-URL.
async fn discover_from_base(
    http: &Client,
    user: &str,
    pass: &str,
    base: &str,
) -> Option<CaldavSettings> {
    // 2. .well-known/caldav (redirect wordt binnen dav_send gevolgd).
    let mut ctx = base.to_string();
    let mut principal_href: Option<String> = None;
    let wk = Url::parse(base).ok()?.join("/.well-known/caldav").ok()?.to_string();
    if let Ok(resp) = dav_send(
        http,
        user,
        pass,
        propfind_method(),
        &wk,
        &[
            ("Depth", "0"),
            ("Content-Type", "application/xml; charset=utf-8"),
        ],
        Some(PRINCIPAL_BODY),
    )
    .await
    {
        ctx = resp.final_url.clone();
        if resp.status.is_success() {
            principal_href = first_principal(&resp.body);
        }
    }

    // 3. current-user-principal op de context-URL.
    if principal_href.is_none() {
        let resp = dav_send(
            http,
            user,
            pass,
            propfind_method(),
            &ctx,
            &[
                ("Depth", "0"),
                ("Content-Type", "application/xml; charset=utf-8"),
            ],
            Some(PRINCIPAL_BODY),
        )
        .await
        .ok()?;
        if resp.status.is_success() {
            ctx = resp.final_url.clone();
            principal_href = first_principal(&resp.body);
        }
    }
    let principal_url = resolve(&ctx, &principal_href?)?;

    // 4. calendar-home-set op het principal.
    let resp = dav_send(
        http,
        user,
        pass,
        propfind_method(),
        &principal_url,
        &[
            ("Depth", "0"),
            ("Content-Type", "application/xml; charset=utf-8"),
        ],
        Some(HOMESET_BODY),
    )
    .await
    .ok()?;
    let home_url = resolve(&resp.final_url, &first_home(&resp.body)?)?;

    // 5. Collecties onder home opsommen (Depth: 1).
    let resp = dav_send(
        http,
        user,
        pass,
        propfind_method(),
        &home_url,
        &[
            ("Depth", "1"),
            ("Content-Type", "application/xml; charset=utf-8"),
        ],
        Some(ENUM_BODY),
    )
    .await
    .ok()?;

    let mut cands: Vec<(String, Option<String>)> = Vec::new();
    for it in &parse_multistatus(&resp.body) {
        let is_cal = it.resourcetype.iter().any(|s| s.eq_ignore_ascii_case("calendar"));
        // Componentenlijst is optioneel; als de server niets meldt, niet uitsluiten.
        let has_vevent =
            it.comps.is_empty() || it.comps.iter().any(|c| c.eq_ignore_ascii_case("VEVENT"));
        if is_cal && has_vevent {
            if let Some(href) = it.href.as_ref() {
                if let Some(abs) = resolve(&resp.final_url, href) {
                    cands.push((abs, it.displayname.clone()));
                }
            }
        }
    }

    // Voorkeur voor een collectie die "Calendar"/"Agenda" heet, anders de eerste.
    let (calendar_url, display_name) = cands
        .iter()
        .find(|(_, n)| {
            n.as_deref()
                .map(|n| {
                    let l = n.to_lowercase();
                    l == "calendar" || l == "agenda"
                })
                .unwrap_or(false)
        })
        .cloned()
        .or_else(|| cands.first().cloned())?;

    Some(CaldavSettings {
        supports_expand: probe_expand(http, user, pass, &calendar_url).await,
        caldav_host: host_of(&calendar_url),
        display_name,
        discovered_at: Utc::now().timestamp(),
        caldav_username: Some(user.to_string()),
        principal_url: Some(principal_url),
        home_set_url: Some(home_url),
        calendar_url,
    })
}

/// Probeert een `<C:expand>`-REPORT; succes = de server accepteert het verzoek.
async fn probe_expand(http: &Client, user: &str, pass: &str, calendar_url: &str) -> bool {
    let now = Utc::now();
    let start = basic_z(now);
    let end = basic_z(now + Duration::days(1));
    let body = format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<C:calendar-query xmlns:D=\"DAV:\" xmlns:C=\"urn:ietf:params:xml:ns:caldav\"><D:prop><D:getetag/><C:calendar-data><C:expand start=\"{start}\" end=\"{end}\"/></C:calendar-data></D:prop><C:filter><C:comp-filter name=\"VCALENDAR\"><C:comp-filter name=\"VEVENT\"><C:time-range start=\"{start}\" end=\"{end}\"/></C:comp-filter></C:comp-filter></C:filter></C:calendar-query>"
    );
    matches!(
        dav_send(
            http,
            user,
            pass,
            report_method(),
            calendar_url,
            &[
                ("Depth", "1"),
                ("Content-Type", "application/xml; charset=utf-8"),
            ],
            Some(&body),
        )
        .await,
        Ok(resp) if resp.status.is_success()
    )
}

// =====================================================================
// HTTP-laag (redirect zelf volgen, auth + body behouden)
// =====================================================================

struct DavResponse {
    status: StatusCode,
    body: String,
    etag: Option<String>,
    /// De uiteindelijke URL na eventuele redirects (om op te herbaseren).
    final_url: String,
}

fn build_http() -> std::result::Result<Client, String> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(StdDuration::from_secs(30))
        .build()
        .map_err(|e| format!("Kon de agenda-verbinding niet opzetten: {e}"))
}

async fn dav_send(
    http: &Client,
    user: &str,
    pass: &str,
    method: Method,
    url: &str,
    headers: &[(&str, &str)],
    body: Option<&str>,
) -> Result<DavResponse> {
    let mut current = url.to_string();
    for _ in 0..6 {
        let mut req = http
            .request(method.clone(), &current)
            .basic_auth(user, Some(pass));
        for (k, v) in headers {
            req = req.header(*k, *v);
        }
        if let Some(b) = body {
            req = req.body(b.to_string());
        }
        let resp = req
            .send()
            .await
            .map_err(|e| anyhow!("Netwerkfout richting de agenda-server: {e}"))?;
        let status = resp.status();

        // Cross-host redirect zelf volgen (reqwest zou anders auth + body droppen).
        if matches!(status.as_u16(), 301 | 302 | 307 | 308) {
            if let Some(loc) = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
            {
                let next = Url::parse(&current)
                    .and_then(|b| b.join(loc))
                    .map_err(|e| anyhow!("Ongeldige redirect van de agenda-server: {e}"))?;
                current = next.to_string();
                continue;
            }
        }

        let etag = resp
            .headers()
            .get(reqwest::header::ETAG)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let final_url = current.clone();
        let body = resp
            .text()
            .await
            .map_err(|e| anyhow!("Kon het antwoord van de agenda-server niet lezen: {e}"))?;
        return Ok(DavResponse {
            status,
            body,
            etag,
            final_url,
        });
    }
    bail!("Te veel omleidingen van de agenda-server.")
}

fn propfind_method() -> Method {
    Method::from_bytes(b"PROPFIND").expect("PROPFIND is een geldige HTTP-methode")
}

fn report_method() -> Method {
    Method::from_bytes(b"REPORT").expect("REPORT is een geldige HTTP-methode")
}

// =====================================================================
// XML-parser (streaming; matcht op lokale elementnamen, negeert prefixes)
// =====================================================================

#[derive(Default, Clone)]
struct RespProp {
    /// De href op response-niveau (direct kind van `<response>`).
    href: Option<String>,
    etag: Option<String>,
    calendar_data: Option<String>,
    displayname: Option<String>,
    /// Lokale namen van de kinderen van `<resourcetype>` (bv. "calendar").
    resourcetype: Vec<String>,
    /// `name`-attributen van `<comp>` in supported-calendar-component-set.
    comps: Vec<String>,
    /// href genest in `<current-user-principal>`.
    principal_href: Option<String>,
    /// href genest in `<calendar-home-set>`.
    home_href: Option<String>,
}

fn parse_multistatus(xml: &str) -> Vec<RespProp> {
    let mut reader = Reader::from_str(xml);
    let mut out: Vec<RespProp> = Vec::new();
    let mut cur: Option<RespProp> = None;
    let mut stack: Vec<String> = Vec::new();
    let mut text = String::new();

    loop {
        match reader.read_event() {
            Ok(XmlEvent::Start(e)) => {
                let ln = lc_name(e.local_name().as_ref());
                if ln == "response" {
                    cur = Some(RespProp::default());
                }
                if stack.last().map(|s| s == "resourcetype").unwrap_or(false) {
                    if let Some(c) = cur.as_mut() {
                        c.resourcetype.push(ln.clone());
                    }
                }
                if ln == "comp" {
                    if let (Some(name), Some(c)) = (get_attr(&e, "name"), cur.as_mut()) {
                        c.comps.push(name);
                    }
                }
                stack.push(ln);
                text.clear();
            }
            Ok(XmlEvent::Empty(e)) => {
                let ln = lc_name(e.local_name().as_ref());
                if stack.last().map(|s| s == "resourcetype").unwrap_or(false) {
                    if let Some(c) = cur.as_mut() {
                        c.resourcetype.push(ln.clone());
                    }
                }
                if ln == "comp" {
                    if let (Some(name), Some(c)) = (get_attr(&e, "name"), cur.as_mut()) {
                        c.comps.push(name);
                    }
                }
            }
            Ok(XmlEvent::Text(t)) => {
                if let Ok(s) = t.xml10_content() {
                    text.push_str(s.as_ref());
                }
            }
            Ok(XmlEvent::CData(t)) => {
                if let Ok(s) = t.decode() {
                    text.push_str(s.as_ref());
                }
            }
            Ok(XmlEvent::End(e)) => {
                let ln = lc_name(e.local_name().as_ref());
                match ln.as_str() {
                    "href" => {
                        let val = text.trim().to_string();
                        if !val.is_empty() {
                            if let Some(c) = cur.as_mut() {
                                if stack.iter().any(|s| s == "current-user-principal") {
                                    c.principal_href.get_or_insert(val);
                                } else if stack.iter().any(|s| s == "calendar-home-set") {
                                    c.home_href.get_or_insert(val);
                                } else {
                                    c.href.get_or_insert(val);
                                }
                            }
                        }
                    }
                    "getetag" => {
                        if let Some(c) = cur.as_mut() {
                            c.etag = Some(text.trim().to_string());
                        }
                    }
                    "calendar-data" => {
                        if let Some(c) = cur.as_mut() {
                            c.calendar_data = Some(text.clone());
                        }
                    }
                    "displayname" => {
                        let v = text.trim().to_string();
                        if !v.is_empty() {
                            if let Some(c) = cur.as_mut() {
                                c.displayname = Some(v);
                            }
                        }
                    }
                    "response" => {
                        if let Some(c) = cur.take() {
                            out.push(c);
                        }
                    }
                    _ => {}
                }
                stack.pop();
                text.clear();
            }
            Ok(XmlEvent::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }
    out
}

fn lc_name(name: &[u8]) -> String {
    String::from_utf8_lossy(name).to_ascii_lowercase()
}

fn get_attr(e: &BytesStart, key: &str) -> Option<String> {
    for a in e.attributes().flatten() {
        if a.key.local_name().as_ref().eq_ignore_ascii_case(key.as_bytes()) {
            return Some(String::from_utf8_lossy(&a.value).to_string());
        }
    }
    None
}

fn first_principal(xml: &str) -> Option<String> {
    parse_multistatus(xml).into_iter().find_map(|r| r.principal_href)
}

fn first_home(xml: &str) -> Option<String> {
    parse_multistatus(xml).into_iter().find_map(|r| r.home_href)
}

// =====================================================================
// VEVENT -> Event (lezen)
// =====================================================================

/// Een tijdstip zoals het uit een .ics komt.
enum IcalTime {
    AllDay(NaiveDate),
    Utc(DateTime<Utc>),
    /// Zwevende tijd (geen zone) - behandeld als wandkloktijd in de account-zone.
    Floating(NaiveDateTime),
}

fn map_vevent(
    vevent: &icalendar::parser::Component<'_>,
    href: &str,
    etag: &str,
    range_start: DateTime<Utc>,
    range_end: DateTime<Utc>,
    out: &mut Vec<Event>,
) {
    let uid = find_prop(vevent, "UID")
        .map(|p| p.val.as_str().to_string())
        .unwrap_or_default();
    let subject = find_prop(vevent, "SUMMARY").map(|p| ical_text_unescape(p.val.as_str()));
    let body_preview =
        find_prop(vevent, "DESCRIPTION").map(|p| truncate(&ical_text_unescape(p.val.as_str()), 200));
    let location = find_prop(vevent, "LOCATION").map(|p| EventLocation {
        display_name: Some(ical_text_unescape(p.val.as_str())),
    });
    let organizer = find_prop(vevent, "ORGANIZER").and_then(parse_organizer);
    let is_cancelled =
        find_prop(vevent, "STATUS").map(|p| p.val.as_str().eq_ignore_ascii_case("CANCELLED"));

    let Some(start_t) = find_prop(vevent, "DTSTART").and_then(parse_ical_dt) else {
        return;
    };
    let end_t = find_prop(vevent, "DTEND").and_then(parse_ical_dt);
    let rrule = find_prop(vevent, "RRULE").map(|p| p.val.as_str().to_string());

    // Heeft de VEVENT nog een RRULE (server klapte niet uit)? Dan client-side.
    if let Some(rr) = rrule {
        let all_day = matches!(start_t, IcalTime::AllDay(_));
        let exdates: Vec<DateTime<Utc>> = vevent
            .properties
            .iter()
            .filter(|p| p.name.as_str().eq_ignore_ascii_case("EXDATE"))
            .flat_map(|p| {
                let params = &p.params;
                p.val
                    .as_str()
                    .split(',')
                    .filter_map(|v| parse_ical_time(v.trim(), params).map(|t| ical_to_utc(&t)))
                    .collect::<Vec<_>>()
            })
            .collect();
        push_recurring(RecurringCtx {
            out,
            href,
            etag,
            uid: &uid,
            subject: &subject,
            body_preview: &body_preview,
            location: &location,
            organizer: &organizer,
            is_cancelled,
            start_t: &start_t,
            end_t: &end_t,
            all_day,
            rrule: &rr,
            exdates: &exdates,
            range_start,
            range_end,
        });
    } else {
        let (s_dt, e_dt, all_day) = start_end_strings(&start_t, &end_t);
        let rec_id = find_prop(vevent, "RECURRENCE-ID")
            .and_then(parse_ical_dt)
            .map(|t| basic_z(ical_to_utc(&t)));
        out.push(Event {
            id: make_event_id(href, etag, &uid, rec_id.as_deref()),
            subject,
            body_preview,
            start: DateTimeTimeZone {
                date_time: s_dt,
                time_zone: DEFAULT_TZ.to_string(),
            },
            end: DateTimeTimeZone {
                date_time: e_dt,
                time_zone: DEFAULT_TZ.to_string(),
            },
            is_all_day: Some(all_day),
            location,
            organizer,
            is_cancelled,
        });
    }
}

/// Bundelt de velden voor het client-side uitklappen van een herhaling.
struct RecurringCtx<'a> {
    out: &'a mut Vec<Event>,
    href: &'a str,
    etag: &'a str,
    uid: &'a str,
    subject: &'a Option<String>,
    body_preview: &'a Option<String>,
    location: &'a Option<EventLocation>,
    organizer: &'a Option<Recipient>,
    is_cancelled: Option<bool>,
    start_t: &'a IcalTime,
    end_t: &'a Option<IcalTime>,
    all_day: bool,
    rrule: &'a str,
    exdates: &'a [DateTime<Utc>],
    range_start: DateTime<Utc>,
    range_end: DateTime<Utc>,
}

/// Klapt een herhaling client-side uit met `rrule`, geknipt op [start, end).
fn push_recurring(ctx: RecurringCtx<'_>) {
    let start_utc = ical_to_utc(ctx.start_t);
    let end_utc = ctx.end_t.as_ref().map(ical_to_utc).unwrap_or(start_utc);
    let duration = end_utc - start_utc;

    let mut set_str = format!("DTSTART:{}\nRRULE:{}", basic_z(start_utc), ctx.rrule);
    if !ctx.exdates.is_empty() {
        let ex: Vec<String> = ctx.exdates.iter().map(|d| basic_z(*d)).collect();
        set_str.push_str(&format!("\nEXDATE:{}", ex.join(",")));
    }
    let Ok(set) = set_str.parse::<RRuleSet>() else {
        return;
    };

    let after = ctx.range_start.with_timezone(&rrule::Tz::UTC);
    let before = ctx.range_end.with_timezone(&rrule::Tz::UTC);
    let result = set.after(after).before(before).all(MAX_INSTANCES);

    for occ in result.dates {
        let occ_utc = occ.with_timezone(&Utc);
        if occ_utc < ctx.range_start || occ_utc >= ctx.range_end {
            continue;
        }
        let (s_dt, e_dt) = if ctx.all_day {
            let d = occ_utc.with_timezone(&account_tz()).date_naive();
            let day = format!("{}T00:00:00", d.format("%Y-%m-%d"));
            (day.clone(), day)
        } else {
            let occ_end = occ_utc + duration;
            (utc_to_local_naive(occ_utc), utc_to_local_naive(occ_end))
        };
        ctx.out.push(Event {
            id: make_event_id(ctx.href, ctx.etag, ctx.uid, Some(&basic_z(occ_utc))),
            subject: ctx.subject.clone(),
            body_preview: ctx.body_preview.clone(),
            start: DateTimeTimeZone {
                date_time: s_dt,
                time_zone: DEFAULT_TZ.to_string(),
            },
            end: DateTimeTimeZone {
                date_time: e_dt,
                time_zone: DEFAULT_TZ.to_string(),
            },
            is_all_day: Some(ctx.all_day),
            location: ctx.location.clone(),
            organizer: ctx.organizer.clone(),
            is_cancelled: ctx.is_cancelled,
        });
    }
}

fn find_prop<'a, 'i>(
    c: &'a icalendar::parser::Component<'i>,
    name: &str,
) -> Option<&'a icalendar::parser::Property<'i>> {
    c.properties
        .iter()
        .find(|p| p.name.as_str().eq_ignore_ascii_case(name))
}

fn parse_ical_dt(prop: &icalendar::parser::Property<'_>) -> Option<IcalTime> {
    parse_ical_time(prop.val.as_str(), &prop.params)
}

fn parse_ical_time(val: &str, params: &[icalendar::parser::Parameter<'_>]) -> Option<IcalTime> {
    let val = val.trim();
    let is_date = params.iter().any(|p| {
        p.key.as_str().eq_ignore_ascii_case("VALUE")
            && p.val
                .as_ref()
                .map(|v| v.as_str().eq_ignore_ascii_case("DATE"))
                .unwrap_or(false)
    });
    if is_date || (val.len() == 8 && !val.contains('T')) {
        return NaiveDate::parse_from_str(val, "%Y%m%d").ok().map(IcalTime::AllDay);
    }
    if let Some(body) = val.strip_suffix('Z').or_else(|| val.strip_suffix('z')) {
        return parse_basic_naive(body).map(|ndt| IcalTime::Utc(Utc.from_utc_datetime(&ndt)));
    }
    let ndt = parse_basic_naive(val)?;
    let tzid = params
        .iter()
        .find(|p| p.key.as_str().eq_ignore_ascii_case("TZID"))
        .and_then(|p| p.val.as_ref().map(|v| v.as_str().to_string()));
    if let Some(tz) = tzid {
        let zone = tzid_to_iana(&tz);
        return Some(match zone.from_local_datetime(&ndt) {
            LocalResult::Single(dt) => IcalTime::Utc(dt.with_timezone(&Utc)),
            LocalResult::Ambiguous(dt, _) => IcalTime::Utc(dt.with_timezone(&Utc)),
            LocalResult::None => IcalTime::Floating(ndt),
        });
    }
    Some(IcalTime::Floating(ndt))
}

fn parse_basic_naive(s: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(s, "%Y%m%dT%H%M%S").ok()
}

fn parse_organizer(prop: &icalendar::parser::Property<'_>) -> Option<Recipient> {
    let v = prop.val.as_str().trim();
    let addr = if v.len() >= 7 && v[..7].eq_ignore_ascii_case("mailto:") {
        v[7..].trim()
    } else {
        v
    };
    if addr.is_empty() {
        return None;
    }
    let name = prop
        .params
        .iter()
        .find(|p| p.key.as_str().eq_ignore_ascii_case("CN"))
        .and_then(|p| p.val.as_ref().map(|v| v.as_str().to_string()));
    Some(Recipient {
        email_address: EmailAddress {
            name,
            address: Some(addr.to_string()),
        },
    })
}

/// (start, end, is_all_day) als zone-loze lokale strings voor een enkele afspraak.
fn start_end_strings(start_t: &IcalTime, end_t: &Option<IcalTime>) -> (String, String, bool) {
    let (s, all_day) = emit_datetime(start_t);
    let e = match end_t {
        // iCal DTEND is exclusief -> 1 dag terug voor een inclusieve einddatum.
        Some(IcalTime::AllDay(d)) => {
            let incl = *d - Duration::days(1);
            format!("{}T00:00:00", incl.format("%Y-%m-%d"))
        }
        Some(t) => emit_datetime(t).0,
        None => s.clone(),
    };
    (s, e, all_day)
}

fn emit_datetime(t: &IcalTime) -> (String, bool) {
    match t {
        IcalTime::AllDay(d) => (format!("{}T00:00:00", d.format("%Y-%m-%d")), true),
        IcalTime::Utc(u) => (utc_to_local_naive(*u), false),
        IcalTime::Floating(ndt) => (ndt.format("%Y-%m-%dT%H:%M:%S").to_string(), false),
    }
}

fn ical_to_utc(t: &IcalTime) -> DateTime<Utc> {
    match t {
        IcalTime::AllDay(d) => local_to_utc(d.and_hms_opt(0, 0, 0).unwrap_or_default()),
        IcalTime::Utc(u) => *u,
        IcalTime::Floating(ndt) => local_to_utc(*ndt),
    }
}

// =====================================================================
// EventInput -> VEVENT (schrijven)
// =====================================================================

fn build_event_ics(input: &EventInput, uid: &str) -> Result<String> {
    let (dtstart, dtend) = build_dt_lines(input)?;
    let mut lines = vec![
        "BEGIN:VCALENDAR".to_string(),
        "VERSION:2.0".to_string(),
        "PRODID:-//BE-Mail//CalDAV//NL".to_string(),
        "CALSCALE:GREGORIAN".to_string(),
        "BEGIN:VEVENT".to_string(),
        format!("UID:{uid}"),
        format!("DTSTAMP:{}", basic_z(Utc::now())),
        dtstart,
        dtend,
        format!("SUMMARY:{}", ical_text_escape(&input.subject)),
    ];
    if let Some(b) = input.body.as_deref().filter(|b| !b.is_empty()) {
        lines.push(format!("DESCRIPTION:{}", ical_text_escape(b)));
    }
    if let Some(l) = input.location.as_deref().filter(|l| !l.is_empty()) {
        lines.push(format!("LOCATION:{}", ical_text_escape(l)));
    }
    for a in &input.attendees {
        let a = a.trim();
        if !a.is_empty() {
            // Let op: geen iTIP-scheduling POST -> er gaat geen uitnodiging de deur uit.
            lines.push(format!("ATTENDEE;CN={a}:mailto:{a}"));
        }
    }
    if let Some(rec) = input.recurrence.as_ref() {
        if let Some(rr) = build_rrule(rec, &input.start) {
            lines.push(format!("RRULE:{rr}"));
        }
    }
    if let Some(m) = input.reminder_minutes {
        lines.push("BEGIN:VALARM".to_string());
        lines.push("ACTION:DISPLAY".to_string());
        lines.push("DESCRIPTION:Herinnering".to_string());
        lines.push(format!("TRIGGER:-PT{m}M"));
        lines.push("END:VALARM".to_string());
    }
    lines.push("END:VEVENT".to_string());
    lines.push("END:VCALENDAR".to_string());
    Ok(lines.join("\r\n") + "\r\n")
}

/// Bouwt de DTSTART/DTEND-regels: UTC op de draad (dus geen VTIMEZONE nodig),
/// of `VALUE=DATE` bij een hele-dag-afspraak (DTEND exclusief).
fn build_dt_lines(input: &EventInput) -> Result<(String, String)> {
    if input.is_all_day {
        let sd = date_part(&input.start).ok_or_else(|| anyhow!("Ongeldige startdatum."))?;
        let ed = date_part(&input.end).unwrap_or(sd);
        let excl = if ed <= sd { sd } else { ed } + Duration::days(1);
        Ok((
            format!("DTSTART;VALUE=DATE:{}", sd.format("%Y%m%d")),
            format!("DTEND;VALUE=DATE:{}", excl.format("%Y%m%d")),
        ))
    } else {
        let s = local_to_utc(parse_local_naive(&input.start).ok_or_else(|| anyhow!("Ongeldige starttijd."))?);
        let e = local_to_utc(parse_local_naive(&input.end).ok_or_else(|| anyhow!("Ongeldige eindtijd."))?);
        Ok((
            format!("DTSTART:{}", basic_z(s)),
            format!("DTEND:{}", basic_z(e)),
        ))
    }
}

/// RRULE-tekst die de Graph-logica in `graph.rs` spiegelt.
fn build_rrule(rec: &RecurrenceInput, start: &str) -> Option<String> {
    let date = NaiveDate::parse_from_str(start.get(..10)?, "%Y-%m-%d").ok()?;
    let interval = rec.interval.unwrap_or(1).max(1);
    let mut parts: Vec<String> = Vec::new();
    match rec.frequency.as_str() {
        "daily" => parts.push("FREQ=DAILY".to_string()),
        "weekly" => {
            parts.push("FREQ=WEEKLY".to_string());
            parts.push(format!("BYDAY={}", weekday_code(date.weekday())));
        }
        "monthly" => {
            parts.push("FREQ=MONTHLY".to_string());
            parts.push(format!("BYMONTHDAY={}", date.day()));
        }
        "yearly" => {
            parts.push("FREQ=YEARLY".to_string());
            parts.push(format!("BYMONTH={}", date.month()));
            parts.push(format!("BYMONTHDAY={}", date.day()));
        }
        _ => return None,
    }
    if interval > 1 {
        parts.push(format!("INTERVAL={interval}"));
    }
    if let Some(until) = rec.until.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if let Ok(d) = NaiveDate::parse_from_str(until, "%Y-%m-%d") {
            parts.push(format!("UNTIL={}T235959Z", d.format("%Y%m%d")));
        }
    }
    Some(parts.join(";"))
}

fn weekday_code(w: chrono::Weekday) -> &'static str {
    match w {
        chrono::Weekday::Mon => "MO",
        chrono::Weekday::Tue => "TU",
        chrono::Weekday::Wed => "WE",
        chrono::Weekday::Thu => "TH",
        chrono::Weekday::Fri => "FR",
        chrono::Weekday::Sat => "SA",
        chrono::Weekday::Sun => "SU",
    }
}

/// Een `Event` opgebouwd uit de invoer (na een geslaagde PUT/patch).
fn event_from_input(input: &EventInput, id: String) -> Event {
    let (s_dt, e_dt) = if input.is_all_day {
        (
            format!("{}T00:00:00", date_str(&input.start)),
            format!("{}T00:00:00", date_str(&input.end)),
        )
    } else {
        (normalize_naive(&input.start), normalize_naive(&input.end))
    };
    Event {
        id,
        subject: Some(input.subject.clone()),
        body_preview: input.body.as_deref().map(|b| truncate(b, 200)),
        start: DateTimeTimeZone {
            date_time: s_dt,
            time_zone: DEFAULT_TZ.to_string(),
        },
        end: DateTimeTimeZone {
            date_time: e_dt,
            time_zone: DEFAULT_TZ.to_string(),
        },
        is_all_day: Some(input.is_all_day),
        location: input
            .location
            .clone()
            .filter(|l| !l.is_empty())
            .map(|l| EventLocation {
                display_name: Some(l),
            }),
        organizer: None,
        is_cancelled: Some(false),
    }
}

// =====================================================================
// Regel-patch op bestaande .ics (behoudt niet-gemodelleerde props)
// =====================================================================

struct IcsPatch {
    summary: Option<String>,
    description: Option<String>,
    location: Option<String>,
    dtstart_line: Option<String>,
    dtend_line: Option<String>,
}

/// Muteert alleen de doel-properties binnen de eerste VEVENT en laat de rest
/// (VALARM/ATTENDEE/RRULE/X-...) intact. Bewust geen parse->rebuild.
fn apply_patch(ics: &str, p: &IcsPatch) -> String {
    let unfolded = unfold(ics);
    let mut lines: Vec<String> = unfolded
        .split('\n')
        .map(|l| l.trim_end_matches('\r').to_string())
        .collect();

    let mut in_vevent = false;
    let mut done = false;
    let (mut has_sum, mut has_desc, mut has_loc) = (false, false, false);
    let mut end_idx: Option<usize> = None;

    for (i, line) in lines.iter_mut().enumerate() {
        let upper = line.to_ascii_uppercase();
        if upper.starts_with("BEGIN:VEVENT") {
            in_vevent = true;
            continue;
        }
        if upper.starts_with("END:VEVENT") {
            if in_vevent && !done {
                end_idx = Some(i);
                done = true;
                in_vevent = false;
            }
            continue;
        }
        if !in_vevent || done {
            continue;
        }
        if let Some(v) = &p.summary {
            if prop_is(&upper, "SUMMARY") {
                *line = format!("SUMMARY:{v}");
                has_sum = true;
                continue;
            }
        }
        if let Some(v) = &p.description {
            if prop_is(&upper, "DESCRIPTION") {
                *line = format!("DESCRIPTION:{v}");
                has_desc = true;
                continue;
            }
        }
        if let Some(v) = &p.location {
            if prop_is(&upper, "LOCATION") {
                *line = format!("LOCATION:{v}");
                has_loc = true;
                continue;
            }
        }
        if let Some(l) = &p.dtstart_line {
            if prop_is(&upper, "DTSTART") {
                *line = l.clone();
                continue;
            }
        }
        if let Some(l) = &p.dtend_line {
            if prop_is(&upper, "DTEND") {
                *line = l.clone();
                continue;
            }
        }
    }

    // Ontbrekende (tekst)properties invoegen vlak voor END:VEVENT.
    if let Some(idx) = end_idx {
        let mut ins: Vec<String> = Vec::new();
        if let (Some(v), false) = (&p.summary, has_sum) {
            ins.push(format!("SUMMARY:{v}"));
        }
        if let (Some(v), false) = (&p.description, has_desc) {
            ins.push(format!("DESCRIPTION:{v}"));
        }
        if let (Some(v), false) = (&p.location, has_loc) {
            ins.push(format!("LOCATION:{v}"));
        }
        for (k, line) in ins.into_iter().enumerate() {
            lines.insert(idx + k, line);
        }
    }

    let joined = lines.join("\r\n");
    if joined.ends_with("\r\n") {
        joined
    } else {
        format!("{joined}\r\n")
    }
}

/// Regelt: begint deze (hoofdletter-)regel met `NAME:` of `NAME;`?
fn prop_is(upper_line: &str, name: &str) -> bool {
    upper_line
        .strip_prefix(name)
        .map(|r| r.starts_with(':') || r.starts_with(';'))
        .unwrap_or(false)
}

/// Vouwt gevouwen iCal-regels uit (continuatie begint met spatie of tab).
fn unfold(s: &str) -> String {
    s.replace("\r\n ", "")
        .replace("\r\n\t", "")
        .replace("\n ", "")
        .replace("\n\t", "")
}

// =====================================================================
// Reeks-bescherming (terugkerende afspraken zijn v1 niet los bewerkbaar)
// =====================================================================

/// Weigert een bewerking/verplaatsing/verwijdering zodra de .ics een reeks is.
/// Zie [`RECURRING_NL`] voor de reden (één .ics = de hele reeks).
fn ensure_not_recurring(ics: &str) -> Result<()> {
    if has_rrule_in_vevent(ics) {
        bail!("{RECURRING_NL}");
    }
    Ok(())
}

/// True als er binnen een VEVENT een `RRULE`-property staat (na uitvouwen). Een
/// RRULE in VTIMEZONE (DST-overgangen) telt bewust NIET mee: dat beschrijft de
/// tijdzone, niet de herhaling van de afspraak zelf.
fn has_rrule_in_vevent(ics: &str) -> bool {
    let unfolded = unfold(ics);
    let mut in_vevent = false;
    for line in unfolded.split('\n') {
        let upper = line.trim().to_ascii_uppercase();
        if upper.starts_with("BEGIN:VEVENT") {
            in_vevent = true;
            continue;
        }
        if upper.starts_with("END:VEVENT") {
            in_vevent = false;
            continue;
        }
        if in_vevent && prop_is(&upper, "RRULE") {
            return true;
        }
    }
    false
}

// =====================================================================
// Samengestelde afspraak-id
// =====================================================================

/// `"caldav:" + base64url(json{h,e,u,r})`. De href wordt VERBATIM bewaard
/// (niet her-coderen). `r` (recurrence-id, UTC-start van een uitgeklapte
/// instantie) maakt de id uniek per voorkomen zodat React-keys niet botsen.
fn make_event_id(href: &str, etag: &str, uid: &str, recurrence_id: Option<&str>) -> String {
    let v = serde_json::json!({ "h": href, "e": etag, "u": uid, "r": recurrence_id });
    let raw = serde_json::to_vec(&v).unwrap_or_default();
    format!(
        "{ID_PREFIX}{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw)
    )
}

fn parse_event_id(id: &str) -> Result<(String, String, String, Option<String>)> {
    let b64 = id
        .strip_prefix(ID_PREFIX)
        .ok_or_else(|| anyhow!("Ongeldige afspraak-verwijzing."))?;
    let raw = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(b64)
        .map_err(|_| anyhow!("Ongeldige afspraak-verwijzing."))?;
    let v: serde_json::Value =
        serde_json::from_slice(&raw).map_err(|_| anyhow!("Ongeldige afspraak-verwijzing."))?;
    let get = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or_default().to_string();
    let rec = v.get("r").and_then(|x| x.as_str()).map(|s| s.to_string());
    Ok((get("h"), get("e"), get("u"), rec))
}

// =====================================================================
// Tijdzone + tekst + URL-hulpjes
// =====================================================================

/// De account-agenda draait op DEFAULT_TZ -> Europe/Amsterdam.
fn account_tz() -> Tz {
    windows_to_iana(DEFAULT_TZ)
}

/// Kleine Windows<->IANA-tabel (onbekend => UTC). `chrono-tz` doet de DST.
fn windows_to_iana(win: &str) -> Tz {
    match win {
        "W. Europe Standard Time" => Tz::Europe__Amsterdam,
        "Central Europe Standard Time" => Tz::Europe__Prague,
        "Central European Standard Time" => Tz::Europe__Warsaw,
        "Romance Standard Time" => Tz::Europe__Paris,
        "GMT Standard Time" => Tz::Europe__London,
        "E. Europe Standard Time" => Tz::Europe__Bucharest,
        "Russian Standard Time" => Tz::Europe__Moscow,
        "Eastern Standard Time" => Tz::America__New_York,
        "Central Standard Time" => Tz::America__Chicago,
        "Mountain Standard Time" => Tz::America__Denver,
        "Pacific Standard Time" => Tz::America__Los_Angeles,
        "UTC" => Tz::UTC,
        _ => Tz::UTC,
    }
}

/// Een TZID uit een .ics: eerst als IANA proberen, anders via de Windows-tabel.
fn tzid_to_iana(tzid: &str) -> Tz {
    tzid.parse::<Tz>().unwrap_or_else(|_| windows_to_iana(tzid))
}

/// Lokale wandkloktijd (account-zone) -> UTC.
fn local_to_utc(naive: NaiveDateTime) -> DateTime<Utc> {
    match account_tz().from_local_datetime(&naive) {
        LocalResult::Single(dt) => dt.with_timezone(&Utc),
        LocalResult::Ambiguous(dt, _) => dt.with_timezone(&Utc),
        LocalResult::None => Utc.from_utc_datetime(&naive),
    }
}

/// UTC -> zone-loze lokale string "YYYY-MM-DDTHH:MM:SS" (nooit met Z/offset:
/// de frontend snijdt in de weekweergave op de string, dus een offset schuift op).
fn utc_to_local_naive(utc: DateTime<Utc>) -> String {
    utc.with_timezone(&account_tz())
        .format("%Y-%m-%dT%H:%M:%S")
        .to_string()
}

/// UTC in iCal-basisformaat met Z (bv. "20260701T090000Z").
fn basic_z(dt: DateTime<Utc>) -> String {
    dt.format("%Y%m%dT%H%M%SZ").to_string()
}

/// Parseert een lokale ISO-string ("2026-07-01T09:00:00", evt. zonder seconden).
fn parse_local_naive(s: &str) -> Option<NaiveDateTime> {
    let s = s.trim();
    let s = s.strip_suffix('Z').unwrap_or(s);
    for f in ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S"] {
        if let Ok(dt) = NaiveDateTime::parse_from_str(s, f) {
            return Some(dt);
        }
    }
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .ok()
        .and_then(|d| d.and_hms_opt(0, 0, 0))
}

/// Normaliseert een lokale ISO-string naar "YYYY-MM-DDTHH:MM:SS".
fn normalize_naive(s: &str) -> String {
    parse_local_naive(s)
        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%S").to_string())
        .unwrap_or_else(|| s.trim().to_string())
}

/// De datum "YYYY-MM-DD" uit een ISO-string (voor hele-dag-afspraken).
fn date_str(s: &str) -> String {
    s.split('T').next().unwrap_or(s).trim().to_string()
}

fn date_part(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(&date_str(s), "%Y-%m-%d").ok()
}

/// iCal TEXT-ontsnapping ongedaan maken (`\n`, `\,`, `\;`, `\\`).
fn ical_text_unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') | Some('N') => out.push('\n'),
                Some(',') => out.push(','),
                Some(';') => out.push(';'),
                Some('\\') => out.push('\\'),
                Some(other) => out.push(other),
                None => {}
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// iCal TEXT-ontsnapping toepassen bij het schrijven.
fn ical_text_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            ';' => out.push_str("\\;"),
            ',' => out.push_str("\\,"),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            _ => out.push(c),
        }
    }
    out
}

fn truncate(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// Verwijdert een leidende `W/` van een zwakke ETag (voor If-Match).
fn strip_weak(etag: &str) -> String {
    let e = etag.trim();
    e.strip_prefix("W/").unwrap_or(e).to_string()
}

fn ensure_trailing_slash(url: &str) -> String {
    if url.ends_with('/') {
        url.to_string()
    } else {
        format!("{url}/")
    }
}

fn join_url(base: &str, seg: &str) -> Result<String> {
    let b = Url::parse(base).map_err(|e| anyhow!("Ongeldige agenda-URL: {e}"))?;
    b.join(seg)
        .map(|u| u.to_string())
        .map_err(|e| anyhow!("Ongeldige agenda-URL: {e}"))
}

/// Herstelt een absolute URL uit een (mogelijk relatieve) href tegen een basis.
fn resolve(base: &str, href: &str) -> Option<String> {
    if href.starts_with("http://") || href.starts_with("https://") {
        return Some(href.to_string());
    }
    Url::parse(base).ok()?.join(href).ok().map(|u| u.to_string())
}

fn host_of(url: &str) -> Option<String> {
    Url::parse(url).ok().and_then(|u| u.host_str().map(|h| h.to_string()))
}

// =====================================================================
// Tests
// =====================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_id_roundtrip() {
        let id = make_event_id("/cal/abc.ics", "\"etag123\"", "uid-1", Some("20260701T090000Z"));
        assert!(id.starts_with("caldav:"));
        let (h, e, u, r) = parse_event_id(&id).unwrap();
        assert_eq!(h, "/cal/abc.ics");
        assert_eq!(e, "\"etag123\"");
        assert_eq!(u, "uid-1");
        assert_eq!(r.as_deref(), Some("20260701T090000Z"));
    }

    #[test]
    fn event_id_without_recurrence() {
        let id = make_event_id("/x.ics", "\"e\"", "u", None);
        let (_, _, _, r) = parse_event_id(&id).unwrap();
        assert!(r.is_none());
    }

    #[test]
    fn windows_tz_maps_amsterdam() {
        assert_eq!(account_tz(), Tz::Europe__Amsterdam);
        assert_eq!(windows_to_iana("Onbekend"), Tz::UTC);
    }

    #[test]
    fn weak_etag_stripped() {
        assert_eq!(strip_weak("W/\"abc\""), "\"abc\"");
        assert_eq!(strip_weak("\"abc\""), "\"abc\"");
    }

    #[test]
    fn ical_text_escaping_roundtrips() {
        let raw = "a, b; c\\d\ne";
        let esc = ical_text_escape(raw);
        assert_eq!(esc, "a\\, b\\; c\\\\d\\ne");
        assert_eq!(ical_text_unescape(&esc), raw);
    }

    #[test]
    fn recurring_guard_blocks_rrule() {
        // Een VEVENT met RRULE = een reeks -> guard weigert (data-verlies-bescherming).
        let met_rrule = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nDTSTART:20260701T090000Z\r\nDTEND:20260701T100000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=MO\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        assert!(ensure_not_recurring(met_rrule).is_err());
        assert_eq!(
            ensure_not_recurring(met_rrule).unwrap_err().to_string(),
            RECURRING_NL
        );
    }

    #[test]
    fn recurring_guard_allows_single_event() {
        // Zonder RRULE (een los exemplaar) mag gewoon bewerkt/verwijderd worden.
        let zonder = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:2\r\nDTSTART:20260701T090000Z\r\nDTEND:20260701T100000Z\r\nSUMMARY:Los\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        assert!(ensure_not_recurring(zonder).is_ok());
    }

    #[test]
    fn recurring_guard_ignores_vtimezone_rrule() {
        // Een RRULE binnen VTIMEZONE (DST) is geen reeks-afspraak -> niet blokkeren.
        let tz = "BEGIN:VCALENDAR\r\nBEGIN:VTIMEZONE\r\nBEGIN:DAYLIGHT\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\r\nEND:DAYLIGHT\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:3\r\nDTSTART:20260701T090000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        assert!(ensure_not_recurring(tz).is_ok());
    }
}
