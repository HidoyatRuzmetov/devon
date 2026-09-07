// Demo seed for the notifications/Telegram module (MODULE-GUIDE.md "Seeds"). `order: 100` -- runs
// after `core.ts` (order 0), which is the only module this one's fixtures point at (`DEMO_USERS`,
// `DEMO_DEPARTMENT`). Deterministic ids (`demoId`) and `ON CONFLICT DO NOTHING` throughout, so a
// second `seed:demo` run writes zero rows here too.
import { eq, inArray } from 'drizzle-orm'
import * as schema from '../../schema/notifications.js'
import { DEMO_DEPARTMENT, DEMO_USERS } from '../fixtures.js'
import { demoId } from '../ids.js'
import { asUser } from '../scope.js'
import type { SeedModuleContext } from '../module-loader.js'

export const order = 100

const HEAD = DEMO_USERS.find((u) => u.role === 'head')!
const MEMBER = DEMO_USERS.find((u) => u.role === 'member')!

// Believable dates around 2026-09 (MODULE-GUIDE.md "Seeds"): a mix of already-read, unread and
// archived notifications, and a couple of reasons that have not fired yet for anyone -- so the empty
// per-filter states are also exercisable in the demo without every filter being empty.
const D = (iso: string): Date => new Date(iso)

type DemoNotification = {
  name: string
  userId: string
  reason: (typeof schema.notificationReasonEnum.enumValues)[number]
  type: string
  subjectType: string
  subjectId: string
  title: schema.LocalizedText
  body?: schema.LocalizedText
  deepLink?: string
  eventAt?: Date
  createdAt: Date
  readAt?: Date
  archivedAt?: Date
}

const NOTIFICATIONS: DemoNotification[] = [
  {
    name: 'member.assigned.report',
    userId: MEMBER.id,
    reason: 'assigned',
    type: 'work.card.assigned',
    subjectType: 'card',
    subjectId: demoId('card.quarterly-report'),
    title: {
      'uz-Latn': 'Sizga topshiriq berildi: "III chorak hisoboti"',
      'uz-Cyrl': 'Сизга топшириқ берилди: "III чорак ҳисоботи"',
      ru: 'Вам поручена задача: «Отчёт за III квартал»',
      en: 'You were assigned: "Q3 report"',
    },
    deepLink: '/cards/' + demoId('card.quarterly-report'),
    createdAt: D('2026-09-01T08:10:00+05:00'),
    readAt: D('2026-09-01T09:00:00+05:00'),
  },
  {
    name: 'member.due.report',
    userId: MEMBER.id,
    reason: 'due',
    type: 'work.card.due',
    subjectType: 'card',
    subjectId: demoId('card.quarterly-report'),
    title: {
      'uz-Latn': 'Ertaga muddati: "III chorak hisoboti"',
      'uz-Cyrl': 'Эртага муддати: "III чорак ҳисоботи"',
      ru: 'Срок завтра: «Отчёт за III квартал»',
      en: 'Due tomorrow: "Q3 report"',
    },
    deepLink: '/cards/' + demoId('card.quarterly-report'),
    eventAt: D('2026-09-06T18:00:00+05:00'),
    createdAt: D('2026-09-05T07:00:00+05:00'),
  },
  {
    name: 'member.mentioned.comment',
    userId: MEMBER.id,
    reason: 'mentioned',
    type: 'work.card.comment.mentioned',
    subjectType: 'card',
    subjectId: demoId('card.quarterly-report'),
    title: {
      'uz-Latn': 'Anvar Aliyev sizni eslatdi',
      'uz-Cyrl': 'Анвар Алиев сизни эслатди',
      ru: 'Анвар Алиев упомянул вас',
      en: 'Anvar Aliyev mentioned you',
    },
    body: {
      'uz-Latn': '"...Nodira, iltimos jadvalni tekshirib bering"',
      'uz-Cyrl': '"...Нодира, илтимос жадвални текшириб беринг"',
      ru: '«...Нодира, пожалуйста, проверьте таблицу»',
      en: '"...Nodira, please check the schedule"',
    },
    deepLink: '/cards/' + demoId('card.quarterly-report'),
    createdAt: D('2026-09-03T14:22:00+05:00'),
  },
  {
    name: 'member.event.rsvp',
    userId: MEMBER.id,
    reason: 'rsvp',
    type: 'events.event.rsvp_reminder',
    subjectType: 'event',
    subjectId: demoId('event.teambuilding'),
    title: {
      'uz-Latn': 'Ishtirok etasizmi? "Jamoaviy sayr" — 12-sentabr',
      'uz-Cyrl': 'Иштирок этасизми? "Жамоавий сайр" — 12-сентябрь',
      ru: 'Вы участвуете? «Командный выезд» — 12 сентября',
      en: 'Are you going? "Team outing" — Sep 12',
    },
    deepLink: '/events/' + demoId('event.teambuilding'),
    eventAt: D('2026-09-12T10:00:00+05:00'),
    createdAt: D('2026-09-02T10:00:00+05:00'),
  },
  {
    name: 'head.poll.opened',
    userId: HEAD.id,
    reason: 'poll',
    type: 'events.poll.opened',
    subjectType: 'poll',
    subjectId: demoId('poll.lunch-date'),
    title: {
      'uz-Latn': 'Yangi so’rovnoma: "Nonushta sanasi"',
      'uz-Cyrl': 'Янги сўровнома: "Нонушта санаси"',
      ru: 'Новый опрос: «Дата обеда»',
      en: 'New poll: "Lunch date"',
    },
    deepLink: '/polls/' + demoId('poll.lunch-date'),
    createdAt: D('2026-09-04T09:15:00+05:00'),
    readAt: D('2026-09-04T09:40:00+05:00'),
  },
  {
    name: 'head.updated.event',
    userId: HEAD.id,
    reason: 'updated',
    type: 'events.event.updated',
    subjectType: 'event',
    subjectId: demoId('event.teambuilding'),
    title: {
      'uz-Latn': '"Jamoaviy sayr" vaqti o’zgardi',
      'uz-Cyrl': '"Жамоавий сайр" вақти ўзгарди',
      ru: 'Время «Командного выезда» изменилось',
      en: '"Team outing" time changed',
    },
    body: {
      'uz-Latn': 'Endi soat 10:00 da boshlanadi (avval 09:00 edi)',
      'uz-Cyrl': 'Энди соат 10:00 да бошланади (аввал 09:00 эди)',
      ru: 'Теперь начало в 10:00 (было 09:00)',
      en: 'Now starts at 10:00 (was 09:00)',
    },
    deepLink: '/events/' + demoId('event.teambuilding'),
    createdAt: D('2026-08-28T16:00:00+05:00'),
    readAt: D('2026-08-28T16:05:00+05:00'),
    archivedAt: D('2026-08-29T08:00:00+05:00'),
  },
  {
    name: 'head.decision.recorded',
    userId: HEAD.id,
    reason: 'decision',
    type: 'pages.decision.recorded',
    subjectType: 'page',
    subjectId: demoId('page.how-we-work'),
    title: {
      'uz-Latn': 'Yangi qaror qayd etildi: "Masofadan ishlash tartibi"',
      'uz-Cyrl': 'Янги қарор қайд этилди: "Масофадан ишлаш тартиби"',
      ru: 'Зафиксировано решение: «Порядок удалённой работы»',
      en: 'New decision recorded: "Remote-work policy"',
    },
    deepLink: '/pages/' + demoId('page.how-we-work'),
    createdAt: D('2026-08-30T11:00:00+05:00'),
    readAt: D('2026-08-30T11:20:00+05:00'),
  },
  {
    name: 'member.digest.weekly',
    userId: MEMBER.id,
    reason: 'digest',
    type: 'notifications.digest.weekly',
    subjectType: 'digest',
    subjectId: 'weekly-2026-w35',
    title: {
      'uz-Latn': 'Haftalik xulosa: 3 ta yangilanish',
      'uz-Cyrl': 'Ҳафталик хулоса: 3 та янгиланиш',
      ru: 'Итоги недели: 3 обновления',
      en: 'Weekly summary: 3 updates',
    },
    deepLink: '/inbox',
    createdAt: D('2026-08-28T18:00:00+05:00'),
    readAt: D('2026-08-29T09:00:00+05:00'),
  },
  {
    name: 'head.system.telegram',
    userId: HEAD.id,
    reason: 'system',
    type: 'notifications.system.announced',
    subjectType: 'system',
    subjectId: 'telegram-bot-ready',
    title: {
      'uz-Latn': 'Telegram bot ulandi',
      'uz-Cyrl': 'Telegram бот уланди',
      ru: 'Telegram-бот подключён',
      en: 'Telegram bot connected',
    },
    body: {
      'uz-Latn': 'Endi eslatmalarni Telegram orqali ham olasiz.',
      'uz-Cyrl': 'Энди эслатмаларни Telegram орқали ҳам оласиз.',
      ru: 'Теперь вы будете получать напоминания и в Telegram.',
      en: 'You will now also receive reminders in Telegram.',
    },
    deepLink: '/inbox',
    createdAt: D('2026-08-15T09:00:00+05:00'),
    readAt: D('2026-08-15T09:05:00+05:00'),
  },
]

// Sensible defaults: every reason on `inapp` (always on, matching the taste rule "no dead ends" --
// the inbox itself is never optional), `due`/`digest` also on Telegram once linked, everything else
// off Telegram by default until the person opts in from Settings.
const TELEGRAM_DEFAULT_ON: ReadonlySet<(typeof schema.notificationReasonEnum.enumValues)[number]> =
  new Set(['due', 'digest', 'system'])

// The one place this module's per-user ids are named, so `seed()` and `reset()` cannot drift apart.
const notificationId = (name: string): string => demoId(`notification.${name}`)

const notificationIdsFor = (userId: string): string[] =>
  NOTIFICATIONS.filter((n) => n.userId === userId).map((n) => notificationId(n.name))

const prefIdsFor = (login: string): string[] =>
  schema.notificationReasonEnum.enumValues.map((reason) =>
    demoId(`notification-pref.${login}.${reason}.telegram`),
  )

// `demo.ts`'s `runSeedDemo` opens the whole seed run inside one `withContext()` transaction with a
// fixed `{ userId: null, actorRole: 'super_admin', departmentId: DEMO_DEPARTMENT.id }` context (the
// shape every other seed module's department-scoped inserts already rely on). This module's per-user
// tables are `user_owned` (I-1: no actor_role bypass, ever -- `rls.ts`'s `userTableDDL` comment), so a
// plain insert -- or delete -- under that fixed context would fail (or silently match zero rows for)
// `notifications_scope`'s `user_id = app.current_user_id()` for every row: there is no super-admin
// exception to write around. `scope.ts`'s `asUser` narrows `app.user_id` to the row's own owner for
// exactly the statements that need it, then restores the seed's original (empty) value.

export async function seed(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  let written = 0

  for (const user of [MEMBER, HEAD]) {
    const rowsForUser = NOTIFICATIONS.filter((n) => n.userId === user.id)
    if (rowsForUser.length === 0) continue
    written += await asUser(tx, user.id, async () => {
      const inserted = await tx.drizzle
        .insert(schema.notifications)
        .values(
          rowsForUser.map((n) => ({
            id: notificationId(n.name),
            userId: n.userId,
            type: n.type,
            reason: n.reason,
            subjectType: n.subjectType,
            subjectId: n.subjectId,
            departmentId: DEMO_DEPARTMENT.id,
            title: n.title,
            body: n.body ?? null,
            deepLink: n.deepLink ?? null,
            eventAt: n.eventAt ?? null,
            readAt: n.readAt ?? null,
            archivedAt: n.archivedAt ?? null,
            createdAt: n.createdAt,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: schema.notifications.id })
      return inserted.length
    })
  }

  for (const user of DEMO_USERS) {
    const prefIds = prefIdsFor(user.login)
    written += await asUser(tx, user.id, async () => {
      const inserted = await tx.drizzle
        .insert(schema.notificationPrefs)
        .values(
          schema.notificationReasonEnum.enumValues.map((reason, i) => ({
            id: prefIds[i]!,
            userId: user.id,
            reason,
            channel: 'telegram' as const,
            enabled: TELEGRAM_DEFAULT_ON.has(reason),
          })),
        )
        .onConflictDoNothing()
        .returning({ id: schema.notificationPrefs.id })
      return inserted.length
    })
  }

  // The member keeps quieter personal hours than the department default: 19:30-08:30 (13h/day) is
  // strictly more quiet minutes than the department's 20:00-08:00 (12h/day) -- demonstrates "personal
  // override to quieter" (TECH-SPEC §7; see `apps/api/src/modules/notifications/quiet-hours.ts`'s
  // `isQuieterOrEqual`, which is exactly the rule a real PUT to this endpoint would enforce).
  written += await asUser(tx, MEMBER.id, async () => {
    const inserted = await tx.drizzle
      .insert(schema.notificationQuietHours)
      .values({
        userId: MEMBER.id,
        startMinute: 19 * 60 + 30,
        endMinute: 8 * 60 + 30,
        includeWeekends: true,
      })
      .onConflictDoNothing()
      .returning({ userId: schema.notificationQuietHours.userId })
    return inserted.length
  })

  const insertedDeptSettings = await tx.drizzle
    .insert(schema.notificationDepartmentSettings)
    .values({ departmentId: DEMO_DEPARTMENT.id })
    .onConflictDoNothing()
    .returning({ departmentId: schema.notificationDepartmentSettings.departmentId })
  written += insertedDeptSettings.length

  // A mock Telegram link for the member (MODULE-GUIDE.md task: "a mock Telegram link"). The chat id is
  // a fixed, obviously-fake demo value -- this seed never talks to the real Telegram API.
  const insertedLink = await tx.drizzle
    .insert(schema.telegramLinks)
    .values({
      userId: MEMBER.id,
      chatId: 100000001n,
      linkedAt: D('2026-08-15T09:00:00+05:00'),
      linkCodeUsed: 'DEMO123',
      localeAtLink: 'uz-Latn',
    })
    .onConflictDoNothing()
    .returning({ userId: schema.telegramLinks.userId })
  written += insertedLink.length

  return written
}

/** Reverse of `seed()`: the Telegram link and the department settings (global / department-scoped,
 * both reachable under the shared context), then every owner-only row under its owner's `asUser`. */
export async function reset(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  let deleted = 0

  const deletedLink = await tx.drizzle
    .delete(schema.telegramLinks)
    .where(eq(schema.telegramLinks.userId, MEMBER.id))
    .returning({ userId: schema.telegramLinks.userId })
  deleted += deletedLink.length

  const deletedDeptSettings = await tx.drizzle
    .delete(schema.notificationDepartmentSettings)
    .where(eq(schema.notificationDepartmentSettings.departmentId, DEMO_DEPARTMENT.id))
    .returning({ departmentId: schema.notificationDepartmentSettings.departmentId })
  deleted += deletedDeptSettings.length

  deleted += await asUser(tx, MEMBER.id, async () => {
    const rows = await tx.drizzle
      .delete(schema.notificationQuietHours)
      .where(eq(schema.notificationQuietHours.userId, MEMBER.id))
      .returning({ userId: schema.notificationQuietHours.userId })
    return rows.length
  })

  for (const user of DEMO_USERS) {
    deleted += await asUser(tx, user.id, async () => {
      const rows = await tx.drizzle
        .delete(schema.notificationPrefs)
        .where(inArray(schema.notificationPrefs.id, prefIdsFor(user.login)))
        .returning({ id: schema.notificationPrefs.id })
      return rows.length
    })
  }

  for (const user of [MEMBER, HEAD]) {
    const ids = notificationIdsFor(user.id)
    if (ids.length === 0) continue
    deleted += await asUser(tx, user.id, async () => {
      // A delivery row is written by the delivery worker (`apps/api/.../notifications/delivery.ts`),
      // not by this module, but it holds `notification_deliveries.notification_id -> notifications.id`;
      // resetting a demo that has actually delivered a seeded notification (the ordinary path -- the
      // reset runs against a used demo, exactly the reason `demo.ts` sweeps sessions) would otherwise
      // fail `notification_deliveries_notification_id_fkey`. The table is user-owned RLS, so this runs
      // under the same `asUser` as the notifications delete, scoped to this user's demo notification
      // ids only -- a delivery of some non-demo notification is never touched.
      await tx.drizzle
        .delete(schema.notificationDeliveries)
        .where(inArray(schema.notificationDeliveries.notificationId, ids))

      const rows = await tx.drizzle
        .delete(schema.notifications)
        .where(inArray(schema.notifications.id, ids))
        .returning({ id: schema.notifications.id })
      return rows.length
    })
  }

  return deleted
}
