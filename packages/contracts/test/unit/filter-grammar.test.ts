import { describe, expect, it } from 'vitest'
import {
  cardMatchesFilterText,
  matchesFilterQuery,
  parseFilterQuery,
  resolveDateWord,
  serializeFilterQuery,
  type FilterableCard,
} from '../../src/filter-grammar.js'

describe('parseFilterQuery', () => {
  it('parses the full grammar example from TECH-SPEC §4', () => {
    const q = parseFilterQuery(
      'assignee:@me giver:@nodira status:active due:<=friday project:"EGDI" label:urgent unit:"Data" evidence',
    )
    expect(q.clauses).toEqual([
      { kind: 'assignee', token: '@me' },
      { kind: 'giver', token: '@nodira' },
      { kind: 'status', value: 'active' },
      { kind: 'due', op: '<=', word: 'friday' },
      { kind: 'project', name: 'EGDI' },
      { kind: 'label', name: 'urgent' },
      { kind: 'unit', name: 'Data' },
      { kind: 'text', value: 'evidence' },
    ])
  })

  it('keeps quoted free text as one token', () => {
    const q = parseFilterQuery('"exact phrase" another')
    expect(q.clauses).toEqual([
      { kind: 'text', value: 'exact phrase' },
      { kind: 'text', value: 'another' },
    ])
  })

  it('treats an unknown key as literal free text rather than dropping it', () => {
    const q = parseFilterQuery('foo:bar')
    expect(q.clauses).toEqual([{ kind: 'text', value: 'foo:bar' }])
  })

  it('defaults the due comparator to "=" when none is given', () => {
    const q = parseFilterQuery('due:friday')
    expect(q.clauses).toEqual([{ kind: 'due', op: '=', word: 'friday' }])
  })

  it('round-trips through serializeFilterQuery', () => {
    const q = parseFilterQuery('assignee:@me project:"Digital ID" label:urgent')
    expect(parseFilterQuery(serializeFilterQuery(q.clauses))).toEqual(
      parseFilterQuery('assignee:@me project:"Digital ID" label:urgent'),
    )
  })

  it('returns no clauses for blank input', () => {
    expect(parseFilterQuery('   ').clauses).toEqual([])
  })
})

describe('resolveDateWord', () => {
  // A fixed Wednesday, 2026-09-09.
  const wednesday = new Date(2026, 8, 9)

  it('resolves an ISO date literally', () => {
    expect(resolveDateWord('2026-09-20', wednesday)).toEqual(new Date(2026, 8, 20))
  })

  it('resolves "today"/"bugun"/"сегодня" to the same day', () => {
    for (const word of ['today', 'bugun', 'сегодня']) {
      expect(resolveDateWord(word, wednesday)).toEqual(new Date(2026, 8, 9))
    }
  })

  it('resolves "tomorrow" to the next day', () => {
    expect(resolveDateWord('tomorrow', wednesday)).toEqual(new Date(2026, 8, 10))
  })

  it('resolves a future weekday name in all three locales to the same date', () => {
    // Friday after 2026-09-09 (Wednesday) is 2026-09-11.
    for (const word of ['friday', 'juma', 'пятница']) {
      expect(resolveDateWord(word, wednesday)).toEqual(new Date(2026, 8, 11))
    }
  })

  it('resolves the current weekday name to today, not seven days out', () => {
    // wednesday itself
    for (const word of ['wednesday', 'chorshanba', 'среда']) {
      expect(resolveDateWord(word, wednesday)).toEqual(new Date(2026, 8, 9))
    }
  })

  it('returns null for gibberish', () => {
    expect(resolveDateWord('not-a-date', wednesday)).toBeNull()
  })
})

describe('matchesFilterQuery', () => {
  const now = new Date(2026, 8, 9) // Wednesday
  const base: FilterableCard = {
    id: 'card-1',
    title: 'Prepare quarterly report',
    description: 'For the digital services review',
    status: 'active',
    assigneeUserId: 'user-nodira',
    giverUserId: 'user-anvar',
    dueAt: new Date(2026, 8, 11), // Friday
    projectName: 'EGDI',
    labelNames: ['urgent', 'external'],
    unitName: 'Data',
  }

  it('matches assignee:@me against the viewer', () => {
    expect(cardMatchesFilterText(base, 'assignee:@me', { meUserId: 'user-nodira' })).toBe(true)
    expect(cardMatchesFilterText(base, 'assignee:@me', { meUserId: 'someone-else' })).toBe(false)
  })

  it('resolves a bare name token via resolveUserIds', () => {
    const ctx = {
      resolveUserIds: (t: string) => (t === 'nodira' ? ['user-nodira'] : []),
    }
    expect(cardMatchesFilterText(base, 'assignee:nodira', ctx)).toBe(true)
    expect(cardMatchesFilterText(base, 'giver:nodira', ctx)).toBe(false)
  })

  it('matches status, project, label, unit exactly (case-insensitive)', () => {
    expect(cardMatchesFilterText(base, 'status:active')).toBe(true)
    expect(cardMatchesFilterText(base, 'status:done')).toBe(false)
    expect(cardMatchesFilterText(base, 'project:"egdi"')).toBe(true)
    expect(cardMatchesFilterText(base, 'label:URGENT')).toBe(true)
    expect(cardMatchesFilterText(base, 'label:missing')).toBe(false)
    expect(cardMatchesFilterText(base, 'unit:"data"')).toBe(true)
  })

  it('matches due:<=friday for a card due on Friday, evaluated from Wednesday', () => {
    expect(cardMatchesFilterText(base, 'due:<=friday', { now })).toBe(true)
    expect(cardMatchesFilterText(base, 'due:<=today', { now })).toBe(false)
    expect(cardMatchesFilterText(base, 'due:>=friday', { now })).toBe(true)
  })

  it('matches free text against title and description', () => {
    expect(cardMatchesFilterText(base, 'quarterly')).toBe(true)
    // Two bare tokens AND together regardless of order (both appear somewhere in title/description) ...
    expect(cardMatchesFilterText(base, 'services digital')).toBe(true)
    // ... but a quoted phrase must match as a contiguous substring, so the reversed order does not.
    expect(cardMatchesFilterText(base, '"services digital"')).toBe(false)
    expect(cardMatchesFilterText(base, '"digital services"')).toBe(true)
    expect(cardMatchesFilterText(base, 'nonexistent')).toBe(false)
  })

  it('ANDs every clause together', () => {
    expect(matchesFilterQuery(base, parseFilterQuery('status:active label:urgent'))).toBe(true)
    expect(matchesFilterQuery(base, parseFilterQuery('status:active label:missing'))).toBe(false)
  })

  it('a card with no due date never matches a due: clause', () => {
    expect(cardMatchesFilterText({ ...base, dueAt: null }, 'due:<=friday', { now })).toBe(false)
  })
})
