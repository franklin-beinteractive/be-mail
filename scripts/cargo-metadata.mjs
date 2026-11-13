// `cargo metadata` helpers shared by the scripts that need to know where the
// build directory is (clean-target.mjs, release.mjs).
import { spawnSync } from 'node:child_process'
import path from 'node:path'

/**
 * `cargo metadata --no-deps` for the workspace that owns `manifestDir`, or
 * null when cargo is absent or the manifest does not parse. This is the one
 * source of truth for both the build directory and the workspace's own
 * targets, so every caller goes through here.
 */
export function cargoMetadata(manifestDir) {
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
 * Where the build directory of `manifestDir` actually is. Historically
 * `src-tauri/target`, but this machine shares one build directory across all
 * local Rust projects (`target-dir` in ~/.cargo/config.toml, or
 * CARGO_TARGET_DIR). `cargo metadata` resolves every one of those sources, so
 * ask cargo rather than duplicating its lookup order; fall back to the local
 * default when cargo is not around to ask.
 */
export function targetDirOf(manifestDir) {
  return cargoMetadata(manifestDir)?.target_directory ?? path.join(manifestDir, 'target')
}
