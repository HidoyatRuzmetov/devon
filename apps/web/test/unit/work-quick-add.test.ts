import { describe, expect, it } from 'vitest'
import { LOCALES, translate } from '@devon/i18n'
import { parseQuickAdd, resolveQuickAddAssignee } from '../../src/features/work/lib/quick-add.js'
import type { MemberSummary } from '../../src/features/work/api.js'

const MEMBERS: MemberSummary[] = [
  {
    userId: 'u1',
    givenName: 'Nodira',
    familyName: 'Karimova',
    title: null,
    avatarKey: null,
    role: 'member',
    unitId: null,
    unitName: null,
  },
  {
    userId: 'u2',
    givenName: 'Botir',
    familyName: 'Aliyev',
    title: null,
    avatarKey: null,
    role: 'head',
    unitId: null,
    unitName: null,
  },
  {
    userId: 'u3',
    givenName: 'Nodirabegim',
    familyName: 'Yusupova',
    title: null,
    avatarKey: null,
    role: 'member',
    unitId: null,
    unitName: null,
  },
]

// A fixed Monday so weekday math ("friday") is deterministic across CI machines/timezones.
const MONDAY = new Date(2026, 8, 7) // 2026-09-07 is a Monday

describe('parseQuickAdd', () => {
  it('parses "Name: title, weekday" into assignee token, title and due date', () => {
    const result = parseQuickAdd('Nodira: EGDI paketi, juma', MONDAY)
    expect(result.assigneeToken).toBe('Nodira')
    expect(result.title).toBe('EGDI paketi')
    expect(result.dueAt).not.toBeNull()
    expect(result.dueAt?.getDay()).toBe(5) // Friday
  })

  it('parses a title with no assignee prefix and no date', () => {
    const result = parseQuickAdd('Hisobotni tugatish', MONDAY)
    expect(result.assigneeToken).toBeNull()
    expect(result.title).toBe('Hisobotni tugatish')
    expect(result.dueAt).toBeNull()
  })

  it('parses a title with a date but no assignee', () => {
    const result = parseQuickAdd('Hisobotni tugatish, tomorrow', MONDAY)
    expect(result.assigneeToken).toBeNull()
    expect(result.title).toBe('Hisobotni tugatish')
    expect(result.dueAt).not.toBeNull()
  })

  it('does not mistake a URL scheme colon for an assignee prefix', () => {
    const result = parseQuickAdd('https://example.com: check this out', MONDAY)
    expect(result.assigneeToken).toBeNull()
    expect(result.title).toBe('https://example.com: check this out')
  })

  it('leaves an unrecognised trailing comma segment as part of the title', () => {
    const result = parseQuickAdd('Nodira: buy milk, eggs', MONDAY)
    expect(result.title).toBe('buy milk, eggs')
    expect(result.dueAt).toBeNull()
  })

  it('recognises Russian and English weekday words too', () => {
    const ru = parseQuickAdd('Nodira: otchyot, пятница', MONDAY)
    expect(ru.dueAt?.getDay()).toBe(5)
    const en = parseQuickAdd('Nodira: report, friday', MONDAY)
    expect(en.dueAt?.getDay()).toBe(5)
  })

  // The `work.quickAdd.placeholder` examples must be inputs this grammar actually parses: the
  // English copy once read "... by friday", which silently produced a title with no due date.
  it.each(LOCALES)('parses the actual %s quick-add placeholder example', (locale) => {
    const placeholder = translate(locale, 'work.quickAdd.placeholder')
    const example = /[«"]([^»"]+)[»"]/.exec(placeholder)?.[1]
    if (!example) throw new Error(`${locale} quick-add hint must contain a quoted example`)
    const result = parseQuickAdd(example, MONDAY)
    expect(result.assigneeToken).not.toBeNull()
    expect(result.title).not.toBe('')
    expect(result.title).not.toContain(',')
    expect(result.dueAt).toEqual(new Date(2026, 8, 11))
  })
})

describe('resolveQuickAddAssignee', () => {
  it('resolves an exact given-name match over a longer substring match', () => {
    const resolved = resolveQuickAddAssignee('Nodira', MEMBERS)
    expect(resolved?.userId).toBe('u1')
  })

  it('resolves a family-name substring match', () => {
    const resolved = resolveQuickAddAssignee('Aliyev', MEMBERS)
    expect(resolved?.userId).toBe('u2')
  })

  it('strips a leading @ (filter-bar-style token)', () => {
    const resolved = resolveQuickAddAssignee('@botir', MEMBERS)
    expect(resolved?.userId).toBe('u2')
  })

  it('returns null for no match', () => {
    expect(resolveQuickAddAssignee('Zulfiya', MEMBERS)).toBeNull()
  })
})
