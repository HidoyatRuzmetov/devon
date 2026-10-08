import { Pool, type PoolConfig } from 'pg'

/** pg-pool resolves end() when its bookkeeping is empty, before every client's socket has ended.
 * Wait for those end events before the harness stops Postgres. Background errors fail the check
 * with a safe diagnostic rather than an uncaught EventEmitter error dumping client credentials. */
export function createCheckPool(options: PoolConfig): { pool: Pool; close(): Promise<void> } {
  const pool = new Pool(options)
  const connections = new Set<Promise<void>>()
  const errors: string[] = []
  pool.on('connect', (client) => {
    const closed = new Promise<void>((resolve) => client.once('end', resolve))
    connections.add(closed)
    void closed.then(() => connections.delete(closed))
  })
  pool.on('error', (error: Error & { code?: string }) => {
    errors.push(error.code ?? 'unknown')
  })
  let closing: Promise<void> | undefined
  return {
    pool,
    close() {
      closing ??= (async () => {
        try {
          await pool.end()
        } finally {
          await Promise.all(connections)
        }
        if (errors.length) throw new Error(`check pool background error (${errors.join(', ')})`)
      })()
      return closing
    },
  }
}
