// Demo seed for the notifications/Telegram module (MODULE-GUIDE.md "Seeds"). `order: 100` -- runs
// after `core.ts` (order 0), which is the only module this one's fixtures point at (`DEMO_USERS`,
// `DEMO_DEPARTMENT`). Deterministic ids (`demoId`) and `ON CONFLICT DO NOTHING` throughout, so a
// second `seed:demo` run writes zero rows here too.
import { eq, inArray } from 'drizzle-orm'
import * as schema from '../../schema/notifications.js'
import { DEMO_DEPARTMENT, DEMO_USERS } from '../fixtures.js'
import {
  ALL_WORK_MEMBER_IDS,
  NEWCOMER_INDEX,
  projectIdFor,
  standaloneCardId,
  standaloneCardTitle,
} from '../work-fixtures.js'
import { demoId } from '../ids.js'
import { asUser } from '../scope.js'
import type { SeedModuleContext } from '../module-loader.js'

// `order: 900` -- these rows now point at cards (`work.ts`, 90), projects (`projects.ts`, 100),
// events (`events.ts`, 400) and pages (`pages.ts`, 600) that have to exist first. `app.notifications`
// has no foreign key to any of them (a notification outlives its subject on purpose), but a deep link
// into a row that was never written is the same broken button either way.
export const order = 900

const HEAD = DEMO_USERS.find((u) => u.role === 'head')!
const MEMBER = DEMO_USERS.find((u) => u.role === 'member')!
/** `demo.xodim`'s index in `ALL_WORK_MEMBER_IDS` -- the column every card link below points into. */
const MEMBER_INDEX = 1

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

/**
 * Every persona the presenter signs in as opens on an inbox that already makes sense. Four things
 * this list is careful about, all of which it used to get wrong:
 *
 *  - **Real subjects.** Every `subjectId` is a row this seed actually writes, and every `deepLink` is
 *    a route this app actually has (`/work/card?id=...`, `/events?event=...`, `/people/...` -- see
 *    `apps/api/src/modules/notifications/registry.ts`, which is where those shapes are decided). The
 *    previous fixtures pointed at invented ids behind `/cards/<id>`, a route that does not exist, so
 *    every "Ochish" button in the demo inbox led nowhere. A dead button on stage costs more than an
 *    empty inbox would have.
 *  - **Real words.** A card notification quotes the card's own title through
 *    `standaloneCardTitle(...)`, so the inbox row and the card it opens say the same thing.
 *  - **More than two people.** `demo.boshliq` and `demo.xodim` are not the only accounts a presenter
 *    signs into: the bo'lim boshlig'i and the newcomer each need a first screen too.
 *  - **A mix of states.** Read, unread and archived, so every filter chip in the inbox has something
 *    behind it.
 */
const NOTIFICATIONS: DemoNotification[] = [
  // --- Nodira Karimova (`demo.xodim`) -- the member persona -----------------------------------
  {
    name: 'member.assigned.contract',
    userId: MEMBER.id,
    reason: 'assigned',
    type: 'work.card.assigned',
    subjectType: 'card',
    subjectId: standaloneCardId(MEMBER_INDEX, 0),
    title: {
      'uz-Latn': `Sizga topshiriq berildi: «Shartnoma loyihasi matnini tayyorlash»`,
      'uz-Cyrl': 'Сизга топшириқ берилди: «Шартнома лойиҳаси матнини тайёрлаш»',
      ru: 'Вам поручена задача: «Подготовить текст проекта договора»',
      en: 'You were assigned: "Draft the contract text"',
    },
    deepLink: `/work/card?id=${standaloneCardId(MEMBER_INDEX, 0)}`,
    createdAt: D('2026-09-01T08:10:00+05:00'),
    readAt: D('2026-09-01T09:00:00+05:00'),
  },
  {
    name: 'member.due.weekly-report',
    userId: MEMBER.id,
    reason: 'due',
    type: 'work.card.due',
    subjectType: 'card',
    subjectId: standaloneCardId(MEMBER_INDEX, 4),
    title: {
      'uz-Latn': `Ertaga muddati: «${standaloneCardTitle(MEMBER_INDEX, 4)}»`,
      'uz-Cyrl': 'Эртага муддати: «Ҳафталик ижро интизоми ҳисоботини топшириш»',
      ru: 'Срок завтра: «Сдать еженедельный отчёт по исполнительской дисциплине»',
      en: 'Due tomorrow: "Submit the weekly execution-discipline report"',
    },
    deepLink: `/work/card?id=${standaloneCardId(MEMBER_INDEX, 4)}`,
    eventAt: D('2026-09-07T18:00:00+05:00'),
    createdAt: D('2026-09-06T07:00:00+05:00'),
  },
  {
    name: 'member.mentioned.comment',
    userId: MEMBER.id,
    reason: 'mentioned',
    type: 'work.card.comment.mentioned',
    subjectType: 'card',
    subjectId: standaloneCardId(MEMBER_INDEX, 2),
    title: {
      'uz-Latn': 'Anvar Aliyev sizni eslatdi',
      'uz-Cyrl': 'Анвар Алиев сизни эслатди',
      ru: 'Анвар Алиев упомянул вас',
      en: 'Anvar Aliyev mentioned you',
    },
    body: {
      'uz-Latn': '«...Nodira, huquqiy xulosani bugun olsak boʻladimi?»',
      'uz-Cyrl': '«...Нодира, ҳуқуқий хулосани бугун олсак бўладими?»',
      ru: '«...Нодира, сможем получить правовое заключение сегодня?»',
      en: '"...Nodira, can we have the legal opinion today?"',
    },
    deepLink: `/work/card?id=${standaloneCardId(MEMBER_INDEX, 2)}`,
    createdAt: D('2026-09-05T14:22:00+05:00'),
  },
  {
    name: 'member.event.rsvp',
    userId: MEMBER.id,
    reason: 'rsvp',
    type: 'events.event.rsvp_reminder',
    subjectType: 'event',
    subjectId: demoId('event.picnic'),
    title: {
      'uz-Latn': 'Ishtirok etasizmi? «Kuz faslidagi jamoaviy piknik» — 20-sentabr',
      'uz-Cyrl': 'Иштирок этасизми? «Куз фаслидаги жамоавий пикник» — 20-сентябрь',
      ru: 'Вы участвуете? «Осенний командный пикник» — 20 сентября',
      en: 'Are you going? "Autumn team picnic" — Sep 20',
    },
    deepLink: `/events?event=${demoId('event.picnic')}`,
    eventAt: D('2026-09-20T09:00:00+05:00'),
    createdAt: D('2026-09-02T10:00:00+05:00'),
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

  // --- Anvar Aliyev (`demo.boshliq`) -- the boshqarma boshlig'i --------------------------------
  {
    name: 'head.join.requested',
    userId: HEAD.id,
    reason: 'system',
    type: 'departments.join.requested',
    subjectType: 'department',
    subjectId: DEMO_DEPARTMENT.id,
    title: {
      'uz-Latn': 'Boshqarmaga qoʻshilish uchun 2 ta soʻrov kutmoqda',
      'uz-Cyrl': 'Бошқармага қўшилиш учун 2 та сўров кутмоқда',
      ru: '2 заявки на вступление ждут решения',
      en: '2 join requests are waiting',
    },
    body: {
      'uz-Latn': 'Aziza Raximova va Doniyor Eshonqulov.',
      'uz-Cyrl': 'Азиза Рахимова ва Дониёр Эшонқулов.',
      ru: 'Азиза Рахимова и Дониёр Эшонкулов.',
      en: 'Aziza Raximova and Doniyor Eshonqulov.',
    },
    deepLink: `/department?id=${DEMO_DEPARTMENT.id}&tab=members`,
    createdAt: D('2026-09-05T11:45:00+05:00'),
  },
  {
    name: 'head.overdue.portal',
    userId: HEAD.id,
    reason: 'due',
    type: 'work.card.overdue',
    subjectType: 'card',
    subjectId: standaloneCardId(6, 0),
    title: {
      'uz-Latn': `Muddati oʻtdi: «${standaloneCardTitle(6, 0)}»`,
      'uz-Cyrl': 'Муддати ўтди: «Хизмат саҳифаларининг мобил кўринишини тузатиш»',
      ru: 'Просрочено: «Исправить мобильный вид страниц услуг»',
      en: 'Overdue: "Fix the mobile layout of the service pages"',
    },
    body: {
      'uz-Latn': 'Otabek Norqobilov — Elektron xizmatlar boʻlimi.',
      'uz-Cyrl': 'Отабек Норқобилов — Электрон хизматлар бўлими.',
      ru: 'Отабек Норкобилов — Отдел электронных услуг.',
      en: 'Otabek Norqobilov — E-services unit.',
    },
    deepLink: `/work/card?id=${standaloneCardId(6, 0)}`,
    createdAt: D('2026-09-05T08:00:00+05:00'),
  },
  {
    name: 'head.poll.opened',
    userId: HEAD.id,
    reason: 'poll',
    type: 'events.poll.opened',
    subjectType: 'event',
    subjectId: demoId('event.picnic'),
    title: {
      'uz-Latn': 'Yangi soʻrovnoma: «Piknik sanasi»',
      'uz-Cyrl': 'Янги сўровнома: «Пикник санаси»',
      ru: 'Новый опрос: «Дата пикника»',
      en: 'New poll: "Picnic date"',
    },
    deepLink: `/events?event=${demoId('event.picnic')}`,
    createdAt: D('2026-09-04T09:15:00+05:00'),
    readAt: D('2026-09-04T09:40:00+05:00'),
  },
  {
    name: 'head.field.filled',
    userId: HEAD.id,
    reason: 'updated',
    type: 'fields.value.filled',
    subjectType: 'person',
    subjectId: ALL_WORK_MEMBER_IDS[12]!,
    title: {
      'uz-Latn': 'Sanjar Tursunov «Taʼlim» maydonini toʻldirdi',
      'uz-Cyrl': 'Санжар Турсунов «Таълим» майдонини тўлдирди',
      ru: 'Санжар Турсунов заполнил поле «Образование»',
      en: 'Sanjar Tursunov filled in "Education"',
    },
    deepLink: `/people/${ALL_WORK_MEMBER_IDS[12]!}`,
    createdAt: D('2026-09-03T12:10:00+05:00'),
    readAt: D('2026-09-03T12:30:00+05:00'),
  },
  {
    name: 'head.updated.event',
    userId: HEAD.id,
    reason: 'updated',
    type: 'events.event.updated',
    subjectType: 'event',
    subjectId: demoId('event.excel-training'),
    title: {
      'uz-Latn': '«Excel boʻyicha amaliy trening» vaqti oʻzgardi',
      'uz-Cyrl': '«Excel бўйича амалий тренинг» вақти ўзгарди',
      ru: 'Время «Практического тренинга по Excel» изменилось',
      en: '"Practical Excel training" time changed',
    },
    body: {
      'uz-Latn': 'Endi soat 10:00 da boshlanadi (avval 09:00 edi)',
      'uz-Cyrl': 'Энди соат 10:00 да бошланади (аввал 09:00 эди)',
      ru: 'Теперь начало в 10:00 (было 09:00)',
      en: 'Now starts at 10:00 (was 09:00)',
    },
    deepLink: `/events?event=${demoId('event.excel-training')}`,
    createdAt: D('2026-08-28T16:00:00+05:00'),
    readAt: D('2026-08-28T16:05:00+05:00'),
    archivedAt: D('2026-08-29T08:00:00+05:00'),
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

  // --- Jasur Qodirov -- bo'lim boshlig'i, owner of "Yagona portal 2.0" ------------------------
  {
    name: 'unit-head.project.milestone',
    userId: ALL_WORK_MEMBER_IDS[4]!,
    reason: 'updated',
    type: 'projects.milestone.due',
    subjectType: 'project',
    subjectId: projectIdFor('egov-portal'),
    title: {
      'uz-Latn': '«Beta versiya ichki sinovda» — 19 kundan keyin',
      'uz-Cyrl': '«Бета версия ички синовда» — 19 кундан кейин',
      ru: '«Бета-версия во внутреннем тестировании» — через 19 дней',
      en: '"Beta in internal testing" — in 19 days',
    },
    deepLink: '/projects',
    eventAt: D('2026-09-25T18:00:00+05:00'),
    createdAt: D('2026-09-06T07:30:00+05:00'),
  },
  {
    name: 'unit-head.mentioned.comment',
    userId: ALL_WORK_MEMBER_IDS[4]!,
    reason: 'mentioned',
    type: 'work.card.comment.mentioned',
    subjectType: 'card',
    subjectId: standaloneCardId(2, 0),
    title: {
      'uz-Latn': 'Bekzod Yusupov sizni eslatdi',
      'uz-Cyrl': 'Бекзод Юсупов сизни эслатди',
      ru: 'Бекзод Юсупов упомянул вас',
      en: 'Bekzod Yusupov mentioned you',
    },
    deepLink: `/work/card?id=${standaloneCardId(2, 0)}`,
    createdAt: D('2026-09-04T16:05:00+05:00'),
  },

  // --- Feruza Xolmatova -- the newcomer, six days in -------------------------------------------
  {
    name: 'newcomer.onboarding.started',
    userId: ALL_WORK_MEMBER_IDS[NEWCOMER_INDEX]!,
    reason: 'system',
    type: 'pages.onboarding.started',
    subjectType: 'page',
    subjectId: demoId('pages.page.how-we-work'),
    title: {
      'uz-Latn': 'Xush kelibsiz! Moslashuv roʻyxati siz uchun ochildi',
      'uz-Cyrl': 'Хуш келибсиз! Мослашув рўйхати сиз учун очилди',
      ru: 'Добро пожаловать! Для вас открыт чек-лист адаптации',
      en: 'Welcome! Your onboarding checklist is open',
    },
    body: {
      'uz-Latn': '7 ta banddan 2 tasi kartaga aylandi.',
      'uz-Cyrl': '7 та банддан 2 таси картага айланди.',
      ru: 'Из 7 пунктов 2 стали карточками.',
      en: '2 of the 7 items became cards.',
    },
    deepLink: '/pages',
    createdAt: D('2026-08-31T09:05:00+05:00'),
    readAt: D('2026-08-31T09:30:00+05:00'),
  },
  {
    name: 'newcomer.field.request',
    userId: ALL_WORK_MEMBER_IDS[NEWCOMER_INDEX]!,
    reason: 'updated',
    type: 'fields.value.requested',
    subjectType: 'person',
    subjectId: ALL_WORK_MEMBER_IDS[NEWCOMER_INDEX]!,
    title: {
      'uz-Latn': 'Anvar Aliyev «Taʼlim» maydonini toʻldirishingizni soʻradi',
      'uz-Cyrl': 'Анвар Алиев «Таълим» майдонини тўлдиришингизни сўради',
      ru: 'Анвар Алиев просит заполнить поле «Образование»',
      en: 'Anvar Aliyev asks you to fill in "Education"',
    },
    deepLink: '/account',
    createdAt: D('2026-09-05T09:00:00+05:00'),
  },
  {
    name: 'newcomer.assigned.accounts',
    userId: ALL_WORK_MEMBER_IDS[NEWCOMER_INDEX]!,
    reason: 'assigned',
    type: 'work.card.assigned',
    subjectType: 'card',
    subjectId: standaloneCardId(NEWCOMER_INDEX, 1),
    title: {
      'uz-Latn': `Sizga topshiriq berildi: «${standaloneCardTitle(NEWCOMER_INDEX, 1)}»`,
      'uz-Cyrl': 'Сизга топшириқ берилди: «Иш ҳисобларини фаоллаштириш»',
      ru: 'Вам поручена задача: «Активировать рабочие учётные записи»',
      en: 'You were assigned: "Activate your work accounts"',
    },
    deepLink: `/work/card?id=${standaloneCardId(NEWCOMER_INDEX, 1)}`,
    createdAt: D('2026-08-31T09:06:00+05:00'),
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

  // Every distinct owner in the list above, in first-appearance order -- four people now, not two.
  const notifiedUserIds = [...new Set(NOTIFICATIONS.map((n) => n.userId))]
  for (const userId of notifiedUserIds) {
    const rowsForUser = NOTIFICATIONS.filter((n) => n.userId === userId)
    if (rowsForUser.length === 0) continue
    written += await asUser(tx, userId, async () => {
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

  // Same four owners `seed()` wrote for, derived from the same list so the two cannot drift.
  for (const userId of [...new Set(NOTIFICATIONS.map((n) => n.userId))]) {
    const ids = notificationIdsFor(userId)
    if (ids.length === 0) continue
    deleted += await asUser(tx, userId, async () => {
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
