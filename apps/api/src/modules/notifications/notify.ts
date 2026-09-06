// The one place "create a notification" and "fan it out to the channels its owner wants right now"
// happen together -- used by `events.ts` (a domain event just arrived) and `jobs.ts` (a scheduled
// reminder/digest fired). `insertNotification` alone never delivers (a read-only replay of history, a
// digest job re-summarizing, or a test seeding fixtures should never accidentally re-send a Telegram
// message), so every real "notify this person" call site goes through here instead.
import type { FastifyBaseLogger } from 'fastify'
import {
  insertNotification,
  systemAuditCtx,
  type NewNotification,
  type NotificationRow,
} from './repo.js'
import { deliverNotification } from './delivery.js'

export async function notifyUser(
  log: FastifyBaseLogger,
  input: NewNotification,
): Promise<NotificationRow> {
  const created = await insertNotification(systemAuditCtx(null), input)
  await deliverNotification(log, created, input.userId)
  return created
}
