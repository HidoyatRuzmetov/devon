import { subscribe, withContext, type RequestContext } from '@devon/db'
import { sql } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import { z } from 'zod'
import { notifyUser } from '../notifications/notify.js'

const payloadSchema = z.object({
  userId: z.string().uuid(),
  id: z.string().uuid(),
  version: z.number().int(),
  removed: z.boolean(),
  added: z.boolean(),
})
export function subscribeCalendarInvitations(log: FastifyBaseLogger) {
  return subscribe('personal.calendar.invitation', async (event) => {
    const parsed = payloadSchema.safeParse(event.payload)
    if (!parsed.success) return
    const payload = parsed.data
    // Read through the invited person's RLS. An invitation never grants access to unrelated notes.
    const ctx: RequestContext = {
      requestId: `calendar-invitation:${event.id}`,
      userId: payload.userId,
      actorRole: 'member',
      departmentId: null,
      actingForUserId: null,
      viewAs: false,
      ip: '',
      userAgent: 'calendar-invitation-worker',
    }
    const row = await withContext(
      ctx,
      async (tx) =>
        (
          await tx.raw<{ title: string; starts_at: string; version: number }>(
            sql`select title,starts_at::text,version from app.personal_calendar_entries where id=${payload.id} and deleted_at is null and ${payload.userId}=any(participant_user_ids)`,
          )
        )[0],
    )
    if (payload.removed ? !!row : !row || row.version !== payload.version) return
    const title = payload.removed
      ? {
          'uz-Latn': 'Taqvim taklifi bekor qilindi',
          'uz-Cyrl': 'Тақвим таклифи бекор қилинди',
          ru: 'Приглашение в календаре отменено',
          en: 'Calendar invitation cancelled',
        }
      : payload.added
        ? {
            'uz-Latn': 'Taqvimga taklif',
            'uz-Cyrl': 'Тақвимга таклиф',
            ru: 'Приглашение в календарь',
            en: 'Calendar invitation',
          }
        : {
            'uz-Latn': 'Taqvim taklifi yangilandi',
            'uz-Cyrl': 'Тақвим таклифи янгиланди',
            ru: 'Приглашение в календаре обновлено',
            en: 'Calendar invitation updated',
          }
    await notifyUser(log, {
      userId: payload.userId,
      type: 'personal.calendar.invitation',
      reason: 'rsvp',
      subjectType: 'personal_calendar',
      subjectId: payload.id,
      dedupeKey: `calendar:${payload.id}:${payload.version}:${payload.userId}`,
      title,
      body: row
        ? { 'uz-Latn': row.title, 'uz-Cyrl': row.title, ru: row.title, en: row.title }
        : null,
      deepLink: row
        ? `/personal?tab=calendar&entry=${payload.id}&month=${new Date(new Date(row.starts_at).getTime() + 5 * 3600000).toISOString().slice(0, 7)}`
        : '/personal?tab=calendar',
      eventAt: row ? new Date(row.starts_at) : null,
    })
  })
}
