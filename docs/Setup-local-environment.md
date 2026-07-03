# SETUP - Verse dev-machine klaarzetten voor willekeurige projecten

Dit bestand zet een **algemene ontwikkelomgeving** op: de standaard build-software zodat je daarna
**vers kunt beginnen aan verschillende projecten** - bijvoorbeeld een gekloonde **email-client**
(veelal ook Tauri/Rust/Node) - en die meteen kunt bouwen.

Open Claude Code (in een lege map of waar je je projecten wilt zetten) en **plak het hele blok**
hieronder als één bericht. Claude detecteert het OS, checkt per onderdeel of het al aanwezig is
(idempotent) en installeert alleen wat ontbreekt.

> **Git wordt niet geïnstalleerd** - het wordt alleen geverifieerd (je hebt het al en gebruikt het
> om te clonen). Krijg je toch een melding dat het ontbreekt, installeer het dan handmatig.
> Werkt op **Windows** (winget), **Linux** (apt/dnf/pacman) en **macOS** (Homebrew + Xcode CLT).

---

## ▶️ Prompt om te plakken in Claude Code

```
Zet deze machine klaar als algemene ontwikkelomgeving voor Node-, Rust- en Tauri-projecten,
zodat ik daarna vers kan beginnen aan verschillende projecten (bijv. een gekloonde email-client).
Werk stap voor stap, controleer per onderdeel eerst of het al aanwezig is (via `--version`) en
sla dat over als dat zo is. Detecteer eerst het besturingssysteem en volg dan het bijbehorende
pad. Installeer Git NIET - verifieer alleen dat `git --version` werkt en waarschuw als het
ontbreekt. Print aan het eind een overzicht van alle versies.

Standaard software om te installeren:
1. Node.js 20 LTS of nieuwer  (levert `node` + `npm`); activeer daarna Corepack (`corepack enable`)
   zodat `pnpm` en `yarn` beschikbaar zijn.
2. Rust stable via rustup       (levert `rustc` + `cargo`); daarna `rustup default stable`.
3. Een C/C++-build-toolchain (linker) voor de Rust-compiler en native modules.
4. WebView2-runtime (alleen Windows; nodig voor Tauri-apps; meestal al aanwezig op Win 11).
5. GitHub CLI `gh`  (handig voor clonen + authenticatie van private repos).
6. Optioneel: Claude Code CLI `claude`  (`npm install -g @anthropic-ai/claude-code`).
Git alleen VERIFIËREN, niet installeren.

── WINDOWS ────────────────────────────────────────────────────────
Gebruik winget; check telkens eerst `--version`.
- Node.js:      winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
- Rust:         winget install --id Rustlang.Rustup   -e --accept-source-agreements --accept-package-agreements
- C++ Build Tools (MSVC-linker; ik schrijf zelf geen C++):
    winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-source-agreements --accept-package-agreements --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
- WebView2:     winget install --id Microsoft.EdgeWebView2Runtime -e --accept-source-agreements --accept-package-agreements   (sla over als aanwezig)
- GitHub CLI:   winget install --id GitHub.cli        -e --accept-source-agreements --accept-package-agreements
Na Rustup: `rustup default stable` en verifieer `rustc --version` + `cargo --version`.
Let op: nieuw geïnstalleerde tools staan pas op PATH na het HERSTARTEN van de shell - herstart de
PowerShell-sessie (of ververs PATH) en meld het als de gebruiker de terminal opnieuw moet openen.

── LINUX (Ubuntu/Debian) ──────────────────────────────────────────
- Build- en Tauri-systeemdeps (Tauri 2 vereist WebKitGTK 4.1, NIET 4.0):
    sudo apt update
    sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
      libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev pkg-config
- Node.js 20+ : via nodesource of nvm; daarna `corepack enable`.
- Rust:        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
               en daarna:  source "$HOME/.cargo/env"
- GitHub CLI:  volg https://github.com/cli/cli/blob/trunk/docs/install_linux.md
(Fedora: dnf install webkit2gtk4.1-devel gcc-c++ make openssl-devel curl wget file libxdo-devel \
 libappindicator-gtk3-devel librsvg2-devel  ·  Arch: pacman -S webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg)

── macOS ──────────────────────────────────────────────────────────
- Xcode Command Line Tools (levert de clang-linker):  xcode-select --install
- Homebrew indien afwezig:  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
- Node.js:  brew install node   (daarna `corepack enable`)
- Rust:     curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y  (daarna: source "$HOME/.cargo/env")
- GitHub CLI:  brew install gh

── Verificatie & afronden ─────────────────────────────────────────
Verifieer en print de versies van: node, npm, (pnpm), rustc, cargo, git, gh (en claude indien
geïnstalleerd). Bevestig dat `git --version` werkt; zo niet, waarschuw dat Git nog handmatig
geïnstalleerd moet worden. Geef daarna aan dat de machine klaar is om een project te clonen.
```

---

## Daarna: een nieuw project clonen en bootstrappen

Zodra de omgeving staat, kun je elk project ophalen. Plak onderstaande vervolgprompt in Claude
Code en vul je repo-URL in (bijv. je email-client):

```
Clone het project van deze URL en maak het startklaar: <PLAK-REPO-URL>
Stappen:
1. `git clone <URL>` naar de huidige map en ga de projectmap in.
2. Detecteer het projecttype:
   - Node/JS/TS: zoek `package.json`. Gebruik de package manager die past bij het lockfile
     (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, anders `package-lock.json` → npm) en draai install.
   - Rust/Tauri: als er een `src-tauri/` of `Cargo.toml` is, is het een Tauri/Rust-project.
3. Lees de README/SPEC voor het juiste start-commando. Typische commando's:
   - Tauri-app:      npm run tauri dev
   - Web-frontend:   npm run dev
   - Kale Rust:      cargo run
4. Start de app en bevestig dat hij opent/draait. Los build-fouten op (meestal ontbrekende
   toolchain of niet-ververste PATH).
Geef aan het eind kort weer welk projecttype je vond, welk install-/start-commando je gebruikte,
en of het startte.
```

---

## Wat er geïnstalleerd wordt (referentie)

| Onderdeel | Waarom | Windows-package (winget) |
|---|---|---|
| **Node.js 20+** + npm + Corepack | JS/TS-projecten bouwen; Corepack levert pnpm/yarn | `OpenJS.NodeJS.LTS` |
| **Rust** (rustup) | Rust-/Tauri-backends | `Rustlang.Rustup` |
| **C++ Build Tools** | MSVC-**linker** voor Rust + native modules | `Microsoft.VisualStudio.2022.BuildTools` (workload *VCTools*) |
| **WebView2** | native WebView voor Tauri-apps | `Microsoft.EdgeWebView2Runtime` (meestal aanwezig) |
| **GitHub CLI `gh`** | clonen + auth van (private) repos | `GitHub.cli` |
| **Claude CLI `claude`** *(optioneel)* | Claude Code in de terminal | `npm i -g @anthropic-ai/claude-code` |
| **Git** | *niet geïnstalleerd - alleen geverifieerd* | *(al aanwezig)* |

## Snelle handmatige route (Windows)

```powershell
git --version                                  # controleer dat Git er is (niet installeren)
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Rustlang.Rustup -e
winget install --id GitHub.cli -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install --id Microsoft.EdgeWebView2Runtime -e   # alleen als het ontbreekt
rustup default stable
corepack enable
# --- Herstart de terminal zodat PATH ververst, daarna clonen: ---
git clone <REPO-URL>
```

> **Tip:** na het installeren van nieuwe tools moet je de terminal **opnieuw openen** voordat
> `node`, `cargo` en `gh` op je PATH staan. De eerste `tauri dev`/`cargo build` van een project
> compileert alle Rust-crates één keer (enkele minuten); daarna is het snel.

Zie [`SETUP.md`](./SETUP.md) voor de projectspecifieke variant (die deze GitForge-repo direct
bouwt en start).
