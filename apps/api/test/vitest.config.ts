import { mergeConfig, defineConfig } from 'vitest/config'
import base from '../../../packages/config/vitest/base.ts'

// `test/unit/**` is built against an injected `Deps` bag (see `src/deps.ts`) and never touches
// Postgres. `test/integration/**` (hardening pass, H1.2/H1.3/H1.6/H1.9/H1.16/H10.1/H25.1) is the one
// deliberate exception: those files need a real, migrated Postgres (Testcontainers) to prove RLS/
// department-scoping and real transaction concurrency honestly -- a fake in-memory store cannot get a
// race wrong, so it cannot prove one is actually prevented. Each integration file starts its own
// container in its own `beforeAll` (`test/integration/harness.ts`, reusing the exact same
// `test/checks/pg-fixture.ts`/`server-fixture.ts` the `*:prove` scripts already use) -- run with
// `fileParallelism` so Docker start-up cost is paid once per file, concurrently, and with a generous
// timeout (Testcontainers pulling/starting Postgres can take longer than this package's other,
// in-memory unit tests ever need). Requires Docker Desktop running locally; CI must have it too.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts'],
      environment: 'node',
      testTimeout: 180_000,
      hookTimeout: 180_000,
      fileParallelism: true,
      coverage: {
        include: ['src/**/*.ts'],
      },
    },
  }),
)
