#!/usr/bin/env node
// Devon (WorkPortal) -- body of `pnpm start` (alias: `pnpm dev`).
//
//   pnpm start            boots Postgres + Valkey, applies migrations, starts api+web
//   pnpm start --demo     the above, then seeds the demo tenant (idempotent -- ADR-013)
//   DEVON_DEMO=1 pnpm start   same as --demo, for process managers that only set env vars
//
// This script does not implement the demo seed itself -- it only shells out to
// `pnpm --filter @devon/db seed:demo` (EPIC-000.demo's job) and propagates its exit code, and it
// does not implement Postgres/Valkey/the compose file -- that is infra/docker-compose.yml (W8).
// It is intentionally a thin, readable orchestrator so a civil-servant-hostile stack trace never has
// to be the first thing a new contributor sees.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url))) // scripts/.. == repo root
const log = (msg) => console.log(`[start] ${msg}`)
const fail = (msg, code = 1) => {
  console.error(`[start] ERROR: ${msg}`)
  process.exit(code)
}

// Windows needs shell:true to resolve .cmd/.ps1 shims (pnpm, docker CLI plugins). Node's
// spawn(sync) warns (DEP0190) if shell:true is combined with a separate args array, because the
// array is joined without escaping -- so on Windows we build one already-quoted command string.
const isWin = process.platform === 'win32'
const quote = (a) => (/[\s"&|<>^%]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a)
function spawnArgs(cmd, args) {
  return isWin ? [[cmd, ...args].map(quote).join(' '), []] : [cmd, args]
}

// --- .env, without adding a dependency: shell env wins, .env fills gaps ---
function loadDotEnv() {
  const p = join(root, '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    const key = t.slice(0, i).trim()
    let value = t.slice(i + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}
loadDotEnv()

const args = process.argv.slice(2)
const demo = args.includes('--demo') || process.env.DEVON_DEMO === '1'

function run(cmd, cmdArgs, label) {
  log(`${label} ...`)
  const [c, a] = spawnArgs(cmd, cmdArgs)
  const r = spawnSync(c, a, { stdio: 'inherit', shell: isWin, cwd: root, env: process.env })
  if (r.status !== 0)
    fail(`${label} failed (exit ${r.status ?? 'signal ' + r.signal}).`, r.status || 1)
}

function check(cmd, cmdArgs) {
  const [c, a] = spawnArgs(cmd, cmdArgs)
  const r = spawnSync(c, a, { cwd: root, encoding: 'utf8', shell: isWin })
  return { ok: r.status === 0, stdout: (r.stdout || '').trim() }
}

// --- 1. Postgres + Valkey via infra/docker-compose.yml (W8) ---------------
const composeFile = join(root, 'infra', 'docker-compose.yml')
if (!existsSync(composeFile)) {
  fail(
    'infra/docker-compose.yml not found yet -- this lands with the infra work item. `pnpm start` cannot boot Postgres/Valkey without it.',
  )
}
const compose = (...a) => ['compose', '-f', 'infra/docker-compose.yml', ...a]
run(
  'docker',
  compose('up', '-d', 'postgres', 'valkey', 'centrifugo'),
  'starting Postgres + Valkey + Centrifugo (docker compose)',
)

// --- 1b. realtime (v1.1 SPEC §10, EPIC-018) -------------------------------------------------
//
// Without these four variables `modules/realtime/config.ts` reports `enabled: false`, which is the
// correct answer for a deployment that runs no broker -- but it is the wrong answer for `pnpm start`,
// which has just started one. The board then renders its "Jonli rejim oʻchiq" pill forever and no
// developer ever sees presence, live card moves or the editing indicator.
//
// Filled in only where the shell or `.env` has said nothing, so a real deployment's own values always
// win, and a production boot sets all four in `.env` exactly as it sets `DATABASE_URL`.
//
// The two shared secrets are READ OUT OF the compose file rather than restated here. The API and the
// broker have to agree on them or every token is rejected, and a second copy in this script is a
// second thing to change -- `infra/docker-compose.yml`'s own `${VAR:-default}` is where the local
// default is declared, so that is where this reads it from. It also keeps a credential-shaped string
// literal out of the repo's JavaScript, which `agentic/scripts/check-secrets.mjs` is right to refuse
// (I-17).
/** The `default` half of a compose `${VAR:-default}` interpolation. Read by scanning for the literal
 * opener rather than by building a regex out of `variable`: nothing here has to be escaped, and a
 * mention of the same name inside a YAML comment cannot match. */
function composeDefault(yaml, variable) {
  const opener = '${' + variable + ':-'
  const start = yaml.indexOf(opener)
  if (start === -1) return ''
  const end = yaml.indexOf('}', start + opener.length)
  return end === -1 ? '' : yaml.slice(start + opener.length, end).trim()
}
const composeYaml = readFileSync(composeFile, 'utf8')
const CENTRIFUGO_PORT =
  process.env.CENTRIFUGO_PORT || composeDefault(composeYaml, 'CENTRIFUGO_PORT') || '8000'
const REALTIME_DEV_DEFAULTS = {
  CENTRIFUGO_WS_URL: `ws://127.0.0.1:${CENTRIFUGO_PORT}/connection/websocket`,
  CENTRIFUGO_API_URL: `http://127.0.0.1:${CENTRIFUGO_PORT}/api`,
  CENTRIFUGO_API_KEY: composeDefault(composeYaml, 'CENTRIFUGO_API_KEY'),
  CENTRIFUGO_TOKEN_HMAC_SECRET_KEY: composeDefault(composeYaml, 'CENTRIFUGO_TOKEN_HMAC_SECRET_KEY'),
}
const filledRealtime = []
for (const [key, value] of Object.entries(REALTIME_DEV_DEFAULTS)) {
  // An empty value means the compose file no longer declares that default: leave the variable unset
  // so `realtime/config.ts` reports `enabled: false` honestly, rather than handing the API a blank
  // HMAC key that would reject every token with no explanation.
  if (!process.env[key] && value) {
    process.env[key] = value
    filledRealtime.push(key)
  }
}
if (filledRealtime.length > 0) {
  log(`realtime: using local development defaults for ${filledRealtime.join(', ')}`)
}

// --- 2. wait for readiness -------------------------------------------------
async function waitFor(label, checkFn, timeoutMs = 60_000, intervalMs = 1000) {
  const started = Date.now()
  log(`waiting for ${label} ...`)
  while (Date.now() - started < timeoutMs) {
    if (checkFn()) {
      log(`${label} is ready.`)
      return
    }
    await new Promise((res) => setTimeout(res, intervalMs))
  }
  // Rejects rather than exiting, so a caller that considers this service optional can `.catch()` it.
  // Every caller that does not is still fatal: an unhandled rejection here ends the boot.
  throw new Error(`${label} did not become ready within ${timeoutMs / 1000}s.`)
}

/** The two services nothing works without: a readable message and a clean exit, never a stack trace
 * (this script's whole premise -- "a civil-servant-hostile stack trace should never be the first
 * thing a new contributor sees"). */
async function requireReady(label, checkFn, timeoutMs) {
  try {
    await waitFor(label, checkFn, timeoutMs)
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  }
}

const pgUser = process.env.POSTGRES_APP_USER || 'devon_app'
await requireReady(
  'Postgres',
  () => check('docker', compose('exec', '-T', 'postgres', 'pg_isready', '-U', pgUser)).ok,
)
await requireReady(
  'Valkey',
  () => check('docker', compose('exec', '-T', 'valkey', 'valkey-cli', 'ping')).stdout === 'PONG',
)
// Never fatal: a broker that will not start should cost the board its live pill, not the whole app.
await waitFor(
  'Centrifugo',
  () =>
    check(
      'docker',
      compose('exec', '-T', 'centrifugo', 'wget', '-qO-', 'http://127.0.0.1:8000/health'),
    ).ok,
  30_000,
).catch(() => log('Centrifugo did not answer in time -- continuing with realtime off.'))

// --- 3. apply migrations (the apply step of @devon/db migrate:verify) -----
run('pnpm', ['--filter', '@devon/db', 'migrate:apply'], 'applying database migrations')

// --- 4. demo seed, only when explicitly asked (AC-1, AC-2, ADR-013) -------
if (demo) {
  run('pnpm', ['--filter', '@devon/db', 'seed:demo'], 'seeding the demo tenant')
}

// --- 5. start api + web (turbo, persistent dev tasks) ----------------------
log(
  `starting api + web${demo ? ' (demo tenant seeded -- look for the "Namoyish/Demo" chip in the header)' : ''} ...`,
)
// --env-mode=loose: turbo 2's default is `strict`, which filters every spawned task's environment
// down to the `env`/`globalEnv` allowlist in turbo.json -- and this repo has no such allowlist (env
// vars are centralised in `.env`, loaded above by `loadDotEnv()`, not hand-mirrored per task). Without
// this flag apps/api boots with DATABASE_URL/CSRF_SECRET (and every other .env value) undefined,
// because turbo silently strips them before the child process ever starts (found running `pnpm start`
// end-to-end, 2026-09).
const turboArgs = [
  'exec',
  'turbo',
  'run',
  'dev',
  '--env-mode=loose',
  '--filter=@devon/api',
  '--filter=@devon/web',
]
const [devCmd, devArgs] = spawnArgs('pnpm', turboArgs)
const child = spawn(devCmd, devArgs, {
  stdio: 'inherit',
  shell: isWin,
  cwd: root,
  env: process.env,
})
child.on('exit', (code) => process.exit(code ?? 0))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
