import { describe, expect, it } from 'vitest'
import {
  buildFeatureInput,
  FEATURE_FORMS,
  remapPlanSprintTasks,
} from '../../src/features/ai/feature-forms.js'

function specFor(feature: string) {
  const spec = FEATURE_FORMS.find((f) => f.feature === feature)
  if (!spec) throw new Error(`no form spec for "${feature}"`)
  return spec
}

describe('buildFeatureInput', () => {
  it('passes text/textarea fields through verbatim', () => {
    const spec = specFor('translate')
    const input = buildFeatureInput(spec, { text: 'Hello there' })
    expect(input['text']).toBe('Hello there')
  })

  it('splits a stringList field into trimmed, non-empty lines', () => {
    const spec = specFor('quick_add_parse')
    const input = buildFeatureInput(spec, {
      text: 'Assign Nodira the report',
      memberNames: 'Nodira Karimova\n  Anvar Aliyev  \n\n',
    })
    expect(input['memberNames']).toEqual(['Nodira Karimova', 'Anvar Aliyev'])
  })

  it('omits an optional field entirely when left blank', () => {
    const spec = specFor('quick_add_parse')
    const input = buildFeatureInput(spec, { text: 'Prepare the report', memberNames: '' })
    expect('memberNames' in input).toBe(false)
  })

  it('parses an idTitleList field ("id | title" per line) into {id, title} objects', () => {
    const spec = specFor('summarize_thread')
    const input = buildFeatureInput(spec, {
      cardTitle: 'Budget approval',
      comments: 'k1 | We agreed on the figures.\nk2 | I will send the PDF tomorrow.',
    })
    expect(input['comments']).toEqual([
      { id: 'k1', title: 'We agreed on the figures.' },
      { id: 'k2', title: 'I will send the PDF tomorrow.' },
    ])
  })

  it('uses the whole line as both id and title when there is no "|" separator', () => {
    const spec = specFor('summarize_thread')
    const input = buildFeatureInput(spec, { cardTitle: 'x', comments: 'just some text' })
    expect(input['comments']).toEqual([{ id: 'just some text', title: 'just some text' }])
  })

  it('falls back to a generated row id when a line starts with an empty id before "|"', () => {
    const spec = specFor('summarize_thread')
    const input = buildFeatureInput(spec, { cardTitle: 'x', comments: '| just some text' })
    expect(input['comments']).toEqual([{ id: 'row-1', title: 'just some text' }])
  })

  it('coerces a number field, and drops it when left blank', () => {
    const spec = specFor('deadline_risk')
    const input = buildFeatureInput(spec, {
      cardTitle: 'x',
      dueDate: '2026-09-10',
      today: '2026-09-08',
      checklistTotal: '4',
      checklistDone: '',
      daysSinceUpdate: '2',
    })
    expect(input['checklistTotal']).toBe(4)
    expect(input['checklistDone']).toBeUndefined()
  })

  it('every feature id in AI_FEATURE_IDS-shaped registry has exactly one form spec', () => {
    const seen = new Set(FEATURE_FORMS.map((f) => f.feature))
    expect(seen.size).toBe(FEATURE_FORMS.length)
  })
})

describe('remapPlanSprintTasks', () => {
  it('turns {id, title} rows into {title} tasks and adds a default sprintKind', () => {
    const spec = specFor('plan_sprint')
    const input = buildFeatureInput(spec, {
      goal: '',
      tasks: 't1 | Reply to emails\nt2 | Write the report',
    })
    const remapped = remapPlanSprintTasks(input)
    expect(remapped['tasks']).toEqual([{ title: 'Reply to emails' }, { title: 'Write the report' }])
    expect(remapped['sprintKind']).toBe('day')
  })

  it('is a no-op when there is no tasks field', () => {
    expect(remapPlanSprintTasks({ foo: 'bar' })).toEqual({ foo: 'bar' })
  })
})
