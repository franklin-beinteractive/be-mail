# BE-Mail — projectinstructies voor Claude

Desktop-client voor Office 365 (mail + agenda) via Microsoft Graph.
**Stack:** Tauri v2 (Rust-kern) + React/TypeScript (webview). Auth = OAuth2
Authorization Code Flow met PKCE, public/native client (geen client secret).

> Voorkeur: desktop-apps altijd in **Tauri**, nooit Electron.

## Architectuur (kort)

- `src-tauri/src/auth.rs` — OAuth2/PKCE-login: opent systeembrowser, vangt de
  redirect af op een tijdelijke loopback-poort, wisselt de code in voor tokens.
- `src-tauri/src/token_store.rs` — tokens in de OS-keychain (Windows Credential
  Manager). Raken de webview/JS nooit; alleen de Rust-kern leest ze.
- `src-tauri/src/config.rs` — niet-geheime Client-ID + Tenant-ID als JSON in de
  configmap van de gebruiker (`%APPDATA%\BE-Mail\config.json`).
- `src/` — React-frontend; roept de Rust-kern aan via `src/lib/api.ts`.

## Bekende valkuilen / gotchas

### 1. Windows Credential Manager: max 2560 bytes per credential

Eén credential-blob mag op Windows max **2560 bytes** (UTF-16, ~1280 tekens) zijn.
Microsoft-tokens (access + refresh + `groups`-claims) zijn samen vaak 3–4 KB, dus
één `keyring::Entry::set_password(hele_json)` faalt met *"Kon tokens niet opslaan in
de keychain"* — afhankelijk van de tenant/gebruiker (grotere `groups`-claim = groter
token). `token_store.rs` splitst de JSON daarom in stukken van 1000 tekens over
meerdere credential-items (`office365-tokens-0`, `-1`, …; `office365-tokens` bevat
het aantal). **Sla nooit het hele token-blok in één keychain-item op.**

### 2. Azure redirect-URI moet onder "Mobile and desktop applications"

De app gebruikt een **wisselende** loopback-poort: `http://localhost:<poort>`
(`auth.rs`). Azure accepteert de wisselende poort alleen als redirect
`http://localhost` staat onder platform **Mobile and desktop applications**
(public/native) én **Allow public client flows = Yes**. Veelvoorkomende fouten:
- `AADSTS50011` (redirect mismatch) → redirect staat onder **Web** (eist exacte
  poort) i.p.v. Mobile/desktop, of `https://localhost` gebruikt i.p.v. `http://`.
- `AADSTS7000218` (secret vereist) → *Allow public client flows* staat op No.

Zie `docs/Azure-App-Registration.md` voor de volledige registratie + troubleshooting.

### 3. Projectmap hernoemen → altijd `cargo clean`

Cargo/Tauri bakken **absolute paden** in `src-tauri/target/`. Hernoem je de
projectmap (bv. `microrestart` → `BE-Mail`), dan wijzen die gecachte paden nog naar
de oude map en faalt de build met *"failed to read plugin permissions … Het systeem
kan het opgegeven pad niet vinden (os error 3)"* (het pad verwijst dan naar de oude
mapnaam). **Fix:** `cargo clean` in `src-tauri/`, daarna opnieuw bouwen.

## Werkwijze / voorkeuren

- Houd project-specifieke Claude-config (dit bestand, skills, docs) **in de repo**,
  zodat het meereist naar andere omgevingen/machines.
- **Voortgang bijhouden in `docs/STATUS.md`**: wat af is, waar we mee bezig zijn
  en de afgesproken volgorde van volgende stappen. Werk dit bij na elke
  afgeronde feature. (`docs/FEATURES.md` is de wensenlijst, geen status.)
