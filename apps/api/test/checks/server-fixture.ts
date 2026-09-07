// Boots the real app (real `createRepo()`, real Postgres) on an ephemeral loopback port for the
// `*:prove` scripts. `@devon/db`'s pool is lazy and reads `DATABASE_URL` from `process.env` on first
// use (its module-private `getPool()`), so that must be set before the first `withContext()` call --
// i.e. before `createRepo()`'s functions are ever invoked.
import { configurePool, closePool } from '@devon/db'
import { buildApp } from '../../src/app.js'
import { createRepo } from '../../src/db/repo.js'
import { loadConfig } from '../../src/config.js'
import type { ProveDatabase } from './pg-fixture.js'

export type ProveServer = {
  baseUrl: string
  deps: ReturnType<typeof createRepo>
  stop(): Promise<void>
}

/** `envOverrides`: extra env vars for `loadConfig` (e.g. `STORAGE_LOCAL_DIR` pointed at a temp
 * directory by `avatar-prove.ts`). */
export async function startProveServer(
  db: ProveDatabase,
  envOverrides: Record<string, string> = {},
): Promise<ProveServer> {
  configurePool(db.appUrl)
  const config = loadConfig({
    NODE_ENV: 'test',
    API_PORT: '3999', // unused: app.listen below always binds an ephemeral port (0)
    DEVON_PUBLIC_URL: 'http://127.0.0.1:5173',
    DATABASE_URL: db.appUrl,
    CSRF_SECRET: 'prove-script-csrf-secret-example-value',
    DEVON_SETUP_REMOTE: 'false',
    LOG_LEVEL: 'error',
    ...envOverrides,
  })
  const deps = createRepo()
  const app = await buildApp(deps, config)
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    deps,
    async stop() {
      await app.close()
      await closePool()
    },
  }
}
