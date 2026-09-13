// Demo seed for custom fields (v1.1 SPEC §5, §12): two person fields ("Taʼlim", "Chet tillari") and
// one card field ("Baholangan soat"), some answers filled in and some deliberately left empty, plus
// two open fill requests -- so the field manager opens on a real progress bar, "Notify to fill" has
// somebody to ask, and `/account` has something for a xodim to answer.
//
// `order: 950` -- after `core.ts` (0, the department and the two demo accounts), `work.ts` (90, the
// roster of 14 extra members and the cards the estimate field hangs off) and `structure.ts` (100).
//
// Idempotence (MODULE-GUIDE.md "DB: seeds"): every definition and every person value carries a
// deterministic `demoId(...)`, so a second `seed:demo` writes zero rows. Card values are matched to
// whichever cards `work.ts` actually wrote, so their ids are derived from the card id itself
// (`md5(def || card)`), which is just as stable across runs -- and `reset()` deletes them by
// `def_id`, which is exactly the set this module wrote and nothing else.
import { inArray, sql } from 'drizzle-orm'
import { DEMO_DEPARTMENT, DEMO_MEMBERSHIPS, DEMO_USERS } from '../fixtures.js'
import { WORK_DEMO_USERS } from '../work-fixtures.js'
import { demoId } from '../ids.js'
import type { SeedModuleContext } from '../module-loader.js'
import * as schema from '../../schema/fields.js'
import { DEMO_NOW } from '../clock.js'

export const order = 950

const DEPARTMENT_ID = DEMO_DEPARTMENT.id
const HEAD_USER_ID = DEMO_USERS.find((u) => u.role === 'head')!.id
const MEMBER_USER_ID = DEMO_USERS.find((u) => u.role === 'member')!.id

const EDUCATION_DEF_ID = demoId('fields.def.talim')
const LANGUAGES_DEF_ID = demoId('fields.def.tillar')
const ESTIMATE_DEF_ID = demoId('fields.def.baholangan_soat')

const DEF_IDS = [EDUCATION_DEF_ID, LANGUAGES_DEF_ID, ESTIMATE_DEF_ID]

/** Every membership in the demo department: the two `fixtures.ts` accounts plus `work.ts`'s roster.
 * Their ids are the subject of a person value (SPEC §5: a person value hangs off the membership). */
const MEMBERSHIP_IDS: readonly { membershipId: string; userId: string }[] = [
  ...DEMO_MEMBERSHIPS.map((m) => ({ membershipId: m.id, userId: m.userId })),
  ...WORK_DEMO_USERS.map((u) => ({
    membershipId: demoId(`work.membership.${u.login}`),
    userId: u.id,
  })),
]

const DEFS = [
  {
    id: EDUCATION_DEF_ID,
    departmentId: DEPARTMENT_ID,
    appliesTo: 'person',
    key: 'talim',
    label: {
      'uz-Latn': 'Taʼlim',
      'uz-Cyrl': 'Таълим',
      ru: 'Образование',
      en: 'Education',
    },
    description: {
      'uz-Latn': 'Eng yuqori tugallangan taʼlim bosqichi.',
      'uz-Cyrl': 'Энг юқори тугалланган таълим босқичи.',
      ru: 'Наивысшая завершённая ступень образования.',
      en: 'The highest level of education completed.',
    },
    type: 'select',
    options: [
      {
        id: 'bakalavr',
        label: { 'uz-Latn': 'Bakalavr', 'uz-Cyrl': 'Бакалавр', ru: 'Бакалавр', en: 'Bachelor' },
        colorToken: 'blue',
        order: 0,
      },
      {
        id: 'magistr',
        label: { 'uz-Latn': 'Magistr', 'uz-Cyrl': 'Магистр', ru: 'Магистр', en: 'Master' },
        colorToken: 'violet',
        order: 1,
      },
      {
        id: 'ilmiy_daraja',
        label: {
          'uz-Latn': 'Ilmiy daraja',
          'uz-Cyrl': 'Илмий даража',
          ru: 'Учёная степень',
          en: 'Doctorate',
        },
        colorToken: 'green',
        order: 2,
      },
    ],
    required: true,
    showInTable: true,
    showOnCardTile: false,
    selfEditable: true,
    visibleTo: 'everyone',
    sort: 0,
    reminderDays: 3,
    createdByUserId: HEAD_USER_ID,
  },
  {
    id: LANGUAGES_DEF_ID,
    departmentId: DEPARTMENT_ID,
    appliesTo: 'person',
    key: 'tillar',
    label: {
      'uz-Latn': 'Chet tillari',
      'uz-Cyrl': 'Чет тиллари',
      ru: 'Иностранные языки',
      en: 'Languages',
    },
    description: {
      'uz-Latn': 'Ish yuzasidan foydalana oladigan tillaringiz.',
      'uz-Cyrl': 'Иш юзасидан фойдалана оладиган тилларингиз.',
      ru: 'Языки, которыми вы пользуетесь в работе.',
      en: 'Languages you can work in.',
    },
    type: 'multi_select',
    options: [
      {
        id: 'ruscha',
        label: { 'uz-Latn': 'Ruscha', 'uz-Cyrl': 'Русча', ru: 'Русский', en: 'Russian' },
        colorToken: 'amber',
        order: 0,
      },
      {
        id: 'inglizcha',
        label: { 'uz-Latn': 'Inglizcha', 'uz-Cyrl': 'Инглизча', ru: 'Английский', en: 'English' },
        colorToken: 'teal',
        order: 1,
      },
      {
        id: 'turkcha',
        label: { 'uz-Latn': 'Turkcha', 'uz-Cyrl': 'Турқча', ru: 'Турецкий', en: 'Turkish' },
        colorToken: 'pink',
        order: 2,
      },
    ],
    required: false,
    showInTable: true,
    showOnCardTile: false,
    selfEditable: true,
    visibleTo: 'everyone',
    sort: 1,
    reminderDays: 3,
    createdByUserId: HEAD_USER_ID,
  },
  {
    id: ESTIMATE_DEF_ID,
    departmentId: DEPARTMENT_ID,
    appliesTo: 'card',
    key: 'baholangan_soat',
    label: {
      'uz-Latn': 'Baholangan soat',
      'uz-Cyrl': 'Баҳоланган соат',
      ru: 'Оценка, часов',
      en: 'Estimate (hours)',
    },
    description: {
      'uz-Latn': 'Vazifaga qancha vaqt ketishi kutilmoqda.',
      'uz-Cyrl': 'Вазифага қанча вақт кетиши кутилмоқда.',
      ru: 'Сколько времени, по оценке, займёт задача.',
      en: 'How long this task is expected to take.',
    },
    type: 'number',
    options: [],
    required: false,
    showInTable: true,
    showOnCardTile: true,
    selfEditable: true,
    visibleTo: 'everyone',
    sort: 0,
    reminderDays: 3,
    createdByUserId: HEAD_USER_ID,
  },
] as const

/** Fourteen of the sixteen colleagues have answered "Taʼlim" and eleven of them also listed
 * languages: a field the department has actually adopted looks like a progress bar near the end, not
 * near the start. The two who have not answered are the newcomer, who joined six days ago, and
 * Ulugʻbek, who has simply not got round to it -- which is what gives the head's "Toʻldirishni
 * soʻrash" button two real people to ask instead of a hypothetical. */
const EDUCATION_ANSWERS: readonly [number, string][] = [
  [0, 'ilmiy_daraja'],
  [1, 'magistr'],
  [2, 'bakalavr'],
  [3, 'magistr'],
  [4, 'magistr'],
  [5, 'bakalavr'],
  [6, 'magistr'],
  [7, 'magistr'],
  [8, 'bakalavr'],
  [9, 'ilmiy_daraja'],
  [10, 'bakalavr'],
  [11, 'magistr'],
  [12, 'bakalavr'],
  [13, 'magistr'],
]

const LANGUAGE_ANSWERS: readonly [number, string[]][] = [
  [0, ['ruscha', 'inglizcha']],
  [1, ['ruscha']],
  [2, ['inglizcha']],
  [3, ['inglizcha', 'turkcha']],
  [4, ['ruscha', 'inglizcha']],
  [5, ['ruscha']],
  [6, ['inglizcha']],
  [8, ['ruscha']],
  [9, ['ruscha', 'inglizcha']],
  [11, ['ruscha']],
  [12, ['inglizcha', 'turkcha']],
]

/** The two people the head is still waiting on. Feruza (index 15) is the newcomer -- her row is the
 * one the presenter presses "Soʻrash" on, and the Telegram message that arrives is the moment the
 * demo is built around. Ulugʻbek (14) was asked three days ago, so the reminder sweep has something
 * real to find as well. */
const OPEN_REQUESTS: readonly [number, number][] = [
  [15, 1],
  [14, 3],
]

const NOW = DEMO_NOW

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60_000)
}

export async function seed(ctx: SeedModuleContext): Promise<number> {
  const defs = await ctx.tx.drizzle
    .insert(schema.fieldDefs)
    .values(DEFS.map((d) => ({ ...d, options: [...d.options] })))
    .onConflictDoNothing()
    .returning({ id: schema.fieldDefs.id })

  const personValues = [
    ...EDUCATION_ANSWERS.map(([index, value]) => ({
      id: demoId(`fields.value.talim.${index}`),
      departmentId: DEPARTMENT_ID,
      defId: EDUCATION_DEF_ID,
      subjectType: 'person',
      subjectId: MEMBERSHIP_IDS[index]!.membershipId,
      subjectUserId: MEMBERSHIP_IDS[index]!.userId,
      headOnly: false,
      value,
      updatedByUserId: MEMBERSHIP_IDS[index]!.userId,
    })),
    ...LANGUAGE_ANSWERS.map(([index, value]) => ({
      id: demoId(`fields.value.tillar.${index}`),
      departmentId: DEPARTMENT_ID,
      defId: LANGUAGES_DEF_ID,
      subjectType: 'person',
      subjectId: MEMBERSHIP_IDS[index]!.membershipId,
      subjectUserId: MEMBERSHIP_IDS[index]!.userId,
      headOnly: false,
      value: [...value],
      updatedByUserId: MEMBERSHIP_IDS[index]!.userId,
    })),
  ]

  const values = await ctx.tx.drizzle
    .insert(schema.fieldValues)
    .values(personValues)
    .onConflictDoNothing()
    .returning({ id: schema.fieldValues.id })

  // Card estimates: matched to whatever `work.ts` actually seeded, with a deterministic id derived
  // from the card's own id. One statement, never one insert per card (I-14).
  const cardValues = await ctx.tx.raw<{ id: string }>(sql`
    insert into app.field_values (
      id, department_id, def_id, subject_type, subject_id, head_only, value, updated_by_user_id,
      updated_at
    )
    select md5(${ESTIMATE_DEF_ID}::text || c.id::text)::uuid,
           ${DEPARTMENT_ID}::uuid,
           ${ESTIMATE_DEF_ID}::uuid,
           'card',
           c.id,
           false,
           to_jsonb(((c.rn % 5) + 2) * 2),
           ${HEAD_USER_ID}::uuid,
           ${NOW.toISOString()}::timestamptz
    from (
      select id, row_number() over (order by id) as rn
      from app.cards
      where department_id = ${DEPARTMENT_ID} and deleted_at is null
      order by id
      limit 14
    ) as c
    on conflict do nothing
    returning id
  `)

  const requests = await ctx.tx.drizzle
    .insert(schema.fieldRequests)
    .values(
      OPEN_REQUESTS.map(([index, agoDays]) => ({
        id: demoId(`fields.request.talim.${index}`),
        departmentId: DEPARTMENT_ID,
        defId: EDUCATION_DEF_ID,
        userId: MEMBERSHIP_IDS[index]!.userId,
        requestedByUserId: HEAD_USER_ID,
        requestedAt: daysAgo(agoDays),
      })),
    )
    .onConflictDoNothing()
    .returning({ id: schema.fieldRequests.id })

  return defs.length + values.length + cardValues.length + requests.length
}

export async function reset(ctx: SeedModuleContext): Promise<number> {
  const requests = await ctx.tx.drizzle
    .delete(schema.fieldRequests)
    .where(inArray(schema.fieldRequests.defId, DEF_IDS))
    .returning({ id: schema.fieldRequests.id })

  // By `def_id`, not by id: the card values' ids are derived from card ids this module does not own,
  // and "every value of one of my three definitions" is exactly the set `seed()` wrote.
  const values = await ctx.tx.drizzle
    .delete(schema.fieldValues)
    .where(inArray(schema.fieldValues.defId, DEF_IDS))
    .returning({ id: schema.fieldValues.id })

  const defs = await ctx.tx.drizzle
    .delete(schema.fieldDefs)
    .where(inArray(schema.fieldDefs.id, DEF_IDS))
    .returning({ id: schema.fieldDefs.id })

  return requests.length + values.length + defs.length
}

/** Exported for the demo walkthrough and the `fields` module's own integration checks: which member
 * still owes the head an answer, without re-deriving the arrays above. */
export const DEMO_FIELD_IDS = Object.freeze({
  education: EDUCATION_DEF_ID,
  languages: LANGUAGES_DEF_ID,
  estimate: ESTIMATE_DEF_ID,
  memberUserId: MEMBER_USER_ID,
})
