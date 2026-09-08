#!/usr/bin/env node
// Frozen management demo of Devon (WorkPortal): one git commit checked out elsewhere (a detached
// worktree), on its own database, ports and storage, exposed through a Cloudflare quick tunnel.
// Nothing here touches the development checkout or its database.
//   node tools/demo/run.mjs --root <checkout> --init    # create DB, migrate, seed the demo, build web
//   node tools/demo/run.mjs --root <checkout> --start   # tunnel + API + static server, detached; DEMO-URL.txt
//   node tools/demo/run.mjs --root <checkout> --stop
//   node tools/demo/run.mjs --root <checkout> --status
import { spawn, spawnSync, execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, openSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const rootIdx = argv.indexOf('--root')
const ROOT = rootIdx >= 0 ? argv[rootIdx + 1] : process.env.DEMO_ROOT
const mode = argv.find((a) => a.startsWith('--') && a !== '--root')
if (!ROOT || !existsSync(ROOT)) { console.error('usage: node tools/demo/run.mjs --root <checkout> --init|--start|--stop|--status'); process.exit(2) }
const DIR = join(ROOT, 'demo-stack')
const LOGS = join(DIR, 'logs')
mkdirSync(LOGS, { recursive: true })
const DB_NAME = process.env.DEMO_DB || 'devon_demo'
const API_PORT = Number(process.env.DEMO_API_PORT || 3100)
const WEB_PORT = Number(process.env.DEMO_WEB_PORT || 5180)
const isWin = process.platform === 'win32'

function loadEnv() {
  const p = join(ROOT, '.env')
  if (!existsSync(p)) throw new Error('.env missing in ' + ROOT + ' (copy the development .env there first)')
  const env = { ...process.env }
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    env[m[1]] = v
  }
  const swapDb = (u) => (u || '').replace(/\/[A-Za-z0-9_]+(\?.*)?$/, `/${DB_NAME}$1`)
  env.DATABASE_URL = swapDb(env.DATABASE_URL)
  env.MIGRATION_DATABASE_URL = swapDb(env.MIGRATION_DATABASE_URL)
  env.POSTGRES_DB = DB_NAME
  env.API_PORT = String(API_PORT)
  env.WEB_PORT = String(WEB_PORT)
  env.NODE_ENV = 'development'
  env.DEVON_DEMO = '1'
  env.STORAGE_DRIVER = 'local'
  env.STORAGE_LOCAL_DIR = join(DIR, 'storage')
  env.AUDIT_ANCHOR_PATH = join(DIR, 'audit-anchor.json')
  const urlFile = join(DIR, 'DEMO-URL.txt')
  if (existsSync(urlFile)) env.DEVON_PUBLIC_URL = readFileSync(urlFile, 'utf8').trim()
  return env
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: isWin, cwd: ROOT, ...opts })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}`)
}

function ensureDatabase() {
  const out = execSync(`docker exec devon-postgres psql -U postgres -tAc "select 1 from pg_database where datname='${DB_NAME}'"`, { encoding: 'utf8' }).trim()
  if (out === '1') { console.log(`[demo] database ${DB_NAME} exists`); return }
  execSync(`docker exec devon-postgres psql -U postgres -c "create database ${DB_NAME}"`, { stdio: 'inherit' })
  console.log(`[demo] created database ${DB_NAME}`)
}

function detach(name, cmd, args, env, cwd) {
  const log = openSync(join(LOGS, `${name}.log`), 'a')
  const child = spawn(cmd, args, { cwd: cwd || ROOT, env, detached: true, stdio: ['ignore', log, log], shell: false, windowsHide: true })
  child.unref()
  return child.pid
}

const pidsFile = join(DIR, 'pids.json')
function readPids() { return existsSync(pidsFile) ? JSON.parse(readFileSync(pidsFile, 'utf8')) : {} }
function kill(pid) { try { if (isWin) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(pid) } catch {} }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, tries, ms) { for (let i = 0; i < tries; i++) { try { const v = await fn(); if (v) return v } catch {} await sleep(ms) } return null }

if (mode === '--init') {
  const env = loadEnv()
  ensureDatabase()
  run('pnpm', ['--filter', '@devon/db', 'migrate:apply'], { env })
  run('pnpm', ['--filter', '@devon/db', 'seed:demo'], { env })
  run('pnpm', ['--filter', '@devon/web', 'build'], { env })
  console.log('[demo] init complete')
} else if (mode === '--start') {
  for (const pid of Object.values(readPids())) kill(pid)
  const env = loadEnv()
  const pids = {}
  const tunnelLog = join(LOGS, 'tunnel.log')
  writeFileSync(tunnelLog, '')
  pids.tunnel = detach('tunnel', 'cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${WEB_PORT}`], env)
  const url = await waitFor(() => { const m = readFileSync(tunnelLog, 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/); return m && m[0] }, 60, 1000)
  if (!url) { kill(pids.tunnel); throw new Error('tunnel URL not found in ' + tunnelLog) }
  writeFileSync(join(DIR, 'DEMO-URL.txt'), url + '\n')
  env.DEVON_PUBLIC_URL = url
  const tsx = join(ROOT, 'apps', 'api', 'node_modules', 'tsx', 'dist', 'cli.mjs')
  pids.api = detach('api', process.execPath, [tsx, 'src/server.ts'], env, join(ROOT, 'apps', 'api'))
  pids.web = detach('web', process.execPath, [join(ROOT, 'tools', 'perf', 'lighthouse', 'prod-server.mjs')], { ...env, PORT: String(WEB_PORT), DEVON_PERF_API_TARGET: `http://127.0.0.1:${API_PORT}` })
  writeFileSync(pidsFile, JSON.stringify(pids, null, 2))
  const ok = await waitFor(async () => (await fetch(`http://127.0.0.1:${WEB_PORT}/healthz`)).ok, 90, 1000)
  console.log(`[demo] commit ${execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim()} api=${pids.api} web=${pids.web} tunnel=${pids.tunnel}`)
  console.log(`[demo] local  http://127.0.0.1:${WEB_PORT}  health=${ok ? 'ok' : 'NOT READY (see demo-stack/logs)'}`)
  console.log(`[demo] public ${url}`)
} else if (mode === '--stop') {
  for (const [k, pid] of Object.entries(readPids())) { kill(pid); console.log(`[demo] stopped ${k} (${pid})`) }
  writeFileSync(pidsFile, '{}')
} else if (mode === '--status') {
  const pids = readPids()
  const url = existsSync(join(DIR, 'DEMO-URL.txt')) ? readFileSync(join(DIR, 'DEMO-URL.txt'), 'utf8').trim() : '(none)'
  let local = 'down'; try { local = (await fetch(`http://127.0.0.1:${WEB_PORT}/healthz`)).status } catch {}
  let pub = 'down'; try { pub = (await fetch(url + '/healthz')).status } catch {}
  console.log(JSON.stringify({ commit: execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim(), url, pids, localHealth: local, publicHealth: pub }, null, 2))
} else {
  console.log('usage: node tools/demo/run.mjs --root <checkout> --init | --start | --stop | --status')
}
