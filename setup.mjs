#!/usr/bin/env node
// Devon (WorkPortal) -- one-command bootstrap for a fresh clone (I-18).
//
// Two equally valid first commands (design.md §4(k)):
//   corepack enable && pnpm setup     <- machine already has Node + a package manager shim
//   node setup.mjs                    <- machine has only Node; this script shells corepack itself
//
// Both paths run exactly this file: package.json's own "setup" script is `node setup.mjs`, so
// `pnpm setup` (after pnpm's own built-in environment setup runs) falls through to this same code.
// There is one implementation, not two that can drift.
//
// What this script does NOT do: it does not start Postgres/Valkey, run migrations, or seed the demo
// tenant -- that is `pnpm start` / `pnpm start --demo`, implemented in scripts/start.mjs.

import { spawnSync } from 'node:child_process'
import { existsSync, copyFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const log = (msg) => console.log(`[setup] ${msg}`)
const warn = (msg) => console.warn(`[setup] WARNING: ${msg}`)
const fail = (msg) => { console.error(`[setup] ERROR: ${msg}`); process.exit(1) }

// Windows needs shell:true to resolve .cmd/.ps1 shims (pnpm, corepack). Node's spawn(sync) warns
// (DEP0190) if you combine shell:true with a separate args array, because the array is joined
// without escaping -- so on Windows we build one already-quoted command string ourselves instead.
const isWin = process.platform === 'win32'
const quote = (a) => (/[\s"&|<>^%]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a)
function spawnArgs(cmd, args) {
  return isWin ? [[cmd, ...args].map(quote).join(' '), []] : [cmd, args]
}

function run(cmd, args, opts = {}) {
  const [c, a] = spawnArgs(cmd, args)
  const r = spawnSync(c, a, { stdio: 'inherit', shell: isWin, cwd: root, ...opts })
  return r.status === 0
}

function runCapture(cmd, args) {
  const [c, a] = spawnArgs(cmd, args)
  const r = spawnSync(c, a, { encoding: 'utf8', shell: isWin, cwd: root })
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') }
}

// --- 1. Node version gate -------------------------------------------------
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const requiredNode = pkg.engines?.node ?? '>=22.11.0'
const minMajor = Number((requiredNode.match(/(\d+)/) || [])[1] ?? 22)
const currentMajor = Number(process.versions.node.split('.')[0])
if (currentMajor < minMajor) {
  fail(`Node ${process.version} is too old. This project requires ${requiredNode} (see package.json#engines). Install a newer Node and re-run.`)
}
log(`Node ${process.version} OK (requires ${requiredNode})`)

// --- 2. corepack + the pinned pnpm ----------------------------------------
const pinned = pkg.packageManager // e.g. "pnpm@11.15.0"
if (!pinned || !pinned.startsWith('pnpm@')) fail('package.json is missing a "pnpm@<version>" packageManager pin.')
const pinnedVersion = pinned.split('@')[1]

log('enabling corepack (idempotent) ...')
if (!run('corepack', ['enable'])) {
  warn('corepack enable failed or needs elevated permissions. If `pnpm -v` already prints ' + pinnedVersion + ', this is harmless; otherwise install pnpm manually: npm i -g pnpm@' + pinnedVersion)
}

log(`activating pinned package manager ${pinned} via corepack ...`)
if (!run('corepack', ['prepare', pinned, '--activate'])) {
  fail(`corepack could not prepare ${pinned}. Check network access to the npm registry and try again.`)
}

const pnpmVersionCheck = runCapture('pnpm', ['--version'])
if (!pnpmVersionCheck.ok) fail('pnpm is still not runnable after corepack activation. Open a new shell and re-run `node setup.mjs`.')
log(`pnpm ${pnpmVersionCheck.out.trim()} ready`)

// --- 3. install workspace dependencies ------------------------------------
log('installing workspace dependencies (pnpm install) ...')
if (!run('pnpm', ['install'])) fail('pnpm install failed. See the output above.')

// --- 4. .env from .env.example, never overwritten -------------------------
const envPath = join(root, '.env')
const envExamplePath = join(root, '.env.example')
if (existsSync(envPath)) {
  log('.env already exists -- left untouched.')
} else if (existsSync(envExamplePath)) {
  copyFileSync(envExamplePath, envPath)
  log('created .env from .env.example (edit it if you need non-default ports/secrets).')
} else {
  warn('.env.example not found -- nothing to copy. This should not happen on a clean clone.')
}

// --- 5. Docker check (needed by `pnpm start`, not by setup itself) --------
const docker = runCapture('docker', ['--version'])
if (docker.ok) {
  log(`${docker.out.trim()} found.`)
} else {
  warn('Docker was not found on PATH. `pnpm start` needs Docker to run Postgres and Valkey. Install Docker Desktop (or the Docker Engine) and re-open your shell.')
}

log('')
log('Setup complete. Next:')
log('  pnpm start --demo    # boots Postgres + Valkey, applies migrations, starts the app, seeds the demo tenant')
console.log('')
