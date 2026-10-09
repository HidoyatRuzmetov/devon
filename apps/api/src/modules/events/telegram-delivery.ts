import { subscribe, type OutboxEventRecord } from '@devon/db'
import { z } from 'zod'
import { isMaintenanceActive } from '../notifications/repo.js'
import { isTelegramConfigured, publicUrl, sendPlainMessage } from '../telegram/transport.js'
import { DEFAULT_BOT_LOCALE, isBotLocale, tb } from '../telegram/templates.js'
import * as repo from './telegram-delivery-repo.js'

const EVENT_KINDS: Readonly<Record<string, 'events' | 'polls'>> = {
  'events.event.created': 'events',
  'events.event.updated': 'events',
  'events.event.cancelled': 'events',
  'events.event.reminder_due': 'events',
  'events.poll.created': 'polls',
}
const pointerSchema = z.object({ eventId: z.string().uuid(), pollId: z.string().uuid().optional() })
const MAX_ATTEMPTS = 8

function eventDate(date: Date, locale: string, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
    hourCycle: 'h23',
  }
  // Older event records may contain an invalid timezone string. Keep that one malformed field
  // from crashing the queue, while respecting the event's valid IANA timezone when provided.
  try {
    return new Intl.DateTimeFormat(locale, options).format(date)
  } catch {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'Asia/Tashkent' }).format(date)
  }
}

export async function queueEventGroupNotifications(event: OutboxEventRecord): Promise<number> {
  const kind = EVENT_KINDS[event.type]
  if (!kind || !event.departmentId) return 0
  const pointer = pointerSchema.safeParse(event.payload)
  if (!pointer.success || (kind === 'polls' && !pointer.data.pollId)) return 0
  return repo.queueGroupDeliveries(event, pointer.data.eventId, kind, pointer.data.pollId ?? null)
}

export function registerEventGroupNotifications(): () => void {
  return subscribe('*', async (event) => {
    await queueEventGroupNotifications(event)
  })
}

/** No external sends while events commit or the outbox drains. Group receipt writes commit
 * independently, so a failed recipient cannot roll back or repeat an already-delivered target. */
export async function processEventGroupDeliveries(
  limit = 20,
  send = sendPlainMessage,
  configured = isTelegramConfigured,
): Promise<{ sent: number; skipped: number; failed: number }> {
  const totals = { sent: 0, skipped: 0, failed: 0 }
  if (!configured() || (await isMaintenanceActive())) return totals
  for (let i = 0; i < Math.min(50, Math.max(0, limit)); i += 1) {
    // Bounded worker queue, deliberately sequential; not N+1 request rendering.
    // nosemgrep: query-in-loop
    const delivery = await repo.claimGroupDelivery()
    if (!delivery) break
    if (delivery.attempts > MAX_ATTEMPTS) {
      // An expired eighth lease may have sent successfully before the process crashed. There is
      // no atomic external send/DB acknowledgment, so stop instead of retrying without a bound.
      // nosemgrep: query-in-loop
      await repo.finishGroupDelivery(delivery, { status: 'failed', error: 'telegram_retry_limit' })
      totals.failed += 1
      continue
    }
    // nosemgrep: query-in-loop
    const pointer = await repo.groupDeliveryPointer(delivery)
    if (pointer && 'paused' in pointer) {
      // nosemgrep: query-in-loop
      await repo.finishGroupDelivery(delivery, { status: 'pending', error: 'delivery_paused' })
      continue
    }
    if (!pointer) {
      // nosemgrep: query-in-loop
      await repo.finishGroupDelivery(delivery, { status: 'skipped' })
      totals.skipped += 1
      continue
    }
    const locale = isBotLocale(pointer.locale) ? pointer.locale : DEFAULT_BOT_LOCALE
    const prefix =
      delivery.event_type === 'events.event.cancelled'
        ? 'events.group_cancelled'
        : delivery.event_type === 'events.event.updated'
          ? 'events.group_updated'
          : delivery.event_type === 'events.poll.created'
            ? 'events.group_poll'
            : delivery.event_type === 'events.event.reminder_due'
              ? 'events.group_reminder'
              : 'events.group_created'
    const date = eventDate(
      pointer.event.starts_at,
      locale === 'uz-Cyrl' ? 'uz' : locale,
      pointer.event.timezone,
    )
    // Pointer only: event title, date and own website URL. No names, RSVP notes, contact details,
    // descriptions, or user-specific callback buttons are published to a shared group.
    const text = [
      `${tb(locale, prefix)}: ${pointer.event.title}`,
      date,
      `${publicUrl().replace(/\/+$/, '')}/events?event=${pointer.event.id}`,
    ].join('\n')
    // nosemgrep: query-in-loop
    const result = await send(pointer.chatId, text).catch(() => ({
      ok: false as const,
      error: 'telegram_send_failed',
    }))
    if (result.ok) {
      // nosemgrep: query-in-loop
      await repo.finishGroupDelivery(delivery, { status: 'sent', messageId: result.messageId })
      totals.sent += 1
    } else {
      // Never persist Telegram error text (it can embed URLs/tokens). Keep an actionable fixed code.
      // nosemgrep: query-in-loop
      await repo.finishGroupDelivery(delivery, {
        status: delivery.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        error: 'telegram_send_failed',
      })
      totals.failed += 1
    }
  }
  return totals
}
