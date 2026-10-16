import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanupFixtures, stopTestContainer } from '../testcontainers-cleanup.mjs'

const id = 'a'.repeat(64)
const sessionLabel = 'org.testcontainers.session-id'
const labels = { 'org.testcontainers': 'true', [sessionLabel]: 'owned-session' }
const conflict = () =>
  Object.assign(
    new Error(
      '(HTTP code 409) unexpected - cannot remove container "/fixture": container is running: stop the container before removing or force remove',
    ),
    { statusCode: 409 },
  )

function fixture(stop) {
  return { getId: () => id, getLabels: () => labels, stop }
}

function runtime({
  inspected = { Id: id, Config: { Labels: labels }, State: { Running: true } },
  inspectError,
  removeError,
} = {}) {
  const calls = []
  return {
    calls,
    getClient: async () => ({
      container: {
        getById(actualId) {
          calls.push(['getById', actualId])
          return {
            async inspect(options) {
              calls.push(['inspect', options])
              if (inspectError) throw inspectError
              return inspected
            },
            async remove(options) {
              calls.push(['remove', options])
              if (removeError) throw removeError
            },
          }
        },
      },
    }),
  }
}

test('normal cleanup gives PostgreSQL a grace period and never opens the recovery path', async () => {
  let stops = 0
  await stopTestContainer(
    fixture(async (options) => {
      stops += 1
      assert.deepEqual(options, { timeout: 10_000, remove: true, removeVolumes: true })
    }),
    async () => assert.fail('normal cleanup must not access Docker directly'),
  )
  assert.equal(stops, 1)
})

test('the exact running-at-removal 409 gets one bounded removal of only its owned full ID', async () => {
  const recovery = runtime()
  let stops = 0
  await stopTestContainer(
    fixture(async () => {
      stops += 1
      throw conflict()
    }),
    recovery.getClient,
  )
  assert.equal(stops, 1)
  assert.deepEqual(
    recovery.calls.map(([name]) => name),
    ['getById', 'inspect', 'remove'],
  )
  assert.equal(recovery.calls[0][1], id)
  const inspectOptions = recovery.calls[1][1]
  const removeOptions = recovery.calls[2][1]
  assert.ok(inspectOptions.abortSignal instanceof AbortSignal)
  assert.equal(removeOptions.abortSignal, inspectOptions.abortSignal)
  assert.equal(removeOptions.force, true)
  assert.equal(removeOptions.v, true)
})

test('a process already stopped by inspection does not require forced deletion', async () => {
  const recovery = runtime({
    inspected: { Id: id, Config: { Labels: labels }, State: { Running: false } },
  })
  await stopTestContainer(
    fixture(async () => {
      throw conflict()
    }),
    recovery.getClient,
  )
  assert.equal(recovery.calls[2][1].force, false)
})

test('unrelated 409s, Docker failures and application errors propagate without recovery or retry', async () => {
  const errors = [
    Object.assign(new Error('container removal is already in progress'), { statusCode: 409 }),
    Object.assign(new Error('Docker unavailable'), { statusCode: 500 }),
    Object.assign(new Error('not found during normal stop'), { statusCode: 404 }),
    new Error('application assertion failed'),
  ]
  await Promise.all(
    errors.map(async (error) => {
      let stops = 0
      await assert.rejects(
        stopTestContainer(
          fixture(async () => {
            stops += 1
            throw error
          }),
          async () => assert.fail('unrelated errors must not enter recovery'),
        ),
        (actual) => actual === error,
      )
      assert.equal(stops, 1)
    }),
  )
})

test('recovery refuses a short ID or a missing session label before obtaining a Docker client', async () => {
  await Promise.all(
    [
      {
        ...fixture(async () => {
          throw conflict()
        }),
        getId: () => 'abc123',
      },
      {
        ...fixture(async () => {
          throw conflict()
        }),
        getLabels: () => ({}),
      },
    ].map(async (target) => {
      await assert.rejects(
        stopTestContainer(target, async () => assert.fail('invalid ownership')),
        /full fixture ID and session label/,
      )
    }),
  )
})

test('recovery rejects an ID or session ownership mismatch without removing anything', async () => {
  const inspectedValues = [
    { Id: 'b'.repeat(64), Config: { Labels: labels }, State: { Running: true } },
    {
      Id: id,
      Config: { Labels: { ...labels, [sessionLabel]: 'some-other-suite' } },
      State: { Running: true },
    },
    { Id: id, Config: { Labels: null }, State: { Running: true } },
  ]
  await Promise.all(
    inspectedValues.map(async (inspected) => {
      const recovery = runtime({ inspected })
      await assert.rejects(
        stopTestContainer(
          fixture(async () => {
            throw conflict()
          }),
          recovery.getClient,
        ),
        /ownership mismatch/,
      )
      assert.equal(recovery.calls.filter(([name]) => name === 'remove').length, 0)
    }),
  )
})

test('only proven disappearance of this exact fixture during recovery is accepted', async () => {
  const missing = Object.assign(new Error('no such container'), { statusCode: 404 })
  await Promise.all(
    [runtime({ inspectError: missing }), runtime({ removeError: missing })].map(
      async (recovery) => {
        await stopTestContainer(
          fixture(async () => {
            throw conflict()
          }),
          recovery.getClient,
        )
      },
    ),
  )
})

test('inspection, authorization and forced-removal errors remain failures with no second retry', async () => {
  const errors = [
    Object.assign(new Error('Docker authorization refused'), { statusCode: 403 }),
    Object.assign(new Error('still conflicting'), { statusCode: 409 }),
    new DOMException('cleanup timed out', 'TimeoutError'),
  ]
  await Promise.all(
    errors.flatMap((error) =>
      ['inspectError', 'removeError'].map(async (phase) => {
        const recovery = runtime({ [phase]: error })
        await assert.rejects(
          stopTestContainer(
            fixture(async () => {
              throw conflict()
            }),
            recovery.getClient,
          ),
          (actual) => actual === error,
        )
        assert.ok(recovery.calls.filter(([name]) => name === 'remove').length <= 1)
      }),
    ),
  )
})

test('server failure still closes dependent database and network, retaining all errors in order', async () => {
  const serverError = new Error('server close failed')
  const databaseError = new Error('database removal failed')
  const calls = []
  await assert.rejects(
    cleanupFixtures(
      async () => {
        calls.push('server')
        throw serverError
      },
      async () => {
        calls.push('database')
        throw databaseError
      },
      async () => {
        calls.push('network')
      },
    ),
    (error) => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [serverError, databaseError])
      return true
    },
  )
  assert.deepEqual(calls, ['server', 'database', 'network'])
  await assert.rejects(
    cleanupFixtures(
      async () => {
        throw serverError
      },
      async () => {},
    ),
    (error) => error === serverError,
  )
})
