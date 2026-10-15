import { sql } from 'drizzle-orm'
import type { Tx } from '@devon/db'

/** A profile/photo belongs to the person across departments. Publish only their id to each
 * active membership's channel so colleagues re-read their authorized roster; never copy PII. */
export async function emitIdentityUpdated(
  tx: Tx,
  userId: string,
  type: 'accounts.profile.updated' | 'accounts.user.avatar_updated',
): Promise<void> {
  const memberships = await tx.raw<{ department_id: string }>(sql`
    select distinct department_id from app.memberships
    where user_id = ${userId} and status = 'active'
  `)
  const departments = memberships.length > 0 ? memberships.map((row) => row.department_id) : [null]
  for (const departmentId of departments) {
    if (type === 'accounts.profile.updated') {
      tx.emit({ type: 'accounts.profile.updated', departmentId, payload: { userId } })
    } else {
      tx.emit({ type: 'accounts.user.avatar_updated', departmentId, payload: { userId } })
    }
  }
}
