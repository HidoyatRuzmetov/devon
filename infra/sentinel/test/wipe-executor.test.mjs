import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeWipe } from '../src/wipe-executor.mjs'

function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'devon-wipe-test-'))
  const projectRoot = join(root, 'project')
  mkdirSync(projectRoot, { recursive: true })
  writeFileSync(join(projectRoot, 'marker.txt'), 'still here')
  return {
    root,
    config: {
      composeFile: join(projectRoot, 'infra', 'docker-compose.yml'),
      projectRoot,
      wipeLogPath: join(root, 'devon-wipe.log'),
    },
  }
}

test('removes the project root and logs "wiped at ... by <actor>" on success', () => {
  const { root, config } = makeWorkspace()
  try {
    const calls = []
    const deps = { execFileSync: (cmd, args) => calls.push([cmd, ...args]) }

    const result = executeWipe(config, { actor: 'root@example' }, deps)

    assert.equal(result.ok, true)
    assert.deepEqual(calls, [
      ['docker', 'compose', '-f', config.composeFile, 'down', '--volumes', '--rmi', 'all'],
    ])
    assert.equal(existsSync(config.projectRoot), false, 'project root should be gone')
    const log = readFileSync(config.wipeLogPath, 'utf8')
    assert.match(log, /^wiped at .+ by root@example\n$/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('still removes the project root even when `docker compose down` itself fails', () => {
  const { root, config } = makeWorkspace()
  try {
    const deps = {
      execFileSync: () => {
        throw new Error('docker: command not found')
      },
    }

    const result = executeWipe(config, {}, deps)

    assert.equal(result.ok, true)
    assert.ok(result.steps.some((s) => s.startsWith('compose-down-warning:')))
    assert.equal(existsSync(config.projectRoot), false)
    const log = readFileSync(config.wipeLogPath, 'utf8')
    assert.match(log, /^wiped at .+ by unknown\n$/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an unsanitary actor string cannot inject extra log lines', () => {
  const { root, config } = makeWorkspace()
  try {
    const deps = { execFileSync: () => {} }
    executeWipe(config, { actor: 'evil\nwiped at FAKE by nobody' }, deps)
    const log = readFileSync(config.wipeLogPath, 'utf8')
    assert.equal(log.split('\n').filter(Boolean).length, 1, 'exactly one log line, newline stripped')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
