# BE-Mail - voortgang

> Waar zijn we gebleven? Dit document wordt bij elke afgeronde stap bijgewerkt.
> De wensenlijst zelf staat in [FEATURES.md](FEATURES.md); dit is de *werkelijke* stand.

**Laatst bijgewerkt:** 2026-11-27 - **Security- en optimalisatiecheck** op
alles na 0.3.1, gevonden punten meteen opgelost: na het verwijderen van
kaarten of bijlagen draait `PRAGMA wal_checkpoint(TRUNCATE)` (`purge_wal`),
zodat oude kopieën ook uit `todo.db-wal` verdwijnen; teksten met
gebruikersdata (`{title}`, `{name}`, `{col}`) gaan via een replacer-functie,
anders verminkt een `$&` in een titel de melding; blob-URL's van bijlagen van
verwijderde kaarten worden vrijgegeven; stabiele callback voor
`onOpenTaskHandled`.

**Eerder op 2026-11-27 - Archiveren en archief legen** (na
0.3.1): knop **Archiveren** in de open kaart zet een kaart meteen in het
archief (in een gearchiveerde kaart heet die knop **Terugzetten**).
Daarvoor kreeg `todo.db` **migratie 3**: `ALTER TABLE task ADD COLUMN
archived_at TEXT` (alleen een nieuwe lege kolom, bestaande kaarten blijven
ongemoeid). Nieuwe Rust-commando's `todo_archive_task(id, archived)` en
`todo_delete_tasks(ids)` (in één transactie); `save_task` raakt
`archived_at` niet. `isArchived()` = handmatig gearchiveerd óf 2 dagen
afgerond; `restoreTask()` wist de markering en verplaatst een kaart alleen
als hij anders door zijn oude afrond-datum in het archief zou blijven.
Gearchiveerde kaarten tellen niet mee in de tellers en de vandaag-melding.
In het archief: **Archief legen** (met bevestiging met het aantal) verwijdert
alle gearchiveerde kaarten, ook die door het filter verborgen zijn.

**Eerder op 2026-11-27 - Kaartenarchief** (na 0.3.1): een kaart
die 2 kalenderdagen in een kolom met "Telt als afgerond" staat (gemeten aan
zijn `done_at`), verdwijnt van het bord en staat in **Archief** linksonder in
Taken (met icoon en teller). Daar: kaart openen, **Terugzetten** (naar de
eerste niet-afgerond-kolom, wat `done_at` wist) of definitief verwijderen
(prullenbak + bevestiging; bijlagen gaan mee via ON DELETE CASCADE, en
`todo.db` draait nu met `PRAGMA secure_delete = ON`, zodat de bytes ook uit
het bestand verdwijnen). Het archief is berekend, geen nieuwe kolom of
migratie: `isArchived()`/`archiveCutoff()` in `src/lib/todo.ts`, lijst in
`src/components/todo/ArchiveList.tsx`. Het oude uitklapknopje voor
gearchiveerde *projecten* heet nu "Gearchiveerde projecten", om verwarring met
het kaartenarchief te voorkomen.

**Eerder op 2026-11-27 - Opvolgdatum vraagt aandacht** (na
0.3.1): een kaart waarvan de opvolgdatum is bereikt (en die niet in een
"Telt als afgerond"-kolom staat) krijgt een rode rand en rode datum op het
bord. Rechtsboven in het venster verschijnt een melding "N taken vragen
vandaag actie"; een klik opent de popup "Taken voor vandaag" (gegroepeerd in
Te laat / Vandaag) met per kaart Openen, Afronden (naar de eerste
afgerond-kolom) en hetzelfde Opvolgen-veld als in de open kaart (datumveld +
Vandaag / Morgen / Volgende week / Wissen; gedeeld component
`FollowUpField.tsx`). Een kaart die je in de popup afhandelt, wordt grijs en
blijft staan tot de popup sluit, zodat hij niet verdwijnt halverwege het
typen van een datum. Sluit je de melding, dan komt hij
pas terug als er een nieuwe kaart vervalt of de volgende dag. In de bordkop
opent de rode knop "Vandaag N" dezelfde popup. Kaarten springen niet
automatisch naar boven in hun kolom: dat zou de handmatige volgorde
(slepen) overschrijven. Code: `src/components/todo/DueTasks.tsx`,
`dueTasks()`/`isDue()` in `src/lib/todo.ts`.

**2026-11-26 - Release 0.3.1**: takenbord, verwijderde
opdrachten-module en compactere mappenlijst gaan mee in 0.3.1, plus Tauri
2.12.7 en DOMPurify 3.5.0. Daarna (na 0.3.1): "Kolom toevoegen" is een knop
in de bordkop naast het filter geworden en opent de kolomdialoog (naam, kleur,
"Telt als afgerond"); de gestippelde lege kolom rechts op het bord is weg,
dus geen horizontale scrollbalk meer alleen daardoor.

**Eerder op 2026-11-25 - Taken als Trello-bord**: de
takenlijst van gisteren is omgebouwd tot een bord per project. Kolommen
(Te doen, Bezig, Wacht op klant, Klaar, ...) maak je zelf, met naam en kleur,
en gelden voor alle projecten; een kolom met "Telt als afgerond" geeft kaarten
een afrond-datum en haalt ze uit de opvolg-teller. Kaarten hebben titel,
omschrijving, kleur, opvolgdatum, gekoppelde mail en bijlagen. Slepen: kaarten
tussen en binnen kolommen, kaarten op een project links, kolomkoppen voor de
volgorde. Tijdens het slepen schuiven kaarten opzij en groeien of krimpen
kolommen in 200 ms (FLIP met WAAPI in `TodoView.tsx`; uit bij "minder
beweging" in Windows); de placeholder krijgt de hoogte van de gesleepte
kaart. Een nieuwe kaart opent na Enter meteen in de kaart-popup, met de
cursor in de omschrijving. In Instellingen > Taken sleep je de kolommen aan
hun greepje in een andere volgorde (geen pijlknoppen meer; met het toetsenbord:
pijltoetsen op het greepje). Een kolom met kaarten (over alle projecten
geteld) verwijder je alleen via een keuze waar die kaarten naartoe gaan
(`DeleteColumnDialog`); `todo_delete_column` weigert zonder doelkolom, zodat er
nooit kaarten zonder kolom achterblijven. Bijlagen: screenshot plakken met Ctrl+V in een open kaart, bestanden
kiezen of op de kaart slepen; max. 25 MB per bestand, als BLOB in `todo.db`
(tabel `attachment`). De eerste afbeelding komt als omslag op de kaart; een
afbeelding opent in een lightbox, andere bestanden met de standaard-app
(uitvoerbare bestanden alleen "Opslaan in Downloads"). Statussen, actie-labels,
de lijsten Vandaag/Wachten/Alles open/Afgerond en de snelle invoer met
`#project !actie` zijn vervallen; migratie 2 zet bestaande taken in de kolom
die bij hun status hoort (actie-labels gaan verloren). "Taak maken" vanuit een
mail kiest nu een kolom. Nagelopen in een browser met nepdata (slepen, plakken,
licht/donker); in de draaiende Tauri-app nog niet - met name het uploaden via
de ruwe IPC-body (`todo_add_attachment`) en openen met de standaard-app.

**Eerder op 2026-11-24 - Taken (todo-lijst), fase 1**: nieuwe
rail-sectie Taken als geheugensteun voor veel parallelle projecten. Lokaal in
`%APPDATA%\BE-Mail\todo.db` (dev: `todo-dev.db`), Rust-module `todo.rs`,
geen Graph. Model: project (naam, kleur, gearchiveerd), taak (titel,
project of Inbox, status Te doen/Bezig/Klaar, actie-label, opvolgdatum,
notitie, gekoppelde mail) en actie-labels die je in Instellingen → Taken
zelf beheert (met vlag "wachten op anderen"). Lijsten Vandaag / Inbox /
Wachten / Alles open / Afgerond plus per project; snelle invoer met
`#project !actie datum`; knop "Taak maken" (toets `t`) op een open mail met
projectvoorstel op afzenderdomein; mail-icoon bij een taak opent de mail weer
(valt terug op het gesprek als het bericht verplaatst is); rode teller op de
rail-knop voor opvolgingen die vandaag aan de beurt zijn. Nog te doen
(fase 2): Windows-melding op de opvolgdatum, taken mee in de back-up.
Microsoft To Do-sync is bewust niet gebouwd (alleen deze pc nodig).

**Eerder op 2026-11-24 - Opdrachten-module verwijderd**: de hele
feature is eruit - de rail-knop en weergave Opdrachten, de knop "Opdracht
aanmaken" boven een geopend bericht, het tabblad Opdrachten in Instellingen,
de assignments-export/-import, de Rust-module `opdrachten` (eigen SQLite-db +
herinnerings-poller) en de clipboard-plugin (crate, npm-pakket en
capability), die alleen door de kopieerknoppen op de kaarten werd gebruikt.
Oude `opdr*`-sleutels in localStorage of in een oudere instellingen-back-up
worden bij laden/importeren weggegooid (`mergeSettings`). Een bestaand
`%APPDATA%\BE-Mail\opdrachten.db` (of `opdrachten-dev.db`) blijft op schijf
staan; de app leest het niet meer en het mag met de hand weg.

**Ronde 2026-08-14:** het tijdgrid van #4 nagelopen met
nepdata (meerdaagse en over-middernacht-afspraken werden niet getoond), de
avatars van #6 aangevuld met echte profielfoto's uit Graph, de snelle acties
van #7 nagelopen met meer dan één actie ingesteld (naamloze knop, geen
terugkoppeling bij categorieën, geen volgorde), het uitstellen van #8 nagelopen
(een mislukte wekkerbeurt gooide de registratie weg, en je zag nergens wanneer
een bericht terugkwam), de hover-acties van #10 (ongelezen-teller liep achter,
vlagknop zonder staat, archiveren in Archief zelf), de gesprekskaarten van #11
(een lang bericht liep over de volgende kaart heen), het opslaan van berichten
uit #12 (nu ook meerdere tegelijk en via de rechtermuisknop) en het uitgebreide
zoeken van #13 (leeg formulier gaf een lege lijst, bereik was onzichtbaar). Zie
de bullets bij issue #4, #6, #7, #8, #10, #11, #12 en #13.

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
- Profielfoto's (#6) zijn met nepdata in een browser bekeken (foto, terugval op
  initialen, alle drie de maten). Tegen de echte Graph-API nog niet: dat vraagt
  eerst consent voor `User.ReadBasic.All` in de tenant. Zonder die consent is de
  app onveranderd - dan blijft alles initialen.
- Snooze die een niet-actief account wekt (#8): er is maar één account
  gekoppeld, dus het scenario is niet na te spelen. De rest van #8 (wekker die
  blijft proberen, terugkomtijd in de lijst, "Nu terugzetten", opnieuw
  uitstellen) is in een browser met nepdata nagelopen, inclusief een wekkerbeurt
  die expres mislukt; tegen de echte Graph-API nog niet.
- De snelle acties (#7) zijn met nepdata in een browser nagelopen (Office 365 én
  IMAP, met een lege actie ertussen). Het klikken zelf ging daar naar de
  nep-api; tegen de echte Graph-API is de nieuwe terugkoppeling nog niet
  bekeken. De aangeroepen commands (`move_message`, `set_message_categories`)
  zijn wel dezelfde die de leesbalk en het slepen al gebruiken.
- De hover-acties (#10) zijn met nepdata in een browser nagelopen (licht en
  donker, hover én toetsenbordfocus, in Postvak IN en in Archief); tegen de
  echte Graph-API nog niet. Ze gelden bovendien voor het bericht op de rij, niet
  voor het hele gesprek: archiveer je een ingeklapte conversatierij, dan verhuist alleen het
  nieuwste bericht en blijft de rij staan met de rest. Dat is wel consistent met
  de rest van de app (het vinkje en de leesbalk werken ook op één bericht),
  maar Outlook pakt daar het hele gesprek.
- End-to-end verificatie op Windows met echte IMAP-/CalDAV-servers (staat al
  langer open, sinds de IMAP-accounts).

## ✅ Af

- **Agenda bij uitnodigingen (2026-11-16)**: (in 0.3.0; in de echte app
  nagelopen tegen Office 365 op 2026-11-17)
  - Bij een uitnodiging, wijziging of annulering staat boven de knoppen een
    blok (`InviteCard.tsx`): datum en tijd, locatie, je antwoord tot nu toe
    en bij een verplaatste vergadering de oude tijd/plek doorgestreept (zoals
    Outlook). Daaronder een mini-dagweergave van je eigen agenda rond de
    vergadering (1 uur ervoor tot 1 uur erna, max. 8 uur), met overlappende
    afspraken naast elkaar en een melding "Overlapt met N andere afspraken".
    Bij een annulering: geen knoppen, wel "geannuleerd".
  - Rust: `invite_details` haalt de eventMessage zonder `$select` op (de
    afgeleide velden als `previousStartDateTime` komen anders niet mee) en
    expandeert de gekoppelde afspraak; tijden worden naar lokale wandkloktijd
    omgerekend (`to_local_wall_clock`, UTC -> Europe/Amsterdam met zomertijd).
  - Kop: "Corine van Gestel namens Bart van Esch" als `sender` en `from`
    verschillen (`sender` alleen bij één geopend bericht opgehaald).
  - IMAP: nog geen uitnodigingen (iMIP/.ics); daar verandert niets.
  - **Nog te controleren tegen de echte tenant:** of `previousStartDateTime`
    bij een verplaatste vergadering echt gevuld is, en bij een terugkerende
    vergadering of het eigen item niet dubbel in de dagweergave staat.

- **Gesprekken bij elkaar (2026-11-16, stap 1 + 2 van 3)**: (in 0.3.0;
  in de echte app nagelopen tegen Office 365 op 2026-11-17)
  - Stap 1 - volledig gesprek: het leesvenster haalt het hele gesprek op uit
    alle mappen (`get_conversation`), dus ook je antwoorden uit Verzonden items
    en oudere delen uit Archief. Een bericht uit een andere map krijgt een
    maplabel. Verwijderde items, ongewenste e-mail en concepten blijven weg.
    Graph: `$filter=conversationId eq '...'` (sorteren in Rust: Graph weigert
    `$orderby` bij dit filter). IMAP: SEARCH op Message-ID/References/
    In-Reply-To in Postvak IN, Verzonden en Archief.
  - Stap 2 - "Alles met <bedrijf>": balk boven het gesprek met alle recente
    gesprekken met het domein van de andere partij (`company_mail`), per
    gesprek met "wacht op jou" als het laatste bericht niet van jou is. Bij
    gmail.com e.d. en bij collega's op je eigen domein: per persoon. Open/dicht
    wordt onthouden (`companyPanelOpen`). Graph: `$search="participants:acme.nl"`;
    IMAP: `OR FROM "@acme.nl" OR TO ... CC ...`.
  - `stripPrefix` haalt nu ook "Antw:", "Doorst:", "AW:", "WG:" en gestapelde
    voorvoegsels weg (ook bij beantwoorden/doorsturen).
  - **Live gebleken (2026-11-17):** `participants:<domein>` geeft in Graph een
    HTTP 500 ("Unrecognized filter of type ...OrFilter"); met één adres werkt
    het wel. Voor een domein zoekt de app nu `from:`, `to:` en `cc:` los en
    voegt samen. **Nog te controleren:** voor opthoog.nl gaf elk veld 100
    treffers (het maximum); mogelijk matcht Exchange ook op het woord in
    namen/tekst, zodat interne mails over het project meekomen. Open vraag
    aan Franklin: de balk bij collega's (eigen domein) weglaten?
  - **Stap 3 (later):** handmatig koppelen/losmaken. Afgesproken: koppeling
    mag op de server (Office 365: verborgen eigenschap op de mail).

- **Beveiligings- en snelheidsronde (2026-11-16)**: (in 0.3.0; Office 365
  nagelopen in de echte app, IMAP/CalDAV nog niet tegen een echte server)
  - CalDAV stuurt het IMAP-wachtwoord niet meer ongevraagd mee: alleen naar de
    ingestelde agenda-host of na een 401 met Basic-uitdaging. Voorheen ging het
    bij de agenda-detectie naar `https://<maildomein>/.well-known/caldav`, vaak
    gewoon de website bij een hostingpartij. Omleiding https -> http wordt
    geweigerd.
  - Back-up export/import: de bestandskiezer draait nu in Rust
    (`bewaar_json`/`kies_json`); de webview geeft geen pad meer door.
    `schrijf_tekstbestand`/`lees_tekstbestand` (vrij lezen/schrijven van elk
    bestand) en de `dialog:*`-rechten zijn weg.
  - `fetch_remote_image` haalt alleen nog openbare adressen op (geen
    localhost/LAN/169.254.x, ook niet via redirect of DNS) - `src-tauri/src/net.rs`.
  - Mail-HTML in het leesvenster en het citaat zit in `contain: paint`, zodat een
    mail met `position: fixed` geen nep-scherm over de app kan leggen.
  - Links in mails: alleen http(s) naar de browser, `mailto:` opent het eigen
    opstelvenster, de rest wordt genegeerd.
  - OAuth-redirect: verbindingen zonder onze `state` worden genegeerd (een lege
    preconnect liet de login 5 minuten hangen; een vervalste `?error=` brak hem af).
  - `imap_quote` haalt CR/LF/NUL weg (geen IMAP-commando-injectie via Message-ID).
  - Snelheid: één gedeelde HTTP-client voor Graph/login/CalDAV/afbeeldingen
    (voorheen per actie een nieuwe TLS-handshake), en IMAP-sessies worden nu echt
    per account hergebruikt (pool; na 5 min stilte opnieuw verbinden). Voorheen
    deed elke klik TCP + TLS + LOGIN.

- **Uitgebreid zoeken (2026-07-27 + 2026-08-14, issue #13)**: pijltje naast het
  zoekvak klapt een formulier open met Van, Aan, CC, Onderwerp, Trefwoorden,
  datum van/tot, leesstatus en "heeft bijlagen" - zoals het Outlook-paneel uit
  de issue. De velden gaan **gestructureerd** naar de kern (`SearchQuery`), niet
  als kant-en-klare zoekstring: Graph vertaalt naar KQL (`from:…  AND
  received>=…`), IMAP naar SEARCH-criteria (`FROM "…" SINCE 1-Jan-2026`). Zoeken
  op bijlagen kan IMAP niet (geen criterium daarvoor); dat vinkje verschijnt
  daar niet. Einddatum is inclusief, ook bij IMAP (BEFORE is exclusief, dus
  +1 dag).
  **Aanvulling (2026-08-14):** het formulier echt gebruikt (browser, nepdata);
  vier dingen kwamen boven water:
  - **Een leeg formulier leverde een lege lijst.** De kern geeft op een leeg
    `SearchQuery` netjes nul resultaten terug, maar in beeld leek de map ineens
    leeg. De knop zegt nu "Vul minstens één zoekveld in" en laat de map staan.
  - **Het bereik was onzichtbaar bij uitgebreid zoeken.** De balk "Alle
    mappen"/"Deze map" hangt aan het snelle zoekvak, en dat wordt juist geleegd
    als je het formulier gebruikt - je zocht dus in een bereik dat je niet kon
    zien of wijzigen. "Zoeken in" staat nu bovenaan het formulier (zoals op de
    schermafdruk in de issue) en zoekt meteen opnieuw als je het omzet.
  - **Niets liet zien dat je naar een filter keek.** Boven de lijst staat nu
    "Zoekresultaten: N" met een knop "Filters wissen".
  - **Enter deed niets in de datumvelden en de keuzelijsten** (alleen in de
    tekstvelden); dat luistert nu op het hele formulier. Een einddatum vóór de
    begindatum geeft een melding in plaats van stilzwijgend nul resultaten.
- **Bericht opslaan als .eml (2026-07-27 + 2026-08-14, issue #12)**: knop in de
  leesbalk slaat het hele bericht (incl. headers en bijlagen) op in de
  Downloads-map. `.eml` omdat dat de ruwe MIME is en in elke mailclient opent.
  Graph levert die via `/$value`, IMAP via de bytes die er toch al zijn; beide
  schrijven via dezelfde `write_eml()` zodat de naamgeving gelijk is (onderwerp,
  afgekapt op 80 tekens, met oplopend volgnummer bij dubbele namen).
  **Aanvulling (2026-08-14):** opslaan kon alleen bij een geopend bericht, één
  voor één. Nu ook:
  - **Meerdere tegelijk**: knop in de bulkbalk slaat alle aangevinkte berichten
    op. Bewust los van `bulk()` - daar verandert er iets aan de mailbox en
    wordt de lijst herladen; hier blijft de selectie gewoon staan. Fouten geven
    één melding, niet twintig dezelfde.
  - **Rechtermuisknop** op een bericht in de lijst: "Bericht opslaan", zonder
    het bericht eerst te openen.
  - **Naamgeving zit nu in één module** (`src-tauri/src/download.rs`,
    `save_to_downloads()` + `write_eml()`). Graph en IMAP hadden elk hun eigen
    kopie van het opschonen en doornummeren, die ook nog net anders nummerden
    ("(1)" tegenover "(2)" bij de eerste dubbele naam). Meteen de
    **Windows-apparaatnamen** afgevangen: een bericht met onderwerp "CON" of een
    bijlage "nul.pdf" schreef naar het apparaat, waarna de app "opgeslagen"
    meldde terwijl er niets op schijf stond. Die krijgen nu een `_` ervoor.
    Vier unit-tests erbij (64 groen).
- **Conversatie als losse kaarten (2026-07-27 + 2026-08-14, issue #11)**: het leesvenster
  toonde één bericht; de rest van de conversatie zag je alleen uitgeklapt in de
  lijst. Nu krijgt elk bericht uit de conversatie een eigen kaart, het geopende
  volledig en de andere ingeklapt op één regel (avatar, afzender, datum,
  voorbeeld); klikken opent zo'n bericht. Het scrollgebied is nu `.thread` in
  plaats van `.reader-body`. **Beperking:** de conversatie komt uit de geladen
  lijst, dus eigen antwoorden uit Verzonden items zitten er niet bij zolang je
  in Postvak IN kijkt. Cross-folder ophalen kan met een Graph-filter op
  `conversationId`, maar is bewust niet in deze stap meegenomen.
  **Aanvulling (2026-08-14):** met een gesprek van vier berichten en een lang
  bericht ertussen (browser, nepdata) kwamen vier dingen boven water:
  - **Een lang bericht liep dwars over de volgende kaart heen.** `.thread` is
    een flexkolom, dus de kaart werd samengeperst tot de beschikbare hoogte
    terwijl de tekst gewoon doorliep - die stond dan over de ingeklapte kaart
    eronder. Kaarten krimpen niet meer (`flex: none`); scrollen doet `.thread`.
  - **Een net geopend bericht begon op de scrollpositie van het vorige.** Het
    scrollgebied blijft bij het wisselen hetzelfde element, dus je kwam midden
    in de tekst uit - of, in een gesprek, boven het geopende bericht. Het
    geopende bericht wordt nu bovenaan in beeld gezet.
  - **Aan wie het bericht ging, stond nergens.** Onder de afzender staan nu de
    Aan- en CC-regel (één regel, volledige lijst in de tooltip), zoals op de
    schermafdruk in de issue.
  - **Een ingeklapte kaart verzweeg zijn bijlage**; die krijgt nu een paperclip,
    en de datum een tooltip met het volledige tijdstip.
  Nog steeds anders dan Outlook: daar staan alle berichten van het gesprek
  tegelijk open. Hier is er één open en zijn de rest ingeklapt - meerdere
  tegelijk vraagt body, bijlagen en afbeeldingblokkering per kaart.
- **Hover-acties in de berichtenlijst (2026-07-27 + 2026-08-14, issue #10)**:
  bij hover (en bij toetsenbordfocus) verschijnen rechts in de rij vier knoppen:
  archiveren, gelezen/ongelezen, vlag en verwijderen. Ze liggen als overlay over
  de datum, zodat de rij niet verspringt (op de schermafdruk in de issue dekt de
  prullenbak de datum van Outlook net zo af). Verwijderen vraagt bevestiging,
  net als elders.
  **Aanvulling (2026-08-14):** met de knoppen echt aan het werk (in een browser
  met nepdata) kwamen vier dingen boven water:
  - **De ongelezen-teller liep achter.** Archiveren en verwijderen haalden het
    bericht wel uit de lijst, maar niemand trok de teller naast de map af - die
    bleef op de oude stand tot je de map opnieuw laadde. (Bulkacties deden dat
    al goed; die halen de mappen na afloop opnieuw op.) Binnen zoekresultaten
    kan het bericht uit een andere map komen, dus daar worden de tellers bij de
    server opgehaald in plaats van lokaal bijgewerkt.
  - **De vlagknop zag er altijd hetzelfde uit**, terwijl hij schakelt. Hij is nu
    rood als het bericht een vlag heeft (zelfde rood als de vlag in de rij) en
    het label zegt dan "Markering weg".
  - **Archiveren in Archief zelf** verplaatste het bericht naar zijn eigen map:
    Graph geeft het een nieuw id, de rij verdween en stond er bij de volgende
    verversing weer. In die map verschijnt de knop nu niet meer (ook niet in het
    rechtermuisknop-menu) en de sneltoets `e` zegt dat het bericht er al staat.
  - **Toetsenbordfocus** liet de knoppen zien op een rij zonder hover-kleur,
    waardoor het verloop achter de knoppen als grijze vlek afstak; de rij krijgt
    nu dezelfde achtergrond als bij hover.
- **Uitstellen (2026-07-27 + 2026-08-14, issue #8)**: het
  uitstellen zelf bestond al (later vandaag / morgenochtend / volgende week +
  eigen datum en tijd), maar de wekker keek alleen naar het **actieve** account.
  Wie in account B werkte, kreeg een uitgesteld bericht uit account A niet terug
  op het afgesproken moment. De wekker loopt nu over alle accounts via het
  nieuwe command `wake_snoozed` (expliciet account-id, verplaatst naar Postvak
  IN en zet ongelezen); het beeld ververst alleen als het actieve account
  wijzigde.
  **Aanvulling (2026-08-14):** met een gevulde Uitgesteld-map (in een browser
  met nepdata) kwamen vier dingen boven water:
  - **Een mislukte wekkerbeurt gooide de afspraak weg.** De registraties werden
    gewist *voordat* het verplaatsen werd geprobeerd, dus lag het netwerk plat
    op precies dat moment, dan bleef het bericht voorgoed in Uitgesteld staan.
    De registratie blijft nu staan en de wekker probeert het elke minuut
    opnieuw; pas na tien mislukte pogingen geeft hij het op, met een melding.
    Een trage ronde kan zichzelf niet meer inhalen (`wakeBusy`).
  - **Je zag nergens wanneer een bericht terugkwam.** In de map Uitgesteld staat
    nu bij elk bericht de terugkomtijd (klok-chip rechts op de onderwerpregel,
    tooltip met het hele moment), en de klok-knop boven een geopend bericht
    staat ingedrukt met het moment boven in het menu.
  - **Uitstellen was niet ongedaan te maken.** Het menu heeft nu "Nu
    terugzetten" (zelfde `wake_snoozed` als de wekker), en een ander moment
    kiezen voor een al uitgesteld bericht verplaatst niet opnieuw - dat gaf een
    tweede id, waarna de wekker op een spookbericht wachtte.
  - **Kleiner:** het datumveld begint op het al gekozen moment (of morgen 09:00)
    en weigert het verleden (`min`), "Later vandaag" verdwijnt zodra +3 uur op
    morgen valt, het menu sluit met Escape of een klik ernaast, de bevestiging
    noemt het gekozen moment, en de Uitgesteld-map wordt op NL én EN naam
    herkend (anders kreeg je na een taalwissel een tweede map).
- **Snelle acties (2026-07-27, issue #7)**: eigen knoppen boven een geopend
  bericht, in te stellen via Instellingen -> E-mail -> Snelle acties. Twee
  soorten: verplaatsen naar een map en een categorie toekennen. De actie
  bewaart de **naam** van de map/categorie, niet het id: mapid's verschillen
  per account, dus zo werkt dezelfde knop in elk account dat die map heeft
  (bestaat hij niet, dan zegt de app dat). Categorie-acties verbergen zich bij
  IMAP-accounts, want die kennen geen categorieën.
  **Aanvulling (2026-08-14):** met méér dan één actie ingesteld kwamen er drie
  dingen boven water (in een browser met nepdata, vier acties + één lege):
  - Een actie zonder gekozen map/categorie kreeg tóch een knop: alleen een
    icoon, zonder naam, en klikken gaf enkel de fout "map bestaat niet". Zo'n
    onaffe actie levert nu geen knop meer op, en in Instellingen staat erbij
    waarom je hem niet ziet.
  - Een categorie-knop **schakelt** (tweede klik haalt de categorie weer weg),
    maar zag er altijd hetzelfde uit. Hij toont nu de kleur van de categorie
    (zelfde bron als de chips) en een ingedrukte staat als het bericht hem al
    heeft; de tooltip zegt toekennen of weghalen. Er komt ook een melding, want
    de chip zelf staat buiten beeld zodra je in het bericht gescrold hebt.
    Verplaatsen naar de map waar het bericht al in staat, zei ook niets.
  - De volgorde van de knoppen was alleen te veranderen door acties te
    verwijderen en opnieuw toe te voegen; er zitten nu ↑/↓-knoppen bij.
  Lange map-/categorienamen kappen af op de knop (max 220 px) i.p.v. de balk op
  te rekken. Nog niet nagelopen: twee mappen met dezelfde naam onder een
  verschillende bovenmap - de keuzelijst toont die naam één keer en de knop
  pakt de eerste treffer.
- **Afzender-avatars (2026-07-27, issue #6)**: rond bolletje met initialen en
  een vaste kleur per afzender, in de berichtenlijst en boven een geopend
  bericht. Uit te zetten via Instellingen -> Berichtenlijst.
  **Aanvulling (2026-08-14): nu ook de echte profielfoto**, zoals op de
  schermafdruk in de issue. De foto komt via de Rust-kern uit Graph
  (`/users/{adres}/photo`, kleinste rendition 64x64) en gaat als `data:`-URI
  naar de webview; de CSP blijft dus dicht. Geen foto = gewoon de initialen,
  net als in Outlook. Details:
  - `User.ReadBasic.All` is als **hoogste, optionele scope-tier** toegevoegd in
    `auth.rs` (`FULL_SCOPES`, met de oude volle set als tussentier). Weigert de
    tenant de consent, dan zakt de upgrade netjes terug en verandert er niets.
    Je eigen foto komt via `/me/photo` en werkt dus altijd (`User.Read`).
  - Antwoorden worden gecachet in `cache.db` (tabel `photos`), inclusief "geen
    foto": de lijst vraagt er één per zichtbare rij en zou Graph anders bij elk
    scrollen raken. Foto een week geldig, "geen foto" een dag.
  - In de webview dedupliceert `Avatar.tsx` per adres (module-cache +
    lopende-aanvraag-map), zodat tien rijen van dezelfde afzender één call zijn.
  - IMAP-accounts vragen niets op (geen adreslijst) en houden initialen.
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

- **Instellingen-tabbladen + opdrachten-batch (2026-07-09)** (de
  opdrachten-delen zijn op 2026-11-24 weer verwijderd, zie boven):
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

- **Back-up & overzetten naar .json (2026-07-10)** (sinds 2026-11-24 alleen
  nog de instellingen; de assignments-export is met de opdrachten-module
  verwijderd): Instellingen ->
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
  drie de platforms bouwen. Zo uitgebracht: v0.1.1 t/m v0.1.3.
- **Lokale releases naar `f-de-groot/be-mail-releases`** (2026-11-13): zoals
  GitWorkflow en Vanguard. `npm run release` (`scripts/release.mjs`) bouwt en
  ondertekent de Windows-installers, scant ze met Defender en publiceert ze
  met `latest.json` in de nieuwe publieke releases-repo; de updater-endpoint
  wijst daarheen. Nieuwe updater-sleutel (de oude stond alleen als
  GitHub-secret), dus kopieën t/m 0.1.3 installeren 0.2.0 één keer met de
  hand. Skill `local-release`, plus `npm run deps:update` / `deps:report`
  (overgenomen van GitWorkflow). De CI-workflow draait niet meer op een tag.
- **Dependencies bijgewerkt** (2026-11-13): alle semver-compatibele updates
  (o.a. Tauri 2.12, vite 7.3.8, dompurify 3.4.17, rustls 0.23.46,
  quinn-proto 0.11.19), rusqlite 0.32 -> 0.42 voor RUSTSEC-2026-0459 (SQLite-CVE).
  `npm audit` en `cargo audit` schoon. Bewust niet: vite 8,
  @vitejs/plugin-react 6, TypeScript 7, reqwest 0.13, keyring 4,
  mail-parser 1.0, rand 0.10, dirs 7, webpki-roots 1.

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

- **IMAP met een echte server nalopen na de overstap naar imap 3 (2026-11-16).**
  `imap` 2.4.1 trok `imap-proto 0.10.2` mee (code die een toekomstige
  Rust-versie weigert). Omgezet naar `imap = "=3.0.0-alpha.15"` (exact
  gepind: alpha) met `imap-proto 0.16`; de future-incompat-melding is weg.
  Wat er veranderde in `imap.rs`: APPEND is een builder
  (`append(..).flag(..).finish()`), foutteksten zitten in `.information`, en
  SPECIAL-USE-mappen (`\Sent`, `\Trash`, ...) zijn eigen varianten in plaats
  van vrije tekst - zonder aanpassing waren Verzonden/Prullenbak stil niet
  meer gevonden (nu afgedekt door een test op echte LIST-regels). Ook worden
  ongevraagde serverberichten na elke actie weggegooid: imap 3 bewaart ze in
  de sessie, en die leeft sinds de pool urenlang. Nog niet getest tegen een
  echte IMAP-server: account toevoegen (mapdetectie), lezen, verzenden met
  Verzonden-kopie, concept opslaan, verplaatsen. Zodra er een stabiele
  `imap` 3.0 is: pin loslaten.
- `@tauri-apps/plugin-dialog` (npm) is verwijderd op 2026-11-16: de
  bestandskiezer draait sindsdien in Rust. De Rust-crate
  `tauri-plugin-dialog` blijft nodig.

- **Automatische cloud-sync via OneDrive (Graph) - GEPLAND, nog niet
  gebouwd.** Bovenop de handmatige .json-export (2026-07-10) is dit de
  afgesproken vervolgstap voor "niet meer alles opnieuw invullen op een
  andere pc". Aanpak:
  - **Hergebruik de bestaande O365-login** (geen tweede account/wachtwoord).
    De app is al met Graph geauthenticeerd; sla dezelfde JSON-blob
    (instellingen) op in de **app-map van de gebruiker in
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
    OneDrive/Dropbox-desktopclient al synct (nul extra rechten).


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
