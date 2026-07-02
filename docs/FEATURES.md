# Email- & Agenda-client — Feature- en techniek-todo

> Doel: een Outlook-achtige, maar veel simpelere email + agenda client voor **Office 365** (later evt. Gmail/Google Agenda).
> Kernwaarden: **simpel, snel, veilig, responsive**. Doelgroep: van doorgewinterde IT'er tot 65-plusser.
>
> **Instructie:** vink aan wat je WILT (`[x]`), laat leeg wat je wilt OVERSLAAN, of zet `~` voor "later/misschien".
> Kolom **Complexiteit**: 🟢 laag · 🟡 middel · 🔴 hoog. Let op de 🔴's — die botsen vaak met "simpel".

---

## 0. Techniek & fundering (geen feature-keuze, maar bepaalt alles)

### Verbindingsmethode — advies: **Microsoft Graph API**
| Methode | Mail | Agenda | Auth | Toekomstvast? | Oordeel |
|---|---|---|---|---|---|
| **Microsoft Graph API** | ✅ | ✅ | OAuth2 | ✅ Actief doorontwikkeld | **Aanbevolen** |
| IMAP + SMTP | ✅ | ❌ (geen agenda) | OAuth2 verplicht (Basic Auth eruit) | ⚠️ Protocol blijft, maar beperkt | Alleen als je écht mail-only wilt |
| POP3 | ⚠️ (geen sync/mappen) | ❌ | OAuth2 verplicht | ❌ Verouderd | Afraden |
| EWS (Exchange Web Services) | ✅ | ✅ | OAuth2 | ❌ Wordt uitgefaseerd door MS | Afraden |
| CalDAV / CardDAV | ❌ | ✅ | OAuth2 | ⚠️ | Alleen los voor agenda |

**Conclusie:** Graph API dekt mail + agenda + contacten in één API. IMAP/SMTP alleen overwegen als je bewust géén agenda via het protocol wilt.

### Architectuur-beslissingen (VASTGELEGD)
- [x] **App-vorm**: **Desktop met Tauri** (Rust-core + webview). Geen Electron (te traag/zwaar).
- [x] **Tech-stack**: **Rust (Tauri backend) + React + TypeScript (frontend)**. Onderhoudbaar, veel voorbeelden.
- [x] **Beveiligingsmodel**: **Rust-core als trusted backend** — alle Graph-calls via Rust (`reqwest`), tokens raken de JS/webview nooit. (BFF-equivalent zonder eigen server.)
- [x] **OAuth2 Authorization Code Flow + PKCE**, public/native client (géén client secret).
- [x] **Redirect**: loopback `http://localhost:<poort>` (aanbevolen voor native apps).
- [x] **Token-opslag**: OS-keychain (Windows Credential Manager / macOS Keychain / Linux Secret Service) via `keyring`-crate of Tauri Stronghold. Per account een eigen sleutel.
- [x] **Eén account** in v1 (single-account). Multi-account = later (token-store is al per-account opgezet, dus uitbreidbaar).
- [ ] **Azure App Registration** aanmaken (client-id, redirect-URI, delegated Graph-permissions: `Mail.ReadWrite`, `Mail.Send`, `Calendars.ReadWrite`, `offline_access`, `User.Read`)
- [ ] **Provider-abstractie** (Rust-trait `MailProvider` / `CalendarProvider`) zodat Google later inplugbaar is
- [ ] **Offline/caching-strategie** (lokale cache, bv. SQLite, van mails/afspraken voor snelheid)
- [ ] **Delta-sync** (Graph `delta` queries) i.p.v. steeds alles ophalen → snelheid
- [ ] **Webhooks / change notifications** voor realtime updates (nieuwe mail/afspraak)

---

## 1. E-mail — lezen & navigeren
- [x] Postvak IN (Inbox) met berichtenlijst 🟢
- [x] Standaardmappen: Verzonden, Concepten, Prullenbak, Ongewenst/Spam, Archief 🟢
- [x] Eigen mappen aanmaken/hernoemen/verwijderen 🟢
- [x] Bericht openen & lezen (leesvenster / apart scherm) 🟢
- [ ] Threading / gesprekken groeperen (conversation view) 🟡
- [x] Ongelezen/gelezen markeren (en teller per map) 🟢
- [x] Vlaggen / markeren voor opvolging 🟢
- [x] Belangrijk / gemarkeerd (favorieten) 🟢
- [ ] Focused Inbox / "Belangrijk vs. Overig" splitsing 🟡
- [x] HTML- én platte-tekst-weergave 🟢
- [x] Externe afbeeldingen blokkeren tot toestemming (veiligheid) 🟡
- [x] Bijlagen bekijken/downloaden 🟢
- [ ] Voorbeeldweergave van bijlagen (PDF/afbeelding inline) 🔴
- [ ] Afzender-info / contactkaart bij bericht 🟡
- [x] Paginering / oneindig scrollen bij veel mail 🟢

## 2. E-mail — opstellen & versturen
- [x] Nieuwe mail opstellen 🟢
- [x] Beantwoorden / Allen beantwoorden / Doorsturen 🟢
- [x] CC / BCC 🟢
- [x] Rich-text editor (opmaak, lijsten, links) 🟡
- [x] Bijlagen toevoegen (upload + evt. vanuit OneDrive) 🟡
- [ ] Grote bijlagen als OneDrive-link 🔴
- [x] Concepten automatisch opslaan 🟡
- [x] Handtekening(en) instellen 🟡
- [x] Verzending uitstellen / plannen (send later) 🟡
- [x] Verzenden ongedaan maken (undo send, korte vertraging) 🟡
- [ ] Ontvangst-/leesbevestiging vragen 🟡
- [x] Prioriteit (hoog/laag) instellen 🟢
- [ ] Adresboek/auto-aanvullen op ontvanger 🟡
- [x] Sjablonen / standaardteksten 🟡
- [x] @-vermeldingen 🔴

## 3. E-mail — beheren & organiseren
- [x] Verwijderen (naar prullenbak) + definitief verwijderen 🟢
- [x] Archiveren (1-klik) 🟢
- [x] Verplaatsen naar map (drag & drop / menu) 🟢
- [x] Meerdere selecteren + bulkacties 🟡
- [x] Zoeken (afzender, onderwerp, inhoud, datum) 🟡
- [ ] Geavanceerd filteren/sorteren 🟡
- [x] Regels / automatische acties (bv. van X → map Y) 🔴
- [ ] Categorieën / kleurlabels 🟡
- [x] Spam/ongewenst melden & afzender blokkeren 🟡
- [x] Uitschrijven-knop bij nieuwsbrieven 🟡
- [ ] Snoozen / "toon later" 🟡
- [ ] Snelle acties (swipe op mobiel: archiveer/verwijder) 🟡

## 4. E-mail — accounts & instellingen
- [x] Inloggen met Office 365 (OAuth2) 🟢
- [ ] Meerdere accounts naast elkaar 🔴
- [ ] Gedeelde postvakken / mailbox delegation 🔴
- [x] Automatisch antwoord / afwezigheidsassistent (Out of Office) 🟡
- [x] Weergave-instellingen (dichtheid, leesvenster links/onder/uit) 🟡
- [x] Donkere modus 🟢

## 5. Agenda — weergave
- [x] Dag- / week- / werkweek- / maandweergave 🟡
- [x] Agenda-/lijstweergave (opsomming komende afspraken) 🟢
- [x] Vandaag-knop + datumnavigatie 🟢
- [ ] Meerdere agenda's naast elkaar (kleuren) 🟡
- [x] Weeknummers, weekend tonen/verbergen 🟢
- [ ] Tijdzone-weergave 🟡

## 6. Agenda — afspraken & beheer
- [x] Afspraak aanmaken/bewerken/verwijderen 🟢
- [x] Terugkerende afspraken (dagelijks/wekelijks/…) 🔴
- [x] Herinneringen / notificaties (bv. 15 min vooraf) 🟡
- [x] Locatie toevoegen 🟢
- [x] Hele-dag-evenementen 🟢
- [ ] Beschikbaarheid (vrij/bezet/voorlopig/afwezig) 🟡
- [ ] Categorieën/kleuren voor afspraken 🟢
- [ ] Bijlagen/notities bij afspraak 🟡

## 7. Agenda — vergaderingen & mensen
- [x] Genodigden uitnodigen 🟡
- [x] Uitnodiging accepteren/afwijzen/voorlopig (RSVP) 🟡
- [ ] Beschikbaarheid van collega's zien (scheduling assistant) 🔴
- [ ] Teams/online-vergadering-link toevoegen 🔴
- [ ] Vergaderruimtes boeken 🔴
- [ ] Agenda delen met anderen 🔴

## 8. Contacten (optioneel)
- [ ] Contactenlijst bekijken/zoeken 🟢
- [ ] Contact aanmaken/bewerken/verwijderen 🟡
- [ ] Contactgroepen / distributielijsten 🔴
- [ ] Integratie met adresboek van de organisatie (GAL) 🟡

## 9. Overkoepelend — kwaliteit voor de doelgroep
- [x] **Toegankelijkheid (65+)**: grote knoppen, groot lettertype-optie, hoog contrast, duidelijke labels 🟡
- [x] Volledige toetsenbordbediening + sneltoetsen (IT'er) 🟡
- [x] Responsive: telefoon / tablet / desktop 🟡
- [x] Snelle laadtijd + optimistische UI 🟡
- [x] Offline lezen (gecachte mail/afspraken) 🔴
- [x] Push-/desktop-notificaties bij nieuwe mail/afspraak 🟡
- [x] Meertaligheid (NL/EN) 🟡
- [x] Foutafhandeling in mensentaal (geen technische stacktraces) 🟢

## 10. Overkoepelend — veiligheid ("veilig"-tag)
- [x] OAuth2 + PKCE, geen wachtwoorden opslaan 🟢
- [x] Tokens veilig opslaan (server-side/keychain, niet in browser-localStorage) 🟡
- [x] Minimale Graph-permissions (least privilege) 🟢
- [x] Externe afbeeldingen/tracking-pixels blokkeren 🟡
- [x] Phishing-/spoofing-waarschuwingen (externe afzender, verdachte links) 🔴
- [ ] Automatische sessie-timeout / opnieuw inloggen 🟡
- [x] HTTPS/HSTS, CSP, veilige HTML-sanitizing van mailinhoud 🟡
- [ ] Audit/logging (wie deed wat) — vooral bij gedeelde postvakken 🔴
- [ ] AVG/GDPR: dataminimalisatie, waar staat de cache, verwijderbeleid 🟡

---

## Voorstel MVP (mijn advies voor "simpel & snel" — versie 1)
Alleen 🟢/🟡 die samen een bruikbare client vormen:
1. Login Office 365 (Graph API, OAuth2)
2. Inbox + standaardmappen, mail lezen (HTML + platte tekst)
3. Opstellen / beantwoorden / doorsturen, CC/BCC, bijlagen
4. Verwijderen / archiveren / verplaatsen / ongelezen-markeren / vlaggen
5. Zoeken
6. Agenda: week- & maandweergave, afspraak maken/bewerken/verwijderen, herinneringen
7. Donkere modus + toegankelijkheidsopties (groot font/contrast)
8. Veilig: BFF met server-side tokens, minimale permissions

Alles daarbuiten = versie 2+.
