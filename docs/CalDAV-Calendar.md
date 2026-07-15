# CalDAV-agenda voor IMAP-accounts

> Office-365-accounts halen hun agenda via Microsoft Graph. Een **IMAP-account**
> heeft geen agenda in het mailprotocol zelf; die komt van een **aparte CalDAV-
> server** (RFC 4791). BE-Mail probeert die bij het toevoegen best-effort te
> vinden. Voor het toevoegen van een IMAP-account zelf: zie
> [IMAP-Accounts.md](IMAP-Accounts.md).

## Hoe de agenda wordt gevonden

Bij het toevoegen van een IMAP-account detecteert BE-Mail de CalDAV-agenda
**automatisch** (best-effort):

1. Provider-tabel op e-maildomein (bv. iCloud -> `caldav.icloud.com`,
   Fastmail -> `caldav.fastmail.com`).
2. Anders `/.well-known/caldav` en de standaard CalDAV-ontdekking
   (current-user-principal -> calendar-home-set -> agenda-collecties) op basis
   van je domein en IMAP-host.

Lukt dit niet, dan kun je onder **Geavanceerd** in de toevoeg-dialoog een
**handmatige CalDAV-URL** invullen; die wordt bevestigd (moet een
agenda-collectie zijn) en anders valt de app alsnog terug op auto-detectie.

Wordt er **geen agenda gevonden**, dan heeft het account gewoon **geen agenda**.
De **Agenda-knop is verborgen** zolang geen enkel gekoppeld account een agenda
heeft (heb je er ook een Office-365-account bij, dan blijft de knop zichtbaar).

De gevonden agenda-instellingen (agenda-URL, host, of de server server-side
uitklappen van herhalingen ondersteunt, ...) worden bij het account bewaard in
`config.json`; alleen het (app-)wachtwoord staat in de keychain.

## Ondersteuning per provider

| Provider | Agenda via CalDAV? | Aandachtspunt |
|---|---|---|
| **iCloud** | Ja | App-specifiek wachtwoord (appleid.apple.com). |
| **Fastmail** | Ja | App-wachtwoord. |
| **cPanel / SabreDAV / Nextcloud / Radicale** | Ja | Werkt met Basic auth; evt. handmatige CalDAV-URL. |
| **Gmail** | **Nee** | Google-CalDAV vereist OAuth; werkt niet met een app-wachtwoord. **Mail werkt wel.** |
| **Outlook.com / Hotmail / Live** | **Nee** | Consumenten-Microsoft heeft geen CalDAV. **Mail werkt wel.** |

Bij Gmail en Outlook.com krijg je dus mail zonder agenda. Voor een agenda naast
die mailbox gebruik je een Office-365-account (Graph).

## Beperkingen (v1)

- **Terugkerende afspraken kun je niet los bewerken, verslepen of verwijderen.**
  Eén `.ics`-bestand bevat de hele reeks (de master-DTSTART + RRULE), dus een
  enkel voorkomen aanpassen zou de complete reeks herschrijven of wissen. De
  backend blokkeert dat en geeft de melding:
  *"Terugkerende afspraken kun je in deze versie niet los bewerken of
  verwijderen."* Losse (niet-terugkerende) afspraken bewerk/versleep/verwijder
  je gewoon.
- **Geen uitnodigingen via CalDAV.** Genodigden (ATTENDEE's) worden wel in de
  afspraak opgeslagen, maar er wordt **geen uitnodigingsmail verstuurd** (geen
  iTIP-scheduling).
- **De agenda is online-only.** Hij wordt niet offline gecachet (net als bij
  Graph). Zonder netwerk is er geen agenda.

## Problemen oplossen

- **401 / aanmelding geweigerd**: verkeerd (app-)wachtwoord, of de CalDAV-server
  verwacht een **afwijkende gebruikersnaam** dan je IMAP-login. Vul die dan in
  via de handmatige CalDAV-URL / geavanceerde velden.
- **Geen agenda gevonden**: probeer een **handmatige CalDAV-URL** onder
  Geavanceerd (de directe URL van je agenda-collectie). Bij Gmail en Outlook.com
  is er sowieso geen CalDAV-agenda beschikbaar.
