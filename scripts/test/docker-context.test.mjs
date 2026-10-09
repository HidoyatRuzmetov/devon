import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import test from 'node:test'

const ignore = readFileSync(new URL('../../.dockerignore', import.meta.url), 'utf8')
const apiDockerfile = readFileSync(new URL('../../apps/api/Dockerfile', import.meta.url), 'utf8')
const image = /^ARG NODE_IMAGE=(node:22-alpine@sha256:[a-f0-9]{64})$/m.exec(apiDockerfile)?.[1]
assert.ok(image, 'fixture must use the repository pinned production base')

function buildContext(t, policy) {
  const directory = mkdtempSync(join(tmpdir(), 'devon-context-test-'))
  const identity = randomUUID().replaceAll('-', '')
  const tag = `devon-qa-context:${identity}`
  t.after(() => {
    assert.match(tag, /^devon-qa-context:[a-f0-9]{32}$/)
    const inspected = spawnSync(
      'docker',
      ['image', 'inspect', '--format', '{{ index .Config.Labels "devon.qa.context" }}', tag],
      { encoding: 'utf8' },
    )
    if (inspected.status === 0) {
      assert.equal(inspected.stdout.trim(), identity)
      assert.equal(spawnSync('docker', ['image', 'rm', tag]).status, 0)
    }
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'devon-context-test-'))
    rmSync(directory, { recursive: true, force: true })
  })
  for (const file of [
    'apps/api/src/server.ts',
    'apps/web/src/app.tsx',
    'infra/web/nginx.conf',
    'scripts/remote-deploy.sh',
    'packages/db/migrations/2005_event_telegram_deliveries.sql',
    'apps/web/test/e2e/.tmp/owned/session.json',
    'apps/api/test/.tmp/receipt.json',
    'artifacts/qa/video.mp4',
  ]) {
    mkdirSync(dirname(join(directory, file)), { recursive: true })
    writeFileSync(join(directory, file), 'synthetic context fixture only')
  }
  writeFileSync(join(directory, '.dockerignore'), policy)
  writeFileSync(
    join(directory, 'Dockerfile'),
    `FROM ${image}
COPY . /fixture
RUN test -f /fixture/apps/api/src/server.ts && test -f /fixture/apps/web/src/app.tsx && \\
    test -f /fixture/infra/web/nginx.conf && test -f /fixture/scripts/remote-deploy.sh && \\
    test -f /fixture/packages/db/migrations/2005_event_telegram_deliveries.sql && \\
    test ! -e /fixture/apps/web/test/e2e/.tmp/owned/session.json && \\
    test ! -e /fixture/apps/api/test/.tmp/receipt.json && test ! -e /fixture/artifacts/qa/video.mp4
`,
  )
  const result = spawnSync(
    'docker',
    ['build', '--pull=false', '--label', `devon.qa.context=${identity}`, '-t', tag, directory],
    { encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024 },
  )
  assert.equal(result.error, undefined)
  return { status: result.status, diagnostic: result.stdout + result.stderr }
}

test('real Docker context omits generated evidence and nested credentials while retaining build source', (t) => {
  const result = buildContext(t, ignore)
  assert.equal(result.status, 0, result.diagnostic)
})

test('removing the two explicit context exclusions exposes the synthetic files and fails the same guard', (t) => {
  const before = ignore.replace(/^\*\*\/\.tmp\r?\n/m, '').replace(/^artifacts\r?\n/m, '')
  assert.notEqual(before, ignore)
  const result = buildContext(t, before)
  assert.notEqual(
    result.status,
    0,
    'without those rules the synthetic credential/evidence files really enter COPY',
  )
})
