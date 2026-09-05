// Backs `test/integration/audit.immutability.test.ts` and `migrate:verify` (design §2.3, item AC-9).
import { Client, Pool } from 'pg'
import { verifyChain } from '../../src/audit.js'
import { grantsFor } from './introspect.js'
import type { CheckResult } from './types.js'

export async function runAuditImmutabilityChecks(
  superuserConnectionString: string,
  appConnectionString: string,
): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  const push = (name: string, ok: boolean, detail?: string) => results.push({ name, ok, detail })

  const superuser = new Client({ connectionString: superuserConnectionString })
  const app = new Client({ connectionString: appConnectionString })
  await superuser.connect()
  await app.connect()

  try {
    const grants = await grantsFor(superuser, 'audit', 'events', 'devon_app')
    push(
      'devon_app grants on audit.events are exactly INSERT, SELECT',
      [...grants].sort().join(',') === 'INSERT,SELECT',
      grants.join(','),
    )

    // devon_app can insert (I-5 requires this to work at all) and select.
    const seeded = await app.query<{ seq: string }>(
      `insert into audit.events (action, subject_type, subject_id) values ('probe.seed','probe','1') returning seq`,
    )
    push('devon_app can INSERT into audit.events', seeded.rows.length === 1)
    const selectBack = await app.query('select 1 from audit.events limit 1')
    push('devon_app can SELECT from audit.events', selectBack.rows.length === 1)

    const seedSeq = seeded.rows[0]!.seq

    // Three denials, as the application role, per AC-9's disproof (grants AND triggers, independently).
    const attempt = async (label: string, statement: string): Promise<boolean> => {
      try {
        await app.query(statement)
        return false
      } catch {
        return true
      }
    }
    push(
      'devon_app UPDATE on audit.events is denied',
      await attempt(
        'update',
        `update audit.events set subject_id = 'tampered' where seq = ${seedSeq}`,
      ),
    )
    push(
      'devon_app DELETE on audit.events is denied',
      await attempt('delete', `delete from audit.events where seq = ${seedSeq}`),
    )
    push(
      'devon_app TRUNCATE on audit.events is denied',
      await attempt('truncate', 'truncate audit.events'),
    )

    // 500-row concurrent chain build (design §2.7 step 5, §4(b)): the advisory lock in the trigger
    // must serialise these without corrupting the chain. A dedicated pool (real concurrent server
    // connections) is used here, not the shared single `app` client -- one client only queues queries
    // on one connection, which never actually contends on the lock.
    const CONCURRENT_ROWS = 500
    const before = await app.query<{ n: string }>('select count(*)::bigint as n from audit.events')
    const concurrentPool = new Pool({ connectionString: appConnectionString, max: 20 })
    try {
      await Promise.all(
        Array.from({ length: CONCURRENT_ROWS }, (_, i) =>
          concurrentPool.query(
            `insert into audit.events (action, subject_type, subject_id) values ('probe.concurrent','probe',$1)`,
            [String(i)],
          ),
        ),
      )
    } finally {
      await concurrentPool.end()
    }
    const after = await app.query<{ n: string }>('select count(*)::bigint as n from audit.events')
    const inserted = Number(after.rows[0]!.n) - Number(before.rows[0]!.n)
    push(
      `${CONCURRENT_ROWS} concurrent inserts all succeed (advisory-lock-serialised chain)`,
      inserted === CONCURRENT_ROWS,
      `inserted=${inserted}`,
    )

    const verifiedAfterConcurrency = await verifyChain(app)
    push(
      'audit.verify_chain() reports ok after the concurrent build',
      verifiedAfterConcurrency.ok,
      JSON.stringify(verifiedAfterConcurrency),
    )

    // Tamper out-of-band, as a superuser, the only way an UPDATE can reach this table at all: disable
    // the trigger, mutate, re-enable it (AC-9's own prescribed method -- grants do not block a
    // superuser, so the trigger is the only backstop against this class of actor, and we prove it
    // still catches the tamper even though it could not prevent it).
    const target = await app.query<{ seq: string }>(
      'select seq from audit.events order by seq asc limit 1',
    )
    const targetSeq = Number(target.rows[0]!.seq)
    await superuser.query('alter table audit.events disable trigger events_no_update')
    await superuser.query(
      `update audit.events set subject_id = 'TAMPERED-OUT-OF-BAND' where seq = $1`,
      [targetSeq],
    )
    await superuser.query('alter table audit.events enable trigger events_no_update')

    const verifiedAfterTamper = await verifyChain(app)
    push(
      'audit.verify_chain() reports exactly the tampered seq after an out-of-band UPDATE',
      verifiedAfterTamper.ok === false && verifiedAfterTamper.firstBadSeq === targetSeq,
      JSON.stringify({ ...verifiedAfterTamper, expectedSeq: targetSeq }),
    )
  } finally {
    await superuser.end()
    await app.end()
  }

  return results
}
