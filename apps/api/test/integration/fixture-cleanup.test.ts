import { getContainerRuntimeClient } from 'testcontainers'
import { Client } from 'pg'
import { expect, it } from 'vitest'
import { cleanupFixtures, stopTestContainer } from '../../../../scripts/testcontainers-cleanup.mjs'
import { startProveDatabase, type ProveDatabase } from '../checks/pg-fixture.js'

it('recovers a real Docker running-removal conflict without touching another live fixture', async () => {
  const neighbour = await startProveDatabase()
  let neighbourRemoved = false
  let raced: ProveDatabase | undefined
  let racedRemoved = false
  let removalAttempts = 0
  let recoveries = 0
  try {
    const target = await startProveDatabase()
    raced = target
    const client = await getContainerRuntimeClient()
    const rawRaced = client.container.getById(target.container.getId())
    const rawNeighbour = client.container.getById(neighbour.container.getId())
    expect((await rawRaced.inspect()).State.Running).toBe(true)
    await stopTestContainer(
      {
        getId: () => target.container.getId(),
        getLabels: () => target.container.getLabels(),
        async stop() {
          removalAttempts += 1
          // Trigger the exact Docker API failure observed in CI, against a genuinely running
          // owned Postgres. The helper must recover the real daemon's 409, not a mocked error.
          await rawRaced.remove({ v: true })
        },
      },
      async () => {
        recoveries += 1
        return getContainerRuntimeClient()
      },
    )
    racedRemoved = true
    expect(removalAttempts).toBe(1)
    expect(recoveries).toBe(1)
    await expect(rawRaced.inspect()).rejects.toMatchObject({ statusCode: 404 })

    expect((await rawNeighbour.inspect()).State.Running).toBe(true)
    const probe = new Client({ connectionString: neighbour.superuserUrl })
    await probe.connect()
    try {
      expect((await probe.query('select 1 as alive')).rows).toEqual([{ alive: 1 }])
    } finally {
      await probe.end()
    }
    await neighbour.stop()
    neighbourRemoved = true
    await expect(rawNeighbour.inspect()).rejects.toMatchObject({ statusCode: 404 })
  } finally {
    await cleanupFixtures(
      async () => {
        if (raced && !racedRemoved) await raced.stop()
      },
      async () => {
        if (!neighbourRemoved) await neighbour.stop()
      },
    )
  }
})
