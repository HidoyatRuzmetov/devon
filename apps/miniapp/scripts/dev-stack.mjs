#!/usr/bin/env node
// Boots the API and this Mini App together, on ports of their own, against a database of their own.
//
// `pnpm start` at the repo root boots api + web on the shared ports and the shared database, which
// is exactly right when one person is running Devon and exactly wrong when several worktrees are
// running at once: two APIs fight over :3000, and one worktree's RSVPs land in another's board.
// This script is the per-worktree version of that, and nothing more:
//
//   node apps/miniapp/scripts/dev-stack.mjs
//
//   MINIAPP_PORT   (default 5299)  the Mini App's Vite server -- open this one
//   API_PORT       (default 3061)  the API it proxies `/api` to
//   MINIAPP_DB     (default devon_v11_miniapp)  the database name to substitute
//
// The repo's `.env` is loaded the way `scripts/start.mjs` loads it (shell environment wins, `.env`
// fills the gaps) and then three things are overridden: the two ports, and the *database name* inside
// `DATABASE_URL`. Only the name -- the host, the role and the password are whatever `.env` already
// says, so no credential is ever typed, printed or logged by this file. Create the database first,
// from an already-migrated one:
//
//   docker exec devon-postgres psql -U postgres -c \
//     "create database devon_v11_miniapp template devon_demo"
//
// This package owns no migrations, so there is nothing to apply on top of that clone.
//
// ## Signing in without Telegram (the documented dev path)
//
// `initData` can only be produced by Telegram signing a payload with the live bot token, and the
// server accepts no substitute -- there is deliberately no "skip verification" flag
// (`apps/api/src/modules/telegram/miniapp.ts`). So the local path is:
//
//   1. Open http://127.0.0.1:<MINIAPP_PORT>/miniapp/  -- the Mini App, served by Vite.
//   2. It will show "Hisob ulanmagan" until a session cookie exists. Sign in once at
//      http://127.0.0.1:<MINIAPP_PORT>/api/v1/... -- in practice, open the web app on the same
//      origin, or POST the login yourself:
//        curl -c jar.txt -H 'content-type: application/json' \
//          -d '{"login":"demo.xodim","password":"Ishonchli#2026"}' \
//          http://127.0.0.1:<API_PORT>/api/v1/auth/login
//      and load the resulting `devon_sid` cookie into the browser for 127.0.0.1.
//   3. Reload. `POST /session` answers `source: "web_session"`, and the app paints a visible
//      "Namunaviy rejim" strip so a screenshot of this path can never be mistaken for the real one.
//
// `?startapp=inbox` (or `card_<id>`, `event_<id>`) opens a screen the way a bot button does;
// `?theme=dark` forces the theme Telegram would have reported; `?locale=ru` forces a locale.
//
// With `TELEGRAM_BOT_TOKEN` set in `.env` and BotFather's menu button pointed at
// `<DEVON_PUBLIC_URL>/miniapp/`, the identical build runs the `source: "telegram"` path for real.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..', '..')
const isWin = process.platform === 'win32'

/** Shell environment wins, `.env` fills the gaps -- byte-for-byte the rule `scripts/start.mjs` uses.
 * Values are never echoed. */
function loadDotEnv() {
  const file = join(root, '.env')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

/** Swaps only the path component (the database name) of a Postgres URL. Everything else -- role,
 * password, host, port, query string -- is carried across untouched and never inspected. */
function withDatabase(url, name) {
  if (!url) return url
  try {
    const parsed = new URL(url)
    parsed.pathname = `/${name}`
    return parsed.toString()
  } catch {
    return url
  }
}

// Captured before `.env` is folded in: the repo's own `API_PORT=3000` is exactly the value this
// script exists to get away from, so only a port the operator actually typed may override the
// per-worktree defaults.
const shell = { ...process.env }
loadDotEnv()

const apiPort = shell['API_PORT'] ?? '3061'
const miniappPort = shell['MINIAPP_PORT'] ?? '5299'
const dbName = shell['MINIAPP_DB'] ?? 'devon_v11_miniapp'
const origin = `http://127.0.0.1:${miniappPort}`

const env = {
  ...process.env,
  API_PORT: apiPort,
  MINIAPP_PORT: miniappPort,
  DATABASE_URL: withDatabase(process.env['DATABASE_URL'], dbName),
  MIGRATION_DATABASE_URL: withDatabase(process.env['MIGRATION_DATABASE_URL'], dbName),
  // The Mini App is same-origin with the API through Vite's proxy, so this is the origin the session
  // cookie belongs to and the origin `miniappUrl()` builds `web_app` buttons from.
  DEVON_PUBLIC_URL: origin,
  DEVON_ALLOWED_ORIGINS: origin,
}

const children = []
function start(label, args, cwd) {
  const command = isWin ? ['pnpm', ...args].join(' ') : 'pnpm'
  const child = spawn(command, isWin ? [] : args, {
    cwd,
    env,
    shell: isWin,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const tag = (stream) => (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) stream.write(`[${label}] ${line}\n`)
    }
  }
  child.stdout.on('data', tag(process.stdout))
  child.stderr.on('data', tag(process.stderr))
  child.on('exit', (code) => {
    process.stdout.write(`[${label}] exited with ${code}\n`)
    for (const other of children) if (other !== child) other.kill()
    process.exit(code ?? 0)
  })
  children.push(child)
}

process.stdout.write(`[dev-stack] api      http://127.0.0.1:${apiPort}\n`)
process.stdout.write(`[dev-stack] mini app ${origin}/miniapp/\n`)
process.stdout.write(`[dev-stack] database ${dbName}\n`)

start('api', ['--filter', '@devon/api', 'dev'], root)
start('miniapp', ['--filter', '@devon/miniapp', 'dev'], root)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const child of children) child.kill(signal)
  })
}
