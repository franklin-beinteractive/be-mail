# BE-Mail

A simple, fast mail and calendar client for Windows, built with **Tauri (Rust) +
React/TypeScript**. Office 365 runs through Microsoft Graph with an OAuth2 +
PKCE sign-in; tokens stay in the Windows keychain and never reach the webview.

## Download

Take the installer from
[f-de-groot/be-mail-releases](https://github.com/f-de-groot/be-mail-releases/releases/latest).
Installed copies update themselves from there.

On first start BE-Mail asks for the Client ID and Tenant ID of an Azure app
registration - see [`docs/Azure-App-Registration.md`](docs/Azure-App-Registration.md).

## Build

Needs Node.js, Rust (stable) and the MSVC C++ build tools - see
[`docs/Setup-local-environment.md`](docs/Setup-local-environment.md).

```powershell
npm install
npm run tauri dev      # development, with hot reload
npm run tauri build    # release build + installer
```

Releases are built, signed and published locally with `npm run release`.

## Disclaimer

BE-Mail is provided **as is**, without warranty of any kind. You use it entirely
**at your own risk**. The author accepts **no responsibility or liability**
whatsoever for any damage, data loss, lost, misdirected or leaked mail, security
incidents or any other consequence of using this software or its source code.
There is no support.

Copyright (c) 2026 Be Interactive. All rights reserved.
