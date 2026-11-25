---
name: verify
description: BE-Mail (Tauri 2 + React) end-to-end verifiëren op Windows - bouwen, starten, het echte venster aansturen met toetsenbord/muis en screenshots vastleggen.
---

# BE-Mail verifiëren (Tauri desktop, Windows)

> **NOOIT e-mail versturen** vanuit de app tijdens het verifiëren: hij draait
> op de echte mailbox. Geen Verzenden, geen Ctrl+Enter in het opstelvenster,
> geen antwoord op uitnodigingen. Zie `CLAUDE.md`.

## Bouwen & starten

```powershell
cd src-tauri; cargo test          # unit-tests van de Rust-kern
npm run tauri dev                  # start dev-server + app-venster (achtergrond)
```

- Eerste cargo-build duurt minuten; daarna seconden.
- Wachten tot de app draait: poll op proces `be-mail.exe`.

## Het venster aansturen

Het app-venster (titel "BE-Mail") is met keyboard + muis te
automatiseren vanuit PowerShell. **Essentieel:**

1. **`SetProcessDPIAware()` als eerste aanroepen** - elk PowerShell-proces is
   vers; zonder dit kloppen cursor-coördinaten niet op monitors met schaling
   of negatieve coördinaten (venster kan op tweede monitor staan).
2. `GetWindowRect` op `(Get-Process be-mail).MainWindowHandle` → alle klik- en
   screenshotcoördinaten zijn venster-relatief.
3. Kliks via `SetCursorPos` + `mouse_event(2/4)`; **verifieer met
   `GetCursorPos` dat de cursor op het doel staat vóór de klik** (de fysieke
   muis van de gebruiker kan storen) en retry anders.
4. Toetsenbord via `[System.Windows.Forms.SendKeys]::SendWait()`;
   `Esc` sluit dialogen, Enter bevestigt modals/velden.
5. Scrollen: `mouse_event(0x0800, 0, 0, -120, ...)` met **signed int** delta
   (dus P/Invoke-signatuur met `int d`, geen uint-gegoochel), cursor eerst
   boven het te scrollen paneel zetten.
6. Screenshots: `Graphics.CopyFromScreen` van het venster-rect → PNG in de
   scratchpad → met Read bekijken.

## Flows die de kern dekken

1. **Mail**: map kiezen → bericht openen in het leesvenster → beantwoorden of
   doorsturen opent het opstelvenster met het aangehaalde origineel.
2. **Agenda** (alleen accounts met agenda): de rail-knop Agenda tonen,
   dag/week/maand wisselen, een afspraak openen.
3. **Instellingen**: de tabbladen Algemeen / E-mail / Agenda; een wijziging
   (bv. thema) blijft na herstart staan.

## Valkuilen

- Knopposities verschuiven per scherm; maak per stap een screenshot en bepaal
  de coördinaten daaruit i.p.v. blind te klikken.
- localhost:1420 in een browser openen is GEEN geldige verificatie - daar
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
  is de afzender "Windows PowerShell" (geen app-identity) - dat is normaal;
  echte branding pas na installatie via de bundle.
- Sluiten (✕) verbergt naar de tray: controleer met proces-draait +
  `IsWindowVisible == false`; herstel met `ShowWindow(h, 9)`.
