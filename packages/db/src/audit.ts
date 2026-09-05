// Audit helpers (I-5, I-5a, I-8). `context.ts` owns the transaction lifecycle and calls into this
// module to redact and insert; this module owns the redaction rule and the SQL, so both are visible
// in one place instead of smeared across the transaction wrapper.
import type { PoolClient } from 'pg'
import type { Role } from './context.js'
import { USER_FIELD_TIER_SQL } from './tiers.js'

export type AuditEventInput = {
  /** `'<domain>.<verb>'`, e.g. `'session.created'`, `'access.denied'`, `'setup.completed'`. */
  action: `${string}.${string}`
  subjectType: string
  subjectId: string | null
  /** Defaults to the request's own department when omitted. */
  departmentId?: string | null
  before?: unknown
  after?: unknown
}

export type PrivateReadInput = {
  subjectUserId: string
  fields: string[]
}

type ActorContext = {
  requestId: string
  userId: string | null
  actorRole: Role | null
  departmentId: string | null
  actingForUserId: string | null
  ip: string
  userAgent: string
}

const SECRET_FIELD_NAMES = new Set(
  Object.entries(USER_FIELD_TIER_SQL)
    .filter(([, tier]) => tier === 'secret')
    .map(([field]) => field),
)

/** Redacts any `secret`-tier field name (H1.11), recursively. Unknown-shaped payloads pass through
 * unchanged except for their secret keys -- this is a safety net, not a schema validator. */
export function redactAuditPayload(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(redactAuditPayload)
  if (typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_FIELD_NAMES.has(key) ? '[redacted]' : redactAuditPayload(v)
  }
  return out
}

export async function insertAuditEvent(
  client: PoolClient,
  ctx: ActorContext,
  event: AuditEventInput,
): Promise<void> {
  await client.query(
    `insert into audit.events
       (actor_user_id, actor_role, on_behalf_of, department_id, action, subject_type, subject_id,
        before, after, ip, user_agent, request_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      ctx.userId,
      ctx.actorRole,
      ctx.actingForUserId,
      event.departmentId ?? ctx.departmentId,
      event.action,
      event.subjectType,
      event.subjectId,
      event.before === undefined ? null : JSON.stringify(redactAuditPayload(event.before)),
      event.after === undefined ? null : JSON.stringify(redactAuditPayload(event.after)),
      ctx.ip || null,
      ctx.userAgent || null,
      ctx.requestId,
    ],
  )
}

export async function insertPrivateRead(
  client: PoolClient,
  ctx: ActorContext,
  input: PrivateReadInput,
): Promise<void> {
  await client.query(
    `insert into audit.private_reads (viewer_user_id, viewer_role, subject_user_id, fields, department_id, request_id)
     values ($1,$2,$3,$4,$5,$6)`,
    [ctx.userId, ctx.actorRole, input.subjectUserId, input.fields, ctx.departmentId, ctx.requestId],
  )
}

export type ChainVerification = {
  ok: boolean
  firstBadSeq: number | null
  failure: 'row_hash_mismatch' | 'prev_hash_mismatch' | null
  rowsChecked: number
}

/** Thin wrapper over the SQL `audit.verify_chain()` function (migrations/0002_audit.sql), usable
 * against any live client -- the migrate-gate immutability test and, later, the admin audit viewer. */
export async function verifyChain(
  client: Pick<PoolClient, 'query'>,
  opts: { fromSeq?: number; toSeq?: number | null } = {},
): Promise<ChainVerification> {
  const { rows } = await client.query<{
    ok: boolean
    first_bad_seq: string | number | null
    failure: ChainVerification['failure']
    rows_checked: string | number
  }>('select * from audit.verify_chain($1, $2)', [opts.fromSeq ?? 1, opts.toSeq ?? null])
  const row = rows[0]
  if (!row) return { ok: true, firstBadSeq: null, failure: null, rowsChecked: 0 }
  return {
    ok: row.ok,
    firstBadSeq: row.first_bad_seq === null ? null : Number(row.first_bad_seq),
    failure: row.failure,
    rowsChecked: Number(row.rows_checked),
  }
}
