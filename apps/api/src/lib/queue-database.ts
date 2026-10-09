import { z } from 'zod'
import type { DatabaseOptions } from 'pg-boss'

// PgBoss forwards max to its own pg.Pool; DB_POOL_MAX controls only @devon/db's pool.
// Preserve the existing pg default in production. Guarded local QA sets this to two while
// retaining every real worker and its separate LISTEN connection.
export const queuePoolMaxSchema = z.coerce.number().int().min(1).max(100).default(10)

export function queueDatabaseOptions(
  connectionString: string,
  env: NodeJS.ProcessEnv = process.env,
): DatabaseOptions {
  return { connectionString, max: queuePoolMaxSchema.parse(env['QUEUE_DB_POOL_MAX']) }
}
