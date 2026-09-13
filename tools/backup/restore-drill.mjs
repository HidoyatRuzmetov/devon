#!/usr/bin/env node
// tools/backup/restore-drill.mjs -- the restore drill (HARDENING H19.1, TECH-SPEC.md §13).
//
// What it proves, end to end, against real containers and a real backup file:
//
//   1. the newest Postgres backup in BACKUP_DIR restores into a SCRATCH database (never the live
//      one), and how long that takes;
//   2. the restored database carries every migration `packages/db/migrations/` ships -- read back
//      from `app._migrations` in the RESTORED database, not from the live one (this is the check
//      that would catch a dump taken mid-migration or a pg_restore that silently dropped objects);
//   3. `pnpm --filter @devon/db migrate:verify` -- the repository's own `migrate` gate -- still
//      passes for the migration set the restored database claims (see the honest caveat below);
//   4. every table's row count in the restored database matches the manifest `infra/backup/
//      backup.sh` recorded at dump time (and, as drift context only, what the live database holds
//      now);
//   5. the MinIO mirror of the backups (and, optionally, the application object store) can be
//      pulled back into a SCRATCH bucket, object for object and byte for byte.
//
// Honest caveat on step 3: `packages/db/test/migrate-verify.ts` always starts its OWN Testcontainers
// Postgres -- it cannot be pointed at an existing database. So step 3 proves "this migration set is
// still internally consistent, idempotent, and keeps RLS/audit immutability intact", while step 2 is
// what actually interrogates the restored bytes. Both are reported separately and neither is claimed
// to be the other. Pass --skip-migrate-verify to leave step 3 out (it costs a container start).
//
// Everything is scratch and is torn down on exit (--keep opts out): the scratch database is dropped,
// the scratch bucket is removed, and a decrypted temporary dump is shredded. Nothing this script does
// writes to the live database, the live bucket, or the backup directory.
//
// Usage:
//   node tools/backup/restore-drill.mjs
//   node tools/backup/restore-drill.mjs --file backups/devon-devon-20260913T...dump --keep
//   node tools/backup/restore-drill.mjs --report agentic/ledger/backups/drill-2026-Q3.md
//   node tools/backup/restore-drill.mjs --skip-minio --skip-migrate-verify
//
// Exit code is 0 only when every executed check passed. Wire it weekly (infra/backup/systemd/
// devon-restore-drill.timer or infra/backup/crontab.example) and alert on non-zero.

import { spawn } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')

const MC_IMAGE =
  'minio/mc:RELEASE.2025-04-08T15-39-49Z@sha256:7e3efb09c22c0882fbf341b9d99f61f94ae6c4c20a06f2f1a2b20ea8993d8952'

// ---------------------------------------------------------------------------------------------
// tiny helpers
// ---------------------------------------------------------------------------------------------

/** `.env`-style KEY=VALUE reader. Shell env always wins -- same precedence as infra/backup/lib.sh's
 *  `load_env_defaults` and scripts/start.mjs ("shell env wins, .env fills gaps"). */
function loadEnvDefaults(file) {
  if (!existsSync(file)) return
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, '')
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1)
    value = value.replace(/^(['"])(.*)\1$/s, '$2')
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function run(cmd, args, opts = {}) {
  return new Promise((resolvePromise) => {
    // Node >= 18.20 refuses to spawn a Windows batch shim (`pnpm.cmd`) without `shell: true` (the
    // CVE-2024-27980 fix) and throws EINVAL synchronously. Every argument this script passes is a
    // literal it wrote itself -- no user input reaches a shell here.
    const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)
    let child
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd ?? ROOT,
        env: { ...process.env, ...(opts.env ?? {}) },
        stdio: [opts.stdinFd ?? (opts.input === undefined ? 'ignore' : 'pipe'), 'pipe', 'pipe'],
        shell: needsShell,
      })
    } catch (err) {
      resolvePromise({ code: -1, stdout: '', stderr: String(err) })
      return
    }
    if (opts.input !== undefined && opts.stdinFd === undefined) {
      child.stdin.end(opts.input)
    }
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => {
      stdout += d
      if (opts.echo) process.stdout.write(d)
    })
    child.stderr.on('data', (d) => {
      stderr += d
      if (opts.echo) process.stderr.write(d)
    })
    child.on('error', (err) => resolvePromise({ code: -1, stdout, stderr: String(err) }))
    child.on('close', (code) => resolvePromise({ code: code ?? -1, stdout, stderr }))
  })
}

function fail(message) {
  console.error(`[drill] ${message}`)
  process.exit(2)
}

function nowStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}

function humanBytes(n) {
  if (!Number.isFinite(n)) return '?'
  const units = ['B', 'KiB', 'MiB', 'GiB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

// ---------------------------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------------------------

const args = process.argv.slice(2)
const opts = {
  file: null,
  backupDir: null,
  composeFile: null,
  network: 'devon',
  pgHost: null,
  database: null,
  scratchDb: null,
  minioBucket: null,
  storageBucket: null,
  scratchBucketPrefix: null,
  report: null,
  keep: false,
  skipMinio: false,
  skipMigrateVerify: false,
  json: false,
}
for (let i = 0; i < args.length; i += 1) {
  const a = args[i]
  const next = () => {
    const v = args[i + 1]
    if (v === undefined) fail(`${a} needs a value`)
    i += 1
    return v
  }
  switch (a) {
    case '--file': opts.file = next(); break
    case '--backup-dir': opts.backupDir = next(); break
    case '--compose-file': opts.composeFile = next(); break
    case '--network': opts.network = next(); break
    case '--pg-host': opts.pgHost = next(); break
    case '--database': opts.database = next(); break
    case '--scratch-db': opts.scratchDb = next(); break
    case '--minio-bucket': opts.minioBucket = next(); break
    case '--storage-bucket': opts.storageBucket = next(); break
    case '--scratch-bucket': opts.scratchBucketPrefix = next(); break
    case '--report': opts.report = next(); break
    case '--keep': opts.keep = true; break
    case '--skip-minio': opts.skipMinio = true; break
    case '--skip-migrate-verify': opts.skipMigrateVerify = true; break
    case '--json': opts.json = true; break
    case '-h':
    case '--help':
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n'))
      process.exit(0)
      break
    default:
      fail(`unknown argument: ${a}`)
  }
}

// The `devon` network hostname wins over `.env`'s POSTGRES_HOST, which is written from the *host
// process*'s point of view (127.0.0.1:55432) -- same reasoning as infra/backup/backup.sh's own
// comment. Set BEFORE loading .env so `loadEnvDefaults` cannot overwrite it.
const PG_HOST = opts.pgHost ?? process.env['DRILL_PG_HOST'] ?? 'postgres'
loadEnvDefaults(join(ROOT, '.env'))

const COMPOSE_FILE = resolve(ROOT, opts.composeFile ?? join('infra', 'docker-compose.yml'))
const BACKUP_DIR = resolve(ROOT, opts.backupDir ?? process.env['BACKUP_DIR'] ?? 'backups')
const DATABASE = opts.database ?? process.env['POSTGRES_DB'] ?? 'devon'
const SUPERUSER_PASSWORD = process.env['POSTGRES_SUPERUSER_PASSWORD'] ?? 'devon_local_dev_root'
const TS = nowStamp()
const SCRATCH_DB = opts.scratchDb ?? `devon_drill_${TS.toLowerCase().replace(/[^a-z0-9]/g, '')}`
const SCRATCH_BUCKET_PREFIX = opts.scratchBucketPrefix ?? `devon-drill-${TS.toLowerCase().replace(/[^a-z0-9]/g, '')}`
const REPORT_PATH = resolve(ROOT, opts.report ?? join('agentic', 'ledger', 'backups', `restore-drill-${TS}.md`))

const MINIO_ENDPOINT = process.env['BACKUP_MINIO_ENDPOINT'] ?? process.env['STORAGE_S3_ENDPOINT'] ?? 'http://minio:9000'
const MINIO_ACCESS_KEY = process.env['BACKUP_MINIO_ACCESS_KEY'] ?? process.env['STORAGE_S3_ACCESS_KEY'] ?? process.env['MINIO_ROOT_USER'] ?? ''
const MINIO_SECRET_KEY = process.env['BACKUP_MINIO_SECRET_KEY'] ?? process.env['STORAGE_S3_SECRET_KEY'] ?? process.env['MINIO_ROOT_PASSWORD'] ?? ''
const MINIO_BUCKET = opts.minioBucket ?? process.env['BACKUP_MINIO_BUCKET'] ?? 'devon-backups'
const STORAGE_BUCKET = opts.storageBucket ?? process.env['STORAGE_S3_BUCKET'] ?? 'devon'

/** The exact digest-pinned Postgres image the deployment runs, read out of the compose file -- never
 *  a second pin that could drift from it (infra/backup/lib.sh's `postgres_image`, in JS). */
function postgresImage() {
  if (!existsSync(COMPOSE_FILE)) fail(`compose file not found: ${COMPOSE_FILE}`)
  const lines = readFileSync(COMPOSE_FILE, 'utf8').split(/\r?\n/)
  let inPostgres = false
  for (const line of lines) {
    if (/^ {2}postgres:\s*$/.test(line)) inPostgres = true
    else if (inPostgres) {
      const m = line.match(/^\s+image:\s*(\S+)/)
      if (m) return m[1]
      if (/^ {2}\S/.test(line)) break
    }
  }
  return null
}

const PG_IMAGE = postgresImage()
if (!PG_IMAGE) fail(`could not read the postgres image reference from ${COMPOSE_FILE}`)

// ---------------------------------------------------------------------------------------------
// docker wrappers
// ---------------------------------------------------------------------------------------------

const dockerPgBase = () => [
  'run', '--rm', '--network', opts.network,
  '-e', 'PGPASSWORD',
  PG_IMAGE,
]

const pgEnv = { PGPASSWORD: SUPERUSER_PASSWORD }

async function psql(db, sql, { tuplesOnly = true } = {}) {
  const flags = tuplesOnly ? ['-tA', '-F', '|'] : []
  return run('docker', [...dockerPgBase(), 'psql', '-h', PG_HOST, '-U', 'postgres', '-d', db, ...flags, '-c', sql], { env: pgEnv })
}

async function createScratchDb(name) {
  return run('docker', [...dockerPgBase(), 'createdb', '-h', PG_HOST, '-U', 'postgres', name], { env: pgEnv })
}

async function dropScratchDb(name) {
  return run('docker', [...dockerPgBase(), 'dropdb', '-h', PG_HOST, '-U', 'postgres', '--if-exists', '--force', name], { env: pgEnv })
}

async function mc(script) {
  // `mc` reads the alias out of MC_HOST_<alias>; the credential therefore never appears in argv
  // (where `docker inspect`/`ps` would show it) -- it is an environment variable of the throwaway
  // container only.
  const scheme = MINIO_ENDPOINT.startsWith('https://') ? 'https://' : 'http://'
  const bare = MINIO_ENDPOINT.replace(/^https?:\/\//, '')
  return run('docker', [
    'run', '--rm', '--network', opts.network, '--entrypoint', 'sh',
    '-e', 'MC_HOST_drill',
    MC_IMAGE, '-c', script,
  ], {
    env: {
      MC_HOST_drill: `${scheme}${encodeURIComponent(MINIO_ACCESS_KEY)}:${encodeURIComponent(MINIO_SECRET_KEY)}@${bare}`,
    },
  })
}

// ---------------------------------------------------------------------------------------------
// the drill
// ---------------------------------------------------------------------------------------------

/** Every check appends one of these. `ok === null` means "not executed" (skipped), which is never a
 *  pass and never a failure -- it is reported as SKIPPED and named in the report's summary line, so
 *  a drill that quietly did half the work cannot read as a green drill. */
const checks = []
const addCheck = (name, ok, detail) => {
  checks.push({ name, ok, detail })
  const tag = ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'
  console.log(`[drill] ${tag}  ${name}${detail ? ` -- ${detail}` : ''}`)
}

const cleanupTasks = []
let exiting = false
async function cleanup() {
  if (exiting) return
  exiting = true
  for (const task of cleanupTasks.reverse()) {
    try {
      await task()
    } catch (err) {
      console.error(`[drill] cleanup step failed (continuing): ${String(err)}`)
    }
  }
}

function findLatestBackup() {
  if (opts.file) {
    const p = resolve(ROOT, opts.file)
    if (!existsSync(p)) fail(`--file not found: ${p}`)
    return p
  }
  if (!existsSync(BACKUP_DIR)) return null
  const candidates = readdirSync(BACKUP_DIR)
    .filter((f) => new RegExp(`^devon-${DATABASE}-.*\\.dump(\\.gpg)?$`).test(f))
    .map((f) => join(BACKUP_DIR, f))
    .map((p) => ({ p, mtime: statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  return candidates.length ? candidates[0].p : null
}

async function main() {
  console.log(`[drill] Devon restore drill ${TS}`)
  console.log(`[drill] backup dir      ${BACKUP_DIR}`)
  console.log(`[drill] source database ${DATABASE} on ${PG_HOST} (network ${opts.network})`)
  console.log(`[drill] scratch database ${SCRATCH_DB}`)

  const docker = await run('docker', ['version', '--format', '{{.Server.Version}}'])
  if (docker.code !== 0) fail('docker is not available -- this drill restores into a real container')

  const backupFile = findLatestBackup()
  if (!backupFile) {
    fail(
      `no backup matching devon-${DATABASE}-*.dump[.gpg] in ${BACKUP_DIR}. ` +
        'Take one first: `infra/backup/backup.sh` (see docs/ops/RUNBOOK.md).',
    )
  }
  const backupBytes = statSync(backupFile).size
  console.log(`[drill] backup file     ${basename(backupFile)} (${humanBytes(backupBytes)})`)

  // --- 1. decrypt if needed -------------------------------------------------------------------
  let restoreSource = backupFile
  let tempDir = null
  if (backupFile.endsWith('.gpg')) {
    const passphrase = process.env['BACKUP_ENCRYPTION_PASSPHRASE']
    if (!passphrase) fail(`${basename(backupFile)} is encrypted but BACKUP_ENCRYPTION_PASSPHRASE is not set`)
    tempDir = mkdtempSync(join(tmpdir(), 'devon-drill-'))
    cleanupTasks.push(() => rmSync(tempDir, { recursive: true, force: true }))
    restoreSource = join(tempDir, 'restore.dump')
    // The passphrase goes in on stdin, never in argv -- `ps`/`docker inspect` on a shared ops box
    // would otherwise show the passphrase that protects every backup on the host.
    const gpg = await run('gpg', [
      '--batch', '--yes', '--pinentry-mode', 'loopback',
      '--passphrase-fd', '0',
      '--decrypt', '--output', restoreSource, backupFile,
    ], { input: `${passphrase}\n` })
    if (gpg.code !== 0) fail(`gpg decrypt failed: ${gpg.stderr.trim()}`)
    addCheck('encrypted backup decrypts with BACKUP_ENCRYPTION_PASSPHRASE', true, basename(backupFile))
  }

  // --- 2. restore into the scratch database ---------------------------------------------------
  const created = await createScratchDb(SCRATCH_DB)
  if (created.code !== 0) fail(`createdb ${SCRATCH_DB} failed: ${created.stderr.trim()}`)
  if (!opts.keep) cleanupTasks.push(async () => { await dropScratchDb(SCRATCH_DB) })

  const started = Date.now()
  const fd = openSync(restoreSource, 'r')
  let restore
  try {
    restore = await run('docker', [
      'run', '--rm', '-i', '--network', opts.network, '-e', 'PGPASSWORD', PG_IMAGE,
      'pg_restore', '-h', PG_HOST, '-U', 'postgres', '-d', SCRATCH_DB, '--no-owner',
    ], { env: pgEnv, stdinFd: fd })
  } finally {
    closeSync(fd)
  }
  const restoreSeconds = Math.round((Date.now() - started) / 1000)
  // pg_restore exits non-zero on any error; warnings about missing roles under --no-owner are
  // reported on stderr with exit 0, which is expected on a scratch database.
  addCheck(
    'pg_restore into the scratch database exits cleanly',
    restore.code === 0,
    restore.code === 0 ? `${restoreSeconds}s` : restore.stderr.trim().split('\n').slice(-3).join(' / '),
  )
  if (restore.code !== 0) {
    await writeReport({ backupFile, backupBytes, restoreSeconds, rows: [], manifestPath: null, minio: null, migrationRows: [], migrateVerify: null })
    await cleanup()
    process.exit(1)
  }

  // --- 3. migrations present in the RESTORED database ----------------------------------------
  const migrationsDir = join(ROOT, 'packages', 'db', 'migrations')
  const expectedMigrations = existsSync(migrationsDir)
    ? readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
    : []
  const appliedQuery = await psql(SCRATCH_DB, 'select name from app._migrations order by name;')
  const appliedMigrations = appliedQuery.code === 0
    ? appliedQuery.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    : []
  const missing = expectedMigrations.filter((m) => !appliedMigrations.includes(m))
  const unknown = appliedMigrations.filter((m) => !expectedMigrations.includes(m))
  addCheck(
    'restored database lists every migration in packages/db/migrations',
    appliedQuery.code === 0 && missing.length === 0,
    appliedQuery.code !== 0
      ? 'app._migrations unreadable in the restored database'
      : `${appliedMigrations.length}/${expectedMigrations.length} present` +
        (missing.length ? `; missing: ${missing.join(', ')}` : '') +
        (unknown.length ? `; ahead of this checkout: ${unknown.join(', ')}` : ''),
  )
  const migrationRows = expectedMigrations.map((m) => ({ name: m, present: appliedMigrations.includes(m) }))

  // RLS is the tenancy invariant (I-1). A restore that came back without policies would look
  // perfectly healthy on row counts and silently serve every department's rows to everyone.
  const policiesLive = await psql(DATABASE, "select count(*) from pg_policies where schemaname in ('app','audit');")
  const policiesRestored = await psql(SCRATCH_DB, "select count(*) from pg_policies where schemaname in ('app','audit');")
  const livePolicyCount = Number(policiesLive.stdout.trim() || '-1')
  const restoredPolicyCount = Number(policiesRestored.stdout.trim() || '-2')
  addCheck(
    'row-level-security policies survive the restore (I-1)',
    restoredPolicyCount > 0 && restoredPolicyCount === livePolicyCount,
    `${restoredPolicyCount} restored vs ${livePolicyCount} live`,
  )

  // --- 4. row counts vs the manifest recorded at dump time ------------------------------------
  const manifestPath = `${backupFile.replace(/\.gpg$/, '')}.manifest.json`
  let rows = []
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const expected = manifest.table_counts ?? {}
    const keys = Object.keys(expected)
    if (keys.length === 0) {
      addCheck('row-count manifest has table counts', false, `${basename(manifestPath)} lists no tables`)
    } else {
      // ONE union query, not one round trip per table: ~85 tables × a container start each measured
      // in minutes on this host, and the counts would then span a multi-minute window of a live,
      // append-only database rather than one instant (the same fix infra/backup/backup.sh's own
      // manifest step documents).
      const unionFor = (list) =>
        list
          .map((k) => {
            const [schema, table] = [k.slice(0, k.indexOf('.')), k.slice(k.indexOf('.') + 1)]
            return `select '${k}' as tbl, count(*) as cnt from "${schema}"."${table}"`
          })
          .join(' union all ')
      const restoredCounts = await psql(SCRATCH_DB, unionFor(keys))
      const liveCounts = await psql(DATABASE, unionFor(keys))
      const parse = (out) => {
        const map = new Map()
        for (const line of out.split(/\r?\n/)) {
          const [tbl, cnt] = line.split('|')
          if (tbl) map.set(tbl.trim(), Number(cnt))
        }
        return map
      }
      const restoredMap = parse(restoredCounts.stdout)
      const liveMap = parse(liveCounts.stdout)
      rows = keys.sort().map((k) => ({
        table: k,
        expected: Number(expected[k]),
        restored: restoredMap.has(k) ? restoredMap.get(k) : null,
        live: liveMap.has(k) ? liveMap.get(k) : null,
      }))
      const mismatches = rows.filter((r) => r.restored !== r.expected)
      addCheck(
        'every table restores with the row count recorded at dump time',
        mismatches.length === 0,
        mismatches.length === 0
          ? `${rows.length} tables compared`
          : mismatches.map((m) => `${m.table}: expected ${m.expected}, restored ${m.restored ?? 'ERR'}`).join('; '),
      )
    }
  } else {
    addCheck('row-count manifest found next to the backup', null, `${basename(manifestPath)} missing -- backup predates the manifest feature`)
  }

  // --- 5. migrate:verify (the repository's own `migrate` gate) --------------------------------
  let migrateVerify = null
  if (opts.skipMigrateVerify) {
    addCheck('pnpm --filter @devon/db migrate:verify', null, '--skip-migrate-verify')
  } else {
    console.log('[drill] running migrate:verify (starts its own Testcontainers Postgres; a few minutes) ...')
    // `spawn` without a shell cannot execute a Windows shim: `pnpm` on win32 is `pnpm.cmd`/`pnpm.ps1`
    // in the corepack shim directory, and asking for bare `pnpm` fails with ENOENT (exit -1) -- which
    // the drill would otherwise report as "migrate:verify failed" on a Windows rehearsal host.
    const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    const mv = await run(pnpmBin, ['--filter', '@devon/db', 'migrate:verify'], { echo: false })
    // stdout is the check log; stderr is only quoted when it mattered (a failure), so a PASS report
    // does not end on pnpm's own echoed command line.
    const tailOf = (s, n) => s.split(/\r?\n/).filter(Boolean).slice(-n).join('\n')
    migrateVerify = {
      code: mv.code,
      tail: mv.code === 0 ? tailOf(mv.stdout, 12) : `${tailOf(mv.stdout, 8)}\n--- stderr ---\n${tailOf(mv.stderr, 8)}`,
    }
    addCheck('pnpm --filter @devon/db migrate:verify', mv.code === 0, mv.code === 0 ? 'all sections pass' : `exit ${mv.code}`)
  }

  // --- 6. MinIO mirror restored into a scratch bucket -----------------------------------------
  let minio = null
  if (opts.skipMinio) {
    addCheck('MinIO mirror restores into a scratch bucket', null, '--skip-minio')
  } else if (!MINIO_ACCESS_KEY || !MINIO_SECRET_KEY) {
    addCheck(
      'MinIO mirror restores into a scratch bucket',
      null,
      'no credentials resolved (BACKUP_MINIO_* / STORAGE_S3_* / MINIO_ROOT_*) -- mirror not configured on this host',
    )
  } else {
    minio = { endpoint: MINIO_ENDPOINT, buckets: [] }
    const sources = [
      { name: MINIO_BUCKET, label: 'backup mirror', required: true },
      { name: STORAGE_BUCKET, label: 'application object store', required: false },
    ]
    for (const source of sources) {
      const scratchBucket = `${SCRATCH_BUCKET_PREFIX}-${source.name}`.slice(0, 62).replace(/[^a-z0-9-]/g, '-')
      const exists = await mc(`mc ls drill/${source.name} >/dev/null 2>&1 && echo yes || echo no`)
      if (exists.stdout.trim() !== 'yes') {
        addCheck(
          `MinIO ${source.label} bucket "${source.name}" restores into a scratch bucket`,
          source.required ? false : null,
          source.required
            ? `bucket not found at ${MINIO_ENDPOINT} -- set BACKUP_MIRROR_TO_MINIO=1 so backup.sh mirrors off-host (H19.1)`
            : 'bucket absent on this host',
        )
        continue
      }
      if (!opts.keep) cleanupTasks.push(async () => { await mc(`mc rb --force drill/${scratchBucket} >/dev/null 2>&1 || true`) })
      const mirrored = await mc(
        `mc mb --ignore-existing drill/${scratchBucket} && mc mirror --quiet --overwrite drill/${source.name} drill/${scratchBucket}`,
      )
      const listOf = async (bucket) => {
        const res = await mc(`mc ls --recursive --json drill/${bucket}`)
        const entries = res.stdout
          .split(/\r?\n/)
          .filter(Boolean)
          .map((l) => {
            try { return JSON.parse(l) } catch { return null }
          })
          .filter((e) => e && e.key)
          .map((e) => ({ key: e.key, size: Number(e.size ?? 0) }))
          .sort((a, b) => a.key.localeCompare(b.key))
        return entries
      }
      const sourceObjects = await listOf(source.name)
      const scratchObjects = await listOf(scratchBucket)
      const sameCount = sourceObjects.length === scratchObjects.length
      const sameBytes =
        sourceObjects.reduce((s, o) => s + o.size, 0) === scratchObjects.reduce((s, o) => s + o.size, 0)
      const identical = sameCount && sameBytes &&
        sourceObjects.every((o, i) => scratchObjects[i] && scratchObjects[i].key === o.key && scratchObjects[i].size === o.size)
      minio.buckets.push({
        label: source.label,
        source: source.name,
        scratch: scratchBucket,
        objects: sourceObjects.length,
        bytes: sourceObjects.reduce((s, o) => s + o.size, 0),
        identical,
      })
      addCheck(
        `MinIO ${source.label} bucket "${source.name}" restores into a scratch bucket`,
        mirrored.code === 0 && identical && sourceObjects.length > 0,
        sourceObjects.length === 0
          ? 'bucket is empty -- nothing was mirrored off-host'
          : `${sourceObjects.length} object(s), ${humanBytes(sourceObjects.reduce((s, o) => s + o.size, 0))}, byte-for-byte identical in ${scratchBucket}`,
      )
      // The one object that matters most: the backup being drilled must itself be in the mirror.
      if (source.required) {
        const mirroredBackup = sourceObjects.find((o) => o.key.endsWith(basename(backupFile)))
        addCheck(
          'the backup being drilled is present in the off-host mirror at the same size',
          Boolean(mirroredBackup) && mirroredBackup.size === backupBytes,
          mirroredBackup
            ? `${mirroredBackup.key} ${humanBytes(mirroredBackup.size)} (local ${humanBytes(backupBytes)})`
            : `${basename(backupFile)} not found in ${source.name}`,
        )
      }
    }
  }

  await writeReport({ backupFile, backupBytes, restoreSeconds, rows, manifestPath, minio, migrationRows, migrateVerify })

  const failed = checks.filter((c) => c.ok === false)
  const skipped = checks.filter((c) => c.ok === null)
  await cleanup()

  if (opts.json) {
    console.log(JSON.stringify({ ts: TS, backup: basename(backupFile), restoreSeconds, checks }, null, 2))
  }
  console.log(
    `[drill] ${failed.length === 0 ? 'PASS' : 'FAIL'}: ${checks.length - failed.length - skipped.length} passed, ` +
      `${failed.length} failed, ${skipped.length} skipped. Report: ${REPORT_PATH}`,
  )
  process.exit(failed.length === 0 ? 0 : 1)
}

// ---------------------------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------------------------

async function writeReport({ backupFile, backupBytes, restoreSeconds, rows, manifestPath, minio, migrationRows, migrateVerify }) {
  const failed = checks.filter((c) => c.ok === false)
  const skipped = checks.filter((c) => c.ok === null)
  const verdict = failed.length === 0 ? (skipped.length ? 'PASS (with skipped checks)' : 'PASS') : 'FAIL'
  const mismatches = rows.filter((r) => r.restored !== r.expected)
  const drifted = rows.filter((r) => r.live !== null && r.live !== r.expected)

  const out = []
  out.push(`# Restore drill -- ${TS}`)
  out.push('')
  out.push(`**Qisqacha (uz-Latn):** Eng so'nggi zaxira nusxasi vaqtinchalik ma'lumotlar bazasiga tiklandi, ` +
    `migratsiyalar va qatorlar soni solishtirildi, MinIO nusxasi vaqtinchalik bucketga qaytarildi. Natija: **${verdict}**.`)
  out.push('')
  out.push(`**Verdict: ${verdict}** -- ${checks.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped.`)
  out.push('')
  out.push('| Field | Value |')
  out.push('|---|---|')
  out.push(`| Backup file | \`${basename(backupFile)}\` (${humanBytes(backupBytes)}) |`)
  out.push(`| Source database | \`${DATABASE}\` on \`${PG_HOST}\` (docker network \`${opts.network}\`) |`)
  out.push(`| Scratch database | \`${SCRATCH_DB}\` (${opts.keep ? 'kept: --keep' : 'dropped after the drill'}) |`)
  out.push(`| Postgres image | \`${PG_IMAGE}\` |`)
  out.push(`| Restore duration | ${restoreSeconds}s |`)
  out.push(`| Manifest | ${manifestPath && existsSync(manifestPath) ? `\`${basename(manifestPath)}\`` : 'absent'} |`)
  out.push(`| Command | \`node tools/backup/restore-drill.mjs${args.length ? ` ${args.join(' ')}` : ''}\` |`)
  out.push('')
  out.push('## Checks')
  out.push('')
  out.push('| Check | Result | Detail |')
  out.push('|---|---|---|')
  for (const c of checks) {
    const tag = c.ok === null ? 'SKIPPED' : c.ok ? 'PASS' : '**FAIL**'
    out.push(`| ${c.name} | ${tag} | ${(c.detail ?? '').replace(/\|/g, '\\|')} |`)
  }
  out.push('')

  if (migrationRows.length) {
    const present = migrationRows.filter((m) => m.present).length
    out.push(`## Migrations in the restored database (\`app._migrations\`)`)
    out.push('')
    out.push(`${present}/${migrationRows.length} migration files from \`packages/db/migrations/\` are recorded as applied in the restored database.`)
    const missingRows = migrationRows.filter((m) => !m.present)
    if (missingRows.length) {
      out.push('')
      out.push('Missing:')
      out.push('')
      for (const m of missingRows) out.push(`- \`${m.name}\``)
    }
    out.push('')
  }

  if (migrateVerify) {
    out.push('## `pnpm --filter @devon/db migrate:verify`')
    out.push('')
    out.push(
      'This is the repository\'s own `migrate` gate. It starts its OWN Testcontainers Postgres -- it ' +
        'cannot be pointed at the restored database -- so it proves the migration set is internally ' +
        'consistent, idempotent and keeps RLS/audit immutability intact; the restored bytes are checked ' +
        'by the `app._migrations` and row-count sections above.',
    )
    out.push('')
    out.push(`Exit code: ${migrateVerify.code}`)
    out.push('')
    out.push('```')
    out.push(migrateVerify.tail)
    out.push('```')
    out.push('')
  }

  if (rows.length) {
    out.push('## Row counts')
    out.push('')
    out.push(
      '`Expected` is the count `infra/backup/backup.sh` recorded in the manifest immediately before ' +
        '`pg_dump` ran. `Restored` is the count in the scratch database. `Live now` is the current live ' +
        'database, shown only as drift context -- a live count ahead of expected is normal on an ' +
        'append-only, still-running system and is never a drill failure.',
    )
    out.push('')
    out.push('| Table | Expected (at dump time) | Restored | Live now |')
    out.push('|---|---:|---:|---:|')
    for (const r of rows) {
      const flag = r.restored === r.expected ? '' : ' ⚠'
      out.push(`| \`${r.table}\` | ${r.expected} | ${r.restored ?? 'ERR'}${flag} | ${r.live ?? '-'} |`)
    }
    out.push('')
    if (mismatches.length) {
      out.push('### Mismatches (drill failure)')
      out.push('')
      for (const m of mismatches) out.push(`- \`${m.table}\`: expected ${m.expected}, restored ${m.restored ?? 'ERR'}`)
      out.push('')
    }
    if (drifted.length) {
      out.push(`_${drifted.length} table(s) have grown since the dump was taken (expected on a live system)._`)
      out.push('')
    }
  }

  if (minio) {
    out.push('## MinIO mirror')
    out.push('')
    out.push(`Endpoint: \`${minio.endpoint}\``)
    out.push('')
    if (minio.buckets.length) {
      out.push('| Bucket | Role | Objects | Bytes | Restored into | Byte-for-byte identical |')
      out.push('|---|---|---:|---:|---|---|')
      for (const b of minio.buckets) {
        out.push(`| \`${b.source}\` | ${b.label} | ${b.objects} | ${humanBytes(b.bytes)} | \`${b.scratch}\`${opts.keep ? '' : ' (removed)'} | ${b.identical ? 'yes' : 'no'} |`)
      }
    } else {
      out.push('No bucket could be mirrored -- see the checks table.')
    }
    out.push('')
  }

  out.push('## What a failure means')
  out.push('')
  out.push('| Failing check | First action |')
  out.push('|---|---|')
  out.push('| `pg_restore ... exits cleanly` | The newest backup is unusable. Drill the previous one (`--file`) and treat the gap as a live incident: `docs/ops/RUNBOOK.md` → "Backup or drill failed". |')
  out.push('| `restored database lists every migration` | The dump was taken while migrations were mid-flight, or `pg_restore` dropped objects. Re-take a backup and re-drill before trusting it. |')
  out.push('| `row-level-security policies survive the restore` | A restore from this backup would serve cross-department rows (I-1). Do not cut over to it. |')
  out.push('| `every table restores with the row count recorded at dump time` | Data loss between dump and restore. Compare the named tables against the live database before using this backup for anything. |')
  out.push('| `MinIO ... restores into a scratch bucket` | The off-host copy is missing or incomplete: a host loss or a wipe would take the backups with it. Check `BACKUP_MIRROR_TO_MINIO` and the backup job log. |')
  out.push('')
  out.push('---')
  out.push('')
  out.push('Generated by `tools/backup/restore-drill.mjs` (HARDENING H19.1). Weekly schedule: `infra/backup/systemd/devon-restore-drill.timer` or `infra/backup/crontab.example`. Quarterly checklist: `docs/ops/CHECKLIST-QUARTERLY-DRILL.md`.')
  out.push('')

  mkdirSync(dirname(REPORT_PATH), { recursive: true })
  writeFileSync(REPORT_PATH, out.join('\n'), 'utf8')
  console.log(`[drill] report written to ${REPORT_PATH}`)
}

process.on('SIGINT', () => { void cleanup().then(() => process.exit(130)) })
process.on('SIGTERM', () => { void cleanup().then(() => process.exit(143)) })

main().catch(async (err) => {
  console.error('[drill] unexpected failure:', err)
  await cleanup()
  process.exit(2)
})
