# IMAP-accounts in BE-Mail

> BE-Mail begon als Office-365-client (mail + agenda via Microsoft Graph).
> Sinds deze versie kun je er ook een **IMAP-account** naast koppelen: mail via
> **IMAP** (lezen/beheren) en **SMTP** (verzenden), en de agenda apart via
> **CalDAV** (zie [CalDAV-Calendar.md](CalDAV-Calendar.md)). Een IMAP-account is
> een tweede accounttype naast Office 365, geen vervanging.

## Wat is een IMAP-account hier?

- **Mail** loopt over IMAP (mappen, berichten, vlaggen, verplaatsen, verwijderen)
  en **SMTP** (verzenden). Al het verkeer gaat versleuteld via rustls/ring, net
  als de rest van de app; er komt geen OpenSSL aan te pas.
- **Agenda** komt niet uit hetzelfde protocol, maar van een **aparte CalDAV-
  server**. Die wordt best-effort automatisch gedetecteerd bij het toevoegen.
  Vindt de app geen CalDAV, dan heeft het account simpelweg geen agenda.
- **Inloggen** gaat met **gebruikersnaam + wachtwoord of app-wachtwoord**. Er is
  in deze versie **geen OAuth** voor IMAP-accounts.
- Een IMAP-account krijgt dezelfde **offline SQLite-cache** en dezelfde
  **nieuwe-mail-notificaties** (poller elke 60 s) als een Office-365-account.

## Een IMAP-account toevoegen

Er zijn twee ingangen naar dezelfde dialoog **"IMAP-account toevoegen"**:

1. **Instellingen -> Algemeen -> Accounts**: klik onderaan op de knop **IMAP**
   (naast de knop **Office 365**).
2. **Het inlogscherm** (een verse installatie kan zonder Office 365 starten):
   klik op **"IMAP-account toevoegen"**.

### Velden

| Veld | Toelichting |
|---|---|
| **Weergavenaam** (optioneel) | Naam boven de mappengroep, bv. "Werk" of "Prive". |
| **E-mailadres** | Je adres, bv. `naam@voorbeeld.nl`. Ook de standaard-afzender. |
| **Wachtwoord** | Je wachtwoord of **app-wachtwoord** (zie hint hieronder). |

Zodra je het e-mailadres verlaat, vult BE-Mail bij bekende providers de
serverinstellingen **automatisch** in (host, poort, beveiliging) en toont het
zo nodig een hint (bv. dat Gmail of een Microsoft-account een app-wachtwoord
vraagt). Onder **Geavanceerd** kun je alles handmatig aanpassen:

- **IMAP-server** + poort + beveiliging (**SSL** of **STARTTLS**)
- **IMAP-gebruikersnaam** (leeg = het e-mailadres)
- **SMTP-server** + poort + beveiliging (**SSL** of **STARTTLS**)
- **SMTP-gebruikersnaam** (leeg = het e-mailadres)
- **CalDAV-URL** (optioneel; alleen invullen als de auto-detectie faalt, zie
  [CalDAV-Calendar.md](CalDAV-Calendar.md))

Met **"Verbinding testen"** controleer je IMAP- en SMTP-aanmelding voordat je
het account echt toevoegt. Bij een fout krijg je een leesbare melding (bv.
verkeerd wachtwoord of vraag om een app-wachtwoord).

### App-wachtwoord (Gmail / Microsoft / iCloud / Fastmail)

Providers met tweestapsverificatie accepteren je gewone wachtwoord niet voor
IMAP/SMTP; je hebt een **app-wachtwoord** nodig:

- **Gmail**: verplicht (met tweestapsverificatie aan); je normale wachtwoord
  werkt niet.
- **Microsoft (Outlook.com/Hotmail/Live)**: meestal een app-wachtwoord.
- **iCloud**: app-specifiek wachtwoord, aan te maken op appleid.apple.com.
- **Fastmail**: app-wachtwoord.

## Serverinstellingen per provider

De app vult deze bij bekende domeinen automatisch in. Ter referentie:

| Provider | IMAP | SMTP | App-wachtwoord |
|---|---|---|---|
| **Gmail** | `imap.gmail.com:993` (SSL) | `smtp.gmail.com:465` (SSL) | Ja, verplicht (2FA) |
| **Outlook.com / Hotmail / Live** | `outlook.office365.com:993` (SSL) | `smtp.office365.com:587` (STARTTLS) | Meestal |
| **iCloud** | `imap.mail.me.com:993` (SSL) | `smtp.mail.me.com:587` (STARTTLS) | Ja, app-specifiek |
| **Fastmail** | `imap.fastmail.com:993` (SSL) | `smtp.fastmail.com:465` (SSL) | Ja |
| **Eigen domein / cPanel (generiek)** | `mail.{domein}`: 993 (SSL) of 143 (STARTTLS) | `mail.{domein}`: 465 (SSL) of 587 (STARTTLS) | Nee (gewoon wachtwoord) |

De automatische invulling voor onbekende domeinen gokt op `imap.{domein}:993`
(SSL) en `smtp.{domein}:587` (STARTTLS). Bij veel gedeelde hostings (cPanel)
draait alles op **`mail.{domein}`**; pas dat dan onder Geavanceerd aan.

## Waar staat het wachtwoord?

Het wachtwoord/app-wachtwoord gaat naar de **OS-keychain** (op Windows de
Credential Manager), gechunkt onder de prefix `imap-secret` - net als de
Office-365-tokens. Het **raakt de webview/JS nooit**; alleen de Rust-kern leest
het. In `config.json` staan alleen de niet-geheime serverinstellingen.

## Beperkingen t.o.v. een Office-365-account

IMAP/SMTP + CalDAV bieden minder dan Microsoft Graph. De volgende functies zijn
**Graph-only** en werken niet voor een IMAP-account. Ze worden **automatisch
verborgen** in de UI zolang het actieve account een IMAP-account is:

- **Regels / filters** (inbox-regels beheren)
- **Categorieen** (kleurlabels)
- **Afwezigheid / automatisch antwoord** (Out of Office)
- **RSVP** op vergaderuitnodigingen (accepteren/voorlopig/afwijzen)
- **Afzender blokkeren** (inbox-regel)
- **"Later verzenden" / gepland verzenden**
- **Autoaanvullen van genodigden/ontvangers** (Graph `/me/people`)

Daarnaast:

- **Zoeken is per map**, niet over de hele mailbox in een keer (Graph `$search`
  bestaat niet in IMAP).
- De **agenda hangt af van CalDAV** en is er niet altijd (zie
  [CalDAV-Calendar.md](CalDAV-Calendar.md), o.a. geen agenda bij Gmail en
  Outlook.com).

Mail lezen/beheren/opstellen/verzenden, mappenbeheer, bijlagen, handtekeningen,
offline lezen en notificaties werken wel gewoon voor IMAP-accounts.
