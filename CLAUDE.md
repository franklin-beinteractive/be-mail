# BE-Mail - projectinstructies voor Claude

Desktop-client voor Office 365 (mail + agenda) via Microsoft Graph.
**Stack:** Tauri v2 (Rust-kern) + React/TypeScript (webview). Auth = OAuth2
Authorization Code Flow met PKCE, public/native client (geen client secret).

> Voorkeur: desktop-apps altijd in **Tauri**, nooit Electron.

## Architectuur (kort)

- `src-tauri/src/auth.rs` - OAuth2/PKCE-login: opent systeembrowser, vangt de
  redirect af op een tijdelijke loopback-poort, wisselt de code in voor tokens.
- `src-tauri/src/token_store.rs` - tokens in de OS-keychain (Windows Credential
  Manager). Raken de webview/JS nooit; alleen de Rust-kern leest ze.
- `src-tauri/src/config.rs` - niet-geheime Client-ID + Tenant-ID als JSON in de
  configmap van de gebruiker (`%APPDATA%\BE-Mail\config.json`).
- `src/` - React-frontend; roept de Rust-kern aan via `src/lib/api.ts`.

## Bekende valkuilen / gotchas

### 1. Windows Credential Manager: max 2560 bytes per credential

Eén credential-blob mag op Windows max **2560 bytes** (UTF-16, ~1280 tekens) zijn.
Microsoft-tokens (access + refresh + `groups`-claims) zijn samen vaak 3–4 KB, dus
één `keyring::Entry::set_password(hele_json)` faalt met *"Kon tokens niet opslaan in
de keychain"* - afhankelijk van de tenant/gebruiker (grotere `groups`-claim = groter
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

### 3. HTML5 drag & drop vereist `dragDropEnabled: false`

Tauri onderschept op Windows standaard alle sleep-events in de webview (voor
bestand-drops op het venster). Daardoor vuurt `dragstart` in de pagina **nooit**
en lijkt alle HTML5 drag & drop (mappen sorteren, mails/afspraken slepen)
kapot, hoe correct de JS ook is. Fix: in `src-tauri/tauri.conf.json` bij het
venster `"dragDropEnabled": false` zetten. Keerzijde: bestanden op het venster
droppen werkt dan niet (bijlagen gaan via de bestandskiezer).

### 4. Projectmap hernoemen → altijd `cargo clean`

Cargo/Tauri bakken **absolute paden** in `src-tauri/target/`. Hernoem je de
projectmap (bv. `microrestart` → `BE-Mail`), dan wijzen die gecachte paden nog naar
de oude map en faalt de build met *"failed to read plugin permissions … Het systeem
kan het opgegeven pad niet vinden (os error 3)"* (het pad verwijst dan naar de oude
mapnaam). **Fix:** `cargo clean` in `src-tauri/`, daarna opnieuw bouwen.

### 5. De webview laadt nooit zelf externe URL's (CSP)

De CSP in `src-tauri/tauri.conf.json` staat bij `img-src` alleen `'self' data:
asset: blob:` toe. Een `<img src="https://…">` in een e-mail blijft dus kapot,
hoe goed de sanitizer ook meewerkt - dat was de oorzaak van issue #2. Verruim de
CSP **niet**: dan zou een tracking-pixel (ook via `background`-attributen en
`url(...)` in inline styles, die de "afbeeldingen tonen"-knop omzeilen) direct
het IP-adres, de user-agent en cookies van de gebruiker zien. Externe
afbeeldingen worden daarom na expliciete toestemming door de Rust-kern
opgehaald (`commands::fetch_remote_image`) en als `data:`-URI ingevuld door
`sanitizeEmail()` in `src/lib/format.ts`.

### 6. Poort 1420 blijft op Windows soms bezet na een dev-sessie

Vite draait met `strictPort: true` omdat `devUrl` in `tauri.conf.json` vast op
`http://localhost:1420` staat: uitwijken naar een andere poort kan dus niet.
Breekt een dev-sessie hard af, dan overleeft `node.exe` op Windows regelmatig
het sluiten van de npm-wrapper en faalt de volgende start met *"Port 1420 is
already in use"*. `scripts/free-dev-port.mjs` draait als npm-`predev` (dus ook
via `tauri dev`) en ruimt zo'n achtergebleven **vite** op. Houdt iets anders de
poort bezet, dan stopt het script daar bewust niets: het meldt wat het is en
geeft exitcode 1.

### 7. `src-tauri/target` groeit ongelimiteerd (26 GB op 2026-08-17)

Cargo ruimt zijn eigen rommel nooit op: `incremental/` krijgt een map per crate
*per* metadata-hash (6,2 GB), afgebroken link-stappen laten
`.tmpXXXX.temp-archive`-mappen achter (1,2 GB) en `deps/`/`build/` houden
artifacts van dependency-versies die niet meer in `Cargo.lock` staan (7,6 GB
ouder dan 30 dagen). Een kale `cargo clean` lost het op maar kost je de hele
dependency-cache, dus begint de volgende dev-build vanaf nul - zie ook valkuil 4,
waar `cargo clean` juist wél het antwoord is.

`scripts/clean-target.mjs` haalt alleen het dode deel weg:

- Handmatig: `npm run clean:target` (of `npm run clean:target:dry` om eerst te
  zien wat er weggaat). Vlaggen: `--keep=N` (incremental-caches per crate,
  default 2), `--deps-age=DAYS` (default 30, `0` slaat dat deel over),
  `--own-keep=N` (builds per eigen crate of testbinary, default 3; elke
  Cargo.toml-wijziging geeft die een nieuwe hash en laat de oude set staan),
  `--projects=DIR` (map waarvan alle Rust-projecten de build-directory delen,
  default de map boven deze repo, dus `D:\Desktop`; hun `cargo metadata`
  bepaalt welke crates als "eigen" tellen), `--target-dir=DIR` (een andere
  build-directory opruimen dan `cargo metadata` opgeeft),
  `--release` (ook `cargo clean --release`; staat **uit** sinds releases
  lokaal bouwen, anders begint de volgende release koud - en de
  build-directory is gedeeld, dus het raakt ook de andere projecten),
  `--dry-run`, `--force`.
- Automatisch: `.githooks/pre-push` ziet een `refs/tags/v*`-push - de laatste
  stap van `npm run release` - en start het script **losgekoppeld** op de
  achtergrond, zodat de push niet wacht op het verwijderen van tientallen
  GB's. De hook eindigt altijd met exit 0 en logt naar `clean-target.log` in
  de build-directory.
- **Eenmalig per checkout activeren:** `git config core.hooksPath .githooks`
  (Git kan hooks niet zelf uit de repo oppikken). Zonder die instelling werkt
  alleen het npm-script.
- Draait er een `cargo`/`rustc`, dan slaat het script zichzelf over en zegt dat
  in de log; de volgende release pakt het werk op.
- Let op de kosten van `--deps-age`: een dependency die simpelweg lang niet
  veranderde wordt ook opgeruimd en dus één keer opnieuw gecompileerd. Wil je
  dat niet, gebruik `--deps-age=0`.

Dit script staat identiek in de `git-workflow`-repo; verbeteringen graag in beide.

## Releases (op verzoek: "maak een nieuwe release")

Releases worden **lokaal gebouwd** met `npm run release`
(`scripts/release.mjs`), net als bij GitWorkflow en Vanguard. Het bouwt de
ondertekende NSIS- en MSI-installer, controleert de handtekeningen tegen de
`pubkey` in `tauri.conf.json`, scant beide met Defender en publiceert ze met
`latest.json` als latest in de publieke repo **`f-de-groot/be-mail-releases`**
(waar de updater sinds 0.2.0 naar kijkt). Pas daarna pusht het `main` en de
tag. In Claude Code doet de skill **`local-release`**
(`.claude/skills/local-release/SKILL.md`) het hele traject: dependencies
(`npm run deps:update`), versie, release-notes in `.github/release-notes.md`,
commit `Release X.Y.Z`, tag `vX.Y.Z` en publiceren. `npm run release:dry`
bouwt zonder iets te publiceren.

- **Updater-sleutel:** `~/.tauri/be-mail.key` + `~/.tauri/be-mail-password.txt`
  (of de env-vars `TAURI_SIGNING_PRIVATE_KEY` en `_PASSWORD`). Nooit in de repo
  of de chat. Een nieuwe sleutel betekent dat geïnstalleerde kopieën de update
  weigeren tot ze met de hand opnieuw installeren.
- **Overgang vanaf 0.1.3:** 0.2.0 kreeg een nieuwe sleutel (key-id
  `6FF1DBC0862D187D`; de oude stond alleen als GitHub-secret). Kopieën t/m
  0.1.3 kijken nog naar `franklin-beinteractive/be-mail` en vertrouwen de
  oude sleutel, dus die installeren 0.2.0 één keer met de hand; daarna
  werken ze zichzelf bij vanuit `be-mail-releases`.
- **Alleen Windows.** De oude CI-workflow (`.github/workflows/release.yml`,
  ook macOS/Linux) start niet meer op een tag-push, alleen nog met de hand.

## Werkwijze / voorkeuren

- Houd project-specifieke Claude-config (dit bestand, skills, docs) **in de repo**,
  zodat het meereist naar andere omgevingen/machines.
- **Voortgang bijhouden in `docs/STATUS.md`**: wat af is, waar we mee bezig zijn
  en de afgesproken volgorde van volgende stappen. Werk dit bij na elke
  afgeronde feature. (`docs/FEATURES.md` is de wensenlijst, geen status.)
- **Geen em dash ("—") in teksten**: gebruik een gewone "-". Geldt voor
  UI-teksten, docs, comments en commit-berichten.
- **Alles in de code en op GitHub is Engels**: alle code-comments (inline,
  docblocks, TODO's), commit-berichten, tags en release-notes, `README.md`,
  issues, pull requests en labels. Ook als het gesprek in het Nederlands gaat.
  Bestaande Nederlandse comments die je aanraakt, vertaal je meteen mee.
  Blijft Nederlands: de app-UI (via `i18n.ts`) en de interne werkdocumenten
  (`CLAUDE.md`, `docs/STATUS.md`, `docs/FEATURES.md` en de overige docs).
