#!/usr/bin/env node
// Updates the dependencies locally before a release, plus an opt-in pass over
// the upgrades that need a person. Kept in step with the same script in the
// GitWorkflow repository.
//
//   npm run deps:update     semver-compatible updates only
//   npm run deps:majors     the same, then every upgrade outside the ranges
//
// Semver-compatible pass: `cargo update` and `npm update`, verified with
// `npm ci`, `tauri build --no-bundle` and the Rust tests. Green: one local
// commit "Update dependencies". Red: the lockfiles and node_modules go back
// to HEAD and the script stops.
//
// Majors pass (--majors): the upgrades `deps.mjs outdated` lists, in groups of
// packages that only work together (Tauri's npm packages and crates, vite and
// its React plugin, ...). Each group is applied, verified the same way and
// committed on its own as "Upgrade <names>". A group that fails is rolled
// back and reported, and the next group starts from the last green commit.
// Held-back crates and packages tied to a vendored crate are never touched.
//
// Nothing is pushed. A major can change behaviour without failing the build,
// so test the app (`npm run tauri dev`) before `git push`; a single upgrade
// comes out again with `git revert <commit>`.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tauriDir = path.join(repoRoot, 'src-tauri')
const withMajors = process.argv.includes('--majors')

// The only files an update may change, and the only ones it commits.
const MANIFESTS = ['package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']

// npm packages that must never be upgraded by script, with the reason shown.
// keyring 4 may store credentials differently from the token chunking in
// token_store.rs (CLAUDE.md, gotcha 1), so it only moves with a login test.
const MANUAL_ONLY = {}
const MANUAL_ONLY_CRATES = {
  keyring: 'stores the OAuth tokens; test sign-in and restart by hand before upgrading',
}

class StepError extends Error {}

// npm and npx are .cmd shims on Windows, which only start through a shell.
// Node does not escape arguments for a shell, so everything passed to them
// here must be free of spaces and shell characters - package names, versions
// and flags are. Cargo is a real executable and gets its arguments verbatim,
// which matters for `--target cfg(...)`.
function spawn(cmd, args, { cwd = repoRoot, capture = false } = {}) {
  const viaShell = process.platform === 'win32' && (cmd === 'npm' || cmd === 'npx')
  const r = spawnSync(viaShell ? [cmd, ...args].join(' ') : cmd, viaShell ? [] : args, {
    cwd,
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
  if (r.status !== 0) throw new StepError(`\`${[cmd, ...args].join(' ')}\` exited with ${r.status}`)
}

const git = (...args) => spawn('git', args, { capture: true })
const node = (...args) => spawn(process.execPath, args, { capture: true })
const manifestsDirty = () => git('status', '--porcelain', '--', ...MANIFESTS).stdout.trim()

function fail(message) {
  console.error(`\n${message}`)
  process.exit(1)
}

function heading(text) {
  console.log(`\n=== ${text} ${'='.repeat(Math.max(0, 70 - text.length))}`)
}

// --- safety checks ----------------------------------------------------------

function preflight() {
  const dirty = manifestsDirty()
  if (dirty) fail(`These files have uncommitted changes; commit or stash them first:\n${dirty}`)

  // The lockfile has to satisfy `npm ci` on the release runner, which uses
  // the Node (and so the npm) from .nvmrc - see the failed first v1.0.18 run.
  const wanted = fs.readFileSync(path.join(repoRoot, '.nvmrc'), 'utf8').trim()
  const running = process.versions.node.split('.')[0]
  if (wanted !== running) fail(`Node ${running} is running, but .nvmrc asks for ${wanted}. Switch Node first.`)

  // Starting behind origin/main would redo (and conflict with) an update the
  // workflow already pushed.
  if (git('fetch', '--quiet', 'origin', 'main').status !== 0) {
    fail('Could not fetch origin/main. An update needs the network anyway; try again once it is back.')
  }
  const behind = git('rev-list', '--count', 'HEAD..origin/main').stdout.trim()
  if (behind !== '0') fail(`origin/main is ${behind} commit(s) ahead of HEAD. Run \`git pull --ff-only\` first.`)

  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim()
  console.log(`Committing to ${branch}. Nothing is pushed.`)
}

// --- shared steps -----------------------------------------------------------

/** What the release build does, minus the installers. */
function verify() {
  step('npm', ['ci', '--no-audit', '--no-fund'])
  step('npx', ['tauri', 'build', '--no-bundle'])
  step('cargo', ['test', '--release'], { cwd: tauriDir })
}

/** Back to the manifests of HEAD, with node_modules to match. */
function rollback() {
  heading('Rolling back')
  git('checkout', 'HEAD', '--', ...MANIFESTS)
  try {
    step('npm', ['ci', '--no-audit', '--no-fund'])
  } catch {
    console.error('`npm ci` failed during the rollback; run it again by hand before starting the app.')
  }
}

function commit(message) {
  const file = path.join(os.tmpdir(), `update-deps-${process.pid}.txt`)
  fs.writeFileSync(file, message)
  try {
    // Only the manifests, whatever else happens to be staged.
    const r = spawn('git', ['commit', '--quiet', '-F', file, '--', ...MANIFESTS])
    if (r.status !== 0) throw new StepError('git commit failed')
  } finally {
    fs.rmSync(file, { force: true })
  }
  return git('rev-parse', '--short', 'HEAD').stdout.trim()
}

// --- semver-compatible pass -------------------------------------------------

function compatiblePass() {
  heading('Semver-compatible updates')
  step('cargo', ['update'], { cwd: tauriDir })
  step('npm', ['update', '--no-audit', '--no-fund'])

  // `npm update` must never widen or narrow a range: only lockfiles move.
  const widened = git('diff', '--name-only', '--', 'package.json', 'src-tauri/Cargo.toml').stdout.trim()
  if (widened) throw new StepError(`the update changed a manifest, which it never should:\n${widened}`)

  if (!manifestsDirty()) {
    console.log('\nEvery dependency is already at the newest version its range allows.')
    return null
  }
  const changes = node('scripts/deps.mjs', 'changes').stdout.trim()
  console.log(`\n${changes}`)
  verify()
  return commit(`Update dependencies\n\n${changes}\n\nApplied and verified locally by scripts/update-deps.mjs.\n`)
}

// --- majors pass ------------------------------------------------------------

// Packages that only work together. Upgrading one without the others fails on
// a peer dependency or on Tauri's check that every @tauri-apps/plugin-* matches
// its crate, so a group is tried as one.
function groupOf(item) {
  const { eco, name } = item
  if (name.startsWith('@tauri-apps/') || (eco === 'cargo' && /^tauri(-|$)/.test(name))) return 'tauri'
  if (/^(@types\/)?react(-dom)?$/.test(name)) return 'react'
  if (name === 'vite' || name.startsWith('@vitejs/')) return 'vite'
  if (name === 'tailwindcss' || name.startsWith('@tailwindcss/')) return 'tailwindcss'
  if (name.startsWith('@types/')) return `npm:${name.slice('@types/'.length)}`
  return `${eco}:${name}`
}

function applyGroup(items) {
  const spec = i => `${i.name}@${i.latest}`
  const deps = items.filter(i => i.eco === 'npm' && !i.dev).map(spec)
  const devDeps = items.filter(i => i.eco === 'npm' && i.dev).map(spec)
  if (deps.length) step('npm', ['install', '--no-audit', '--no-fund', ...deps])
  if (devDeps.length) step('npm', ['install', '--save-dev', '--no-audit', '--no-fund', ...devDeps])
  for (const c of items.filter(i => i.eco === 'cargo')) {
    // `cargo add` on an existing dependency only changes its version and
    // keeps its features; the table (build, target) has to be named.
    const args = ['add', spec(c)]
    if (c.kind === 'build') args.push('--build')
    if (c.kind === 'dev') args.push('--dev')
    if (c.target) args.push('--target', c.target)
    step('cargo', args, { cwd: tauriDir })
  }
}

function majorsPass() {
  heading('Upgrades outside the current ranges')
  const r = node('scripts/deps.mjs', 'outdated')
  if (r.status !== 0) throw new StepError(`deps.mjs outdated failed:\n${r.stderr}`)
  const data = JSON.parse(r.stdout)

  const skipped = []
  const items = []
  for (const p of data.npm) {
    if (MANUAL_ONLY[p.name]) skipped.push(`${p.name} ${p.current} -> ${p.latest}: ${MANUAL_ONLY[p.name]}`)
    else items.push({ ...p, eco: 'npm' })
  }
  for (const c of data.cargo) {
    if (MANUAL_ONLY_CRATES[c.name]) skipped.push(`${c.name} ${c.current} -> ${c.latest}: ${MANUAL_ONLY_CRATES[c.name]}`)
    else items.push({ ...c, eco: 'cargo' })
  }
  for (const c of data.heldBack) {
    skipped.push(`${c.name} ${c.current} -> ${c.latest}: held back, ${c.sharedWith.join(', ')} use the same version`)
  }

  const groups = new Map()
  for (const i of items) {
    const key = groupOf(i)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(i)
  }

  const done = []
  const failed = []
  for (const group of groups.values()) {
    const label = group.map(i => `${i.name} ${i.current} -> ${i.latest}`).join(', ')
    heading(`Trying ${group.map(i => i.name).join(', ')}`)
    try {
      applyGroup(group)
      verify()
      const names = group.map(i => `${i.name} to ${i.latest}`).join(', ')
      const body = group.map(i => `- ${i.name} ${i.current} -> ${i.latest} (${i.eco})`).join('\n')
      const sha = commit(`Upgrade ${names}\n\n${body}\n\nApplied and verified locally by scripts/update-deps.mjs --majors.\n`)
      done.push(`${sha}  ${label}`)
    } catch (e) {
      if (!(e instanceof StepError)) throw e
      failed.push(`${label}: ${e.message}`)
      rollback()
    }
  }
  return { done, failed, skipped }
}

// --- report -----------------------------------------------------------------

function finalReport() {
  heading('What still needs a person')
  const args = ['scripts/deps.mjs', 'report']
  const auditFile = path.join(os.tmpdir(), `cargo-audit-${process.pid}.json`)
  const audit = spawn('cargo', ['audit', '--json'], { cwd: tauriDir, capture: true })
  if (audit.error || /no such command/.test(audit.stderr)) {
    console.log('cargo-audit is not installed, so Rust advisories are left out (`cargo install cargo-audit --locked`).')
  } else {
    fs.writeFileSync(auditFile, audit.stdout)
    args.push(`--cargo-audit=${auditFile}`)
  }
  spawn(process.execPath, args)
  fs.rmSync(auditFile, { force: true })
}

// --- main -------------------------------------------------------------------

preflight()

let updateCommit
try {
  updateCommit = compatiblePass()
} catch (e) {
  if (!(e instanceof StepError)) throw e
  rollback()
  fail(`The semver-compatible update failed: ${e.message}\nNothing was committed.`)
}

const majors = withMajors ? majorsPass() : null

finalReport()

heading('Summary')
if (updateCommit) console.log(`Semver-compatible updates committed as ${updateCommit}.`)
else console.log('No semver-compatible updates.')
if (majors) {
  const list = (title, lines) => lines.length && console.log(`\n${title}:\n${lines.map(l => `  ${l}`).join('\n')}`)
  list('Upgraded (one commit each)', majors.done)
  list('Failed and rolled back', majors.failed)
  list('Skipped on purpose', majors.skipped)
  if (!majors.done.length && !majors.failed.length) console.log('\nNo upgrades outside the ranges to try.')
}
if (updateCommit || majors?.done.length) {
  console.log('\nNext: test the app with `npm run tauri dev`, then `git push`. Undo one commit with `git revert <sha>`.')
}
