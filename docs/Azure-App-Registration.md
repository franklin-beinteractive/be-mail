# Azure App Registration — instructie voor de beheerder

> Deze eenmalige registratie is nodig zodat **BE-Mail** veilig kan inloggen op
> Office 365 (Microsoft Graph). Het kost ~5 minuten. Aan het eind lever je twee
> waarden aan de gebruiker: **Client-ID** en **Tenant-ID**.
>
> BE-Mail gebruikt de moderne, veilige methode: **OAuth2 Authorization Code
> Flow met PKCE** (public/native client, dus **geen client secret**). Er worden
> nooit wachtwoorden in de app ingevoerd.

## Stappen

1. Ga naar het **Microsoft Entra admin center**: <https://entra.microsoft.com>
   (of Azure Portal → *Microsoft Entra ID*). Je hebt de rol **Application
   Developer**, **Cloud Application Administrator** of **Global Administrator** nodig.

2. **App registrations** → **New registration**.
   - **Name:** `BE-Mail`
   - **Supported account types:** *Accounts in this organizational directory only*
     (single tenant). — Wil je later ook andere organisaties toelaten, kies dan
     *Accounts in any organizational directory* (multi-tenant).
   - **Redirect URI:** kies platform **Public client/native (mobile & desktop)**
     en vul in: `http://localhost`
   - Klik **Register**.

3. Open de nieuwe app → **Authentication**:
   - Controleer dat onder **Platform configurations → Mobile and desktop
     applications** de redirect **`http://localhost`** staat.
   - Zet **Allow public client flows** op **Yes** en klik **Save**.

4. **API permissions** → **Add a permission** → **Microsoft Graph** →
   **Delegated permissions**. Voeg toe:
   - `User.Read`
   - `Mail.ReadWrite`
   - `Mail.Send`
   - `Calendars.ReadWrite`
   - `offline_access`
   - `openid`
   - `profile`

   Klik daarna op **Grant admin consent for <organisatie>** — die knop staat in de
   **actiebalk bovenaan de pagina "API permissions"** (naast *+ Add a permission*),
   dus eerst het toevoeg-venster sluiten. Na bevestigen wordt de statuskolom groen.

   > **Let op:** deze knop werkt **alleen als je beheerder bent** (Global/Cloud App
   > Admin); voor een gewone gebruiker is hij grijs. Dat is geen probleem: de
   > gevraagde rechten zijn **geen admin-only rechten**, dus als de tenant
   > "user consent" toestaat, geeft de gebruiker bij de **eerste login** zelf
   > toestemming via een accepteer-scherm. Admin-consent vooraf is dan optioneel —
   > alleen nodig als user-consent in jullie tenant is uitgeschakeld (dan verschijnt
   > bij login de melding *"admin approval required"* en moet een beheerder alsnog
   > op deze knop klikken).

   **Sneller alternatief voor de consent (op afstand):** stuur de beheerder deze
   link, met de Client-ID en Tenant-ID ingevuld. De beheerder logt in met zijn
   admin-account en klikt *Accepteren* — dit keurt de app in één keer goed voor de
   hele organisatie:

   ```
   https://login.microsoftonline.com/<TENANT-ID>/adminconsent?client_id=<CLIENT-ID>
   ```

5. Ga naar **Overview** en kopieer:
   - **Application (client) ID**  → dit is de **Client-ID**
   - **Directory (tenant) ID**    → dit is de **Tenant-ID**

## Aanleveren aan de gebruiker

Geef deze twee waarden door (mogen gewoon per mail — het zijn geen geheimen):

```
Client-ID:  xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
Tenant-ID:  xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

De gebruiker vult ze in op het instelscherm van BE-Mail bij het eerste opstarten.

## Veelgestelde vragen

- **Waarom geen client secret?** Een desktop-app kan een secret nooit echt geheim
  houden. PKCE beveiligt de flow zonder secret; dit is Microsofts aanbeveling voor
  native apps.
- **Is `http://localhost` veilig?** Ja. De redirect komt alleen binnen op de eigen
  computer van de gebruiker (loopback), op een tijdelijke poort. Microsoft staat
  loopback expliciet toe voor native apps.
- **Welke gegevens ziet de app?** Alleen de mailbox en agenda van de ingelogde
  gebruiker (delegated, least privilege). Geen toegang tot andere postvakken.

## Troubleshooting bij inloggen

- **`AADSTS50011` — redirect URI komt niet overeen.** De app gebruikt een
  wisselende loopback-poort (`http://localhost:<poort>`). Azure staat dat alleen toe
  als de redirect **`http://localhost`** onder platform **Mobile and desktop
  applications** staat (niet onder **Web**), en **Allow public client flows = Yes**.
  Let op: het moet **`http://`** zijn, niet `https://`, en zonder poort erachter.
- **`AADSTS7000218` — "request body must contain client_secret".** *Allow public
  client flows* staat nog op **No**, of de redirect staat onder **Web/SPA**. Zet op
  **Yes** en zorg dat `http://localhost` alleen onder **Mobile and desktop** staat.
- **Browser zegt "Inloggen gelukt" maar de app blijft op het inlogscherm.** De
  succespagina in de browser verschijnt vóórdat de tokens zijn opgeslagen; de echte
  fout staat als rode melding in het app-venster. Bekende oorzaak: *"Kon tokens niet
  opslaan in de keychain"* — de Windows Credential Manager begrenst één item tot
  2560 bytes en Microsoft-tokens zijn groter. De app slaat tokens daarom in stukken
  op (zie `CLAUDE.md`).
- **"Beheerdersgoedkeuring vereist" bij inloggen.** De app vraagt een (nieuwe)
  Graph-permission waarvoor gebruikers in deze tenant zelf geen toestemming mogen
  geven (bv. `People.Read`, nodig voor het autoaanvullen van genodigden). Oplossing
  (eenmalig, door een beheerder):
  1. Azure Portal → **App registrations** → *BE-Mail* → **API permissions**.
  2. Voeg onder **Microsoft Graph → Delegated permissions** toe:
     `User.Read`, `Mail.ReadWrite`, `Mail.Send`, `Calendars.ReadWrite`,
     `People.Read`, `offline_access` (openid/profile gaan vanzelf mee).
  3. Klik **Grant admin consent for &lt;organisatie&gt;** (vereist een
     beheerdersrol). Alle statussen worden groen ("Granted").
  4. Log daarna opnieuw in vanuit de app — de goedkeuringsvraag is weg.
  Alternatief: een beheerder logt éénmalig zelf in en vinkt bij de prompt
  *"Consent on behalf of your organization"* aan.
