// F6 draft_event (v1.1 AI-AUDIT §3 F6). v1.0 produced five good fields and the dialog applied two of
// them (`event-form-dialog.tsx:171`), with a line of copy apologising for dropping the other three.
// v1.1 returns a *creatable* event: real dates computed from today, a location, a duration, an
// organiser checklist, a carpool decision — all of which the dialog now applies.
//
// The offline simulator used to emit four English checklist items and an English carpool paragraph
// regardless of locale, which in an Uzbek demo reads as broken software. It is now fully localised
// and date-correct.
import { z } from 'zod'
import {
  ANTI_FABRICATION_CONSTRAINT,
  TONE_CONSTRAINT,
  composePrompt,
  languageConstraint,
} from '../locale-prompt.js'
import { isoDateSchema, localeSchema } from '../schemas.js'
import { standardUserContent, type FeatureSpec, type ValidateOutcome } from '../feature-spec.js'
import type { Locale } from '../types.js'

export const eventCategorySchema = z.enum([
  'team_building',
  'sports',
  'volunteering',
  'social',
  'training',
  'family',
  'other',
])

export const draftEventInputSchema = z.object({
  locale: localeSchema,
  idea: z.string().min(1).max(500),
  category: eventCategorySchema.nullable().default(null),
  today: isoDateSchema,
  departmentSize: z.number().int().min(1).max(500).default(12),
  /** So it does not propose last month's picnic again. */
  recentEventTitles: z.array(z.string().min(1).max(300)).max(10).default([]),
})
export type DraftEventInput = z.infer<typeof draftEventInputSchema>

export const draftEventOutputSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(1200),
  location: z.string().max(200).nullable(),
  dateOptions: z
    .array(
      z.object({
        date: isoDateSchema,
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        durationMin: z.number().int().min(30).max(1440),
        label: z.string().min(1).max(80),
      }),
    )
    .min(2)
    .max(4),
  checklist: z.array(z.string().min(1).max(200)).min(4).max(8),
  carpool: z.object({ needed: z.boolean(), note: z.string().max(400) }),
  estimatedAttendees: z.number().int().min(1).max(500),
})
export type DraftEventOutput = z.infer<typeof draftEventOutputSchema>

const FEW_SHOT = `in : idea "Chorvoqda kuz sayli", category "team_building", today 2026-09-12 (Saturday), departmentSize 18, locale uz-Latn
out: {"title":"Chorvoqda kuzgi sayr",
 "description":"Boʻlim jamoasi bilan Chorvoq suv omborida bir kunlik dam olish. Ertalab yigʻilib chiqamiz, tushlik tabiatda. Oʻzingiz bilan issiq kiyim va sport oyoq kiyimini oling.",
 "location":"Chorvoq suv ombori",
 "dateOptions":[{"date":"2026-09-19","startTime":"09:00","durationMin":480,"label":"19-sentabr, shanba"},
                {"date":"2026-09-26","startTime":"09:00","durationMin":480,"label":"26-sentabr, shanba"},
                {"date":"2026-10-03","startTime":"09:00","durationMin":480,"label":"3-oktabr, shanba"}],
 "checklist":["Chorvoqda joy band qilish","Xodimlar sonini aniqlash","Ovqat va suv rejasini tuzish","Transportni tashkil qilish","Taklifnomani yuborish","Ob-havo prognozini tekshirish"],
 "carpool":{"needed":true,"note":"Chorvoq shahardan tashqarida — mashinasi borlardan necha joy boʻshligini soʻrang va qolganlarni yaqin yashovchi haydovchilarga biriktiring."},
 "estimatedAttendees":14}`

function systemPrompt(input: DraftEventInput): string {
  return composePrompt({
    role: 'You draft a department event for a ministry in Tashkent. You produce something the organiser can send after one edit, not a template. You know the local rhythm: the working week is Monday to Friday, team outings are usually Saturday, Chorvoq and Bostanliq are the standard weekend destinations outside the city, and transport is arranged by whoever has a car.',
    inputs: `A JSON object: idea, category (${input.category ?? 'not given'}), today (${input.today}, Asia/Tashkent), departmentSize (${input.departmentSize}), recentEventTitles.`,
    instructions: [
      'title: at most 60 characters, plain, no marketing tone.',
      'description: two to four sentences — what it is, where, what to bring.',
      `dateOptions: two to four REAL dates computed from ${input.today}, each strictly in the future, each with a start time and a duration in minutes. For team_building, social and family prefer Saturdays; for training and other work events prefer Monday to Friday. The label is the date written out in the answer's own language ("19-sentabr, shanba").`,
      'location: a concrete place name when the idea names one; null otherwise. Never a placeholder like "to be decided".',
      'checklist: four to eight organiser steps, verb-first, specific to this event — not a generic event-planning template.',
      'carpool.needed is true only when the location is outside Tashkent. The note says concretely how seats get matched to people.',
      `estimatedAttendees: a realistic number, never more than ${input.departmentSize}.`,
      'Never repeat a title from recentEventTitles.',
    ],
    constraints: [
      languageConstraint(input.locale),
      ANTI_FABRICATION_CONSTRAINT,
      TONE_CONSTRAINT,
      'SHAPE. Never invent a price, a hired bus, or a permission you were not told about. Never name a person. No emoji anywhere.',
    ],
    examples: FEW_SHOT,
    toolName: 'emit_event_draft',
  })
}

// -- Offline simulator ------------------------------------------------------------------------

const MONTH_NAMES: Record<Locale, readonly string[]> = {
  'uz-Latn': [
    'yanvar',
    'fevral',
    'mart',
    'aprel',
    'may',
    'iyun',
    'iyul',
    'avgust',
    'sentabr',
    'oktabr',
    'noyabr',
    'dekabr',
  ],
  'uz-Cyrl': [
    'январ',
    'феврал',
    'март',
    'апрел',
    'май',
    'июн',
    'июл',
    'август',
    'сентабр',
    'октабр',
    'ноябр',
    'декабр',
  ],
  ru: [
    'января',
    'февраля',
    'марта',
    'апреля',
    'мая',
    'июня',
    'июля',
    'августа',
    'сентября',
    'октября',
    'ноября',
    'декабря',
  ],
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
}

const WEEKDAY_NAMES: Record<Locale, readonly string[]> = {
  'uz-Latn': ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'],
  'uz-Cyrl': ['якшанба', 'душанба', 'сешанба', 'чоршанба', 'пайшанба', 'жума', 'шанба'],
  ru: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay()
}

function labelFor(iso: string, locale: Locale): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const day = d.getUTCDate()
  const month = MONTH_NAMES[locale][d.getUTCMonth()]!
  const weekday = WEEKDAY_NAMES[locale][d.getUTCDay()]!
  if (locale === 'en') return `${month} ${day}, ${weekday}`
  if (locale === 'ru') return `${day} ${month}, ${weekday}`
  return `${day}-${month}, ${weekday}`
}

/** Next `count` occurrences of `weekday`, strictly after `today`. */
function nextWeekdays(today: string, weekday: number, count: number): string[] {
  const out: string[] = []
  let cursor = today
  while (out.length < count) {
    cursor = addDays(cursor, 1)
    if (weekdayOf(cursor) === weekday) out.push(cursor)
  }
  return out
}

/** Next `count` working days, strictly after `today`. */
function nextWorkingDays(today: string, count: number): string[] {
  const out: string[] = []
  let cursor = today
  while (out.length < count) {
    cursor = addDays(cursor, 1)
    const day = weekdayOf(cursor)
    if (day >= 1 && day <= 5) out.push(cursor)
  }
  return out
}

type Phrases = {
  descriptionOutdoor: (what: string, where: string) => string
  descriptionIndoor: (what: string) => string
  checklist: (where: string | null) => string[]
  carpoolNeeded: (where: string) => string
  carpoolNotNeeded: string
}

const PHRASES: Record<Locale, Phrases> = {
  'uz-Latn': {
    descriptionOutdoor: (what, where) =>
      `Boʻlim jamoasi bilan ${where}da ${what.toLowerCase()}. Ertalab yigʻilib chiqamiz, tushlik tabiatda. Oʻzingiz bilan issiq kiyim va qulay oyoq kiyimini oling.`,
    descriptionIndoor: (what) =>
      `Boʻlim xodimlari uchun ${what.toLowerCase()}. Qatnashish ixtiyoriy, lekin oldindan javob berishingizni soʻraymiz — joylar soni cheklangan.`,
    checklist: (where) => [
      where ? `${where}da joy band qilish` : 'Xona va vaqtni band qilish',
      'Xodimlar sonini aniqlash',
      'Ovqat va suv rejasini tuzish',
      'Taklifnomani yuborish',
      'Ob-havo prognozini tekshirish',
      'Tadbirdan keyin fikr-mulohaza yigʻish',
    ],
    carpoolNeeded: (where) =>
      `${where} shahardan tashqarida — mashinasi borlardan necha joy boʻshligini soʻrang va qolganlarni yaqin yashovchi haydovchilarga biriktiring.`,
    carpoolNotNeeded: 'Tadbir shahar ichida — alohida transport kerak emas.',
  },
  'uz-Cyrl': {
    descriptionOutdoor: (what, where) =>
      `Бўлим жамоаси билан ${where}да ${what.toLowerCase()}. Эрталаб йиғилиб чиқамиз, тушлик табиатда. Ўзингиз билан иссиқ кийим ва қулай оёқ кийимини олинг.`,
    descriptionIndoor: (what) =>
      `Бўлим ходимлари учун ${what.toLowerCase()}. Қатнашиш ихтиёрий, лекин олдиндан жавоб беришингизни сўраймиз — жойлар сони чекланган.`,
    checklist: (where) => [
      where ? `${where}да жой банд қилиш` : 'Хона ва вақтни банд қилиш',
      'Ходимлар сонини аниқлаш',
      'Овқат ва сув режасини тузиш',
      'Таклифномани юбориш',
      'Об-ҳаво прогнозини текшириш',
      'Тадбирдан кейин фикр-мулоҳаза йиғиш',
    ],
    carpoolNeeded: (where) =>
      `${where} шаҳардан ташқарида — машинаси борлардан неча жой бўшлигини сўранг ва қолганларни яқин яшовчи ҳайдовчиларга бириктиринг.`,
    carpoolNotNeeded: 'Тадбир шаҳар ичида — алоҳида транспорт керак эмас.',
  },
  ru: {
    descriptionOutdoor: (what, where) =>
      `Выезд отдела: ${what.toLowerCase()} в районе «${where}». Выезжаем утром, обед на природе. Возьмите тёплую одежду и удобную обувь.`,
    descriptionIndoor: (what) =>
      `Для сотрудников отдела: ${what.toLowerCase()}. Участие добровольное, но просим ответить заранее — число мест ограничено.`,
    checklist: (where) => [
      where ? `Забронировать место в «${where}»` : 'Забронировать помещение и время',
      'Уточнить число участников',
      'Составить план по еде и воде',
      'Разослать приглашение',
      'Проверить прогноз погоды',
      'Собрать отзывы после мероприятия',
    ],
    carpoolNeeded: (where) =>
      `«${where}» за городом — спросите у владельцев машин, сколько мест свободно, и распределите остальных по ближайшим водителям.`,
    carpoolNotNeeded: 'Мероприятие в черте города — отдельный транспорт не нужен.',
  },
  en: {
    descriptionOutdoor: (what, where) =>
      `A department outing: ${what.toLowerCase()} at ${where}. We leave together in the morning and eat outdoors. Bring warm clothes and comfortable shoes.`,
    descriptionIndoor: (what) =>
      `For the department: ${what.toLowerCase()}. Attendance is voluntary, but please answer in advance — places are limited.`,
    checklist: (where) => [
      where ? `Book the venue at ${where}` : 'Book the room and the time',
      'Confirm how many people are coming',
      'Plan the food and water',
      'Send the invitation',
      'Check the weather forecast',
      'Collect feedback afterwards',
    ],
    carpoolNeeded: (where) =>
      `${where} is outside the city — ask who is driving, how many seats are free, and match the rest to the nearest driver.`,
    carpoolNotNeeded: 'The event is inside the city — no separate transport is needed.',
  },
}

/** Place names in and around Tashkent that genuinely imply a drive. Deliberately a short, honest
 * list rather than a geocoder: the point is "did the idea name somewhere out of town", and a wrong
 * "no" here costs a toggle the organiser can flip. */
const OUT_OF_TOWN =
  /(chorvoq|charvak|чорвоқ|чарвак|bostonliq|bo['ʻ]stonliq|бўстонлиқ|chimyon|чимён|chimgan|чимган|amirsoy|амирсой|zomin|зомин|beldersoy|белдерсой)/i

function extractPlace(idea: string): string | null {
  const match = OUT_OF_TOWN.exec(idea)
  if (!match) return null
  const word = match[0]
  return word.charAt(0).toUpperCase() + word.slice(1)
}

function simulate(input: DraftEventInput): DraftEventOutput {
  const p = PHRASES[input.locale]
  const place = extractPlace(input.idea)
  const outdoor = place !== null
  const weekendish =
    input.category === 'team_building' ||
    input.category === 'social' ||
    input.category === 'family' ||
    input.category === null
  const dates = weekendish ? nextWeekdays(input.today, 6, 3) : nextWorkingDays(input.today, 3)

  const idea = input.idea.trim()
  let title = idea.length > 60 ? `${idea.slice(0, 57)}…` : idea
  title = title.charAt(0).toUpperCase() + title.slice(1)
  if (
    input.recentEventTitles.some((recent) => recent.trim().toLowerCase() === title.toLowerCase())
  ) {
    const d = new Date(`${dates[0]!}T00:00:00Z`)
    title = `${title} — ${MONTH_NAMES[input.locale][d.getUTCMonth()]!}`
  }

  return {
    title,
    description: outdoor ? p.descriptionOutdoor(idea, place) : p.descriptionIndoor(idea),
    location: place,
    dateOptions: dates.map((date) => ({
      date,
      startTime: outdoor ? '09:00' : '15:00',
      durationMin: outdoor ? 480 : 120,
      label: labelFor(date, input.locale),
    })),
    checklist: p.checklist(place).slice(0, 6),
    carpool: outdoor
      ? { needed: true, note: p.carpoolNeeded(place) }
      : { needed: false, note: p.carpoolNotNeeded },
    estimatedAttendees: Math.max(1, Math.round(input.departmentSize * 0.75)),
  }
}

function validateOutput(
  input: DraftEventInput,
  output: DraftEventOutput,
): ValidateOutcome<DraftEventOutput> {
  const future = output.dateOptions.filter((option) => option.date > input.today)
  if (future.length < 2) {
    return {
      ok: false,
      error: `dateOptions must contain at least two dates strictly after ${input.today}. You returned ${output.dateOptions.map((o) => o.date).join(', ')}.`,
    }
  }
  const recent = new Set(input.recentEventTitles.map((title) => title.trim().toLowerCase()))
  if (recent.has(output.title.trim().toLowerCase())) {
    return { ok: false, error: 'title repeats one of recentEventTitles. Propose a different one.' }
  }
  return {
    ok: true,
    output: {
      ...output,
      dateOptions: future,
      estimatedAttendees: Math.min(output.estimatedAttendees, input.departmentSize),
    },
  }
}

export const draftEventSpec: FeatureSpec<DraftEventInput, DraftEventOutput> = {
  feature: 'draft_event',
  inputSchema: draftEventInputSchema,
  outputSchema: draftEventOutputSchema,
  toolName: 'emit_event_draft',
  toolDescription:
    'Emit a complete, creatable department event draft: title, description, location, real dated time options, an organiser checklist, a carpool decision and an attendance estimate.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: [
      'title',
      'description',
      'location',
      'dateOptions',
      'checklist',
      'carpool',
      'estimatedAttendees',
    ],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 120 },
      description: { type: 'string', minLength: 1, maxLength: 1200 },
      location: { type: ['string', 'null'], maxLength: 200 },
      dateOptions: {
        type: 'array',
        minItems: 2,
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['date', 'startTime', 'durationMin', 'label'],
          properties: {
            date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            startTime: { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
            durationMin: { type: 'integer', minimum: 30, maximum: 1440 },
            label: { type: 'string', maxLength: 80 },
          },
        },
      },
      checklist: {
        type: 'array',
        minItems: 4,
        maxItems: 8,
        items: { type: 'string', maxLength: 200 },
      },
      carpool: {
        type: 'object',
        additionalProperties: false,
        required: ['needed', 'note'],
        properties: {
          needed: { type: 'boolean' },
          note: { type: 'string', maxLength: 400 },
        },
      },
      estimatedAttendees: { type: 'integer', minimum: 1, maximum: 500 },
    },
  },
  defaultMaxTokens: 1792,
  temperature: 0.35,
  systemPrompt,
  buildUserContent: standardUserContent,
  validateOutput,
  simulate,
}
