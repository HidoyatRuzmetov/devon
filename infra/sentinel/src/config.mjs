// Config loading (design.md §1.9, ADR-011). A tiny, dependency-free `key=value` parser -- no
// third-party config-file library is worth adding for four settings (ADR-011: dependency-free by
// design). `allowedCommands` is intentionally NOT read from this file: it is fixed in server.mjs so
// that widening what the sentinel accepts always requires a code change, never a config edit.
import { readFileSync, existsSync } from 'node:fs'

export const DEFAULTS = Object.freeze({
  host: '127.0.0.1',
  port: 8787,
  freshnessMs: 60_000,
  nonceRetentionMs: 300_000,
  maxBodyBytes: 4096,
  logPath: '/var/log/devon-sentinel.log',
  nonceStorePath: '/var/lib/devon-sentinel/nonces.log',
  configPath: '/etc/devon/sentinel.conf',
  // EPIC-013 / ADR-014: where `wipe` (src/wipe-executor.mjs) removes things. `projectRoot` is the
  // one directory tree the whole command is scoped to -- there is no `allowed_commands`-style widening
  // knob here either (config.mjs's own header comment): the *targets* wipe touches are configuration,
  // but *that wipe exists at all* is a code fact, same as the allow-list below. `composeFile` has no
  // default HERE on purpose (test/no-destructive-path.test.mjs's grep scans every file but wipe-
  // executor.mjs for the container-runtime's name, and the conventional compose filename contains
  // it) -- `null` means "let wipe-executor.mjs derive the project's compose file path itself",
  // exactly the one file allowed to write that name down.
  projectRoot: '/opt/devon',
  composeFile: null,
  wipeLogPath: '/var/log/devon-wipe.log',
})

function parseConfFile(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return out
}

/**
 * Resolves the full runtime config from (in ascending priority) built-in defaults, the on-disk
 * conf file, then environment variables. Throws if no public key is configured anywhere -- the
 * sentinel refuses to start rather than start unable to verify anything (fail closed).
 */
export function loadConfig(env = process.env) {
  const configPath = env.SENTINEL_CONFIG_PATH || DEFAULTS.configPath
  const fileConf = existsSync(configPath) ? parseConfFile(readFileSync(configPath, 'utf8')) : {}

  const publicKeyB64 = env.SENTINEL_PUBLIC_KEY || fileConf.public_key
  if (!publicKeyB64) {
    throw new Error(
      `No public key configured. Set "public_key=<base64url 32-byte ed25519 public key>" in ` +
        `${configPath} (mode 0600, owner root) or SENTINEL_PUBLIC_KEY for local development. ` +
        `The matching private key never lives in this repo (ADR-011) -- generate a pair with ` +
        `"node infra/sentinel/scripts/keygen.mjs".`,
    )
  }

  const host = env.SENTINEL_HOST || fileConf.host || DEFAULTS.host
  const freshnessMs = Number(env.SENTINEL_FRESHNESS_MS || fileConf.freshness_ms || DEFAULTS.freshnessMs)
  const nonceRetentionMs = Number(
    env.SENTINEL_NONCE_RETENTION_MS || fileConf.nonce_retention_ms || DEFAULTS.nonceRetentionMs,
  )

  return {
    host,
    port: Number(env.SENTINEL_PORT || fileConf.port || DEFAULTS.port),
    publicKeyB64,
    freshnessMs,
    nonceRetentionMs,
    maxBodyBytes: Number(env.SENTINEL_MAX_BODY_BYTES || fileConf.max_body_bytes || DEFAULTS.maxBodyBytes),
    // Fixed here, in code, not sourced from the conf file (see file header): EPIC-000 shipped "noop"
    // only (AC-15); EPIC-013 / ADR-014 adds "wipe" -- a code change plus a new ADR, exactly as
    // ADR-011's consequences section anticipated, never a config-file toggle.
    allowedCommands: Object.freeze(['noop', 'wipe']),
    logPath: env.SENTINEL_LOG_PATH || fileConf.log_path || DEFAULTS.logPath,
    nonceStorePath: env.SENTINEL_NONCE_STORE_PATH || fileConf.nonce_store_path || DEFAULTS.nonceStorePath,
    projectRoot: env.SENTINEL_PROJECT_ROOT || fileConf.project_root || DEFAULTS.projectRoot,
    composeFile: env.SENTINEL_COMPOSE_FILE || fileConf.compose_file || DEFAULTS.composeFile,
    wipeLogPath: env.SENTINEL_WIPE_LOG_PATH || fileConf.wipe_log_path || DEFAULTS.wipeLogPath,
  }
}
