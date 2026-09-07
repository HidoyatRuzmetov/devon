// Demo seed for the personal workspace (MODULE-GUIDE.md "Seeds", TECH-SPEC §3.3). Runs after
// `core.ts` (order 0) since it references `DEMO_USERS`' ids.
//
// Every table this module writes to is owner-only under RLS with NO super_admin/view-as carve-out
// (I-1 -- see `migrations/0500_personal.sql`), but `runSeedDemo`'s outer transaction runs under a
// fixed `demoContext()` (`app.user_id` GUC unset, `app.actor_role` = `super_admin`) so that a single
// transaction can seed rows for the department/users/memberships every module's fixtures point at.
// That context alone cannot write -- or delete -- a row in any table in this file: `user_id =
// app.current_user_id()` would reject the write and match nothing on the delete. So this module
// briefly re-points the transaction-local `app.user_id` GUC at each demo user in turn (`scope.ts`'s
// `asUser`, over `tx.raw()`, the documented raw-SQL escape hatch; `context.ts`'s
// `assertContextEstablished` only ever checks `app.request_id`, never `app.user_id`, so this is safe
// to change mid-transaction) around that user's rows, restoring it when done so a later seed module
// never inherits a stale value.
//
// Every id this module writes is named exactly once, in the `*Id(...)` helpers below, so `seed()` and
// `reset()` cannot drift apart.
import { inArray } from 'drizzle-orm'
import * as schema from '../../schema/personal.js'
import { DEMO_USERS } from '../fixtures.js'
import { demoId } from '../ids.js'
import { asUser } from '../scope.js'
import type { SeedModuleContext } from '../module-loader.js'
import type { Tx } from '../../context.js'

export const order = 500

const HEAD = DEMO_USERS.find((u) => u.role === 'head')!
const MEMBER = DEMO_USERS.find((u) => u.role === 'member')!

// A fake department-card id (TECH-SPEC §3.3: "link a personal task to a department card (id only)").
// Deliberately not a real `app.cards.id` -- the work board module has not shipped yet -- this only has
// to demonstrate that the column round-trips an opaque uuid.
const DEMO_LINKED_CARD_ID = demoId('work.card.quarterly-report')

/** Every demo timestamp sits around 2026-09 (MODULE-GUIDE.md "Seeds"), Asia/Tashkent (+05:00) to
 * match `DEMO_DEPARTMENT.timezone`. `days` is a whole-day offset from 2026-09-01 (a Tuesday);
 * `hour`/`minute` are wall-clock Tashkent time. Drizzle's default `timestamp` column mode expects a
 * JS `Date` (see `apps/api/src/db/repo.ts`'s `expiresAt`/`lastSeenAt` writes), never an ISO string. */
function demoDate(days: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 8, 1, hour - 5, minute, 0) + days * 24 * 60 * 60 * 1000)
}

type UserFixture = { id: string; key: string; givenName: string }

// --- ids ---------------------------------------------------------------------------------------
const TASK_NAMES = [
  'report-parent',
  'report-child-1',
  'report-child-2',
  'linked-card',
  'solo',
  'done',
  'rolled-over',
] as const
type TaskName = (typeof TASK_NAMES)[number]

// Two working days of pomodoro history, three focus/break pairs each, plus one unfinished focus
// session earlier "today".
const HISTORY_DAYS = [-3, -2] as const
const CYCLES_PER_DAY = 3

const sprintId = (key: string, which: 'week-current' | 'day-last'): string =>
  demoId(`personal.sprint.${key}.${which}`)
const taskId = (key: string, name: TaskName): string => demoId(`personal.task.${key}.${name}`)
const noteId = (key: string, which: 'ideas' | 'meeting'): string =>
  demoId(`personal.note.${key}.${which}`)
const canvasId = (key: string): string => demoId(`personal.canvas.${key}.planning`)
const pomodoroId = (key: string, kind: 'focus' | 'break', day: number, cycle: number): string =>
  demoId(`personal.pomodoro.${key}.${kind}.${day}.${cycle}`)
const pomodoroTodayId = (key: string): string => demoId(`personal.pomodoro.${key}.focus.today`)

function allPomodoroSessionIds(key: string): string[] {
  const ids: string[] = []
  for (const day of HISTORY_DAYS) {
    for (let cycle = 0; cycle < CYCLES_PER_DAY; cycle += 1) {
      ids.push(pomodoroId(key, 'focus', day, cycle), pomodoroId(key, 'break', day, cycle))
    }
  }
  ids.push(pomodoroTodayId(key))
  return ids
}

async function seedForUser(tx: Tx, user: UserFixture, opts: { headed: boolean }): Promise<number> {
  let rows = 0

  // -- Sprints: one active "week" sprint (this week) with a goal, one completed "day" sprint from
  // last week (rollover history) -- TECH-SPEC §3.3 "sprints (3h/day/week/custom) with a goal and
  // rollover".
  const weekSprintId = sprintId(user.key, 'week-current')
  const lastDaySprintId = sprintId(user.key, 'day-last')

  const insertedSprints = await tx.drizzle
    .insert(schema.personalSprints)
    .values([
      {
        id: weekSprintId,
        userId: user.id,
        kind: 'week',
        startsAt: demoDate(0, 0, 0),
        endsAt: demoDate(6, 23, 59),
        goal: opts.headed
          ? 'Boʻlim hisobotlarini yakunlash va jamoa yigʻilishiga tayyorgarlik'
          : 'Uchinchi choraklik hisobotni yakunlash',
        status: 'active',
      },
      {
        id: lastDaySprintId,
        userId: user.id,
        kind: 'day',
        startsAt: demoDate(-4, 9, 0),
        endsAt: demoDate(-4, 18, 0),
        goal: 'Elektron murojaatlarni koʻrib chiqish',
        status: 'completed',
      },
    ])
    .onConflictDoNothing()
    .returning({ id: schema.personalSprints.id })
  rows += insertedSprints.length

  // -- Nested tasks (checkboxes + drag order via `sort`; one subtree, one linked to a department
  // card, one rolled over from the completed sprint into the active one).
  const parentTaskId = taskId(user.key, 'report-parent')
  const soloTaskId = taskId(user.key, 'solo')

  const insertedTasks = await tx.drizzle
    .insert(schema.personalTasks)
    .values([
      {
        id: parentTaskId,
        userId: user.id,
        sprintId: weekSprintId,
        title: 'Choraklik hisobotni tayyorlash',
        sort: 0,
        estimateMin: 180,
      },
      {
        id: taskId(user.key, 'report-child-1'),
        userId: user.id,
        sprintId: weekSprintId,
        parentId: parentTaskId,
        title: 'Maʼlumotlarni boʻlimlardan yigʻish',
        doneAt: demoDate(1, 16, 0),
        sort: 0,
        estimateMin: 60,
      },
      {
        id: taskId(user.key, 'report-child-2'),
        userId: user.id,
        sprintId: weekSprintId,
        parentId: parentTaskId,
        title: 'Grafik va jadvallarni tayyorlash',
        sort: 1,
        estimateMin: 90,
      },
      {
        id: taskId(user.key, 'linked-card'),
        userId: user.id,
        sprintId: weekSprintId,
        title: 'Kartochka boʻyicha shaxsiy eslatma',
        notes: 'Boʻlim boshqarmasidagi umumiy kartaga bogʻliq shaxsiy qadam.',
        sort: 2,
        estimateMin: 30,
        linkedCardId: DEMO_LINKED_CARD_ID,
      },
      {
        id: soloTaskId,
        userId: user.id,
        sprintId: weekSprintId,
        title: opts.headed ? 'Yigʻilish kun tartibini yuborish' : 'Elektron pochtani tozalash',
        sort: 3,
        estimateMin: 20,
      },
      {
        id: taskId(user.key, 'done'),
        userId: user.id,
        sprintId: weekSprintId,
        title: 'Haftalik rejani yozish',
        doneAt: demoDate(0, 10, 0),
        sort: 4,
        estimateMin: 15,
      },
      {
        id: taskId(user.key, 'rolled-over'),
        userId: user.id,
        sprintId: lastDaySprintId,
        title: 'Arxivlanmagan murojaatlarni koʻrib chiqish',
        notes: 'Kunlik davrdan koʻchirildi.',
        sort: 0,
        estimateMin: 45,
      },
    ])
    .onConflictDoNothing()
    .returning({ id: schema.personalTasks.id })
  rows += insertedTasks.length

  // -- Notes.
  const insertedNotes = await tx.drizzle
    .insert(schema.personalNotes)
    .values([
      {
        id: noteId(user.key, 'ideas'),
        userId: user.id,
        title: 'Gʻoyalar roʻyxati',
        body: {
          text: '- Hisobotlar shablonini soddalashtirish\n- Yangi xodimlar uchun qisqa qoʻllanma\n- Har oyda bir marta jamoa uchrashuvi',
        },
        pinned: true,
      },
      {
        id: noteId(user.key, 'meeting'),
        userId: user.id,
        title: 'Yigʻilish qaydlari - 2026-09-02',
        body: {
          text: 'Muhokama qilindi: choraklik hisobot muddati, yangi murojaatlar tizimi, taʼtil jadvali.',
        },
        pinned: false,
      },
    ])
    .onConflictDoNothing()
    .returning({ id: schema.personalNotes.id })
  rows += insertedNotes.length

  // -- Canvas: a small scene (two rectangles + one arrow) plus a sticky-note overlay.
  const insertedCanvases = await tx.drizzle
    .insert(schema.personalCanvases)
    .values([
      {
        id: canvasId(user.key),
        userId: user.id,
        title: 'Reja doskasi',
        scene: {
          elements: [
            {
              id: 'el-1',
              type: 'rectangle',
              x: 80,
              y: 80,
              w: 220,
              h: 120,
              color: '#2f6fed',
              strokeWidth: 2,
            },
            {
              id: 'el-2',
              type: 'rectangle',
              x: 420,
              y: 80,
              w: 220,
              h: 120,
              color: '#1f9d55',
              strokeWidth: 2,
            },
            {
              id: 'el-3',
              type: 'arrow',
              x: 300,
              y: 140,
              w: 120,
              h: 0,
              color: '#6b7280',
              strokeWidth: 2,
            },
          ],
          appState: { zoom: 1, panX: 0, panY: 0 },
        },
        stickies: [
          {
            id: 'sticky-1',
            x: 100,
            y: 260,
            color: 'yellow',
            text: opts.headed ? 'Boshliq bilan kelishish' : 'Tekshirish kerak',
            rotation: -2,
          },
          {
            id: 'sticky-2',
            x: 360,
            y: 260,
            color: 'pink',
            text: 'Muddat: juma',
            rotation: 3,
          },
        ],
      },
    ])
    .onConflictDoNothing()
    .returning({ id: schema.personalCanvases.id })
  rows += insertedCanvases.length

  // -- Pomodoro settings (defaults for the member, a slightly customised set for the head) + a
  // realistic session log/stats history across the last few working days.
  const insertedSettings = await tx.drizzle
    .insert(schema.pomodoroSettings)
    .values([
      opts.headed
        ? {
            userId: user.id,
            focusMin: 30,
            shortBreakMin: 5,
            longBreakMin: 20,
            cyclesBeforeLong: 4,
            sound: 'bell',
            notifications: true,
            autoStart: false,
          }
        : {
            userId: user.id,
            focusMin: 25,
            shortBreakMin: 5,
            longBreakMin: 15,
            cyclesBeforeLong: 4,
            sound: 'chime',
            notifications: true,
            autoStart: true,
          },
    ])
    .onConflictDoNothing()
    .returning({ userId: schema.pomodoroSettings.userId })
  rows += insertedSettings.length

  const focusMin = opts.headed ? 30 : 25
  const shortBreakMin = 5
  const sessionRows: (typeof schema.pomodoroSessions.$inferInsert)[] = []
  for (const day of HISTORY_DAYS) {
    for (let cycle = 0; cycle < CYCLES_PER_DAY; cycle += 1) {
      const hour = 9 + cycle
      const focusStart = demoDate(day, hour, 0)
      const focusEnd = demoDate(day, hour, focusMin)
      sessionRows.push({
        id: pomodoroId(user.key, 'focus', day, cycle),
        userId: user.id,
        taskId: cycle === 0 ? parentTaskId : null,
        kind: 'focus',
        startedAt: focusStart,
        endedAt: focusEnd,
        completed: true,
      })
      sessionRows.push({
        id: pomodoroId(user.key, 'break', day, cycle),
        userId: user.id,
        taskId: null,
        kind: cycle === 2 ? 'long_break' : 'short_break',
        startedAt: focusEnd,
        endedAt: demoDate(day, hour, focusMin + shortBreakMin),
        completed: true,
      })
    }
  }
  // One in-progress-looking (uncompleted) focus session earlier today, for the stats/"today" view.
  sessionRows.push({
    id: pomodoroTodayId(user.key),
    userId: user.id,
    taskId: soloTaskId,
    kind: 'focus',
    startedAt: demoDate(0, 8, 30),
    endedAt: demoDate(0, 8, 47),
    completed: false,
  })

  const insertedSessions = await tx.drizzle
    .insert(schema.pomodoroSessions)
    .values(sessionRows)
    .onConflictDoNothing()
    .returning({ id: schema.pomodoroSessions.id })
  rows += insertedSessions.length

  return rows
}

/** Reverse of `seedForUser`: pomodoro sessions, settings, canvas, notes, tasks, sprints. The seven
 * tasks go in one statement -- `personal_tasks_parent_id_fkey` is a plain (non-deferrable, NO ACTION)
 * constraint, checked at the end of the statement, when parent and children are all already gone. */
async function resetForUser(tx: Tx, user: UserFixture): Promise<number> {
  let rows = 0

  const deletedSessions = await tx.drizzle
    .delete(schema.pomodoroSessions)
    .where(inArray(schema.pomodoroSessions.id, allPomodoroSessionIds(user.key)))
    .returning({ id: schema.pomodoroSessions.id })
  rows += deletedSessions.length

  const deletedSettings = await tx.drizzle
    .delete(schema.pomodoroSettings)
    .where(inArray(schema.pomodoroSettings.userId, [user.id]))
    .returning({ userId: schema.pomodoroSettings.userId })
  rows += deletedSettings.length

  const deletedCanvases = await tx.drizzle
    .delete(schema.personalCanvases)
    .where(inArray(schema.personalCanvases.id, [canvasId(user.key)]))
    .returning({ id: schema.personalCanvases.id })
  rows += deletedCanvases.length

  const deletedNotes = await tx.drizzle
    .delete(schema.personalNotes)
    .where(
      inArray(schema.personalNotes.id, [noteId(user.key, 'ideas'), noteId(user.key, 'meeting')]),
    )
    .returning({ id: schema.personalNotes.id })
  rows += deletedNotes.length

  const deletedTasks = await tx.drizzle
    .delete(schema.personalTasks)
    .where(
      inArray(
        schema.personalTasks.id,
        TASK_NAMES.map((name) => taskId(user.key, name)),
      ),
    )
    .returning({ id: schema.personalTasks.id })
  rows += deletedTasks.length

  const deletedSprints = await tx.drizzle
    .delete(schema.personalSprints)
    .where(
      inArray(schema.personalSprints.id, [
        sprintId(user.key, 'week-current'),
        sprintId(user.key, 'day-last'),
      ]),
    )
    .returning({ id: schema.personalSprints.id })
  rows += deletedSprints.length

  return rows
}

const HEAD_FIXTURE: UserFixture = { id: HEAD.id, key: 'head', givenName: HEAD.givenName }
const MEMBER_FIXTURE: UserFixture = { id: MEMBER.id, key: 'member', givenName: MEMBER.givenName }

export async function seed(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  let rows = 0
  rows += await asUser(tx, HEAD.id, () => seedForUser(tx, HEAD_FIXTURE, { headed: true }))
  rows += await asUser(tx, MEMBER.id, () => seedForUser(tx, MEMBER_FIXTURE, { headed: false }))
  return rows
}

export async function reset(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  let rows = 0
  rows += await asUser(tx, MEMBER.id, () => resetForUser(tx, MEMBER_FIXTURE))
  rows += await asUser(tx, HEAD.id, () => resetForUser(tx, HEAD_FIXTURE))
  return rows
}
