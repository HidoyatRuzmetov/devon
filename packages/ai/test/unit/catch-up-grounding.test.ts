// v1.1 critique SEV1 #4 -- the golden case the adjudication asked for by name: "the briefing's
// headline counts equal the tile counts for a fixed fixture".
//
// What happened: the head's dashboard rendered "Maqsadlar 82/120" and "Farrux Saidov: 7 kechikgan"
// while the AI xulosa beside it said "За прошедшую неделю не закрыто ни одной задачи — без изменений
// по сравнению с предыдущей неделей. В управлении 77 просроченных задач." The briefing was not
// hallucinating: `head-dashboard.tsx` was passing `doneLastPeriod: 0` and `created: 0` as literals,
// so "no change against the previous week" was arithmetic on a placeholder and would have said that
// forever; and the 77 was the department's real overdue total, computed on the dashboard and then
// never rendered anywhere on it.
//
// The fix is upstream of the model -- the dashboard now computes one set of counts, renders them and
// hands the same object to `catch_up` -- and this file is the tripwire for the half that lives in
// this package: given a fixture of counts, the feature's own deterministic simulator must produce a
// headline carrying exactly those numbers, and `validateOutput` must never let a model restate an
// overloaded person's open count as anything but the number it was given.
import { describe, expect, it } from 'vitest'
import { getFeatureSpec } from '../../src/features.js'
import {
  catchUpInputSchema,
  type CatchUpInput,
  type CatchUpOutput,
} from '../../src/prompts/catch-up.js'
import type { Locale } from '../../src/types.js'

/** The fixture is deliberately shaped like the screen that produced the bug: a department week with
 * real completions, a real previous week to compare against, and an overdue total much larger than
 * the handful of cards the briefing is actually shown. */
const TILE_COUNTS = {
  done: 14,
  doneLastPeriod: 11,
  created: 9,
  overdue: 77,
} as const

function fixture(over: Partial<CatchUpInput> = {}): CatchUpInput {
  return catchUpInputSchema.parse({
    locale: 'uz-Latn',
    scope: 'department',
    window: 'week',
    subjectName: 'Raqamli xizmatlar boshqarmasi',
    viewerName: 'Anvar Aliyev',
    period: { start: '2026-09-06', end: '2026-09-13' },
    counts: { ...TILE_COUNTS },
    done: Array.from({ length: 8 }, (_, i) => ({
      id: `done-${i}`,
      title: `Yopilgan ish ${i}`,
      assigneeName: 'Nodira Karimova',
      dueDate: '2026-09-10',
      daysOverdue: 0,
      daysSinceUpdate: 1,
    })),
    overdue: [
      {
        id: 'c9',
        title: 'Oylik hisobot',
        assigneeName: 'Nodira Karimova',
        dueDate: '2026-09-05',
        daysOverdue: 5,
        daysSinceUpdate: 9,
      },
    ],
    dueThisWeek: [
      {
        id: 'c21',
        title: 'Sayt matni',
        assigneeName: 'Anvar Aliyev',
        dueDate: '2026-09-16',
        daysOverdue: 0,
        daysSinceUpdate: 0,
      },
    ],
    loadPerPerson: [
      { name: 'Anvar Aliyev', openCount: 9, overdueCount: 2 },
      { name: 'Nodira Karimova', openCount: 4, overdueCount: 1 },
      { name: 'Dilnoza Yoʻldosheva', openCount: 3, overdueCount: 0 },
    ],
    ...over,
  })
}

const spec = getFeatureSpec('catch_up')

function simulate(input: CatchUpInput): CatchUpOutput {
  return spec.simulate!(input) as CatchUpOutput
}

/** Every run of digits in a string, as numbers -- what a head would read off the sentence. */
function numbersIn(text: string): number[] {
  return (text.match(/\d+/g) ?? []).map(Number)
}

describe('SEV1 #4 -- the briefing never contradicts the tiles it lives beside', () => {
  it('the department headline carries the tile’s own closed count', () => {
    const out = simulate(fixture())
    expect(numbersIn(out.headline)).toContain(TILE_COUNTS.done)
  })

  it('the trend is computed against the real previous period, never a hard-coded zero', () => {
    const out = simulate(fixture())
    const delta = TILE_COUNTS.done - TILE_COUNTS.doneLastPeriod
    expect(numbersIn(out.headline)).toContain(delta)
    // The exact regression: with `doneLastPeriod` left at 0 the sentence claimed "no change".
    expect(out.headline).not.toMatch(/bir xil|oʻzgarishsiz/i)
  })

  it('an unchanged week says so, and only then', () => {
    const out = simulate(fixture({ counts: { ...TILE_COUNTS, doneLastPeriod: TILE_COUNTS.done } }))
    expect(out.headline).toMatch(/bir xil/i)
  })

  it('a week with fewer completions than the last says fewer, not more', () => {
    const out = simulate(fixture({ counts: { ...TILE_COUNTS, done: 8, doneLastPeriod: 11 } }))
    expect(numbersIn(out.headline)).toContain(3)
    expect(out.headline).toMatch(/kam/i)
  })

  it('reads the same in all four locales, with the same numbers', () => {
    for (const locale of ['uz-Latn', 'uz-Cyrl', 'ru', 'en'] as Locale[]) {
      const out = simulate(fixture({ locale }))
      const numbers = numbersIn(out.headline)
      expect(numbers).toContain(TILE_COUNTS.done)
      expect(numbers).toContain(TILE_COUNTS.done - TILE_COUNTS.doneLastPeriod)
    }
  })

  it('an overloaded person’s open count is the database’s number, not the model’s', () => {
    const input = fixture()
    // A model that "remembers" 12 where analytics said 9 is exactly the class of disagreement this
    // finding is about; `validateOutput` overwrites rather than trusts.
    const tampered: CatchUpOutput = {
      ...simulate(input),
      overloaded: [{ name: 'Anvar Aliyev', openCount: 12, text: 'Anvarda 12 ta ochiq vazifa bor' }],
    }
    const checked = spec.validateOutput!(input, tampered)
    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    expect((checked.output as CatchUpOutput).overloaded[0]?.openCount).toBe(9)
  })

  it('a person who is not in loadPerPerson is dropped entirely', () => {
    const input = fixture()
    const tampered: CatchUpOutput = {
      ...simulate(input),
      overloaded: [{ name: 'Hech kim', openCount: 40, text: 'oʻylab topilgan odam' }],
    }
    const checked = spec.validateOutput!(input, tampered)
    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    expect((checked.output as CatchUpOutput).overloaded).toEqual([])
  })

  it('a department briefing never emits per-reader rows', () => {
    const out = simulate(fixture())
    expect(out.items).toEqual([])
  })
})
