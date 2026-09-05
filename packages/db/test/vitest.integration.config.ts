import { defineConfig } from 'vitest/config'

// Testcontainers-backed suites (needs Docker). Run via `pnpm --filter @devon/db migrate:verify`, which
// is what the `migrate` gate calls -- never part of `test:unit` / the fast/item gate profiles.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // Each integration file starts its own Postgres (+ PgBouncer, for rls.isolation) container; run
    // files in parallel processes so Docker start-up cost is paid once per file, concurrently.
    fileParallelism: true,
  },
})
