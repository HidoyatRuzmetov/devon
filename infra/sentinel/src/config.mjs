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
    // Fixed here, in code, not sourced from the conf file (see file header): "noop" and nothing
    // else in this epic (AC-15). Adding a command is a code change plus a new ADR (ADR-011).
    allowedCommands: Object.freeze(['noop']),
    logPath: env.SENTINEL_LOG_PATH || fileConf.log_path || DEFAULTS.logPath,
    nonceStorePath: env.SENTINEL_NONCE_STORE_PATH || fileConf.nonce_store_path || DEFAULTS.nonceStorePath,
  }
}
