#!/usr/bin/env node
// Reclaims disk space in `src-tauri/target` without throwing away the whole
// dependency cache, which a plain `cargo clean` would do (26 GB gone, next dev
// build from scratch). Three kinds of garbage grow unbounded because Cargo
// never collects them:
//
//   1. `incremental/`: Cargo creates a directory per crate *per* metadata hash
//      and only prunes sessions *inside* one. Measured on 2026-08-17: 6.2 GB
//      across dozens of directories, of which 2 per crate were live.
//   2. `.tmpXXXXXX.temp-archive/`: leftovers from a link step that was killed
//      or crashed. Always dead weight.
//   3. Artifacts in `deps/` and `build/` for dependency versions that are no
//      longer in `Cargo.lock`. Age is the only signal we have here, so pruning
//      these does force a rebuild of any crate that simply had not changed in
//      a long time - hence the conservative default and `--deps-age=0`.
//
// Usage (from anywhere):
//   node scripts/clean-target.mjs [--release] [--keep=N] [--deps-age=DAYS]
//                                 [--dry-run] [--force] [--quiet]
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tauriDir = path.join(repoRoot, 'src-tauri')
const targetDir = path.join(tauriDir, 'target')

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const value = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  if (!hit) return fallback
  const parsed = Number(hit.slice(name.length + 3))
  return Number.isFinite(parsed) ? parsed : fallback
}

const options = {
  // Also drop `target/release`. Release builds run in CI (see the release
  // section in CLAUDE.md), so a local release tree is rarely worth 4 GB.
  release: flag('release'),
  // Incremental directories to keep per crate. Two covers "the build I just
  // ran" plus the one before it, e.g. after switching features once.
  keep: Math.max(0, value('keep', 2)),
  // Prune `deps`/`build` artifacts untouched for this many days. 0 disables.
  depsAge: Math.max(0, value('deps-age', 30)),
  dryRun: flag('dry-run'),
  force: flag('force'),
  quiet: flag('quiet'),
}

const log = (message) => {
  if (!options.quiet) console.log(message)
}
const gb = (bytes) => `${(bytes / 1024 ** 3).toFixed(2)} GB`

let freed = 0

/** Recursive size plus the newest mtime found, in one walk. */
function measure(dir) {
  let bytes = 0
  let newest = 0
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      try {
        const stats = fs.statSync(full)
        bytes += stats.size
        if (stats.mtimeMs > newest) newest = stats.mtimeMs
      } catch {
        // Raced with another process; ignore.
      }
    }
  }
  return { bytes, newest }
}

function remove(target, bytes, label) {
  if (options.dryRun) {
    log(`  would remove ${label} (${gb(bytes)})`)
    freed += bytes
    return
  }
  try {
    // Windows hands out sporadic EBUSY/EPERM while indexers hold a handle.
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    freed += bytes
  } catch (error) {
    log(`  skipped ${label}: ${error.message}`)
  }
}

/**
 * A concurrent build would be corrupted by pulling its incremental state out
 * from under it, so bail unless the caller insists.
 */
function buildIsRunning() {
  const names = ['cargo', 'rustc']
  if (process.platform === 'win32') {
    return names.some((name) => {
      const result = spawnSync('tasklist', ['/fi', `imagename eq ${name}.exe`, '/nh'], {
        encoding: 'utf8',
      })
      return result.stdout?.toLowerCase().includes(`${name}.exe`) ?? false
    })
  }
  return names.some((name) => spawnSync('pgrep', ['-x', name]).status === 0)
}

function cleanIncremental(profile) {
  const root = path.join(targetDir, profile, 'incremental')
  if (!fs.existsSync(root)) return

  // Directories are named `<crate>-<hash>`; keep the newest per crate rather
  // than the newest overall, or a rarely rebuilt crate loses its only cache.
  const byCrate = new Map()
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const full = path.join(root, entry.name)
    const crate = entry.name.replace(/-[^-]+$/, '')
    const { bytes, newest } = measure(full)
    if (!byCrate.has(crate)) byCrate.set(crate, [])
    byCrate.get(crate).push({ full, name: entry.name, bytes, newest })
  }

  let removed = 0
  const before = freed
  for (const candidates of byCrate.values()) {
    candidates.sort((a, b) => b.newest - a.newest)
    for (const stale of candidates.slice(options.keep)) {
      remove(stale.full, stale.bytes, `incremental/${stale.name}`)
      removed += 1
    }
  }
  log(`${profile}/incremental: removed ${removed} stale directories (${gb(freed - before)})`)
}

function cleanTempArchives(profile) {
  const before = freed
  let removed = 0
  for (const sub of ['deps', 'build']) {
    const root = path.join(targetDir, profile, sub)
    if (!fs.existsSync(root)) continue
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\.tmp.*temp-archive$/.test(entry.name)) continue
      const full = path.join(root, entry.name)
      remove(full, measure(full).bytes, `${sub}/${entry.name}`)
      removed += 1
    }
  }
  log(`${profile}: removed ${removed} interrupted-link leftovers (${gb(freed - before)})`)
}

function cleanStaleArtifacts(profile) {
  if (options.depsAge === 0) return
  const cutoff = Date.now() - options.depsAge * 24 * 60 * 60 * 1000
  const before = freed
  let removed = 0

  const deps = path.join(targetDir, profile, 'deps')
  if (fs.existsSync(deps)) {
    for (const entry of fs.readdirSync(deps, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const full = path.join(deps, entry.name)
      let stats
      try {
        stats = fs.statSync(full)
      } catch {
        continue
      }
      if (stats.mtimeMs >= cutoff) continue
      remove(full, stats.size, `deps/${entry.name}`)
      removed += 1
    }
  }

  // `build/<crate>-<hash>` holds a build script plus its output, and
  // `.fingerprint/<crate>-<hash>` the hashes Cargo compares against. Prune
  // both by the same rule: a fingerprint whose artifact in `deps` just got
  // deleted is worse than no fingerprint at all. Directory mtimes do not track
  // their contents, so judge each by its newest file.
  for (const sub of ['build', '.fingerprint']) {
    const root = path.join(targetDir, profile, sub)
    if (!fs.existsSync(root)) continue
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const full = path.join(root, entry.name)
      const { bytes, newest } = measure(full)
      if (newest === 0 || newest >= cutoff) continue
      remove(full, bytes, `${sub}/${entry.name}`)
      removed += 1
    }
  }

  log(
    `${profile}: removed ${removed} artifacts older than ${options.depsAge} days (${gb(freed - before)})`,
  )
}

function cargoCleanRelease() {
  const releaseDir = path.join(targetDir, 'release')
  if (!fs.existsSync(releaseDir)) return
  const { bytes } = measure(releaseDir)
  if (options.dryRun) {
    log(`would run \`cargo clean --release\` (${gb(bytes)})`)
    freed += bytes
    return
  }
  const result = spawnSync('cargo', ['clean', '--release'], {
    cwd: tauriDir,
    stdio: options.quiet ? 'ignore' : 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status === 0) {
    freed += bytes
    log(`release: cargo clean --release (${gb(bytes)})`)
  } else {
    // Typically the release binary is still running, or cargo is absent.
    log('release: cargo clean --release failed, leaving it in place')
  }
}

if (!fs.existsSync(targetDir)) {
  log('No src-tauri/target directory; nothing to clean.')
  process.exit(0)
}

if (!options.force && buildIsRunning()) {
  log('cargo/rustc is running - skipping cleanup (re-run with --force to override).')
  process.exit(0)
}

log(`Cleaning ${targetDir}${options.dryRun ? ' (dry run)' : ''}`)
const startSize = measure(targetDir).bytes

for (const profile of ['debug', 'release']) {
  if (!fs.existsSync(path.join(targetDir, profile))) continue
  if (profile === 'release' && options.release) continue
  cleanIncremental(profile)
  cleanTempArchives(profile)
  cleanStaleArtifacts(profile)
}

if (options.release) cargoCleanRelease()

log(`\nReclaimed ${gb(freed)}; target is now ${gb(Math.max(0, startSize - freed))}.`)
