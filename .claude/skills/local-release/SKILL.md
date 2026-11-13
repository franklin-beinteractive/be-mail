---
name: local-release
description: Build a BE-Mail release on this machine and publish it on GitHub in one go - dependency update, version bump, release notes, release commit and tag, then `npm run release` builds the signed installers (.exe and .msi) and latest.json, scans them with Defender, publishes them as latest in f-de-groot/be-mail-releases and pushes the tag. Use when the user asks to make, prepare or publish a release, "maak een (lokale) release", "release klaarzetten" or "nieuwe release".
---

# Local release

The work is done by `scripts/release.mjs` (`npm run release`); this skill is
the procedure around it. The release section in `CLAUDE.md` explains the why.
It mirrors the `local-release` skill of GitWorkflow. The user does nothing on
GitHub: the script creates the release as a draft, uploads into it, publishes
it as latest and pushes `main` and the tag. Asking for a release is the go-ahead to publish it: once
the version and the previous release are settled (step 1), run all steps
through to the end without stopping for an OK. Stop only for a failure, which
is then reported.

Talk to the user in the language of the conversation. Everything that leaves the
repo (commit messages, tags, release notes) stays English. Never write an em
or en dash.

## 0. Can this machine release?

Any developer with write access can run this skill; the release goes out
through their own `gh` login and is signed with the BE-Mail updater key. Check
this first and stop with a short list of what is missing:

- `gh auth status` is signed in. If not, ask the user to run
  `! gh auth login` and then `gh auth setup-git`.
- `gh api repos/franklin-beinteractive/be-mail --jq .permissions.push` and the
  same for `f-de-groot/be-mail-releases` both print `true`. Otherwise the
  repository owner has to give them write access; stop.
- `node --version` has the major from `.nvmrc`, and the machine builds the app
  (`cargo --version` works; `docs/Setup-local-environment.md`).
- The updater key exists: `Test-Path ~/.tauri/be-mail.key` and
  `~/.tauri/be-mail-password.txt`, or the environment variables
  `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Check
  only that they exist; never read, print or ask for them. A missing key is
  never generated anew without the user's explicit decision: a new key stops
  every installed copy from updating (they refuse the signature) until it is
  reinstalled by hand.
- Nothing runs from this checkout: no `npm run tauri dev`, Vite or debug build
  of the app. `npm ci` (in `deps:update` and in the release) empties
  `node_modules`, and a running dev server holds files in it open: the install
  fails with `EPERM`. List the processes with
  `Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='be-mail.exe'"`
  and look for this repository's path. Ask the user to stop them; never kill
  them yourself.
- The checkout is `franklin-beinteractive/be-mail` (`git remote get-url
  origin`) on `main`. Once per checkout, `git config core.hooksPath .githooks`
  turns on the cleanup after a release (step 6).

## 1. Ask first, in one AskUserQuestion

- **Version:** patch (default, recommended), minor or major. Read the current
  version from `src-tauri/tauri.conf.json`; the previous release is
  `gh release list --repo f-de-groot/be-mail-releases --limit 1`.
- **Previous release:** may it be removed from `f-de-groot/be-mail-releases`
  once the new one is live?

## 2. Dependencies, locally

GitHub Actions does not build releases for this repo, so never start a
workflow. Everything runs on this machine.

1. `git pull --ff-only`.
2. `npm run deps:update` with `run_in_background` (several minutes when there
   are updates). It updates the lockfiles, verifies with `npm ci`,
   `tauri build --no-bundle` and the Rust tests, and on green makes a local
   commit *Update dependencies*. Nothing is pushed; `npm run release` pushes it
   along with the release.
3. **It fails: stop and report it to the user.** The script has already put the
   lockfiles back.
4. `npm run deps:report` and say in one sentence what falls outside the ranges
   (majors, advisories). Picking those up is only on request; `keyring` never
   moves without a sign-in test (CLAUDE.md, gotcha 1).

## 3. Version bump and release notes

- Bump the version identically in `package.json`, `src-tauri/Cargo.toml` and
  `src-tauri/tauri.conf.json`, then `cargo update -p be-mail` in `src-tauri/`
  so `Cargo.lock` follows.
- In `package-lock.json` change only the two `"version"` fields at the top, by
  hand. Never regenerate it. Then `npm ci --dry-run` must pass.
- Rewrite `.github/release-notes.md` from `git log <previous tag>..HEAD`
  (subjects and bodies): **what changed for the user**, under
  `**New in X.Y.Z**`, in the style of the existing notes - one line that sums
  up the release, then bullets grouped under the area of the app they touch
  (`Mail:`, `Calendar:`, `Everywhere:`), each opening with a bold phrase.
  Name what the user sees and does, not code, files or issue numbers; internal
  work (scripts, docs, refactors) stays out. End with one `Updated:` line
  naming the notable dependency bumps. The previous `**New in ...**` becomes
  `**From ...**` and stays below. Plain hyphens only, wrapped at about 76
  columns.
- The notes go out without asking, but they are published verbatim: write them
  carefully and show the `New in` section in the final report.
  `npm run release` refuses notes that do not start with `**New in X.Y.Z**` or
  contain an en or em dash.
- Update `docs/STATUS.md` when the release finishes something listed there.

## 4. Commit and tag, locally only

- Commit on `main` with the subject exactly `Release X.Y.Z`; anything else that
  ships goes in the body. End with the attribution line from the session.
- `git tag vX.Y.Z` - literally `v` plus the version.
- **Do not push.** `npm run release` pushes `main` and the tag as its last
  steps. Until then a fix is cheap: amend, then `git tag -f vX.Y.Z`.

## 5. Publish

Run `npm run release` with `run_in_background` straight after step 4; do not
ask first. The first local release compiles every dependency in release mode
and takes a while; later ones are much shorter.

It checks versions, the updater endpoint, a clean tree on `main`, the tag on
`HEAD`, release notes that start with this version, that the release does not
exist yet and that the updater key can sign. Then it builds the NSIS and MSI
installers, verifies both signatures against the pubkey in `tauri.conf.json`,
scans both with the local Defender, writes `latest.json`, creates the release
as a draft with three files (both installers and `latest.json`, which carries
the signatures), publishes it as latest, pushes `main` and the tag, and
checks that the updater endpoint serves the new version.

When it stops:

| Message | What to do |
|---|---|
| *EPERM ... unlink ... node_modules* | A dev server of this checkout holds the file (step 0). Ask the user to stop it, run `npm ci`, then the release again. |
| *The updater key cannot sign: the password does not open the key* | Ask the user to correct `~/.tauri/be-mail-password.txt` (or set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). Never ask for the password in the chat and never read or print the file. |
| *is signed with another key than the pubkey in tauri.conf.json* | The key in `~/.tauri` is not the one installed copies trust. Stop and ask. |
| *Defender flags ... / Defender removed ...* | Say so first and loudly, and stop. Never publish that build. |
| *.github/release-notes.md must start with "\*\*New in X.Y.Z\*\*"* | Write the notes (step 3), amend the release commit, `git tag -f vX.Y.Z`, run it again. |
| *Release vX.Y.Z already exists* | The version is wrong or was already released. Ask. |
| *Tag ... does not point at HEAD* / *uncommitted changes* | Fix the commit or tag (step 4), then run it again. |
| A build or compile error | Show the error. Fix it only when the cause is obvious, in its own commit before the release commit; otherwise report it. |
| *Creating the release failed; nothing was published* | The script removed its draft. Report the error; run it again once the cause is fixed. |
| *does not serve X.Y.Z yet; check it by hand* | Usually the CDN lagging a minute behind. Check the URL it prints again shortly; never publish again over it. |

## 6. Afterwards

Give the release URL, the installer's path in `release-files/vX.Y.Z/`, the
Defender result and the `New in` section of the notes that went out. The
pre-push hook starts the cleanup of the cargo build directory in the
background (only when `git config core.hooksPath` is `.githooks`).

If the user said yes in step 1, remove the previous release:
`gh release delete vPREV --repo f-de-groot/be-mail-releases --yes`. Never
remove the newest release, and add `--cleanup-tag` only when asked.

`npm run release:dry` builds with the repository checks as warnings and
publishes nothing: useful to see whether everything builds before a release.
