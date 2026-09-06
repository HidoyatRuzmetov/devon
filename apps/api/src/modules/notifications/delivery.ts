// Fan-out from "a notification row now exists" to "the channels its owner asked for" (TECH-SPEC §7:
// inapp / telegram / email, per-type preferences, quiet hours). `inapp` needs no delivery step at all
// (the row itself *is* the inapp delivery -- the inbox reads `app.notifications` directly); this file
// is only about the Telegram leg today (email is a preference option with no transport wired up yet --
// TECH-SPEC does not ask for SMTP in this module, so `email` always records `skipped`).
import type { FastifyBaseLogger } from 'fastify'
import {
  getDepartmentQuietDefault,
  getPersonalQuietHours,
  getPrefs,
  recordDelivery,
  systemAuditCtx,
  type NotificationRow,
} from './repo.js'
import {
  isWithinQuietHours,
  resolveEffectiveQuietWindow,
  DEPARTMENT_QUIET_DEFAULT,
} from './quiet-hours.js'
import { sendTelegramNotification } from '../telegram/transport.js'
import { resolveTelegramChatId } from '../telegram/repo.js'

const DEPARTMENT_TIMEZONE = 'Asia/Tashkent' // every demo/real department defaults to this (TECH-SPEC §2.2); refined once department-level timezone is threaded through here.

function nowInDepartmentTz(): { minuteOfDay: number; isWeekend: boolean } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DEPARTMENT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date())
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? ''
  // Uzbekistan's week: Saturday-Sunday (TECH-SPEC §7's "+ weekends").
  const isWeekend = weekday === 'Sat' || weekday === 'Sun'
  return { minuteOfDay: hour * 60 + minute, isWeekend }
}

/** Delivers one freshly-created notification to every channel its owner's preferences enable right
 * now. Never throws: a Telegram outage or a not-yet-linked chat must never fail the write that created
 * the notification (the row already committed by the time this runs) -- every failure is recorded on
 * `notification_deliveries` instead. */
export async function deliverNotification(
  log: FastifyBaseLogger,
  notification: NotificationRow,
  userId: string,
): Promise<void> {
  try {
    const prefs = await getPrefs(userId)
    const telegramPref = prefs.find(
      (p) => p.reason === notification.reason && p.channel === 'telegram',
    )
    if (!telegramPref?.enabled || telegramPref.digestMode !== 'instant') return

    const chatId = await resolveTelegramChatId(userId)
    if (!chatId) return // not linked -- nothing to deliver, and nothing to record (no delivery was attempted)

    const departmentDefault = notification.departmentId
      ? await getDepartmentQuietDefault(notification.departmentId)
      : DEPARTMENT_QUIET_DEFAULT
    const personal = await getPersonalQuietHours(userId)
    const effective = resolveEffectiveQuietWindow(personal, departmentDefault)
    const { minuteOfDay, isWeekend } = nowInDepartmentTz()
    if (isWithinQuietHours(minuteOfDay, isWeekend, effective)) {
      await recordDelivery(systemAuditCtx(userId), {
        userId,
        notificationId: notification.id,
        channel: 'telegram',
        status: 'skipped',
        error: 'quiet_hours',
      })
      return
    }

    const result = await sendTelegramNotification(chatId, notification, userId)
    await recordDelivery(systemAuditCtx(userId), {
      userId,
      notificationId: notification.id,
      channel: 'telegram',
      status: result.ok ? 'sent' : 'failed',
      error: result.ok ? null : result.error,
    })
  } catch (err) {
    // Belt and suspenders on top of the try/catches above: a delivery bug must never surface as a
    // failure of the write that created the notification (the outbox handler that called this would
    // otherwise retry the whole event up to 5 times over an unrelated delivery bug).
    log.error({ err, notificationId: notification.id }, 'notifications: delivery fan-out failed')
  }
}
