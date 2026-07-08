---
name: verify
description: BE-Mail (Tauri 2 + React) end-to-end verifiëren op Windows — bouwen, starten, het echte venster aansturen met toetsenbord/muis en screenshots vastleggen.
---

# Milky verifiëren (Tauri desktop, Windows)

## Bouwen & starten

```powershell
cd src-tauri; cargo test          # domeinlogica (statusmachine, werkdagen, acties)
npm run tauri dev                  # start dev-server + app-venster (achtergrond)
```

- Eerste cargo-build duurt minuten; daarna seconden.
- Dev-build gebruikt `%APPDATA%\BE-Mail\opdrachten-dev.db` (prod: `opdrachten.db`).
- Wachten tot de app draait: poll op proces `be-mail.exe`.

## Het venster aansturen

Het app-venster (titel "BE-Mail") is met keyboard + muis te
automatiseren vanuit PowerShell. **Essentieel:**

1. **`SetProcessDPIAware()` als eerste aanroepen** — elk PowerShell-proces is
   vers; zonder dit kloppen cursor-coördinaten niet op monitors met schaling
   of negatieve coördinaten (venster kan op tweede monitor staan).
2. `GetWindowRect` op `(Get-Process be-mail).MainWindowHandle` → alle klik- en
   screenshotcoördinaten zijn venster-relatief.
3. Kliks via `SetCursorPos` + `mouse_event(2/4)`; **verifieer met
   `GetCursorPos` dat de cursor op het doel staat vóór de klik** (de fysieke
   muis van de gebruiker kan storen) en retry anders.
4. Toetsenbord via `[System.Windows.Forms.SendKeys]::SendWait()` — de app is
   toetsenbord-vriendelijk: `N` = nieuwe aanvraag, `1/2/3` = tabs,
   `↑/↓` = selectie, `Esc` = sluiten, Enter bevestigt modals/velden.
5. Scrollen: `mouse_event(0x0800, 0, 0, -120, ...)` met **signed int** delta
   (dus P/Invoke-signatuur met `int d`, geen uint-gegoochel), cursor eerst
   boven het te scrollen paneel zetten.
6. Screenshots: `Graphics.CopyFromScreen` van het venster-rect → PNG in de
   scratchpad → met Read bekijken.

## Flows die de kern dekken

1. **Snel vastleggen**: `N` → naam + omschrijving → Enter → kaart verschijnt
   in actielijst met status Binnengekomen. Probe: Enter met lege naam →
   rode fout "Klantnaam is verplicht".
2. **Statusflow**: rij-knop "In behandeling" → detail openen → uren invullen
   (blur = opslaan) → "Naar planning sturen" → kaart naar wachtkamer →
   "Planning gaf een datum terug…" + datum (nl-formaat `dd-mm-jjjj` typen in
   date-input) → kaart komt ORANJE terug in actielijst ("Klant informeren",
   de afgedwongen stap) → "✓ Klant geïnformeerd" → wachtkamer.
3. **Feedback-lus**: → In uitvoering → controle → "Feedback → nieuwe ronde"
   + tekst → status terug naar Tijd inschatten met R2-badge, sectie
   "Rondes (2)", tijdlijn logt alles in het Nederlands.
4. **Herinneringen zonder wachten**: Instellingen (⚙) → "Demo-data laden"
   (alleen dev-build) zet geantidateerde kaarten neer: rode
   planning-herinnering, verlopen klant-informeren, heropenbare kaart enz.

## Valkuilen

- Statusknop-posities verschuiven per status; maak per stap een screenshot
  en bepaal de coördinaten daaruit i.p.v. blind te klikken.
- localhost:1420 in een browser openen is GEEN geldige verificatie — daar
  ontbreekt de Tauri IPC en faalt elke invoke.
- **Venster kan verstopt zitten onder andere vensters** (bijv. de terminal)
  en `SetForegroundWindow` wordt dan geweigerd (focus-steal-preventie).
  Oplossing: verplaats het venster met `SetWindowPos` naar vrije ruimte op
  een andere monitor en klik er eenmaal in (klik = focus).
- **De gebruiker werkt vaak tegelijk op de machine**: fysieke muisbewegingen
  vechten met `SetCursorPos`. Klik-loop: positie zetten → binnen ~15 ms
  verifiëren → direct klikken, en tot ~25× retryen met 400 ms tussenpauze.
  Houd muisgebruik kort en kondig het aan.
- **Toasts verifiëren**: notificaties verschijnen rechtsonder op de PRIMAIRE
  monitor en verdwijnen na ~6 s. Leg elke 4 s een frame vast van dat kwadrant
  (75 s dekt één poller-tick van 60 s) en inspecteer de frames. In dev-mode
  is de afzender "Windows PowerShell" (geen app-identity) — dat is normaal;
  echte branding pas na installatie via de bundle.
- Sluiten (✕) verbergt naar de tray: controleer met proces-draait +
  `IsWindowVisible == false`; herstel met `ShowWindow(h, 9)`.
- Klembord-verificatie: klik "Kopieer" in de app en lees `Get-Clipboard`.
