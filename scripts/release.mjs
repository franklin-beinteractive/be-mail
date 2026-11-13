#!/usr/bin/env node
// Builds, signs and publishes a Windows release of BE-Mail from this machine.
// Modelled on scripts/release.mjs in the GitWorkflow repository.
//
//   npm run release          build, publish to be-mail-releases, push the tag
//   npm run release:dry      build with the repository checks as warnings,
//                            publish and push nothing
//
// Both leave their files in release-files/vX.Y.Z/ (gitignored).
//
// Expects the release commit on `main` with the tag vX.Y.Z on it (see the
// release section in CLAUDE.md). Steps:
//   1. Checks: the three version fields agree, the tree is clean, the tag
//      points at HEAD, .github/release-notes.md starts with this version, the
//      updater key is present and the release does not exist yet. A dry run
//      reports the repository checks as warnings and builds anyway. The key
//      signs a probe file first, so a wrong password fails now rather than
//      after a long build.
//   2. `npm ci` and `tauri build --bundles nsis,msi` with the updater key, so
//      every installer gets a .sig.
//   3. Every .sig is verified against the pubkey in tauri.conf.json: an update
//      signed with another key is downloaded by installed copies and then
//      refused, which nobody notices until they wonder why nothing updates.
//      The local Defender scans both installers.
//   4. latest.json (which carries the signatures), then a DRAFT release with
//      the installers and latest.json, published only once every upload is
//      in. The updater reads releases/latest/download/latest.json and must
//      never see half a release.
//   5. `git push origin main vX.Y.Z`, so the source repo only gets the tag
//      once the release is live (and the pre-push cleanup runs after the
//      build).
//
// Copies up to 0.1.3 poll the source repo and trust an older key, so they
// never see these releases: they are reinstalled by hand once.
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { targetDirOf } from './cargo-metadata.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tauriDir = path.join(repoRoot, 'src-tauri')
const flag = (name) => process.argv.includes(`--${name}`)
const dryRun = flag('dry-run')

// The public repo installed copies update from (plugins.updater.endpoints in
// tauri.conf.json points at its latest release).
const RELEASES_REPO = 'f-de-groot/be-mail-releases'


// Where `tauri signer generate` was told to write the key (docs/Releases.md).
const KEY_FILE = 'be-mail.key'
const PASSWORD_FILE = 'be-mail-password.txt'

// What changed, written by hand for every release: "**New in X.Y.Z**" on top,
// earlier versions below it under "**From X.Y.Z**". The release page shows the
// whole file; the update dialog gets the "New in" section only.
const NOTES = '.github/release-notes.md'

// npm and npx are .cmd shims on Windows, which only start through a shell.
// Node does not escape arguments for a shell, so everything passed to them
// here must be free of spaces and shell characters. git and gh are real
// executables and get their arguments verbatim.
function spawn(cmd, args, { cwd = repoRoot, capture = false, env } = {}) {
  const viaShell = process.platform === 'win32' && (cmd === 'npm' || cmd === 'npx')
  const r = spawnSync(viaShell ? [cmd, ...args].join(' ') : cmd, viaShell ? [] : args, {
    cwd,
    env,
    shell: viaShell,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  if (r.error) throw r.error
  return r
}

function step(cmd, args, opts) {
  console.log(`\n> ${[cmd, ...args].join(' ')}`)
  const r = spawn(cmd, args, opts)
  if (r.status !== 0) fail(`\`${[cmd, ...args].join(' ')}\` exited with ${r.status}`)
}

const git = (...args) => spawn('git', args, { capture: true })
const gh = (...args) => spawn('gh', args, { capture: true })

function fail(message) {
  console.error(`\n${message}`)
  process.exit(1)
}

/** Fatal for a real release; a dry run only reports it and builds anyway. */
function problem(message) {
  if (!dryRun) fail(message)
  console.warn(`warning: ${message}`)
}

function heading(text) {
  console.log(`\n=== ${text} ${'='.repeat(Math.max(0, 70 - text.length))}`)
}

const readText = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null)
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'))

const conf = readJson('src-tauri/tauri.conf.json')
const version = conf.version
const tag = `v${version}`
const outDir = path.join(repoRoot, 'release-files', tag)
const latestJsonUrl = (repo) => `https://github.com/${repo}/releases/latest/download/latest.json`

// --- checks -----------------------------------------------------------------

function checkVersions() {
  const npmVersion = readJson('package.json').version
  const cargoToml = fs.readFileSync(path.join(tauriDir, 'Cargo.toml'), 'utf8')
  const cargoVersion = cargoToml.match(/^\[package\][^[]*?^version\s*=\s*"([^"]+)"/m)?.[1]
  if (npmVersion !== version || cargoVersion !== version) {
    fail(
      `Versions disagree: tauri.conf.json ${version}, package.json ${npmVersion}, Cargo.toml ${cargoVersion}.\n` +
        'Bump all three to the same version.',
    )
  }
  const endpoint = conf.plugins?.updater?.endpoints?.[0]
  if (endpoint !== latestJsonUrl(RELEASES_REPO)) {
    fail(`The updater endpoint in tauri.conf.json is ${endpoint}, not ${latestJsonUrl(RELEASES_REPO)}.`)
  }
}

function checkRepository() {
  // `npm ci` must accept the lockfile with the npm it was written by.
  const wanted = fs.readFileSync(path.join(repoRoot, '.nvmrc'), 'utf8').trim()
  const running = process.versions.node.split('.')[0]
  if (wanted !== running) fail(`Node ${running} is running, but .nvmrc asks for ${wanted}. Switch Node first.`)

  const dirty = git('status', '--porcelain').stdout.trim()
  if (dirty) problem(`The working tree has uncommitted changes; a release is built from the tagged commit only:\n${dirty}`)

  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim()
  if (branch !== 'main') problem(`On branch ${branch}; releases are made from main.`)

  // The updater compares the tag with `version` in tauri.conf.json literally.
  const head = git('rev-parse', 'HEAD').stdout.trim()
  const tagged = git('rev-parse', '-q', '--verify', `refs/tags/${tag}^{commit}`).stdout.trim()
  if (!tagged) problem(`Tag ${tag} does not exist. Commit the release, then \`git tag ${tag}\`.`)
  else if (tagged !== head) problem(`Tag ${tag} points at ${tagged.slice(0, 7)}, not at HEAD (${head.slice(0, 7)}).`)

  // Pushing main at the end must not be rejected after the release is out.
  const fetched = git('fetch', '--quiet', 'origin', 'main')
  if (fetched.status !== 0) {
    problem(`Could not fetch origin/main; publishing needs the network anyway.\n${fetched.stderr.trim()}`)
  } else {
    const behind = git('rev-list', '--count', 'HEAD..origin/main').stdout.trim()
    if (behind !== '0') problem(`origin/main is ${behind} commit(s) ahead of HEAD. Run \`git pull --ff-only\` first.`)
  }
}

/** The notes are published verbatim, so they must be this version's before anything builds. */
function checkReleaseNotes() {
  const text = readText(path.join(repoRoot, NOTES))
  if (text == null) return problem(`${NOTES} is missing. Write what changed in ${version} (CLAUDE.md, releases).`)
  const first = text.split(/\r?\n/).find((line) => line.trim())
  if (first?.trim() !== `**New in ${version}**`) {
    problem(`${NOTES} must start with "**New in ${version}**" (it starts with "${first ?? ''}"). Write what changed first.`)
  }
  if (/[–—]/.test(text)) problem(`${NOTES} contains an en or em dash; use a plain hyphen.`)
}

function checkReleaseAbsent() {
  const existing = gh('release', 'view', tag, '--repo', RELEASES_REPO, '--json', 'isDraft', '--jq', '.isDraft')
  if (existing.status === 0) {
    const draft = existing.stdout.trim() === 'true'
    problem(
      draft
        ? `A draft release ${tag} already exists in ${RELEASES_REPO}. Delete it first: gh release delete ${tag} --repo ${RELEASES_REPO} --yes`
        : `Release ${tag} already exists in ${RELEASES_REPO}. Bump the version.`,
    )
  } else if (!/not found/i.test(existing.stderr)) {
    problem(`Could not query ${RELEASES_REPO} (is gh logged in?):\n${existing.stderr.trim()}`)
  }
}

/**
 * The updater key as tauri's bundler reads it. Environment variables win, so
 * the key can live elsewhere; otherwise the files in ~/.tauri.
 */
function updaterKeyEnv() {
  const dir = path.join(os.homedir(), '.tauri')
  const key = process.env.TAURI_SIGNING_PRIVATE_KEY || readText(path.join(dir, KEY_FILE))
  const password = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? readText(path.join(dir, PASSWORD_FILE))
  if (!key) fail(`No updater key: set TAURI_SIGNING_PRIVATE_KEY or put it in ${path.join(dir, KEY_FILE)}.`)
  if (password == null) {
    fail(`No key password: set TAURI_SIGNING_PRIVATE_KEY_PASSWORD or put it in ${path.join(dir, PASSWORD_FILE)}.`)
  }
  return {
    TAURI_SIGNING_PRIVATE_KEY: key.trim(),
    // Only the line ending an editor added; the password itself is verbatim.
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password.replace(/\r?\n$/, ''),
  }
}

/**
 * Signs a scratch file with the key and verifies it against the pubkey, so a
 * wrong password or a stale key fails in seconds instead of after the build,
 * which only signs at the very end.
 */
function checkUpdaterKey(keyEnv) {
  const probe = path.join(outDir, 'key-probe.txt')
  fs.writeFileSync(probe, `BE-Mail ${tag}`)
  fs.rmSync(`${probe}.sig`, { force: true })
  // Quoted: npx goes through a shell, and the path may hold spaces.
  const r = spawn('npx', ['tauri', 'signer', 'sign', `"${probe}"`], {
    capture: true,
    env: { ...process.env, ...keyEnv },
  })
  if (r.status !== 0 || !fs.existsSync(`${probe}.sig`)) {
    const reason = /password/i.test(r.stderr + r.stdout) ? 'the password does not open the key' : (r.stderr || r.stdout).trim()
    fail(`The updater key cannot sign: ${reason}.\nCheck TAURI_SIGNING_PRIVATE_KEY_PASSWORD or ~/.tauri/${PASSWORD_FILE}.`)
  }
  verifySignature({ file: probe, sig: `${probe}.sig`, name: 'the key probe' })
  fs.rmSync(probe, { force: true })
  fs.rmSync(`${probe}.sig`, { force: true })
}

// --- artifacts --------------------------------------------------------------

/** The installer of one bundle type from this build, plus its signature. */
function findInstaller(bundle, matches, builtAfter) {
  const dir = path.join(targetDirOf(tauriDir), 'release', 'bundle', bundle)
  const hits = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => name.includes(`_${version}_`) && matches(name))
    : []
  if (hits.length !== 1) {
    fail(`Expected one ${bundle} installer for ${version} in ${dir}, found ${hits.length ? hits.join(', ') : 'none'}.`)
  }
  const file = path.join(dir, hits[0])
  const sig = `${file}.sig`
  for (const f of [file, sig]) {
    if (!fs.existsSync(f)) fail(`${f} is missing. Is bundle.createUpdaterArtifacts still on in tauri.conf.json?`)
    // A file from an earlier build of the same version must never go out.
    if (fs.statSync(f).mtimeMs < builtAfter) fail(`${f} predates this build; refusing to publish it.`)
  }
  return { file, sig, name: hits[0] }
}

// The updater uses minisign. The pubkey and every .sig are base64 of a minisign
// text file whose second line holds the payload: for the key "Ed" + an 8-byte
// key id + the 32-byte Ed25519 key, for a signature "ED" + the key id + a
// 64-byte signature over the BLAKE2b-512 hash of the file.
function minisignPayload(base64) {
  const lines = Buffer.from(base64.trim(), 'base64').toString('utf8').split(/\r?\n/)
  return Buffer.from(lines[1] ?? '', 'base64')
}

function verifySignature({ file, sig, name }) {
  const pub = minisignPayload(conf.plugins.updater.pubkey)
  const signature = minisignPayload(fs.readFileSync(sig, 'utf8'))
  if (signature.length !== 74 || signature.subarray(0, 2).toString() !== 'ED') {
    fail(`${name}.sig is not a prehashed minisign signature.`)
  }
  if (!signature.subarray(2, 10).equals(pub.subarray(2, 10))) {
    fail(`${name} is signed with another key than the pubkey in tauri.conf.json; installed copies would refuse it.`)
  }
  const key = crypto.createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: pub.subarray(10, 42).toString('base64url') },
    format: 'jwk',
  })
  const digest = crypto.createHash('blake2b512').update(fs.readFileSync(file)).digest()
  if (!crypto.verify(null, digest, key, signature.subarray(10, 74))) fail(`The signature of ${name} does not match the file.`)
  console.log(`Signature OK: ${name}`)
}

/**
 * Scans an installer with the local Defender (exit code 2 = threats found;
 * -DisableRemediation leaves the file in place). It proves nothing clean, but
 * a build this machine already flags must never reach the updater. Real-time
 * protection removing the file as it was written is a verdict too.
 */
function defenderScan(file) {
  const name = path.basename(file)
  const mpCmdRun = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Windows Defender', 'MpCmdRun.exe')
  if (!fs.existsSync(mpCmdRun)) return `${name}: Defender could not be run here.`
  const scan = spawn(mpCmdRun, ['-Scan', '-ScanType', '3', '-File', file, '-DisableRemediation'], { capture: true })
  if (!fs.existsSync(file)) fail(`Defender removed ${name} right after it was written. Do not publish this build.`)
  if (scan.status === 2) fail(`Defender flags ${name} on this machine. Do not publish this build:\n${scan.stdout.trim()}`)
  return scan.status === 0 ? `${name}: Defender has no objection.` : `${name}: the Defender scan did not finish; nothing was flagged.`
}

// --- publishing -------------------------------------------------------------

const notesText = () => (readText(path.join(repoRoot, NOTES)) ?? '').replace(/\r\n/g, '\n').trim()

/** The release page: a short header, then the whole notes file. */
function releaseNotes(installer) {
  return [
    `<img src="https://raw.githubusercontent.com/${RELEASES_REPO}/main/logo.png" width="96" alt="BE-Mail">`,
    '',
    `Windows installer for **BE-Mail ${tag}**. Take \`${installer}\` under **Assets**; installed copies update themselves.`,
    '',
    notesText(),
  ].join('\n')
}

/**
 * The `notes` in latest.json: only the "New in" section, as plain text. The
 * update dialog shows them as text with its line breaks kept, so Markdown
 * marks are dropped and wrapped lines are joined again; the dialog shows the
 * version itself, so the heading goes too.
 */
function updaterNotes() {
  const lines = notesText().split('\n')
  const end = lines.findIndex((line, i) => i > 0 && /^\*\*From /.test(line.trim()))
  const blocks = []
  let previousBlank = true
  for (const raw of lines.slice(1, end < 0 ? undefined : end)) {
    const line = raw.trim()
    if (!line) {
      if (blocks.length && blocks[blocks.length - 1] !== '') blocks.push('')
    } else if (previousBlank || line.startsWith('- ')) {
      blocks.push(line)
    } else {
      blocks[blocks.length - 1] += ` ${line}`
    }
    previousBlank = !line
  }
  return blocks
    .join('\n')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*|`/g, '')
    .trim()
}

/** The updater manifest. Plain `windows-x86_64` is what the updater asks for; it gets NSIS. */
function updaterManifest(nsis, msi) {
  const entry = ({ sig, name }) => ({
    signature: fs.readFileSync(sig, 'utf8').trim(),
    url: `https://github.com/${RELEASES_REPO}/releases/download/${tag}/${name}`,
  })
  return {
    version,
    notes: updaterNotes(),
    pub_date: new Date().toISOString(),
    platforms: {
      'windows-x86_64': entry(nsis),
      'windows-x86_64-nsis': entry(nsis),
      'windows-x86_64-msi': entry(msi),
    },
  }
}

/** Removes a draft this run left behind. A published release is never touched. */
function discardDraft(repo) {
  const view = gh('release', 'view', tag, '--repo', repo, '--json', 'isDraft', '--jq', '.isDraft')
  if (view.status === 0 && view.stdout.trim() === 'true') {
    gh('release', 'delete', tag, '--repo', repo, '--yes')
    console.error(`Removed the incomplete draft ${tag} in ${repo}.`)
  }
}

/**
 * The latest.json installed copies will see, once it is this version's, or
 * whatever was served last (null when nothing parsed). GitHub's CDN can lag a
 * few seconds behind a fresh release.
 */
async function fetchLatestJson(url) {
  let served = null
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (res.ok) served = await res.json()
      if (served?.version === version) return served
    } catch {
      // Retried below.
    }
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  return served
}

async function checkEndpoint(repo) {
  const ok = (await fetchLatestJson(latestJsonUrl(repo)))?.version === version
  console.log(ok ? `${repo} serves ${version} to the updater.` : `${latestJsonUrl(repo)} does not serve ${version} yet; check it by hand.`)
  return ok
}

// --- main -------------------------------------------------------------------

heading(`BE-Mail ${tag}${dryRun ? ' (dry run)' : ''}`)
checkVersions()
const keyEnv = updaterKeyEnv()
checkRepository()
checkReleaseNotes()
checkReleaseAbsent()
// Fresh every build, so nothing from an earlier attempt can be uploaded.
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
checkUpdaterKey(keyEnv)

heading('Building')
step('npm', ['ci', '--no-audit', '--no-fund'])
// Two seconds of slack for file systems with coarse timestamps.
const buildStart = Date.now() - 2000
step('npx', ['tauri', 'build', '--bundles', 'nsis,msi'], { env: { ...process.env, ...keyEnv } })

heading('Verifying')
const nsis = findInstaller('nsis', (name) => name.endsWith('-setup.exe'), buildStart)
const msi = findInstaller('msi', (name) => name.endsWith('.msi'), buildStart)
verifySignature(nsis)
verifySignature(msi)

// The .sig files stay local: latest.json carries each signature inline and
// the updater never downloads a .sig.
const assets = [nsis.file, msi.file].map((file) => {
  const copy = path.join(outDir, path.basename(file))
  fs.copyFileSync(file, copy)
  return copy
})
for (const file of assets) console.log(defenderScan(file))
const notesFile = path.join(outDir, 'notes.md')
const manifestFile = path.join(outDir, 'latest.json')
fs.writeFileSync(notesFile, releaseNotes(nsis.name))
fs.writeFileSync(manifestFile, JSON.stringify(updaterManifest(nsis, msi), null, 2))
assets.push(manifestFile)

if (dryRun) {
  heading('Dry run complete')
  console.log(`Folder: ${outDir}`)
  for (const name of fs.readdirSync(outDir)) console.log(`  ${name}`)
  console.log('\nNothing was published or pushed.')
  process.exit(0)
}

heading(`Publishing ${tag} to ${RELEASES_REPO}`)
// The releases repo has no commits of this repo, so the tag goes on its own
// default branch.
const created = spawn('gh', [
  'release', 'create', tag,
  '--repo', RELEASES_REPO,
  '--target', 'main',
  '--draft',
  '--title', `BE-Mail ${tag}`,
  '--notes-file', notesFile,
  ...assets,
])
if (created.status !== 0) {
  discardDraft(RELEASES_REPO)
  fail('Creating the release failed; nothing was published.')
}
if (spawn('gh', ['release', 'edit', tag, '--repo', RELEASES_REPO, '--draft=false', '--latest']).status !== 0) {
  fail(`The draft ${tag} is complete but could not be published. Publish it on GitHub, then run: git push origin main ${tag}`)
}

heading('Pushing')
step('git', ['push', 'origin', 'main', tag])

heading('Checking the updater endpoint')
const endpointOk = await checkEndpoint(RELEASES_REPO)

heading(`Released ${tag}`)
console.log(`https://github.com/${RELEASES_REPO}/releases/tag/${tag}`)
process.exit(endpointOk ? 0 : 1)
