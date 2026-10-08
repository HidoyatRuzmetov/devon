import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const source = readFileSync(new URL('../remote-deploy.sh', import.meta.url), 'utf8')
const sha = 'a'.repeat(40)
const previous = 'DEVON_API_IMAGE=old-api\nDEVON_WEB_IMAGE=old-web\nDEVON_RELEASE_SHA=old\n'
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
const posix = (path) =>
  path.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)

// Execute the real deployment script with only its fixed root redirected to a temporary fixture.
// Every external service command is a mock executable; no Docker daemon or server is contacted.
function deploy(scenario, { previousManifest = true, dotenv } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'devon-deploy-test-'))
  const root = posix(dir)
  mkdirSync(join(dir, 'bin'))
  mkdirSync(join(dir, 'infra'))
  writeFileSync(
    join(dir, '.env'),
    dotenv ??
      'DEVON_PUBLIC_URL=https://fixture.invalid\nMIGRATION_DATABASE_URL=postgres://dummy@fixture/db\n',
  )
  writeFileSync(join(dir, '.deployed-images.env'), previous)
  writeFileSync(join(dir, 'infra/docker-compose.prod.yml'), 'candidate manifest')
  writeFileSync(join(dir, 'infra/Caddyfile'), 'candidate proxy')
  if (previousManifest) {
    writeFileSync(join(dir, 'infra/.previous-docker-compose.prod.yml'), 'previous manifest')
    writeFileSync(join(dir, 'infra/.previous-Caddyfile'), 'previous proxy')
  }
  writeFileSync(
    join(dir, 'deploy.sh'),
    source
      .replace('ROOT=/opt/devon', `ROOT='${root}'\nexport PATH="$ROOT/bin:$PATH"`)
      .replaceAll('\r\n', '\n'),
  )
  const mock = `#!/usr/bin/env bash
set -eu
name="\${0##*/}"
printf '%s %s image=%s\\n' "$name" "$*" "\${DEVON_API_IMAGE:-none}" >> "$TEST_ROOT/calls"
if [[ "$*" == *'cli-migrate.ts'* ]]; then
  printf '%s' "$MIGRATION_DATABASE_URL" > "$TEST_ROOT/migration-url"
  printf '%s' "\${DANGEROUS_DOTENV_VALUE:-not-exported}" > "$TEST_ROOT/unrelated-value"
fi
case "$name" in
  sudo) if [ "$SCENARIO" = backup-start-failed ]; then exit 17; fi ;;
  systemctl) if [ "$SCENARIO" = backup-failed ]; then echo exit-code; else echo success; fi ;;
  flock|sleep) exit 0 ;;
  seq) echo 1 ;;
  curl) [ "$SCENARIO" != readiness-failed ] || [ "\${DEVON_API_IMAGE:-}" = old-api ] ;;
  docker)
    if [[ "$*" == *'ps --status running postgres'* ]]; then
      case "$SCENARIO" in stopped|orphan-volume|initial) ;; *) echo devon-postgres ;; esac
    elif [[ "$*" == 'inspect devon-postgres' ]]; then
      [ "$SCENARIO" = stopped ]
    elif [[ "$*" == 'volume inspect devon_postgres_data' ]]; then
      [ "$SCENARIO" = orphan-volume ]
    elif [[ "$*" == 'pull '* ]]; then
      if [ "$SCENARIO" = pull-failed ]; then exit 42; fi
    elif [[ "$*" == *' postgres valkey clamav centrifugo' ]]; then
      if [ "$SCENARIO" = data-tier-failed ]; then exit 43; fi
    elif [[ "$*" == *' run '* ]]; then
      [ "$SCENARIO" != migration-failed ]
    elif [[ "$*" == *' api web caddy' ]]; then
      [ "$SCENARIO" != rollout-failed ] || [ "\${DEVON_API_IMAGE:-}" = old-api ]
    elif [[ "$*" == *'--force-recreate'* ]]; then
      cat "$TEST_ROOT/infra/Caddyfile" > "$TEST_ROOT/proxy-loaded"
      [ "$SCENARIO" != proxy-failed ] || [ "\${DEVON_API_IMAGE:-}" = old-api ]
    fi ;;
esac
`
  for (const command of ['docker', 'sudo', 'systemctl', 'flock', 'sleep', 'seq', 'curl']) {
    writeFileSync(join(dir, 'bin', command), mock, { mode: 0o755 })
  }
  try {
    const result = spawnSync(bash, [posix(join(dir, 'deploy.sh')), 'new-api', 'new-web', sha], {
      encoding: 'utf8',
      env: { ...process.env, TEST_ROOT: root, SCENARIO: scenario },
    })
    assert.ifError(result.error)
    return {
      status: result.status,
      output: result.stdout + result.stderr,
      calls: readFileSync(join(dir, 'calls'), 'utf8'),
      state: readFileSync(join(dir, '.deployed-images.env'), 'utf8'),
      manifest: readFileSync(join(dir, 'infra/docker-compose.prod.yml'), 'utf8'),
      proxy: readFileSync(join(dir, 'infra/Caddyfile'), 'utf8'),
      proxyLoaded: existsSync(join(dir, 'proxy-loaded'))
        ? readFileSync(join(dir, 'proxy-loaded'), 'utf8')
        : null,
      migrationUrl: existsSync(join(dir, 'migration-url'))
        ? readFileSync(join(dir, 'migration-url'), 'utf8')
        : null,
      unrelatedValue: existsSync(join(dir, 'unrelated-value'))
        ? readFileSync(join(dir, 'unrelated-value'), 'utf8')
        : null,
      injectedCommandRan: existsSync(join(dir, 'dotenv-executed')),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('successful backup permits migration, readiness and atomic release recording', () => {
  const result = deploy('success')
  assert.equal(result.status, 0, result.output)
  assert.ok(result.calls.indexOf('systemctl start') < result.calls.indexOf('docker pull'))
  assert.ok(result.calls.indexOf('cli-migrate.ts') < result.calls.indexOf(' api web caddy'))
  assert.match(result.state, /DEVON_API_IMAGE=new-api/)
  assert.match(result.state, new RegExp(sha))
  assert.equal(result.manifest, 'candidate manifest')
  assert.equal(result.proxyLoaded, 'candidate proxy')
  assert.ok(result.calls.indexOf('--force-recreate') > result.calls.indexOf(' api web caddy'))
})

for (const scenario of ['backup-failed', 'backup-start-failed', 'stopped', 'orphan-volume']) {
  test(`${scenario} refuses deployment before pulling or migrating`, () => {
    const result = deploy(scenario)
    assert.notEqual(result.status, 0)
    assert.doesNotMatch(result.calls, /docker pull|cli-migrate/)
    assert.equal(result.state, previous)
    assert.equal(result.manifest, 'previous manifest')
    if (scenario === 'backup-start-failed') assert.equal(result.status, 17)
  })
}

test('genuinely empty installation can proceed without a database backup', () => {
  const result = deploy('initial')
  assert.equal(result.status, 0, result.output)
  assert.doesNotMatch(result.calls, /systemctl start/)
  assert.equal(result.manifest, 'candidate manifest')
})

test('migration failure leaves previous application and release state untouched', () => {
  const result = deploy('migration-failed')
  assert.notEqual(result.status, 0)
  assert.doesNotMatch(result.calls, / api web caddy/)
  assert.equal(result.state, previous)
  assert.equal(result.manifest, 'previous manifest')
})

for (const scenario of ['rollout-failed', 'readiness-failed', 'proxy-failed']) {
  test(`${scenario} restores previous images and compose without marking new release successful`, () => {
    const result = deploy(scenario)
    assert.notEqual(result.status, 0)
    assert.match(result.calls, /previous-docker-compose.prod.yml.*api web caddy image=old-api/)
    assert.equal(result.state, previous)
    assert.equal(result.manifest, 'previous manifest')
    assert.equal(result.proxy, 'previous proxy')
    assert.equal(result.proxyLoaded, 'previous proxy')
  })
}

for (const [scenario, code] of [
  ['pull-failed', 42],
  ['data-tier-failed', 43],
]) {
  test(`${scenario} restores the persisted manifest and preserves the original exit code`, () => {
    const result = deploy(scenario)
    assert.equal(result.status, code, result.output)
    assert.doesNotMatch(result.calls, /cli-migrate| api web caddy/)
    assert.equal(result.state, previous)
    assert.equal(result.manifest, 'previous manifest')
  })
}

test('a failed first deployment without a prior manifest leaves the candidate file in place', () => {
  const result = deploy('pull-failed', { previousManifest: false })
  assert.equal(result.status, 42, result.output)
  assert.equal(result.manifest, 'candidate manifest')
})

test('dotenv values are data: spaces, shell substitutions and quoted punctuation never execute', () => {
  const migrationUrl =
    'postgres://dummy:$(touch dotenv-executed)`touch dotenv-executed`$word#part@fixture/db'
  const result = deploy('success', {
    dotenv: [
      '# Dotenv syntax must not be interpreted as shell syntax.',
      'DEVON_PUBLIC_URL="https://fixture.invalid" # supported comment',
      `MIGRATION_DATABASE_URL='${migrationUrl}'`,
      'TELEGRAM_WEBHOOK_SECRET=  dummy value with unquoted spaces  ',
      'DANGEROUS_DOTENV_VALUE=$(touch dotenv-executed); `touch dotenv-executed`',
      'export MULTILINE_DUMMY="first line',
      'second line"',
      '',
    ].join('\r\n'),
  })
  assert.equal(result.status, 0, result.output)
  assert.equal(result.migrationUrl, migrationUrl)
  assert.equal(result.unrelatedValue, 'not-exported')
  assert.equal(result.injectedCommandRan, false)
  assert.doesNotMatch(result.output, /postgres:\/\//)
  assert.match(result.calls, /https:\/\/fixture.invalid\/readyz/)
})

test('dotenv trims surrounding whitespace for the values used by deployment', () => {
  const result = deploy('success', {
    dotenv:
      'DEVON_PUBLIC_URL=  https://fixture.invalid  \nMIGRATION_DATABASE_URL=  postgres://dummy@fixture/db  \n',
  })
  assert.equal(result.status, 0, result.output)
  assert.equal(result.migrationUrl, 'postgres://dummy@fixture/db')
  assert.match(result.calls, /https:\/\/fixture.invalid\/readyz/)
})

for (const variable of ['MIGRATION_DATABASE_URL', 'DEVON_PUBLIC_URL']) {
  test(`missing ${variable} refuses deployment before backup, pull or migration`, () => {
    const dotenv =
      variable === 'MIGRATION_DATABASE_URL'
        ? 'DEVON_PUBLIC_URL=https://fixture.invalid\n'
        : 'MIGRATION_DATABASE_URL=postgres://dummy@fixture/db\n'
    const result = deploy('success', { dotenv })
    assert.equal(result.status, 78, result.output)
    assert.doesNotMatch(result.calls, /systemctl|docker pull|cli-migrate/)
    assert.equal(result.manifest, 'previous manifest')
    assert.equal(result.state, previous)
  })
}
