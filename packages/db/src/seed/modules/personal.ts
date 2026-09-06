// Demo seed for the personal workspace (MODULE-GUIDE.md "Seeds", TECH-SPEC §3.3). Runs after
// `core.ts` (order 0) since it references `DEMO_USERS`' ids.
//
// Every table this module writes to is owner-only under RLS with NO super_admin/view-as carve-out
// (I-1 -- see `migrations/0500_personal.sql`), but `runSeedDemo`'s outer transaction runs under a
// fixed `demoContext()` (`app.user_id` GUC unset, `app.actor_role` = `super_admin`) so that a single
// transaction can seed rows for the department/users/memberships every module's fixtures point at.
// That context alone cannot write a row into any table in this file: `with check (user_id =
// app.current_user_id())` would reject it. So this module briefly re-points the transaction-local
// `app.user_id` GUC at each demo user in turn (`tx.raw()` is the documented raw-SQL escape hatch,
// `context.ts`'s `assertContextEstablished` only ever checks `app.request_id`, never `app.user_id`,
// so this is safe to change mid-transaction) before writing that user's rows, and restores it to
// empty when done so a later seed module never inherits a stale value.
import { sql } from 'drizzle-orm'
import * as schema from '../../schema/personal.js'
import { DEMO_USERS } from '../fixtures.js'
import { demoId } from '../ids.js'
import type { SeedModuleContext } from '../module-loader.js'
import type { Tx } from '../../context.js'

export const order = 500

const HEAD = DEMO_USERS.find((u) => u.role === 'head')!
const MEMBER = DEMO_USERS.find((u) => u.role === 'member')!

// A fake department-card id (TECH-SPEC §3.3: "link a personal task to a department card (id only)").
// Deliberately not a real `app.cards.id` -- the work board module has not shipped yet -- this only has
// to demonstrate that the column round-trips an opaque uuid.
const DEMO_LINKED_CARD_ID = demoId('work.card.quarterly-report')

async function setSeedUser(tx: Tx, userId: string | null): Promise<void> {
  await tx.raw(sql`select set_config('app.user_id', ${userId ?? ''}, true)`)
}

/** Every demo timestamp sits around 2026-09 (MODULE-GUIDE.md "Seeds"), Asia/Tashkent (+05:00) to
 * match `DEMO_DEPARTMENT.timezone`. `days` is a whole-day offset from 2026-09-01 (a Tuesday);
 * `hour`/`minute` are wall-clock Tashkent time. Drizzle's default `timestamp` column mode expects a
 * JS `Date` (see `apps/api/src/db/repo.ts`'s `expiresAt`/`lastSeenAt` writes), never an ISO string. */
function demoDate(days: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 8, 1, hour - 5, minute, 0) + days * 24 * 60 * 60 * 1000)
}

type UserFixture = { id: string; key: string; givenName: string }

async function seedForUser(tx: Tx, user: UserFixture, opts: { headed: boolean }): Promise<number> {
  await setSeedUser(tx, user.id)
  let rows = 0

  // -- Sprints: one active "week" sprint (this week) with a goal, one completed "day" sprint from
  // last week (rollover history) -- TECH-SPEC §3.3 "sprints (3h/day/week/custom) with a goal and
  // rollover".
  const weekSprintId = demoId(`personal.sprint.${user.key}.week-current`)
  const lastDaySprintId = demoId(`personal.sprint.${user.key}.day-last`)

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
          ? "Bo'lim hisobotlarini yakunlash va jamoa yig'ilishiga tayyorgarlik"
          : 'Uchinchi choraklik hisobotni yakunlash',
        status: 'active',
      },
      {
        id: lastDaySprintId,
        userId: user.id,
        kind: 'day',
        startsAt: demoDate(-4, 9, 0),
        endsAt: demoDate(-4, 18, 0),
        goal: "Elektron murojaatlarni ko'rib chiqish",
        status: 'completed',
      },
    ])
    .onConflictDoNothing()
    .returning({ id: schema.personalSprints.id })
  rows += insertedSprints.length

  // -- Nested tasks (checkboxes + drag order via `sort`; one subtree, one linked to a department
  // card, one rolled over from the completed sprint into the active one).
  const parentTaskId = demoId(`personal.task.${user.key}.report-parent`)
  const childTask1Id = demoId(`personal.task.${user.key}.report-child-1`)
  const childTask2Id = demoId(`personal.task.${user.key}.report-child-2`)
  const linkedTaskId = demoId(`personal.task.${user.key}.linked-card`)
  const soloTaskId = demoId(`personal.task.${user.key}.solo`)
  const doneTaskId = demoId(`personal.task.${user.key}.done`)
  const rolledOverTaskId = demoId(`personal.task.${user.key}.rolled-over`)

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
        id: childTask1Id,
        userId: user.id,
        sprintId: weekSprintId,
        parentId: parentTaskId,
        title: "Ma'lumotlarni bo'limlardan yig'ish",
        doneAt: demoDate(1, 16, 0),
        sort: 0,
        estimateMin: 60,
      },
      {
        id: childTask2Id,
        userId: user.id,
        sprintId: weekSprintId,
        parentId: parentTaskId,
        title: 'Grafik va jadvallarni tayyorlash',
        sort: 1,
        estimateMin: 90,
      },
      {
        id: linkedTaskId,
        userId: user.id,
        sprintId: weekSprintId,
        title: "Kartochka bo'yicha shaxsiy eslatma",
        notes: "Bo'lim boshqarmasidagi umumiy kartaga bog'liq shaxsiy qadam.",
        sort: 2,
        estimateMin: 30,
        linkedCardId: DEMO_LINKED_CARD_ID,
      },
      {
        id: soloTaskId,
        userId: user.id,
        sprintId: weekSprintId,
        title: opts.headed ? "Yig'ilish kun tartibini yuborish" : 'Elektron pochtani tozalash',
        sort: 3,
        estimateMin: 20,
      },
      {
        id: doneTaskId,
        userId: user.id,
        sprintId: weekSprintId,
        title: 'Haftalik rejani yozish',
        doneAt: demoDate(0, 10, 0),
        sort: 4,
        estimateMin: 15,
      },
      {
        id: rolledOverTaskId,
        userId: user.id,
        sprintId: lastDaySprintId,
        title: "Arxivlanmagan murojaatlarni ko'rib chiqish",
        notes: "Kunlik sprintdan o'tkazildi.",
        sort: 0,
        estimateMin: 45,
      },
    ])
    .onConflictDoNothing()
    .returning({ id: schema.personalTasks.id })
  rows += insertedTasks.length

  // -- Notes.
  const noteIdeasId = demoId(`personal.note.${user.key}.ideas`)
  const noteMeetingId = demoId(`personal.note.${user.key}.meeting`)

  const insertedNotes = await tx.drizzle
    .insert(schema.personalNotes)
    .values([
      {
        id: noteIdeasId,
        userId: user.id,
        title: "G'oyalar ro'yxati",
        body: {
          text: "- Hisobotlar shablonini soddalashtirish\n- Yangi xodimlar uchun qisqa qo'llanma\n- Har oyda bir marta jamoa uchrashuvi",
        },
        pinned: true,
      },
      {
        id: noteMeetingId,
        userId: user.id,
        title: "Yig'ilish qaydlari - 2026-09-02",
        body: {
          text: "Muhokama qilindi: choraklik hisobot muddati, yangi murojaatlar tizimi, ta'til jadvali.",
        },
        pinned: false,
      },
    ])
    .onConflictDoNothing()
    .returning({ id: schema.personalNotes.id })
  rows += insertedNotes.length

  // -- Canvas: a small scene (two rectangles + one arrow) plus a sticky-note overlay.
  const canvasId = demoId(`personal.canvas.${user.key}.planning`)
  const insertedCanvases = await tx.drizzle
    .insert(schema.personalCanvases)
    .values([
      {
        id: canvasId,
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
  // Two working days of history, three focus/break pairs each.
  for (let day = -3; day <= -2; day += 1) {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const hour = 9 + cycle
      const focusStart = demoDate(day, hour, 0)
      const focusEnd = demoDate(day, hour, focusMin)
      sessionRows.push({
        id: demoId(`personal.pomodoro.${user.key}.focus.${day}.${cycle}`),
        userId: user.id,
        taskId: cycle === 0 ? parentTaskId : null,
        kind: 'focus',
        startedAt: focusStart,
        endedAt: focusEnd,
        completed: true,
      })
      sessionRows.push({
        id: demoId(`personal.pomodoro.${user.key}.break.${day}.${cycle}`),
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
    id: demoId(`personal.pomodoro.${user.key}.focus.today`),
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

export async function seed(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  let rows = 0
  try {
    rows += await seedForUser(
      tx,
      { id: HEAD.id, key: 'head', givenName: HEAD.givenName },
      {
        headed: true,
      },
    )
    rows += await seedForUser(
      tx,
      { id: MEMBER.id, key: 'member', givenName: MEMBER.givenName },
      {
        headed: false,
      },
    )
  } finally {
    // Restore the transaction-local GUC so a later seed module (higher `order`) never inherits this
    // module's last user_id instead of `demoContext()`'s own (unset) value.
    await setSeedUser(tx, null)
  }
  return rows
}
