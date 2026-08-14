# BE-Mail - voortgang

> Waar zijn we gebleven? Dit document wordt bij elke afgeronde stap bijgewerkt.
> De wensenlijst zelf staat in [FEATURES.md](FEATURES.md); dit is de *werkelijke* stand.

**Laatst bijgewerkt:** 2026-08-14: het tijdgrid van #4 nagelopen met nepdata;
meerdaagse en over-middernacht-afspraken werden niet getoond (zie de bullet bij
issue #4).

**Ronde 2026-07-27:** de GitHub-issues #2, #3, #4, #6,
#7, #8, #10, #11, #12 en #13 opgelost, elk in een eigen commit (zie de bullets
hieronder voor wat er per issue veranderde).

De opmaak van #6, #7, #10, #11 en #13 is nagelopen in een browser met de
Tauri-IPC afgevangen door nepdata; daarbij kwamen twee foutjes in het
zoekformulier boven water (tweede datumveld liep buiten de kolom, knop erfde de
placeholder-tekst "Zoeken..."), beide hersteld.

Daarna in de draaiende app tegen de echte Graph-API bevestigd: het uitgebreide
zoeken (#13) met `from` + `hasAttachment` + `received>=` gecombineerd, en het
opslaan van een bericht als .eml (#12; geldig RFC822, bijlage inbegrepen).

**Nog te doen / open punten**
- Het tijdgrid (#4) is nu wel met nepdata in een browser nagelopen (naast
  elkaar staande afspraken, hele-dag-balken, over middernacht heen). Wat nog
  ontbreekt is dezelfde controle in de draaiende app tegen de echte agenda:
  daar staat geen data die overlap of een meerdaagse afspraak uitlokt.
- Snooze die een niet-actief account wekt (#8): er is maar één account
  gekoppeld, dus het scenario is niet na te spelen.
- End-to-end verificatie op Windows met echte IMAP-/CalDAV-servers (staat al
  langer open, sinds de IMAP-accounts).

## ✅ Af

- **Uitgebreid zoeken (2026-07-27, issue #13)**: pijltje naast het zoekvak
  klapt een formulier open met Van, Aan, CC, Onderwerp, Trefwoorden, datum van/
  tot, leesstatus en "heeft bijlagen" - zoals het Outlook-paneel uit de issue.
  De velden gaan **gestructureerd** naar de kern (`SearchQuery`), niet als
  kant-en-klare zoekstring: Graph vertaalt naar KQL (`from:…  AND received>=…`),
  IMAP naar SEARCH-criteria (`FROM "…" SINCE 1-Jan-2026`). Zoeken op bijlagen
  kan IMAP niet (geen criterium daarvoor); dat vinkje verschijnt daar niet.
  Einddatum is inclusief, ook bij IMAP (BEFORE is exclusief, dus +1 dag).
- **Bericht opslaan als .eml (2026-07-27, issue #12)**: knop in de leesbalk
  slaat het hele bericht (incl. headers en bijlagen) op in de Downloads-map.
  `.eml` omdat dat de ruwe MIME is en in elke mailclient opent. Graph levert
  die via `/$value`, IMAP via de bytes die er toch al zijn; beide schrijven via
  dezelfde `write_eml()` zodat de naamgeving gelijk is (onderwerp, afgekapt op
  80 tekens, met oplopend volgnummer bij dubbele namen).
- **Conversatie als losse kaarten (2026-07-27, issue #11)**: het leesvenster
  toonde één bericht; de rest van de conversatie zag je alleen uitgeklapt in de
  lijst. Nu krijgt elk bericht uit de conversatie een eigen kaart, het geopende
  volledig en de andere ingeklapt op één regel (avatar, afzender, datum,
  voorbeeld); klikken opent zo'n bericht. Het scrollgebied is nu `.thread` in
  plaats van `.reader-body`. **Beperking:** de conversatie komt uit de geladen
  lijst, dus eigen antwoorden uit Verzonden items zitten er niet bij zolang je
  in Postvak IN kijkt. Cross-folder ophalen kan met een Graph-filter op
  `conversationId`, maar is bewust niet in deze stap meegenomen.
- **Hover-acties in de berichtenlijst (2026-07-27, issue #10)**: bij hover (en
  bij toetsenbordfocus) verschijnen rechts in de rij vier knoppen: archiveren,
  gelezen/ongelezen, vlag en verwijderen. Ze liggen als overlay over de datum,
  zodat de rij niet verspringt. Verwijderen vraagt bevestiging, net als elders.
- **Snooze wekt nu ook niet-actieve accounts (2026-07-27, issue #8)**: het
  uitstellen zelf bestond al (later vandaag / morgenochtend / volgende week +
  eigen datum en tijd), maar de wekker keek alleen naar het **actieve** account.
  Wie in account B werkte, kreeg een uitgesteld bericht uit account A niet terug
  op het afgesproken moment. De wekker loopt nu over alle accounts via het
  nieuwe command `wake_snoozed` (expliciet account-id, verplaatst naar Postvak
  IN en zet ongelezen); het beeld ververst alleen als het actieve account
  wijzigde.
- **Snelle acties (2026-07-27, issue #7)**: eigen knoppen boven een geopend
  bericht, in te stellen via Instellingen -> E-mail -> Snelle acties. Twee
  soorten: verplaatsen naar een map en een categorie toekennen. De actie
  bewaart de **naam** van de map/categorie, niet het id: mapid's verschillen
  per account, dus zo werkt dezelfde knop in elk account dat die map heeft
  (bestaat hij niet, dan zegt de app dat). Categorie-acties verbergen zich bij
  IMAP-accounts, want die kennen geen categorieën.
- **Afzender-avatars (2026-07-27, issue #6)**: rond bolletje met initialen en
  een vaste kleur per afzender, in de berichtenlijst en boven een geopend
  bericht. Uit te zetten via Instellingen -> Berichtenlijst. Bewust geen foto's
  uit Graph: `/users/{id}/photo` vraagt `User.ReadBasic.All` (tenant-brede admin
  consent) en werkt niet voor externe afzenders of IMAP-accounts. Wil je toch
  echte foto's, dan is dat een aparte beslissing over die scope.
- **Tijdgrid in dag/werkweek/week (2026-07-27, issue #4)**: die weergaven
  toonden per dag een platte lijst met chips, zonder tijd-as - je zag niet
  wanneer of hoe lang iets duurde. Nu een Outlook-achtig rooster: uren links,
  blokken op starttijd met de hoogte van de duur, overlappende afspraken naast
  elkaar, een aparte strook voor hele-dag-afspraken, een rode "nu"-lijn en een
  beginpositie bij de eerste afspraak van de periode. Dubbelklikken op een uur
  opent een nieuwe afspraak op dat tijdstip (`EventDialog` kreeg daarvoor
  `defaultStartTime`). De indeling zit in `layoutDay()` in `CalendarView.tsx`.
  **Aanvulling (2026-08-14):** afspraken werden ingedeeld op alleen hun
  *startdag*, terwijl `/me/calendarView` alles teruggeeft wat de periode
  *overlapt*. Een meerdaagse afspraak die vóór de zichtbare week begon viel
  daardoor helemaal weg, en een afspraak over middernacht heen was de tweede
  dag onzichtbaar. `daysOfEvent()` levert nu alle dagen die een afspraak raakt;
  `layoutDay(events, dayKey)` knipt per dag af (doorlopers beginnen om 00:00 en
  tellen niet mee voor de scrollpositie) en `layoutAllDay()` legt hele-dag-
  afspraken als één balk over alle dagen die ze beslaan, met een rij per
  overlappende balk. Ook de maandweergave zet een meerdaagse afspraak nu op
  elke dag die hij beslaat.
- **Agendaweergave wordt onthouden (2026-07-27, issue #3)**: dag/werkweek/week/
  maand/lijst stond in lokale state van `CalendarView`, en dat component wordt
  ontkoppeld zodra je naar Mail gaat - de keuze sprong dus telkens terug naar
  maand. Staat nu als `calendarView` in `UiSettings` (localStorage), naast de
  andere onthouden UI-staat. Geverifieerd in de echte app: Week blijft staan na
  Mail → Agenda en na een herstart.
- **Externe afbeeldingen tonen (2026-07-27, issue #2)**: de knop "Externe
  afbeeldingen tonen" deed niets - de CSP van de webview
  (`img-src 'self' data: asset: blob:`) staat geen externe URL's toe, dus de
  afbeeldingen bleven kapot ook nadat de sanitizer ze doorliet. De CSP is
  bewust **niet** verruimd: na toestemming haalt de Rust-kern de afbeeldingen op
  (`fetch_remote_image`, zonder cookies/referer, max 10 MB, alleen echte
  afbeeldingen) en vult de frontend ze als `data:`-URI in. Dekt nu ook
  `srcset`, het legacy `background`-attribuut en `url(...)` in inline styles;
  die konden de blokkade eerder omzeilen zodra de CSP het toeliet.
- **IMAP-accounts (2026-07-13, issue #5)**: naast Office 365 kun je nu ook
  IMAP-accounts koppelen. Een IMAP-account is een tweede account-TYPE dat in de
  bestaande multi-account-infrastructuur schuift.
  - **Mail** via IMAP (lezen/mappen/gelezen/vlaggen/verplaatsen/verwijderen/
    zoeken) + SMTP (verzenden, concepten), volledig over **rustls/ring** (geen
    OpenSSL). Persistente IMAP-verbinding per account (hergebruikt, herverbindt
    bij verval). Offline SQLite-cache + nieuwe-mail-notificaties werken ook voor
    IMAP.
  - **Agenda** via een aparte **CalDAV**-server, best-effort automatisch
    gedetecteerd bij het toevoegen (of handmatige CalDAV-URL). Werkt voor
    iCloud/Fastmail/cPanel/SabreDAV; **Gmail** (OAuth-only CalDAV) en
    **Outlook.com** (geen CalDAV) krijgen geen agenda - de mail werkt daar wel.
  - **Auth** = gebruikersnaam + (app-)wachtwoord over TLS; het wachtwoord staat
    gechunkt in de OS-keychain (prefix `imap-secret`), raakt de webview nooit.
    Geen XOAUTH2 in deze versie.
  - **Architectuur**: nieuwe modules `backend.rs` (`enum Backend { Graph, Imap }`
    + `enum Calendar { Graph, Caldav }`, dispatch op het enige seam
    `commands.rs::client()`/`calendar()`), `imap.rs` (imap + lettre +
    mail-parser), `caldav.rs` (reqwest + quick-xml + icalendar + rrule +
    chrono-tz). De frontend verbergt Office-365-only functies (regels,
    categorieen, afwezigheid, RSVP, blokkeren, gepland verzenden,
    genodigden-autocomplete) per **actief** account; de Agenda-knop verdwijnt pas
    als geen enkel account een agenda heeft.
  - **Back-compat**: alle nieuwe config-velden zijn `#[serde(default)]`, dus
    bestaande `config.json` (zonder `kind`/`imap`) laadt ongewijzigd als
    Office365. 54 unit-tests groen; `cargo check`/`clippy` schoon; geen
    aws-lc-rs/OpenSSL in de tree.
  - **v1-beperkingen**: terugkerende CalDAV-afspraken kun je niet los
    bewerken/slepen/verwijderen (hele-reeks-bescherming tegen dataverlies);
    zoeken is per-map; gepland verzenden en genodigden-autocomplete zijn
    O365-only. Zie `docs/IMAP-Accounts.md` en `docs/CalDAV-Calendar.md`.
- **Fundering**: Tauri v2 + React/TS, OAuth2/PKCE-login, tokens gechunkt in
  OS-keychain (zie CLAUDE.md gotcha #1), config in `%APPDATA%\BE-Mail\`.
- **Mail lezen**: mappen, berichtenlijst + paginering, HTML/platte tekst,
  externe afbeeldingen blokkeren, externe-afzender-waarschuwing, sanitizing.
- **Mail beheren**: gelezen/ongelezen (+ teller), vlaggen, verwijderen,
  verplaatsen, **archiveren (1-klik)**, **zoeken door hele mailbox** (Graph `$search`).
- **Mail opstellen**: nieuw/reply/reply-all/forward, CC/BCC, prioriteit,
  **bijlagen meesturen** (max ~3 MB per mail, Graph-limiet inline attachments).
- **Bijlagen lezen**: lijst in leesvenster, downloaden naar Downloads-map.
- **Concepten**: automatisch opslaan tijdens typen (3 s debounce), bewaren bij
  sluiten, concept openen vanuit Concepten-map (→ opstelvenster), verzenden
  van een concept zonder duplicaat. Let op: opmaak wordt platte tekst bij
  heropenen (simpele editor); bijlagen gaan pas mee bij verzenden.
- **Handtekeningen**: meerdere beheren in Instellingen; aparte standaard voor
  nieuw bericht en beantwoorden/doorsturen; wisselen in het opstelvenster.
  Opslag lokaal (localStorage). HTML met wysiwyg-editor (zelfde editor als
  opstellen), incl. afbeeldingen (max 1 MB; bij verzenden omgezet naar
  inline cid-bijlagen zodat ontvangers ze echt zien).
- **Mappenbeheer**: eigen mappen aanmaken/hernoemen/verwijderen vanuit de
  mappenlijst (systeemmappen op naam uitgesloten; Graph is de backstop).
- **Bulkacties**: checkbox per bericht; balk met gelezen/ongelezen,
  archiveren, verplaatsen, verwijderen. Werkt ook in zoekresultaten.
- **RSVP**: vergaderuitnodigingen (eventMessageRequest) krijgen in het
  leesvenster knoppen Accepteren / Voorlopig / Afwijzen (antwoord gaat naar
  de organisator; uitnodiging verdwijnt uit de lijst).
- **Terugkerende afspraken**: dagelijks/wekelijks/maandelijks/jaarlijks +
  interval + einddatum, instelbaar bij aanmaken. Weekdag/dag-v-d-maand
  volgt de startdatum. Bewerken van een reeks(patroon) kan nog niet;
  een los exemplaar bewerken/verwijderen werkt wel.
- **Rich-text editor**: vet/cursief/onderstrepen, lijsten, links
  (contentEditable, geen externe library). Concepten behouden opmaak.
- **Undo send**: 5 s bedenktijd met aftelbalk vóór echte verzending.
- **Later verzenden**: tijdstip kiezen; Exchange bezorgt (concept +
  PidTagDeferredSendTime). Bericht wacht in Concepten/Postvak UIT.
- **Dag- en werkweekweergave** in de agenda (naast week/maand/lijst).
- **Spam melden** (→ Ongewenste e-mail) en **afzender blokkeren**
  (inbox-regel "BE-Mail: … geblokkeerd" - beheerbaar via Outlook-regels).
- **Uitschrijven-knop** bij nieuwsbrieven (List-Unsubscribe-header;
  https → browser, mailto → opstelvenster).
- **Desktop-notificaties**: Rust-poller (60 s) op Postvak IN; Windows-
  notificatie per nieuw bericht (max 3, daarna samenvatting) en
  "new-mail"-event dat lijst + tellers in de app ververst. Aan/uit in
  Instellingen; pollt álle accounts.
- **Gebruikerswensen-batch (FEATURES.md §11)**: inline opstellen in de
  previewkolom (kruisje sluit), eigen bevestigings-modals, kolombreedtes
  verslepen, mappenboom met submappen + slepen (sorteren/nesten),
  genodigden-autocomplete (People.Read!), afspraken slepen naar andere
  dag, **multi-account** (mappengroepen per account, in-/uitklapbaar,
  accountbeheer in Instellingen), verzendvertraging-instelling,
  instellingen 2-koloms, accountnaam boven mappen, Nieuw-bericht-knop
  naast Beantwoorden, **Help-pagina** (volledige handleiding NL/EN),
  actiebalk uitgelijnd met lijstkolom, **lettertype-instelling**
  (Calibri standaard).
- **Mappenlijst-verbeteringen (2026-07-03)**: mappen bij het opstarten
  standaard ingeklapt; in-/uitklapstatus van mappen én accountgroepen
  wordt onthouden (Instellingen/localStorage); mappenkolom scrolt nu
  echt (grid-rij was hoger dan het venster, waardoor de onderste mappen
  onbereikbaar waren).
- **Agenda**: maand/week/lijst, vandaag + navigatie, afspraak
  maken/**bewerken**/verwijderen, hele dag, locatie, herinnering, genodigden.
- **Overig**: donkere modus, tekstgrootte, hoog contrast, NL/EN,
  foutmeldingen in mensentaal.

- **Lijst-verfijning (2026-07-03, laat)**: sorteren op datum (nieuwste/
  oudste eerst) en filteren (alle / ongelezen / met vlag) boven de
  berichtenlijst - server-side via Graph én in de offline cache;
  preview-kolom op witte achtergrond; dark mode keert mail-HTML om
  (Dark Reader-stijl: invert + hue-rotate, afbeeldingen dubbel omgekeerd
  dus normaal); offline werkt nu ook direct na een koude start
  (get_account viel op het loginscherm terug omdat /me netwerk vereist -
  nu fallback op het opgeslagen account).
- **Offline caching (2026-07-03, laat)**: SQLite-cache (`cache.db` naast
  config.json, rusqlite bundled) met mappen, berichtenlijsten en gelezen
  berichten (mét body) per account. Cache-through: elke geslaagde
  Graph-call ververst de cache; zonder netwerk worden mappen, lijsten en
  gelezen berichten uit de cache geserveerd (gele "Offline"-balk boven de
  lijst; acties zoals verzenden/verplaatsen vereisen netwerk). Delta-sync
  per map (Graph `/delta`, hervatbare link, max 10 pagina's per run,
  throttle 60 s) vult de cache buiten de zichtbare pagina en verwerkt
  verwijderingen. Cache wordt gewist bij uitloggen van een account.
- **Drag & drop-fix + feedbackronde (2026-07-03, laat)**:
  - **Oorzaak gevonden waarom slepen nooit werkte**: Tauri onderschept op
    Windows alle sleep-events (dragDropEnabled); nu uit → mappen sorteren,
    mails slepen en afspraken slepen werken echt (zie CLAUDE.md gotcha #3).
  - **Mail naar map slepen** (aangevinkte selectie sleept mee); de
    verplaats-select is uit de bulkbalk verdwenen.
  - **Uitklap-icoontje** gecentreerd; hover nu doorschijnend grijs (bleef
    onzichtbaar wit in light mode).
  - **Optionele scopes worden bij het opstarten** stil opgehaald (niet
    meer wachten op token-verloop) → @-vermeldingen/autocomplete werken
    direct zodra de consent er is.
  - **Standaardmappen verbergen** via Instellingen → Mappen (Archief,
    Concepten, Verzonden, Verwijderd, Ongewenst, Postvak UIT,
    Gespreksgeschiedenis).
- **Backlog-batch (2026-07-03 avond)**:
  - **Mappen sorteren gefixt**: slepen startte niet doordat de rij door een
    button werd bedekt; drop-positie nu direct uit het event, ruimere zones.
  - **Autoaanvullen Aan/CC/BCC** in het opstelvenster (/me/people).
  - **Sneltoetsen**: j/k of pijltjes, n, r/a/f, e, Delete, u, m, / (zie Help).
  - **Regels-beheer**: inbox-regels tonen, aan/uit, verwijderen (Instellingen).
  - **Afwezigheid (OOF)**: uit/aan/gepland, periode, intern/extern bericht.
    Vereist optionele scope `MailboxSettings.ReadWrite` (stille upgrade).
  - **Categorieën**: kleurlabels toewijzen in het leesvenster, stippen in de
    lijst (vereist dezelfde MailboxSettings-scope).
  - **Snoozen**: bericht uitstellen (klok-knop); komt op het gekozen moment
    ongelezen terug in Postvak IN (wekker draait zolang de app open is).
  - **Threading**: gesprekken gegroepeerd op conversationId met teller-chip.
  - **Grote bijlagen tot 25 MB** via Graph upload-sessions.
  - **@-vermeldingen** in de editor: @naam → suggestie → gemarkeerde
    vermelding + automatisch in het Aan-veld.
- **Berichtenlijst-velden instelbaar (2026-07-06)**: nieuwe sectie
  "Berichtenlijst" in Instellingen met vinkjes voor naam afzender,
  e-mailadres afzender, onderwerp en gedeelte van het bericht.
  Standaard: naam + onderwerp + berichtdeel aan, e-mailadres uit
  (zoals voorheen). Indicatoren (vlag, prioriteit, bijlage) blijven
  zichtbaar, ook als het onderwerp uitstaat. Datum in de lijst toont
  nu altijd ook de tijd ("Vandaag 10:15" / "04 jul 10:15").
- **Client-ID/Tenant-ID ingebakken (2026-07-06/07)**: `config.rs` valt
  zonder config.json terug op ingebakken standaardwaarden
  (`DEFAULT_CLIENT_ID`/`DEFAULT_TENANT_ID`). Nieuwe installatie =
  installeren -> Inloggen (browser/SSO) -> klaar; geen instelscherm.
  Ook een config.json zónder Client-ID (oude installatie) krijgt de
  ingebakken waarden; accounts en instellingen blijven behouden.
  Instellingen -> Verbinding kan de waarden nog altijd overschrijven
  (opgeslagen config.json wint van de ingebakken standaard).
  Let op: dit zit pas in installers gebouwd op/na 7 juli - de bundel
  van 3 juli toont nog het instelscherm.
- **Zoeken: bereik + optimalisatie (2026-07-07)**: tijdens het zoeken
  verschijnt een keuze "Alle mappen" (hele mailbox) / "Deze map" (alleen
  de geopende map, via Graph `/mailFolders/{id}/messages?$search`).
  Race-conditie gefixt: een traag, ouder zoekresultaat kan een nieuwer
  resultaat niet meer overschrijven (volgnummer per verzoek). Kruisje in
  het zoekveld leegt de zoekopdracht en toont weer de open map.
- **AI-antwoorden via Claude (2026-07-07)**: knop "AI-antwoord" in het
  leesvenster met keuzelijst van stijlen (standaard: zakelijk, prive,
  kort; beheerbaar in Instellingen -> AI-antwoorden, incl. eigen
  stijlen met vrije instructie). Claude (model claude-opus-4-8) schrijft
  het antwoord op basis van de originele mail; het opstelvenster opent
  met de tekst boven het aangehaalde origineel + reply-handtekening.
  De Anthropic API-sleutel staat in de Windows-keychain (`claude.rs`,
  raakt de webview nooit); invoer via Instellingen. Foutafhandeling in
  mensentaal (ongeldige sleutel, limiet, weigering).

- **Instellingen-tabbladen + opdrachten-batch (2026-07-09)**:
  - **Instellingen in 4 tabbladen**: Algemeen (accounts, weergave, gedrag,
    verbinding), E-mail (mappen, berichtenlijst, regels, afwezigheid,
    handtekeningen, AI), Agenda (nog leeg, placeholder) en Opdrachten.
  - **Tab Opdrachten**: termijnen (de 4 werkdag-drempels uit opdrachten.db,
    eindelijk met UI), beheerlijsten voor **uitvoerders** en **planners**
    (naam + e-mailadres) en **klanten** (bedrijf, contactpersoon,
    e-mailadres), en de **mailteksten** (onderwerp + tekst, bewerkbaar met
    merge-tags: {klant} {naam} {bedrijf} {omschrijving} {uren} {ronde}
    {datum} {planner} {uitvoerder}; herstel-knop per tekst). Lijsten en
    teksten in localStorage (UiSettings), termijnen in opdrachten.db.
  - **Autoaanvullen op de kaart**: uitvoerder, planner (nieuw veld op de
    ronde, migratie v3) en klant (naam/bedrijf; een klant kiezen vult naam,
    bedrijf en e-mailadres in één keer). Vrije tekst blijft mogelijk.
  - **Notitie-invoer bij de tijdlijn verwijderd** (na onderzoek: handmatige
    "notitie"-logregels werden nergens gebruikt - niet in mailteksten,
    statistiek of iets anders). Bestaande notities blijven zichtbaar in de
    tijdlijn; de automatische statusregels blijven zoals ze waren.
  - **Detailpaneel (rechter kolom) versleepbaar** (300-720 px, zelfde
    sleepgreep als de mailkolommen; onthouden in Instellingen).

- **Back-up & overzetten naar .json (2026-07-10)**: Instellingen ->
  Algemeen -> "Back-up & overzetten" met vier knoppen (Instellingen en
  Assignments elk apart exporteren/importeren). Bestandskiezer via
  `tauri-plugin-dialog`; lezen/schrijven in de Rust-kern
  (`schrijf_tekstbestand`/`lees_tekstbestand`, geen fs-scope nodig).
  - **Instellingen-export** (`bemail-instellingen-<datum>.json`): de hele
    `UiSettings` (assignees, planners, klanten, mailteksten, weergave,
    handtekeningen, AI-stijlen, ...) + de 4 termijnen uit opdrachten.db.
    Import overschrijft `UiSettings` volledig (over `defaultSettings`) en
    zet de termijnen terug via `zet_opdracht_instelling`.
  - **Assignments-export** (`bemail-assignments-<datum>.json`): alle
    aanvragen, rondes en logboek uit opdrachten.db, via nieuwe commands
    `export_opdrachten`/`import_opdrachten` (import in één transactie,
    kinderen eerst gewist). Termijnen horen bij de instellingen-export.
  - **Model = één pc tegelijk, importeren overschrijft** (met bevestiging);
    geen samenvoeg-/conflictlogica. Accounts/tokens blijven bewust buiten de
    export (staan in config.json/keychain; op een nieuwe pc log je opnieuw in).
- **Releases & auto-update (CI)**: GitHub Actions-workflow
  (`.github/workflows/release.yml`) bouwt bij een `v*`-tag ondertekende bundels
  voor Windows, Linux en macOS en publiceert ze + het `latest.json`-manifest
  naar de Releases van deze (publieke) repo. In-app updater
  (`tauri-plugin-updater` + `-process`; banner in `App.tsx`, hook in
  `src/lib/update.ts`) checkt bij opstarten en elke 30 min, en installeert +
  herstart op verzoek. `keyring` is nu per-OS (Windows/macOS/Linux) zodat alle
  drie de platforms bouwen. **Eenmalig nog nodig** (zie plan/README): het
  updater-sleutelpaar genereren, de secrets `TAURI_SIGNING_PRIVATE_KEY`
  (+ `_PASSWORD`) zetten en de `pubkey` in `tauri.conf.json` invullen.

## 🔜 Volgende stappen (afgesproken volgorde)

1. ~~Bijlagen (lezen + downloaden + meesturen)~~ ✅
2. ~~Concepten automatisch opslaan~~ ✅
3. ~~Handtekening(en)~~ ✅
4. ~~Mappenbeheer + bulkacties~~ ✅
5. ~~RSVP + terugkerende afspraken~~ ✅

6. ~~"Hoog & middel"-pakket~~ ✅ - rich-text editor, undo send / later
   verzenden, dag-/werkweekweergave, spam/blokkeren/uitschrijven,
   desktop-notificaties.

**Resterende achterhoede** (nog niet gepland): reeks-patroon bewerken bij
terugkerende afspraken, gedeelde postvakken, contactenlijst-UI, agenda
offline cachen, en "stale-while-revalidate" (cache direct tonen terwijl
vers laadt) als snelheidsverbetering bovenop de offline cache.

## 📌 Openstaand / opmerkingen

- **Automatische cloud-sync via OneDrive (Graph) - GEPLAND, nog niet
  gebouwd.** Bovenop de handmatige .json-export (2026-07-10) is dit de
  afgesproken vervolgstap voor "niet meer alles opnieuw invullen op een
  andere pc". Aanpak:
  - **Hergebruik de bestaande O365-login** (geen tweede account/wachtwoord).
    De app is al met Graph geauthenticeerd; sla dezelfde twee JSON-blobs
    (instellingen + assignments) op in de **app-map van de gebruiker in
    OneDrive** (`/me/drive/special/approot`).
  - **Scope**: `Files.ReadWrite.AppFolder` (least privilege; eigen verborgen
    app-map, niet de hele Drive). Toevoegen aan de optionele scopes in
    `auth.rs` (zoals People.Read), met stille upgrade via het refresh-token.
  - **RISICO - admin consent**: deze tenant staat user-consent voor sommige
    scopes niet toe (zie People.Read hierboven). Files.ReadWrite.AppFolder
    kan dus óók een eenmalige **Grant admin consent** + opnieuw inloggen
    vereisen. Vóór de bouw checken of dit acceptabel is.
  - **Model**: één pc tegelijk -> laatste-opslag-wint met tijdstempel.
    "Nu back-uppen" / "Herstellen"-knoppen, later evt. automatisch bij
    afsluiten. Géén samenvoeglogica nodig.
  - **Terugvaloptie als de scope geblokkeerd wordt**: de export-JSON naar een
    door de gebruiker gekozen map schrijven die hun eigen Google Drive/
    OneDrive/Dropbox-desktopclient al synct (nul extra rechten). NB: alleen
    de JSON-snapshot syncen, nooit de levende SQLite-`.db` (corruptierisico).


- **Entra: beheerdersgoedkeuring vereist** - de scope `People.Read`
  (autocomplete genodigden) mag in deze tenant niet door de gebruiker zelf
  worden goedgekeurd. De browser-login vraagt daarom alleen nog de
  basisrechten (nooit meer een blokkerend consent-scherm); daarna probeert
  de app People.Read **stil** via het refresh-token. Autoaanvullen van
  genodigden werkt pas nadat een beheerder **Grant admin consent** klikt
  (stappen in `docs/Azure-App-Registration.md` → Troubleshooting) en er
  éénmalig opnieuw is ingelogd.
- **Multi-account-migratie**: tokens staan nu per account opgeslagen -
  iedereen moet éénmalig opnieuw inloggen (koppelt het account).
- **Bitbucket-push geblokkeerd door SSH-sleutel**: de repo is aangemaakt,
  maar de gebruikte SSH-sleutel lijkt een repository access key van
  `dim.beren` (ssh -T meldt geen accountnaam) en heeft geen toegang tot
  `quizmaster/be-mail`; ook de API-token ziet alleen `dim.beren`. Fix door
  gebruiker: in Bitbucket de sleutel als **account-SSH-key** toevoegen
  (Personal settings → SSH keys) of de access key ook aan de nieuwe repo
  hangen; daarna `git push -u origin main`.
- **MailboxSettings.ReadWrite** (afwezigheid + categorieën) staat nog niet
  in de admin consent; de blokken tonen tot die tijd een uitleg. Zelfde
  stappen als bij People.Read (zie Azure-App-Registration.md).
- `$search` werkt in deze tenant zonder `ConsistencyLevel`-header (getest).
