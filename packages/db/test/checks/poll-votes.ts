// H10.1 "RSVP/seat/poll races tested with parallel requests" -- backs `migrate:verify`'s 8th step.
// Exercises the exact SQL shape `apps/api/src/modules/events/repo.ts`'s `replacePollVotes` runs
// (`0902_poll_votes_idempotency.sql`'s partial unique indexes + the `pg_advisory_xact_lock` added
// alongside them) directly against a real Postgres under genuine concurrency -- `packages/db` cannot
// import `apps/api` (a workspace boundary, not just a style preference: this package has no
// dependency on it), so this reimplements the same delete-then-insert-under-advisory-lock statement
// shape rather than the higher-level repo function, to prove the database-level guarantee those two
// migrations/that function rely on actually holds under load, independent of the caller.
import { Client, Pool } from 'pg'
import type { CheckResult } from './types.js'

export type SeededPoll = {
  departmentId: string
  pollId: string
  optionAId: string
  optionBId: string
  voterUserIds: string[]
}

/** One department, one open poll with two options, and `voterCount` members -- everything a vote race
 * needs, seeded directly as superuser (bypasses RLS, which is not what this check is about). */
export async function seedPoll(
  superuserConnectionString: string,
  voterCount: number,
): Promise<SeededPoll> {
  const client = new Client({ connectionString: superuserConnectionString })
  await client.connect()
  try {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const dept = await client.query<{ id: string }>(
      `insert into app.departments (name, slug) values ($1, $2) returning id`,
      [`Poll race ${suffix}`, `poll-race-${suffix}`],
    )
    const departmentId = dept.rows[0]!.id
    const creator = await client.query<{ id: string }>(
      `insert into app.users (login, password_hash, given_name, family_name)
       values ($1, 'x', 'Poll', 'Creator') returning id`,
      [`poll-race-creator-${suffix}`],
    )
    const creatorId = creator.rows[0]!.id
    const poll = await client.query<{ id: string }>(
      `insert into app.polls (department_id, kind, question, created_by_user_id)
       values ($1, 'single', 'Race test?', $2) returning id`,
      [departmentId, creatorId],
    )
    const pollId = poll.rows[0]!.id
    const optA = await client.query<{ id: string }>(
      `insert into app.poll_options (department_id, poll_id, label, sort_order) values ($1, $2, 'A', 0) returning id`,
      [departmentId, pollId],
    )
    const optB = await client.query<{ id: string }>(
      `insert into app.poll_options (department_id, poll_id, label, sort_order) values ($1, $2, 'B', 1) returning id`,
      [departmentId, pollId],
    )
    const voterUserIds: string[] = []
    for (let i = 0; i < voterCount; i += 1) {
      const voter = await client.query<{ id: string }>(
        `insert into app.users (login, password_hash, given_name, family_name)
         values ($1, 'x', 'Voter', $2) returning id`,
        [`poll-race-voter-${suffix}-${i}`, String(i)],
      )
      voterUserIds.push(voter.rows[0]!.id)
      await client.query(
        `insert into app.memberships (department_id, user_id, role) values ($1, $2, 'member')`,
        [departmentId, voter.rows[0]!.id],
      )
    }
    return {
      departmentId,
      pollId,
      optionAId: optA.rows[0]!.id,
      optionBId: optB.rows[0]!.id,
      voterUserIds,
    }
  } finally {
    await client.end()
  }
}

/** The exact statement shape `replacePollVotes` runs for one (poll, voter) "vote for these options"
 * call: an advisory lock scoped to that pair, then delete-then-insert inside one transaction. */
async function castVote(
  pool: Pool,
  poll: SeededPoll,
  userId: string,
  optionIds: string[],
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    // Matches `withContext()`'s own per-transaction `set_config(..., true)` calls (`src/context.ts`)
    // -- the RLS policies on `app.poll_votes`/`app.poll_options` require `app.department_id` to be
    // set to this transaction's department before any row is visible or writable, and `true`
    // (transaction-local) is what makes this PgBouncer-transaction-pooling-safe (H3.3).
    await client.query(
      `select set_config('app.request_id', $1, true),
              set_config('app.user_id', $2, true),
              set_config('app.actor_role', $3, true),
              set_config('app.department_id', $4, true),
              set_config('app.view_as', $5, true)`,
      ['poll-race-check', userId, 'member', poll.departmentId, 'false'],
    )
    await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `${poll.pollId}:u:${userId}`,
    ])
    await client.query(`delete from app.poll_votes where poll_id = $1 and user_id = $2`, [
      poll.pollId,
      userId,
    ])
    // One bulk multi-row INSERT (H3.2), not a query-per-option loop -- matches `replacePollVotes`'s
    // own `unnest`-based bulk insert for the same "one voter, possibly several selected options" shape.
    const valueRows = optionIds
      .map((_, i) => `($1, $2, $${3 + i}, $${3 + optionIds.length})`)
      .join(', ')
    await client.query(
      `insert into app.poll_votes (department_id, poll_id, option_id, user_id) values ${valueRows}`,
      [poll.departmentId, poll.pollId, ...optionIds, userId],
    )
    await client.query('commit')
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function runPollVoteRaceChecks(
  appConnectionString: string,
  superuserConnectionString: string,
): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  const pool = new Pool({ connectionString: appConnectionString, max: 25 })
  try {
    // Check 1: the SAME voter firing N concurrent "replace my vote" calls (a double-click, two open
    // tabs) must never leave more than one row for that voter on this poll -- the advisory lock
    // serialises them, so the last one committed wins outright, not an interleaved mix of both.
    {
      const poll = await seedPoll(superuserConnectionString, 1)
      const voterId = poll.voterUserIds[0]!
      const attempts = 20
      const outcomes = await Promise.allSettled(
        Array.from({ length: attempts }, (_, i) =>
          castVote(pool, poll, voterId, [i % 2 === 0 ? poll.optionAId : poll.optionBId]),
        ),
      )
      const rejected = outcomes.filter((o) => o.status === 'rejected')
      const superuserClient = new Client({ connectionString: superuserConnectionString })
      await superuserClient.connect()
      let rowCount = -1
      try {
        const rows = await superuserClient.query<{ n: string }>(
          `select count(*)::text as n from app.poll_votes where poll_id = $1 and user_id = $2`,
          [poll.pollId, voterId],
        )
        rowCount = Number(rows.rows[0]!.n)
      } finally {
        await superuserClient.end()
      }
      results.push({
        name: `${attempts} concurrent re-votes from the same voter leave exactly one row (no deadlock, no duplicate)`,
        ok: rejected.length === 0 && rowCount === 1,
        detail:
          rejected.length > 0
            ? `${rejected.length}/${attempts} calls rejected: ${(rejected[0] as PromiseRejectedResult).reason}`
            : `final row count for this voter: ${rowCount} (expected 1)`,
      })
    }

    // Check 2: N DIFFERENT voters casting a concurrent vote for the same option must all land --
    // the partial unique indexes (one per voter, keyed by poll+option+user) never collide across
    // different users, so no vote is lost to a false "duplicate" and none silently overwrites another.
    {
      const voterCount = 20
      const poll = await seedPoll(superuserConnectionString, voterCount)
      const outcomes = await Promise.allSettled(
        poll.voterUserIds.map((userId) => castVote(pool, poll, userId, [poll.optionAId])),
      )
      const rejected = outcomes.filter((o) => o.status === 'rejected')
      const superuserClient = new Client({ connectionString: superuserConnectionString })
      await superuserClient.connect()
      let rowCount = -1
      try {
        const rows = await superuserClient.query<{ n: string }>(
          `select count(*)::text as n from app.poll_votes where poll_id = $1 and option_id = $2`,
          [poll.pollId, poll.optionAId],
        )
        rowCount = Number(rows.rows[0]!.n)
      } finally {
        await superuserClient.end()
      }
      results.push({
        name: `${voterCount} different voters concurrently voting the same option all land (no lost votes)`,
        ok: rejected.length === 0 && rowCount === voterCount,
        detail:
          rejected.length > 0
            ? `${rejected.length}/${voterCount} calls rejected: ${(rejected[0] as PromiseRejectedResult).reason}`
            : `final vote count for this option: ${rowCount} (expected ${voterCount})`,
      })
    }

    return results
  } finally {
    await pool.end()
  }
}
