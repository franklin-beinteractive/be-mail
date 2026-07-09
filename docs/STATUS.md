# BE-Mail - voortgang

> Waar zijn we gebleven? Dit document wordt bij elke afgeronde stap bijgewerkt.
> De wensenlijst zelf staat in [FEATURES.md](FEATURES.md); dit is de *werkelijke* stand.

**Laatst bijgewerkt:** 2026-07-09 (Instellingen in tabbladen; opdrachten:
autoaanvullen uitvoerder/planner/klant, bewerkbare mailteksten met
merge-tags, planner-veld, notitie-invoer weg, detailpaneel versleepbaar)

## ✅ Af

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
