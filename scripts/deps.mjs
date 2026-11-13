#!/usr/bin/env node
// Helpers for the dependency update in scripts/update-deps.mjs (copied from
// the GitWorkflow repository, which also runs it from a workflow). Three
// subcommands, all read-only:
//
//   changes  What moved between the committed lockfiles (HEAD) and the ones in
//            the working tree, as plain text for the body of the update
//            commit. Direct dependencies by name, the rest as a count.
//
//   report   Everything an automatic, semver-compatible update can NOT take
//            care of, as Markdown for the tracking issue:
//              - newer versions outside the range in package.json/Cargo.toml
//                (a new major, or a new 0.x minor), which may need code changes;
//              - vendored crates (src-tauri/vendor) whose upstream has moved on;
//              - known security advisories that are still open afterwards.
//            A crate version that Tauri's own dependency tree also uses is
//            listed as held back rather than as work: upgrading it alone adds
//            a second copy of the crate without removing the first.
//
//   outdated The upgrades from `report` as JSON, for the majors pass of
//            scripts/update-deps.mjs.
//
// Usage (from anywhere):
//   node scripts/deps.mjs changes  [--out=FILE] [--base=REV]
//   node scripts/deps.mjs report   [--out=FILE] [--cargo-audit=FILE]
//   node scripts/deps.mjs outdated [--out=FILE]
//
// `report` sets `actionable=true|false` in $GITHUB_OUTPUT when that exists, so
// the workflow knows whether to open (or close) the tracking issue. The
// cargo-audit JSON can be passed in (the workflow installs a prebuilt
// cargo-audit); without it a locally installed `cargo audit` is run.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tauriDir = path.join(repoRoot, 'src-tauri')
const vendorDir = path.join(tauriDir, 'vendor')
const OWN_CRATE = 'be-mail'

const [command, ...rest] = process.argv.slice(2)
const flags = Object.fromEntries(
  rest.filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.slice(2).split('=')
    return [k, v ?? true]
  }),
)

// The commit whose lockfiles `changes` compares against.
const base = typeof flags.base === 'string' ? flags.base : 'HEAD'

function run(cmd, args, opts = {}) {
  // On Windows npm is a .cmd shim, which only starts through a shell. Node
  // does not escape arguments for a shell, so the command goes in as one
  // string - every argument passed here is a constant without spaces.
  const viaShell = process.platform === 'win32' && cmd === 'npm'
  const r = spawnSync(viaShell ? [cmd, ...args].join(' ') : cmd, viaShell ? [] : args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: viaShell,
    ...opts,
  })
  if (r.error) throw r.error
  return r
}

function gitShow(rel) {
  const r = run('git', ['show', `${base}:${rel}`])
  return r.status === 0 ? r.stdout : ''
}

// --- lockfile parsing -------------------------------------------------------

/** name -> Set(version) from a Cargo.lock. */
function parseCargoLock(text) {
  const out = new Map()
  for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = block.match(/^name = "([^"]+)"/m)?.[1]
    const version = block.match(/^version = "([^"]+)"/m)?.[1]
    if (!name || !version || name === OWN_CRATE) continue
    if (!out.has(name)) out.set(name, new Set())
    out.get(name).add(version)
  }
  return out
}

/** name -> Set(version) from a package-lock.json (format v2 or v3). */
function parseNpmLock(text) {
  const out = new Map()
  if (!text) return out
  const packages = JSON.parse(text).packages ?? {}
  for (const [key, info] of Object.entries(packages)) {
    if (!key || !info.version || info.link) continue
    const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)
    if (!out.has(name)) out.set(name, new Set())
    out.get(name).add(info.version)
  }
  return out
}

function diffLocks(before, after) {
  const changed = []
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const a = [...(before.get(name) ?? [])].sort()
    const b = [...(after.get(name) ?? [])].sort()
    if (a.join() !== b.join()) changed.push({ name, from: a.join(', ') || '-', to: b.join(', ') || '-' })
  }
  return changed.sort((x, y) => x.name.localeCompare(y.name))
}

// --- direct dependencies ----------------------------------------------------

function npmDirect() {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  return new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])
}

/** The app crate's own dependencies (all targets, normal and build). */
function cargoDirect() {
  const r = run('cargo', ['metadata', '--no-deps', '--format-version', '1'], { cwd: tauriDir })
  if (r.status !== 0) throw new Error(`cargo metadata failed:\n${r.stderr}`)
  const own = JSON.parse(r.stdout).packages.find(p => p.name === OWN_CRATE)
  return new Map(own.dependencies.map(d => [d.name, d]))
}

// --- changes ----------------------------------------------------------------

function section(title, changed, direct) {
  if (!changed.length) return []
  const mine = changed.filter(c => direct.has(c.name))
  const others = changed.length - mine.length
  const lines = [`${title}: ${changed.length} package${changed.length === 1 ? '' : 's'} changed`]
  for (const c of mine) lines.push(`- ${c.name} ${c.from} -> ${c.to}`)
  if (others) lines.push(`- and ${others} transitive package${others === 1 ? '' : 's'}`)
  return [...lines, '']
}

function changes() {
  const cargo = diffLocks(
    parseCargoLock(gitShow('src-tauri/Cargo.lock')),
    parseCargoLock(fs.readFileSync(path.join(tauriDir, 'Cargo.lock'), 'utf8')),
  )
  const npm = diffLocks(
    parseNpmLock(gitShow('package-lock.json')),
    parseNpmLock(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8')),
  )
  const lines = [
    ...section('Rust (src-tauri/Cargo.lock)', cargo, cargoDirect()),
    ...section('npm (package-lock.json)', npm, npmDirect()),
  ]
  return lines.length ? lines.join('\n') : 'No dependency changes.\n'
}

// --- report -----------------------------------------------------------------

async function cratesIoLatest(name) {
  try {
    const res = await fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`, {
      // crates.io refuses requests without a descriptive User-Agent.
      headers: { 'User-Agent': 'be-mail-dependency-report' },
    })
    if (!res.ok) return null
    const body = await res.json()
    return body.crate?.max_stable_version ?? null
  } catch {
    return null
  }
}

/** Numeric compare of dotted versions; pre-release suffixes are ignored. */
function cmpVersion(a, b) {
  const pa = a.split(/[.+-]/).map(Number)
  const pb = b.split(/[.+-]/).map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return Math.sign(d)
  }
  return 0
}

/** npm packages whose newest release lies outside the range in package.json. */
function npmOutdated() {
  // Exits 1 whenever anything is outdated; the JSON is on stdout either way.
  const r = run('npm', ['outdated', '--json'])
  const data = r.stdout.trim() ? JSON.parse(r.stdout) : {}
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  return Object.entries(data)
    .filter(([, i]) => i.latest && i.wanted && i.latest !== i.wanted && cmpVersion(i.latest, i.wanted) > 0)
    .map(([name, i]) => ({ name, current: i.current ?? i.wanted, latest: i.latest, dev: name in (pkg.devDependencies ?? {}) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Which other crates in the tree use exactly this version of `name`. */
function cargoSharedWith(name, version) {
  const r = run('cargo', ['tree', '-i', `${name}@${version}`, '--depth', '1', '--prefix', 'none', '-e', 'normal,build', '--target', 'all'], { cwd: tauriDir })
  if (r.status !== 0) return []
  const users = new Set()
  for (const line of r.stdout.split('\n').slice(1)) {
    const user = line.trim().split(' ')[0]
    if (user && user !== OWN_CRATE && user !== name) users.add(user)
  }
  return [...users].sort()
}

/**
 * name -> version the app crate itself resolves to. Not simply "the highest
 * version in Cargo.lock": a dependency of Tauri may already pull in a newer
 * major of the same crate next to ours.
 */
function cargoResolvedDirect() {
  const r = run('cargo', ['tree', '-p', OWN_CRATE, '--depth', '1', '--prefix', 'none', '-e', 'normal,build', '--target', 'all'], { cwd: tauriDir })
  if (r.status !== 0) throw new Error(`cargo tree failed:\n${r.stderr}`)
  const out = new Map()
  for (const line of r.stdout.split('\n').slice(1)) {
    const m = line.trim().match(/^(\S+) v(\S+)/)
    if (m) out.set(m[1], m[2])
  }
  return out
}

/** Direct Rust dependencies with a newer release than their requirement allows. */
async function cargoOutdated() {
  const resolved = cargoResolvedDirect()
  const out = []
  for (const [name, dep] of cargoDirect()) {
    if (dep.path) continue // vendored, reported separately
    const current = resolved.get(name)
    const latest = await cratesIoLatest(name)
    if (!current || !latest || cmpVersion(latest, current) <= 0) continue
    // `cargo update` already took everything the requirement allows, so a
    // newer release here is one the requirement excludes.
    out.push({
      name,
      current,
      latest,
      requirement: dep.req,
      kind: dep.kind ?? 'normal',
      target: dep.target ?? null,
      sharedWith: cargoSharedWith(name, current),
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Vendored crates whose upstream published something newer than both the
 * vendored copy and the last upstream version someone reviewed. After reading
 * an upstream release, record it in the vendored Cargo.toml:
 *
 *   [package.metadata.vendor]
 *   upstream-reviewed = "0.3.1"
 */
async function vendorOutdated() {
  if (!fs.existsSync(vendorDir)) return []
  const out = []
  for (const dir of fs.readdirSync(vendorDir)) {
    const manifest = path.join(vendorDir, dir, 'Cargo.toml')
    if (!fs.existsSync(manifest)) continue
    const text = fs.readFileSync(manifest, 'utf8')
    const name = text.match(/^name\s*=\s*"([^"]+)"/m)?.[1]
    const version = text.match(/^version\s*=\s*"([^"]+)"/m)?.[1]
    const reviewed = text.match(/^upstream-reviewed\s*=\s*"([^"]+)"/m)?.[1]
    if (!name || !version) continue
    const latest = await cratesIoLatest(name)
    const seen = reviewed && cmpVersion(reviewed, version) > 0 ? reviewed : version
    if (latest && cmpVersion(latest, seen) > 0) out.push({ name, version, reviewed, latest, dir })
  }
  return out
}

function npmAdvisories() {
  const r = run('npm', ['audit', '--json'])
  if (!r.stdout.trim()) return []
  const vulns = JSON.parse(r.stdout).vulnerabilities ?? {}
  return Object.values(vulns)
    // Only the packages an advisory is actually about, not every dependent
    // that inherits it through them.
    .filter(v => v.via?.some(x => typeof x === 'object'))
    .map(v => ({
      name: v.name,
      severity: v.severity,
      titles: [...new Set(v.via.filter(x => typeof x === 'object').map(x => `${x.title} (${x.url})`))],
    }))
}

// The cargo-audit JSON: the file the workflow passed in, or else a run of a
// locally installed cargo-audit. Since GitHub Actions is off (SPEC §13.70)
// the local run is the only place Rust advisories show up; without
// cargo-audit the report says it did not run.
function cargoAuditJson(file) {
  if (file && fs.existsSync(file)) return fs.readFileSync(file, 'utf8')
  let r
  try {
    r = run('cargo', ['audit', '--json'], { cwd: tauriDir })
  } catch {
    return null
  }
  // cargo-audit exits 1 when it finds something, with the JSON on stdout.
  return r.stdout.trimStart().startsWith('{') ? r.stdout : null
}

function cargoAdvisories(file) {
  const json = cargoAuditJson(file)
  if (!json) return { ran: false, list: [], warnings: 0 }
  const data = JSON.parse(json)
  const list = (data.vulnerabilities?.list ?? []).map(v => ({
    name: v.package.name,
    version: v.package.version,
    id: v.advisory.id,
    title: v.advisory.title,
    patched: v.versions?.patched ?? [],
  }))
  const warnings = Object.values(data.warnings ?? {}).reduce((n, w) => n + w.length, 0)
  return { ran: true, list, warnings }
}

async function report() {
  const npm = npmOutdated()
  const cargo = await cargoOutdated()
  const vendor = await vendorOutdated()
  const npmSec = npmAdvisories()
  const cargoSec = cargoAdvisories(flags['cargo-audit'])

  const todoCargo = cargo.filter(c => !c.sharedWith.length)
  const heldCargo = cargo.filter(c => c.sharedWith.length)
  const actionable = !!(npm.length || todoCargo.length || vendor.length || npmSec.length || cargoSec.list.length)

  const md = [
    'Generated by the weekly dependency update. Everything within the version ranges of',
    '`package.json` and `Cargo.toml` is already applied automatically; what is listed here needs a',
    'person, because it can break the build or change behaviour. This issue is rewritten on every',
    'run and closes itself once the list is empty.',
    '',
  ]

  if (npmSec.length || cargoSec.list.length) {
    md.push('## Security advisories', '')
    for (const v of cargoSec.list) {
      md.push(`- **${v.name} ${v.version}** (Rust) - ${v.id}: ${v.title}. Patched: ${v.patched.join(', ') || 'none yet'}`)
    }
    for (const v of npmSec) md.push(`- **${v.name}** (npm, ${v.severity}) - ${v.titles.join('; ')}`)
    md.push('')
  }

  if (npm.length || todoCargo.length) {
    md.push('## Upgrades outside the current version range', '')
    md.push('| Package | Ecosystem | Current | Latest |', '|---|---|---|---|')
    for (const p of npm) md.push(`| ${p.name} | npm | ${p.current} | ${p.latest} |`)
    for (const c of todoCargo) md.push(`| ${c.name} | Rust | ${c.current} | ${c.latest} |`)
    md.push('')
  }

  if (vendor.length) {
    md.push('## Vendored crates behind upstream', '')
    for (const v of vendor) {
      md.push(
        `- **${v.name}**: vendored ${v.version}${v.reviewed ? `, reviewed up to ${v.reviewed}` : ''}, upstream ${v.latest}.` +
          ` Compare upstream with \`src-tauri/vendor/${v.dir}\`, port what applies, and record the` +
          ' reviewed version as `upstream-reviewed` under `[package.metadata.vendor]` in its Cargo.toml.',
      )
    }
    md.push('')
  }

  if (heldCargo.length) {
    md.push('## Held back on purpose (no action)', '')
    for (const c of heldCargo) {
      md.push(`- ${c.name} ${c.current} (latest ${c.latest}): the same version is used by ${c.sharedWith.join(', ')}. Follow when they move.`)
    }
    md.push('')
  }

  if (!cargoSec.ran) md.push('_cargo audit did not run, so Rust advisories are not included._', '')
  else if (cargoSec.warnings) {
    md.push(`_cargo audit also reported ${cargoSec.warnings} informational warning(s) (unmaintained or unsound crates, mostly in platform bindings Tauri pulls in); run \`cargo audit\` in src-tauri for the details._`, '')
  }
  if (!actionable) md.push('Nothing needs a manual step.', '')

  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `actionable=${actionable}\n`)
  return md.join('\n')
}

// --- outdated ---------------------------------------------------------------

/**
 * The upgrades outside the current ranges as JSON, for the majors pass of
 * scripts/update-deps.mjs. Held-back crates are listed apart: upgrading them
 * alone only adds a second copy (see cargoSharedWith).
 */
async function outdated() {
  const cargo = await cargoOutdated()
  const json = {
    npm: npmOutdated(),
    cargo: cargo.filter(c => !c.sharedWith.length),
    heldBack: cargo.filter(c => c.sharedWith.length),
  }
  return `${JSON.stringify(json, null, 2)}\n`
}

// --- main -------------------------------------------------------------------

let text
if (command === 'changes') text = changes()
else if (command === 'report') text = await report()
else if (command === 'outdated') text = await outdated()
else {
  console.error('Usage: node scripts/deps.mjs <changes|report|outdated> [--out=FILE] [--cargo-audit=FILE]')
  process.exit(2)
}
if (typeof flags.out === 'string') fs.writeFileSync(flags.out, text)
else process.stdout.write(text)
