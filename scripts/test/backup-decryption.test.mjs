import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
const posix = (path) =>
  path.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
const fixtureSecret = 'dummy-test-only-secret'

// Run the real scripts against mock executables, never Docker or a real backup/database.
function run(script, scenario, encrypted = true) {
  const dir = mkdtempSync(join(tmpdir(), 'devon-decrypt-test-'))
  const root = posix(dir)
  for (const path of ['infra/backup', 'bin', 'backups', 'scratch', 'reports']) {
    mkdirSync(join(dir, path), { recursive: true })
  }
  for (const file of [script, 'lib.sh']) {
    const source = readFileSync(new URL(`../../infra/backup/${file}`, import.meta.url), 'utf8')
    writeFileSync(
      join(dir, 'infra/backup', file),
      source
        .replaceAll('\r\n', '\n')
        .replace('set -euo pipefail', `set -euo pipefail\nexport PATH="${root}/bin:$PATH"`),
    )
  }
  writeFileSync(join(dir, 'infra/docker-compose.yml'), '  postgres:\n    image: fixture-postgres\n')
  writeFileSync(join(dir, 'calls'), '')
  const backup = `${root}/backups/devon-fixture-db-latest.dump${encrypted ? '.gpg' : ''}`
  writeFileSync(join(dir, 'backups', backup.split('/').at(-1)), 'synthetic backup')
  const mock = `#!/usr/bin/env bash
set -eu
name="\${0##*/}"
printf '%s %s\\n' "$name" "$*" >> "$TEST_ROOT/calls"
case "$name" in
  gpg)
    secret="$(cat)"
    [ "$secret" = dummy-test-only-secret ] || exit 91
    while [ "$#" -gt 0 ]; do
      if [ "$1" = --output ]; then shift; printf 'partial plaintext' > "$1"; fi
      shift
    done
    if [ "$SCENARIO" = decrypt-failed ]; then exit 23; fi ;;
  docker)
    if [[ "$*" == *' createdb '* ]] && [ "$SCENARIO" = create-failed ]; then exit 31; fi
    if [[ "$*" == *' pg_restore '* ]] && [ "$SCENARIO" = restore-failed ]; then exit 32; fi
    if [[ "$*" == *' psql '* ]]; then
      if [[ "$*" == *'information_schema.schemata'* ]]; then echo '1|1|10|4'; fi
    fi ;;
esac
`
  for (const command of ['gpg', 'docker']) {
    writeFileSync(join(dir, 'bin', command), mock, { mode: 0o755 })
  }
  try {
    const args = script === 'restore.sh' ? [backup, 'fixture-restored'] : []
    const result = spawnSync(bash, [`${root}/infra/backup/${script}`, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TEST_ROOT: root,
        SCENARIO: scenario,
        BACKUP_DIR: `${root}/backups`,
        DRILL_REPORT_DIR: `${root}/reports`,
        TMPDIR: `${root}/scratch`,
        POSTGRES_DB: 'fixture-db',
        POSTGRES_SUPERUSER_PASSWORD: 'dummy-db-password',
        BACKUP_ENCRYPTION_PASSPHRASE: fixtureSecret,
      },
    })
    assert.ifError(result.error)
    return {
      status: result.status,
      output: result.stdout + result.stderr,
      calls: readFileSync(join(dir, 'calls'), 'utf8'),
      scratch: readdirSync(join(dir, 'scratch')),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

for (const script of ['verify.sh', 'restore.sh', 'quarterly-drill.sh']) {
  for (const [scenario, status] of [
    ['success', 0],
    ['decrypt-failed', 23],
    ['create-failed', 31],
    ['restore-failed', 32],
  ]) {
    test(`${script}: ${scenario} protects passphrase and removes plaintext, preserving exit status`, () => {
      const result = run(script, scenario)
      assert.equal(result.status, status, result.output)
      assert.deepEqual(result.scratch, [])
      assert.ok(!result.calls.includes(fixtureSecret))
      assert.ok(!result.output.includes(fixtureSecret))
      assert.match(result.calls, /gpg .*--passphrase-fd 0/)
      if (scenario === 'decrypt-failed') assert.doesNotMatch(result.calls, /docker/)
      if (scenario === 'create-failed' || script === 'restore.sh') {
        assert.doesNotMatch(result.calls, / dropdb /)
      } else if (scenario !== 'decrypt-failed') {
        assert.match(result.calls, / dropdb /)
      }
    })
  }
  test(`${script}: unencrypted backups remain supported`, () => {
    const result = run(script, 'success', false)
    assert.equal(result.status, 0, result.output)
    assert.doesNotMatch(result.calls, /gpg/)
    assert.deepEqual(result.scratch, [])
  })
}
