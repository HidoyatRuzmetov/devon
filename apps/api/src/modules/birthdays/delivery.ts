import type { RequestContext } from '@devon/db'
import { randomUUID } from 'node:crypto'

export function birthdayWorkerContext(
  departmentId: string,
  userId: string | null = null,
): RequestContext {
  return {
    requestId: randomUUID(),
    userId,
    actorRole: 'super_admin',
    departmentId,
    departmentRole: 'head',
    actingForUserId: null,
    viewAs: false,
    ip: '127.0.0.1',
    userAgent: 'devon-birthdays/scheduler',
  }
}

/** A timeout may have delivered a message. Retry only explicit no-send results. */
export function birthdaySendDisposition(error: string): 'pending' | 'failed' | 'uncertain' {
  // grammY wraps the Bot API status in parentheses. Network-error text can contain
  // the same digits (a chat ID or elapsed time) without proving rejection.
  const code = /(?:^|\()(\d{3}):/.exec(error)?.[1]
  if (error === 'telegram_not_configured' || error === 'telegram_unavailable' || code === '429')
    return 'pending'
  if (
    code === '400' ||
    code === '403' ||
    /bot was blocked|chat not found|user is deactivated/i.test(error)
  )
    return 'failed'
  return 'uncertain'
}
