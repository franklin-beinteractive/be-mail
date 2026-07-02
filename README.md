# BE-Mail

Een **simpele, snelle en veilige** e-mail- en agenda-client voor **Office 365**,
gebouwd met **Tauri (Rust) + React/TypeScript**. Outlook-achtig, maar veel
eenvoudiger — bedoeld voor zowel doorgewinterde IT'ers als 65-plussers.

- **Veilig:** moderne login (OAuth2 + PKCE), tokens in de Windows-keychain, nooit
  wachtwoorden in de app. Alle communicatie met Office 365 loopt via de Rust-kern.
- **Snel & licht:** native webview via Tauri (geen Electron).
- **Verbinding:** Microsoft Graph API (mail + agenda in één).

---

## 1. Wat je eenmalig nodig hebt

1. **Een Azure App Registration.** Laat je beheerder de korte instructie in
   [`docs/Azure-App-Registration.md`](docs/Azure-App-Registration.md) volgen. Je
   krijgt daarvan een **Client-ID** en een **Tenant-ID**.
2. **Ontwikkeltools** (alleen nodig om zelf te bouwen): Node.js 20+, Rust (stable)
   en de MSVC C++ build tools. Zie [`docs/Setup-local-environment.md`](docs/Setup-local-environment.md).

---

## 2. Compileren naar een `.exe`

Open PowerShell in de projectmap.

```powershell
npm install            # eenmalig: frontend-dependencies
npm run tauri build    # bouwt de release + installers
```

De eerste build duurt een paar minuten (Rust compileert alle crates één keer).
Daarna vind je de resultaten hier:

| Bestand | Wat | Locatie |
|---|---|---|
| **Installer (aanbevolen)** | `BE-Mail_0.1.0_x64-setup.exe` | `src-tauri/target/release/bundle/nsis/` |
| **MSI-installer** | `BE-Mail_0.1.0_x64_en-US.msi` | `src-tauri/target/release/bundle/msi/` |
| **Losse .exe** (portable) | `be-mail.exe` | `src-tauri/target/release/` |

> Geef de gebruiker de **setup.exe** of **.msi** — die installeert de app netjes met
> snelkoppeling. De losse `be-mail.exe` werkt ook direct (dubbelklikken), maar
> installeert niets.

### Ontwikkelen / live testen

```powershell
npm run tauri dev      # start de app met hot-reload
```

---

## 3. Eerste keer opstarten

1. **Verbinding instellen.** Bij de allereerste start verschijnt een instelscherm.
   Plak hier de **Client-ID** en **Tenant-ID** van je beheerder en klik *Opslaan*.
   (Deze gegevens worden lokaal opgeslagen; je hoeft dit maar één keer te doen.)
2. **Inloggen.** Klik op *Inloggen met Office 365*. Je browser opent de **echte
   Microsoft-inlogpagina** — vul daar je e-mailadres, wachtwoord en 2FA in. Je
   wachtwoord komt nooit in BE-Mail zelf.
3. Klaar. De app onthoudt je sessie en vernieuwt die stil op de achtergrond.

---

## 4. Hoe de software werkt

Links staat een smalle navigatiebalk met drie onderdelen:

### 📧 E-mail
- **Mappen** links (Postvak IN, Verzonden, Concepten, enz.) met ongelezen-tellers.
- **Berichtenlijst** in het midden, met zoekbalk, ongelezen-markering, vlag en
  "belangrijk"-aanduiding. Onderaan *Meer laden* voor volgende pagina's.
- **Leesvenster** rechts met:
  - Beantwoorden / Allen beantwoorden / Doorsturen
  - Vlaggen, gelezen/ongelezen, verplaatsen naar map, verwijderen
  - **Externe afbeeldingen worden geblokkeerd** (tracking-bescherming) tot je op
    *Externe afbeeldingen tonen* klikt.
  - Waarschuwing bij een **externe afzender**.
  - E-mail-HTML wordt veilig opgeschoond (scripts eruit).
- **Nieuw bericht** opstellen met Aan/CC/BCC, onderwerp, belang en tekst.

### 📅 Agenda
- **Maand-, week- en lijstweergave**, met *Vandaag* en vorige/volgende navigatie.
- **Nieuwe afspraak** met titel, datum/tijd, hele-dag, locatie, genodigden en een
  herinnering (minuten vooraf). Dubbelklik op een dag om er meteen één te maken.
- Klik op een afspraak voor details en verwijderen.

### ⚙️ Instellingen
- **Account** (ingelogde gebruiker) + uitloggen.
- **Weergave:** licht/donker thema, **tekstgrootte** (tot 150% voor slechtzienden),
  **hoog contrast**, en **taal** (Nederlands/Engels).
- **Verbinding** opnieuw instellen (Client-/Tenant-ID wijzigen).

---

## 5. Waar staat mijn data?

- **Tokens** (toegang tot je mailbox): veilig in **Windows Credential Manager**
  (de OS-keychain), versleuteld per gebruiker.
- **Instellingen** (Client-/Tenant-ID): een `config.json` in je gebruikers-configmap.
- **Weergavevoorkeuren** (thema, taal): lokaal in de app.
- **E-mail en afspraken** blijven op Office 365 — BE-Mail is een client, geen
  eigen server. Er wordt niets naar derden gestuurd.

---

## 6. Architectuur (kort)

```
React + TypeScript (webview)  ──IPC──►  Rust-kern (Tauri)  ──HTTPS──►  Microsoft Graph
   UI, geen tokens                       OAuth2/PKCE, tokens,           mail + agenda
                                         keychain, alle API-calls
```

De Rust-kern is de "trusted backend": tokens en netwerkverkeer leven daar, nooit in
de webview. Zie `src-tauri/src/` (auth, graph, token_store) en `src/` (React-UI).

---

## 7. Nog niet af (bewust, voor een volgende versie)

Deze v1 dekt de kern. De volgende geselecteerde functies staan nog op de lijst
(zie [`docs/FEATURES.md`](docs/FEATURES.md)): rich-text editor, handtekeningen,
sjablonen, uitgesteld/ongedaan verzenden, regels, afwezigheidsassistent,
bijlagen toevoegen bij opstellen, meerdere accounts, en Gmail/Google Agenda via de
al voorbereide provider-abstractie.
