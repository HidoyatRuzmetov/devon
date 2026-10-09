#!/usr/bin/env node
// `pnpm -w security:scan` -- the `security` gate's command (agentic/gates.json). Runs, in order:
//   1. Semgrep: the OWASP Top Ten ruleset + this repo's own rules (tools/semgrep/rules/) --
//      await-in-loop over independent items, query-in-loop, sync fs in a request handler, polling
//      (HARDENING H29.1).
//   2. Trivy filesystem scan: vulnerable dependencies + committed secrets, HIGH/CRITICAL only (the
//      `deps` gate separately runs `pnpm audit --audit-level=high` for the npm-advisory angle; Trivy
//      here also catches non-npm issues -- base image CVEs are covered by step 3, not this step).
//   3. Trivy IMAGE scans of the three images this package's Dockerfiles build (apps/api/Dockerfile,
//      apps/api/Dockerfile.worker, apps/web/Dockerfile) -- skipped with a clear message (not a
//      failure) when Docker is unavailable or an image has never been built locally, since neither
//      condition means the code is insecure, just that this particular check has nothing to scan yet.
//
// Exits non-zero if ANY step finds a HIGH/CRITICAL issue (Trivy) or a Semgrep match (--error), so
// this composes as one `&&`-friendly gate the way the two-line inline script it replaced did.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { stageRepositorySource } from './source-stage.mjs'
import { scannerReport } from './scanner-report.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SEMGREP_RULES_DIR = join(ROOT, 'tools', 'semgrep', 'rules')

// Pinned exact versions the images in this repo are built from (TECH-SPEC §16) -- not resolved by
// digest here (unlike infra/*.yml) because `docker images` below matches by repository:tag, and these
// are local build outputs, not pulled third-party images.
const SCAN_IMAGES = [
  { name: 'devon-api', dockerfile: 'apps/api/Dockerfile' },
  { name: 'devon-worker', dockerfile: 'apps/api/Dockerfile.worker' },
  { name: 'devon-web', dockerfile: 'apps/web/Dockerfile' },
]
const TRIVY_IMAGE_TAG = process.env.TRIVY_IMAGE_TAG || 'security-scan'
// Pinned exact version (matches .github/workflows/ci.yml's `curl .../v0.74.0/contrib/install.sh`) --
// used only as a fallback container when a native `trivy` binary is not on PATH (documented dev-machine
// path: "trivy as `docker run --rm aquasec/trivy`" per this repo's own ops docs). CI always installs
// the real binary, so this branch never runs there.
const TRIVY_DOCKER_IMAGE = 'aquasec/trivy:0.74.0'

function run(label, cmd, args, opts = {}) {
  console.log(`\n[security:scan] ${label}: ${cmd} ${args.join(' ')}`)
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    cwd: ROOT,
    ...opts,
  })
  if (result.error) throw result.error
  try {
    const report = scannerReport(opts.scanner, JSON.parse(result.stdout))
    console.log(JSON.stringify({ scanner: opts.scanner, exit: result.status, ...report }))
    return report.findings.length || report.errors.some((error) => error.level === 'error')
      ? 1
      : (result.status ?? 1)
  } catch {
    console.error(
      `[security:scan] ${opts.scanner} did not emit a valid result envelope (exit ${result.status}); refusing to report success`,
    )
    return 1
  }
}

function commandExists(cmd) {
  const probe = process.platform === 'win32' ? spawnSync('where', [cmd]) : spawnSync('which', [cmd])
  return probe.status === 0
}

// Runs `trivy <trivyArgs>` via the native binary if present, else via `docker run --rm
// aquasec/trivy:<pinned>` (mounting the repo read-only for `fs`, and the host's Docker socket for
// `image` -- Trivy's own documented way to scan an image already sitting in the *host's* Docker
// daemon from inside a Trivy container that has no image store of its own).
function runTrivy(label, trivyArgs, { mode, sourceRoot = ROOT } = { mode: 'fs' }) {
  if (commandExists('trivy')) {
    return run(label, 'trivy', trivyArgs, { scanner: 'trivy' })
  }
  const dockerArgs = ['run', '--rm']
  if (mode === 'fs') {
    dockerArgs.push('-v', `${sourceRoot}:/repo:ro`, '-w', '/repo')
  } else {
    dockerArgs.push('-v', '/var/run/docker.sock:/var/run/docker.sock')
  }
  dockerArgs.push(TRIVY_DOCKER_IMAGE, ...trivyArgs)
  return run(`${label} (via docker, no native trivy on PATH)`, 'docker', dockerArgs, {
    scanner: 'trivy',
  })
}

let failed = false

// --- 1. Semgrep: OWASP ruleset + this repo's own rules ------------------------------------------------
if (!commandExists('semgrep')) {
  console.error(
    '[security:scan] semgrep not found on PATH -- install it (pip install semgrep==1.176.1, pinned to match .github/workflows/ci.yml) to run this locally.',
  )
  failed = true
} else {
  const semgrepArgs = ['--config', 'p/owasp-top-ten']
  if (existsSync(SEMGREP_RULES_DIR)) semgrepArgs.push('--config', SEMGREP_RULES_DIR)
  semgrepArgs.push('--error', '--quiet', '--json', '.')
  const status = run('semgrep (OWASP + tools/semgrep/rules)', 'semgrep', semgrepArgs, {
    scanner: 'semgrep',
  })
  if (status !== 0) failed = true
}

// --- 2. Trivy filesystem scan --------------------------------------------------------------------------
const dockerAvailable = commandExists('docker')
if (!commandExists('trivy') && !dockerAvailable) {
  console.error(
    '[security:scan] neither trivy nor docker found on PATH -- install trivy (see .github/workflows/ci.yml for the pinned version) or start Docker so this can fall back to `docker run aquasec/trivy`.',
  )
  failed = true
} else {
  const source = stageRepositorySource(ROOT)
  const manifestDirectory = join(ROOT, 'artifacts/security')
  mkdirSync(manifestDirectory, { recursive: true })
  writeFileSync(
    join(manifestDirectory, 'source-manifest.json'),
    JSON.stringify(source.manifest, null, 2),
  )
  console.log(
    `[security:scan] candidate source: ${source.manifest.length} current Git files; exact SHA manifest saved`,
  )
  try {
    const status = runTrivy(
      'trivy fs (vulnerabilities + secrets, HIGH/CRITICAL)',
      [
        'fs',
        '--scanners',
        'vuln,secret',
        '--severity',
        'HIGH,CRITICAL',
        '--exit-code',
        '1',
        '--quiet',
        '--format',
        'json',
        // `node_modules` is excluded: `pnpm audit --audit-level=high` (the `deps` gate) is already the
        // npm-advisory-aware check for JS dependency vulnerabilities; walking every workspace's
        // `node_modules` here too is pure duplication (this Trivy step exists for what `pnpm audit`
        // *cannot* see -- non-npm files and secrets) and, empirically, walking this repo's ~1250
        // packages through Docker Desktop's Windows bind-mount overhead is slow enough to blow Trivy's
        // own internal analysis semaphore ("context deadline exceeded") before it ever gets to
        // reporting a single finding -- observed running this locally without the skip. `--timeout` is
        // also raised well past the 5m default for the same reason (a cold vulnerability-DB download
        // plus a large tree, on a slow bind mount, easily exceeds it on a first run).
        '--skip-dirs',
        '**/node_modules',
        '--timeout',
        '15m',
        commandExists('trivy') ? source.directory : '/repo',
      ],
      { mode: 'fs', sourceRoot: source.directory },
    )
    if (status !== 0) failed = true
  } finally {
    source.cleanup()
  }

  // --- 3. Trivy image scans (built locally by this package's Dockerfiles) -----------------------------
  for (const { name, dockerfile } of SCAN_IMAGES) {
    const tag = `${name}:${TRIVY_IMAGE_TAG}`
    if (!dockerAvailable) {
      console.log(
        `[security:scan] docker not available -- skipping image scan for ${tag} (fs scan above already covers source-level issues).`,
      )
      continue
    }
    const inspect = spawnSync('docker', ['image', 'inspect', tag], { stdio: 'ignore' })
    if (inspect.status !== 0) {
      console.log(
        `[security:scan] ${tag} not built locally -- skipping (build it first: docker build -f ${dockerfile} -t ${tag} .). Not a failure: this step only scans images that exist.`,
      )
      continue
    }
    const status = runTrivy(
      `trivy image (${tag})`,
      [
        'image',
        '--severity',
        'HIGH,CRITICAL',
        '--exit-code',
        '1',
        '--quiet',
        '--format',
        'json',
        '--ignore-unfixed',
        tag,
      ],
      { mode: 'image' },
    )
    if (status !== 0) failed = true
  }
}

if (failed) {
  console.error('\n[security:scan] FAILED -- see output above.')
  process.exit(1)
}
console.log('\n[security:scan] PASS')
