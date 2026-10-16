// Test-only Docker cleanup shared by the API and migration fixtures. Testcontainers 12.1.0
// normally stops with a zero-second grace period and immediately removes without force. Docker
// can still report the process as running at that removal boundary (HTTP 409).
const SESSION_LABEL = 'org.testcontainers.session-id'
const RECOVERY_TIMEOUT_MS = 10_000

function isRunningRemovalConflict(error) {
  return (
    error?.statusCode === 409 &&
    /cannot remove container .*container is running: stop the container before removing or force remove/i.test(
      error.message ?? '',
    )
  )
}

/** Normal stop first; recover only Docker's specific running-at-removal race, for this exact owned
 * fixture. No container enumeration, prune, assertion retry, or suppression of other Docker errors. */
export async function stopTestContainer(fixture, getRuntimeClient) {
  try {
    await fixture.stop({ timeout: 10_000, remove: true, removeVolumes: true })
    return
  } catch (error) {
    if (!isRunningRemovalConflict(error)) throw error

    const id = fixture.getId()
    const sessionId = fixture.getLabels()[SESSION_LABEL]
    if (!/^[a-f0-9]{64}$/.test(id) || !sessionId) {
      throw new Error(
        'Refusing Docker cleanup recovery without a full fixture ID and session label',
        {
          cause: error,
        },
      )
    }

    const client = await getRuntimeClient()
    const container = client.container.getById(id)
    const abortSignal = AbortSignal.timeout(RECOVERY_TIMEOUT_MS)
    let inspected
    try {
      inspected = await container.inspect({ abortSignal })
    } catch (inspectError) {
      // Ryuk may already have removed this exact fixture after the failed normal removal.
      if (inspectError?.statusCode === 404) return
      throw inspectError
    }
    if (
      inspected.Id !== id ||
      inspected.Config.Labels?.['org.testcontainers'] !== 'true' ||
      inspected.Config.Labels?.[SESSION_LABEL] !== sessionId
    ) {
      throw new Error(`Refusing Docker cleanup recovery: fixture ownership mismatch for ${id}`, {
        cause: error,
      })
    }

    try {
      // One bounded removal, with force only if Docker still reports this owned fixture running.
      await container.remove({ force: inspected.State.Running, v: true, abortSignal })
    } catch (removeError) {
      if (removeError?.statusCode !== 404) throw removeError
    }
    console.warn(`Recovered Docker running-at-removal cleanup conflict for test fixture ${id}`)
  }
}

/** Dependent fixture resources close in order, but a failed server close must not leak its database
 * or network. Preserve every failure instead of hiding it behind a later cleanup error. */
export async function cleanupFixtures(...steps) {
  const errors = []
  for (let i = 0; i < steps.length; i += 1) {
    try {
      await steps[i]()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, 'Multiple test fixture cleanup failures')
}
