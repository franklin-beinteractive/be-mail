# BE-Mail — voortgang

> Waar zijn we gebleven? Dit document wordt bij elke afgeronde stap bijgewerkt.
> De wensenlijst zelf staat in [FEATURES.md](FEATURES.md); dit is de *werkelijke* stand.

**Laatst bijgewerkt:** 2026-07-02

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
- **Agenda**: maand/week/lijst, vandaag + navigatie, afspraak
  maken/**bewerken**/verwijderen, hele dag, locatie, herinnering, genodigden.
- **Overig**: donkere modus, tekstgrootte, hoog contrast, NL/EN,
  foutmeldingen in mensentaal.

## 🔜 Volgende stappen (afgesproken volgorde)

1. ~~Bijlagen (lezen + downloaden + meesturen)~~ ✅
2. ~~Concepten automatisch opslaan~~ ✅
3. ~~Handtekening(en)~~ ✅
4. **Mappenbeheer (aanmaken/hernoemen/verwijderen) + bulkacties** ← volgende
5. RSVP (uitnodiging accepteren/afwijzen) + terugkerende afspraken

Daarna (achterhoede, nog niet gepland): rich-text editor, dag-/werkweekweergave,
send later / undo send, desktop-notificaties, spam melden, uitschrijven-knop,
regels, OOF, offline caching, sneltoetsen.

## 📌 Openstaand / opmerkingen

- Gebruiker heeft nog opmerkingen over de eerste rooktest van de app —
  **nog niet besproken**, komt later.
- Grote bijlagen (>3 MB) vereisen Graph upload-sessions — bewust uitgesteld.
- `$search` werkt in deze tenant zonder `ConsistencyLevel`-header (getest).
