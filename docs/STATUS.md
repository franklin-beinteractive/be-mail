# BE-Mail — voortgang

> Waar zijn we gebleven? Dit document wordt bij elke afgeronde stap bijgewerkt.
> De wensenlijst zelf staat in [FEATURES.md](FEATURES.md); dit is de *werkelijke* stand.

**Laatst bijgewerkt:** 2026-07-02 (avond — gebruikerswensen-batch afgerond)

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
  Opslag lokaal (localStorage), platte tekst.
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
  (inbox-regel "BE-Mail: … geblokkeerd" — beheerbaar via Outlook-regels).
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
- **Agenda**: maand/week/lijst, vandaag + navigatie, afspraak
  maken/**bewerken**/verwijderen, hele dag, locatie, herinnering, genodigden.
- **Overig**: donkere modus, tekstgrootte, hoog contrast, NL/EN,
  foutmeldingen in mensentaal.

## 🔜 Volgende stappen (afgesproken volgorde)

1. ~~Bijlagen (lezen + downloaden + meesturen)~~ ✅
2. ~~Concepten automatisch opslaan~~ ✅
3. ~~Handtekening(en)~~ ✅
4. ~~Mappenbeheer + bulkacties~~ ✅
5. ~~RSVP + terugkerende afspraken~~ ✅

6. ~~"Hoog & middel"-pakket~~ ✅ — rich-text editor, undo send / later
   verzenden, dag-/werkweekweergave, spam/blokkeren/uitschrijven,
   desktop-notificaties.

**Resterende achterhoede** (nog niet gepland): @-vermeldingen, regels-beheer
(UI voor messageRules), OOF/automatisch antwoord, offline caching (SQLite +
delta-sync), sneltoetsen, contacten/adresboek-autoaanvullen, threading,
categorieën, snoozen. Ook open: opmerkingen van de gebruiker over de
eerste rooktest.

## 📌 Openstaand / opmerkingen

- **Entra: beheerdersgoedkeuring vereist** — de nieuwe scope `People.Read`
  (autocomplete genodigden) triggert "Beheerdersgoedkeuring vereist" bij
  inloggen. Fix: in Entra bij de app-registratie de delegated permissions
  toevoegen en **Grant admin consent** klikken (stappen in
  `docs/Azure-App-Registration.md` → Troubleshooting).
- **Multi-account-migratie**: tokens staan nu per account opgeslagen —
  iedereen moet éénmalig opnieuw inloggen (koppelt het account).
- **Bitbucket-push geblokkeerd**: repo `quizmaster/be-mail` bestaat nog niet
  (workspace bevat alleen `dim.beren`); gebruiker maakt hem aan, daarna
  `git push -u origin main`. API-token van de MCP heeft geen
  `admin:repository`-scope, dus aanmaken via API kon niet.
- Gebruiker heeft nog opmerkingen over de eerste rooktest van de app —
  **nog niet besproken**, komt later.
- Grote bijlagen (>3 MB) vereisen Graph upload-sessions — bewust uitgesteld.
- `$search` werkt in deze tenant zonder `ConsistencyLevel`-header (getest).
