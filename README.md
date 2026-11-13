# BE-Mail

A simple, fast and secure mail + calendar client for **Office 365**, built with
**Tauri (Rust) + React/TypeScript**. Outlook-like, but far simpler - meant for
seasoned IT folks and 65-plus users alike.

- **Secure:** OAuth2 + PKCE login, tokens in the Windows keychain, no passwords
  in the app. All Office 365 traffic goes through the Rust core.
- **Fast & light:** native webview via Tauri, no Electron.
- **Connected:** Microsoft Graph API (mail and calendar in one).

## Requirements

1. An **Azure App Registration** - see
   [`docs/Azure-App-Registration.md`](docs/Azure-App-Registration.md). It gives
   you a **Client ID** and a **Tenant ID**.
2. To build it yourself: Node.js 20+, Rust (stable) and the MSVC C++ build
   tools. See [`docs/Setup-local-environment.md`](docs/Setup-local-environment.md).

## Build

```powershell
npm install            # once: frontend dependencies
npm run tauri build    # release build + installers
npm run tauri dev      # development, with hot reload
```

The first build takes a few minutes (Rust compiles every crate once). Output:

| File | Location |
|---|---|
| `BE-Mail_0.1.0_x64-setup.exe` (recommended) | `src-tauri/target/release/bundle/nsis/` |
| `BE-Mail_0.1.0_x64_en-US.msi` | `src-tauri/target/release/bundle/msi/` |
| `be-mail.exe` (portable) | `src-tauri/target/release/` |

## Download and releases

Installers are published in
[f-de-groot/be-mail-releases](https://github.com/f-de-groot/be-mail-releases/releases/latest);
installed copies update themselves from there. Releases are built and signed
locally with `npm run release` (`scripts/release.mjs`, which needs the updater
key in `~/.tauri/be-mail.key`); `npm run release:dry` builds without
publishing. `npm run deps:update` updates the dependencies first.

## First run

1. Paste the **Client ID** and **Tenant ID** in the setup screen and save. This
   is stored locally and only asked once.
2. Click *Sign in with Office 365*. Your browser opens the real Microsoft login
   page for password and 2FA - your password never touches BE-Mail.
3. Done. The session is remembered and refreshed silently.

## What it does

**Mail** - folders with unread counters, message list with search, flags and
importance, and a reading pane with reply / reply all / forward, flag,
read/unread, move, delete and a compose window (To/CC/BCC, subject,
importance). Remote images are blocked until you allow them, external senders
get a warning, and message HTML is sanitized.

**Calendar** - month, week and list views with *Today* and prev/next
navigation. Create events with title, date/time, all-day, location, attendees
and a reminder; double-click a day to add one straight away. Click an event for
details and delete.

**Settings** - account and sign out, light/dark theme, text size up to 150%,
high contrast, language (Dutch/English), and re-running the connection setup.

## Where your data lives

- **Tokens:** Windows Credential Manager, encrypted per user.
- **Client/Tenant ID:** `config.json` in your user config folder.
- **Display preferences:** locally in the app.
- **Mail and events** stay on Office 365. BE-Mail is a client, not a server, and
  sends nothing to third parties.

## Architecture

```
React + TypeScript (webview)  ──IPC──►  Rust core (Tauri)  ──HTTPS──►  Microsoft Graph
   UI, never sees tokens                 OAuth2/PKCE, tokens,           mail + calendar
                                         keychain, all API calls
```

The Rust core is the trusted backend: tokens and network traffic live there,
never in the webview. See `src-tauri/src/` (auth, graph, token_store) and `src/`
(React UI).

## Not yet included

Planned for a next version (see [`docs/FEATURES.md`](docs/FEATURES.md)):
rich-text editor, signatures, templates, delayed/undo send, rules, out-of-office,
attachments when composing, multiple accounts, and Gmail/Google Calendar through
the provider abstraction that is already in place.
