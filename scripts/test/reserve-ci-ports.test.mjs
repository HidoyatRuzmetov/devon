import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { FIXTURE_PORTS, portSet, reserveFixturePorts } from '../reserve-ci-ports.mjs'

test('preserves existing reservations, accepts kernel-normalized ranges and verifies read-back', () => {
  const calls = []
  let reads = 0
  reserveFixturePorts((command, args) => {
    calls.push([command, args])
    return command === 'sudo' ? '' : ++reads === 1 ? '8080,48900-48910\n' : '8080,48900-49100\n'
  })
  assert.deepEqual(calls[1], [
    'sudo',
    ['-n', 'sysctl', '-q', '-w', 'net.ipv4.ip_local_reserved_ports=8080,48900-48910,48900-49100'],
  ])
  assert.equal(reads, 2)
  assert.throws(
    () => reserveFixturePorts((command) => (command === 'sudo' ? '' : '8080')),
    /read-back/,
  )
  assert.throws(
    () =>
      reserveFixturePorts(() => {
        throw new Error('sysctl denied')
      }),
    /sysctl denied/,
  )
  for (const value of ['-1', '1-65536', '9-8', '1,,2', 'invalid'])
    assert.throws(() => portSet(value), /Invalid reserved-port/)
})

test('all CI browser fixture ports are reserved before dependency installation', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const ports = [...workflow.matchAll(/FLOW_(?:API|WEB|CENTRIFUGO|CLAMAV)_PORT=(\d+)/g)]
  assert.ok(ports.length > 10)
  for (const [, port] of ports) assert.ok(portSet(FIXTURE_PORTS).has(Number(port)), port)
  const setup = readFileSync(
    new URL('../../.github/actions/ci-setup/action.yml', import.meta.url),
    'utf8',
  )
  assert.ok(setup.indexOf('node scripts/reserve-ci-ports.mjs') < setup.indexOf('pnpm install'))
})
