#!/usr/bin/env node
// Reclaims disk space in the cargo build directory (see `resolveTargetDir`;
// historically `src-tauri/target`) without throwing away the whole
// dependency cache, which a plain `cargo clean` would do (55 GB gone, next dev
// build from scratch). Four kinds of garbage grow unbounded because Cargo
// never collects them:
//
//   1. `incremental/`: Cargo creates a directory per crate *per* metadata hash
//      and only prunes sessions *inside* one. Measured on 2026-08-17: 206
//      directories, 32 GB, of which 2 were live.
//   2. `.tmpXXXXXX.temp-archive/`: leftovers from a link step that was killed
//      or crashed. Always dead weight.
//   3. Artifacts in `deps/` and `build/` for dependency versions that are no
//      longer in `Cargo.lock`. Age is the only signal we have here, so pruning
//      these does force a rebuild of any crate that simply had not changed in
//      a long time - hence the conservative default and `--deps-age=0`.
//   4. Old builds of the projects' *own* crates. Every edit to a Cargo.toml (a
//      version bump, a new dependency) gives a crate a new metadata hash, and
//      Cargo leaves the previous `deps/<crate>-<hash>.*` set in place. With
//      full debug info each integration-test binary carries a 200 MB `.pdb`,
//      so one `cargo test` after a bump leaves 2 GB behind. Measured on
//      2026-09-09: 18.6 GB of the 30 GB in `deps/` were such stale copies.
//      Unlike dependencies, our own crates are cheap to rebuild, so these are
//      pruned by count (`--own-keep`) instead of by age. Which crates are
//      "ours" comes from `cargo metadata` of every Rust project under
//      `--projects` (default: the directory this repository lives in), because
//      the build directory is shared between all of them.
//
// Usage (from anywhere):
//   node scripts/clean-target.mjs [--release] [--keep=N] [--deps-age=DAYS]
//                                 [--own-keep=N] [--projects=DIR]
//                                 [--target-dir=DIR]
//                                 [--dry-run] [--force] [--quiet]
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tauriDir = path.join(repoRoot, 'src-tauri')

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const value = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  if (!hit) return fallback
  const parsed = Number(hit.slice(name.length + 3))
  return Number.isFinite(parsed) ? parsed : fallback
}
const text = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

/**
 * `cargo metadata --no-deps` for the workspace that owns `manifestDir`, or
 * null when cargo is absent or the manifest does not parse. This is the one
 * source of truth for both the build directory and the workspace's own
 * targets, so every caller goes through here.
 */
function cargoMetadata(manifestDir) {
  const result = spawnSync('cargo', ['metadata', '--format-version', '1', '--no-deps'], {
    cwd: manifestDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) return null
  try {
    return JSON.parse(result.stdout)
  } catch {
    return null
  }
}

/**
 * Where the build directory actually is. Historically `src-tauri/target`, but
 * this machine shares one build directory across all local Rust projects
 * (`target-dir` in ~/.cargo/config.toml, or CARGO_TARGET_DIR). `cargo
 * metadata` resolves every one of those sources, so ask cargo rather than
 * duplicating its lookup order; fall back to the local default when cargo is
 * not around to ask. `--target-dir` overrides all of that, for cleaning a
 * build directory no checked-out project points at any more.
 */
function resolveTargetDir() {
  const override = text('target-dir', null)
  if (override) return path.resolve(override)
  return cargoMetadata(tauriDir)?.target_directory ?? path.join(tauriDir, 'target')
}
const targetDir = resolveTargetDir()

const options = {
  // Also drop `target/release`. Release builds run in CI (see the release
  // section in CLAUDE.md), so a local release tree is rarely worth 4 GB.
  release: flag('release'),
  // Incremental directories to keep per crate. Two covers "the build I just
  // ran" plus the one before it, e.g. after switching features once.
  keep: Math.max(0, value('keep', 2)),
  // Prune `deps`/`build` artifacts untouched for this many days. 0 disables.
  // A week: every dependency update leaves a full copy of the tree behind in
  // the shared directory, and at 30 days four of those piled up to ~50 GB.
  depsAge: Math.max(0, value('deps-age', 7)),
  // Builds to keep per crate of our own (see item 4 above). Two covers the
  // regular build plus the `cargo test` variant of the same crate; the third
  // absorbs a feature or profile switch without a rebuild. 0 disables.
  ownKeep: Math.max(0, value('own-keep', 3)),
  // Directory whose Rust projects share this build directory. Each direct
  // child is checked for a `Cargo.toml` at its root or in `src-tauri/`.
  projects: path.resolve(text('projects', path.dirname(repoRoot))),
  dryRun: flag('dry-run'),
  force: flag('force'),
  quiet: flag('quiet'),
  // Write output to `<target>/clean-target.log` instead of stdout. For the
  // pre-push hook: the target directory is resolved here, so the hook cannot
  // know the log path up front.
  logToFile: flag('log'),
}

let logStream = null
if (options.logToFile && fs.existsSync(targetDir)) {
  logStream = fs.createWriteStream(path.join(targetDir, 'clean-target.log'), { flags: 'a' })
  logStream.write(`\n=== ${new Date().toISOString()} (${repoRoot}) ===\n`)
}
const log = (message) => {
  if (logStream) logStream.write(message + '\n')
  else if (!options.quiet) console.log(message)
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

/**
 * File-name stems of every crate built from a project under `--projects`
 * into this build directory: lib, bin, test, bench and example targets alike,
 * since each of those leaves its own `deps/<stem>-<hash>.*` set. Cargo turns
 * the hyphens of a target name into underscores on disk, so do the same.
 *
 * Only projects whose own `target_directory` is ours count. A project with a
 * private `target/` is somebody else's problem, and a stem we never built
 * here could only ever match a dependency by coincidence.
 */
function discoverOwnCrates() {
  const stems = new Set()
  const found = []
  let candidates
  try {
    candidates = fs.readdirSync(options.projects, { withFileTypes: true })
  } catch {
    return { stems, found }
  }
  const sameDir = (a, b) => {
    const [x, y] = [path.resolve(a), path.resolve(b)]
    return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
  }
  for (const entry of candidates) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const project = path.join(options.projects, entry.name)
    const manifestDir = [project, path.join(project, 'src-tauri')].find((dir) =>
      fs.existsSync(path.join(dir, 'Cargo.toml')),
    )
    if (!manifestDir) continue
    const metadata = cargoMetadata(manifestDir)
    if (!metadata || !sameDir(metadata.target_directory, targetDir)) continue
    const members = new Set(metadata.workspace_members)
    let count = 0
    for (const pkg of metadata.packages) {
      if (!members.has(pkg.id)) continue
      for (const target of pkg.targets) {
        stems.add(target.name.replace(/-/g, '_'))
        count += 1
      }
    }
    found.push(`${entry.name} (${count} targets)`)
  }
  return { stems, found }
}

function cleanOwnCrates(profile, stems) {
  if (options.ownKeep === 0 || stems.size === 0) return
  const deps = path.join(targetDir, profile, 'deps')
  if (!fs.existsSync(deps)) return

  // One build of a crate is the set of files sharing its metadata hash:
  // `lib<stem>-<hash>.rlib` and `.rmeta`, `<stem>-<hash>.exe`, `.pdb`, `.d`,
  // `.dll`, `.lib`, and so on. Group by (stem, hash), then rank the builds of
  // each stem by their newest file: mtimes within one build differ by the
  // seconds the linker took, between builds by at least one edit.
  const builds = new Map()
  for (const entry of fs.readdirSync(deps, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const match = /^(?:lib)?([A-Za-z0-9_]+)-([0-9a-f]{16})\./.exec(entry.name)
    if (!match || !stems.has(match[1])) continue
    const [, stem, hash] = match
    const full = path.join(deps, entry.name)
    let stats
    try {
      stats = fs.statSync(full)
    } catch {
      continue
    }
    const key = `${stem}-${hash}`
    if (!builds.has(key)) builds.set(key, { stem, key, files: [], bytes: 0, newest: 0 })
    const build = builds.get(key)
    build.files.push({ full, size: stats.size })
    build.bytes += stats.size
    if (stats.mtimeMs > build.newest) build.newest = stats.mtimeMs
  }

  const byStem = new Map()
  for (const build of builds.values()) {
    if (!byStem.has(build.stem)) byStem.set(build.stem, [])
    byStem.get(build.stem).push(build)
  }

  const before = freed
  let removed = 0
  for (const candidates of byStem.values()) {
    candidates.sort((a, b) => b.newest - a.newest)
    for (const stale of candidates.slice(options.ownKeep)) {
      // One log line per build in a dry run; per file otherwise, so a file
      // Windows refuses to delete is named in the log.
      if (options.dryRun) {
        remove(null, stale.bytes, `deps/${stale.key}.* (${stale.files.length} files)`)
      } else {
        for (const file of stale.files) {
          remove(file.full, file.size, `deps/${path.basename(file.full)}`)
        }
      }
      removed += 1
    }
  }
  log(
    `${profile}: removed ${removed} old builds of our own crates, keeping ${options.ownKeep} per crate (${gb(freed - before)})`,
  )
}

function cargoCleanRelease() {
  // With a shared target-dir this wipes the release profile for every local
  // project, not just this one. Acceptable: releases build in CI, a local
  // release tree is a rarity for all of them.
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
  log(`No build directory at ${targetDir}; nothing to clean.`)
  process.exit(0)
}

if (!options.force && buildIsRunning()) {
  log('cargo/rustc is running - skipping cleanup (re-run with --force to override).')
  process.exit(0)
}

log(`Cleaning ${targetDir}${options.dryRun ? ' (dry run)' : ''}`)
const startSize = measure(targetDir).bytes

const own = discoverOwnCrates()
if (own.found.length > 0) {
  log(`Own crates from ${options.projects}: ${own.found.join(', ')}`)
} else if (options.ownKeep > 0) {
  log(`No Rust project under ${options.projects} builds into this directory; skipping own-crate pruning.`)
}

for (const profile of ['debug', 'release']) {
  if (!fs.existsSync(path.join(targetDir, profile))) continue
  if (profile === 'release' && options.release) continue
  cleanIncremental(profile)
  cleanTempArchives(profile)
  cleanOwnCrates(profile, own.stems)
  cleanStaleArtifacts(profile)
}

if (options.release) cargoCleanRelease()

log(`\nReclaimed ${gb(freed)}; target is now ${gb(Math.max(0, startSize - freed))}.`)
