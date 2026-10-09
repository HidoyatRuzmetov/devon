import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const webDirectory = fileURLToPath(new URL('../../apps/web/', import.meta.url))
const specsDirectory = fileURLToPath(new URL('../../apps/web/test/e2e/', import.meta.url))
const playwright = fileURLToPath(
  new URL('../../apps/web/node_modules/@playwright/test/cli.js', import.meta.url),
)

function list(config) {
  const result = spawnSync(
    process.execPath,
    [playwright, 'test', '--config', `test/e2e/${config}`, '--list'],
    {
      cwd: webDirectory,
      env: { ...process.env, FLOW_REALTIME: '1' },
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  )
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result.stdout
}

function files(output) {
  return [
    ...new Set(
      [...output.matchAll(/› ([a-z0-9-]+\.(?:flow|smoke|qa)\.spec\.ts):/g)].map((row) => row[1]),
    ),
  ].sort()
}

test('ordinary CI discovers every fresh flow/smoke file and no seeded dedicated QA file', () => {
  const output = list('playwright.config.ts')
  const expected = readdirSync(specsDirectory)
    .filter((name) => /\.(?:flow|smoke)\.spec\.ts$/.test(name))
    .sort()
  assert.deepEqual(files(output), expected)
  assert.equal(output.includes('.qa.spec.ts:'), false)
  for (const required of [
    'register-department-join.flow.spec.ts',
    'board-move.flow.spec.ts',
    'group-project.flow.spec.ts',
    'sprint-pomodoro.flow.spec.ts',
    'event-carpool-poll.flow.spec.ts',
    'admin-pause.flow.spec.ts',
    'accessibility.flow.spec.ts',
    'shell.smoke.spec.ts',
  ])
    assert.ok(files(output).includes(required), `required CI flow missing: ${required}`)
})

test('dedicated canvas config retains renamed seeded cases in all three browser engines', () => {
  const output = list('canvas-controls.config.ts')
  assert.deepEqual(files(output), [
    'canvas-controls.qa.spec.ts',
    'platform-personal-canvas.qa.spec.ts',
  ])
  for (const engine of ['chromium', 'firefox', 'webkit']) {
    assert.equal(
      output
        .split('\n')
        .filter(
          (line) => line.includes(`[${engine}]`) && line.includes('canvas-controls.qa.spec.ts:'),
        ).length,
      9,
      `${engine}: all nine existing canvas cases must remain selected`,
    )
  }
})

test('dedicated broker configs still select their explicit seeded journeys', () => {
  assert.deepEqual(files(list('management-qa.config.ts')), ['management-controls.qa.spec.ts'])
  const realtime = files(list('realtime-qa.config.ts'))
  assert.deepEqual(realtime, [
    'platform-realtime-scope.qa.spec.ts',
    'realtime-board.qa.spec.ts',
    'realtime-publisher.qa.spec.ts',
  ])
})
