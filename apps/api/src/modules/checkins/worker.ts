import { withContext, type RequestContext } from '@devon/db'
import { sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { isMaintenanceActive, listAllDepartmentIds } from '../notifications/repo.js'
import { isTelegramConfigured, publicUrl, sendPlainMessage } from '../telegram/transport.js'
import { maintainCycles } from './repo.js'

function context(departmentId: string): RequestContext {
  return {
    requestId: randomUUID(),
    userId: null,
    actorRole: 'super_admin',
    departmentId,
    departmentRole: 'head',
    actingForUserId: null,
    viewAs: false,
    ip: '127.0.0.1',
    userAgent: 'devon-checkins/scheduler',
  }
}
const messages = {
  en: {
    checkin:
      'Check-in today: please fill in your deliverables. After check-in is locked, agreed items cannot be removed; later additions remain possible.',
    checkout:
      'Checkout today: please update your results. Once checkout is locked, this period cannot be changed.',
  },
  'uz-Latn': {
    checkin:
      'Bugun check-in: natija bandlarini to‘ldiring. Check-in yopilgach, kelishilgan bandlarni olib tashlab bo‘lmaydi; yangi band qo‘shish mumkin.',
    checkout:
      'Bugun checkout: natijalarni yangilang. Checkout yopilgach, ushbu davrni o‘zgartirib bo‘lmaydi.',
  },
  'uz-Cyrl': {
    checkin:
      'Бугун check-in: натижа бандларини тўлдиринг. Check-in ёпилгач, келишилган бандларни олиб ташлаб бўлмайди; янги банд қўшиш мумкин.',
    checkout:
      'Бугун checkout: натижаларни янгиланг. Checkout ёпилгач, ушбу даврни ўзгартириб бўлмайди.',
  },
  ru: {
    checkin:
      'Сегодня check-in: заполните ожидаемые результаты. После закрытия check-in согласованные пункты нельзя убрать; новые можно добавлять.',
    checkout:
      'Сегодня checkout: обновите результаты. После закрытия checkout изменить этот период будет нельзя.',
  },
}
export async function processCheckins(
  send = sendPlainMessage,
  configured = isTelegramConfigured,
  now = new Date(),
): Promise<void> {
  if (await isMaintenanceActive()) return
  const departments = await listAllDepartmentIds()
  // nosemgrep: devon-query-in-loop -- Each department requires its own RLS transaction; do not combine tenant scopes.
  for (let index = 0; index < departments.length; index += 1) {
    const ctx = context(departments[index]!)
    // Bounded per-department transactions: cycles are not allowed to borrow another tenant's context.
    // nosemgrep: query-in-loop
    await withContext(ctx, async (tx) => {
      // nosemgrep: query-in-loop -- The reminder insert must follow cycle locking in this tenant's transaction.
      await maintainCycles(tx, ctx, now)
      // nosemgrep: query-in-loop -- Depends on this tenant's completed cycle maintenance above.
      await tx.raw(sql`insert into app.checkin_reminders(department_id,cycle_id,phase,chat_id)
        select c.department_id,c.id,phase.name,g.chat_id from app.checkin_cycles c
        join app.telegram_groups g on g.department_id=c.department_id and g.disconnected_at is null
        cross join (values('checkin'),('checkout')) as phase(name)
        where (${now.toISOString()}::timestamptz at time zone 'Asia/Tashkent')::date=case when phase.name='checkin' then c.starts_on else c.ends_on end
          and (${now.toISOString()}::timestamptz at time zone 'Asia/Tashkent')::time>='09:00'::time
          and case when phase.name='checkin' then c.checkin_locked_at is null else c.checkout_locked_at is null end
        on conflict(cycle_id,phase,chat_id) do nothing`)
    })
    if (!configured()) continue
    // nosemgrep: devon-query-in-loop -- Bounded queue claims: each send is acknowledged before claiming the next delivery.
    for (let target = 0; target < 20; target += 1) {
      const token = randomUUID()
      // nosemgrep: query-in-loop
      const delivery = await withContext(ctx, async (tx) => {
        // nosemgrep: query-in-loop -- Claim exactly one leased delivery before making its bounded external send.
        const rows = await tx.raw<{
          id: string
          phase: 'checkin' | 'checkout'
          chat_id: string
          locale: string
          cycle_id: string
        }>(sql`
          with candidate as(select q.id,d.locale_default from app.checkin_reminders q
            join app.checkin_cycles c on c.id=q.cycle_id join app.departments d on d.id=q.department_id
            join app.telegram_groups g on g.department_id=q.department_id and g.chat_id::text=q.chat_id and g.disconnected_at is null
            where q.sent_at is null and q.attempts<8 and (q.lease_until is null or q.lease_until<now())
              and (${now.toISOString()}::timestamptz at time zone 'Asia/Tashkent')::date=case when q.phase='checkin' then c.starts_on else c.ends_on end
              and case when q.phase='checkin' then c.checkin_locked_at is null else c.checkout_locked_at is null end
            order by q.id limit 1 for update of q skip locked)
          update app.checkin_reminders q set attempts=attempts+1,lease_token=${token},lease_until=now()+interval '5 minutes'
          from candidate where q.id=candidate.id returning q.id,q.phase,q.chat_id,q.cycle_id,candidate.locale_default as locale`)
        return rows[0]
      })
      if (!delivery) break
      const text = messages[delivery.locale as keyof typeof messages] ?? messages['uz-Latn']
      // Transport is bounded and local development disables the production token centrally.
      // nosemgrep: query-in-loop
      const result = await send(
        delivery.chat_id,
        `${text[delivery.phase]}\n${publicUrl().replace(/\/+$/, '')}/analytics?cycle=${delivery.cycle_id}`,
      ).catch(() => ({ ok: false as const, error: 'telegram_send_failed' }))
      if (result.ok) {
        // nosemgrep: query-in-loop
        await withContext(ctx, async (tx) => {
          // nosemgrep: query-in-loop -- Acknowledge this delivery only after the transport accepted it.
          const saved = await tx.raw<{ id: string }>(
            sql`update app.checkin_reminders set sent_at=now(),lease_until=null where id=${delivery.id} and lease_token=${token} returning id`,
          )
          if (saved.length)
            tx.audit({
              action: 'checkins.reminder_sent',
              subjectType: 'checkin',
              subjectId: delivery.cycle_id,
              after: { phase: delivery.phase },
            })
        })
      }
    }
  }
}
export function startCheckinWorker(onError: (error: unknown) => void) {
  let running = false
  const tick = () => {
    if (running) return
    running = true
    void processCheckins()
      .catch(onError)
      .finally(() => {
        running = false
      })
  }
  const timer = setInterval(tick, 30_000)
  timer.unref?.()
  tick()
  return { stop: () => clearInterval(timer) }
}
